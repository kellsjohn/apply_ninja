console.log('ApplyNinja: Glassdoor script active');

import { wait, setValue, getStorage, isCompanyBlacklisted, isTitleBlocked, isDailyLimitReached, isPaused, recordApplication, recordSkip, buildCoverLetter } from './utils/platform.js';

let isAutoApplying = false;
let isProcessRunning = false;
let processedJobIds = new Set();
let lastActivityTime = Date.now();
let delayBetweenApps = 4000;
let PROFILE = {}, FILTERS = {}, TEMPLATES = {}, RESUME = {};

window.addEventListener('beforeunload', () => {
  if (isAutoApplying) {
    isAutoApplying = false;
    isProcessRunning = false;
    chrome.storage.local.set({ isRunning: false });
  }
});

async function init() {
  const data = await getStorage(['isRunning', 'processedJobIds', 'settings', 'profile', 'filters', 'templates', 'resume']);
  if (data.processedJobIds) processedJobIds = new Set(data.processedJobIds);
  if (data.settings?.delayBetweenApps) delayBetweenApps = data.settings.delayBetweenApps * 1000;
  if (data.profile) PROFILE = data.profile;
  if (data.filters) FILTERS = data.filters;
  if (data.templates) TEMPLATES = data.templates;
  if (data.resume) RESUME = data.resume;
  if (data.settings?.platforms?.glassdoor === false) {
    console.log('ApplyNinja: Glassdoor disabled.');
    return;
  }
  if (data.isRunning) { isAutoApplying = true; startProcess(); }
}
init();

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'start' || request.action === 'resume') {
    chrome.storage.local.get(['settings'], (r) => {
      if (r.settings?.platforms?.glassdoor === false) return;
      isAutoApplying = true;
      if (!isProcessRunning) startProcess();
    });
  } else if (request.action === 'stop') {
    isAutoApplying = false;
    isProcessRunning = false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.isRunning) {
    chrome.storage.local.get(['settings'], (r) => {
      if (r.settings?.platforms?.glassdoor === false) return;
      isAutoApplying = changes.isRunning.newValue;
      if (isAutoApplying && !isProcessRunning) startProcess();
    });
  }
  if (changes.profile?.newValue) PROFILE = changes.profile.newValue;
  if (changes.filters?.newValue) FILTERS = changes.filters.newValue;
  if (changes.settings?.newValue?.delayBetweenApps) delayBetweenApps = changes.settings.newValue.delayBetweenApps * 1000;
});

setInterval(() => {
  if (isAutoApplying && !isProcessRunning && Date.now() - lastActivityTime > 30000) startProcess();
}, 10000);

function dismissPopups() {
  ['[data-test="modal-close-btn"]', 'button[aria-label="Close"]', 'button[aria-label="close"]',
   '[class*="CloseButton"]', '[class*="closeButton"]', '.modal-close'].forEach((sel) => {
    document.querySelectorAll(sel).forEach((btn) => { try { btn.click(); } catch (e) {} });
  });
}

// Activate the "Easy Apply only" filter pill if not already pressed
async function ensureEasyApplyFilter() {
  const filterBtn = document.querySelector('button[data-test="applicationType"]');
  if (!filterBtn) return false;
  if (filterBtn.getAttribute('aria-pressed') === 'true') return false; // already active
  console.log('ApplyNinja Glassdoor: Activating Easy Apply filter...');
  filterBtn.click();
  await wait(3000); // page reloads with filter applied
  return true;
}

function buildSearchUrl(keywords) {
  if (!keywords) return 'https://www.glassdoor.co.in/Job/india-software-engineer-jobs-SRCH_IL.0,5_IN115_KO6,23.htm';
  const slug = keywords.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
  const kLen = 6 + slug.length;
  return `https://www.glassdoor.co.in/Job/india-${slug}-jobs-SRCH_IL.0,5_IN115_KO6,${kLen}.htm`;
}

function isOnJobSearchPage() {
  const url = window.location.href;
  return url.includes('glassdoor.co.in/Job/') || url.includes('glassdoor.com/Job/');
}

function findApplyButton() {
  const selectors = [
    'button[data-test="applyButton"]',
    'button[class*="applyButton"]',
    'button[class*="ApplyButton"]',
  ];
  for (const sel of selectors) {
    const btn = document.querySelector(sel);
    if (btn) return btn;
  }
  const detailPane = document.querySelector('[class*="JobDetails"], [class*="jobDetails"]');
  if (detailPane) {
    return Array.from(detailPane.querySelectorAll('button')).find((b) => {
      const t = (b.innerText || b.getAttribute('aria-label') || '').toLowerCase();
      return t.includes('apply') && !t.includes('applied');
    });
  }
  return null;
}

async function startProcess() {
  if (!isAutoApplying || isProcessRunning) return;
  isProcessRunning = true;
  lastActivityTime = Date.now();

  if (await isPaused()) { isProcessRunning = false; return; }
  if (await isDailyLimitReached()) {
    await chrome.storage.local.set({ isRunning: false });
    isAutoApplying = false; isProcessRunning = false; return;
  }

  dismissPopups();
  await wait(300);

  const fresh = await getStorage(['profile', 'filters', 'templates', 'resume']);
  if (fresh.profile) PROFILE = fresh.profile;
  if (fresh.filters) FILTERS = fresh.filters;
  if (fresh.templates) TEMPLATES = fresh.templates;
  if (fresh.resume) RESUME = fresh.resume;

  if (!isOnJobSearchPage()) {
    const url = buildSearchUrl(RESUME.keywords || '');
    console.log('ApplyNinja Glassdoor: Navigating to', url);
    window.location.href = url;
    isProcessRunning = false;
    return;
  }

  // Click "Easy Apply only" filter if not already active — page will reload, script re-runs
  const filterClicked = await ensureEasyApplyFilter();
  if (filterClicked) {
    isProcessRunning = false;
    return;
  }

  console.log('ApplyNinja Glassdoor: Scanning job cards...');
  const jobCards = Array.from(document.querySelectorAll('li[data-test="jobListing"]'));
  console.log(`ApplyNinja Glassdoor: Found ${jobCards.length} job cards`);

  if (jobCards.length === 0) {
    window.scrollBy(0, 400);
    await wait(2000);
    isProcessRunning = false;
    await wait(delayBetweenApps);
    if (isAutoApplying) startProcess();
    return;
  }

  let didSomething = false;

  for (const card of jobCards) {
    const jobId = card.getAttribute('data-jobid') || card.getAttribute('data-id') || '';
    if (jobId && processedJobIds.has(jobId)) continue;

    const titleEl = card.querySelector('[data-test="job-title"], [class*="jobTitle"], a[class*="JobCard"]');
    const title = titleEl?.innerText?.trim() || '';
    const companyEl = card.querySelector('[class*="EmployerProfile_compactEmployerName"], [class*="employerName"], [data-test="employer-name"]');
    const company = companyEl?.innerText?.trim() || '';

    if (isCompanyBlacklisted(company, FILTERS.companyBlacklist)) {
      console.log(`ApplyNinja Glassdoor: Blacklisted "${company}", skipping.`);
      if (jobId) processedJobIds.add(jobId);
      await recordSkip();
      continue;
    }
    if (isTitleBlocked(title, FILTERS.titleBlocklist)) {
      console.log(`ApplyNinja Glassdoor: Blocked title "${title}", skipping.`);
      if (jobId) processedJobIds.add(jobId);
      await recordSkip();
      continue;
    }

    console.log(`ApplyNinja Glassdoor: Clicking "${title}" @ ${company}`);
    const link = card.querySelector('[data-test="job-link"], a[class*="JobCard"], a[class*="jobTitle"]');
    if (link) link.click(); else card.click();
    await wait(3000);
    dismissPopups();
    await wait(500);

    const applyBtn = findApplyButton();
    if (applyBtn) {
      const btnText = (applyBtn.innerText || applyBtn.getAttribute('aria-label') || '').toLowerCase();
      if (btnText.includes('apply')) {
        applyBtn.click();
        await wait(2500);
        await handleGlassdoorModal(jobId, title, company);
        didSomething = true;
        break;
      }
    }

    if (jobId) processedJobIds.add(jobId);
    await recordSkip();
    didSomething = true;
    break;
  }

  if (!didSomething) {
    const nextBtn = document.querySelector('[data-test="pagination-next"], button[aria-label="Next"], [class*="nextButton"]');
    if (nextBtn && !nextBtn.disabled) { nextBtn.click(); await wait(3000); }
  }

  await chrome.storage.local.set({ processedJobIds: Array.from(processedJobIds) });
  isProcessRunning = false;
  await wait(delayBetweenApps);
  if (isAutoApplying) startProcess();
}

async function handleGlassdoorModal(jobId, title, company) {
  await wait(1500);
  dismissPopups();
  const coverLetter = buildCoverLetter(PROFILE, TEMPLATES, RESUME.summary);

  for (let step = 0; step < 12; step++) {
    await wait(1500);
    dismissPopups();

    document.querySelectorAll('textarea:not([disabled])').forEach((t) => {
      if (!t.value) setValue(t, coverLetter);
    });

    document.querySelectorAll('input[type="text"]:not([disabled]), input[type="tel"]:not([disabled]), input[type="email"]:not([disabled])').forEach((input) => {
      if (input.value) return;
      const label = (input.getAttribute('placeholder') || input.getAttribute('aria-label') || input.getAttribute('name') || '').toLowerCase();
      if (label.includes('phone') || label.includes('mobile')) setValue(input, PROFILE.phone || '');
      else if (label.includes('first')) setValue(input, PROFILE.firstName || '');
      else if (label.includes('last')) setValue(input, PROFILE.lastName || '');
      else if (label.includes('name')) setValue(input, (PROFILE.firstName || '') + ' ' + (PROFILE.lastName || ''));
      else if (label.includes('email')) setValue(input, PROFILE.email || '');
    });

    const allBtns = Array.from(document.querySelectorAll('button'));

    const submitBtn = document.querySelector('button[data-test="submit-button"], button[type="submit"]')
      || allBtns.find((b) => {
        const t = (b.innerText || '').toLowerCase().trim();
        return (t === 'submit' || t === 'submit application') && !b.disabled;
      });

    if (submitBtn && !submitBtn.disabled) {
      console.log(`ApplyNinja Glassdoor: Submitting "${title}"`);
      submitBtn.click();
      await wait(3000);
      await recordApplication(jobId, title, company, 'glassdoor');
      if (jobId) processedJobIds.add(jobId);
      dismissPopups();
      await wait(500);
      const doneBtn = allBtns.find((b) => (b.innerText || '').toLowerCase().includes('done'));
      if (doneBtn) doneBtn.click();
      return;
    }

    const nextBtn = allBtns.find((b) => {
      const t = (b.innerText || '').toLowerCase().trim();
      return (t.includes('next') || t.includes('continue')) && !b.disabled;
    });

    if (nextBtn) {
      console.log(`ApplyNinja Glassdoor: Step ${step + 1} — next`);
      nextBtn.click();
    } else {
      break;
    }
  }

  await recordApplication(jobId, title, company, 'glassdoor');
  if (jobId) processedJobIds.add(jobId);
}
