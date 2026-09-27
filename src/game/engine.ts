// The exploration loop, ported from the Python GPSAdventureEngine.
//
// Walk the land, hit distance checkpoints, and either a monster finds you or
// something interesting happens. Real GPS arrives in Phase 3 — for now the UI
// feeds this simulated meters per Walk tap.

import { randint, choice, rollDice } from "./rng.js";
import type { Character } from "./character.js";
import { getBiomeMonster, type Monster } from "./registries.js";

export interface WalkResult {
  /** Journal lines describing what happened on this walk. */
  lines: string[];
  /** Non-null when a monster ambushed the party — the UI should open combat. */
  monster: Monster | null;
}

export class AdventureEngine {
  player: Character;
  currentBiome = "Forest";
  totalDistance = 0;
  distanceSinceTrigger = 0;
  nextTriggerTarget: number;

  constructor(player: Character, biome = "Forest") {
    this.player = player;
    this.currentBiome = biome;
    this.nextTriggerTarget = randint(200, 350);
  }

  walk(meters: number): WalkResult {
    const lines: string[] = [];
    this.totalDistance += meters;
    this.distanceSinceTrigger += meters;
    lines.push(`👟 Walked ${meters}m. (Total: ${this.totalDistance}m)`);

    let monster: Monster | null = null;
    if (this.distanceSinceTrigger >= this.nextTriggerTarget) {
      const result = this.evaluateLocationNode();
      lines.push(...result.lines);
      monster = result.monster;
    }
    return { lines, monster };
  }

  private evaluateLocationNode(): { lines: string[]; monster: Monster | null } {
    const lines: string[] = ["🎲 [Distance target hit! Resolving encounter...]"];
    const spawnChance = randint(1, 100);

    let monster: Monster | null = null;
    if (spawnChance <= 60) {
      monster = getBiomeMonster(this.currentBiome, this.totalDistance);
      if (!monster) lines.push("🌿 The wind blows, but nothing approaches.");
      this.distanceSinceTrigger = 0;
      this.nextTriggerTarget = randint(300, 500);
    } else {
      lines.push(...this.environmentalEvent());
      this.distanceSinceTrigger = 0;
      this.nextTriggerTarget = randint(150, 300);
    }
    return { lines, monster };
  }

  private environmentalEvent(): string[] {
    const lines: string[] = ["--------------------------------------------------"];
    const event = choice(["trapped_chest", "mysterious_fountain", "ancient_runes"] as const);

    if (event === "trapped_chest") {
      lines.push("📦 You discover an old, iron-bound chest hidden in the brush.");
      const dc = 13;
      const check = this.player.rollCheck("Dexterity_Mod");
      lines.push(...check.lines);
      let total = check.total;

      // Dwarven trap sense.
      if (this.player.speciesName === "Dwarf") {
        total += 2;
        lines.push("  🪨 [Dwarven Resilience] +2 bonus on trap evaluation!");
      }
      lines.push(`[Skill Check] Dexterity vs DC ${dc}. (Rolled ${check.roll} + ${check.mod} = ${total})`);

      // A Bard can salvage a failed check with inspiration.
      if (total < dc && this.player.className === "Bard") {
        const insp = rollDice(6);
        total += insp;
        lines.push(`  🎵 [Bardic Inspiration] Added +${insp} to check! New total: ${total}`);
      }

      if (total >= dc) {
        const gold = randint(10, 50);
        this.player.gold += gold;
        lines.push(`🏆 SUCCESS! You safely pick the lock and secure ${gold} gold pieces!`);
      } else {
        let damage = randint(2, 8);
        if (this.player.speciesName === "Tiefling") {
          damage = Math.floor(damage / 2);
          lines.push("  🔥 [Tiefling Hellish Resistance] Halved trap damage!");
        }
        lines.push(`💥 FAILURE! A spring needle fires! You take ${damage} damage.`);
        lines.push(...this.player.takeDamage(damage));
      }
    } else if (event === "mysterious_fountain") {
      lines.push("⛲ You stumble upon a stone fountain carved like a weeping dragon.");
      if (this.player.className === "Cleric") {
        lines.push("  ✨ [Cleric Channel Divinity] You channel holy power to purify the water instantly!");
        this.player.hp = this.player.maxHp;
        lines.push(`🏆 Fully restored HP to ${this.player.hp}/${this.player.maxHp}!`);
      } else {
        const dc = 10;
        const check = this.player.rollCheck("Wisdom_Mod");
        lines.push(...check.lines);
        lines.push(`[Skill Check] Wisdom vs DC ${dc}. (Rolled ${check.roll} + ${check.mod} = ${check.total})`);
        if (check.total >= dc) {
          this.player.hp = this.player.maxHp;
          lines.push(`✨ SUCCESS! A soothing potion-like liquid restores your health to ${this.player.hp}/${this.player.maxHp}!`);
        } else {
          lines.push("🤢 FAILURE! It tastes like murky swamp water.");
        }
      }
    } else {
      lines.push("🗿 A moss-covered obelisk stands near the path, glowing faint purple.");
      let total: number;
      if (this.player.className === "Wizard") {
        lines.push("  📖 [Wizard Arcane Recovery] You recognize these arcana symbols instantly!");
        total = 99; // auto success
      } else {
        const check = this.player.rollCheck("Intelligence_Mod");
        lines.push(...check.lines);
        total = check.total;
        if (this.player.speciesName === "Gnome") {
          total += 2;
          lines.push("  🧠 [Gnome Cunning] +2 bonus against magical anomalies!");
        }
        lines.push(`[Skill Check] Intelligence vs DC 14. (Rolled ${check.roll} + ${check.mod} = ${total})`);
      }

      if (total >= 14) {
        lines.push("📚 SUCCESS! You decipher the glowing runes and gain a temporary ward of protection!");
      } else {
        lines.push("🌀 FAILURE! The magical static leaves you disoriented.");
      }
    }

    lines.push("--------------------------------------------------");
    return lines;
  }
}
