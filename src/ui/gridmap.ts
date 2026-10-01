// The battle board renderer: draws the BattleGrid as a tappable 8x8 board.
//
// Tap your token -> legal destinations glow -> tap a glowing square to move.
// The GridMap owns only presentation + tap flow; all rules live in
// game/grid.ts and game/combat.ts. Call render() after every move and after
// every turn so the tokens track the fight.

import { GRID_W, GRID_H } from "../game/grid.js";
import type { BattleGrid, Pos } from "../game/grid.js";

/** One emoji per class so the hero token reads at a glance. */
export const CLASS_EMOJI: Record<string, string> = {
  Fighter: "🛡️",
  Barbarian: "😡",
  Rogue: "🗡️",
  Wizard: "🧙",
  Cleric: "💚",
  Paladin: "🌟",
  Ranger: "🏹",
  Warlock: "🟣",
  Druid: "🌙",
  Monk: "🥋",
  Bard: "🎭",
  Sorcerer: "🔮",
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface GridMapOpts {
  playerClass: string;
  monsterName: string;
  /** Current "12/20"-style labels, read fresh on every render. */
  playerHpText: () => string;
  monsterHpText: () => string;
  /** Fire the move; return true when the move actually happened. */
  onMove: (x: number, y: number) => boolean;
  /** Is it the player's turn with controls live? */
  canMove: () => boolean;
  /** Legal destinations for the hero token right now. */
  reachable: () => Pos[];
}

export class GridMap {
  private moveMode = false;

  constructor(
    private container: HTMLElement,
    private grid: BattleGrid,
    private opts: GridMapOpts
  ) {}

  render(): void {
    const showReachable = this.moveMode && this.opts.canMove();
    const reach = showReachable ? this.opts.reachable() : [];
    const reachKey = new Set(reach.map((c) => `${c.x},${c.y}`));
    const p = this.grid.player;
    const m = this.grid.monster;
    const playerEmoji = CLASS_EMOJI[this.opts.playerClass] ?? "🧝";

    let html = `<div class="battle-grid" role="grid" aria-label="Battle map">`;
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const isPlayer = x === p.x && y === p.y;
        const isMonster = x === m.x && y === m.y;
        const isReach = reachKey.has(`${x},${y}`);
        const cls = [
          "gcell",
          (x + y) % 2 === 0 ? "light" : "dark",
          isPlayer ? "player-token" : "",
          isMonster ? "monster-token" : "",
          isReach ? "reachable" : "",
          isPlayer && this.moveMode ? "moving" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const token = isPlayer
          ? `data-token="player" aria-label="${esc(this.opts.playerClass)} (you)"`
          : isMonster
            ? `data-token="monster" aria-label="${esc(this.opts.monsterName)}"`
            : `aria-label="square ${x + 1},${y + 1}"`;
        const inner = isPlayer
          ? `<span class="token">${playerEmoji}</span><span class="token-hp">${esc(this.opts.playerHpText())}</span>`
          : isMonster
            ? `<span class="token">👹</span><span class="token-hp">${esc(this.opts.monsterHpText())}</span>`
            : isReach
              ? `<span class="move-dot"></span>`
              : "";
        html += `<button type="button" class="${cls}" data-x="${x}" data-y="${y}" ${token}>${inner}</button>`;
      }
    }
    html += `</div>`;
    this.container.innerHTML = html;

    this.container.querySelectorAll<HTMLButtonElement>(".gcell").forEach((cell) => {
      cell.addEventListener("click", () => this.onTap(cell));
    });
  }

  private onTap(cell: HTMLButtonElement): void {
    const x = Number(cell.dataset["x"]);
    const y = Number(cell.dataset["y"]);
    const isPlayerCell = cell.classList.contains("player-token");

    // Tap your own token: arm/disarm move mode (only on your live turn).
    if (isPlayerCell) {
      if (!this.opts.canMove()) return;
      this.moveMode = !this.moveMode;
      this.render();
      return;
    }
    // Tap a glowing square: move there.
    if (this.moveMode && cell.classList.contains("reachable")) {
      if (this.opts.onMove(x, y)) this.moveMode = false;
      this.render();
      return;
    }
    // Tap anywhere else: stand down.
    if (this.moveMode) {
      this.moveMode = false;
      this.render();
    }
  }
}
