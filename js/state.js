// Test-session state machine. A session is a plain JSON object so it can be
// saved to localStorage and resumed later. All randomness is derived from
// `session.seed`, so a resumed session behaves exactly like the original.

import { TEST_LENGTH, START_LEVEL } from './config.js';
import { buildItems, chooseItem, nextLevel } from './adaptive.js';
import { estimate, isCorrect, chanceOf, LEVELS, CATEGORIES } from './scoring.js';
import { rngFor, shuffle } from './rng.js';

export const SESSION_FORMAT = 1;

/** Prepare the bank once (indexes, passage blocks). */
export function createEngine(bank) {
  const { items, byId, passages } = buildItems(bank);
  return { bank, items, byId, passages, bankVersion: bank.version };
}

/** Start a brand-new session. `now` is injectable for tests. */
export function createSession(engine, { seed = Math.floor(Math.random() * 2 ** 31), timer = false, now = Date.now() } = {}) {
  return {
    format: SESSION_FORMAT,
    bankVersion: engine.bankVersion,
    seed,
    startedAt: now,
    timer: Boolean(timer),
    level: START_LEVEL,
    responses: [],
    queue: [],
    block: null,
    used: [],
    finished: false,
  };
}

/** Check that a session loaded from storage can be used with the current bank. */
export function isResumable(session, engine) {
  if (!session || session.format !== SESSION_FORMAT) return false;
  if (session.bankVersion !== engine.bankVersion) return false;
  if (!Array.isArray(session.responses) || !Array.isArray(session.queue) || !Array.isArray(session.used)) return false;
  if (session.finished) return false;
  if (!LEVELS.includes(session.level)) return false;
  const known = (id) => engine.byId.has(id);
  return session.responses.every((r) => known(r.id)) && session.queue.every(known);
}

function tallies(responses) {
  const levels = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  const categories = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const r of responses) {
    levels[r.level] += 1;
    categories[r.category] += 1;
  }
  return { levels, categories };
}

/** Make sure `session.queue` holds the questions of the current item. Mutates the session. */
export function ensureQueue(session, engine) {
  if (session.finished || session.queue.length > 0) return session;
  if (session.responses.length >= TEST_LENGTH) {
    session.finished = true;
    return session;
  }
  const item = chooseItem({
    items: engine.items,
    used: new Set(session.used),
    counts: tallies(session.responses),
    answered: session.responses.length,
    target: session.level,
    seed: session.seed,
  });
  if (!item) {
    session.finished = true;
    return session;
  }
  session.used.push(item.id);
  session.queue = item.questionIds.slice();
  session.block = { startIndex: session.responses.length, size: item.questionIds.length };
  return session;
}

/** The question currently waiting for an answer (or null when the test is over). */
export function currentQuestion(session, engine) {
  ensureQueue(session, engine);
  if (session.finished || session.queue.length === 0) return null;
  return engine.byId.get(session.queue[0]);
}

/**
 * Record an answer to the current question and advance the staircase.
 * Mutates and returns the session.
 */
export function submitAnswer(session, engine, { answer = '', ms = 0, timedOut = false, skipped = false } = {}) {
  const question = currentQuestion(session, engine);
  if (!question) throw new Error('No question is waiting for an answer.');
  const correct = !skipped && !timedOut && isCorrect(question, answer);
  session.responses.push({
    id: question.id,
    level: question.level,
    category: question.category,
    type: question.type,
    chance: chanceOf(question),
    answer: skipped || timedOut ? '' : String(answer),
    correct,
    ms: Math.max(0, Math.round(ms)),
    skipped: Boolean(skipped),
    timedOut: Boolean(timedOut),
  });
  session.queue.shift();

  if (session.queue.length === 0 && session.block) {
    const blockResponses = session.responses.slice(session.block.startIndex);
    const fraction = blockResponses.filter((r) => r.correct).length / blockResponses.length;
    session.level = nextLevel(session.level, fraction);
    session.block = null;
  }
  if (session.responses.length >= TEST_LENGTH && session.queue.length === 0) session.finished = true;
  return session;
}

/** 1-based number of the question currently shown. */
export function questionNumber(session) {
  return session.responses.length + 1;
}

/** Fraction of the test completed (0-1). */
export function progressOf(session) {
  return Math.min(1, session.responses.length / TEST_LENGTH);
}

/** Final result (CEFR estimate, breakdowns, confidence). */
export function resultOf(session) {
  return estimate(session.responses);
}

/**
 * Presentation data for a question: options are shuffled (seeded per session and
 * question) so keys 1-4 do not always map to the same answer.
 */
export function prepareQuestion(question, seed) {
  const rng = rngFor(seed, `layout:${question.id}`);
  const prepared = { ...question };
  if (question.type === 'multiple-choice') {
    prepared.options = shuffle(question.answers, rng);
  }
  if (question.type === 'reorder') {
    let order = shuffle(question.words.map((_, i) => i), rng);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (order.map((i) => question.words[i]).join(' ') !== question.correct_answer) break;
      order = shuffle(order, rng);
    }
    prepared.tokens = order.map((i) => ({ id: i, text: question.words[i] }));
  }
  return prepared;
}

/** The time limit (seconds) for a question when the timer is enabled. */
export function timeLimitFor(question, limits) {
  if (question.passage) return limits.reading;
  return limits[question.type] ?? 45;
}
