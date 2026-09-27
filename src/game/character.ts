// The hero. A faithful port of the Python Character class.
//
// One deliberate change: instead of print(), methods return string[] log
// lines. That keeps this module DOM-free (testable in Node) and lets the UI
// decide how to display each line.

import { randint, rollDice } from "./rng.js";
import {
  CLASS_LEVEL_ABILITIES,
  CLASS_LEVEL3_UPGRADES,
  CLASS_REGISTRY,
  POTION,
  SPECIES_REGISTRY,
  xpForLevel,
  type LevelAbilityDef,
  type StatName,
} from "./registries.js";

export interface CheckResult {
  roll: number;
  mod: number;
  total: number;
  lines: string[];
}

const STAT_ORDER: StatName[] = [
  "Strength_Mod",
  "Dexterity_Mod",
  "Constitution_Mod",
  "Intelligence_Mod",
  "Wisdom_Mod",
  "Charisma_Mod",
];

export class Character {
  name: string;
  speciesName: string;
  className: string;

  stats: Record<StatName, number>;
  maxHp: number;
  hp: number;
  ac: number;

  primaryStat: StatName;
  weapon: string;
  damageDice: number;

  speciesTrait: string;
  classAbility: string;
  abilityDesc: string;

  // Tracking flags
  gold = 0;
  potions = 0;
  level = 1;
  xp = 0;
  relentlessEnduranceUsed = false;
  secondWindUsed = false;
  breathWeaponUsed = false;
  metamagicAvailable = false;
  /** Once-per-combat level ability ids already spent this fight. */
  abilitiesUsed = new Set<string>();
  /**
   * Ward pool: damage-soaking buffer refreshed each fight. The Druid's
   * Wild Shape and (from level 3) the Wizard's Arcane Ward both use it —
   * one generic pool instead of two special cases.
   */
  wardPool = 0;
  wardName = "";

  constructor(name: string, speciesName: string, className: string) {
    this.name = name;
    this.speciesName = speciesName;
    this.className = className;

    // Base modifiers, then species bonuses on top.
    this.stats = {
      Strength_Mod: 0, Dexterity_Mod: 0, Constitution_Mod: 0,
      Intelligence_Mod: 0, Wisdom_Mod: 0, Charisma_Mod: 0,
    };
    const spec = SPECIES_REGISTRY[speciesName];
    if (spec) {
      for (const [stat, bonus] of Object.entries(spec.stats)) {
        this.stats[stat as StatName] += bonus ?? 0;
      }
    }
    const cls = CLASS_REGISTRY[className];

    // Derived attributes
    this.maxHp = (cls?.base_hp ?? 8) + this.stats["Constitution_Mod"];
    this.hp = Math.max(1, this.maxHp); // never start at 0 HP on low CON
    this.ac = 10 + this.stats["Dexterity_Mod"] + (cls?.ac_bonus ?? 0);

    // Combat attributes
    this.primaryStat = cls?.stat ?? "Strength_Mod";
    this.weapon = cls?.weapon ?? "Fists";
    this.damageDice = cls?.dice ?? 4;

    // Flavor
    this.speciesTrait = spec?.trait ?? "None";
    this.classAbility = cls?.ability ?? "None";
    this.abilityDesc = cls?.ability_desc ?? "";
  }

  /**
   * A class's hit die doubles as its level-up HP gain. Conveniently, every
   * class's level-1 base_hp already equals its D&D hit die (Fighter d10 =
   * 10 HP, Wizard d6 = 6 HP, ...), so we just reuse base_hp.
   */
  get hitDie(): number {
    return CLASS_REGISTRY[this.className]?.base_hp ?? 8;
  }

  /**
   * Called at the start of every fight. Refreshes once-per-combat powers.
   * (Relentless Endurance is intentionally NOT reset: once per adventure.)
   */
  resetCombatFlags(): void {
    this.secondWindUsed = false;
    this.breathWeaponUsed = false;
    this.metamagicAvailable = this.className === "Sorcerer";
    this.abilitiesUsed.clear();
    // Wards refresh every fight.
    if (this.className === "Druid") {
      this.wardPool = this.level >= 3 ? 16 : 10;
      this.wardName = "Druid Wild Shape";
    } else if (this.className === "Wizard" && this.level >= 3) {
      this.wardPool = 6;
      this.wardName = "Wizard Arcane Ward";
    } else {
      this.wardPool = 0;
      this.wardName = "";
    }
  }

  /** A breather between encounters. This is where Aasimar Healing Hands lives. */
  rest(): string[] {
    if (this.speciesName === "Aasimar") {
      const healed = Math.min(5, this.maxHp - this.hp);
      this.hp += healed;
      return [`  😇 [Aasimar Healing Hands] Restored ${healed} HP while resting.`];
    }
    return ["  💤 You catch your breath."];
  }

  /** Buy a healing potion from the shop. Gold finally has a use. */
  buyPotion(): string[] {
    if (this.gold < POTION.price) {
      return [`  🪙 Not enough gold — a ${POTION.name} costs ${POTION.price}g and you have ${this.gold}g.`];
    }
    this.gold -= POTION.price;
    this.potions += 1;
    return [`  🧪 Bought a ${POTION.name} for ${POTION.price}g! (Now carrying ${this.potions}.)`];
  }

  /**
   * Drink a healing potion: 2d4+2 HP, capped at max HP. Swift action —
   * the caller does NOT spend the turn.
   */
  quaffPotion(): string[] {
    if (this.potions <= 0) return ["  🧪 No potions left!"];
    this.potions -= 1;
    const healed = Math.min(
      rollDice(POTION.healSides, POTION.healDice) + POTION.healBonus,
      this.maxHp - this.hp
    );
    this.hp += healed;
    return [`  🧪 Quaffed a ${POTION.name}: restored ${healed} HP. (${this.hp}/${this.maxHp}, ${this.potions} left)`];
  }

  /**
   * Award XP (called on victory) and handle level-ups. A hero can chain
   * multiple levels off one big award, hence the loop. Each level: max HP
   * grows by hit die + CON, and you heal by the amount gained.
   */
  gainXp(amount: number): string[] {
    const lines: string[] = [];
    this.xp += amount;
    lines.push(`  ✨ Gained ${amount} XP. (Total: ${this.xp} XP)`);
    while (this.xp >= xpForLevel(this.level)) {
      this.level += 1;
      const gain = Math.max(1, this.hitDie + this.stats["Constitution_Mod"]);
      this.maxHp += gain;
      this.hp = Math.min(this.maxHp, this.hp + gain);
      lines.push(`  🎉 LEVEL UP! You are now level ${this.level}! Max HP +${gain} (now ${this.maxHp}).`);
      lines.push(...this.applyLevelUnlocks());
    }
    return lines;
  }

  /**
   * What's new at this level. Level 2 is always a fresh combat button;
   * level 3 is a passive upgrade. Returns fanfare lines for the journal.
   */
  private applyLevelUnlocks(): string[] {
    const lines: string[] = [];
    if (this.level === 2) {
      const def = CLASS_LEVEL_ABILITIES[this.className];
      if (def) lines.push(`  🆕 New combat ability: ${def.emoji} ${def.name} — ${def.desc}`);
    }
    if (this.level === 3) {
      const upgrade = CLASS_LEVEL3_UPGRADES[this.className];
      if (upgrade) lines.push(`  🆕 Level 3 upgrade: ${upgrade}`);
      // Passive stat changes that can't be derived on the fly.
      if (this.className === "Paladin") {
        this.ac += 2; // Aura of Protection
      }
      if (this.className === "Monk") {
        this.damageDice = 8; // Ki-Empowered Strikes: d6 -> d8
      }
    }
    return lines;
  }

  /** Level-2 combat buttons not yet spent this fight (0 or 1 per class). */
  availableAbilities(): LevelAbilityDef[] {
    const def = CLASS_LEVEL_ABILITIES[this.className];
    if (!def || this.level < def.level || this.abilitiesUsed.has(def.id)) return [];
    return [def];
  }

  /** d20 roll with Halfling Lucky. Returns the roll plus any log lines. */
  rollCheck(statName: StatName): CheckResult {
    const lines: string[] = [];
    let roll = randint(1, 20);
    if (roll === 1 && this.speciesName === "Halfling") {
      lines.push("  🍀 [Halfling Lucky] Rolled a Natural 1! Rerolling...");
      roll = randint(1, 20);
    }
    const mod = this.stats[statName] ?? 0;
    return { roll, mod, total: roll + mod, lines };
  }

  /** Damage intake with Barbarian Rage, wards, Half-Orc endurance. */
  takeDamage(amount: number): string[] {
    const lines: string[] = [];

    if (this.className === "Barbarian") {
      // Level 3 Primal Resilience: Rage soaks 4 per hit instead of 2.
      const soak = this.level >= 3 ? 4 : 2;
      amount = Math.max(1, amount - soak);
      lines.push(`  🛡️ [Barbarian Rage] Damage reduced to ${amount}!`);
    }

    // Ward pool (Druid Wild Shape / Wizard Arcane Ward) soaks first.
    if (this.wardPool > 0) {
      const absorbed = Math.min(this.wardPool, amount);
      this.wardPool -= absorbed;
      amount -= absorbed;
      lines.push(`  🛡️ [${this.wardName}] Absorbed ${absorbed} damage! (${this.wardPool} ward remaining)`);
      if (amount <= 0) return lines; // the ward ate the whole hit
    }

    this.hp -= amount;

    if (this.hp <= 0) {
      if (this.speciesName === "Half-Orc" && !this.relentlessEnduranceUsed) {
        this.hp = 1;
        this.relentlessEnduranceUsed = true;
        lines.push("  💪 [Half-Orc Relentless Endurance] Refusing to fall! Dropped to 1 HP instead of unconsciousness!");
      }
    }
    return lines;
  }

  /** Multi-line hero summary for the character panel / creation preview. */
  summaryLines(): string[] {
    const statName = (s: StatName) => s.replace("_Mod", "");
    const lines = [
      `🗡️ HERO PROFILE: ${this.name}`,
      `Species: ${this.speciesName} | Class: ${this.className} | Level ${this.level}`,
      `HP: ${this.hp}/${this.maxHp} | AC: ${this.ac} | XP: ${this.xp} | 🪙 ${this.gold}g | 🧪 ${this.potions}`,
      `Main Weapon: ${this.weapon} (1d${this.damageDice} + ${this.stats[this.primaryStat]})`,
      `Species Trait: ${this.speciesTrait}`,
      `Class Ability: ${this.classAbility} - ${this.abilityDesc}`,
      `Attribute Modifiers:`,
    ];
    for (const s of STAT_ORDER) {
      const v = this.stats[s];
      lines.push(`  • ${statName(s)}: ${v >= 0 ? `+${v}` : `${v}`}`);
    }
    return lines;
  }
}
