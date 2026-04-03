// GA4 Measurement Protocol — works in Chrome extensions (no script injection needed)
const GA_MEASUREMENT_ID = 'G-3LYSF9779X';
const GA_API_SECRET = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GA_API_SECRET) || '';
const GA_ENDPOINT = `https://www.google-analytics.com/mp/collect?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${GA_API_SECRET}`;

function getClientId() {
  let cid = localStorage.getItem('_ga_cid');
  if (!cid) {
    cid = `${Math.random().toString(36).slice(2)}.${Date.now()}`;
    localStorage.setItem('_ga_cid', cid);
  }
  return cid;
}

function sendEvent(name, params = {}) {
  const body = {
    client_id: getClientId(),
    events: [{ name, params: { ...params, engagement_time_msec: 100 } }],
  };
  fetch(GA_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify(body),
  }).catch(() => {}); // silent fail
}

export function trackPageView(tabId, tabLabel) {
  sendEvent('page_view', { page_path: `/${tabId}`, page_title: tabLabel });
}

export function trackStartApplying(keywords, location) {
  sendEvent('start_applying', { keywords, location });
}

export function trackStopApplying(appliedToday) {
  sendEvent('stop_applying', { applied_today: appliedToday });
}

export function trackApplicationSubmitted(title, company, platform) {
  sendEvent('application_submitted', { job_title: title, company, platform });
}

export function trackJobSkipped(reason) {
  sendEvent('job_skipped', { reason });
}

export function trackDailyLimitReached(count) {
  sendEvent('daily_limit_reached', { count });
}

export function trackFilterBlocked(type, value) {
  sendEvent('filter_blocked', { filter_type: type, value });
}

export function trackLoginDetected() {
  sendEvent('login_detected', {});
}

export function trackPauseApplying(duration) {
  sendEvent('pause_applying', { duration_ms: duration });
}
