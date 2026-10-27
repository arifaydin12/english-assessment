// Adaptive question selection (pure functions, seeded randomness).
//
// The test is a "staircase": it starts at B1, moves one level up after a good
// item and one level down after a poor one. To keep sessions balanced:
//   - no level supplies more than MAX_PER_LEVEL questions;
//   - the next question's category is chosen to track CATEGORY_SHARE;
//   - reading passages are served as a block (all their questions in a row).

import { LEVELS } from './scoring.js';
import { CATEGORY_SHARE, MAX_PER_LEVEL, TEST_LENGTH } from './config.js';
import { pick, rngFor } from './rng.js';

/**
 * Turn the raw bank into selectable "items": a single question, or a reading
 * passage with all of its questions.
 * Returns { items, byId, passages }.
 */
export function buildItems(bank) {
  const passages = new Map(bank.passages.map((p) => [p.id, p]));
  const byId = new Map(bank.questions.map((q) => [q.id, q]));
  const items = [];
  const blocks = new Map();
  for (const question of bank.questions) {
    if (question.passage) {
      if (!blocks.has(question.passage)) {
        blocks.set(question.passage, {
          id: question.passage,
          level: question.level,
          category: 'reading',
          questionIds: [],
        });
      }
      blocks.get(question.passage).questionIds.push(question.id);
    } else {
      items.push({ id: question.id, level: question.level, category: question.category, questionIds: [question.id] });
    }
  }
  items.push(...blocks.values());
  return { items, byId, passages };
}

/** Move the target level according to the share of the last item answered correctly. */
export function nextLevel(current, fractionCorrect) {
  const index = LEVELS.indexOf(current);
  if (fractionCorrect >= 0.66) return LEVELS[Math.min(LEVELS.length - 1, index + 1)];
  if (fractionCorrect <= 0.34) return LEVELS[Math.max(0, index - 1)];
  return current;
}

/** Levels ordered by distance from the target (lower level first on ties). */
export function levelsByDistance(target) {
  const index = LEVELS.indexOf(target);
  return LEVELS.map((level, i) => ({ level, distance: Math.abs(i - index), i }))
    .sort((a, b) => a.distance - b.distance || a.i - b.i)
    .map((entry) => entry.level);
}

/**
 * Choose the next item.
 * @param {object} args
 * @param {Array}  args.items      all items from buildItems()
 * @param {Set}    args.used       ids of items already served
 * @param {object} args.counts     { levels: {A1: n, ...}, categories: {grammar: n, ...} }
 * @param {number} args.answered   questions answered so far
 * @param {string} args.target     target level
 * @param {number|string} args.seed session seed
 * @param {number} [args.length]   total test length
 * @returns {object|null} an item, or null if nothing fits
 */
export function chooseItem({ items, used, counts, answered, target, seed, length = TEST_LENGTH, maxPerLevel = MAX_PER_LEVEL }) {
  const remaining = length - answered;
  if (remaining <= 0) return null;
  const rng = rngFor(seed, `pick:${answered}`);
  const available = items.filter((item) => !used.has(item.id) && item.questionIds.length <= remaining);

  for (const level of levelsByDistance(target)) {
    if ((counts.levels[level] || 0) >= maxPerLevel) continue;
    const candidates = available.filter((item) => item.level === level);
    if (candidates.length === 0) continue;
    return pickByCategoryDeficit(candidates, counts, answered, rng);
  }
  // Every capped level is exhausted: relax the cap rather than end early.
  if (available.length > 0) return pickByCategoryDeficit(available, counts, answered, rng);
  return null;
}

/** Prefer the category that is furthest below its target share. */
function pickByCategoryDeficit(candidates, counts, answered, rng) {
  const categories = [...new Set(candidates.map((c) => c.category))];
  let best = [];
  let bestDeficit = -Infinity;
  for (const category of categories) {
    const share = CATEGORY_SHARE[category] ?? 0.2;
    const deficit = share * (answered + 1) - (counts.categories[category] || 0);
    if (deficit > bestDeficit + 1e-9) {
      bestDeficit = deficit;
      best = [category];
    } else if (Math.abs(deficit - bestDeficit) <= 1e-9) {
      best.push(category);
    }
  }
  const category = pick(best, rng);
  return pick(candidates.filter((c) => c.category === category), rng);
}
