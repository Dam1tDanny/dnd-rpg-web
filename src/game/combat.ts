// Turn-based combat, ported from the Python CombatManager.
//
// The Python version runs a whole fight in one `while` loop. A web UI can't
// do that — the player taps "Attack" and the monster answers a beat later.
// So this class is a small state machine: the UI calls start(), then
// playerAttack() / breathWeapon(), then monsterAttack(), checking `over`
// after each step. Same math, same order, just driven one turn at a time.

import { randint, rollDice } from "./rng.js";
import type { Character } from "./character.js";
import { xpForMonster, type Monster } from "./registries.js";
import { BattleGrid, type Pos } from "./grid.js";

/**
 * Weapons that strike from anywhere on the grid. Everything else is a melee
 * weapon: the hero must stand next to the monster to use it.
 */
const RANGED_WEAPONS = new Set([
  "Longbow", // Ranger
  "Fire Bolt Cantrip", // Wizard
  "Eldritch Blast", // Warlock
  "Chromatic Orb", // Sorcerer
]);

/**
 * Abilities that work at any range regardless of the class's weapon.
 * (Magic Missile and Vicious Mockery are ranged spells; Cure Wounds
 * targets the caster themself.) Everything else follows weapon range.
 */
export const RANGED_ABILITIES = new Set([
  "magic_missile",
  "vicious_mockery",
  "cure_wounds",
]);

export class Combat {
  player: Character;
  monster: Monster;

  playerFirst = true;
  sneakArmed = false;
  round = 0;

  /** True once someone hit 0 HP. Check after every turn. */
  over = false;
  playerWon = false;
  /** True when the player fled successfully: no loot, no XP, back to trail. */
  fled = false;

  /** The tactical board: your token vs the monster's token. */
  grid = new BattleGrid();
  /** One reposition per round — you can't bank movement. Reset whenever
   *  the player spends their attack/ability for the round. */
  private movedThisRound = false;

  // ---- per-fight ability state (level-2 actives + their side effects) ----
  /** One-shot bonus to the next attack roll (Reckless Attack, Steady Aim). */
  private tempAttackBonus = 0;
  /** Barbarian Reckless Attack backfire: monster gets +4 on its next attack. */
  private recklessVulnerable = false;
  /** Paladin Divine Smite: +2d8 on the empowered attack, then spent. */
  private smiteArmed = false;
  /** Ranger Hunter's Mark: +1d6 on attacks until this monster dies. */
  private huntersMark = false;
  /** Warlock Hex: +1d6 on attacks and -1 to monster's attacks while cursed. */
  private hexed = false;
  /** Monk Stunning Strike: monster skips its next attack. */
  private monsterStunned = false;
  /** Bard Vicious Mockery: -2 on the monster's next attack roll. */
  private mockeryPenalty = 0;
  /** Whether the most recent executePlayerTurn() actually hit. */
  private lastAttackHit = false;

  constructor(player: Character, monster: Monster) {
    this.player = player;
    this.monster = monster;
  }

  /** Roll initiative and refresh once-per-combat powers. */
  start(): string[] {
    const lines: string[] = [];
    lines.push(`⚔️ COMBAT INITIATED: ${this.player.name} vs ${this.monster.name}! ⚔️`);
    lines.push(`Enemy HP: ${this.monster.hp} | Your HP: ${this.player.hp}/${this.player.maxHp}`);

    // Fresh fight: refresh once-per-combat abilities.
    this.player.resetCombatFlags();

    const pInit = this.player.rollCheck("Dexterity_Mod");
    const mInit = randint(1, 20) + this.monster.dex_mod;
    lines.push(...pInit.lines);
    lines.push(`🎲 Initiative: You got ${pInit.total} | ${this.monster.name} got ${mInit}`);

    this.playerFirst = pInit.total >= mInit;

    // Rogue Sneak Attack triggers on winning initiative; spent on the first hit.
    this.sneakArmed = this.player.className === "Rogue" && this.playerFirst;
    if (this.sneakArmed) {
      lines.push("  🗡️ [Rogue Sneak Attack] Quick initiative grants bonus damage on your first hit!");
    }
    return lines;
  }

  // ---------------------------------------------------------- grid movement

  /** True when the hero's weapon strikes from anywhere on the board. */
  playerRanged(): boolean {
    return RANGED_WEAPONS.has(this.player.weapon);
  }

  /** True when the hero can currently land their weapon attack. */
  playerInRange(): boolean {
    return this.playerRanged() || this.grid.adjacent();
  }

  /** True when the named ability can currently be fired. */
  abilityInRange(id: string): boolean {
    return RANGED_ABILITIES.has(id) || this.playerInRange();
  }

  /**
   * Reposition the hero's token (up to PLAYER_MOVE squares). One move per
   * round; attacking (or firing an ability/breath) refreshes it. The UI
   * calls this from grid taps; it never spends the attack itself.
   */
  movePlayer(x: number, y: number): string[] {
    if (this.over) return [];
    if (this.movedThisRound) {
      return ["👟 You've already repositioned this round — attack!"];
    }
    if (!this.grid.movePlayerTo(x, y)) {
      return ["👟 You can't get there from here."];
    }
    this.movedThisRound = true;
    return [`👟 You slip to a new position. (${this.describeRange()})`];
  }

  /**
   * Legal tap destinations for the hero token right now. Empty once the
   * hero has repositioned this round — the UI offers no phantom moves.
   */
  moveDestinations(): Pos[] {
    if (this.movedThisRound || this.over) return [];
    return this.grid.playerReachable();
  }

  /**
   * Move the hero's token toward the monster (used by the sims to play the
   * grid like a sensible player would; the real UI moves via taps).
   */
  strideTowardMonster(): boolean {
    if (this.movedThisRound || this.over) return false;
    const moved = this.grid.strideTowardMonster();
    if (moved) this.movedThisRound = true;
    return moved;
  }

  private describeRange(): string {
    if (this.playerRanged()) return "ranged attacker";
    return this.grid.adjacent() ? "in melee range" : `${this.grid.distance()} away`;
  }

  // ------------------------------------------------------------------ turns

  /**
   * One full player round: Fighter Second Wind check, then the weapon attack.
   * If the monster won initiative, the UI should run monsterAttack() once
   * right after start() — that's the monster's opening turn.
   */
  playerAttack(): string[] {
    const lines: string[] = [];
    // Range gate: a melee hero must stand next to the monster to swing.
    // (The UI disables the Attack button out of range; this keeps every
    // direct caller honest too.) A fizzle costs nothing and doesn't advance
    // the round — the monster still gets its turn via the normal flow.
    if (!this.playerInRange()) {
      return ["📍 Too far away! Move next to the enemy first."];
    }
    this.round += 1;
    lines.push(`--- Round ${this.round} ---`);

    // Fighter Second Wind: fires once per fight when bloodied.
    // Level 3 improves it from 1d10 to 2d10.
    if (
      this.player.className === "Fighter" &&
      this.player.hp < this.player.maxHp / 2 &&
      !this.player.secondWindUsed
    ) {
      const heal = rollDice(10, this.player.level >= 3 ? 2 : 1) + this.player.stats["Constitution_Mod"];
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
      this.player.secondWindUsed = true;
      lines.push(`  🛡️ [Fighter Second Wind] Triggered! Recovered ${heal} HP! Current HP: ${this.player.hp}/${this.player.maxHp}`);
    }

    lines.push(...this.executePlayerTurn());
    if (this.monster.hp <= 0) {
      this.over = true;
      this.playerWon = true;
    }
    return lines;
  }

  /**
   * Dragonborn Breath Weapon, fired from its own button (once per combat).
   * It takes the place of the attack this round — the monster still answers.
   */
  breathWeapon(): string[] {
    const lines: string[] = [];
    if (this.player.speciesName !== "Dragonborn" || this.player.breathWeaponUsed) {
      return lines;
    }
    // Breath is a short cone: you must be standing next to the enemy.
    // (The UI disables the button out of range; this is the safety net —
    // it never consumes the breath.)
    if (!this.grid.adjacent()) {
      return ["📍 Too far away! Get next to the enemy to unleash your breath."];
    }
    this.round += 1;
    lines.push(`--- Round ${this.round} ---`);
    this.player.breathWeaponUsed = true;
    const breath = rollDice(6, 2);
    this.monster.hp -= breath;
    lines.push(`  🐉 [Dragonborn Breath Weapon] Elemental burst for ${breath} damage! ${this.monster.name} HP: ${Math.max(0, this.monster.hp)}`);
    if (this.monster.hp <= 0) {
      this.over = true;
      this.playerWon = true;
    }
    return lines;
  }

  /** The monster's answer. The UI calls this ~700ms after the player's turn. */
  monsterAttack(): string[] {
    const lines: string[] = [];

    // A full round-trip just completed: the hero's movement refreshes for
    // their next turn. (Resetting here — rather than on attack — means a
    // hero who repositioned but couldn't attack is never movement-locked.)
    this.movedThisRound = false;

    // Monk Stunning Strike: a stunned monster loses its attack entirely.
    if (this.monsterStunned) {
      this.monsterStunned = false;
      lines.push(`💫 The ${this.monster.name} is STUNNED and can't act!`);
      lines.push(`Your HP: ${Math.max(0, this.player.hp)}/${this.player.maxHp}`);
      return lines;
    }

    lines.push(`🐾 The ${this.monster.name} attacks!`);

    // The monster rushes you first (up to 4 squares), then strikes only if
    // it reached melee range. A fast hero can kite for a turn or two — but
    // the board is small and the monster is faster, so it always catches up.
    if (this.grid.moveMonster()) {
      lines.push(`  👟 The ${this.monster.name} rushes across the battlefield!`);
    }
    if (!this.grid.adjacent()) {
      lines.push(`  💨 The ${this.monster.name} can't reach you this turn!`);
      lines.push(`Your HP: ${Math.max(0, this.player.hp)}/${this.player.maxHp}`);
      return lines;
    }

    const rawRoll = randint(1, 20);
    let totalAttack = rawRoll + this.monster.attack_bonus;
    const mods: string[] = [];
    // Side-effect modifiers, each consumed or persistent as noted.
    if (this.recklessVulnerable) {
      totalAttack += 4;
      this.recklessVulnerable = false;
      mods.push("+4 reckless opening");
    }
    if (this.hexed) {
      totalAttack -= 1;
      mods.push("-1 hexed");
    }
    if (this.mockeryPenalty > 0) {
      totalAttack -= this.mockeryPenalty;
      mods.push(`-${this.mockeryPenalty} mocked`);
      this.mockeryPenalty = 0;
    }
    if (this.player.className === "Bard" && this.player.level >= 3) {
      totalAttack -= 2; // Cutting Words: always harder to hit a master bard
      mods.push("-2 cutting words");
    }
    lines.push(`🎲 Enemy Attack Roll: ${rawRoll} + ${this.monster.attack_bonus} = ${totalAttack} vs your AC ${this.player.ac}${mods.length ? ` (${mods.join(", ")})` : ""}`);

    if (totalAttack >= this.player.ac) {
      const dmg = rollDice(this.monster.damage_dice_sides, 1) + this.monster.damage_bonus;
      lines.push(`🩸 OUCH! Hits for ${dmg} damage!`);
      lines.push(...this.player.takeDamage(dmg));
    } else {
      lines.push("💨 You step aside and dodge the attack!");
    }
    lines.push(`Your HP: ${Math.max(0, this.player.hp)}/${this.player.maxHp}`);

    if (this.player.hp <= 0) {
      this.over = true;
      this.playerWon = false;
    }
    return lines;
  }

  /**
   * Drink a healing potion: 2d4+2 HP. Drinking is a SWIFT action — it does
   * NOT cost your attack (D&D 2024 made it a bonus action). The monster
   * answers after your next attack as usual. The UI disables the button
   * when the pack is empty.
   */
  drinkPotion(): string[] {
    const lines: string[] = [];
    if (this.player.potions <= 0) return lines;
    lines.push(...this.player.quaffPotion());
    return lines;
  }

  /**
   * Try to run from the fight. Chance is DEX vs DEX:
   *   50% + 5% per point of (player DEX mod − monster DEX mod), clamped 20–90%.
   * Success: the fight ends with fled=true — the UI sends you back to the
   * trail with no loot and no XP. Failure: the monster gets a free attack
   * immediately (no 700ms delay — it seizes the opening).
   */
  flee(): string[] {
    const lines: string[] = [];
    this.round += 1;
    const diff = this.player.stats["Dexterity_Mod"] - this.monster.dex_mod;
    const chance = Math.min(90, Math.max(20, 50 + 5 * diff));
    const roll = randint(1, 100);
    lines.push(`🏃 You try to flee! (Chance ${chance}% — rolled ${roll})`);
    if (roll <= chance) {
      this.over = true;
      this.fled = true;
      lines.push(`💨 You slip away from the ${this.monster.name}! No loot, no glory — but you're alive.`);
    } else {
      lines.push(`🚫 No escape! The ${this.monster.name} cuts you off and strikes!`);
      lines.push(...this.monsterAttack());
    }
    return lines;
  }

  /**
   * Fire a level-2 class ability (ids live in CLASS_LEVEL_ABILITIES).
   * Each is once per combat and takes your turn, like Breath Weapon.
   * Returns [] if the id is unknown, locked, or already spent.
   */
  useAbility(id: string): string[] {
    const lines: string[] = [];
    const player = this.player;
    if (player.abilitiesUsed.has(id)) return lines;
    const unlocked = player.availableAbilities().some((a) => a.id === id);
    if (!unlocked) return lines;
    // Range check BEFORE spending: most abilities follow the class's weapon
    // range (melee classes must be adjacent). Ranged spells and self-heals
    // always work. Failing here refunds the ability — nothing is consumed.
    if (!this.abilityInRange(id)) {
      return ["📍 Too far away! Move next to the enemy first."];
    }
    player.abilitiesUsed.add(id);

    this.round += 1;
    lines.push(`--- Round ${this.round} ---`);

    switch (id) {
      case "action_surge": { // Fighter: attack twice, right now
        lines.push("  ⚡ [Action Surge] A burst of speed — you attack twice!");
        lines.push(...this.executePlayerTurn());
        if (this.monster.hp > 0) lines.push(...this.executePlayerTurn());
        break;
      }
      case "twinned_spell": { // Sorcerer: next attack strikes twice
        lines.push("  🔮 [Twinned Spell] Your spell splits — it strikes twice!");
        lines.push(...this.executePlayerTurn());
        if (this.monster.hp > 0) lines.push(...this.executePlayerTurn());
        break;
      }
      case "reckless_attack": { // Barbarian: +4 to hit, monster +4 back
        lines.push("  😡 [Reckless Attack] You throw caution aside: +4 to hit, but you're exposed!");
        this.tempAttackBonus = 4;
        this.recklessVulnerable = true;
        lines.push(...this.executePlayerTurn());
        break;
      }
      case "steady_aim": { // Rogue: +5 to one attack roll
        lines.push("  🎯 [Steady Aim] You line up the perfect shot: +5 to hit!");
        this.tempAttackBonus = 5;
        lines.push(...this.executePlayerTurn());
        break;
      }
      case "divine_smite": { // Paladin: attack with +2d8 radiant
        lines.push("  🌟 [Divine Smite] Your weapon blazes with radiant power!");
        this.smiteArmed = true;
        lines.push(...this.executePlayerTurn());
        break;
      }
      case "hunters_mark": { // Ranger: mark, then attack (mark boosts it too)
        lines.push(`  🏹 [Hunter's Mark] You mark the ${this.monster.name}: +1d6 on your attacks until it dies!`);
        this.huntersMark = true;
        lines.push(...this.executePlayerTurn());
        break;
      }
      case "hex": { // Warlock: curse, then attack (curse boosts it too)
        lines.push(`  🟣 [Hex] You curse the ${this.monster.name}: +1d6 on your attacks, -1 to its attacks!`);
        this.hexed = true;
        lines.push(...this.executePlayerTurn());
        break;
      }
      case "stunning_strike": { // Monk: hit -> monster skips its next attack
        lines.push("  💫 [Stunning Strike] You aim for a nerve cluster!");
        lines.push(...this.executePlayerTurn());
        if (this.lastAttackHit && this.monster.hp > 0) {
          this.monsterStunned = true;
          lines.push(`  💫 The ${this.monster.name} reels — it's STUNNED!`);
        }
        break;
      }
      case "magic_missile": { // Wizard: auto-hit 3d4+3, no attack roll
        const dmg = rollDice(4, 3) + 3;
        this.monster.hp -= dmg;
        lines.push(`  ✨ [Magic Missile] Unerring darts of force strike for ${dmg} damage! ${this.monster.name} HP: ${Math.max(0, this.monster.hp)}`);
        break;
      }
      case "moonbeam": { // Druid: attack roll, 2d10 radiant on hit
        const check = player.rollCheck(player.primaryStat);
        lines.push(...check.lines);
        lines.push(`  🌙 [Moonbeam] Attack Roll: ${check.roll} + ${check.mod} = ${check.total} vs Enemy AC ${this.monster.ac}`);
        if (check.roll === 20 || check.total >= this.monster.ac) {
          const dmg = rollDice(10, 2) + check.mod;
          this.monster.hp -= dmg;
          lines.push(`  🌙 Searing moonlight for ${dmg} radiant damage! ${this.monster.name} HP: ${Math.max(0, this.monster.hp)}`);
        } else {
          lines.push("  🌙 The beam scatters harmlessly into the trees.");
        }
        break;
      }
      case "vicious_mockery": { // Bard: auto-hit 1d4 + monster -2 next attack
        const dmg = rollDice(4, 1);
        this.monster.hp -= dmg;
        this.mockeryPenalty = 2;
        lines.push(`  🎭 [Vicious Mockery] Your insults cut deep: ${dmg} psychic damage, and the ${this.monster.name} is rattled (-2 on its next attack)! ${this.monster.name} HP: ${Math.max(0, this.monster.hp)}`);
        break;
      }
      case "cure_wounds": { // Cleric: heal 2d8+WIS instead of attacking
        const heal = Math.min(
          rollDice(8, 2) + player.stats["Wisdom_Mod"],
          player.maxHp - player.hp
        );
        player.hp += heal;
        lines.push(`  💚 [Cure Wounds] Warm light knits your wounds: +${heal} HP. (${player.hp}/${player.maxHp})`);
        break;
      }
      default:
        return [];
    }

    if (this.monster.hp <= 0) {
      this.over = true;
      this.playerWon = true;
    }
    return lines;
  }

  /** Loot + catch-breath + rest. Called once by the UI after a win. */
  victoryLines(): string[] {
    const lines: string[] = [];
    lines.push(`🏆 VICTORY! You defeated the ${this.monster.name}!`);
    const gold = randint(5, 20);
    this.player.gold += gold;
    lines.push(`💰 You loot ${gold} gold pieces from the defeated target.`);
    // XP scales with how scary the monster was. Level-ups (with fanfare)
    // are handled inside gainXp().
    lines.push(...this.player.gainXp(xpForMonster(this.monster)));
    if (this.player.hp < this.player.maxHp) {
      // Catch your breath: everyone recovers a little after a win, so one
      // fight doesn't doom the whole adventure. (Aasimar tops up via rest().)
      const recover = Math.max(3, Math.floor(this.player.maxHp / 3));
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + recover);
      lines.push(`💨 You catch your breath and recover ${recover} HP. (${this.player.hp}/${this.player.maxHp})`);
      lines.push(...this.player.rest());
    }
    return lines;
  }

  defeatLines(): string[] {
    return [`💀 DEFEAT... The ${this.monster.name} bested you in battle.`];
  }

  /** The weapon attack itself: roll to hit, roll damage, apply bonuses. */
  private executePlayerTurn(): string[] {
    const lines: string[] = [];
    const statUsed = this.player.primaryStat;
    const check = this.player.rollCheck(statUsed);
    lines.push(...check.lines);

    // One-shot and passive attack-roll bonuses.
    const rollBonus =
      this.tempAttackBonus +
      (this.player.className === "Warlock" && this.player.level >= 3 ? 1 : 0); // Eldritch Precision
    const attackTotal = check.total + rollBonus;

    lines.push(`⚡ ${this.player.name} attacks with ${this.player.weapon}!`);
    lines.push(
      `🎲 Attack Roll: ${check.roll} + ${check.mod} (${statUsed.replace("_Mod", "")}) = ${attackTotal} vs Enemy AC ${this.monster.ac}` +
      (rollBonus > 0 ? ` (+${rollBonus} ability)` : "")
    );

    let smiteDamage = 0;
    let dmgDiceCount: number;
    this.lastAttackHit = false;
    if (check.roll === 20) {
      lines.push("💥 CRITICAL HIT!");
      this.lastAttackHit = true;
      dmgDiceCount = 2;
      if (this.player.className === "Paladin") {
        lines.push("  ✨ [Paladin Divine Smite] Smites for extra radiant damage!");
        smiteDamage = rollDice(8, 1); // Smite is always a d8, per the description
      }
    } else if (attackTotal >= this.monster.ac) {
      lines.push("⚔️ HIT!");
      this.lastAttackHit = true;
      dmgDiceCount = 1;
    } else {
      lines.push("🛡️ MISS! The blow is deflected.");
      this.sneakArmed = false; // spent whether it lands or not
      this.tempAttackBonus = 0; // one-shot bonuses are spent on a miss too
      return lines;
    }
    this.tempAttackBonus = 0; // one-shot bonuses don't carry to the next attack

    // Sorcerer Metamagic: the first strike that LANDS each fight uses max
    // faces, no rolling. (Checked after the miss so a miss doesn't waste it.)
    // Level 3 Empowered Spell also adds +CHA on top.
    let damage: number;
    if (this.player.metamagicAvailable) {
      this.player.metamagicAvailable = false;
      const empower = this.player.level >= 3 ? this.player.stats["Charisma_Mod"] : 0;
      damage = this.player.damageDice * dmgDiceCount + check.mod + empower;
      lines.push(`  🔮 [Sorcerer Metamagic] Dice maximized: ${dmgDiceCount}d${this.player.damageDice} -> ${this.player.damageDice * dmgDiceCount} + ${check.mod}${empower ? ` + ${empower} (Empowered)` : ""}!`);
    } else {
      damage = rollDice(this.player.damageDice, dmgDiceCount) + check.mod;
    }

    damage += smiteDamage;

    if (this.sneakArmed) {
      // Level 3: Sneak Attack grows from 1d6 to 2d6.
      damage += rollDice(6, this.player.level >= 3 ? 2 : 1);
      this.sneakArmed = false;
    }

    if (this.player.className === "Warlock") {
      damage += this.player.stats["Charisma_Mod"]; // Agonizing Blast
    }

    if (this.player.className === "Barbarian") {
      damage += 2; // Rage: +2 flat damage on attacks
      lines.push("  😡 [Barbarian Rage] +2 rage damage!");
    }

    // Level-2 mark/curse riders: +1d6 while the mark lasts.
    if (this.huntersMark) {
      const mark = rollDice(6, 1);
      damage += mark;
      lines.push(`  🏹 [Hunter's Mark] +${mark} damage!`);
    }
    if (this.hexed) {
      const hex = rollDice(6, 1);
      damage += hex;
      lines.push(`  🟣 [Hex] +${hex} necrotic damage!`);
    }
    // Paladin Divine Smite button: +2d8 radiant on the empowered attack.
    if (this.smiteArmed) {
      const smite = rollDice(8, 2);
      damage += smite;
      this.smiteArmed = false;
      lines.push(`  🌟 [Divine Smite] +${smite} radiant damage!`);
    }

    // Level-3 passive damage upgrades.
    if (this.player.className === "Cleric" && this.player.level >= 3) {
      damage += 2; // Blessed Strikes
      lines.push("  ✨ [Blessed Strikes] +2 damage!");
    }
    if (this.player.className === "Ranger" && this.player.level >= 3) {
      // Favored Enemy was in the class description all along but never
      // implemented in combat — level 3 finally switches it on.
      damage += 2;
      lines.push("  🏹 [Favored Enemy] +2 damage!");
    }

    if (this.player.speciesName === "Aasimar") {
      damage += 2; // Radiant Soul passive
    }

    this.monster.hp -= damage;
    lines.push(`💥 Dealt ${damage} damage! ${this.monster.name} HP: ${Math.max(0, this.monster.hp)}`);

    // Monk Flurry of Blows: bonus strike uses the Monk's own damage die.
    if (this.player.className === "Monk" && this.monster.hp > 0) {
      lines.push("  🥋 [Monk Flurry of Blows] Delivering a secondary strike!");
      const extraDmg = rollDice(this.player.damageDice, 1) + this.player.stats["Dexterity_Mod"];
      this.monster.hp -= extraDmg;
      lines.push(`  💥 Flurry hit for ${extraDmg} damage! ${this.monster.name} HP: ${Math.max(0, this.monster.hp)}`);
    }
    return lines;
  }
}
