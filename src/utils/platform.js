/**
 * Shared utilities used by all platform content scripts.
 */

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function setValue(input, value) {
  if (!value && value !== 0) return;
  const nativeInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  const nativeTextarea = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  const nativeSelect = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;

  if (input.tagName === 'INPUT' && nativeInput) nativeInput.call(input, value);
  else if (input.tagName === 'TEXTAREA' && nativeTextarea) nativeTextarea.call(input, value);
  else if (input.tagName === 'SELECT' && nativeSelect) nativeSelect.call(input, value);
  else input.value = value;

  input.dispatchEvent(new Event('focus', { bubbles: true }));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
}

export async function typeIntoField(input, value) {
  input.focus();
  input.click();
  await wait(100);
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (nativeSetter) nativeSetter.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(80);
  for (const char of value) {
    if (nativeSetter) nativeSetter.call(input, input.value + char);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    await wait(30);
  }
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
}

export function getStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

export function setStorage(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}

export async function getProfile() {
  const data = await getStorage(['profile', 'resume', 'user', 'settings', 'filters', 'templates']);
  return data;
}

export function isCompanyBlacklisted(companyName, blacklist = []) {
  if (!companyName || !blacklist.length) return false;
  const lower = companyName.toLowerCase();
  return blacklist.some((b) => lower.includes(b.toLowerCase()));
}

export function isTitleBlocked(jobTitle, blocklist = []) {
  if (!jobTitle || !blocklist.length) return false;
  const lower = jobTitle.toLowerCase();
  return blocklist.some((b) => lower.includes(b.toLowerCase()));
}

export async function isDailyLimitReached() {
  const data = await getStorage(['stats', 'settings']);
  const limit = data.settings?.dailyLimit ?? 50;
  const applied = data.stats?.appliedToday ?? 0;
  return applied >= limit;
}

export async function isPaused() {
  const data = await getStorage(['pauseUntil']);
  if (!data.pauseUntil) return false;
  return Date.now() < data.pauseUntil;
}

export async function recordApplication(jobId, title, company, platform = 'linkedin') {
  const data = await getStorage(['stats', 'history']);
  const today = new Date().toDateString();
  const stats = data.stats || { appliedToday: 0, totalApplied: 0, skipped: 0, lastReset: today };
  if (stats.lastReset !== today) {
    stats.appliedToday = 0;
    stats.lastReset = today;
  }
  stats.appliedToday += 1;
  stats.totalApplied += 1;
  const history = data.history || [];
  history.push({ jobId, title, company, platform, time: new Date().toISOString() });
  await setStorage({ stats, history: history.slice(-500) });
}

export async function recordSkip() {
  const data = await getStorage(['stats']);
  const today = new Date().toDateString();
  const stats = data.stats || { appliedToday: 0, totalApplied: 0, skipped: 0, lastReset: today };
  if (stats.lastReset !== today) {
    stats.appliedToday = 0;
    stats.lastReset = today;
  }
  stats.skipped += 1;
  await setStorage({ stats });
}

export function buildCoverLetter(profile, templates, resumeSummary) {
  const active = templates?.list?.[templates?.active ?? 0];
  if (active?.body?.trim()) return active.body;
  const summary = resumeSummary || '';
  if (summary) return `${summary}\n\nI am excited about this opportunity and believe my experience aligns well with the role.`;
  return `Software Engineer with ${profile?.totalExp || '3'}+ years of experience in modern web technologies. I am eager to bring my expertise to this role and contribute to your team's success.`;
}
