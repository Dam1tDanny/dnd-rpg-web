// The web UI: three screens (creation, adventure, combat) wired to the
// DOM-free game logic in src/game/. The App owns one continuous Journal —
// like the Python console's scrolling transcript — that moves between screens.

import { Character } from "../game/character.js";
import { AdventureEngine } from "../game/engine.js";
import { Combat } from "../game/combat.js";
import { CLASS_REGISTRY, POTION, SPECIES_REGISTRY, xpForLevel, type Monster } from "../game/registries.js";
import { randint } from "../game/rng.js";
import { Journal } from "./journal.js";

/** Escape user text before injecting it into innerHTML templates. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hpWidth(hp: number, maxHp: number): string {
  return `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%`;
}

export class App {
  private root: HTMLElement;
  private journal = new Journal();

  private player: Character | null = null;
  private engine: AdventureEngine | null = null;
  private combat: Combat | null = null;
  private combatBusy = false;
  /** Monster's HP at the start of the current fight (for bar scaling). */
  private monsterStartHp = 1;

  // Character-creation picks (defaults mirror the Python version's option 1).
  private pickedSpecies = "Human";
  private pickedClass = "Fighter";
  private heroName = "Adventurer";

  constructor(root: HTMLElement) {
    this.root = root;
  }

  start(): void {
    this.showCreation();
  }

  // ---------------------------------------------------------------- creation

  private showCreation(): void {
    this.combat = null;
    this.engine = null;

    const speciesCards = Object.entries(SPECIES_REGISTRY)
      .map(
        ([name, s]) => `
        <button class="pick-card ${name === this.pickedSpecies ? "selected" : ""}" data-species="${esc(name)}">
          <span class="pick-name">${esc(name)}</span>
          <span class="pick-sub">${esc(s.trait)}</span>
          <span class="pick-desc">${esc(s.desc)}</span>
        </button>`
      )
      .join("");

    const classCards = Object.entries(CLASS_REGISTRY)
      .map(
        ([name, c]) => `
        <button class="pick-card ${name === this.pickedClass ? "selected" : ""}" data-class="${esc(name)}">
          <span class="pick-name">${esc(name)}</span>
          <span class="pick-sub">${esc(c.weapon)} · ${esc(c.stat.replace("_Mod", ""))}</span>
          <span class="pick-desc">✨ ${esc(c.ability)} — ${esc(c.ability_desc)}</span>
        </button>`
      )
      .join("");

    this.root.innerHTML = `
      <h1 class="title">🐉 D&amp;D Location RPG</h1>
      <p class="subtitle">Web alpha — the Trinket prototype, now with buttons</p>

      <div class="card">
        <label class="field-label" for="hero-name">Hero name</label>
        <input id="hero-name" class="name-input" maxlength="24" value="${esc(this.heroName)}" />
      </div>

      <div>
        <span class="field-label">Species</span>
        <div class="picker-grid" id="species-grid">${speciesCards}</div>
      </div>

      <div>
        <span class="field-label">Class</span>
        <div class="picker-grid" id="class-grid">${classCards}</div>
      </div>

      <div class="card" id="preview-card"></div>

      <button class="btn" id="begin-btn">⚔️ Begin Adventure</button>
    `;

    const nameInput = this.root.querySelector<HTMLInputElement>("#hero-name")!;
    nameInput.addEventListener("input", () => {
      this.heroName = nameInput.value.trim() || "Adventurer";
      this.updatePreview();
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-species]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.pickedSpecies = btn.dataset["species"]!;
        this.root
          .querySelectorAll("[data-species]")
          .forEach((b) => b.classList.toggle("selected", b === btn));
        this.updatePreview();
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-class]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.pickedClass = btn.dataset["class"]!;
        this.root
          .querySelectorAll("[data-class]")
          .forEach((b) => b.classList.toggle("selected", b === btn));
        this.updatePreview();
      });
    });

    this.updatePreview();

    this.root.querySelector("#begin-btn")!.addEventListener("click", () => {
      this.player = new Character(this.heroName, this.pickedSpecies, this.pickedClass);
      this.engine = new AdventureEngine(this.player);
      this.journal.clear();
      this.journal.addMany(this.player.summaryLines());
      this.journal.add("👟 Your adventure begins. Tap Walk to explore the wilds.");
      this.showAdventure();
    });
  }

  /** Live hero-stat preview under the pickers. */
  private updatePreview(): void {
    const preview = this.root.querySelector("#preview-card");
    if (!preview) return;
    const hero = new Character(this.heroName, this.pickedSpecies, this.pickedClass);
    preview.innerHTML = `
      <div class="bar-label"><span>❤️ HP</span><strong>${hero.hp}/${hero.maxHp}</strong></div>
      <div class="hpbar"><div style="width:${hpWidth(hero.hp, hero.maxHp)}"></div></div>
      <div class="stat-chips">
        <span>🛡️ AC <strong>${hero.ac}</strong></span>
        <span>🗡️ <strong>${esc(hero.weapon)}</strong> (1d${hero.damageDice})</span>
      </div>
      <div class="hint" style="text-align:left;margin-top:8px">
        ✨ ${esc(hero.classAbility)} — ${esc(hero.abilityDesc)}
      </div>
    `;
  }

  // ---------------------------------------------------------------- adventure

  private showAdventure(): void {
    if (!this.player || !this.engine) return;
    const player = this.player;
    const engine = this.engine;

    this.root.innerHTML = `
      <div class="card hero-bar">
        <div class="hero-name">${esc(player.name)}</div>
        <div class="hero-sub">${esc(player.speciesName)} · ${esc(player.className)} · <strong>Level ${player.level}</strong></div>
        <div class="bar-label"><span>❤️ HP</span><strong id="adv-hp-text">${player.hp}/${player.maxHp}</strong></div>
        <div class="hpbar"><div id="adv-hp-fill" style="width:${hpWidth(player.hp, player.maxHp)}"></div></div>
        <div class="bar-label"><span>✨ XP</span><strong id="adv-xp-text">${player.xp} / ${xpForLevel(player.level)}</strong></div>
        <div class="hpbar progress"><div id="adv-xp-fill" style="width:${Math.min(100, (player.xp / xpForLevel(player.level)) * 100)}%"></div></div>
        <div class="stat-chips">
          <span>🪙 <strong id="adv-gold">${player.gold}</strong></span>
          <span>🧪 <strong id="adv-potions">${player.potions}</strong></span>
          <span>👟 <strong id="adv-dist">${engine.totalDistance}</strong>m</span>
          <span>🛡️ AC <strong>${player.ac}</strong></span>
        </div>
      </div>

      <div class="card">
        <div class="bar-label"><span>🛒 Shop</span><strong>🧪 × <span id="shop-potion-count">${player.potions}</span></strong></div>
        <p class="hint" style="text-align:left;margin:4px 0 8px">${esc(POTION.name)} — restores 2d4+2 HP. Costs ${POTION.price}g.</p>
        <button class="btn secondary" id="buy-potion-btn">🧪 Buy Potion (${POTION.price}g)</button>
        <button class="btn secondary" id="drink-potion-btn">🥤 Drink Potion</button>
      </div>

      <div class="card">
        <div class="bar-label"><span>📍 Next event</span><strong id="adv-prog-text"></strong></div>
        <div class="hpbar progress"><div id="adv-prog-fill"></div></div>
      </div>

      <div id="journal-slot"></div>

      <button class="btn walk-btn" id="walk-btn">🚶 Walk</button>
      <p class="hint">Each tap covers ground. At the next checkpoint, something finds you…</p>
    `;

    this.journal.element.classList.remove("combat-log");
    this.root.querySelector("#journal-slot")!.appendChild(this.journal.element);
    this.updateAdventureBars();

    this.root.querySelector("#buy-potion-btn")!.addEventListener("click", () => {
      this.journal.addMany(player.buyPotion());
      this.updateAdventureBars();
    });

    // Drinking outside combat is allowed (D&D lets you quaff anytime) — it's
    // how a solo hero tops up between fights. No monster to answer out here.
    this.root.querySelector("#drink-potion-btn")!.addEventListener("click", () => {
      if (player.potions <= 0 || player.hp >= player.maxHp) return;
      this.journal.addMany(player.quaffPotion());
      this.updateAdventureBars();
    });

    this.root.querySelector("#walk-btn")!.addEventListener("click", () => {
      const { lines, monster } = engine.walk(randint(40, 90));
      this.journal.addMany(lines);
      this.updateAdventureBars();
      if (monster) this.showCombat(monster);
    });
  }

  private updateAdventureBars(): void {
    if (!this.player || !this.engine) return;
    const hpText = this.root.querySelector("#adv-hp-text");
    const hpFill = this.root.querySelector<HTMLElement>("#adv-hp-fill");
    const xpText = this.root.querySelector("#adv-xp-text");
    const xpFill = this.root.querySelector<HTMLElement>("#adv-xp-fill");
    const gold = this.root.querySelector("#adv-gold");
    const potions = this.root.querySelector("#adv-potions");
    const shopPotions = this.root.querySelector("#shop-potion-count");
    const dist = this.root.querySelector("#adv-dist");
    const progText = this.root.querySelector("#adv-prog-text");
    const progFill = this.root.querySelector<HTMLElement>("#adv-prog-fill");
    if (hpText) hpText.textContent = `${this.player.hp}/${this.player.maxHp}`;
    if (hpFill) hpFill.style.width = hpWidth(this.player.hp, this.player.maxHp);
    if (xpText) xpText.textContent = `${this.player.xp} / ${xpForLevel(this.player.level)}`;
    if (xpFill) xpFill.style.width = `${Math.min(100, (this.player.xp / xpForLevel(this.player.level)) * 100)}%`;
    if (gold) gold.textContent = `${this.player.gold}`;
    if (potions) potions.textContent = `${this.player.potions}`;
    if (shopPotions) shopPotions.textContent = `${this.player.potions}`;
    if (dist) dist.textContent = `${this.engine.totalDistance}`;
    if (progText) {
      progText.textContent = `${Math.min(this.engine.distanceSinceTrigger, this.engine.nextTriggerTarget)} / ${this.engine.nextTriggerTarget} m`;
    }
    if (progFill) {
      progFill.style.width = `${Math.min(100, (this.engine.distanceSinceTrigger / this.engine.nextTriggerTarget) * 100)}%`;
    }
    // The drink button is only useful with a potion in hand and HP missing.
    const drinkBtn = this.root.querySelector<HTMLButtonElement>("#drink-potion-btn");
    if (drinkBtn) drinkBtn.disabled = this.player.potions <= 0 || this.player.hp >= this.player.maxHp;
  }

  // ------------------------------------------------------------------- combat

  private showCombat(monster: Monster): void {
    if (!this.player) return;
    const player = this.player;
    this.combat = new Combat(player, monster);
    this.combatBusy = false;
    this.monsterStartHp = Math.max(1, monster.hp);

    const canBreath = player.speciesName === "Dragonborn";
    const abilities = player.availableAbilities();
    const abilityButtons = abilities
      .map(
        (a) => `<button class="btn secondary ability-btn" data-ability="${esc(a.id)}">${a.emoji} ${esc(a.name)}</button>`
      )
      .join("");

    this.root.innerHTML = `
      <div class="card monster-card">
        <div class="monster-name">👹 ${esc(monster.name)}</div>
        <div class="monster-sub">Challenge Rating ${esc(monster.cr)}</div>
        <div class="bar-label"><span>❤️ Enemy HP</span><strong id="mon-hp-text">${monster.hp}</strong></div>
        <div class="hpbar monster"><div id="mon-hp-fill" style="width:100%"></div></div>
      </div>

      <div class="card">
        <div class="bar-label"><span>❤️ ${esc(player.name)}</span><strong id="pl-hp-text">${player.hp}/${player.maxHp}</strong></div>
        <div class="hpbar"><div id="pl-hp-fill" style="width:${hpWidth(player.hp, player.maxHp)}"></div></div>
      </div>

      <div id="journal-slot"></div>

      <div id="combat-controls">
        <div class="btn-row">
          <button class="btn" id="attack-btn">⚔️ Attack</button>
          <button class="btn secondary" id="potion-btn">🧪 Potion (${player.potions})</button>
          <button class="btn secondary" id="flee-btn">🏃 Flee</button>
        </div>
        ${canBreath ? `<div class="btn-row"><button class="btn secondary" id="breath-btn">🐉 Breath</button></div>` : ""}
        ${abilityButtons ? `<div class="btn-row" id="ability-row">${abilityButtons}</div>` : ""}
        <p class="hint">${canBreath ? "Breath Weapon: 2d6 elemental burst, once per fight. " : ""}Potions are swift — drink and still attack. Fleeing and abilities take your turn.</p>
      </div>
    `;

    this.journal.element.classList.add("combat-log");
    this.root.querySelector("#journal-slot")!.appendChild(this.journal.element);
    this.journal.addMany(this.combat.start());

    // Monster opening turn when it wins initiative.
    if (!this.combat.playerFirst) {
      this.journal.addMany(this.combat.monsterAttack());
      if (this.combat.over) {
        this.finishCombat();
        return;
      }
    }
    this.updateCombatBars();

    this.root.querySelector("#attack-btn")!.addEventListener("click", () => this.onAttack());
    this.root.querySelector("#potion-btn")!.addEventListener("click", () => this.onPotion());
    this.root.querySelector("#flee-btn")!.addEventListener("click", () => this.onFlee());
    const breathBtn = this.root.querySelector("#breath-btn");
    if (breathBtn) breathBtn.addEventListener("click", () => this.onBreath());
    this.root.querySelectorAll<HTMLButtonElement>(".ability-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.onAbility(btn.dataset["ability"]!));
    });
  }

  private setCombatButtons(enabled: boolean): void {
    const ids = ["#attack-btn", "#potion-btn", "#flee-btn", "#breath-btn"];
    for (const id of ids) {
      const btn = this.root.querySelector<HTMLButtonElement>(id);
      if (btn) btn.disabled = !enabled;
    }
    // Potion button is also dead when the pack is empty.
    const potionBtn = this.root.querySelector<HTMLButtonElement>("#potion-btn");
    if (potionBtn && this.player && this.player.potions <= 0) potionBtn.disabled = true;
    // Breath is only ever usable once per combat, and never mid-animation.
    const breath = this.root.querySelector<HTMLButtonElement>("#breath-btn");
    if (breath && this.combat && !this.combat.player.breathWeaponUsed) {
      breath.disabled = !enabled;
    } else if (breath) {
      breath.disabled = true;
    }
    // Ability buttons die once spent.
    this.root.querySelectorAll<HTMLButtonElement>(".ability-btn").forEach((btn) => {
      const spent =
        !this.combat || this.combat.player.abilitiesUsed.has(btn.dataset["ability"]!);
      btn.disabled = !enabled || spent;
    });
  }

  private onAttack(): void {
    if (this.combatBusy || !this.combat || this.combat.over) return;
    this.combatBusy = true;
    this.setCombatButtons(false);

    this.journal.addMany(this.combat.playerAttack());
    this.updateCombatBars();

    if (this.combat.over) {
      this.finishCombat();
      return;
    }
    // The monster answers a beat later, so taps feel turn-based.
    window.setTimeout(() => this.afterPlayerTurn(), 700);
  }

  private onBreath(): void {
    if (this.combatBusy || !this.combat || this.combat.over) return;
    this.combatBusy = true;
    this.setCombatButtons(false);

    this.journal.addMany(this.combat.breathWeapon());
    this.updateCombatBars();

    if (this.combat.over) {
      this.finishCombat();
      return;
    }
    window.setTimeout(() => this.afterPlayerTurn(), 700);
  }

  /** Drink a potion: swift action — heals now, no monster answer, keep fighting. */
  private onPotion(): void {
    if (this.combatBusy || !this.combat || this.combat.over) return;
    if (this.combat.player.potions <= 0) return;

    // Swift action: no turn spent, so the monster doesn't get a move and
    // there's no 700ms delay — just heal and carry on.
    this.journal.addMany(this.combat.drinkPotion());
    this.updateCombatBars();
    this.refreshPotionButton();
    this.setCombatButtons(true);
  }

  /** Flee: success ends the fight with no loot/XP; failure already hurt. */
  private onFlee(): void {
    if (this.combatBusy || !this.combat || this.combat.over) return;
    this.combatBusy = true;
    this.setCombatButtons(false);

    // flee() runs the monster's free attack synchronously on failure,
    // so there's no delayed turn afterwards — re-enable right away.
    this.journal.addMany(this.combat.flee());
    this.updateCombatBars();

    if (this.combat.over) {
      this.finishCombat();
      return;
    }
    this.combatBusy = false;
    this.setCombatButtons(true);
  }

  /** Fire a level-2 class ability, then the monster answers as usual. */
  private onAbility(id: string): void {
    if (this.combatBusy || !this.combat || this.combat.over) return;
    this.combatBusy = true;
    this.setCombatButtons(false);

    this.journal.addMany(this.combat.useAbility(id));
    this.updateCombatBars();
    this.setCombatButtons(false); // spent ability stays disabled

    if (this.combat.over) {
      this.finishCombat();
      return;
    }
    window.setTimeout(() => this.afterPlayerTurn(), 700);
  }

  /** Keep the potion button's count label and disabled state honest. */
  private refreshPotionButton(): void {
    const btn = this.root.querySelector<HTMLButtonElement>("#potion-btn");
    if (btn && this.player) {
      btn.textContent = `🧪 Potion (${this.player.potions})`;
      if (this.player.potions <= 0) btn.disabled = true;
    }
  }

  private afterPlayerTurn(): void {
    if (!this.combat || this.combat.over) return;
    this.journal.addMany(this.combat.monsterAttack());
    this.updateCombatBars();
    if (this.combat.over) {
      this.finishCombat();
    } else {
      this.combatBusy = false;
      this.setCombatButtons(true);
    }
  }

  private updateCombatBars(): void {
    if (!this.combat || !this.player) return;
    const mon = this.combat.monster;
    const monHpText = this.root.querySelector("#mon-hp-text");
    const monHpFill = this.root.querySelector<HTMLElement>("#mon-hp-fill");
    const plHpText = this.root.querySelector("#pl-hp-text");
    const plHpFill = this.root.querySelector<HTMLElement>("#pl-hp-fill");
    if (monHpText) monHpText.textContent = `${Math.max(0, mon.hp)}`;
    if (monHpFill) monHpFill.style.width = hpWidth(mon.hp, this.monsterStartHp);
    if (plHpText) plHpText.textContent = `${this.player.hp}/${this.player.maxHp}`;
    if (plHpFill) plHpFill.style.width = hpWidth(this.player.hp, this.player.maxHp);
  }

  private finishCombat(): void {
    if (!this.combat || !this.player) return;
    const controls = this.root.querySelector("#combat-controls")!;

    if (this.combat.fled) {
      // Escaped: no loot, no XP, no catch-breath — just walk it off.
      this.updateCombatBars();
      controls.innerHTML = `<button class="btn" id="continue-btn">🚶 Slip back to the trail</button>`;
      this.root.querySelector("#continue-btn")!.addEventListener("click", () => {
        this.journal.add("————————————————————");
        this.showAdventure();
      });
    } else if (this.combat.playerWon) {
      this.journal.addMany(this.combat.victoryLines());
      this.updateCombatBars();
      controls.innerHTML = `<button class="btn" id="continue-btn">🚶 Continue Journey</button>`;
      this.root.querySelector("#continue-btn")!.addEventListener("click", () => {
        this.journal.add("————————————————————");
        this.showAdventure();
      });
    } else {
      this.journal.addMany(this.combat.defeatLines());
      this.updateCombatBars();
      controls.innerHTML = `
        <div class="combat-over">
          <h2 class="defeat-title">💀 Your adventure ends here.</h2>
          <p class="hint">The wilds claim another hero.</p>
          <button class="btn" id="retry-btn" style="margin-top:12px">🗡️ Create a New Hero</button>
        </div>`;
      this.root.querySelector("#retry-btn")!.addEventListener("click", () => this.showCreation());
    }
  }
}
