// Node smoke test for the DOM-free game logic (src/game/*).
// Run with: npm run smoke
//
// It seeds the RNG, creates heroes, fights hundreds of combats, and walks
// the engine — then prints win rates and sanity checks. A Fighter should
// beat a Goblin Scout most of the time; the Dire Wolf should be a real
// threat; no Owlbear may appear before 600m of walking.

import { setSeed } from "./game/rng.js";
import { Character } from "./game/character.js";
import { Combat } from "./game/combat.js";
import { AdventureEngine } from "./game/engine.js";
import { ENCOUNTER_TABLES, getBiomeMonster, type Monster } from "./game/registries.js";

function makeMonster(name: string): Monster {
  const def = ENCOUNTER_TABLES["Forest"].find((m) => m.name === name);
  if (!def) throw new Error(`unknown monster ${name}`);
  return {
    name: def.name, cr: def.cr, hp: def.base_hp, maxHp: def.base_hp, ac: def.ac,
    dex_mod: def.dex_mod, attack_bonus: def.attack_bonus,
    damage_dice_sides: def.damage_sides, damage_bonus: def.damage_bonus,
  };
}

function winRate(species: string, cls: string, monsterName: string, n: number): number {
  let wins = 0;
  for (let seed = 0; seed < n; seed++) {
    setSeed(10000 + seed);
    const player = new Character("TestHero", species, cls);
    const combat = new Combat(player, makeMonster(monsterName));
    combat.start();
    // Monster opening turn when it wins initiative (mirrors the UI).
    if (!combat.playerFirst) combat.monsterAttack();
    let guard = 0;
    while (!combat.over && guard++ < 200) {
      // Dragonborn uses the breath weapon button on round one.
      if (species === "Dragonborn" && combat.round === 0) combat.breathWeapon();
      else combat.playerAttack();
      if (!combat.over) combat.monsterAttack();
    }
    if (combat.over && combat.playerWon) wins++;
  }
  return wins / n;
}

function check(label: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) process.exitCode = 1;
}

console.log("--- combat win rates (300 fights each) ---");
const fighterGoblin = winRate("Human", "Fighter", "Goblin Scout", 300);
const fighterWolf = winRate("Human", "Fighter", "Dire Wolf", 300);
const wizardGoblin = winRate("Human", "Wizard", "Goblin Scout", 300);
const barbWolf = winRate("Half-Orc", "Barbarian", "Dire Wolf", 300);
const dragonbornGoblin = winRate("Dragonborn", "Fighter", "Goblin Scout", 300);
console.log(`Human Fighter vs Goblin Scout:      ${(fighterGoblin * 100).toFixed(0)}%`);
console.log(`Human Fighter vs Dire Wolf:         ${(fighterWolf * 100).toFixed(0)}%`);
console.log(`Human Wizard vs Goblin Scout:       ${(wizardGoblin * 100).toFixed(0)}%`);
console.log(`Half-Orc Barbarian vs Dire Wolf:    ${(barbWolf * 100).toFixed(0)}%`);
console.log(`Dragonborn Fighter vs Goblin Scout: ${(dragonbornGoblin * 100).toFixed(0)}%`);

check("Fighter beats Goblin Scout most of the time (>60%)", fighterGoblin > 0.6);
check("Dire Wolf is a real threat to a Fighter (<60%)", fighterWolf < 0.6);
check("Wizard is fragile but not hopeless vs Goblin (>20%)", wizardGoblin > 0.2);

console.log("--- potions: glass-cannon survivability ---");
// Simple potion AI: chug when at half HP or below, if any are left.
// Drinking is a SWIFT action (bonus action): you quaff and still attack,
// so the sim drinks and attacks in the same round. The hero "buys"
// 3 potions up front (30g ≈ 2-3 goblin kills of saving).
function winRateWithPotions(species: string, cls: string, monsterName: string, n: number, potions: number): number {
  let wins = 0;
  for (let seed = 0; seed < n; seed++) {
    setSeed(20000 + seed);
    const player = new Character("TestHero", species, cls);
    player.potions = potions;
    const combat = new Combat(player, makeMonster(monsterName));
    combat.start();
    if (!combat.playerFirst) combat.monsterAttack();
    let guard = 0;
    while (!combat.over && guard++ < 200) {
      if (species === "Dragonborn" && combat.round === 0) combat.breathWeapon();
      else {
        // Swift quaff first, then the normal attack.
        if (player.potions > 0 && player.hp <= player.maxHp / 2) combat.drinkPotion();
        combat.playerAttack();
      }
      if (!combat.over) combat.monsterAttack();
    }
    if (combat.over && combat.playerWon) wins++;
  }
  return wins / n;
}

const wizardGoblinPotions = winRateWithPotions("Human", "Wizard", "Goblin Scout", 300, 3);
const wizardWolfPotions = winRateWithPotions("Human", "Wizard", "Dire Wolf", 300, 3);
const fighterWolfPotions = winRateWithPotions("Human", "Fighter", "Dire Wolf", 300, 3);
console.log(`Human Wizard (3 potions) vs Goblin Scout: ${(wizardGoblinPotions * 100).toFixed(0)}% (was ${(wizardGoblin * 100).toFixed(0)}%)`);
console.log(`Human Wizard (3 potions) vs Dire Wolf:    ${(wizardWolfPotions * 100).toFixed(0)}%`);
console.log(`Human Fighter (3 potions) vs Dire Wolf:  ${(fighterWolfPotions * 100).toFixed(0)}% (was ${(fighterWolf * 100).toFixed(0)}%)`);
// Design note: a turn-cost heal mathematically cannot fix the L1 wizard
// (it trades a ~3.25-damage attack for ~3 net HP while the goblin deals
// ~3.85 unanswered — simmed at 42% -> 42%). Swift potions + the level-2
// kit (a L2 wizard alone goes 42% -> 87% on HP) are the glass-cannon fix.
check("Potions meaningfully help the Wizard vs Goblin (>50%)", wizardGoblinPotions > 0.5);
check("Potions don't make the Fighter unkillable vs Wolf (<80%)", fighterWolfPotions < 0.8);

console.log("--- flee mechanics ---");
// DEX vs DEX: chance = 50% + 5%/point of difference, clamped 20-90%.
// Human Rogue: DEX mod +1. Goblin Scout: dex_mod 2 -> 45% expected.
let fled = 0;
let fleeDeaths = 0;
const FLEE_N = 1000;
for (let seed = 0; seed < FLEE_N; seed++) {
  setSeed(30000 + seed);
  const player = new Character("TestHero", "Human", "Rogue");
  const combat = new Combat(player, makeMonster("Goblin Scout"));
  combat.start();
  combat.flee();
  if (combat.fled) fled++;
  else if (combat.over && !combat.playerWon) fleeDeaths++;
}
const fleeRate = fled / FLEE_N;
console.log(`Human Rogue flee vs Goblin Scout: ${(fleeRate * 100).toFixed(1)}% fled (expected ~45%), ${fleeDeaths} died on failed attempts`);
check("Flee rate near the 45% formula (35-55%)", fleeRate > 0.35 && fleeRate < 0.55);

console.log("--- XP and levels ---");
// Grind goblins the way a player would: fight, victory (loot + XP), repeat.
// This section tests PROGRESSION math, not survival — so the grinder rests
// to full HP between fights. (Without that, it can die mid-grind and the
// test would measure luck instead of the XP curve.)
setSeed(99);
const grinder = new Character("Grinder", "Human", "Fighter");
let kills = 0;
let leveledTo2 = false;
for (let i = 0; i < 12; i++) {
  // Revive + rest between fights: this section tests XP math, not survival.
  // (A Fighter still loses ~17% of goblin fights, so a death must not end
  // the grind or the test measures luck instead of the XP curve.)
  grinder.hp = grinder.maxHp;
  const combat = new Combat(grinder, makeMonster("Goblin Scout"));
  combat.start();
  if (!combat.playerFirst) combat.monsterAttack();
  let guard = 0;
  while (!combat.over && guard++ < 200) {
    combat.playerAttack();
    if (!combat.over) combat.monsterAttack();
  }
  if (combat.playerWon) {
    kills++;
    combat.victoryLines(); // awards gold + XP, may level up
    if (grinder.level >= 2) leveledTo2 = true;
  }
}
console.log(`after ${kills} goblin kills: level ${grinder.level}, ${grinder.xp} XP, max HP ${grinder.maxHp}, abilities: ${grinder.availableAbilities().map((a) => a.name).join(", ") || "none"}`);
check("Level 2 reached within a dozen goblin kills", leveledTo2);
// The grinder never spends abilities, so level 2+ means the button is live.
check("Level 2 grants a combat ability button", grinder.level < 2 || grinder.availableAbilities().length === 1);
// Max HP must have grown by hit die + CON on the level-up.
check("Level-up grew max HP (Fighter d10 + CON)", grinder.maxHp > 11);

// Every class gets a level-2 button: spot-check all 12 directly.
const classes = ["Fighter", "Barbarian", "Rogue", "Wizard", "Cleric", "Paladin", "Ranger", "Warlock", "Druid", "Monk", "Bard", "Sorcerer"];
const missing = classes.filter((c) => {
  const p = new Character("T", "Human", c);
  p.gainXp(100);
  return p.availableAbilities().length === 0;
});
check(`all 12 classes unlock a level-2 ability (${missing.length} missing)`, missing.length === 0);
if (missing.length) console.log(`  missing: ${missing.join(", ")}`);

// Once-per-combat: using the ability spends it for this fight only.
setSeed(5);
const spender = new Character("T", "Human", "Fighter");
spender.gainXp(100);
const c2 = new Combat(spender, makeMonster("Goblin Scout"));
c2.start();
check("ability available at fight start", spender.availableAbilities().length === 1);
c2.useAbility("action_surge");
check("ability spent after use", spender.availableAbilities().length === 0);
const c3 = new Combat(spender, makeMonster("Goblin Scout"));
c3.start();
check("ability refreshes next fight", spender.availableAbilities().length === 1);

console.log("--- depth gating ---");
setSeed(7);
const shallowNames = new Set<string>();
for (let i = 0; i < 400; i++) {
  const m = getBiomeMonster("Forest", 100);
  if (m) shallowNames.add(m.name);
}
const deepNames = new Set<string>();
for (let i = 0; i < 400; i++) {
  const m = getBiomeMonster("Forest", 900);
  if (m) deepNames.add(m.name);
}
console.log(`shallow (<600m) pool: ${[...shallowNames].join(", ")}`);
console.log(`deep (900m) pool:     ${[...deepNames].join(", ")}`);
check("No Owlbear before 600m", !shallowNames.has("Owlbear"));
check("Owlbear appears in the deep wilds", deepNames.has("Owlbear"));

console.log("--- engine walk simulation (immortal hero, tests the machinery) ---");
setSeed(42);
const hero = new Character("Walker", "Human", "Fighter");
const engine = new AdventureEngine(hero);
let encounters = 0;
let events = 0;
let crashed = false;
try {
  for (let i = 0; i < 60; i++) {
    hero.hp = hero.maxHp; // immortal: we test triggering, not survival
    const { lines, monster } = engine.walk(80);
    if (lines.length === 0) throw new Error("walk produced no log lines");
    if (monster) {
      encounters++;
      // Auto-fight it the way the UI would.
      const combat = new Combat(hero, monster);
      combat.start();
      if (!combat.playerFirst) combat.monsterAttack();
      let guard = 0;
      while (!combat.over && guard++ < 200) {
        combat.playerAttack();
        if (!combat.over) combat.monsterAttack();
      }
      if (combat.playerWon) combat.victoryLines();
    } else if (lines.some((l) => l.includes("Resolving encounter"))) {
      events++;
    }
  }
} catch (e) {
  crashed = true;
  console.error(e);
}
console.log(`walked ${engine.totalDistance}m, ${encounters} combats, ${events} events, hero HP ${hero.hp}/${hero.maxHp}, gold ${hero.gold}`);
check("60 walks ran without crashing", !crashed);
check("encounters actually triggered", encounters > 0);
check("environmental events actually triggered", events > 0);

console.log(process.exitCode ? "\nSMOKE TEST: FAILURES PRESENT" : "\nSMOKE TEST: ALL GREEN");
