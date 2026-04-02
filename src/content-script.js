console.log('ApplyNinja: LinkedIn script active');

// Debug helper - expose to window for manual testing
window.ApplyNinjaDebug = {
  findButton: () => {
    const btn = findEasyApplyButton();
    console.log('Easy Apply button:', btn);
    if (btn) {
      console.log('Button details:', {
        text: btn.innerText,
        ariaLabel: btn.getAttribute('aria-label'),
        classes: btn.className,
        disabled: btn.disabled,
        visible: btn.offsetParent !== null,
        element: btn,
      });
    }
    return btn;
  },
  checkApplied: () => {
    const result = isCurrentJobAlreadyApplied();
    console.log('Is current job already applied?', result);
    return result;
  },
  getCurrentJobId: () => {
    const id = getCurrentJobIdFromUrl();
    console.log('Current job ID:', id);
    return id;
  },
  getProcessedIds: () => {
    console.log('Processed job IDs:', Array.from(processedJobIds));
    return Array.from(processedJobIds);
  },
  forceStart: () => {
    console.log('Forcing startProcess...');
    isAutoApplying = true;
    startProcess();
  },
  getState: () => {
    return {
      isAutoApplying,
      isProcessRunning,
      processedJobsCount: processedJobIds.size,
      currentUrl: window.location.href,
      delayBetweenApps,
    };
  },
};

console.log('ApplyNinja: Debug helper available at window.ApplyNinjaDebug');

import { isCompanyBlacklisted, isTitleBlocked, isDailyLimitReached, isPaused, recordApplication as sharedRecordApplication, recordSkip as sharedRecordSkip, buildCoverLetter } from './utils/platform.js';

let isAutoApplying = false;
let isProcessRunning = false;
let processedJobIds = new Set();
let lastActivityTime = Date.now();
let delayBetweenApps = 3000;
let FILTERS = { companyBlacklist: [], titleBlocklist: [] };
let TEMPLATES = { active: 0, list: [{ name: 'Default', body: '' }] };

// Stop everything when tab is CLOSED (not navigated away)
window.addEventListener('beforeunload', () => {
  // Only clear isRunning if the tab is actually closing, not just navigating
  // We detect navigation vs close by checking if the page is being unloaded due to navigation
  // Use pagehide with persisted=false as a more reliable signal, but beforeunload is fine
  // The key fix: do NOT set isRunning=false on navigation — only on actual tab close
  // We can't reliably distinguish, so we just remove this behavior entirely.
  // The heartbeat and storage listener will handle resuming on the new page.
  if (isAutoApplying) {
    isAutoApplying = false;
    isProcessRunning = false;
    console.log('Auto Job Apply: Tab unloading — pausing local state.');
    // Do NOT write isRunning: false — let the new page pick it up from storage
  }
});

// Load settings + processedJobIds on start
chrome.storage.local.get(['isRunning', 'processedJobIds', 'settings', 'filters', 'templates'], (result) => {
  if (result.processedJobIds) processedJobIds = new Set(result.processedJobIds);
  if (result.settings?.delayBetweenApps) delayBetweenApps = result.settings.delayBetweenApps * 1000;
  if (result.filters) FILTERS = result.filters;
  if (result.templates) TEMPLATES = result.templates;

  // Only run if linkedin platform is enabled (default true for backwards compat)
  const linkedinEnabled = result.settings?.platforms?.linkedin !== false;
  if (!linkedinEnabled) {
    console.log('ApplyNinja: LinkedIn platform disabled, script inactive.');
    return;
  }
  if (result.isRunning) {
    console.log('Auto Job Apply: Resuming automation...');
    isAutoApplying = true;
    // Small delay to let the page fully render before starting
    setTimeout(() => startProcess(), 1500);
  } else {
    // Even if automation is not running, auto-fill login if we land on the login page
    // This handles the case where LinkedIn logs the user out mid-session
    const url = window.location.href;
    const isLoginPage = url.includes('linkedin.com/login') || url.includes('linkedin.com/uas/login');
    const isAccountPicker = !!document.querySelector('button.member-profile__details') || !!document.querySelector('#rememberme-div');
    if (isLoginPage || isAccountPicker) {
      console.log('Auto Job Apply: Login page detected on load. Attempting auto-login...');
      // Longer delay for LinkedIn's SPA to fully render the form
      setTimeout(() => attemptLogin(), 2500);
    }
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('ApplyNinja LinkedIn received message:', request);
  if (request.action === 'start' || request.action === 'resume') {
    // Guard: only act if linkedin is enabled
    chrome.storage.local.get(['settings'], (r) => {
      if (r.settings?.platforms?.linkedin === false) return;
      isAutoApplying = true;
      if (!isProcessRunning) startProcess();
    });
    return;
  }
  if (request.action === 'stop') {
    isAutoApplying = false;
    isProcessRunning = false;
    console.log('ApplyNinja LinkedIn stopped');
  }
});

// Added storage listener for better reliability
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.isRunning) {
    const enabled = true; // will be checked inside startProcess via isPaused/isDailyLimit
    chrome.storage.local.get(['settings'], (r) => {
      if (r.settings?.platforms?.linkedin === false) return;
      isAutoApplying = changes.isRunning.newValue;
      if (isAutoApplying) startProcess();
    });
  }
  if (changes.filters?.newValue) FILTERS = changes.filters.newValue;
  if (changes.templates?.newValue) TEMPLATES = changes.templates.newValue;
  if (changes.settings?.newValue?.delayBetweenApps) delayBetweenApps = changes.settings.newValue.delayBetweenApps * 1000;
});

async function startProcess() {
  if (!isAutoApplying) {
    isProcessRunning = false;
    return;
  }
  if (isProcessRunning) {
    console.log('ApplyNinja: startProcess already running. Skipping.');
    return;
  }

  // Check pause
  if (await isPaused()) {
    console.log('ApplyNinja: Paused, waiting...');
    isProcessRunning = false;
    return;
  }

  // Check daily limit
  if (await isDailyLimitReached()) {
    console.log('ApplyNinja: Daily limit reached. Stopping.');
    chrome.storage.local.set({ isRunning: false });
    isAutoApplying = false;
    isProcessRunning = false;
    return;
  }

  isProcessRunning = true;
  lastActivityTime = Date.now();
  console.log('ApplyNinja: startProcess triggered');

  const keywords = await getKeywords();
  const jobLocation = await getJobLocation();
  const currentUrl = window.location.href;

  // Check if logged in — only redirect if we're NOT on a login/auth page already
  if (!currentUrl.includes('linkedin.com/login') && !currentUrl.includes('linkedin.com/checkpoint') && !currentUrl.includes('linkedin.com/uas/login')) {
    const signInBtn =
      document.querySelector('a.nav__button-secondary[href*="login"]') ||
      document.querySelector('a[data-tracking-control-name*="guest_homepage"][href*="login"]') ||
      Array.from(document.querySelectorAll('a, button')).find((el) => {
        const t = (el.innerText || '').trim().toLowerCase();
        return t === 'sign in' && el.offsetParent !== null;
      });
    if (signInBtn) {
      console.log('ApplyNinja: Not logged in. Clicking Sign in button...');
      if (signInBtn.tagName === 'A' && signInBtn.href) {
        window.location.href = signInBtn.href;
      } else {
        signInBtn.click();
      }
      isProcessRunning = false;
      return;
    }
  }

  // --- Detect "Sign in to view more jobs" modal and redirect to login ---
  const signInModal = document.querySelector('[data-test-modal]') || document.querySelector('.artdeco-modal') || document.querySelector('[role="dialog"]');
  if (signInModal) {
    const modalText = (signInModal.innerText || '').toLowerCase();
    if (modalText.includes('sign in') || modalText.includes('join now') || modalText.includes('continue with')) {
      console.log('Auto Job Apply: Sign-in modal detected. Redirecting to login...');
      isProcessRunning = false;
      window.location.href = 'https://www.linkedin.com/login';
      return;
    }
  }
  // Also check for inline sign-in prompts on the page itself
  const pageText = document.body.innerText;
  if (currentUrl.includes('linkedin.com/jobs') && (pageText.includes('Sign in to see') || pageText.includes('Sign in to apply') || pageText.includes('Join now to see'))) {
    const hasJobCards = !!document.querySelector('.job-card-container, .jobs-search-results-list__item');
    if (!hasJobCards) {
      console.log('Auto Job Apply: Not logged in on jobs page. Redirecting to login...');
      isProcessRunning = false;
      window.location.href = 'https://www.linkedin.com/login';
      return;
    }
  }

  // --- Handle LinkedIn login/checkpoint pages ---
  // "Welcome back" account picker — session cookie is still valid, just navigate directly
  const isWelcomeBackPage = currentUrl.includes('linkedin.com/login') && document.body.innerText.includes('Welcome back');
  if (isWelcomeBackPage) {
    console.log('Auto Job Apply: "Welcome back" page detected. Trying to click saved account...');
    // The account card is a div[role="button"] containing the profile photo/figure and name
    const accountCardBtn = Array.from(document.querySelectorAll('div[role="button"][tabindex="0"]')).find((el) => {
      return el.querySelector('img[src*="licdn.com"]') || el.querySelector('figure');
    });
    if (accountCardBtn) {
      console.log('Auto Job Apply: Clicking saved account card...');
      accountCardBtn.click();
      isProcessRunning = false;
      await wait(4000);
      startProcess();
      return;
    }
    // Fallback: "Sign in using another account" link
    const signInOtherLink = Array.from(document.querySelectorAll('a')).find((a) => (a.innerText || '').toLowerCase().includes('sign in using another account'));
    if (signInOtherLink) {
      console.log('Auto Job Apply: Clicking "Sign in using another account"...');
      window.location.href = signInOtherLink.href || 'https://www.linkedin.com/login';
      isProcessRunning = false;
      return;
    }
    // Last resort
    console.log('Auto Job Apply: Could not find account card, going to login...');
    window.location.href = 'https://www.linkedin.com/login';
    isProcessRunning = false;
    return;
  }

  // Check for classic account picker (rememberme / memberList)
  const memberBtn = document.querySelector('button.member-profile__details');
  const isAccountPickerPage = !!memberBtn || !!document.querySelector('#rememberme-div') || !!document.querySelector('.memberList-container');

  if (isAccountPickerPage) {
    console.log('Auto Job Apply: Account picker detected. Clicking saved account...');
    if (memberBtn) {
      memberBtn.click();
      isProcessRunning = false;
      await wait(4000);
      startProcess();
      return;
    }
    const signInOther = document.querySelector('button.signin-other-account') || Array.from(document.querySelectorAll('button, a')).find((b) => (b.innerText || '').toLowerCase().includes('sign in using another account'));
    if (signInOther) {
      if (signInOther.tagName === 'A') window.location.href = signInOther.href;
      else signInOther.click();
      isProcessRunning = false;
      await wait(2000);
      startProcess();
      return;
    }
    isProcessRunning = false;
    return;
  }

  if (currentUrl.includes('linkedin.com/login') || currentUrl.includes('linkedin.com/checkpoint') || currentUrl.includes('linkedin.com/uas/login')) {
    console.log('Auto Job Apply: Login page detected. Attempting auto-login...');
    const loggedIn = await attemptLogin();
    if (loggedIn) {
      isProcessRunning = false;
      await wait(4000);
      const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(jobLocation)}&f_AL=true`;
      window.location.href = searchUrl;
    } else {
      isProcessRunning = false;
    }
    return;
  }

  // --- Handle "Welcome Back" account picker page (fallback text check) ---
  if (document.querySelector('.login__form') === null && (document.body.innerText.includes('Welcome back') || document.body.innerText.includes('Sign in using another account'))) {
    const signInOther = Array.from(document.querySelectorAll('button, a')).find((el) => (el.innerText || '').toLowerCase().includes('sign in using another account'));
    if (signInOther) {
      console.log('Auto Job Apply: Clicking "Sign in using another account"...');
      if (signInOther.tagName === 'A') {
        window.location.href = signInOther.href;
      } else {
        signInOther.click();
      }
      isProcessRunning = false;
      await wait(2000);
      startProcess();
      return;
    }
    isProcessRunning = false;
    return;
  }

  console.log('Auto Job Apply: Current URL:', currentUrl);
  console.log('Auto Job Apply: Keywords:', keywords);

  // If not on jobs page, redirect or try global search
  if (!currentUrl.includes('linkedin.com/jobs/search')) {
    // Check if we are on a general search results page
    const seeAllJobsButton = Array.from(document.querySelectorAll('a, button')).find((el) => el.innerText.toLowerCase().includes('see all job results') || el.innerText.toLowerCase().includes('see all jobs'));

    if (seeAllJobsButton) {
      console.log('Auto Job Apply: Found "See all job results" link, clicking...');
      seeAllJobsButton.click();
      await wait(3000);
      return;
    }

    if (keywords) {
      console.log('Auto Job Apply: Not on Jobs page. Redirecting to jobs page...');
      goToJobsPage(keywords, jobLocation);
      return;
    } else {
      console.warn('Auto Job Apply: No keywords set. Cannot initiate search.');
      return;
    }
  }

  // Check if we need to initiate search on the jobs page
  // If keywords are present but not in the URL, try to initiate search
  if (keywords && !currentUrl.includes(`keywords=${encodeURIComponent(keywords)}`) && !currentUrl.includes(`keywords=${keywords.replace(/\s+/g, '%20')}`)) {
    console.log('Auto Job Apply: Search page detected but keywords mismatch. Initiating search...');
    const searchInited = await initiateSearch(keywords);
    if (searchInited) return;
  }

  // Check if location in URL matches saved jobLocation — if not, redirect
  if (jobLocation) {
    const locEncoded = encodeURIComponent(jobLocation).toLowerCase();
    const locPlain = jobLocation.toLowerCase().replace(/\s+/g, '%20');
    const urlLower = currentUrl.toLowerCase();
    if (!urlLower.includes(`location=${locEncoded}`) && !urlLower.includes(`location=${locPlain}`)) {
      console.log(`Auto Job Apply: Location mismatch. Redirecting to "${jobLocation}"...`);
      isProcessRunning = false;
      goToJobsPage(keywords, jobLocation);
      return;
    }
  }

  // Ensure Easy Apply filter is active — if not, redirect with f_AL=true
  if (!currentUrl.includes('f_AL=true')) {
    console.log('Auto Job Apply: Easy Apply filter not active. Redirecting with f_AL=true...');
    isProcessRunning = false;
    const separator = currentUrl.includes('?') ? '&' : '?';
    window.location.href = currentUrl + separator + 'f_AL=true';
    return;
  }

  console.log('Auto Job Apply: Searching for jobs to apply...');

  // If the currently loaded job is already applied, skip it immediately
  if (isCurrentJobAlreadyApplied()) {
    console.log('Auto Job Apply: Current job already applied. Marking as processed and moving to next...');
    const prevJobId = getCurrentJobIdFromUrl();
    await markCurrentJobAsProcessed();
    await wait(300);
    const moved = await selectNextJobCard();
    if (moved) {
      // Wait until the URL changes to confirm a new job loaded
      await waitForJobDetailLoad(prevJobId);
    }
    isProcessRunning = false;
    startProcess();
    return;
  }

  // Check if LinkedIn is blocking Easy Apply due to incomplete profile
  // Only skip if there's NO Easy Apply button visible (truly blocked)
  const detailPane = document.querySelector('.jobs-search__job-details--wrapper, .jobs-details, .scaffold-layout__detail');
  if (detailPane) {
    const detailText = detailPane.innerText.toLowerCase();
    const hasProfileWarning = detailText.includes('your profile is missing') || detailText.includes('missing required');
    const hasEasyApplyBtn = !!findEasyApplyButton();
    if (hasProfileWarning && !hasEasyApplyBtn) {
      console.log('Auto Job Apply: Profile incomplete and no Easy Apply button, skipping...');
      await markCurrentJobAsProcessed();
      await recordSkip();
      await wait(1000);
      const moved = await selectNextJobCard();
      if (moved) await wait(3000);
      isProcessRunning = false;
      startProcess();
      return;
    }
  }

  // 1. Look for Easy Apply buttons in the current view
  let easyApplyButton = findEasyApplyButton();

  if (!easyApplyButton) {
    console.log('Auto Job Apply: No Easy Apply button found in current view. Checking if current active job is Easy Apply...');
    const activeCard = document.querySelector('.job-card-container--active, .jobs-search-results-list__item--active, .active-job-card');
    if (activeCard && activeCard.innerText.toLowerCase().includes('easy apply') && !activeCard.innerText.toLowerCase().includes('applied')) {
      console.log('Auto Job Apply: Current active job is Easy Apply. Waiting for button to appear...');
      // Try multiple times with shorter intervals
      for (let i = 0; i < 6; i++) {
        await wait(1000);
        easyApplyButton = findEasyApplyButton();
        if (easyApplyButton) {
          console.log(`Auto Job Apply: Button found after ${i + 1} attempts`);
          break;
        }
      }
    }

    if (!easyApplyButton) {
      console.log('Auto Job Apply: Still no button. Selecting next job card...');
      const result = await selectNextJobCard();
      if (result) {
        console.log('Auto Job Apply: New job card clicked, waiting for details to load...');
        // Wait for URL to change indicating new job loaded
        const prevJobId = getCurrentJobIdFromUrl();
        await wait(2000);
        const newJobId = await waitForJobDetailLoad(prevJobId, 8000);
        if (newJobId) {
          console.log('Auto Job Apply: New job loaded, searching for Easy Apply button...');
          await wait(2000);
          easyApplyButton = findEasyApplyButton();
        }
      }
    }
  }

  if (easyApplyButton) {
    console.log('Auto Job Apply: Found Easy Apply button, preparing to click...');

    // Ensure button is in viewport and visible
    easyApplyButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await wait(1000);

    // Log button details for debugging
    console.log('Auto Job Apply: Button details:', {
      text: easyApplyButton.innerText,
      ariaLabel: easyApplyButton.getAttribute('aria-label'),
      classes: easyApplyButton.className,
      disabled: easyApplyButton.disabled,
      visible: easyApplyButton.offsetParent !== null,
    });

    // Try multiple click methods for better reliability
    try {
      easyApplyButton.focus();
      await wait(300);
      easyApplyButton.click();
      console.log('Auto Job Apply: Clicked Easy Apply button (method 1)');
    } catch (e) {
      console.warn('Auto Job Apply: Click method 1 failed, trying alternative:', e);
      try {
        // Fallback: dispatch mouse events
        const clickEvent = new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true,
        });
        easyApplyButton.dispatchEvent(clickEvent);
        console.log('Auto Job Apply: Clicked Easy Apply button (method 2)');
      } catch (e2) {
        console.error('Auto Job Apply: All click methods failed:', e2);
      }
    }

    await wait(3000);
    await handleModal();
    // handleModal always resets isProcessRunning and calls startProcess internally
    // but as a safety net, ensure we don't leave the process hanging
    if (isProcessRunning) {
      isProcessRunning = false;
      startProcess();
    }
  } else {
    // Check if it's a "Company Apply" button
    const applyButton = findApplyButton();
    if (applyButton) {
      console.log('Auto Job Apply: Found "Company Apply" button. Marking as processed and skipping.');
      await markCurrentJobAsProcessed();
      await recordSkip();
      await wait(1000);
      isProcessRunning = false;
      startProcess();
      return;
    }

    console.log('Auto Job Apply: No Easy Apply button or next card found. Scrolling list and retrying...');

    // Target the specific scrollable container for LinkedIn job lists
    const jobListContainer = document.querySelector('.jobs-search-results-list') || document.querySelector('.jobs-search-results-list__item')?.parentElement || window;

    if (jobListContainer === window) {
      window.scrollBy(0, 500);
    } else {
      jobListContainer.scrollBy({ top: 500, behavior: 'smooth' });
    }

    await wait(3000);
    isProcessRunning = false;
    startProcess();
  }
}

// Heartbeat to ensure we don't get stuck forever
setInterval(() => {
  if (isAutoApplying && !isProcessRunning) {
    const idleTime = Date.now() - lastActivityTime;
    if (idleTime > 30000) {
      // 30 seconds idle
      console.log('Auto Job Apply: Heartbeat detected inactivity, restarting process...');
      startProcess();
    }
  }
}, 10000);

async function markCurrentJobAsProcessed() {
  // First try to get job ID from the URL (most reliable)
  const urlMatch = window.location.href.match(/currentJobId=(\d+)/);
  const jobId = urlMatch ? urlMatch[1] : null;

  // Get job title + company from the detail pane for history
  const titleEl = document.querySelector('.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1.t-24');
  const companyEl = document.querySelector('.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, .jobs-details-top-card__company-url');
  const title = titleEl?.innerText?.trim() || '';
  const company = companyEl?.innerText?.trim() || '';

  if (jobId) {
    console.log('Auto Job Apply: Marking job as processed (from URL):', jobId);
    processedJobIds.add(jobId);
  } else {
    // Fallback: find active card
    const activeJob = document.querySelector('.job-card-container--active, .jobs-search-results-list__item--active, .active-job-card');
    if (activeJob) {
      const cardJobId = activeJob.getAttribute('data-job-id') || activeJob.getAttribute('data-occludable-job-id');
      if (cardJobId) processedJobIds.add(cardJobId);
      else {
        const cardTitle = activeJob.querySelector('.job-card-list__title')?.innerText;
        if (cardTitle) processedJobIds.add(cardTitle);
      }
    }
  }

  await chrome.storage.local.set({ processedJobIds: Array.from(processedJobIds) });
}

async function recordApplication(jobId, title, company) {
  await sharedRecordApplication(jobId, title, company, 'linkedin');
  console.log(`ApplyNinja: Recorded application — ${title} @ ${company}`);
}

async function recordSkip() {
  await sharedRecordSkip();
}

function isCurrentJobAlreadyApplied() {
  // 1. Check if current URL job ID is already in processedJobIds (most reliable)
  const urlMatch = window.location.href.match(/currentJobId=(\d+)/);
  if (urlMatch && processedJobIds.has(urlMatch[1])) {
    console.log('Auto Job Apply: Job already in processedJobIds:', urlMatch[1]);
    return true;
  }

  // 2. Check the active card text — LinkedIn shows "Applied" directly in the card
  const activeCard = document.querySelector('.job-card-container--active, .jobs-search-results-list__item--active');
  if (activeCard) {
    const cardText = activeCard.innerText.toLowerCase();
    // Look for standalone "applied" badge text
    const appliedBadge = activeCard.querySelector('.job-card-container__footer-job-state, [class*="applied"]');
    if (appliedBadge) {
      const badgeText = appliedBadge.innerText.toLowerCase().trim();
      if (badgeText === 'applied' || badgeText.includes('applied ')) {
        console.log('Auto Job Apply: Job card shows "Applied" badge');
        return true;
      }
    }
  }

  // 3. Check the detail pane — look for "Applied" status with "See application" link
  const detailPanes = ['.jobs-search__job-details--wrapper', '.jobs-details', '.scaffold-layout__detail', '[class*="job-details"]', '.jobs-details__main-content'];

  for (const selector of detailPanes) {
    const detailPane = document.querySelector(selector);
    if (detailPane && urlMatch) {
      const text = detailPane.innerText.toLowerCase();
      // Only mark as applied if BOTH indicators are present
      const hasSeeApplication = text.includes('see application') || text.includes('view application');
      const hasAppliedTimestamp = text.includes('applied') && (text.includes('ago') || text.includes('just now'));

      if (hasSeeApplication && hasAppliedTimestamp) {
        // Extra check: Easy Apply button must be gone
        const easyApplyBtn = detailPane.querySelector('button.jobs-apply-button, .jobs-s-apply button');
        const hasEasyApplyBtn = easyApplyBtn && easyApplyBtn.innerText.toLowerCase().includes('easy apply');
        if (!hasEasyApplyBtn) {
          console.log('Auto Job Apply: Detail pane shows job is applied (has "See application" + timestamp, no Easy Apply button)');
          return true;
        }
      }
    }
  }

  return false;
}

async function waitForJobDetailLoad(previousJobId, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const urlMatch = window.location.href.match(/currentJobId=(\d+)/);
    if (urlMatch && urlMatch[1] !== previousJobId) {
      console.log('Auto Job Apply: Detail pane loaded new job:', urlMatch[1]);
      return urlMatch[1];
    }
    await wait(300);
  }
  console.log('Auto Job Apply: Timeout waiting for new job to load.');
  return null;
}

function getCurrentJobIdFromUrl() {
  const m = window.location.href.match(/currentJobId=(\d+)/);
  return m ? m[1] : null;
}

function findApplyButton() {
  const selectors = ['button.jobs-apply-button', '.jobs-s-apply button', '.jobs-apply-button', '[data-control-name="job_apply_button"]'];

  for (const selector of selectors) {
    const buttons = document.querySelectorAll(selector);
    for (const btn of buttons) {
      const text = btn.innerText.toLowerCase();
      if (text.includes('apply') && !text.includes('easy apply')) {
        return btn;
      }
    }
  }
  return null;
}

async function selectNextJobCard() {
  const cards = Array.from(document.querySelectorAll('.job-card-container, .jobs-search-results-list__item, [data-occludable-job-id]'));
  console.log(`Auto Job Apply: Found ${cards.length} job cards.`);

  for (const card of cards) {
    const jobId = card.getAttribute('data-job-id') || card.getAttribute('data-occludable-job-id');
    const title = card.querySelector('.job-card-list__title')?.innerText?.trim() || '';

    if (jobId && processedJobIds.has(jobId)) continue;
    if (!jobId && title && processedJobIds.has(title)) continue;

    // Company & title filters
    const companyName = card.querySelector('.job-card-container__primary-description, .job-card-list__company-name')?.innerText?.trim() || '';
    if (isCompanyBlacklisted(companyName, FILTERS.companyBlacklist)) {
      console.log(`ApplyNinja: Blacklisted company "${companyName}", skipping.`);
      if (jobId) processedJobIds.add(jobId);
      else if (title) processedJobIds.add(title);
      await sharedRecordSkip();
      continue;
    }
    if (isTitleBlocked(title, FILTERS.titleBlocklist)) {
      console.log(`ApplyNinja: Blocked title "${title}", skipping.`);
      if (jobId) processedJobIds.add(jobId);
      else if (title) processedJobIds.add(title);
      await sharedRecordSkip();
      continue;
    }

    const text = card.innerText.toLowerCase();
    const isEasyApply = text.includes('easy apply');
    // Only treat as applied if there's an explicit "applied" badge (not "easy apply")
    const appliedBadgeEl = card.querySelector('.job-card-container__footer-job-state, [class*="applied-state"], [class*="job-applied"]');
    const hasAppliedBadge = appliedBadgeEl && appliedBadgeEl.innerText.toLowerCase().trim() === 'applied';
    const isApplied = hasAppliedBadge || (jobId && processedJobIds.has(jobId));

    const isActive = card.classList.contains('job-card-container--active') || card.classList.contains('jobs-search-results-list__item--active');

    if (isEasyApply && !isApplied) {
      // For the active card, also check the detail pane for "Applied" status
      if (isActive && isCurrentJobAlreadyApplied()) {
        console.log(`Auto Job Apply: Active card "${title}" is already applied (detected in detail pane). Marking processed.`);
        if (jobId) processedJobIds.add(jobId);
        else if (title) processedJobIds.add(title);
        await chrome.storage.local.set({ processedJobIds: Array.from(processedJobIds) });
        continue;
      }

      // Active card is not yet applied — let startProcess handle it directly
      if (isActive) {
        // But if the detail pane shows profile missing AND no easy apply button, skip it
        const detailPane = document.querySelector('.jobs-search__job-details--wrapper, .jobs-details, .scaffold-layout__detail');
        if (detailPane) {
          const detailText = detailPane.innerText.toLowerCase();
          const hasProfileWarning = detailText.includes('your profile is missing') || detailText.includes('missing required');
          const hasEasyApplyBtn = !!findEasyApplyButton();
          if (hasProfileWarning && !hasEasyApplyBtn) {
            console.log(`Auto Job Apply: Active card "${title}" has profile warning and no button, marking processed and skipping.`);
            if (jobId) processedJobIds.add(jobId);
            else if (title) processedJobIds.add(title);
            await chrome.storage.local.set({ processedJobIds: Array.from(processedJobIds) });
            await sharedRecordSkip();
            continue; // move to next card
          }
        }
        console.log(`Auto Job Apply: Active card "${title}" is unapplied and ready.`);
        return false;
      }

      console.log(`Auto Job Apply: Selecting next job card: "${title || 'Unknown Title'}"`);

      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      await wait(1000);

      const link = card.querySelector('a.job-card-container__link, .job-card-list__title, [data-control-name="job_card"]');
      if (link) {
        link.click();
      } else {
        card.click();
      }

      // Do NOT pre-mark as processed — handleModal will mark it after apply/skip
      return true;
    } else {
      // Skip non-easy-apply or already applied cards
      if (jobId || title) {
        console.log(`Auto Job Apply: Skipping card "${title}": ${!isEasyApply ? 'Not Easy Apply' : 'Already Applied'}`);
        if (jobId) processedJobIds.add(jobId);
        else if (title) processedJobIds.add(title);
      }
    }
  }

  // Try to find and click Next Page if no cards found on current page
  const nextButton = document.querySelector('button[aria-label="Next"], .jobs-search-pagination__button--next');
  if (nextButton && !nextButton.disabled) {
    console.log('Auto Job Apply: No more jobs on this page. Clicking Next Page...');
    nextButton.click();
    await wait(5000);
    return true;
  }

  return false;
}

function findEasyApplyButton() {
  // Most reliable: LinkedIn always uses this specific ID for the Easy Apply button
  const byId = document.getElementById('jobs-apply-button-id');
  if (byId && byId.offsetParent !== null) {
    const text = (byId.innerText || byId.getAttribute('aria-label') || '').toLowerCase();
    if (text.includes('easy apply')) {
      console.log('ApplyNinja: Found Easy Apply button by ID');
      return byId;
    }
  }

  // Fallback: aria-label contains "Easy Apply"
  const byAriaLabel = document.querySelector('button[aria-label*="Easy Apply"]');
  if (byAriaLabel && byAriaLabel.offsetParent !== null) {
    console.log('ApplyNinja: Found Easy Apply button by aria-label');
    return byAriaLabel;
  }

  // Fallback: data-live-test attribute LinkedIn uses on apply buttons
  const byDataAttr = document.querySelector('button[data-live-test-job-apply-button]');
  if (byDataAttr && byDataAttr.offsetParent !== null) {
    const text = (byDataAttr.innerText || '').toLowerCase();
    if (text.includes('easy apply')) {
      console.log('ApplyNinja: Found Easy Apply button by data attribute');
      return byDataAttr;
    }
  }

  // Fallback: scan all buttons for "Easy Apply" text in the detail pane
  const detailPanes = ['.jobs-details__main-content', '.jobs-search__job-details--wrapper', '.scaffold-layout__detail', '.jobs-details'];

  for (const paneSelector of detailPanes) {
    const pane = document.querySelector(paneSelector);
    if (!pane) continue;
    for (const btn of Array.from(pane.querySelectorAll('button'))) {
      if (btn.offsetParent === null) continue;
      const text = (btn.innerText || btn.getAttribute('aria-label') || '').toLowerCase();
      if (text.includes('easy apply') && !text.includes('applied')) {
        console.log(`ApplyNinja: Found Easy Apply button in ${paneSelector}`);
        return btn;
      }
    }
  }

  console.log('ApplyNinja: No Easy Apply button found');
  return null;
}

async function handleModal() {
  console.log('Auto Job Apply: Waiting for modal...');
  let modal = null;
  // Increase wait attempts and add more selectors
  for (let i = 0; i < 15; i++) {
    modal = document.querySelector('.jobs-easy-apply-modal') || document.querySelector('[role="dialog"]') || document.querySelector('.artdeco-modal') || document.querySelector('[data-test-modal]') || document.querySelector('.jobs-easy-apply-content');
    if (modal && modal.offsetParent !== null) {
      console.log(`Auto Job Apply: Modal found after ${i + 1} attempts`);
      break;
    }
    await wait(800);
  }

  if (!modal) {
    console.log('Auto Job Apply: Modal not found after waiting. Checking if application already submitted...');
    // Sometimes LinkedIn auto-submits if profile is complete
    await wait(2000);
    if (isCurrentJobAlreadyApplied()) {
      console.log('Auto Job Apply: Job appears to be applied. Marking as processed.');
      await markCurrentJobAsProcessed();
      const titleEl = document.querySelector('.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1.t-24');
      const companyEl = document.querySelector('.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, .jobs-details-top-card__company-url');
      const jobTitle = titleEl?.innerText?.trim() || '';
      const jobCompany = companyEl?.innerText?.trim() || '';
      const jobId = getCurrentJobIdFromUrl();
      await recordApplication(jobId, jobTitle, jobCompany);
    } else {
      console.log('Auto Job Apply: Modal not found and job not applied. Marking as processed and continuing.');
      await markCurrentJobAsProcessed();
    }
    await wait(2000);
    isProcessRunning = false;
    startProcess();
    return;
  }

  console.log('Auto Job Apply: Modal found, handling steps...');

  let lastStepHtml = '';
  let stuckCount = 0;

  while (isAutoApplying) {
    // Check if we are stuck on the same step
    const currentHtml = modal.innerHTML;
    if (currentHtml === lastStepHtml) {
      stuckCount++;
      console.log(`Auto Job Apply: Potential stuck detected (${stuckCount}/8)...`);
      // Try scrolling the modal to reveal hidden buttons
      modal.scrollTop = modal.scrollHeight;
      const footer = document.querySelector('.jobs-easy-apply-modal footer, .artdeco-modal__actionbar');
      if (footer) footer.scrollIntoView({ block: 'end' });
      if (stuckCount >= 8) {
        console.log('Auto Job Apply: Maximum stuck count reached. Closing modal and skipping job.');
        closeModal();
        await markCurrentJobAsProcessed();
        await wait(2000);
        isProcessRunning = false;
        startProcess();
        return;
      }
    } else {
      stuckCount = 0;
    }
    lastStepHtml = currentHtml;

    await fillVisibleFields(modal);
    await wait(1500); // Slightly longer wait for field population

    // Search for navigation buttons both inside modal and in document footer
    // LinkedIn sometimes renders the footer buttons outside the modal content div
    const allButtons = [...Array.from(modal.querySelectorAll('button')), ...Array.from(document.querySelectorAll('.jobs-easy-apply-modal button, .artdeco-modal__actionbar button, footer button'))];

    const submitButton =
      allButtons.find((b) => {
        const t = (b.innerText || b.getAttribute('aria-label') || '').toLowerCase().trim();
        return t === 'submit application' || t === 'submit';
      }) || modal.querySelector('button[aria-label*="Submit"]');

    const nextButton =
      allButtons.find((b) => {
        const t = (b.innerText || b.getAttribute('aria-label') || '').toLowerCase().trim();
        return t === 'next' || t === 'continue' || t === 'review' || t === 'next step' || t.includes('next step') || t.includes('continue to') || t.includes('review your');
      }) ||
      modal.querySelector('button[aria-label*="next" i]') ||
      modal.querySelector('button[aria-label*="Continue" i]') ||
      modal.querySelector('button[aria-label*="Review" i]');

    if (submitButton) {
      console.log('Auto Job Apply: Submitting application!');

      // Capture job details before submitting
      const titleEl = document.querySelector('.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1.t-24');
      const companyEl = document.querySelector('.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, .jobs-details-top-card__company-url');
      const jobTitle = titleEl?.innerText?.trim() || '';
      const jobCompany = companyEl?.innerText?.trim() || '';
      const jobId = getCurrentJobIdFromUrl();

      submitButton.click();

      await wait(5000); // Wait longer for success state

      // Check for success message or "Done" button
      const doneButton = modal.querySelector('button[aria-label*="Done"]') || Array.from(modal.querySelectorAll('button')).find((b) => b.innerText.toLowerCase().includes('done'));

      if (doneButton) {
        console.log('Auto Job Apply: Application successful! Clicking Done.');
        doneButton.click();
        await wait(3000);
      } else {
        console.log('Auto Job Apply: Submission complete, closing modal.');
        closeModal();
        await wait(3000);
      }

      await markCurrentJobAsProcessed();
      await recordApplication(jobId, jobTitle, jobCompany);
      await wait(delayBetweenApps); // configurable delay between applications
      isProcessRunning = false;
      startProcess();
      return; // Exit handleModal
    } else if (nextButton) {
      console.log('Auto Job Apply: Clicking Next/Continue...');
      nextButton.click();
      await wait(3000); // Wait for next step to load
    } else {
      console.log('Auto Job Apply: No navigation buttons found. Skipping this job.');
      closeModal();
      await markCurrentJobAsProcessed();
      await wait(2000);
      isProcessRunning = false;
      startProcess();
      return;
    }
  }
}

// Personal profile — loaded from chrome.storage, with hardcoded fallbacks
const PROFILE = {
  email: 'jobinjohn664@gmail.com',
  phone: '9188540531',
  firstName: 'Jobin',
  lastName: 'John',
  fullName: 'Jobin John',
  city: 'Alappuzha',
  state: 'Kerala',
  country: 'India',
  pincode: '688506',
  zipcode: '688506',
  linkedIn: 'https://www.linkedin.com/in/jobin-john',
  website: 'https://debugdin-dino.netlify.app/',
  totalYearsOfExperience: '4',
  totalMonthsOfExperience: '0',
  noticePeriodDays: '60',
  noticePeriodMonths: '2',
  noticePeriodText: '60 days',
  currentCTC: '3.6',
  expectedCTC: '10',
  currentSalary: '360000',
  expectedSalary: '1000000',
  willingToRelocate: true,
  skills: '',
  highestEducation: 'bachelor',
};

// Sync PROFILE from storage whenever it changes
function syncProfileFromStorage(stored) {
  if (!stored) return;
  if (stored.firstName) {
    PROFILE.firstName = stored.firstName;
    PROFILE.fullName = `${stored.firstName} ${stored.lastName || PROFILE.lastName}`;
  }
  if (stored.lastName) {
    PROFILE.lastName = stored.lastName;
    PROFILE.fullName = `${PROFILE.firstName} ${stored.lastName}`;
  }
  if (stored.phone) PROFILE.phone = stored.phone;
  if (stored.city) PROFILE.city = stored.city;
  if (stored.state) PROFILE.state = stored.state;
  if (stored.country) PROFILE.country = stored.country;
  if (stored.pincode) {
    PROFILE.pincode = stored.pincode;
    PROFILE.zipcode = stored.pincode;
  }
  if (stored.linkedIn) PROFILE.linkedIn = stored.linkedIn;
  if (stored.website) PROFILE.website = stored.website;
  if (stored.totalExp) PROFILE.totalYearsOfExperience = stored.totalExp;
  if (stored.totalExpMonths !== undefined) PROFILE.totalMonthsOfExperience = stored.totalExpMonths;
  if (stored.noticeDays) {
    PROFILE.noticePeriodDays = stored.noticeDays;
    PROFILE.noticePeriodMonths = String(Math.round(Number(stored.noticeDays) / 30));
    PROFILE.noticePeriodText = `${stored.noticeDays} days`;
  }
  if (stored.currentCTC) {
    PROFILE.currentCTC = stored.currentCTC;
    PROFILE.currentSalary = String(Math.round(Number(stored.currentCTC) * 100000));
  }
  if (stored.expectedCTC) {
    PROFILE.expectedCTC = stored.expectedCTC;
    PROFILE.expectedSalary = String(Math.round(Number(stored.expectedCTC) * 100000));
  }
  if (stored.willingToRelocate !== undefined) PROFILE.willingToRelocate = stored.willingToRelocate;
  if (stored.skills !== undefined) PROFILE.skills = stored.skills;
  if (stored.highestEducation !== undefined) PROFILE.highestEducation = stored.highestEducation;
  // Dynamically update SKILL_EXPERIENCE from profile skills list
  if (stored.skills) {
    const totalYears = parseInt(stored.totalExp) || 4;
    stored.skills
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .forEach((skill) => {
        // Only override if not already set or set to 0
        if (!SKILL_EXPERIENCE[skill] || SKILL_EXPERIENCE[skill] === 0) {
          SKILL_EXPERIENCE[skill] = totalYears;
        }
      });
    // Special case: db-related skills use totalExp as well
    const dbSkills = ['postgresql', 'postgres', 'mysql', 'mongodb', 'sql', 'database', 'databases', 'relational database', 'relational databases'];
    dbSkills.forEach((s) => {
      if (stored.skills.toLowerCase().includes(s)) {
        SKILL_EXPERIENCE[s] = totalYears;
        SKILL_EXPERIENCE['database'] = totalYears;
        SKILL_EXPERIENCE['databases'] = totalYears;
        SKILL_EXPERIENCE['relational database'] = totalYears;
        SKILL_EXPERIENCE['relational databases'] = totalYears;
      }
    });
  }
}

// Load profile + settings from storage on init
chrome.storage.local.get(['profile', 'settings'], (result) => {
  syncProfileFromStorage(result.profile);
  if (result.settings?.delayBetweenApps) delayBetweenApps = result.settings.delayBetweenApps * 1000;
});

// Keep in sync if user updates profile while running
chrome.storage.onChanged.addListener((changes) => {
  if (changes.profile?.newValue) syncProfileFromStorage(changes.profile.newValue);
  if (changes.settings?.newValue?.delayBetweenApps) delayBetweenApps = changes.settings.newValue.delayBetweenApps * 1000;
});

// Skills with years of experience — only fill non-zero for skills you actually have
const SKILL_EXPERIENCE = {
  vue: 4,
  'vue.js': 4,
  vuejs: 4,
  node: 4,
  'node.js': 4,
  nodejs: 4,
  javascript: 4,
  js: 4,
  html: 4,
  css: 4,
  tailwind: 4,
  'tailwind css': 4,
  pinia: 3,
  vuex: 3,
  postgresql: 3,
  postgres: 3,
  sql: 3,
  restful: 4,
  'rest api': 4,
  api: 4,
  git: 4,
  vite: 3,
  jwt: 3,
  'react native': 2,
  'react-native': 2,
  react: 2,
  'react.js': 2,
  reactjs: 2,
  redux: 1,
  openai: 1,
  typescript: 0,
  ts: 0,
  angular: 0,
  python: 0,
  java: 0,
  php: 0,
  laravel: 0,
  django: 0,
  flutter: 0,
  swift: 0,
  kotlin: 0,
  aws: 1,
  docker: 0,
  kubernetes: 0,
  'machine learning': 0,
  'ml ': 0,
  'deep learning': 0,
  'artificial intelligence': 0,
  ' ai ': 0,
  tensorflow: 0,
  pytorch: 0,
  'large language model': 0,
  'large language models': 0,
  llm: 0,
  'retrieval-augmented generation': 0,
  rag: 0,
  'generative ai': 0,
  'agentic ai': 0,
  openai: 1,
  'data analysis': 0,
  tableau: 0,
  'power bi': 0,
  hadoop: 0,
  spark: 0,
  kafka: 0,
  redis: 0,
  elasticsearch: 0,
  playwright: 0,
  cypress: 0,
  selenium: 0,
  jenkins: 0,
  terraform: 0,
  ansible: 0,
  'c++': 0,
  'c#': 0,
  golang: 0,
  ruby: 0,
  scala: 0,
  '.net': 0,
  'ci/cd': 0,
  'ci cd': 0,
  'github actions': 0,
  'aws codepipeline': 0,
  'aws certification': 0,
  'aws certified': 0,
  zustand: 1,
  'ai/ml': 0,
  'ai ml': 0,
  chatbot: 0,
  jest: 0,
  'react testing': 0,
  'testing library': 0,
  'testing framework': 0,
};

function getSkillExperience(text) {
  const lower = text.toLowerCase();
  // Check longest match first to avoid 'js' matching 'node.js' wrong
  const sorted = Object.keys(SKILL_EXPERIENCE).sort((a, b) => b.length - a.length);
  for (const skill of sorted) {
    if (lower.includes(skill)) {
      return SKILL_EXPERIENCE[skill];
    }
  }
  return null; // unknown skill — don't fill
}

async function fillVisibleFields(container) {
  console.log('Auto Job Apply: Filling visible fields...');

  // Load stored data first
  const data = await new Promise((resolve) => {
    chrome.storage.local.get(['user', 'resume', 'templates'], resolve);
  });

  const email = data?.user?.email || PROFILE.email;
  const inputs = container.querySelectorAll('input, textarea, select');
  const coverLetter = buildCoverLetter(PROFILE, data.templates || TEMPLATES, data?.resume?.summary || '');

  inputs.forEach((input) => {
    const labelEl = input.closest('.fb-dash-form-element')?.querySelector('label') || input.closest('.jobs-easy-apply-form-element')?.querySelector('label') || container.querySelector(`label[for="${input.id}"]`);

    // Also grab any nearby paragraph/span text that acts as a label (LinkedIn custom forms)
    const parentText = (input.closest('div[class]')?.querySelector('p, span, legend, h3')?.innerText || '').toLowerCase();

    const labelText = (labelEl?.innerText || input.getAttribute('aria-label') || input.previousElementSibling?.innerText || '').toLowerCase();
    const placeholder = (input.placeholder || '').toLowerCase();
    const combined = labelText + ' ' + placeholder + ' ' + parentText;

    // Skip already-filled non-toggle inputs (but not selects stuck on placeholder)
    const isSelectPlaceholder = input.tagName === 'SELECT' && (!input.value || input.value === '' || input.options[input.selectedIndex]?.text?.toLowerCase().includes('select an option') || input.options[input.selectedIndex]?.text?.toLowerCase().includes('select'));
    if (input.type === 'file') return; // never touch file inputs
    if (input.value && input.value !== '' && input.type !== 'radio' && input.type !== 'checkbox' && !isSelectPlaceholder) return;

    console.log(`Auto Job Apply: Field: "${combined.trim()}" (Type: ${input.type})`);

    if (input.type === 'radio' || input.type === 'checkbox') {
      const fieldset = input.closest('fieldset');
      const fieldsetName = (fieldset?.querySelector('legend')?.innerText || input.closest('div[class]')?.querySelector('p, span[class], h3, label')?.innerText || '').toLowerCase();
      const context = fieldsetName + ' ' + combined;

      // Work authorization / visa sponsorship
      if (context.includes('authorized') || context.includes('work authorization') || context.includes('legally')) {
        if (labelText.includes('yes')) input.click();
      } else if (context.includes('sponsorship') || (context.includes('require') && context.includes('visa'))) {
        if (labelText.includes('no')) input.click();
      }
      // Notice period checkbox/radio group — pick the option closest to profile notice period
      else if (context.includes('notice period') || context.includes('notice')) {
        const noticeDays = parseInt(PROFILE.noticePeriodDays) || 60;
        // Map label text to approximate days
        const labelLower = labelText.toLowerCase();
        let optionDays = null;
        if (labelLower.includes('immediate') || labelLower.includes('0')) optionDays = 0;
        else if (labelLower.includes('1') && labelLower.includes('week')) optionDays = 7;
        else if (labelLower.includes('2') && labelLower.includes('week')) optionDays = 14;
        else if (labelLower.includes('3') && labelLower.includes('week')) optionDays = 21;
        else if (labelLower.includes('4') && labelLower.includes('week')) optionDays = 28;
        else if (labelLower.includes('1') && labelLower.includes('month')) optionDays = 30;
        else if (labelLower.includes('2') && labelLower.includes('month')) optionDays = 60;
        else if (labelLower.includes('3') && labelLower.includes('month')) optionDays = 90;
        else if (labelLower.includes('6') && labelLower.includes('month')) optionDays = 180;
        else {
          const nums = labelLower.match(/\d+/g);
          if (nums) optionDays = Math.min(...nums.map(Number));
        }

        if (optionDays !== null) {
          // For checkbox groups, only click the best match (not all)
          // Use a group key to ensure only one option is selected
          const groupName = input.name || fieldsetName;
          const groupKey = `notice_group_${groupName}`;
          if (!window[groupKey]) {
            // Find the best option in the group
            const groupInputs = Array.from(fieldset?.querySelectorAll('input[type="checkbox"], input[type="radio"]') || [input]);
            let bestInput = null;
            let bestDiff = Infinity;
            groupInputs.forEach((gi) => {
              const gl = (gi.closest('label')?.innerText || gi.nextElementSibling?.innerText || document.querySelector(`label[for="${gi.id}"]`)?.innerText || '').toLowerCase();
              let gDays = null;
              if (gl.includes('immediate') || gl.includes('0')) gDays = 0;
              else if (gl.includes('1') && gl.includes('week')) gDays = 7;
              else if (gl.includes('2') && gl.includes('week')) gDays = 14;
              else if (gl.includes('3') && gl.includes('week')) gDays = 21;
              else if (gl.includes('4') && gl.includes('week')) gDays = 28;
              else if (gl.includes('1') && gl.includes('month')) gDays = 30;
              else if (gl.includes('2') && gl.includes('month')) gDays = 60;
              else if (gl.includes('3') && gl.includes('month')) gDays = 90;
              else if (gl.includes('6') && gl.includes('month')) gDays = 180;
              else {
                const n = gl.match(/\d+/g);
                if (n) gDays = Math.min(...n.map(Number));
              }
              if (gDays !== null && Math.abs(gDays - noticeDays) < bestDiff) {
                bestDiff = Math.abs(gDays - noticeDays);
                bestInput = gi;
              }
            });
            if (bestInput) {
              console.log(`ApplyNinja: Selecting notice period: "${bestInput.nextElementSibling?.innerText?.trim() || bestInput.id}"`);
              bestInput.click();
              window[groupKey] = true;
            }
          }
        }
      }
      // Experience / years radio group — skill-aware, picks closest to actual experience
      else if (context.includes('experience') || context.includes('years') || context.includes('how many') || context.includes('information technology')) {
        if (input.type === 'radio') {
          const groupName = input.name;
          const groupKey = `processed_group_${groupName}`;
          if (window[groupKey]) return;

          const skillExp = getSkillExperience(context);
          const targetYears = skillExp !== null ? skillExp : 4;

          const groupButtons = Array.from(container.querySelectorAll(`input[name="${groupName}"]`));
          let bestButton = null;
          let bestDiff = Infinity;

          groupButtons.forEach((btn) => {
            const btnLabel = (btn.closest('label')?.innerText || btn.closest('div')?.innerText || btn.nextElementSibling?.innerText || '').toLowerCase();
            // Use the minimum number in the label (e.g. "5-7 years" → 5, "4+" → 4)
            const nums = btnLabel.match(/\d+/g);
            const val = nums ? Math.min(...nums.map(Number)) : 0;
            const diff = Math.abs(val - targetYears);
            if (diff < bestDiff) {
              bestDiff = diff;
              bestButton = btn;
            }
          });

          if (bestButton) {
            console.log(`Auto Job Apply: Selecting experience option (target ${targetYears}y): "${bestButton.closest('label')?.innerText?.trim()}"`);
            bestButton.click();
            window[groupKey] = true;
          }
        }
      }
      // English proficiency
      else if (context.includes('english')) {
        if (labelText.includes('fluent') || labelText.includes('native') || labelText.includes('advanced') || labelText.includes('professional')) {
          input.click();
        }
      }
      // Willing to work on-site / relocate / commute / shifts / WFO
      else if (
        context.includes('relocate') ||
        context.includes('on-site') ||
        context.includes('onsite') ||
        context.includes('in-office') ||
        context.includes('shift') ||
        context.includes('commute') ||
        context.includes('monday to friday') ||
        context.includes('wfo') ||
        context.includes('work from office') ||
        context.includes('comfortable') ||
        context.includes('willing') ||
        context.includes('open to')
      ) {
        const answerYes = context.includes('relocate') || context.includes('commute') || context.includes('comfortable') ? !!PROFILE.willingToRelocate : true;
        if (answerYes && (labelText.includes('yes') || labelText.includes('willing') || labelText.includes('comfortable'))) input.click();
        else if (!answerYes && labelText.includes('no')) input.click();
      }
      // Availability / start date
      else if (context.includes('start date') || context.includes('available') || context.includes('join')) {
        if (labelText.includes('immediately') || labelText.includes('15 days') || labelText.includes('30 days') || labelText.includes('available')) {
          input.click();
        }
      }
      // Education / degree questions
      else if (context.includes('bachelor') || context.includes('degree') || context.includes('education') || context.includes('graduate')) {
        const edu = (PROFILE.highestEducation || 'bachelor').toLowerCase();
        const hasBachelor = edu === 'bachelor' || edu === 'master' || edu === 'phd';
        const hasMaster = edu === 'master' || edu === 'phd';
        const hasPhd = edu === 'phd';
        if (context.includes('phd') || context.includes('doctorate')) {
          if (hasPhd && labelText.includes('yes')) input.click();
          else if (!hasPhd && labelText.includes('no')) input.click();
        } else if (context.includes('master') || context.includes('postgraduate')) {
          if (hasMaster && labelText.includes('yes')) input.click();
          else if (!hasMaster && labelText.includes('no')) input.click();
        } else {
          // bachelor or general degree question
          if (hasBachelor && labelText.includes('yes')) input.click();
          else if (!hasBachelor && labelText.includes('no')) input.click();
        }
      }
      // General yes/no consent, agreements
      else if (context.includes('agree') || context.includes('acknowledge') || context.includes('consent') || context.includes('confirm') || context.includes('privacy') || context.includes('contact') || context.includes('allow') || context.includes('permission')) {
        if (labelText.includes('yes') || labelText.includes('agree') || labelText.includes('i do')) {
          input.click();
        }
      }
      // Catch-all: for any radio group where label is just "Yes", click Yes
      else if (input.type === 'radio' && (labelText.trim() === 'yes' || labelText.trim() === 'i agree' || labelText.trim() === 'i do')) {
        input.click();
      }
    } else if (input.tagName === 'SELECT') {
      const fieldset = input.closest('fieldset') || input.closest('div.jobs-easy-apply-form-section__grouping');
      const groupText = (fieldset?.innerText || '').toLowerCase();
      // Also grab the immediate parent container text for non-fieldset wrappers
      const parentContainerText = (input.parentElement?.innerText || input.closest('div')?.innerText || '').toLowerCase().slice(0, 300);
      const context = groupText + ' ' + combined + ' ' + parentContainerText;

      // --- Yes/No dropdowns take priority over all other matching ---
      const _opts = Array.from(input.options);
      const _yesOpt = _opts.find((o) => o.text.toLowerCase() === 'yes');
      const _noOpt = _opts.find((o) => o.text.toLowerCase() === 'no');
      if (_yesOpt && _noOpt) {
        const answer = shouldAnswerYes(combined);
        const chosen = answer ? _yesOpt : _noOpt;
        // Set by index for reliability (React listens to selectedIndex changes too)
        input.selectedIndex = _opts.indexOf(chosen);
        setValue(input, chosen.value);
      } else if (context.includes('relocat') || combined.includes('relocat')) {
        // "Ready to relocate?" — find Yes/No or similar options
        const answer = PROFILE.willingToRelocate;
        const yesOpt = _opts.find((o) => /^yes$/i.test(o.text.trim())) || _opts.find((o) => /willing|open|ready|yes/i.test(o.text));
        const noOpt = _opts.find((o) => /^no$/i.test(o.text.trim())) || _opts.find((o) => /not willing|not open|no/i.test(o.text));
        const picked = answer ? yesOpt : noOpt;
        if (picked) setValue(input, picked.value);
        else if (_opts.length > 1) setValue(input, _opts[answer ? 1 : _opts.length - 1].value);
      } else if (combined.includes('english') || combined.includes('language proficiency') || combined.includes('level of english')) {
        // Pick fluent/native/advanced/professional
        const profOpt = _opts.find((o) => /native|fluent/i.test(o.text)) || _opts.find((o) => /advanced|professional|c1|c2|b2/i.test(o.text)) || _opts.find((o) => o.value && !o.disabled && o.value !== '');
        if (profOpt) setValue(input, profOpt.value);
      } else if (context.includes('country')) {
        const indiaOption = Array.from(input.options).find((o) => o.text.toLowerCase().includes('india'));
        if (indiaOption) setValue(input, indiaOption.value);
      } else if (context.includes('state') || context.includes('province')) {
        const keralaOption = Array.from(input.options).find((o) => o.text.toLowerCase().includes('kerala'));
        if (keralaOption) setValue(input, keralaOption.value);
      } else if (context.includes('notice') || context.includes('joining')) {
        // Look for 60 days / 2 months option; fallback to closest available
        const noticeOption =
          Array.from(input.options).find((o) => {
            const t = o.text.toLowerCase();
            return t.includes('60') || t.includes('2 month') || t.includes('two month');
          }) ||
          Array.from(input.options).find((o) => {
            const t = o.text.toLowerCase();
            return t.includes('30') || t.includes('1 month') || t.includes('one month');
          }) ||
          Array.from(input.options).find((o) => o.value && !o.disabled && o.value !== '');
        if (noticeOption) setValue(input, noticeOption.value);
      } else if (combined.includes('additional months') || combined.includes('months of experience') || (combined.includes('month') && combined.includes('experience') && !combined.includes('year'))) {
        // "total additional months of experience" — use profile value
        const targetMonths = parseInt(PROFILE.totalMonthsOfExperience) || 0;
        const monthOption = Array.from(input.options).find((o) => parseInt(o.value) === targetMonths || parseInt(o.text) === targetMonths) || Array.from(input.options).find((o) => o.text.trim() === '0' || o.value === '0') || Array.from(input.options).find((o) => o.value && !o.disabled);
        if (monthOption) setValue(input, monthOption.value);
      } else if (combined.includes('total years') || combined.includes('years of experience') || combined.includes('years of professional') || combined.includes('experience') || combined.includes('years') || combined.includes('professional')) {
        // Check if label mentions a specific skill
        const skillExp = getSkillExperience(combined);
        const targetYears = skillExp !== null ? skillExp : parseInt(PROFILE.totalYearsOfExperience) || 4;
        const options = Array.from(input.options).filter((o) => o.value && !o.disabled);
        let best = null;
        let bestDiff = Infinity;
        options.forEach((o) => {
          const nums = o.text.match(/\d+/g);
          if (!nums) return;
          const val = Math.min(...nums.map(Number));
          const diff = Math.abs(val - targetYears);
          if (diff < bestDiff) {
            bestDiff = diff;
            best = o;
          }
        });
        if (best) {
          setValue(input, best.value);
        } else if (input.selectedIndex <= 0 && input.options.length > 1) {
          const first = options.find((o) => o.text.toLowerCase() !== 'select an option');
          if (first) setValue(input, first.value);
          else {
            input.selectedIndex = 1;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      } else if (context.includes('salary') || context.includes('lpa') || context.includes('ctc') || context.includes('compensation')) {
        const validOption = Array.from(input.options).find((o) => o.value && o.value.toLowerCase() !== 'select an option' && !o.disabled);
        if (validOption) setValue(input, validOption.value);
      } else {
        // Generic Yes/No dropdowns — handles "Do you have X experience?" style questions
        const options = Array.from(input.options);
        const yesOpt = options.find((o) => o.text.toLowerCase() === 'yes');
        const noOpt = options.find((o) => o.text.toLowerCase() === 'no');
        const hasYesNo = !!(yesOpt && noOpt);

        if (hasYesNo) {
          // Determine answer based on question content
          const answerYes = shouldAnswerYes(combined);
          setValue(input, answerYes ? yesOpt.value : noOpt.value);
        } else if (input.selectedIndex <= 0 && input.options.length > 1) {
          input.selectedIndex = 1;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    } else {
      // Text / number / textarea inputs
      if (combined.includes('email')) {
        setValue(input, email);
      } else if (combined.includes('phone') || combined.includes('mobile') || combined.includes('contact number')) {
        setValue(input, PROFILE.phone);
      } else if (combined.includes('first name')) {
        setValue(input, PROFILE.firstName);
      } else if (combined.includes('last name') || combined.includes('surname')) {
        setValue(input, PROFILE.lastName);
      } else if (combined.includes('full name') || combined.includes('your name')) {
        setValue(input, PROFILE.fullName);
      } else if (combined.includes('linkedin')) {
        setValue(input, PROFILE.linkedIn);
      } else if (combined.includes('website') || combined.includes('portfolio') || combined.includes('url')) {
        setValue(input, PROFILE.website);
      } else if (combined.includes('pin') || combined.includes('zip') || combined.includes('postal')) {
        setValue(input, PROFILE.pincode);
      } else if (combined.includes('city')) {
        // City fields are often typeahead — type the value and wait for autocomplete suggestion
        typeAndSelectSuggestion(input, PROFILE.city);
      } else if (combined.includes('state') || combined.includes('province')) {
        // Only fill state/province if it's NOT asking about state management libraries
        if (!combined.includes('management') && !combined.includes('library') && !combined.includes('libraries') && !combined.includes('zustand') && !combined.includes('redux') && !combined.includes('vuex') && !combined.includes('pinia')) {
          setValue(input, PROFILE.state);
        } else {
          // It's asking about state management experience — fill years
          const skillExp = getSkillExperience(combined);
          setValue(input, skillExp !== null ? String(skillExp) : '0');
        }
      } else if (combined.includes('country')) {
        setValue(input, PROFILE.country);
      } else if (combined.includes('notice') || combined.includes('serving notice') || combined.includes('joining period') || combined.includes('available from') || combined.includes('availability')) {
        if (combined.includes('month')) {
          setValue(input, PROFILE.noticePeriodMonths);
        } else if (combined.includes('day') || input.type === 'number') {
          setValue(input, PROFILE.noticePeriodDays);
        } else {
          // No unit hint — use days as default (most common format)
          setValue(input, PROFILE.noticePeriodDays);
        }
      } else if (
        combined.includes('current ctc') ||
        combined.includes('current annual ctc') ||
        combined.includes('current annual') ||
        combined.includes('current salary') ||
        combined.includes('current annual salary') ||
        combined.includes('current annual compensation') ||
        combined.includes('current compensation') ||
        combined.includes('current package') ||
        combined.includes('current in-hand') ||
        combined.includes('current in hand') ||
        (combined.includes('current') && combined.includes('in-hand')) ||
        (combined.includes('current') && combined.includes('in hand'))
      ) {
        const wantsLPA = combined.includes('lpa') || combined.includes('lakhs') || combined.includes('lac');
        setValue(input, wantsLPA ? PROFILE.currentCTC : PROFILE.currentSalary);
      } else if (
        combined.includes('expected ctc') ||
        combined.includes('expected annual ctc') ||
        combined.includes('expected salary') ||
        combined.includes('expected annual salary') ||
        combined.includes('expected annual compensation') ||
        combined.includes('desired salary') ||
        combined.includes('expected compensation') ||
        combined.includes('expected package') ||
        combined.includes('expected in-hand') ||
        combined.includes('expected in hand') ||
        (combined.includes('expected') && combined.includes('in-hand')) ||
        (combined.includes('expected') && combined.includes('in hand'))
      ) {
        const wantsLPA = combined.includes('lpa') || combined.includes('lakhs') || combined.includes('lac');
        setValue(input, wantsLPA ? PROFILE.expectedCTC : PROFILE.expectedSalary);
      } else if (combined.includes('location') || combined.includes('address')) {
        setValue(input, `${PROFILE.city}, ${PROFILE.state}, ${PROFILE.country}`);
      } else if (
        input.tagName === 'TEXTAREA' ||
        (input.type !== 'number' &&
          (combined.includes('summary') ||
            combined.includes('cover') ||
            combined.includes('about yourself') ||
            combined.includes('cover letter') ||
            combined.includes('why do you want') ||
            combined.includes('why would you like') ||
            combined.includes('what did you do') ||
            combined.includes('last professional') ||
            combined.includes('previous experience') ||
            combined.includes('what could you bring') ||
            combined.includes('describe') ||
            combined.includes('tell us') ||
            combined.includes('motivation') ||
            combined.includes('introduce'))) ||
        // Only use cover letter for "relevant" if it's a textarea, not a number input
        (input.tagName === 'TEXTAREA' && combined.includes('relevant'))
      ) {
        setValue(input, coverLetter);
      } else if (
        combined.includes('rate yourself') ||
        combined.includes('rating') ||
        combined.includes('rate your') ||
        combined.includes('scale of') ||
        combined.includes('out of 10') ||
        combined.includes('out of 5') ||
        (input.type === 'number' && (combined.includes('problem') || combined.includes('solving') || combined.includes('skill') || combined.includes('proficiency')))
      ) {
        // "How would you rate yourself in X?" — give a skill-aware rating out of 10
        const skillExp = getSkillExperience(combined);
        let rating;
        if (skillExp !== null) {
          // Map years of experience to a rating out of 10
          if (skillExp >= 4) rating = 8;
          else if (skillExp === 3) rating = 7;
          else if (skillExp === 2) rating = 6;
          else if (skillExp === 1) rating = 5;
          else rating = 3; // 0 years — honest low rating but above 0.0 minimum
        } else {
          rating = 7; // default for unknown skills
        }
        // Check if field expects out of 5
        const outOf5 = combined.includes('out of 5') || combined.includes('/5') || (input.max && Number(input.max) <= 5);
        setValue(input, outOf5 ? String(Math.round(rating / 2)) : String(rating) + '.0');
      } else if (combined.includes('experience') || combined.includes('years') || combined.includes('how many') || combined.includes('relevant') || combined.includes('expertise')) {
        // Fill years of experience — skill-aware
        const skillExp = getSkillExperience(combined);
        if (skillExp !== null) {
          // Known skill — use its specific experience value (could be 0)
          setValue(input, String(skillExp));
        } else if (combined.includes('total') || combined.includes('overall') || combined.includes('professional') || combined.includes('work experience') || combined.includes('years of experience') || combined.includes('how many years')) {
          // General total experience question
          setValue(input, PROFILE.totalYearsOfExperience);
        } else {
          // Unknown specific skill — default to 0, not total years
          setValue(input, '0');
        }
      }
    }
  });
}

/**
 * Decide Yes/No for question-style dropdowns based on actual skills/profile.
 * Returns true for Yes, false for No.
 */
function shouldAnswerYes(text) {
  const t = text.toLowerCase();

  // Skills we DON'T have — answer No
  const noSkills = [
    'typescript',
    ' ts ',
    'angular',
    'python',
    'java ',
    'php',
    'laravel',
    'django',
    'flutter',
    'swift',
    'kotlin',
    'kubernetes',
    'docker',
    'mongodb',
    'mongo db',
    'ruby',
    '.net',
    'c#',
    'c++',
    'golang',
    'scala',
    'spring',
    'hibernate',
    'aws lambda',
    'graphql',
    'playwright',
    'cypress',
    'selenium',
    'jest',
    'testing',
    'qa ',
    'quality assurance',
    'automation testing',
    'machine learning',
    'deep learning',
    'artificial intelligence',
    'tensorflow',
    'pytorch',
    'data science',
    'ci/cd',
    'github actions',
    'aws certification',
    'aws certified',
    'chatbot',
    'zustand',
    'containerization',
    'jenkins',
    'terraform',
    'ansible',
    'ai/ml',
    'ai ml',
  ];
  for (const skill of noSkills) {
    if (t.includes(skill)) return false;
  }

  // Skills we DO have — answer Yes
  const yesSkills = [
    'vue',
    'node',
    'javascript',
    'react native',
    'react',
    'postgresql',
    'postgres',
    'restful',
    'rest api',
    'tailwind',
    'pinia',
    'vuex',
    'git',
    'html',
    'css',
    'vite',
    'jwt',
    'openai',
    'full stack',
    'fullstack',
    'frontend',
    'front-end',
    'backend',
    'back-end',
    'web development',
    'api',
    'sql',
  ];
  for (const skill of yesSkills) {
    if (t.includes(skill)) return true;
  }

  // Experience threshold questions — various phrasings
  // "do you have X+ years", "more than X years", "at least X years", "X years of experience"
  const expMatch = t.match(/more\s+than\s+(\d+)\s*years?/) || t.match(/at\s+least\s+(\d+)\s*years?/) || t.match(/(\d+)\+\s*years?/) || t.match(/(\d+)\s*\+?\s*years?\s+of\s+(?:total\s+)?experience/) || t.match(/experience\s+(?:of\s+)?(?:more\s+than\s+)?(\d+)\s*\+?\s*years?/);
  if (expMatch) {
    const required = parseInt(expMatch[1]);
    const have = parseInt(PROFILE.totalYearsOfExperience) || 4;
    return have >= required;
  }

  // Join/availability within X days — compare against notice period
  const joinMatch = t.match(/(?:join|start|available|joining|onboard)\s+(?:within|in)\s+(\d+)\s*days?/) || t.match(/within\s+(\d+)\s*days?/) || t.match(/(\d+)\s*days?\s+(?:notice|joining)/);
  if (joinMatch) {
    const requiredDays = parseInt(joinMatch[1]);
    const noticeDays = parseInt(PROFILE.noticePeriodDays) || 60;
    return noticeDays <= requiredDays;
  }

  // Workplace / logistics
  if (
    t.includes('relocat') ||
    t.includes('on-site') ||
    t.includes('onsite') ||
    t.includes('in-office') ||
    t.includes('wfo') ||
    t.includes('work from office') ||
    t.includes('commute') ||
    t.includes('shift') ||
    t.includes('travel') ||
    t.includes('background check') ||
    t.includes('authorized') ||
    t.includes('eligible') ||
    t.includes('legally') ||
    t.includes('startup') ||
    t.includes('scale-up') ||
    t.includes('open to') ||
    t.includes('comfortable') ||
    t.includes('willing') ||
    t.includes('agree') ||
    t.includes('acknowledge') ||
    t.includes('consent')
  ) {
    // Relocation specifically uses the profile setting
    if (t.includes('relocat')) return !!PROFILE.willingToRelocate;
    return true;
  }

  // Education / degree
  if (t.includes('bachelor') || t.includes('degree') || (t.includes('education') && (t.includes('level') || t.includes('completed')))) {
    const edu = (PROFILE.highestEducation || 'bachelor').toLowerCase();
    if (t.includes('phd') || t.includes('doctorate')) return edu === 'phd';
    if (t.includes('master') || t.includes('postgraduate')) return edu === 'master' || edu === 'phd';
    return edu === 'bachelor' || edu === 'master' || edu === 'phd';
  }

  // Default: Yes (safe for most unknown questions)
  return true;
}

function setValue(input, value) {
  if (!value) return;
  if (input.type === 'file') return; // never touch file inputs
  console.log(`Auto Job Apply: Setting value "${value}" on:`, input);

  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;

  if (input.tagName === 'INPUT' && nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value);
  } else if (input.tagName === 'TEXTAREA' && nativeTextAreaValueSetter) {
    nativeTextAreaValueSetter.call(input, value);
  } else if (input.tagName === 'SELECT') {
    // For selects: set by value AND by finding the matching option index
    const optIndex = Array.from(input.options).findIndex((o) => o.value === value || o.text === value);
    if (optIndex >= 0) input.selectedIndex = optIndex;
    if (nativeSelectValueSetter) nativeSelectValueSetter.call(input, value);
    else input.value = value;
  } else {
    input.value = value;
  }

  // Fire full event sequence React/Ember expects
  input.dispatchEvent(new Event('focus', { bubbles: true }));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
}

// For typeahead/autocomplete fields (like city): type the value, wait for suggestions, click first one
async function typeAndSelectSuggestion(input, value, isFallback = false) {
  if (!value) return;
  input.focus();
  input.click();
  await wait(300);

  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (nativeSetter) nativeSetter.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(150);

  for (const char of value) {
    if (nativeSetter) nativeSetter.call(input, input.value + char);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    await wait(60);
  }
  input.dispatchEvent(new Event('change', { bubbles: true }));

  await wait(1200);

  // Find all suggestions and click the one that best matches the city name
  const allSuggestions = Array.from(document.querySelectorAll('[role="option"], [role="listbox"] li, .basic-typeahead__selectable, ul[role="listbox"] > li'));

  if (allSuggestions.length > 0) {
    const valueLower = value.toLowerCase();
    // Prefer exact city name match at start of suggestion text
    const best = allSuggestions.find((s) => s.innerText?.toLowerCase().startsWith(valueLower)) || allSuggestions[0];
    console.log('ApplyNinja: Clicking suggestion:', best.innerText?.trim());
    best.click();
    await wait(300);
  } else if (!isFallback) {
    console.log('ApplyNinja: No suggestion found, retrying with Bengaluru...');
    await typeAndSelectSuggestion(input, 'Bengaluru', true);
  } else {
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }
}

function closeModal() {
  const closeButtons = ['button[aria-label*="Dismiss"]', 'button[aria-label*="Close"]', '.artdeco-modal__dismiss', '[data-test-modal-close-btn]'];

  for (const selector of closeButtons) {
    const btn = document.querySelector(selector);
    if (btn) {
      console.log('Auto Job Apply: Closing modal.');
      btn.click();
      // Handle the "Save this application?" confirmation dialog that LinkedIn shows
      setTimeout(() => handleSaveDiscardDialog(), 1500);
      return;
    }
  }
}

function handleSaveDiscardDialog() {
  // LinkedIn shows "Save this application?" with Save / Discard buttons
  const allButtons = Array.from(document.querySelectorAll('button'));
  const discardBtn = allButtons.find((b) => {
    const t = (b.innerText || b.textContent || '').trim().toLowerCase();
    return t === 'discard' || t === 'discard application';
  });
  if (discardBtn) {
    console.log('Auto Job Apply: Clicking Discard on save dialog.');
    discardBtn.click();
  }
}

function getKeywords() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['resume'], (result) => {
      resolve(result.resume?.keywords || '');
    });
  });
}

function getJobLocation() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['resume'], (result) => {
      resolve(result.resume?.jobLocation || 'India');
    });
  });
}

function goToJobsPage(keywords, location) {
  const loc = location || 'India';
  const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(loc)}&f_AL=true`;
  window.location.href = searchUrl;
}

async function initiateSearch(keywords) {
  console.log('Auto Job Apply: initiateSearch triggering for:', keywords);
  const searchInputSelectors = [
    'input.search-global-typeahead__input', // Global LinkedIn search
    'input.jobs-search-box__text-input',
    'input[aria-label="Search by title, skill, or company"]',
    'input[name="keywords"]',
    '.jobs-search-box__input--keyword input',
  ];

  let searchInput = null;
  for (const selector of searchInputSelectors) {
    searchInput = document.querySelector(selector);
    if (searchInput) {
      console.log(`Auto Job Apply: Found search input via "${selector}"`);
      break;
    }
  }

  if (searchInput) {
    searchInput.focus();
    searchInput.click();
    await wait(800);

    setValue(searchInput, keywords);
    await wait(1000);

    // Find search button
    const searchButtonSelectors = ['button.jobs-search-box__submit-button', '.jobs-search-box__submit-button', 'button[type="submit"]', '.search-global-typeahead__button', 'button[aria-label="Search"]'];

    let searchButton = null;
    for (const selector of searchButtonSelectors) {
      searchButton = document.querySelector(selector);
      if (searchButton) {
        console.log(`Auto Job Apply: Found search button via "${selector}"`);
        break;
      }
    }

    if (searchButton) {
      console.log('Auto Job Apply: Clicking search button.');
      searchButton.click();
      return true;
    }

    console.log('Auto Job Apply: Search button not found. Using Enter key fallback on:', searchInput);
    const enterDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
    const enterUp = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
    searchInput.dispatchEvent(enterDown);
    searchInput.dispatchEvent(enterUp);

    return true;
  }

  console.error('Auto Job Apply: Could not find any search input field.');
  return false;
}

async function attemptLogin() {
  const data = await new Promise((resolve) => chrome.storage.local.get(['user'], resolve));
  const email = data?.user?.email;
  const password = data?.user?.password;

  if (!email || !password) {
    console.warn('Auto Job Apply: No credentials stored. Cannot auto-login.');
    return false;
  }

  // Handle "Welcome back" account picker — click the saved account card (div[role="button"] with profile image)
  if (document.body.innerText.includes('Welcome back')) {
    console.log('Auto Job Apply: "Welcome back" detected. Clicking account card...');
    const accountCardBtn = Array.from(document.querySelectorAll('div[role="button"][tabindex="0"]')).find((el) => {
      return el.querySelector('img[src*="licdn.com"]') || el.querySelector('figure');
    });
    if (accountCardBtn) {
      accountCardBtn.click();
      return true;
    }
    // Fallback: "Sign in using another account" link
    const signInOtherLink = Array.from(document.querySelectorAll('a')).find((a) => (a.innerText || '').toLowerCase().includes('sign in using another account'));
    if (signInOtherLink) {
      window.location.href = signInOtherLink.href || 'https://www.linkedin.com/login';
      return true;
    }
    return false;
  }

  // Handle account picker
  if (document.querySelector('.login__form') === null && document.body.innerText.includes('Sign in using another account')) {
    const signInOther = Array.from(document.querySelectorAll('button, a')).find((el) => (el.innerText || '').toLowerCase().includes('sign in using another account'));
    if (signInOther) {
      console.log('Auto Job Apply: Clicking "Sign in using another account"...');
      if (signInOther.tagName === 'A') {
        window.location.href = signInOther.href;
      } else {
        signInOther.click();
      }
      return true;
    }
  }

  // Handle account picker ("Welcome Back") — click the saved account button
  const memberBtn = document.querySelector('button.member-profile__details');
  if (memberBtn) {
    console.log('Auto Job Apply: Clicking saved account on picker page...');
    memberBtn.click();
    return true;
  }

  // LinkedIn new UI uses dynamic class names — find by autocomplete attribute or label text
  const emailField =
    document.querySelector('input[name="session_key"]') ||
    document.querySelector('input[autocomplete="webauthn"]') ||
    document.querySelector('input[autocomplete="username"]') ||
    document.querySelector('#username') ||
    Array.from(document.querySelectorAll('input[type="text"], input[type="email"]')).find((el) => {
      const label = document.querySelector(`label[for="${el.id}"]`);
      return label && (label.innerText.toLowerCase().includes('email') || label.innerText.toLowerCase().includes('phone'));
    });

  const passwordField = document.querySelector('input[name="session_password"]') || document.querySelector('input[autocomplete="current-password"]') || document.querySelector('#password') || document.querySelector('input[type="password"]');

  // Submit button — LinkedIn new UI uses type="button" not type="submit"
  const submitBtn =
    document.querySelector('button[type="submit"]') ||
    document.querySelector('button[data-tracking-control-name="guest_page__form__form__submit"]') ||
    Array.from(document.querySelectorAll('button[type="button"]')).find((b) => {
      const t = (b.innerText || b.textContent || '').trim().toLowerCase();
      return t === 'sign in';
    });

  if (!emailField || !passwordField || !submitBtn) {
    console.warn('Auto Job Apply: Could not find login form fields.', { emailField, passwordField, submitBtn });
    return false;
  }

  console.log('Auto Job Apply: Filling login form via simulated typing...');
  await typeIntoField(emailField, email);
  await wait(700);
  await typeIntoField(passwordField, password);
  await wait(700);
  submitBtn.click();
  console.log('Auto Job Apply: Login submitted.');
  return true;
}

// Simulate real typing — required for React-controlled inputs like LinkedIn's new UI
async function typeIntoField(input, value) {
  input.focus();
  input.click();
  await wait(150);

  // Clear first using native setter
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (nativeSetter) nativeSetter.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(100);

  // Type char by char so React state updates on each keystroke
  for (const char of value) {
    if (nativeSetter) nativeSetter.call(input, input.value + char);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    await wait(40);
  }

  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getExperienceValue(text) {
  const matches = text.match(/\d+/g);
  if (!matches) return 0;
  // Use minimum value — handles ranges like "5-7 years" → 5, "4+" → 4
  return Math.min(...matches.map(Number));
}
