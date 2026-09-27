// Game data registries — a faithful port of the Python dicts.
// Display order follows insertion order, same as the Python version.

export type StatName =
  | "Strength_Mod"
  | "Dexterity_Mod"
  | "Constitution_Mod"
  | "Intelligence_Mod"
  | "Wisdom_Mod"
  | "Charisma_Mod";

export interface SpeciesDef {
  stats: Partial<Record<StatName, number>>;
  trait: string;
  desc: string;
}

export interface ClassDef {
  base_hp: number;
  ac_bonus: number;
  weapon: string;
  dice: number; // weapon damage die, e.g. 10 = 1d10
  stat: StatName; // primary attack stat
  ability: string;
  ability_desc: string;
}

export interface EncounterDef {
  range: [number, number]; // weight band used for the weighted roll
  name: string;
  base_hp: number;
  ac: number;
  dex_mod: number;
  attack_bonus: number;
  damage_sides: number;
  damage_bonus: number;
  cr: string;
  /** Tougher monsters only appear once you've walked this far (meters). */
  min_depth: number;
}

/** A live monster instance (mutable HP), as handed to Combat. */
export interface Monster {
  name: string;
  cr: string;
  hp: number;
  /** HP at the start of the fight — used for XP awards and bar scaling. */
  maxHp: number;
  ac: number;
  dex_mod: number;
  attack_bonus: number;
  damage_dice_sides: number;
  damage_bonus: number;
}

/**
 * The shop's single potion tier. Price is tuned to the gold economy:
 * a goblin kill pays 5–20g (avg ~12), so one potion ≈ one goblin kill.
 * It heals 2d4+2 (avg 7) — roughly a full heal for a Wizard, ~2/3 for a
 * Fighter.
 *
 * Design note: drinking is a SWIFT action (it doesn't cost your attack).
 * D&D 2024 made potion-drinking a bonus action, and the sims forced the
 * same conclusion here — a turn-cost heal mathematically cannot fix a
 * glass cannon (you trade a 3.25-damage attack for ~3 net HP while the
 * goblin deals 3.85 unanswered). The economic brake stays: at 10g a pop
 * you can't afford to chug every fight.
 */
export const POTION = {
  name: "Healing Potion",
  price: 10,
  healDice: 2,
  healSides: 4,
  healBonus: 2,
};

export const SPECIES_REGISTRY: Record<string, SpeciesDef> = {
  Human: {
    stats: {
      Strength_Mod: 1, Dexterity_Mod: 1, Constitution_Mod: 1,
      Intelligence_Mod: 1, Wisdom_Mod: 1, Charisma_Mod: 1,
    },
    trait: "Versatile",
    desc: "+1 to all attributes. Adaptable to any adventure.",
  },
  Elf: {
    stats: { Dexterity_Mod: 2, Intelligence_Mod: 1 },
    trait: "Fey Ancestry & Darkvision",
    desc: "Advantage against charm effects; ignores vision penalties in dark ruins.",
  },
  Dwarf: {
    stats: { Constitution_Mod: 2, Strength_Mod: 1 },
    trait: "Stonecunning & Dwarven Resilience",
    desc: "+2 bonus to trap detection and poison saving throws.",
  },
  Halfling: {
    stats: { Dexterity_Mod: 2, Charisma_Mod: 1 },
    trait: "Lucky",
    desc: "Automatically rerolls natural 1s on attack rolls and skill checks.",
  },
  Dragonborn: {
    stats: { Strength_Mod: 2, Charisma_Mod: 1 },
    trait: "Breath Weapon",
    desc: "Can unleash an elemental AoE burst in combat dealing 2d6 damage once per fight.",
  },
  Tiefling: {
    stats: { Charisma_Mod: 2, Intelligence_Mod: 1 },
    trait: "Hellish Resistance & Darkvision",
    desc: "Takes half damage from fire-based traps and fire attacks.",
  },
  Gnome: {
    stats: { Intelligence_Mod: 2, Dexterity_Mod: 1 },
    trait: "Gnome Cunning",
    desc: "+2 bonus on all mental skill checks (Int, Wis, Cha) against magical obstacles.",
  },
  "Half-Orc": {
    stats: { Strength_Mod: 2, Constitution_Mod: 1 },
    trait: "Relentless Endurance",
    desc: "When reduced to 0 HP, drops to 1 HP instead once per adventure.",
  },
  Aasimar: {
    stats: { Charisma_Mod: 2, Wisdom_Mod: 1 },
    trait: "Healing Hands & Radiant Soul",
    desc: "Can restore 5 HP at rest breaks and deal extra radiant damage.",
  },
};

export const CLASS_REGISTRY: Record<string, ClassDef> = {
  Fighter: {
    base_hp: 10, ac_bonus: 3, weapon: "Greatsword", dice: 10, stat: "Strength_Mod",
    ability: "Second Wind",
    ability_desc: "Heals 1d10 + Constitution HP when dropped below half health.",
  },
  Barbarian: {
    base_hp: 12, ac_bonus: 1, weapon: "Greataxe", dice: 12, stat: "Strength_Mod",
    ability: "Rage",
    ability_desc: "Gains physical attack resistance and +2 flat damage.",
  },
  Rogue: {
    base_hp: 8, ac_bonus: 2, weapon: "Rapier", dice: 8, stat: "Dexterity_Mod",
    ability: "Sneak Attack",
    ability_desc: "Deals an extra 1d6 damage when winning initiative.",
  },
  Wizard: {
    base_hp: 6, ac_bonus: 0, weapon: "Fire Bolt Cantrip", dice: 10, stat: "Intelligence_Mod",
    ability: "Arcane Recovery",
    ability_desc: "Automatically gets +3 on magical rune and trap checks.",
  },
  Cleric: {
    base_hp: 8, ac_bonus: 3, weapon: "Warhammer", dice: 8, stat: "Wisdom_Mod",
    ability: "Channel Divinity",
    ability_desc: "Restores full HP at fountains regardless of skill checks.",
  },
  Paladin: {
    base_hp: 10, ac_bonus: 3, weapon: "Longsword", dice: 8, stat: "Strength_Mod",
    ability: "Divine Smite",
    ability_desc: "Deals an extra 1d8 radiant damage on critical hits.",
  },
  Ranger: {
    base_hp: 10, ac_bonus: 2, weapon: "Longbow", dice: 8, stat: "Dexterity_Mod",
    ability: "Favored Enemy",
    ability_desc: "Deals +2 extra damage against wilderness beasts and scouts.",
  },
  Warlock: {
    base_hp: 8, ac_bonus: 1, weapon: "Eldritch Blast", dice: 10, stat: "Charisma_Mod",
    ability: "Agonizing Blast",
    ability_desc: "Adds Charisma modifier directly to spell damage rolls.",
  },
  Druid: {
    base_hp: 8, ac_bonus: 1, weapon: "Quarterstaff", dice: 8, stat: "Wisdom_Mod",
    ability: "Wild Shape",
    ability_desc: "Absorbs the first 10 damage taken in combat.",
  },
  Monk: {
    base_hp: 8, ac_bonus: 3, weapon: "Unarmed Strike", dice: 6, stat: "Dexterity_Mod",
    ability: "Flurry of Blows",
    ability_desc: "Strikes twice per turn in combat using Ki.",
  },
  Bard: {
    base_hp: 8, ac_bonus: 2, weapon: "Rapier", dice: 8, stat: "Charisma_Mod",
    ability: "Bardic Inspiration",
    ability_desc: "Adds +1d6 bonus to any failed skill check.",
  },
  Sorcerer: {
    base_hp: 6, ac_bonus: 0, weapon: "Chromatic Orb", dice: 8, stat: "Charisma_Mod",
    ability: "Metamagic",
    ability_desc: "Maximizes weapon damage dice on the first strike.",
  },
};

/**
 * Level-2 combat abilities, one per class. Design notes for Ron:
 *
 * Player feedback said combat had too few choices, so EVERY class gets a
 * new once-per-combat button at level 2. Each one takes your turn (the
 * monster still answers afterwards) — same rule as the Dragonborn Breath
 * Weapon button. Combat.useAbility() implements what each id does.
 */
export interface LevelAbilityDef {
  /** Stable id that Combat.useAbility() switches on, e.g. "action_surge". */
  id: string;
  name: string;
  emoji: string;
  /** Short rules text shown under the combat buttons. */
  desc: string;
  level: number;
}

export const CLASS_LEVEL_ABILITIES: Record<string, LevelAbilityDef> = {
  Fighter:   { id: "action_surge",    name: "Action Surge",    emoji: "⚡", level: 2, desc: "Attack twice this turn. Once per combat." },
  Barbarian: { id: "reckless_attack", name: "Reckless Attack", emoji: "😡", level: 2, desc: "+4 to hit this turn, but the monster gets +4 to hit you back. Once per combat." },
  Rogue:     { id: "steady_aim",      name: "Steady Aim",      emoji: "🎯", level: 2, desc: "+5 to hit on one attack. Once per combat." },
  Wizard:    { id: "magic_missile",   name: "Magic Missile",   emoji: "✨", level: 2, desc: "Never misses: 3d4+3 force damage. Once per combat." },
  Cleric:    { id: "cure_wounds",     name: "Cure Wounds",     emoji: "💚", level: 2, desc: "Heal 2d8+Wis HP. Takes your turn. Once per combat." },
  Paladin:   { id: "divine_smite",    name: "Divine Smite",    emoji: "🌟", level: 2, desc: "Attack with +2d8 radiant damage. Once per combat." },
  Ranger:    { id: "hunters_mark",    name: "Hunter's Mark",   emoji: "🏹", level: 2, desc: "Mark the monster: your attacks deal +1d6 until it dies. Once per combat." },
  Warlock:   { id: "hex",            name: "Hex",             emoji: "🟣", level: 2, desc: "Curse it: your attacks deal +1d6 and it gets -1 to hit. Once per combat." },
  Druid:     { id: "moonbeam",        name: "Moonbeam",        emoji: "🌙", level: 2, desc: "Call down 2d10 radiant damage (roll to hit). Once per combat." },
  Monk:      { id: "stunning_strike", name: "Stunning Strike", emoji: "💫", level: 2, desc: "Attack; if it hits, the monster skips its next attack. Once per combat." },
  Bard:      { id: "vicious_mockery", name: "Vicious Mockery", emoji: "🎭", level: 2, desc: "Never misses: 1d4 psychic, and the monster gets -2 on its next attack. Once per combat." },
  Sorcerer:  { id: "twinned_spell",   name: "Twinned Spell",   emoji: "🔮", level: 2, desc: "Your next attack strikes twice. Once per combat." },
};

/**
 * Level-3 upgrades are passive (no new buttons): each class's kit gets
 * stronger in one line. Shown in the level-up fanfare.
 */
export const CLASS_LEVEL3_UPGRADES: Record<string, string> = {
  Fighter: "Improved Second Wind: now heals 2d10+CON.",
  Barbarian: "Primal Resilience: Rage now soaks 4 damage per hit.",
  Rogue: "Sneak Attack now deals 2d6.",
  Wizard: "Arcane Ward: begin each combat with a 6-HP ward.",
  Cleric: "Blessed Strikes: +2 damage on all attacks.",
  Paladin: "Aura of Protection: +2 AC, always on.",
  Ranger: "Favored Enemy: +2 damage against beasts and scouts. (This was in the class description all along but never actually worked — now it does.)",
  Warlock: "Eldritch Precision: +1 to all attack rolls.",
  Druid: "Wild Shape ward grows from 10 to 16 HP.",
  Monk: "Ki-Empowered Strikes: unarmed damage die becomes d8.",
  Bard: "Cutting Words: enemies get -2 on attack rolls against you.",
  Sorcerer: "Empowered Spell: Metamagic now adds +CHA to the damage too.",
};

/**
 * XP to go from `level` to `level+1`. Simple linear curve, deliberately
 * fast early: level 2 after ~4 goblin kills, so players feel progression
 * inside one play session.
 */
export function xpForLevel(level: number): number {
  return 100 * level;
}

/**
 * XP for killing a monster, scaled to threat: its max HP plus five times
 * its attack bonus. Goblin Scout ≈ 27, Dire Wolf ≈ 38, Owlbear ≈ 75.
 */
export function xpForMonster(m: Monster): number {
  return m.maxHp + m.attack_bonus * 5;
}

export const ENCOUNTER_TABLES: Record<string, EncounterDef[]> = {
  Forest: [
    { range: [1, 55], name: "Goblin Scout", base_hp: 7, ac: 12, dex_mod: 2, attack_bonus: 4, damage_sides: 6, damage_bonus: 2, cr: "1/4", min_depth: 0 },
    { range: [56, 90], name: "Dire Wolf", base_hp: 18, ac: 14, dex_mod: 2, attack_bonus: 4, damage_sides: 6, damage_bonus: 2, cr: "1", min_depth: 0 },
    { range: [91, 100], name: "Owlbear", base_hp: 45, ac: 13, dex_mod: 1, attack_bonus: 6, damage_sides: 8, damage_bonus: 4, cr: "3", min_depth: 600 },
  ],
};

/**
 * Picks a monster for a biome, weighted by each entry's range width.
 * Tougher monsters have a min_depth: they only show up once the player
 * has walked far enough into the wilds.
 */
export function getBiomeMonster(biome: string, totalDistance = 0): Monster | null {
  const table = ENCOUNTER_TABLES[biome];
  if (!table) return null;
  const pool = table.filter((m) => totalDistance >= m.min_depth);
  if (pool.length === 0) return null;

  const weights = pool.map((m) => ({ w: m.range[1] - m.range[0] + 1, m }));
  const totalW = weights.reduce((sum, e) => sum + e.w, 0);
  let roll = randint(1, totalW);
  for (const { w, m } of weights) {
    if (roll <= w) {
      const finalHp = Math.max(1, m.base_hp + randint(-2, 4));
      return {
        name: m.name, cr: m.cr, hp: finalHp, maxHp: finalHp, ac: m.ac,
        dex_mod: m.dex_mod, attack_bonus: m.attack_bonus,
        damage_dice_sides: m.damage_sides, damage_bonus: m.damage_bonus,
      };
    }
    roll -= w;
  }
  return null;
}

import { randint } from "./rng.js";

/** Re-exported so game modules have one import point for RNG helpers. */
export { randint };
