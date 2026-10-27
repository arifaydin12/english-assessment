import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEVELS } from '../js/scoring.js';
import { TEST_LENGTH, START_LEVEL, MAX_PER_LEVEL } from '../js/config.js';
import { nextLevel, levelsByDistance } from '../js/adaptive.js';
import { createRng } from '../js/rng.js';
import {
  createEngine,
  createSession,
  currentQuestion,
  submitAnswer,
  isResumable,
  prepareQuestion,
  progressOf,
  resultOf,
  timeLimitFor,
} from '../js/state.js';
import { TIME_LIMITS } from '../js/config.js';

const bank = JSON.parse(readFileSync(new URL('../questions.json', import.meta.url), 'utf8'));
const engine = createEngine(bank);

/** Play a whole session; `decide(question, index)` returns true to answer correctly. */
function play(seed, decide) {
  const session = createSession(engine, { seed, now: 0 });
  let index = 0;
  while (!session.finished) {
    const q = currentQuestion(session, engine);
    if (!q) break;
    const ok = decide(q, index);
    submitAnswer(session, engine, { answer: ok ? q.correct_answer : '', ms: 1500, skipped: !ok });
    index += 1;
  }
  return session;
}

test('nextLevel moves up, down or stays and is clamped to A1-C2', () => {
  assert.equal(nextLevel('B1', 1), 'B2');
  assert.equal(nextLevel('B1', 0), 'A2');
  assert.equal(nextLevel('B1', 0.5), 'B1');
  assert.equal(nextLevel('C2', 1), 'C2');
  assert.equal(nextLevel('A1', 0), 'A1');
  assert.equal(nextLevel('B1', 2 / 3), 'B2'); // 2 of 3 in a passage block
  assert.equal(nextLevel('B1', 1 / 3), 'A2');
});

test('levelsByDistance lists the target first and prefers the lower level on ties', () => {
  assert.deepEqual(levelsByDistance('B1'), ['B1', 'A2', 'B2', 'A1', 'C1', 'C2']);
  assert.equal(levelsByDistance('C2')[1], 'C1');
});

test('a session starts at the configured level', () => {
  const session = createSession(engine, { seed: 1 });
  assert.equal(session.level, START_LEVEL);
  assert.equal(START_LEVEL, 'B1');
  assert.equal(currentQuestion(session, engine).level, 'B1');
});

test('a session draws exactly TEST_LENGTH unique questions', () => {
  const session = play(7, (_q, i) => i % 2 === 0);
  assert.equal(session.responses.length, TEST_LENGTH);
  assert.equal(new Set(session.responses.map((r) => r.id)).size, TEST_LENGTH);
  assert.equal(session.finished, true);
  assert.equal(progressOf(session), 1);
  assert.equal(currentQuestion(session, engine), null);
});

test('correct answers move the test up, wrong answers move it down', () => {
  const allRight = play(11, () => true);
  const levelsRight = allRight.responses.map((r) => LEVELS.indexOf(r.level));
  assert.ok(levelsRight[1] > levelsRight[0], 'goes up after a correct answer');
  assert.equal(resultOf(allRight).level, 'C2');

  const allWrong = play(11, () => false);
  const levelsWrong = allWrong.responses.map((r) => LEVELS.indexOf(r.level));
  assert.ok(levelsWrong[1] < levelsWrong[0], 'goes down after a wrong answer');
  assert.equal(resultOf(allWrong).level, 'Pre-A1');
});

test('no level supplies more than MAX_PER_LEVEL questions (plus at most one passage block)', () => {
  for (const decide of [() => true, () => false, (_q, i) => i % 3 !== 0]) {
    const session = play(21, decide);
    const counts = {};
    for (const r of session.responses) counts[r.level] = (counts[r.level] || 0) + 1;
    for (const level of LEVELS) assert.ok((counts[level] || 0) <= MAX_PER_LEVEL + 2, `${level}: ${counts[level]}`);
  }
});

test('reading questions of a passage are served together', () => {
  for (let seed = 1; seed <= 20; seed += 1) {
    const session = play(seed, (_q, i) => i % 2 === 0);
    const ids = session.responses.map((r) => r.id);
    const passages = new Map();
    ids.forEach((id, position) => {
      const passage = engine.byId.get(id).passage;
      if (!passage) return;
      if (!passages.has(passage)) passages.set(passage, []);
      passages.get(passage).push(position);
    });
    for (const [passage, positions] of passages) {
      const expected = bank.questions.filter((q) => q.passage === passage).length;
      assert.equal(positions.length, expected, `${passage} served completely`);
      assert.equal(positions[positions.length - 1] - positions[0], positions.length - 1, `${passage} is contiguous`);
    }
  }
});

test('sessions include all three categories with a mixed balance', () => {
  const totals = { grammar: 0, vocabulary: 0, reading: 0 };
  for (let seed = 1; seed <= 30; seed += 1) {
    const rng = createRng(seed);
    const session = play(seed, () => rng() < 0.6);
    for (const r of session.responses) totals[r.category] += 1;
  }
  const sum = totals.grammar + totals.vocabulary + totals.reading;
  assert.ok(totals.grammar / sum > 0.3 && totals.grammar / sum < 0.6, JSON.stringify(totals));
  assert.ok(totals.vocabulary / sum > 0.15, JSON.stringify(totals));
  assert.ok(totals.reading / sum > 0.15, JSON.stringify(totals));
});

test('the same seed gives the same session; different seeds differ', () => {
  const a = play(5, (_q, i) => i % 2 === 0).responses.map((r) => r.id);
  const b = play(5, (_q, i) => i % 2 === 0).responses.map((r) => r.id);
  const c = play(6, (_q, i) => i % 2 === 0).responses.map((r) => r.id);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('a saved session can be restored through JSON and continued identically', () => {
  const decide = (_q, i) => i % 3 !== 1;
  const reference = play(9, decide);

  const session = createSession(engine, { seed: 9, now: 0 });
  for (let i = 0; i < 13; i += 1) {
    const q = currentQuestion(session, engine);
    const ok = decide(q, i);
    submitAnswer(session, engine, { answer: ok ? q.correct_answer : '', ms: 1500, skipped: !ok });
  }
  const restored = JSON.parse(JSON.stringify(session));
  assert.equal(isResumable(restored, engine), true);
  let i = 13;
  while (!restored.finished) {
    const q = currentQuestion(restored, engine);
    const ok = decide(q, i);
    submitAnswer(restored, engine, { answer: ok ? q.correct_answer : '', ms: 1500, skipped: !ok });
    i += 1;
  }
  assert.deepEqual(restored.responses.map((r) => r.id), reference.responses.map((r) => r.id));
});

test('isResumable rejects stale, finished or corrupt sessions', () => {
  const fresh = createSession(engine, { seed: 3 });
  assert.equal(isResumable(fresh, engine), true);
  assert.equal(isResumable({ ...fresh, bankVersion: 999 }, engine), false);
  assert.equal(isResumable({ ...fresh, finished: true }, engine), false);
  assert.equal(isResumable({ ...fresh, responses: [{ id: 'nope' }] }, engine), false);
  assert.equal(isResumable(null, engine), false);
  assert.equal(isResumable({ ...fresh, format: 0 }, engine), false);
});

test('timeouts and skips are recorded as wrong answers without an answer text', () => {
  const session = createSession(engine, { seed: 4 });
  submitAnswer(session, engine, { timedOut: true, ms: 40000 });
  submitAnswer(session, engine, { skipped: true });
  assert.deepEqual(session.responses.map((r) => r.correct), [false, false]);
  assert.equal(session.responses[0].timedOut, true);
  assert.equal(session.responses[1].skipped, true);
  assert.equal(session.responses[0].answer, '');
});

test('prepareQuestion shuffles options and reorder tokens deterministically', () => {
  const mc = bank.questions.find((q) => q.id === 'b1-02');
  const first = prepareQuestion(mc, 42);
  const again = prepareQuestion(mc, 42);
  assert.deepEqual(first.options, again.options);
  assert.deepEqual([...first.options].sort(), [...mc.answers].sort());

  for (const q of bank.questions.filter((x) => x.type === 'reorder')) {
    const p = prepareQuestion(q, 42);
    assert.equal(p.tokens.length, q.words.length);
    assert.notEqual(p.tokens.map((t) => t.text).join(' '), q.correct_answer, q.id);
    assert.deepEqual(p.tokens.map((t) => t.id).sort((x, y) => x - y), q.words.map((_, i) => i));
  }
});

test('timeLimitFor uses the reading limit for passage questions', () => {
  assert.equal(timeLimitFor(bank.questions.find((q) => q.passage), TIME_LIMITS), TIME_LIMITS.reading);
  assert.equal(timeLimitFor({ type: 'reorder' }, TIME_LIMITS), TIME_LIMITS.reorder);
});

test('simulated learners are placed within one level of their true level', () => {
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));
  let total = 0;
  let within = 0;
  for (let trueLevel = 0; trueLevel < 6; trueLevel += 1) {
    for (let run = 0; run < 25; run += 1) {
      const seed = trueLevel * 1000 + run + 1;
      const rng = createRng(seed);
      const session = play(seed, (q) => {
        const j = LEVELS.indexOf(q.level);
        let p = sigmoid(1.4 + 2.2 * (trueLevel - j));
        if (q.type === 'multiple-choice') p += (1 - p) * 0.25;
        return rng() < p;
      });
      const estimated = LEVELS.indexOf(resultOf(session).level);
      total += 1;
      if (Math.abs(estimated - trueLevel) <= 1) within += 1;
    }
  }
  assert.ok(within / total >= 0.95, `${within}/${total}`);
});
