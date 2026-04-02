<template lang="pug">
div(class="root-wrap")
  //- Header
  header(class="header")
    div(class="header-logo")
      img(src="/icons/logo.svg", class="logo-img")
    div(class="header-text")
      span(class="header-title") ApplyNinja 🥷
      span(class="header-sub") {{ activePlatformLabel }}
    div(v-if="store.isRunning", class="live-badge")
      span(class="live-dot")
      span Live
    div(v-if="isPaused && !store.isRunning", class="pause-badge")
      span ⏸ {{ pauseLabel }}

  //- Tabs
  nav(class="tabs-nav")
    button(v-for="tab in tabs", class="tab-btn", @click="activeTab = tab.id", :key="tab.id", :class="{ active: activeTab === tab.id }") {{ tab.label }}

  //- Content
  div(class="tab-content")
    //- ── DASHBOARD ──
    div(v-if="activeTab === 'dashboard'", class="section-gap")
      //- Stats
      div(class="stats-row")
        div(v-for="s in statCards", class="stat-card", :key="s.label")
          span(class="stat-value") {{ s.value }}
          span(class="stat-label") {{ s.label }}

      //- Start / Stop / Pause
      div(class="action-row")
        button(class="apply-btn", @click="toggleApplication", :class="store.isRunning ? 'stop' : 'start'")
          span(v-if="store.isRunning", class="spinner")
          span {{ store.isRunning ? 'Stop' : 'Start Applying' }}
        button(title="Pause for a while", class="pause-btn", @click="showPauseMenu = !showPauseMenu") ⏸
        div(v-if="showPauseMenu", class="pause-menu")
          p(class="pause-menu-title") Pause for...
          button(v-for="opt in pauseOptions", class="pause-opt", @click="pauseFor(opt.ms)", :key="opt.label") {{ opt.label }}

      //- Daily progress
      div(class="card")
        div(class="card-row")
          span(class="field-label") Daily progress
          span(class="accent-text") {{ store.stats.appliedToday }} / {{ store.settings.dailyLimit }}
        div(class="progress-bar")
          div(class="progress-fill", :style="{ width: dailyProgress + '%' }")

      //- Delay slider
      div(class="card")
        div(class="card-row")
          span(class="field-label") Delay between apps
          span(class="accent-text") {{ store.settings.delayBetweenApps }}s
        input(v-model.number="store.settings.delayBetweenApps", type="range", step="1", min="1", max="15", class="slider", @change="store.saveData()")
        div(class="slider-labels")
          span 1s (fast)
          span 15s (safe)

      //- Keywords
      div(class="card")
        label(class="field-label block mb-1") Job Keywords
        input(v-model="store.resume.keywords", type="text", placeholder="Frontend Developer, Vue.js...", class="field-input")
        div(class="mt-2")
          label(class="field-label block mb-1") Job Location
          input(v-model="store.resume.jobLocation", type="text", placeholder="India", class="field-input")

    //- ── PLATFORMS ──
    div(v-if="activeTab === 'platforms'", class="section-gap")
      div(class="card")
        p(class="section-title") Active Platforms
        p(class="hint-text mb-3") Enable the job boards you want ApplyNinja to run on. Make sure you're logged in on each site.
        div(v-for="p in platformList", class="platform-row", :key="p.key", :class="{ disabled: p.disabled }")
          div(class="platform-info")
            span(class="platform-icon") {{ p.icon }}
            div
              span(class="platform-name") {{ p.name }} {{ p.disabled ? '(Coming Soon)' : '' }}
              span(class="platform-url") {{ p.url }}
          button(class="toggle", @click="p.disabled ? null : togglePlatform(p.key)", :disabled="p.disabled", :class="{ on: store.settings.platforms[p.key] }")
            span(class="toggle-thumb")

      div(class="card")
        p(class="section-title") Daily Limit
        p(class="hint-text mb-2") Auto-stop after this many applications per day across all platforms.
        div(class="card-row")
          span(class="field-label") Max applications / day
          span(class="accent-text") {{ store.settings.dailyLimit }}
        input(v-model.number="store.settings.dailyLimit", type="range", step="5", min="5", max="40", class="slider", @change="store.saveData()")
        div(class="slider-labels")
          span 5
          span 40

    //- ── FILTERS ──
    div(v-if="activeTab === 'filters'", class="section-gap")
      //- Company blacklist
      div(class="card")
        p(class="section-title") Company Blacklist
        p(class="hint-text mb-2") Skip jobs from these companies. One per line.
        textarea(rows="5", placeholder="TCS\nWipro\nInfosys", class="field-input resize-none", @keydown.enter.prevent="insertNewline($event, updateBlacklist)", @input="updateBlacklist($event.target.value)", :value="store.filters.companyBlacklist.join('\\n')")
        p(class="hint-text mt-1") {{ store.filters.companyBlacklist.length }} companies blocked

      //- Title blocklist
      div(class="card")
        p(class="section-title") Title Keyword Blocklist
        p(class="hint-text mb-2") Skip jobs whose title contains these words. One per line.
        textarea(rows="5", placeholder="Senior\nLead\nManager\n10+ years", class="field-input resize-none", @keydown.enter.prevent="insertNewline($event, updateTitleBlocklist)", @input="updateTitleBlocklist($event.target.value)", :value="store.filters.titleBlocklist.join('\\n')")
        p(class="hint-text mt-1") {{ store.filters.titleBlocklist.length }} keywords blocked

      button(class="btn-primary", @click="saveFilters") {{ filtersSaved ? 'Saved ✓' : 'Save Filters' }}

    //- ── PROFILE ──
    div(v-if="activeTab === 'profile'", class="section-gap")
      div(class="card")
        p(class="section-title") Personal
        div(class="grid-2")
          div
            label(class="field-label block mb-1") First Name
            input(v-model="store.profile.firstName", class="field-input")
          div
            label(class="field-label block mb-1") Last Name
            input(v-model="store.profile.lastName", class="field-input")
        div(class="mt-2")
          label(class="field-label block mb-1") Phone
          input(v-model="store.profile.phone", placeholder="9XXXXXXXXX", class="field-input")
        div(class="grid-2 mt-2")
          div
            label(class="field-label block mb-1") City
            input(v-model="store.profile.city", class="field-input")
          div
            label(class="field-label block mb-1") State
            input(v-model="store.profile.state", class="field-input")
        div(class="grid-2 mt-2")
          div
            label(class="field-label block mb-1") Country
            input(v-model="store.profile.country", class="field-input")
          div
            label(class="field-label block mb-1") Pincode
            input(v-model="store.profile.pincode", class="field-input")

      div(class="card")
        p(class="section-title") Career
        div(class="grid-2")
          div
            label(class="field-label block mb-1") Experience (yrs)
            input(v-model="store.profile.totalExp", type="number", min="0", class="field-input")
          div
            label(class="field-label block mb-1") Experience (months)
            input(
              v-model="store.profile.totalExpMonths",
              type="number",
              min="0",
              max="11",
              class="field-input",
              @input="store.profile.totalExpMonths = Math.min(11, Math.max(0, parseInt($event.target.value) || 0)).toString()",
              @blur="store.profile.totalExpMonths = Math.min(11, Math.max(0, parseInt(store.profile.totalExpMonths) || 0)).toString()"
            )
        div(class="grid-2 mt-2")
          div
            label(class="field-label block mb-1") Notice (days)
            input(v-model="store.profile.noticeDays", type="number", min="0", class="field-input")
          div
            label(class="field-label block mb-1") Highest Education
            select(v-model="store.profile.highestEducation", class="field-input")
              option(value="bachelor") Bachelor's Degree
              option(value="master") Master's Degree
              option(value="phd") PhD
              option(value="diploma") Diploma
              option(value="highschool") High School
        div(class="mt-2")
          label(class="field-label block mb-1") Skills (comma separated)
          textarea(v-model="store.profile.skills", rows="3", placeholder="Vue.js, Node.js, PostgreSQL, JavaScript...", class="field-input resize-none")
        div(class="grid-2 mt-2")
          div
            label(class="field-label block mb-1") Current CTC (LPA)
            input(v-model="store.profile.currentCTC", class="field-input")
          div
            label(class="field-label block mb-1") Expected CTC (LPA)
            input(v-model="store.profile.expectedCTC", class="field-input")
        div(class="mt-2")
          label(class="field-label block mb-1") LinkedIn URL
          input(v-model="store.profile.linkedIn", placeholder="https://linkedin.com/in/...", class="field-input")
        div(class="mt-2")
          label(class="field-label block mb-1") Portfolio / Website
          input(v-model="store.profile.website", placeholder="https://...", class="field-input")
        div(class="toggle-row mt-3")
          span(class="field-label") Ready to Relocate
          button(class="toggle", @click="store.profile.willingToRelocate = !store.profile.willingToRelocate", :class="{ on: store.profile.willingToRelocate }")
            span(class="toggle-thumb")

      button(class="btn-primary", @click="saveProfile") {{ profileSaved ? 'Saved ✓' : 'Save Profile' }}

    //- ── SETTINGS ──
    div(v-if="activeTab === 'settings'", class="section-gap")
      div(class="card")
        p(class="section-title") Credentials
        div
          label(class="field-label block mb-1") Email
          input(v-model="store.user.email", type="email", placeholder="email@example.com", class="field-input", @blur="validateEmail", :class="{ error: emailError }")
          p(v-if="emailError", class="error-msg") {{ emailError }}
        div(class="mt-2")
          label(class="field-label block mb-1") Password
          input(v-model="store.user.password", type="password", placeholder="••••••••", class="field-input", @blur="validatePassword", :class="{ error: passwordError }")
          p(v-if="passwordError", class="error-msg") {{ passwordError }}
        div(class="mt-2")

        button(class="btn-ghost mt-3", @click="saveCredentials") {{ isSaved ? 'Saved ✓' : 'Save' }}

      div(class="card")
        p(class="section-title") Resume Parser
        p(class="hint-text mb-2") Paste your resume text to auto-fill your profile.
        textarea(v-model="resumeText", rows="6", placeholder="Paste your full resume text here...", class="field-input resize-none")
        button(class="btn-primary mt-2", @click="parseAndFill", :disabled="isParsing")
          span {{ isParsing ? 'Parsing...' : 'Parse & Fill Profile' }}
      div(v-if="parseResult", class="card")
        p(class="section-title mb-2") Detected fields
        div(class="parsed-list")
          div(v-for="(val, key) in parseResult", class="parsed-row", :key="key")
            span(class="parsed-key") {{ key }}
            span(class="parsed-val") {{ val }}

    //- ── HISTORY ──
    div(v-if="activeTab === 'history'", class="section-gap")
      div(class="history-header")
        span(class="field-label") {{ store.history.length }} applications
        div(class="flex gap-2")
          button(class="btn-ghost", @click="store.exportHistoryCSV()") Export CSV
          button(class="btn-danger-ghost", @click="clearAll") Clear
      div(v-if="store.history.length === 0", class="empty-state")
        p No applications yet
        p(class="mt-1") Start applying to see history here
      div(v-else, class="flex flex-col gap-1.5")
        div(v-for="item in store.history.slice().reverse()", class="history-item", :key="item.jobId || item.time")
          div(class="flex-1 min-w-0")
            p(class="history-title") {{ item.title || 'Unknown Role' }}
            p(class="history-company") {{ item.company || 'Unknown Company' }}
          div(class="flex flex-col items-end gap-1")
            span(class="platform-chip", :class="item.platform || 'linkedin'") {{ item.platform || 'linkedin' }}
            span(class="history-time") {{ formatTime(item.time) }}

  //- Footer
  footer(class="footer") Created by Jobin John

  //- Toasts
  div(class="toast-wrap")
    TransitionGroup(name="toast")
      div(v-for="toast in toasts", class="toast", :key="toast.id", :class="toast.type === 'error' ? 'toast-error' : 'toast-success'")
        span(class="toast-dot", :class="toast.type === 'error' ? 'dot-red' : 'dot-green'")
        span(class="toast-msg") {{ toast.message }}
        button(class="toast-close", @click="removeToast(toast.id)") ✕
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useAppStore } from '../stores/app';
import { parseResume } from '../utils/resumeParser';

const store = useAppStore();

// UI state
const activeTab = ref('dashboard');
const toasts = ref([]);
const isSaved = ref(false);
const profileSaved = ref(false);
const filtersSaved = ref(false);
const templatesSaved = ref(false);
const resumeText = ref('');
const isParsing = ref(false);
const parseResult = ref(null);
const emailError = ref('');
const passwordError = ref('');
const showPauseMenu = ref(false);

const tabs = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'platforms', label: 'Platforms' },
  { id: 'filters', label: 'Filters' },
  { id: 'profile', label: 'Profile' },
  { id: 'settings', label: 'Settings' },
  { id: 'history', label: 'History' },
];

const platformList = [
  { key: 'linkedin', name: 'LinkedIn', url: 'linkedin.com', icon: '💼' },
  { key: 'glassdoor', name: 'Glassdoor', url: 'glassdoor.com', icon: '🚪', disabled: true },
];

const pauseOptions = [
  { label: '15 minutes', ms: 15 * 60 * 1000 },
  { label: '30 minutes', ms: 30 * 60 * 1000 },
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '2 hours', ms: 2 * 60 * 60 * 1000 },
];

// Computed
const statCards = computed(() => [
  { label: 'Today', value: store.stats.appliedToday },
  { label: 'Total', value: store.stats.totalApplied },
  { label: 'Skipped', value: store.stats.skipped },
]);

const dailyProgress = computed(() => {
  const pct = (store.stats.appliedToday / store.settings.dailyLimit) * 100;
  return Math.min(pct, 100);
});

const activePlatformLabel = computed(() => {
  const active = platformList.filter((p) => store.settings.platforms[p.key]).map((p) => p.name);
  return active.length ? active.join(' · ') : 'No platforms active';
});

const isPaused = computed(() => store.pauseUntil && Date.now() < store.pauseUntil);

const pauseLabel = computed(() => {
  if (!store.pauseUntil) return '';
  const remaining = Math.max(0, store.pauseUntil - Date.now());
  const mins = Math.ceil(remaining / 60000);
  return mins > 0 ? `${mins}m` : 'Resuming...';
});

// Validation
const validateEmail = () => {
  const val = store.user.email.trim();
  if (!val) {
    emailError.value = 'Email is required';
    return false;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
    emailError.value = 'Enter a valid email';
    return false;
  }
  emailError.value = '';
  return true;
};
const validatePassword = () => {
  const val = store.user.password;
  if (!val) {
    passwordError.value = 'Password is required';
    return false;
  }
  if (val.length < 6) {
    passwordError.value = 'Min 6 characters';
    return false;
  }
  passwordError.value = '';
  return true;
};

// Toast
const showToast = (message, type = 'info') => {
  const id = Date.now();
  toasts.value.push({ id, message, type });
  setTimeout(() => removeToast(id), 3000);
};
const removeToast = (id) => {
  toasts.value = toasts.value.filter((t) => t.id !== id);
};

// Actions
const toggleApplication = async () => {
  if (!store.resume.keywords && !store.isRunning) {
    showToast('Enter job keywords first', 'error');
    activeTab.value = 'dashboard';
    return;
  }
  const anyPlatform = Object.values(store.settings.platforms).some(Boolean);
  if (!anyPlatform && !store.isRunning) {
    showToast('Enable at least one platform', 'error');
    activeTab.value = 'platforms';
    return;
  }
  store.isRunning = !store.isRunning;
  store.pauseUntil = null;
  await store.saveData();
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage({ action: store.isRunning ? 'start' : 'stop' });
  }
};

const togglePlatform = async (key) => {
  // Radio behavior: only one platform active at a time
  Object.keys(store.settings.platforms).forEach((k) => {
    store.settings.platforms[k] = k === key;
  });
  await store.saveData();
};

const pauseFor = async (ms) => {
  showPauseMenu.value = false;
  store.pauseUntil = Date.now() + ms;
  if (store.isRunning) {
    store.isRunning = false;
    if (typeof chrome !== 'undefined' && chrome.runtime) chrome.runtime.sendMessage({ action: 'stop' });
  }
  await store.saveData();
  showToast(`Paused for ${Math.round(ms / 60000)} min`, 'info');
};

const saveCredentials = async () => {
  if (!validateEmail() | !validatePassword()) return;
  await store.saveData();
  isSaved.value = true;
  showToast('Saved', 'info');
  setTimeout(() => {
    isSaved.value = false;
  }, 2000);
};

const saveProfile = async () => {
  await store.saveData();
  profileSaved.value = true;
  showToast('Profile saved', 'info');
  setTimeout(() => {
    profileSaved.value = false;
  }, 2000);
};

const saveFilters = async () => {
  await store.saveData();
  filtersSaved.value = true;
  showToast('Filters saved', 'info');
  setTimeout(() => {
    filtersSaved.value = false;
  }, 2000);
};

const saveTemplates = async () => {
  await store.saveData();
  templatesSaved.value = true;
  showToast('Templates saved', 'info');
  setTimeout(() => {
    templatesSaved.value = false;
  }, 2000);
};

const clearAll = async () => {
  await store.clearHistory();
  showToast('History cleared', 'info');
};

const updateBlacklist = async (val) => {
  store.filters.companyBlacklist = val
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  await store.saveData();
};
const updateTitleBlocklist = async (val) => {
  store.filters.titleBlocklist = val
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  await store.saveData();
};

const insertNewline = (e, updateFn) => {
  const el = e.target;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const val = el.value;
  const newVal = val.slice(0, start) + '\n' + val.slice(end);
  el.value = newVal;
  el.selectionStart = el.selectionEnd = start + 1;
  updateFn(newVal);
  // Trigger input event so Vue picks up the change
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

const parseAndFill = async () => {
  if (!resumeText.value.trim()) {
    showToast('Paste your resume text first', 'error');
    return;
  }
  isParsing.value = true;
  try {
    const parsed = parseResume(resumeText.value);
    parseResult.value = parsed;
    if (parsed.firstName) store.profile.firstName = parsed.firstName;
    if (parsed.lastName) store.profile.lastName = parsed.lastName;
    if (parsed.phone) store.profile.phone = parsed.phone;
    if (parsed.city) store.profile.city = parsed.city;
    if (parsed.state) store.profile.state = parsed.state;
    if (parsed.country) store.profile.country = parsed.country;
    if (parsed.pincode) store.profile.pincode = parsed.pincode;
    if (parsed.linkedIn) store.profile.linkedIn = parsed.linkedIn;
    if (parsed.website) store.profile.website = parsed.website;
    if (parsed.totalExp) store.profile.totalExp = parsed.totalExp;
    if (parsed.noticeDays) store.profile.noticeDays = parsed.noticeDays;
    if (parsed.currentCTC) store.profile.currentCTC = parsed.currentCTC;
    if (parsed.expectedCTC) store.profile.expectedCTC = parsed.expectedCTC;
    if (parsed.email) store.user.email = parsed.email;
    if (parsed.summary) store.resume.summary = parsed.summary;
    if (parsed.skills) store.profile.skills = parsed.skills;
    await store.saveData();
    showToast('Profile updated from resume', 'info');
    activeTab.value = 'profile';
  } catch (e) {
    showToast('Parse failed: ' + e.message, 'error');
  } finally {
    isParsing.value = false;
  }
};

const formatTime = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// Lifecycle
let storageListener = null;
let pauseTimer = null;

onMounted(async () => {
  await store.loadData();
  if (typeof chrome !== 'undefined' && chrome.storage) {
    storageListener = (changes) => {
      if (changes.stats?.newValue) Object.assign(store.stats, changes.stats.newValue);
      if (changes.history?.newValue) store.history = changes.history.newValue;
      if (changes.isRunning !== undefined) store.isRunning = changes.isRunning.newValue;
    };
    chrome.storage.onChanged.addListener(storageListener);
  }
  // Auto-resume after pause
  pauseTimer = setInterval(async () => {
    if (store.pauseUntil && Date.now() >= store.pauseUntil) {
      store.pauseUntil = null;
      await store.saveData();
    }
  }, 30000);
});

onUnmounted(() => {
  if (storageListener && typeof chrome !== 'undefined') chrome.storage.onChanged.removeListener(storageListener);
  if (pauseTimer) clearInterval(pauseTimer);
});

watch(
  () => [store.resume.keywords, store.resume.summary, store.resume.jobLocation],
  async () => {
    if (store.isLoaded) await store.saveData();
  },
  { deep: true },
);
</script>

<style scoped>
.root-wrap {
  display: flex;
  flex-direction: column;
  width: 400px;
  height: 580px;
  overflow: hidden;
  background: #0c0f14;
  color: #e2e8f0;
  font-family:
    'Inter',
    -apple-system,
    sans-serif;
}

/* Header */
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px 11px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}
.header-logo {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: 0 0 14px rgba(5, 150, 105, 0.4);
}
.logo-img {
  width: 34px;
  height: 34px;
}
.header-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.header-title {
  font-size: 13px;
  font-weight: 700;
  color: #f1f5f9;
  letter-spacing: -0.2px;
}
.header-sub {
  font-size: 10px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.live-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  font-weight: 600;
  color: #4ade80;
  background: rgba(74, 222, 128, 0.08);
  border: 1px solid rgba(74, 222, 128, 0.2);
  border-radius: 20px;
  padding: 3px 8px;
  flex-shrink: 0;
}
.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4ade80;
  animation: pulse 1.5s infinite;
}
.pause-badge {
  font-size: 10px;
  font-weight: 600;
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.08);
  border: 1px solid rgba(251, 191, 36, 0.2);
  border-radius: 20px;
  padding: 3px 8px;
  flex-shrink: 0;
}

/* Tabs */
.tabs-nav {
  display: flex;
  padding: 0 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  overflow-x: auto;
  flex-shrink: 0;
  scrollbar-width: none;
}
.tabs-nav::-webkit-scrollbar {
  display: none;
}
.tab-btn {
  padding: 8px 10px 7px;
  font-size: 11px;
  font-weight: 500;
  color: #64748b;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s;
  white-space: nowrap;
}
.tab-btn:hover {
  color: #94a3b8;
}
.tab-btn.active {
  color: #34d399;
  border-bottom-color: #059669;
}

/* Content */
.tab-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px 14px;
  min-height: 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.07) transparent;
}
.section-gap {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

/* Cards */
.card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 11px;
  padding: 11px 13px;
}
.card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 7px;
}

/* Stats */
.stats-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 7px;
}
.stat-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 11px;
  padding: 11px 8px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: #f1f5f9;
  line-height: 1;
}
.stat-label {
  font-size: 10px;
  color: #64748b;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Action row */
.action-row {
  display: flex;
  gap: 8px;
  position: relative;
}
.apply-btn {
  flex: 1;
  padding: 10px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition:
    opacity 0.15s,
    transform 0.1s;
}
.apply-btn:hover {
  opacity: 0.9;
}
.apply-btn:active {
  transform: scale(0.99);
}
.apply-btn.start {
  background: linear-gradient(135deg, #059669, #047857);
  box-shadow: 0 4px 14px rgba(5, 150, 105, 0.3);
}
.apply-btn.stop {
  background: linear-gradient(135deg, #dc2626, #b91c1c);
  box-shadow: 0 4px 14px rgba(220, 38, 38, 0.3);
}
.pause-btn {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: #94a3b8;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.15s,
    color 0.15s;
  flex-shrink: 0;
}
.pause-btn:hover {
  background: rgba(251, 191, 36, 0.1);
  color: #fbbf24;
}
.pause-menu {
  position: absolute;
  top: 46px;
  right: 0;
  z-index: 20;
  background: #161b24;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 8px;
  min-width: 140px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.pause-menu-title {
  font-size: 10px;
  color: #475569;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
  padding: 0 4px;
}
.pause-opt {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 10px;
  font-size: 12px;
  color: #cbd5e1;
  background: none;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.1s;
}
.pause-opt:hover {
  background: rgba(255, 255, 255, 0.06);
}

/* Progress bar */
.progress-bar {
  height: 5px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #059669, #34d399);
  border-radius: 3px;
  transition: width 0.4s ease;
}

/* Slider */
.slider {
  width: 100%;
  accent-color: #059669;
  cursor: pointer;
}
.slider-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 3px;
  font-size: 10px;
  color: #334155;
}

/* Typography */
.section-title {
  font-size: 10px;
  font-weight: 700;
  color: #34d399;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 10px;
}
.field-label {
  font-size: 11px;
  color: #94a3b8;
  font-weight: 500;
}
.hint-text {
  font-size: 11px;
  color: #475569;
  line-height: 1.5;
}
.accent-text {
  font-size: 12px;
  font-weight: 600;
  color: #34d399;
}

/* Inputs */
.field-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 12px;
  color: #e2e8f0;
  outline: none;
  transition:
    border-color 0.15s,
    background 0.15s;
  box-sizing: border-box;
}
.field-input::placeholder {
  color: #334155;
}
.field-input:focus {
  border-color: rgba(5, 150, 105, 0.5);
  background: rgba(5, 150, 105, 0.04);
}
.field-input.error {
  border-color: rgba(239, 68, 68, 0.6);
}
.error-msg {
  font-size: 10px;
  color: #f87171;
  margin-top: 3px;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

/* Toggle */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.toggle {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: #1e293b;
  border: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
  padding: 0;
}
.toggle.on {
  background: #059669;
  border-color: #059669;
}
.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
  display: block;
}
.toggle.on .toggle-thumb {
  transform: translateX(16px);
}

/* Buttons */
.btn-primary {
  width: 100%;
  padding: 9px;
  border-radius: 9px;
  background: #059669;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-primary:hover {
  background: #047857;
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-ghost {
  font-size: 11px;
  font-weight: 600;
  color: #34d399;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s;
}
.btn-ghost:hover {
  color: #6ee7b7;
}
.btn-danger-ghost {
  font-size: 11px;
  color: #f87171;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s;
}
.btn-danger-ghost:hover {
  color: #fca5a5;
}

/* Platforms */
.platform-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.platform-row.disabled {
  opacity: 0.5;
  pointer-events: none;
}
.platform-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.platform-info {
  display: flex;
  align-items: center;
  gap: 10px;
}
.platform-icon {
  font-size: 18px;
  width: 28px;
  text-align: center;
}
.platform-name {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #e2e8f0;
}
.platform-url {
  display: block;
  font-size: 10px;
  color: #475569;
}

/* Templates */
.template-tabs {
  display: flex;
  gap: 6px;
}
.template-tab {
  flex: 1;
  padding: 6px 8px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 500;
  color: #64748b;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.template-tab.active {
  color: #34d399;
  border-color: rgba(5, 150, 105, 0.4);
  background: rgba(5, 150, 105, 0.08);
}
.active-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #34d399;
}

/* Parsed results */
.parsed-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.parsed-row {
  display: flex;
  gap: 8px;
  font-size: 11px;
}
.parsed-key {
  color: #64748b;
  width: 90px;
  flex-shrink: 0;
}
.parsed-val {
  color: #e2e8f0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* History */
.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.empty-state {
  text-align: center;
  padding: 32px 0;
  font-size: 12px;
  color: #334155;
}
.history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 9px;
  padding: 8px 11px;
}
.history-title {
  font-size: 12px;
  font-weight: 500;
  color: #e2e8f0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.history-company {
  font-size: 10px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.history-time {
  font-size: 10px;
  color: #334155;
}
.platform-chip {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 6px;
  border-radius: 4px;
}
.platform-chip.linkedin {
  background: rgba(37, 99, 235, 0.15);
  color: #60a5fa;
}
.platform-chip.naukri {
  background: rgba(249, 115, 22, 0.15);
  color: #fb923c;
}
.platform-chip.indeed {
  background: rgba(139, 92, 246, 0.15);
  color: #a78bfa;
}
.platform-chip.glassdoor {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
}

/* Footer */
.footer {
  padding: 7px 16px;
  text-align: center;
  font-size: 10px;
  color: #334155;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  flex-shrink: 0;
}

/* Toasts */
.toast-wrap {
  position: fixed;
  bottom: 10px;
  left: 10px;
  right: 10px;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 5px;
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-radius: 9px;
  border: 1px solid;
  font-size: 12px;
  font-weight: 500;
  color: #f1f5f9;
  pointer-events: auto;
  backdrop-filter: blur(12px);
}
.toast-success {
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.25);
}
.toast-error {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.25);
}
.toast-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-green {
  background: #10b981;
}
.dot-red {
  background: #ef4444;
}
.toast-msg {
  flex: 1;
}
.toast-close {
  background: none;
  border: none;
  color: #475569;
  cursor: pointer;
  font-size: 11px;
  padding: 0;
}
.toast-close:hover {
  color: #94a3b8;
}

/* Spinner */
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

/* Animations */
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(8px);
}
</style>
