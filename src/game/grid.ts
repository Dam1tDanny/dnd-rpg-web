// The tactical battle grid: positions, movement, and the monster's chase AI.
//
// The combat screen renders this as an 8x8 board with two tokens — you and
// the monster. Nothing here touches the DOM: the UI reads positions and
// calls the move methods, and the smoke tests drive the same API.
//
// The rules, in one breath:
// - You move up to 3 squares per round (tap your token, tap a glowing cell).
// - The monster moves up to 4 squares toward you on its turn, then attacks
//   only if it's standing next to you.
// - Bow/spell classes (Ranger, Wizard, Sorcerer, Warlock) attack from any
//   range; everyone else must be adjacent to the monster.
// Monsters are faster than you on purpose: you can kite for a few free
// shots, but you can't run forever on an 8x8 board.

/** A board square. x grows right, y grows down, (0,0) is top-left. */
export interface Pos {
  x: number;
  y: number;
}

export const GRID_W = 8;
export const GRID_H = 8;
/** Squares the player token may move per round. */
export const PLAYER_MOVE = 3;
/** Squares the monster moves per turn. Faster than the player: kiting buys
 *  time, not immunity — the board is small and the monster cuts corners. */
export const MONSTER_MOVE = 4;

/** King-move distance: 1 for orthogonal AND diagonal neighbors. */
export function chebyshev(a: Pos, b: Pos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function inBounds(p: Pos): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < GRID_W && p.y < GRID_H;
}

export class BattleGrid {
  /** You start near the bottom edge, the monster on its back rank —
   *  6 squares apart, so a sprinting hero can deny the monster's opening
   *  attack but can't outrun it for long. */
  player: Pos = { x: 3, y: 6 };
  monster: Pos = { x: 3, y: 0 };

  /** Are the two tokens standing next to each other (melee range)? */
  adjacent(): boolean {
    return chebyshev(this.player, this.monster) <= 1;
  }

  /** Current king-move distance between the tokens. */
  distance(): number {
    return chebyshev(this.player, this.monster);
  }

  /** Every legal destination for a token at `from` moving `range`. */
  reachableCells(from: Pos, range: number, blocked: Pos): Pos[] {
    const cells: Pos[] = [];
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const c = { x, y };
        // Can't stay put, leave the board, or stack onto the other token.
        if (c.x === from.x && c.y === from.y) continue;
        if (c.x === blocked.x && c.y === blocked.y) continue;
        if (chebyshev(from, c) <= range) cells.push(c);
      }
    }
    return cells;
  }

  /** Legal destinations for the player's token right now. */
  playerReachable(): Pos[] {
    return this.reachableCells(this.player, PLAYER_MOVE, this.monster);
  }

  /**
   * Move the player's token. Returns false for illegal destinations
   * (out of range, off board, or the monster's square).
   */
  movePlayerTo(x: number, y: number): boolean {
    const ok = this.playerReachable().some((c) => c.x === x && c.y === y);
    if (!ok) return false;
    this.player = { x, y };
    return true;
  }

  /**
   * Stride the player token toward the monster (up to PLAYER_MOVE squares,
   * stopping when adjacent). Used by the test sims to play the grid the way
   * a sensible player would — the real UI moves via taps instead.
   */
  strideTowardMonster(): boolean {
    return this.stepToward(this.player, this.monster, PLAYER_MOVE);
  }

  /**
   * The monster's turn movement: rush the player, stopping when adjacent.
   * Returns true if the monster actually changed squares.
   */
  moveMonster(): boolean {
    return this.stepToward(this.monster, this.player, MONSTER_MOVE);
  }

  /**
   * Greedy chase: take up to `range` king-steps toward `target`, each step
   * picking the neighboring square with the smallest remaining distance.
   * Never enters the target's square — `mover` is mutated in place.
   */
  private stepToward(mover: Pos, target: Pos, range: number): boolean {
    let moved = false;
    for (let i = 0; i < range; i++) {
      if (chebyshev(mover, target) <= 1) break; // adjacent: hold position
      let best: Pos | null = null;
      let bestD = chebyshev(mover, target);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const next = { x: mover.x + dx, y: mover.y + dy };
          if (!inBounds(next)) continue;
          if (next.x === target.x && next.y === target.y) continue;
          const d = chebyshev(next, target);
          // Strictly-less-than keeps the first best neighbor found, which
          // makes the path deterministic (dx/dy loop order) for the sims.
          if (d < bestD) {
            bestD = d;
            best = next;
          }
        }
      }
      if (!best) break; // boxed in (shouldn't happen on an open board)
      mover.x = best.x;
      mover.y = best.y;
      moved = true;
    }
    return moved;
  }
}
