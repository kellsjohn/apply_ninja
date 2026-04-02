/**
 * Parse plain text resume — handles collapsed PDF copy-paste (no newlines).
 * Uses character-walking for fields that get glued together.
 */
export function parseResume(rawText) {
  const result = {};

  const JOB_TITLE_WORDS = new Set([
    'engineer',
    'developer',
    'manager',
    'analyst',
    'designer',
    'consultant',
    'architect',
    'lead',
    'senior',
    'junior',
    'intern',
    'specialist',
    'officer',
    'executive',
    'director',
    'head',
    'associate',
    'science',
    'technology',
    'software',
    'computer',
    'information',
    'systems',
    'solutions',
    'services',
  ]);

  // --- Name: everything before the first phone number ---
  const nameMatch = rawText.match(/^([A-Za-z][a-zA-Z\s]{2,30})(?=\+91|\b[6-9]\d{9}|\d{3}|\n|@)/);
  if (nameMatch) {
    const words = nameMatch[1].trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2 && !words.some((w) => JOB_TITLE_WORDS.has(w.toLowerCase()))) {
      result.firstName = words[0];
      result.lastName = words.slice(1).join(' ');
    }
  }

  // --- Phone ---
  const phoneMatch = rawText.match(/(?:\+91[\s\-]?)?[6-9]\d{9}/);
  if (phoneMatch) result.phone = phoneMatch[0].replace(/[\s\-]/g, '').replace(/^\+?91/, '');

  // --- Email: find @ then walk outward, then clean glued prefix ---
  const atIdx = rawText.indexOf('@');
  if (atIdx > 0) {
    // Walk left from @
    let s = atIdx - 1;
    while (s >= 0 && /[a-z0-9._%+\-]/i.test(rawText[s])) s--;
    s++;

    // Walk right from @
    let e = atIdx + 1;
    while (e < rawText.length && /[a-zA-Z0-9.\-]/.test(rawText[e])) {
      // Stop at uppercase after lowercase (glued next word)
      if (/[A-Z]/.test(rawText[e]) && /[a-z]/.test(rawText[e - 1]) && e > atIdx + 5) break;
      e++;
    }

    let local = rawText.slice(s, atIdx).replace(/\.+$/, '');
    const domain = rawText.slice(atIdx + 1, e).replace(/\.+$/, '');

    // Clean glued prefix from local part.
    // Problem: collapsed PDF pastes glue city/state/name text directly onto the email.
    // e.g. "Keralajobinjohn664@gmail.com" — "Kerala" is glued before the real local.
    //
    // Strategy: try all possible suffixes of `local` and pick the longest one that
    // does NOT start with a known glued word (city, state, name fragment).
    // Simpler heuristic: find the last run of digits in local, then walk back to find
    // the start of the word containing those digits — that's the real local start.
    const KNOWN_GLUE = ['kerala', 'karnataka', 'tamilnadu', 'maharashtra', 'delhi', 'gujarat', 'punjab', 'haryana', 'alappuzha', 'kochi', 'bangalore', 'mumbai', 'chennai', 'hyderabad', 'pune', 'india', 'linkedin', 'github', 'summary', 'experience', 'education', 'skills', 'projects'];
    const localLower = local.toLowerCase();
    let stripped = false;
    for (const glue of KNOWN_GLUE) {
      if (localLower.startsWith(glue)) {
        local = local.slice(glue.length);
        stripped = true;
        break;
      }
    }
    if (!stripped) {
      // Partial glue: e.g. "eralajobinjohn664" (tail of "Kerala")
      // Find first digit, then find the longest lowercase-letter run ending just before
      // the first digit that could be a glued tail (i.e., no uppercase boundary).
      // Strip leading lowercase letters that appear before a digit-containing word.
      // Pattern: strip ^[a-z]+ only if what follows looks like a real email local
      // (starts with a letter and contains a digit).
      local = local.replace(/^[a-z]+(?=[a-z]{2,}\d)/, '');
    }

    const email = local + '@' + domain;
    if (/^[a-z0-9][a-z0-9._%+\-]*@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/i.test(email)) {
      result.email = email;
    }
  }

  // --- LinkedIn: look for linkedin.com/in/ OR "LinkedIn" keyword followed by URL ---
  const liComIdx = rawText.toLowerCase().indexOf('linkedin.com/in/');
  if (liComIdx >= 0) {
    let e = liComIdx;
    while (e < rawText.length && /[a-zA-Z0-9.\-\/]/.test(rawText[e])) e++;
    result.linkedIn = 'https://www.' + rawText.slice(liComIdx, e).replace(/\/$/, '');
  } else {
    // Fallback: find "LinkedIn" keyword then grab the next URL or path
    const liKeyIdx = rawText.search(/LinkedIn/i);
    if (liKeyIdx >= 0) {
      // Look for a URL starting after the keyword
      const afterLi = rawText.slice(liKeyIdx + 8);
      const urlMatch = afterLi.match(/https?:\/\/[^\s<>"'()A-Z]{5,}/);
      if (urlMatch && urlMatch[0].toLowerCase().includes('linkedin')) {
        result.linkedIn = urlMatch[0].replace(/[.,\/]+$/, '');
      } else {
        // Look for /in/username pattern
        const inMatch = afterLi.match(/\/in\/([a-zA-Z0-9\-]+)/);
        if (inMatch) {
          result.linkedIn = 'https://www.linkedin.com/in/' + inMatch[1];
        }
      }
    }
  }

  // --- Website: find https:// not linkedin, stop at uppercase-after-lowercase (glued text) ---
  // Find ALL https:// occurrences and pick the non-linkedin one
  let searchFrom = 0;
  while (searchFrom < rawText.length) {
    const httpsIdx = rawText.indexOf('https://', searchFrom);
    if (httpsIdx < 0) break;
    let e = httpsIdx + 8;
    while (e < rawText.length) {
      const ch = rawText[e];
      if (/[\s<>"'()]/.test(ch)) break;
      if (/[A-Z]/.test(ch) && /[a-z0-9\/]/.test(rawText[e - 1])) break;
      e++;
    }
    const url = rawText.slice(httpsIdx, e).replace(/[.,\/]+$/, '');
    if (!url.toLowerCase().includes('linkedin') && url.length > 10) {
      result.website = url;
      break;
    }
    searchFrom = e;
  }

  // --- City + State ---
  const cityMatch = rawText.match(/([A-Z][a-z]{2,20}),\s*(Kerala|Karnataka|Tamil Nadu|Maharashtra|Delhi|Telangana|Andhra Pradesh|Gujarat|Rajasthan|Punjab|Haryana|Uttar Pradesh|West Bengal)/);
  if (cityMatch) {
    result.city = cityMatch[1].trim();
    result.state = cityMatch[2].trim();
    result.country = 'India';
  } else {
    const states = ['Kerala', 'Karnataka', 'Tamil Nadu', 'Maharashtra', 'Delhi', 'Telangana', 'Andhra Pradesh', 'Gujarat', 'Rajasthan', 'Punjab', 'Haryana', 'Uttar Pradesh', 'West Bengal'];
    for (const s of states) {
      if (rawText.includes(s)) {
        result.state = s;
        result.country = 'India';
        break;
      }
    }
  }

  // --- Pincode ---
  const pinMatch = rawText.match(/\b[1-9]\d{5}\b/);
  if (pinMatch) result.pincode = pinMatch[0];

  // --- Total Experience ---
  // First try date range calculation (most accurate) — finds earliest "MM/YYYY - Present" entry
  let expFound = false;
  const dateRangePattern = /(\d{1,2})[\/\-](\d{4})\s*[-–—to]+\s*(present|current|now|till date)/gi;
  let earliestDate = null;
  let match;
  while ((match = dateRangePattern.exec(rawText)) !== null) {
    const month = parseInt(match[1]) - 1;
    const year = parseInt(match[2]);
    const date = new Date(year, month);
    if (!earliestDate || date < earliestDate) earliestDate = date;
  }
  if (earliestDate) {
    const now = new Date();
    const diffMs = now - earliestDate;
    const years = diffMs / (1000 * 60 * 60 * 24 * 365.25);
    result.totalExp = String(Math.floor(years));
    expFound = true;
  }
  // Fallback: explicit "X years of experience" text in resume
  if (!expFound) {
    for (const p of [/(\d+(?:\.\d+)?)\+?\s*years?\s+of\s+(?:hands-on\s+|professional\s+)?experience/i, /over\s+(\d+(?:\.\d+)?)\s*years?/i, /(\d+(?:\.\d+)?)\+?\s*yrs?\s+(?:of\s+)?experience/i]) {
      const m = rawText.match(p);
      if (m) {
        result.totalExp = m[1];
        break;
      }
    }
  }

  // --- Notice Period ---
  for (const p of [/notice\s+period[:\s]+(\d+)\s*days?/i, /(\d+)\s*days?\s+notice/i]) {
    const m = rawText.match(p);
    if (m) {
      result.noticeDays = m[1];
      break;
    }
  }

  // --- Current CTC ---
  const curCTCMatch = rawText.match(/current\s+(?:ctc|salary|package)[:\s]+(?:INR\s*|Rs\.?\s*)?(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?)/i);
  if (curCTCMatch) result.currentCTC = curCTCMatch[1];

  // --- Expected CTC ---
  const expCTCMatch = rawText.match(/expected\s+(?:ctc|salary|package)[:\s]+(?:INR\s*|Rs\.?\s*)?(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?)/i);
  if (expCTCMatch) result.expectedCTC = expCTCMatch[1];

  // --- Summary ---
  const summaryMatch = rawText.match(/SUMMARY\s*\n?\s*([^\n]{80,600})/i);
  if (summaryMatch) result.summary = summaryMatch[1].trim();

  // --- Skills ---
  const KNOWN_SKILLS = [
    'vue',
    'vue.js',
    'vuejs',
    'react',
    'react.js',
    'reactjs',
    'angular',
    'svelte',
    'javascript',
    'typescript',
    'node.js',
    'nodejs',
    'express',
    'express.js',
    'html',
    'css',
    'tailwind',
    'sass',
    'scss',
    'bootstrap',
    'postgresql',
    'postgres',
    'mysql',
    'mongodb',
    'sqlite',
    'redis',
    'elasticsearch',
    'sql',
    'nosql',
    'graphql',
    'rest api',
    'restful',
    'python',
    'django',
    'flask',
    'java',
    'spring',
    'php',
    'laravel',
    'docker',
    'kubernetes',
    'aws',
    'gcp',
    'azure',
    'git',
    'github',
    'gitlab',
    'vite',
    'webpack',
    'jest',
    'vitest',
    'cypress',
    'playwright',
    'pinia',
    'vuex',
    'redux',
    'zustand',
    'jwt',
    'oauth',
    'socket.io',
    'websocket',
    'react native',
    'flutter',
    'swift',
    'kotlin',
    'linux',
    'bash',
    'ci/cd',
    'jenkins',
    'github actions',
    'figma',
    'photoshop',
    'illustrator',
  ];
  const rawLower = rawText.toLowerCase();
  const foundSkills = KNOWN_SKILLS.filter((s) => rawLower.includes(s.toLowerCase()));
  if (foundSkills.length > 0) result.skills = foundSkills.join(', ');

  return result;
}
