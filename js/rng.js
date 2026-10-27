// Tiny seeded random-number helpers. A seeded generator lets a saved session be
// resumed with exactly the same option order and question draw.

/** Hash any string to an unsigned 32-bit integer (FNV-1a). */
export function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Mulberry32: small, fast, good-enough PRNG. Returns a function giving floats in [0, 1). */
export function createRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random generator for a given session seed and a purpose label (e.g. a question id). */
export function rngFor(seed, label) {
  return createRng(hashString(`${seed}:${label}`));
}

/** Fisher-Yates shuffle. Returns a new array. */
export function shuffle(list, rng) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Pick one element at random. */
export function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}
