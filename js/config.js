// Central configuration shared by every module. Change test length, timing
// and adaptive-flow parameters here; nothing else needs to be touched.

/** Number of questions in one test session. */
export const TEST_LENGTH = 30;

/** The level the adaptive staircase starts at. */
export const START_LEVEL = 'B1';

/** At most this many questions are drawn from a single level (keeps the mix balanced). */
export const MAX_PER_LEVEL = 10;

/** Desired share of each category across a session (used to choose the next question). */
export const CATEGORY_SHARE = { grammar: 0.45, vocabulary: 0.3, reading: 0.25 };

/** Seconds allowed per question when the optional timer is switched on. */
export const TIME_LIMITS = {
  'multiple-choice': 40,
  'fill-in-the-blank': 45,
  'word-formation': 45,
  reorder: 60,
  reading: 75,
};

/** Show a spoken warning (aria-live) when this many seconds remain. */
export const TIMER_WARNING_SECONDS = 10;

/** How many past results are kept in localStorage. */
export const HISTORY_LIMIT = 20;

/** Path of the question bank, relative to index.html (works on GitHub Pages sub-paths). */
export const QUESTIONS_URL = 'questions.json';

/** localStorage namespace. */
export const STORAGE_PREFIX = 'ea2:';
