import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVELS,
  LEVEL_WEIGHTS,
  PASS_RATIO,
  BELOW_A1,
  normalizeAnswer,
  isCorrect,
  chanceOf,
  correctForGuessing,
  levelBreakdown,
  imputedAccuracies,
  weightedScore,
  thresholdFor,
  thresholdTable,
  levelFromScore,
  categoryBreakdown,
  countInversions,
  estimate,
  formatDuration,
} from '../js/scoring.js';

/** Build n responses for a level with `correct` of them right (no guessing penalty). */
function responsesFor(level, total, correct, category = 'grammar', chance = 0) {
  return Array.from({ length: total }, (_, i) => ({ level, category, correct: i < correct, chance }));
}

test('normalizeAnswer ignores case, extra spaces, curly quotes and trailing punctuation', () => {
  assert.equal(normalizeAnswer('  Don\u2019t   Go! '), "don't go");
  assert.equal(normalizeAnswer(undefined), '');
  assert.equal(normalizeAnswer('Is.'), 'is');
});

test('isCorrect accepts the primary answer and alternatives for typed questions', () => {
  const q = { type: 'fill-in-the-blank', correct_answer: 'is', accepted_answers: ["'s"] };
  assert.equal(isCorrect(q, 'IS'), true);
  assert.equal(isCorrect(q, '  is '), true);
  assert.equal(isCorrect(q, "\u2019s"), true);
  assert.equal(isCorrect(q, 'are'), false);
  assert.equal(isCorrect(q, ''), false);
  assert.equal(isCorrect(q, '   '), false);
});

test('isCorrect compares multiple-choice and reorder answers', () => {
  const mc = { type: 'multiple-choice', answers: ['a', 'b', 'c'], correct_answer: 'b' };
  assert.equal(isCorrect(mc, 'b'), true);
  assert.equal(isCorrect(mc, 'a'), false);
  const reorder = { type: 'reorder', words: ['you', 'Where', 'do', 'live?'], correct_answer: 'Where do you live?' };
  assert.equal(isCorrect(reorder, 'where do you live?'), true);
  assert.equal(isCorrect(reorder, 'do you Where live?'), false);
});

test('chanceOf is 1/options for multiple choice and 0 otherwise', () => {
  assert.equal(chanceOf({ type: 'multiple-choice', answers: ['a', 'b', 'c', 'd'] }), 0.25);
  assert.equal(chanceOf({ type: 'fill-in-the-blank' }), 0);
  assert.equal(chanceOf({ type: 'reorder' }), 0);
});

test('correctForGuessing maps chance-level accuracy to zero and perfect to one', () => {
  assert.equal(correctForGuessing(0.25, 0.25), 0);
  assert.equal(correctForGuessing(1, 0.25), 1);
  assert.equal(correctForGuessing(0.1, 0.25), 0);
  assert.ok(Math.abs(correctForGuessing(0.625, 0.25) - 0.5) < 1e-12);
  assert.equal(correctForGuessing(0.7, 0), 0.7);
});

test('thresholds follow the documented formula', () => {
  assert.equal(PASS_RATIO, 0.6);
  const total = Object.values(LEVEL_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.equal(total, 21);
  const expected = { A1: 0.6 / 21, A2: 2.2 / 21, B1: 4.8 / 21, B2: 8.4 / 21, C1: 13 / 21, C2: 18.6 / 21 };
  for (const level of LEVELS) assert.ok(Math.abs(thresholdFor(level) - expected[level]) < 1e-12, level);
  const table = thresholdTable();
  assert.equal(table.length, 6);
  // cut-offs must be strictly increasing
  for (let i = 1; i < table.length; i += 1) assert.ok(table[i].threshold > table[i - 1].threshold);
  assert.throws(() => thresholdFor('D1'));
});

test('levelFromScore maps boundaries inclusively', () => {
  assert.equal(levelFromScore(0), BELOW_A1);
  assert.equal(levelFromScore(thresholdFor('A1') - 0.001), BELOW_A1);
  for (const level of LEVELS) {
    assert.equal(levelFromScore(thresholdFor(level)), level);
    assert.equal(levelFromScore(thresholdFor(level) + 0.001 > 1 ? 1 : thresholdFor(level) + 0.001), level);
  }
  assert.equal(levelFromScore(1), 'C2');
});

test('levelBreakdown counts answers per level', () => {
  const b = levelBreakdown([...responsesFor('B1', 4, 3), ...responsesFor('B2', 2, 0)]);
  assert.deepEqual([b.B1.correct, b.B1.total, b.B1.accuracy], [3, 4, 0.75]);
  assert.deepEqual([b.B2.correct, b.B2.total, b.B2.accuracy], [0, 2, 0]);
  assert.equal(b.A1.total, 0);
  assert.equal(b.A1.accuracy, null);
});

test('imputedAccuracies assumes mastery below and failure above the tested range', () => {
  const b = levelBreakdown([...responsesFor('B1', 4, 2), ...responsesFor('B2', 4, 1)]);
  const a = imputedAccuracies(b);
  assert.deepEqual([a.A1.accuracy, a.A1.imputed], [1, true]);
  assert.deepEqual([a.A2.accuracy, a.A2.imputed], [1, true]);
  assert.deepEqual([a.B1.accuracy, a.B1.imputed], [0.5, false]);
  assert.deepEqual([a.C1.accuracy, a.C1.imputed], [0, true]);
  assert.deepEqual([a.C2.accuracy, a.C2.imputed], [0, true]);
});

test('imputedAccuracies interpolates an untested level between two tested ones', () => {
  const b = levelBreakdown([...responsesFor('A2', 2, 2), ...responsesFor('B2', 2, 0)]);
  const a = imputedAccuracies(b);
  assert.equal(a.B1.accuracy, 0.5);
  assert.equal(a.B1.imputed, true);
});

test('weightedScore: perfect answers give 1, nothing right gives 0', () => {
  const perfect = LEVELS.flatMap((l) => responsesFor(l, 3, 3));
  const none = LEVELS.flatMap((l) => responsesFor(l, 3, 0));
  assert.equal(weightedScore(perfect), 1);
  assert.equal(weightedScore(none), 0);
  assert.equal(weightedScore([]), 0);
});

test('weightedScore weights harder levels more', () => {
  // All of A1 right and C2 wrong vs. the reverse - same raw score, different weighted score.
  const easyRight = [...responsesFor('A1', 4, 4), ...responsesFor('C2', 4, 0)];
  const hardRight = [...responsesFor('A1', 4, 0), ...responsesFor('C2', 4, 4)];
  assert.ok(weightedScore(hardRight) > weightedScore(easyRight));
});

test('guessing is neutralised: random-level accuracy on 4-option items scores near zero', () => {
  const guessers = LEVELS.flatMap((l) => responsesFor(l, 4, 1, 'grammar', 0.25));
  assert.equal(weightedScore(guessers), 0);
  assert.equal(estimate(guessers).level, BELOW_A1);
});

test('estimate: a learner who passes B1 comfortably but fails B2 lands on B1', () => {
  const responses = [
    ...responsesFor('A2', 3, 3),
    ...responsesFor('B1', 8, 6),
    ...responsesFor('B2', 8, 2),
    ...responsesFor('C1', 4, 0),
  ];
  const result = estimate(responses);
  assert.equal(result.level, 'B1');
  assert.equal(result.info.name, 'Intermediate');
  assert.equal(result.answered, 23);
  assert.equal(result.correct, 11);
});

test('estimate: top performer reaches C2 and a weak learner stays at A1', () => {
  const top = estimate([...responsesFor('B2', 6, 6), ...responsesFor('C1', 8, 8), ...responsesFor('C2', 8, 7)]);
  assert.equal(top.level, 'C2');
  const weak = estimate([...responsesFor('A1', 8, 6), ...responsesFor('A2', 8, 2), ...responsesFor('B1', 6, 0)]);
  assert.equal(weak.level, 'A1');
});

test('estimate: exactly 60% at a level (with lower levels mastered) reaches that level', () => {
  const result = estimate([...responsesFor('A2', 2, 2), ...responsesFor('B1', 10, 10), ...responsesFor('B2', 10, 6)]);
  assert.equal(result.level, 'B2');
  const just = estimate([...responsesFor('A2', 2, 2), ...responsesFor('B1', 10, 10), ...responsesFor('B2', 10, 5)]);
  assert.equal(just.level, 'B1');
});

test('estimate reports duration and tolerates an empty session', () => {
  const withTime = estimate(responsesFor('A1', 3, 3).map((r) => ({ ...r, ms: 2000 })));
  assert.equal(withTime.durationMs, 6000);
  const empty = estimate([]);
  assert.equal(empty.level, BELOW_A1);
  assert.equal(empty.confidence.label, 'low');
});

test('categoryBreakdown flags relative strengths and weaknesses', () => {
  const responses = [
    ...responsesFor('B1', 6, 6, 'grammar'),
    ...responsesFor('B1', 6, 3, 'vocabulary'),
    ...responsesFor('B1', 6, 0, 'reading'),
  ];
  const c = categoryBreakdown(responses);
  assert.equal(c.grammar.verdict, 'strength');
  assert.equal(c.vocabulary.verdict, 'typical');
  assert.equal(c.reading.verdict, 'weakness');
  assert.equal(c.grammar.total, 6);
  const sparse = categoryBreakdown(responsesFor('B1', 2, 2, 'grammar'));
  assert.equal(sparse.grammar.verdict, 'insufficient');
  assert.equal(sparse.reading.accuracy, null);
});

test('countInversions detects a harder level answered much better than an easier one', () => {
  const odd = levelBreakdown([...responsesFor('B1', 4, 1), ...responsesFor('B2', 4, 4)]);
  assert.equal(countInversions(odd), 1);
  const normal = levelBreakdown([...responsesFor('B1', 4, 4), ...responsesFor('B2', 4, 1)]);
  assert.equal(countInversions(normal), 0);
});

test('confidence: a full, consistent session is high; a short session is low', () => {
  const full = estimate([
    ...responsesFor('A2', 4, 4),
    ...responsesFor('B1', 8, 7),
    ...responsesFor('B2', 8, 2),
    ...responsesFor('C1', 4, 0),
  ]);
  assert.equal(full.confidence.label, 'high');
  const short = estimate([...responsesFor('B1', 3, 2), ...responsesFor('B2', 2, 1)]);
  assert.equal(short.confidence.label, 'low');
  assert.match(short.confidence.note, /^Low confidence/);
});

test('confidence is low when nothing is answered correctly (floor effect)', () => {
  const none = estimate(LEVELS.slice(0, 3).flatMap((l) => responsesFor(l, 10, 0)));
  assert.equal(none.level, BELOW_A1);
  assert.equal(none.confidence.label, 'low');
  assert.match(none.confidence.detail, /cannot measure lower levels/);
});

test('confidence mentions a boundary when the score sits on a cut-off', () => {
  const border = estimate([...responsesFor('A2', 2, 2), ...responsesFor('B1', 10, 10), ...responsesFor('B2', 10, 6)]);
  assert.ok(border.confidence.margin < 0.04);
  assert.notEqual(border.confidence.label, 'high');
});

test('formatDuration formats seconds and minutes', () => {
  assert.equal(formatDuration(42_000), '42 s');
  assert.equal(formatDuration(125_000), '2 min 05 s');
  assert.equal(formatDuration(-5), '0 s');
});
