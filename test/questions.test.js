import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateBank, summarize, LEVELS, MIN_PER_LEVEL } from '../scripts/validate-questions.js';

const bank = JSON.parse(readFileSync(new URL('../questions.json', import.meta.url), 'utf8'));

test('the shipped question bank passes validation', () => {
  assert.deepEqual(validateBank(bank), []);
});

test('the bank has at least 90 questions and 15 per level', () => {
  const summary = summarize(bank);
  assert.ok(summary.total >= 90);
  for (const level of LEVELS) assert.ok(summary.levels[level] >= MIN_PER_LEVEL, level);
});

test('every question type is represented', () => {
  const types = new Set(bank.questions.map((q) => q.type));
  for (const type of ['multiple-choice', 'fill-in-the-blank', 'reorder', 'word-formation']) assert.ok(types.has(type), type);
  assert.ok(bank.questions.some((q) => q.passage));
});

test('validator catches common mistakes', () => {
  const clone = () => JSON.parse(JSON.stringify(bank));

  let broken = clone();
  broken.questions[1].id = broken.questions[0].id;
  assert.ok(validateBank(broken).some((e) => /duplicate id/.test(e)));

  broken = clone();
  broken.questions[0].correct_answer = 'not an option';
  assert.ok(validateBank(broken).some((e) => /correct_answer must appear exactly once/.test(e)));

  broken = clone();
  broken.questions[0].explanation = '';
  assert.ok(validateBank(broken).some((e) => /missing explanation/.test(e)));

  broken = clone();
  const reorder = broken.questions.find((q) => q.type === 'reorder');
  reorder.words = ['zzz', ...reorder.words.slice(1)];
  assert.ok(validateBank(broken).some((e) => /does not use exactly the given words/.test(e)));

  broken = clone();
  broken.questions[0].question = 'Caf\u00e9 \u00e7 \u015f?';
  assert.ok(validateBank(broken).some((e) => /unsupported characters/.test(e)));

  broken = clone();
  broken.questions = broken.questions.filter((q) => q.level !== 'C2' || q.passage);
  assert.ok(validateBank(broken).some((e) => /C2: has \d+ questions/.test(e)));

  broken = clone();
  broken.questions.find((q) => q.passage).passage = 'p-zz-9';
  assert.ok(validateBank(broken).some((e) => /unknown passage/.test(e)));
});

test('typed questions accept their own correct answers', async () => {
  const { isCorrect } = await import('../js/scoring.js');
  for (const q of bank.questions) {
    assert.equal(isCorrect(q, q.correct_answer), true, q.id);
    for (const alt of q.accepted_answers || []) assert.equal(isCorrect(q, alt.toUpperCase()), true, `${q.id} ${alt}`);
  }
});
