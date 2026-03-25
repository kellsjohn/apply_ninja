let isRunning = false;

const PLATFORM_URLS = {
  linkedin: 'https://www.linkedin.com/jobs/search/?f_AL=true',
  glassdoor: 'https://www.glassdoor.co.in/Job/india-software-engineer-jobs-SRCH_IL.0,5_IN115_KO6,23.htm',
};

const PLATFORM_MATCH = {
  linkedin: 'linkedin.com',
  glassdoor: 'glassdoor.',
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'start') {
    chrome.storage.local.set({ isRunning: true }, () => {
      startAutomation();
    });
  } else if (request.action === 'stop') {
    chrome.storage.local.set({ isRunning: false });
    isRunning = false;
  }
});

async function startAutomation() {
  isRunning = true;
  console.log('ApplyNinja: Automation started');

  const result = await chrome.storage.local.get(['settings', 'resume']);
  const platforms = result.settings?.platforms || { linkedin: true };
  const keywords = result.resume?.keywords || '';

  // Get enabled platforms in order
  const enabledPlatforms = Object.entries(platforms)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);

  if (!enabledPlatforms.length) {
    console.warn('ApplyNinja: No platforms enabled.');
    chrome.storage.local.set({ isRunning: false });
    return;
  }

  // Check current active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const currentUrl = tab.url || '';

  // Check if current tab is already on one of the enabled platforms
  const alreadyOnPlatform = enabledPlatforms.some((p) => currentUrl.includes(PLATFORM_MATCH[p]));

  if (alreadyOnPlatform) {
    // Just send resume message — the content script will handle it
    chrome.tabs.sendMessage(tab.id, { action: 'start' }).catch(() => {});
    return;
  }

  // Navigate to the first enabled platform
  const firstPlatform = enabledPlatforms[0];
  let targetUrl = PLATFORM_URLS[firstPlatform];

  // Inject keywords into URL where applicable
  if (firstPlatform === 'linkedin' && keywords) {
    targetUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keywords)}&f_AL=true`;
  } else if (firstPlatform === 'glassdoor' && keywords) {
    const slug = keywords
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+$/, '');
    const kLen = 6 + slug.length;
    targetUrl = `https://www.glassdoor.co.in/Job/india-${slug}-jobs-SRCH_IL.0,5_IN115_KO6,${kLen}.htm`;
  }

  console.log(`ApplyNinja: Navigating to ${firstPlatform} — ${targetUrl}`);
  chrome.tabs.update(tab.id, { url: targetUrl });
}

// Resume automation when a platform page finishes loading
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;

  chrome.storage.local.get(['isRunning', 'settings'], (result) => {
    if (!result.isRunning) return;

    const platforms = result.settings?.platforms || { linkedin: true };
    const isOnEnabledPlatform = Object.entries(platforms).some(([key, enabled]) => enabled && tab.url.includes(PLATFORM_MATCH[key]));

    if (isOnEnabledPlatform) {
      console.log(`ApplyNinja: Page loaded on active platform, sending resume...`);
      chrome.tabs.sendMessage(tabId, { action: 'resume' }).catch(() => {});
    }
  });
});

// Stop when tab is closed
chrome.tabs.onRemoved.addListener(() => {
  chrome.storage.local.get(['isRunning'], (result) => {
    if (result.isRunning) {
      chrome.storage.local.set({ isRunning: false });
      isRunning = false;
    }
  });
});
