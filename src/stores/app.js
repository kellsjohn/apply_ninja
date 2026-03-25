import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';

export const useAppStore = defineStore('app', () => {
  const user = reactive({ email: '', password: '' });
  const resume = reactive({ keywords: '', summary: '' });

  const profile = reactive({
    firstName: '',
    lastName: '',
    phone: '',
    city: '',
    state: '',
    country: 'India',
    pincode: '',
    linkedIn: '',
    website: '',
    totalExp: '0',
    noticeDays: '30',
    currentCTC: '0',
    expectedCTC: '0',
    willingToRelocate: true,
  });

  const settings = reactive({
    delayBetweenApps: 3,
    dailyLimit: 50,
    platforms: {
      linkedin: true,
      naukri: false,
      indeed: false,
      glassdoor: false,
    },
  });

  // Filters
  const filters = reactive({
    companyBlacklist: [], // ['TCS', 'Wipro']
    titleBlocklist: [], // ['senior', 'lead', '10+ years']
  });

  // Cover letter templates
  const templates = reactive({
    active: 0, // index of active template
    list: [
      { name: 'Default', body: '' },
      { name: 'Template 2', body: '' },
      { name: 'Template 3', body: '' },
    ],
  });

  const stats = reactive({
    appliedToday: 0,
    totalApplied: 0,
    skipped: 0,
    lastReset: new Date().toDateString(),
  });

  const history = ref([]);
  const isLoaded = ref(false);
  const isRunning = ref(false);
  const pauseUntil = ref(null); // timestamp ms

  function chromeStorage() {
    return typeof chrome !== 'undefined' && chrome?.storage?.local;
  }

  async function loadData() {
    const storage = chromeStorage();
    if (!storage) {
      isLoaded.value = true;
      return;
    }
    return new Promise((resolve) => {
      storage.get(['user', 'resume', 'profile', 'settings', 'filters', 'templates', 'stats', 'history', 'isRunning', 'pauseUntil'], (result) => {
        if (chrome.runtime.lastError) {
          isLoaded.value = true;
          resolve();
          return;
        }
        if (result.user) {
          user.email = result.user.email || '';
          user.password = result.user.password || '';
        }
        if (result.resume) {
          resume.keywords = result.resume.keywords || '';
          resume.summary = result.resume.summary || '';
        }
        if (result.profile) Object.assign(profile, result.profile);
        if (result.settings) {
          Object.assign(settings, result.settings);
          // ensure platforms object exists for older installs
          if (!settings.platforms) settings.platforms = { linkedin: true, naukri: false, indeed: false, glassdoor: false };
          if (settings.dailyLimit === undefined) settings.dailyLimit = 50;
        }
        if (result.filters) Object.assign(filters, result.filters);
        if (result.templates) Object.assign(templates, result.templates);
        if (result.stats) {
          const saved = result.stats;
          if (saved.lastReset !== new Date().toDateString()) {
            saved.appliedToday = 0;
            saved.lastReset = new Date().toDateString();
          }
          Object.assign(stats, saved);
        }
        if (result.history) history.value = result.history;
        if (result.isRunning === true) isRunning.value = true;
        if (result.pauseUntil) pauseUntil.value = result.pauseUntil;
        isLoaded.value = true;
        resolve();
      });
    });
  }

  async function saveData() {
    const storage = chromeStorage();
    if (!storage) return;
    return new Promise((resolve, reject) => {
      storage.set(
        {
          user: { email: user.email, password: user.password },
          resume: { keywords: resume.keywords, summary: resume.summary },
          profile: { ...profile },
          settings: { ...settings, platforms: { ...settings.platforms } },
          filters: { companyBlacklist: [...filters.companyBlacklist], titleBlocklist: [...filters.titleBlocklist] },
          templates: { active: templates.active, list: templates.list.map((t) => ({ ...t })) },
          stats: { ...stats },
          history: history.value.slice(0, 500),
          isRunning: isRunning.value,
          pauseUntil: pauseUntil.value,
        },
        () => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve();
        },
      );
    });
  }

  async function clearHistory() {
    history.value = [];
    stats.appliedToday = 0;
    stats.totalApplied = 0;
    stats.skipped = 0;
    await saveData();
  }

  function exportHistoryCSV() {
    const rows = [['Job Title', 'Company', 'Platform', 'Time']];
    history.value
      .slice()
      .reverse()
      .forEach((h) => {
        rows.push([`"${(h.title || '').replace(/"/g, '""')}"`, `"${(h.company || '').replace(/"/g, '""')}"`, h.platform || 'linkedin', h.time ? new Date(h.time).toLocaleString() : '']);
      });
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `applyninja-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return {
    user,
    resume,
    profile,
    settings,
    filters,
    templates,
    stats,
    history,
    isLoaded,
    isRunning,
    pauseUntil,
    loadData,
    saveData,
    clearHistory,
    exportHistoryCSV,
  };
});
