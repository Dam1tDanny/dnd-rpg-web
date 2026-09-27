// Seeded RNG for the game logic.
//
// The Python version uses the global `random` module. Here we keep one
// module-level PRNG (mulberry32) instead, so the game stays DOM-free and
// testable: real play seeds it from Math.random(), while smoke tests call
// setSeed() for deterministic runs.

let state: number = (Math.random() * 0xffffffff) >>> 0;

/** Reseed the RNG. Smoke tests use this for reproducible combat sims. */
export function setSeed(seed: number): void {
  state = seed >>> 0;
}

/** mulberry32 — small, fast, good-enough PRNG for a game. */
function next(): number {
  state |= 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Random int in [min, max], like Python's random.randint(a, b). */
export function randint(min: number, max: number): number {
  return min + Math.floor(next() * (max - min + 1));
}

/** Roll `count` dice with `sides` faces and sum them, like roll_dice(). */
export function rollDice(sides: number, count = 1): number {
  let total = 0;
  for (let i = 0; i < count; i++) total += randint(1, sides);
  return total;
}

/** Pick a random element, like Python's random.choice(). */
export function choice<T>(items: T[]): T {
  return items[randint(0, items.length - 1)];
}
