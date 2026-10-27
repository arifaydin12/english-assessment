// localStorage wrapper. Every call is wrapped in try/catch so the app keeps
// working (without persistence) in private mode or when storage is blocked.

import { HISTORY_LIMIT, STORAGE_PREFIX } from './config.js';

const KEYS = {
  theme: 'theme',
  session: 'session',
  last: 'last-result',
  history: 'history',
  timer: 'timer-pref',
};

/** Create a storage API on top of any Storage-like backend (injectable for tests). */
export function createStorage(backend = safeLocalStorage()) {
  const read = (key, fallback = null) => {
    if (!backend) return fallback;
    try {
      const raw = backend.getItem(STORAGE_PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    if (!backend) return false;
    try {
      backend.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  };
  const remove = (key) => {
    if (!backend) return;
    try {
      backend.removeItem(STORAGE_PREFIX + key);
    } catch {
      /* ignore */
    }
  };

  return {
    available: Boolean(backend),

    // --- theme: 'light' | 'dark' | null (null = follow the system)
    getTheme() {
      const value = read(KEYS.theme);
      return value === 'light' || value === 'dark' ? value : null;
    },
    setTheme(theme) {
      write(KEYS.theme, theme);
    },

    // --- optional per-question timer preference
    getTimerPreference() {
      return read(KEYS.timer, false) === true;
    },
    setTimerPreference(enabled) {
      write(KEYS.timer, Boolean(enabled));
    },

    // --- in-progress session (auto-save / resume)
    loadSession() {
      return read(KEYS.session);
    },
    saveSession(session) {
      return write(KEYS.session, session);
    },
    clearSession() {
      remove(KEYS.session);
    },

    // --- last finished session (to reopen its result and review)
    loadLastResult() {
      return read(KEYS.last);
    },
    saveLastResult(session) {
      return write(KEYS.last, session);
    },

    // --- history of previous results (summaries only)
    loadHistory() {
      const list = read(KEYS.history, []);
      return Array.isArray(list) ? list : [];
    },
    addHistory(entry) {
      const list = [entry, ...this.loadHistory()].slice(0, HISTORY_LIMIT);
      write(KEYS.history, list);
      return list;
    },
    clearHistory() {
      remove(KEYS.history);
      remove(KEYS.last);
    },
  };
}

function safeLocalStorage() {
  try {
    const store = globalThis.localStorage;
    if (!store) return null;
    const probe = `${STORAGE_PREFIX}probe`;
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

/** Compact record of a finished session for the history list. */
export function historyEntry(result, now = Date.now()) {
  return {
    finishedAt: now,
    level: result.level,
    score: Math.round(result.score * 100),
    correct: result.correct,
    answered: result.answered,
    durationMs: result.durationMs,
    confidence: result.confidence.label,
  };
}
