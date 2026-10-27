#!/usr/bin/env node
// Validates questions.json: schema, uniqueness, answer consistency and coverage.
// Usage:  node scripts/validate-questions.js [path/to/questions.json]
// Exit code 0 = valid, 1 = problems found.

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const CATEGORIES = ['grammar', 'vocabulary', 'reading'];
export const TYPES = ['multiple-choice', 'fill-in-the-blank', 'reorder', 'word-formation'];
export const MIN_PER_LEVEL = 15;

// Anything outside printable ASCII (plus a few typographic marks) is rejected so
// that no text in another language can slip into the bank.
const FORBIDDEN_CHARACTERS = /[^\x20-\x7E\u2018\u2019\u201C\u201D\u2013\u2014\u2026]/;

const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const tokens = (sentence) => sentence.trim().split(/\s+/).sort().join('\u0000');

/** Returns an array of human-readable problems (empty when the bank is valid). */
export function validateBank(bank) {
  const errors = [];
  const err = (id, message) => errors.push(`${id}: ${message}`);

  if (!bank || typeof bank !== 'object') return ['Bank must be a JSON object.'];
  if (!Number.isInteger(bank.version)) err('bank', '"version" must be an integer.');
  if (!Array.isArray(bank.passages)) err('bank', '"passages" must be an array.');
  if (!Array.isArray(bank.questions)) err('bank', '"questions" must be an array.');
  if (errors.length) return errors;

  // ---- passages
  const passages = new Map();
  for (const passage of bank.passages) {
    const id = passage.id || '(passage without id)';
    if (!/^p-[a-c][12]-\d+$/.test(passage.id || '')) err(id, 'passage id must look like "p-b1-1".');
    if (passages.has(passage.id)) err(id, 'duplicate passage id.');
    passages.set(passage.id, passage);
    if (!LEVELS.includes(passage.level)) err(id, `unknown level "${passage.level}".`);
    if (!isText(passage.title)) err(id, 'missing title.');
    if (!isText(passage.text) || passage.text.length < 60) err(id, 'text is missing or too short.');
    for (const field of ['title', 'text']) {
      if (FORBIDDEN_CHARACTERS.test(passage[field] || '')) err(id, `"${field}" contains unsupported characters.`);
    }
  }

  // ---- questions
  const ids = new Set();
  const seenTexts = new Set();
  const perLevel = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  const typesPerLevel = Object.fromEntries(LEVELS.map((l) => [l, new Set()]));
  const passageUse = new Map();

  for (const q of bank.questions) {
    const id = q.id || '(question without id)';
    if (!/^[a-c][12]-\d{2}$/.test(q.id || '')) err(id, 'id must look like "b1-07".');
    if (ids.has(q.id)) err(id, 'duplicate id.');
    ids.add(q.id);

    if (!LEVELS.includes(q.level)) err(id, `unknown level "${q.level}".`);
    else perLevel[q.level] += 1;
    if (q.id && q.level && q.id.slice(0, 2) !== q.level.toLowerCase()) err(id, 'id prefix does not match level.');
    if (!CATEGORIES.includes(q.category)) err(id, `unknown category "${q.category}".`);
    if (!TYPES.includes(q.type)) err(id, `unknown type "${q.type}".`);
    else if (LEVELS.includes(q.level)) typesPerLevel[q.level].add(q.type);

    if (!isText(q.question)) err(id, 'missing question text.');
    if (!isText(q.explanation)) err(id, 'missing explanation.');
    else if (q.explanation.length > 220) err(id, 'explanation is longer than 220 characters.');
    if (!isText(q.correct_answer)) err(id, 'missing correct_answer.');

    for (const field of ['question', 'explanation', 'correct_answer', 'base']) {
      if (q[field] !== undefined && FORBIDDEN_CHARACTERS.test(q[field])) err(id, `"${field}" contains unsupported characters.`);
    }
    for (const list of [q.answers, q.words, q.accepted_answers]) {
      if (Array.isArray(list) && list.some((item) => FORBIDDEN_CHARACTERS.test(item))) err(id, 'a list entry contains unsupported characters.');
    }

    const dedupeKey = `${q.passage || ''}|${(q.question || '').toLowerCase()}|${q.type === 'reorder' ? q.correct_answer : ''}`;
    if (seenTexts.has(dedupeKey)) err(id, 'question text duplicates another question.');
    seenTexts.add(dedupeKey);

    // category/passage consistency
    if (q.category === 'reading' && !q.passage) err(id, 'reading questions need a "passage".');
    if (q.passage) {
      const passage = passages.get(q.passage);
      if (!passage) err(id, `unknown passage "${q.passage}".`);
      else if (passage.level !== q.level) err(id, 'question level differs from its passage level.');
      if (q.category !== 'reading') err(id, 'questions with a passage must use category "reading".');
      if (q.type !== 'multiple-choice') err(id, 'reading questions must be multiple-choice.');
      passageUse.set(q.passage, (passageUse.get(q.passage) || 0) + 1);
    }

    // type-specific rules
    if (q.accepted_answers !== undefined) {
      if (!Array.isArray(q.accepted_answers) || !q.accepted_answers.every(isText)) err(id, 'accepted_answers must be an array of non-empty strings.');
      else if (q.type === 'multiple-choice') err(id, 'accepted_answers is not used by multiple-choice questions.');
    }
    switch (q.type) {
      case 'multiple-choice': {
        if (!Array.isArray(q.answers) || q.answers.length < 3 || q.answers.length > 4) err(id, '"answers" must contain 3 or 4 options.');
        else {
          if (!q.answers.every(isText)) err(id, 'answers must be non-empty strings.');
          const lowered = q.answers.map((a) => String(a).trim().toLowerCase());
          if (new Set(lowered).size !== lowered.length) err(id, 'answers contain duplicates.');
          if (q.answers.filter((a) => a === q.correct_answer).length !== 1) err(id, 'correct_answer must appear exactly once in answers.');
        }
        break;
      }
      case 'fill-in-the-blank':
      case 'word-formation': {
        if ((q.question.match(/___/g) || []).length !== 1) err(id, 'question must contain exactly one "___" blank.');
        if (q.answers !== undefined) err(id, 'typed questions must not have "answers".');
        if (q.type === 'word-formation' && !/^[A-Z]+$/.test(q.base || '')) err(id, 'word-formation needs an uppercase "base" word.');
        const all = [q.correct_answer, ...(q.accepted_answers || [])].map((a) => String(a).trim().toLowerCase());
        if (new Set(all).size !== all.length) err(id, 'duplicate accepted answers.');
        break;
      }
      case 'reorder': {
        if (!Array.isArray(q.words) || q.words.length < 4 || q.words.length > 9) err(id, '"words" must hold 4-9 tokens (keys 1-9 pick them).');
        else {
          const expected = tokens(q.words.join(' '));
          for (const sentence of [q.correct_answer, ...(q.accepted_answers || [])]) {
            if (tokens(String(sentence)) !== expected) err(id, `"${sentence}" does not use exactly the given words.`);
          }
          if (q.words.join(' ') === q.correct_answer) err(id, 'words are already in the correct order.');
          if (q.words.some((w) => /\s/.test(w))) err(id, 'each word token must be a single word.');
        }
        break;
      }
      default:
        break;
    }
  }

  // ---- passages must be used by 2-3 questions
  for (const [passageId] of passages) {
    const used = passageUse.get(passageId) || 0;
    if (used < 2 || used > 3) err(passageId, `passage is used by ${used} questions (expected 2-3).`);
  }

  // ---- coverage
  for (const level of LEVELS) {
    if (perLevel[level] < MIN_PER_LEVEL) err(level, `has ${perLevel[level]} questions (minimum ${MIN_PER_LEVEL}).`);
    for (const type of TYPES) {
      if (!typesPerLevel[level].has(type)) err(level, `has no "${type}" question.`);
    }
    if (!passages.size || ![...passages.values()].some((p) => p.level === level)) err(level, 'has no reading passage.');
  }
  return errors;
}

/** Summary counts for the CLI report. */
export function summarize(bank) {
  const summary = { total: bank.questions.length, passages: bank.passages.length, levels: {}, types: {}, categories: {} };
  for (const q of bank.questions) {
    summary.levels[q.level] = (summary.levels[q.level] || 0) + 1;
    summary.types[q.type] = (summary.types[q.type] || 0) + 1;
    summary.categories[q.category] = (summary.categories[q.category] || 0) + 1;
  }
  return summary;
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(here, '..', 'questions.json');
  let bank;
  try {
    bank = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`Cannot read ${file}: ${error.message}`);
    process.exit(1);
  }
  const errors = validateBank(bank);
  if (errors.length) {
    console.error(`Found ${errors.length} problem(s) in ${path.basename(file)}:`);
    for (const message of errors) console.error(`  - ${message}`);
    process.exit(1);
  }
  const s = summarize(bank);
  console.log(`OK: ${s.total} questions, ${s.passages} reading passages.`);
  console.log('  per level:   ', JSON.stringify(s.levels));
  console.log('  per type:    ', JSON.stringify(s.types));
  console.log('  per category:', JSON.stringify(s.categories));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
