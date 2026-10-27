import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, historyEntry } from '../js/storage.js';
import { HISTORY_LIMIT } from '../js/config.js';

/** Minimal in-memory stand-in for window.localStorage. */
function memoryBackend() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    map,
  };
}

test('theme preference round-trips and ignores invalid values', () => {
  const backend = memoryBackend();
  const storage = createStorage(backend);
  assert.equal(storage.getTheme(), null);
  storage.setTheme('dark');
  assert.equal(storage.getTheme(), 'dark');
  storage.setTheme('purple');
  assert.equal(storage.getTheme(), null);
});

test('session save, load and clear', () => {
  const storage = createStorage(memoryBackend());
  assert.equal(storage.loadSession(), null);
  storage.saveSession({ seed: 1, responses: [] });
  assert.deepEqual(storage.loadSession(), { seed: 1, responses: [] });
  storage.clearSession();
  assert.equal(storage.loadSession(), null);
});

test('history keeps the newest entries first and is capped', () => {
  const storage = createStorage(memoryBackend());
  for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) storage.addHistory({ finishedAt: i, level: 'B1' });
  const list = storage.loadHistory();
  assert.equal(list.length, HISTORY_LIMIT);
  assert.equal(list[0].finishedAt, HISTORY_LIMIT + 4);
  storage.clearHistory();
  assert.deepEqual(storage.loadHistory(), []);
});

test('corrupt data is ignored instead of throwing', () => {
  const backend = memoryBackend();
  const storage = createStorage(backend);
  backend.setItem('ea2:session', '{not json');
  backend.setItem('ea2:history', '"a string"');
  assert.equal(storage.loadSession(), null);
  assert.deepEqual(storage.loadHistory(), []);
});

test('a missing or failing backend degrades gracefully', () => {
  const none = createStorage(null);
  assert.equal(none.available, false);
  assert.equal(none.saveSession({}), false);
  assert.equal(none.loadSession(), null);

  const failing = createStorage({
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('blocked'); },
  });
  assert.equal(failing.saveSession({}), false);
  assert.equal(failing.loadSession(), null);
  assert.doesNotThrow(() => failing.clearSession());
});

test('historyEntry stores a compact summary', () => {
  const entry = historyEntry(
    { level: 'B2', score: 0.4123, correct: 18, answered: 30, durationMs: 600000, confidence: { label: 'high' } },
    1700000000000,
  );
  assert.deepEqual(entry, { finishedAt: 1700000000000, level: 'B2', score: 41, correct: 18, answered: 30, durationMs: 600000, confidence: 'high' });
});
