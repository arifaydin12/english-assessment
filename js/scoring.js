// Pure scoring logic (no DOM, no storage) so it can be unit-tested with node:test.
//
// SCORING METHOD (summarised; the README has the full description)
// ------------------------------------------------------------------
// 1. Every answered question is grouped by its CEFR level. For each level we
//    compute the accuracy p(L) = correct / answered, corrected for blind guessing
//    (a 4-option question can be guessed 25 % of the time): (p - c) / (1 - c).
// 2. Levels that the adaptive test did not need to ask are imputed:
//      - below the lowest tested level  -> p = 1  (assumed mastered)
//      - above the highest tested level -> p = 0  (assumed not reached)
//      - untested levels in between      -> average of the nearest tested neighbours.
// 3. The level-weighted score is  S = sum(w(L) * p(L)) / sum(w(L))  with
//    weights A1=1, A2=2, B1=3, B2=4, C1=5, C2=6, so that harder levels count more.
// 4. A level is "reached" when a learner masters every lower level and answers at
//    least PASS_RATIO (60 %) of that level correctly. The cut-off score for level k
//    is therefore  T(k) = ( sum_{i<k} w(i) + PASS_RATIO * w(k) ) / sum(w).
//    The estimate is the highest level whose cut-off S reaches.
// 5. A confidence rating is derived from the number of answers, the amount of
//    evidence near the estimated level, the distance to the nearest cut-off and
//    the consistency of the per-level accuracies.

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const CATEGORIES = ['grammar', 'vocabulary', 'reading'];

/** Relative importance of each level in the weighted score. */
export const LEVEL_WEIGHTS = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

/** Share of a level's questions that must be answered correctly to count as "reached". */
export const PASS_RATIO = 0.6;

/** Label used when the score is below the A1 cut-off. */
export const BELOW_A1 = 'Pre-A1';

export const LEVEL_INFO = {
  [BELOW_A1]: {
    name: 'Beginner',
    summary: 'You are at the very start of your English journey. Focus on everyday words, simple present sentences and the verb "to be".',
  },
  A1: {
    name: 'Beginner',
    summary: 'You can understand and use familiar everyday expressions and very basic phrases, introduce yourself and ask simple questions.',
  },
  A2: {
    name: 'Elementary',
    summary: 'You can handle simple, routine exchanges and describe your background, surroundings and immediate needs in simple terms.',
  },
  B1: {
    name: 'Intermediate',
    summary: 'You can deal with most situations while travelling, describe experiences and plans, and give brief reasons and explanations.',
  },
  B2: {
    name: 'Upper-Intermediate',
    summary: 'You can follow complex texts on concrete and abstract topics and interact fluently with native speakers without strain.',
  },
  C1: {
    name: 'Advanced',
    summary: 'You can understand demanding, longer texts, express yourself fluently and flexibly, and use language effectively for work and study.',
  },
  C2: {
    name: 'Proficient',
    summary: 'You can understand virtually everything, summarise information from different sources and express yourself precisely, even in complex situations.',
  },
};

const TOTAL_WEIGHT = LEVELS.reduce((sum, level) => sum + LEVEL_WEIGHTS[level], 0);
const EPSILON = 1e-9;

// ---------------------------------------------------------------- answers

/**
 * Normalise a typed answer for comparison: case-insensitive, whitespace-insensitive,
 * curly quotes become straight quotes, trailing sentence punctuation is ignored.
 */
export function normalizeAnswer(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?,;:]+$/, '')
    .trim();
}

/** All answers accepted for a question (primary answer first). */
export function acceptedAnswers(question) {
  return [question.correct_answer, ...(question.accepted_answers || [])];
}

/** Probability of answering a question right by blind guessing (0 for typed answers). */
export function chanceOf(question) {
  return question.type === 'multiple-choice' && Array.isArray(question.answers) ? 1 / question.answers.length : 0;
}

/** Check one response against a question. Empty answers are always wrong. */
export function isCorrect(question, answer) {
  const given = normalizeAnswer(answer);
  if (given === '') return false;
  return acceptedAnswers(question).some((candidate) => normalizeAnswer(candidate) === given);
}

// -------------------------------------------------------------- breakdowns

/**
 * Per-level totals. `responses` need only carry `level` and `correct`.
 * Returns { A1: { correct, total, accuracy|null }, ... }.
 */
export function levelBreakdown(responses) {
  const result = {};
  for (const level of LEVELS) result[level] = { correct: 0, total: 0, chance: 0, accuracy: null, adjusted: null };
  for (const response of responses) {
    const bucket = result[response.level];
    if (!bucket) continue;
    bucket.total += 1;
    bucket.chance += response.chance || 0;
    if (response.correct) bucket.correct += 1;
  }
  for (const level of LEVELS) {
    const bucket = result[level];
    if (bucket.total === 0) continue;
    bucket.accuracy = bucket.correct / bucket.total;
    bucket.adjusted = correctForGuessing(bucket.accuracy, bucket.chance / bucket.total);
  }
  return result;
}

/**
 * Remove the expected effect of blind guessing: with a 25 % chance of guessing
 * right, 25 % observed accuracy means "no knowledge" (0 after correction).
 */
export function correctForGuessing(accuracy, chance) {
  if (chance >= 1) return 0;
  return Math.min(1, Math.max(0, (accuracy - chance) / (1 - chance)));
}

/**
 * Accuracy per level after imputing the levels that were not tested
 * (see the method description at the top of this file).
 * Returns { A1: { accuracy, imputed }, ... }.
 */
export function imputedAccuracies(breakdown) {
  const tested = LEVELS.filter((level) => breakdown[level].total > 0);
  const result = {};
  if (tested.length === 0) {
    for (const level of LEVELS) result[level] = { accuracy: 0, imputed: true };
    return result;
  }
  const lowest = LEVELS.indexOf(tested[0]);
  const highest = LEVELS.indexOf(tested[tested.length - 1]);
  LEVELS.forEach((level, index) => {
    if (breakdown[level].total > 0) {
      result[level] = { accuracy: breakdown[level].adjusted, imputed: false };
    } else if (index < lowest) {
      result[level] = { accuracy: 1, imputed: true };
    } else if (index > highest) {
      result[level] = { accuracy: 0, imputed: true };
    } else {
      // Untested level between two tested levels: average the nearest neighbours.
      let below = index - 1;
      while (breakdown[LEVELS[below]].total === 0) below -= 1;
      let above = index + 1;
      while (breakdown[LEVELS[above]].total === 0) above += 1;
      result[level] = {
        accuracy: (breakdown[LEVELS[below]].adjusted + breakdown[LEVELS[above]].adjusted) / 2,
        imputed: true,
      };
    }
  });
  return result;
}

/** Level-weighted score between 0 and 1. */
export function weightedScore(responses) {
  const accuracies = imputedAccuracies(levelBreakdown(responses));
  const sum = LEVELS.reduce((total, level) => total + LEVEL_WEIGHTS[level] * accuracies[level].accuracy, 0);
  return sum / TOTAL_WEIGHT;
}

/** Cut-off score (0-1) that must be reached for a level, derived from the weights. */
export function thresholdFor(level) {
  const index = LEVELS.indexOf(level);
  if (index < 0) throw new Error(`Unknown level: ${level}`);
  const mastered = LEVELS.slice(0, index).reduce((sum, l) => sum + LEVEL_WEIGHTS[l], 0);
  return (mastered + PASS_RATIO * LEVEL_WEIGHTS[level]) / TOTAL_WEIGHT;
}

/** Table of cut-offs, e.g. for documentation: [{ level, threshold }]. */
export function thresholdTable() {
  return LEVELS.map((level) => ({ level, threshold: thresholdFor(level) }));
}

/** Map a weighted score to a CEFR level (or BELOW_A1). */
export function levelFromScore(score) {
  let result = BELOW_A1;
  for (const level of LEVELS) {
    if (score + EPSILON >= thresholdFor(level)) result = level;
  }
  return result;
}

// ------------------------------------------------------------ categories

/**
 * Accuracy per category plus a level-weighted accuracy. Strengths and
 * weaknesses are judged *relative to the learner's overall performance*, because
 * adaptive tests give every learner roughly 50-70 % accuracy on average.
 */
export function categoryBreakdown(responses) {
  const overall = weightedAccuracy(responses);
  const result = {};
  for (const category of CATEGORIES) {
    const subset = responses.filter((r) => r.category === category);
    const correct = subset.filter((r) => r.correct).length;
    const weighted = weightedAccuracy(subset);
    let verdict = 'insufficient';
    if (subset.length >= 3) {
      const gap = weighted - overall;
      verdict = gap >= 0.1 ? 'strength' : gap <= -0.1 ? 'weakness' : 'typical';
    }
    result[category] = {
      correct,
      total: subset.length,
      accuracy: subset.length ? correct / subset.length : null,
      weightedAccuracy: subset.length ? weighted : null,
      verdict,
    };
  }
  return result;
}

/**
 * Level-weighted, guess-corrected accuracy: harder questions count more and the
 * chance of guessing a multiple-choice item is subtracted.
 */
export function weightedAccuracy(responses) {
  let earned = 0;
  let possible = 0;
  for (const response of responses) {
    const weight = LEVEL_WEIGHTS[response.level] || 0;
    const chance = response.chance || 0;
    possible += weight * (1 - chance);
    earned += weight * ((response.correct ? 1 : 0) - chance);
  }
  return possible <= 0 ? 0 : Math.max(0, earned / possible);
}

// ------------------------------------------------------------ confidence

/**
 * Rate how much trust the estimate deserves.
 * Points (max 6): number of answers (0-2), evidence at / next to the estimated
 * level (0-2), distance from the nearest cut-off (0-1), consistency (0-1).
 * >= 5 high, >= 3 medium, otherwise low. Results below A1 are capped at low.
 */
export function confidenceFor(responses, breakdown, score, level) {
  const answered = responses.length;
  const reasons = [];
  let points = 0;

  if (answered >= 24) points += 2;
  else if (answered >= 12) points += 1;
  if (answered < 24) reasons.push(`only ${answered} questions were answered`);

  const levelIndex = Math.max(0, LEVELS.indexOf(level));
  const near = [LEVELS[levelIndex], LEVELS[levelIndex + 1]].filter(Boolean);
  const nearCount = near.reduce((sum, l) => sum + breakdown[l].total, 0);
  if (nearCount >= 12) points += 2;
  else if (nearCount >= 6) points += 1;
  if (nearCount < 12) reasons.push('few questions were asked at your estimated level');

  const cutoffs = LEVELS.map(thresholdFor);
  const margin = Math.min(...cutoffs.map((cutoff) => Math.abs(score - cutoff)));
  if (margin >= 0.04) points += 1;
  else reasons.push('your score is close to a level boundary');

  if (countInversions(breakdown) === 0) points += 1;
  else reasons.push('your results were uneven across neighbouring levels');

  if (level === BELOW_A1) {
    // Floor effect: the bank starts at A1, so nothing below it can be measured.
    points = Math.min(points, 2);
    reasons.push('the test starts at A1 and cannot measure lower levels');
  }

  const label = points >= 5 ? 'high' : points >= 3 ? 'medium' : 'low';
  const reasonText = reasons.length ? `${reasons.join('; ').replace(/^./, (c) => c.toUpperCase())}.` : '';
  const detail = {
    high: 'You answered enough questions near your level and your results were consistent.',
    medium: `${reasonText || 'The evidence is reasonable.'} Retaking the test may shift the result by one level.`,
    low: `${reasonText || 'The evidence is limited.'} Treat this as a rough guide and retake the test for a clearer picture.`,
  }[label];
  const note = `${label[0].toUpperCase()}${label.slice(1)} confidence: ${detail}`;
  return { label, points, note, detail, margin };
}

/** Number of neighbouring tested levels where the harder one was clearly answered better. */
export function countInversions(breakdown) {
  let inversions = 0;
  for (let i = 0; i < LEVELS.length - 1; i += 1) {
    const lower = breakdown[LEVELS[i]];
    const higher = breakdown[LEVELS[i + 1]];
    if (lower.total >= 2 && higher.total >= 2 && higher.accuracy - lower.accuracy > 0.25) inversions += 1;
  }
  return inversions;
}

// --------------------------------------------------------------- summary

/**
 * Full result for a set of responses. Each response needs:
 * { level, category, correct, ms? }.
 */
export function estimate(responses) {
  const perLevel = levelBreakdown(responses);
  const accuracies = imputedAccuracies(perLevel);
  const score = weightedScore(responses);
  const level = levelFromScore(score);
  const correct = responses.filter((r) => r.correct).length;
  const durationMs = responses.reduce((sum, r) => sum + (r.ms || 0), 0);
  return {
    level,
    info: LEVEL_INFO[level],
    score,
    answered: responses.length,
    correct,
    rawPercent: responses.length ? correct / responses.length : 0,
    durationMs,
    perLevel,
    imputed: accuracies,
    perCategory: categoryBreakdown(responses),
    confidence: confidenceFor(responses, perLevel, score, level),
  };
}

/** Human-readable duration such as "12 min 05 s". */
export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} s`;
  return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
}
