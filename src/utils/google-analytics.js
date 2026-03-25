import { event } from 'vue-gtag';

function getDeviceModel() {
  const ua = navigator.userAgent;

  if (/Android/i.test(ua)) {
    return 'Android';
  }
  if (/iPhone/i.test(ua)) {
    return 'iPhone';
  }
  if (/iPad/i.test(ua)) {
    return 'iPad';
  }
  if (/Macintosh/i.test(ua) && 'ontouchend' in document) {
    return 'iPad';
  }
  if (/Macintosh/i.test(ua)) {
    return 'Mac';
  }
  if (/Windows/i.test(ua)) {
    return 'Windows';
  }
  if (/Linux/i.test(ua)) {
    return 'Linux';
  }
  if (/SMART-TV|SmartTV|Tizen|Web0S|NetCast|SonyTV/i.test(ua)) {
    return 'Smart TV';
  }
  if (/PlayStation/i.test(ua)) {
    return 'PlayStation';
  }

  return 'Desktop';
}

export function trackEvent(action, category, label = '') {
  event(action, {
    event_category: category,
    event_label: label,
    device_model: getDeviceModel(),
  });
}
