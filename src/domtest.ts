// Headless UI wiring test: drives the real App through creation ->
// adventure -> combat -> victory/defeat using jsdom, no browser needed.
// Run with: npm run uitest
//
// Extended flow: buy a potion -> drink it in combat -> flee a fight ->
// level up -> see the new level-2 ability button. The RNG is seeded, so
// the whole scripted path is deterministic.

import { JSDOM } from "jsdom";
import { setSeed } from "./game/rng.js";
import { App } from "./ui/app.js";

const dom = new JSDOM(`<!doctype html><html><body><div id="app"></div></body></html>`);
(globalThis as Record<string, unknown>)["window"] = dom.window;
(globalThis as Record<string, unknown>)["document"] = dom.window.document;

let failed = false;
function check(label: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failed = true;
}

function click(sel: string): boolean {
  const el = document.querySelector(sel) as HTMLElement | null;
  if (!el) return false;
  el.click();
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = () => document.getElementById("app")?.textContent ?? "";

const seed = (typeof process !== "undefined" && (process as unknown as { env?: Record<string, string> }).env?.["DOMTEST_SEED"])
  ? parseInt((process as unknown as { env: Record<string, string> }).env["DOMTEST_SEED"], 10)
  : 2032; // seed 2032: the scripted hero survives the whole flow
setSeed(seed);
const root = document.getElementById("app")!;
new App(root).start();

// ---- creation screen ----
check("creation screen renders", text().includes("Location RPG"));
const speciesCards = root.querySelectorAll("[data-species]");
const classCards = root.querySelectorAll("[data-class]");
check("9 species cards", speciesCards.length === 9);
check("12 class cards", classCards.length === 12);
(speciesCards[4] as HTMLElement).click(); // Dragonborn
(classCards[0] as HTMLElement).click(); // Fighter
check("begin button exists", click("#begin-btn"));

// ---- adventure screen ----
check("walk button appears", !!root.querySelector("#walk-btn"));
check("shop present", !!root.querySelector("#buy-potion-btn"));
check("XP bar present", !!root.querySelector("#adv-xp-fill"));
check("hero journal has profile", text().includes("HERO PROFILE"));

/** Tap Walk until a combat starts (attack button appears). */
async function walkToCombat(): Promise<boolean> {
  let walks = 0;
  while (!root.querySelector("#attack-btn") && walks < 60) {
    if (!click("#walk-btn")) return false;
    walks++;
  }
  return walks < 60;
}

interface FightOpts {
  /** Dragonborn: fire the breath weapon on round one. */
  useBreath?: boolean;
  /**
   * Potion policy: "test" = quaff on round 0 if a potion is available
   * (verifies the button deterministically); "save" = only drink at/below
   * half HP (conserves potions while grinding).
   */
  usePotion?: "test" | "save";
}

/**
 * Tap-to-move through the real UI: if the Attack button is range-gated,
 * tap the hero token, then the glowing square nearest the monster.
 * No-ops when already in range (or when the button is merely mid-animation).
 */
async function stepIntoRange(): Promise<void> {
  const atk = root.querySelector("#attack-btn") as HTMLButtonElement | null;
  if (!atk || !atk.disabled) return;
  const token = root.querySelector(".gcell.player-token") as HTMLElement | null;
  if (!token) return;
  token.click(); // arm move mode
  await sleep(60);
  const foe = root.querySelector(".gcell.monster-token") as HTMLElement | null;
  if (!foe) return;
  const mx = Number(foe.dataset["x"]);
  const my = Number(foe.dataset["y"]);
  let best: HTMLElement | null = null;
  let bestD = 99;
  root.querySelectorAll<HTMLElement>(".gcell.reachable").forEach((c) => {
    const d = Math.max(Math.abs(Number(c.dataset["x"]) - mx), Math.abs(Number(c.dataset["y"]) - my));
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  });
  if (!best) return; // no destinations: button was busy-disabled, not range-gated
  (best as HTMLElement).click();
  await sleep(60);
}

/** Fight the current combat until it ends (victory, defeat, or fled). */
async function fightToEnd(opts: FightOpts = {}): Promise<void> {
  let rounds = 0;
  let usedBreath = false;
  let quaffed = false; // "test" policy: quaff once, on the first real action
  const dbg = (typeof process !== "undefined" && (process as unknown as { env?: Record<string, string> }).env?.["DOMTEST_DBG"]) === "1";
  while (rounds < 60) {
    if (root.querySelector("#continue-btn") || root.querySelector("#retry-btn")) return;
    // The grid: melee heroes must stand next to the monster. Step into
    // range first (free action), then fight as normal.
    await stepIntoRange();
    let atk = root.querySelector("#attack-btn") as HTMLButtonElement | null;
    if (!atk) return; // combat screen already gone
    const hp = root.querySelector("#pl-hp-text")?.textContent ?? "?";
    const foe = root.querySelector("#foe-hp-text")?.textContent ?? "?";
    if (atk.disabled) {
      // Still out of range (one stride can't cover the opening distance):
      // hold ground like a sensible player and let the monster close in.
      const wait = root.querySelector("#wait-btn") as HTMLButtonElement | null;
      if (wait && !wait.disabled) {
        if (dbg) console.log(`  [r${rounds}] hp=${hp} foe=${foe} -> WAIT`);
        wait.click();
        await sleep(800); // let the monster's delayed turn fire
        rounds++;
        continue;
      }
      await sleep(200); // briefly gated (mid-animation); try again
      continue;
    }
    const breath = root.querySelector("#breath-btn") as HTMLButtonElement | null;
    const potionBtn = root.querySelector("#potion-btn") as HTMLButtonElement | null;
    const hm = hp.match(/(\d+)\/(\d+)/);
    const hasPotion = potionBtn && !potionBtn.disabled && potionBtn.textContent?.includes("(1)");
    // Potion policy: "test" quaffs on the first real action to verify the
    // button (it may not be round 0 anymore — a melee hero might Wait first);
    // "save" only drinks at/below half HP to conserve while grinding.
    // Either way, a smart player chugs FIRST when hurt — before breathing
    // or attacking. (The old code breathed first and died at 2 HP.)
    const wantPotion = opts.usePotion && hasPotion && hm &&
      (opts.usePotion === "test" ? !quaffed : +hm[1] <= +hm[2] / 2);
    if (wantPotion) {
      quaffed = true;
      if (dbg) console.log(`  [r${rounds}] hp=${hp} foe=${foe} -> POTION`);
      (potionBtn as HTMLButtonElement).click();
    } else if (opts.useBreath && breath && !breath.disabled && !usedBreath) {
      usedBreath = true;
      if (dbg) console.log(`  [r${rounds}] hp=${hp} foe=${foe} -> BREATH`);
      breath.click();
    } else {
      if (dbg) console.log(`  [r${rounds}] hp=${hp} foe=${foe} -> ATTACK`);
      atk.click();
    }
    await sleep(800); // let the monster's delayed turn fire
    rounds++;
  }
}

/** Keep fleeing until the fight ends (escape or death). */
async function fleeToEnd(): Promise<void> {
  let tries = 0;
  while (tries < 10) {
    if (root.querySelector("#continue-btn") || root.querySelector("#retry-btn")) return;
    if (!click("#flee-btn")) return;
    await sleep(200); // failed flee resolves synchronously; brief DOM pause
    tries++;
  }
}

const goldNow = () => parseInt(root.querySelector("#adv-gold")?.textContent ?? "0", 10);

// ---- earn enough for a potion (10g) ----
let wonFights = 0;
while (goldNow() < 10 && wonFights < 6) {
  check("reached combat", await walkToCombat());
  await fightToEnd({ useBreath: wonFights === 0 });
  if (root.querySelector("#retry-btn")) break; // hero died; stop the script
  wonFights++;
  click("#continue-btn"); // back to adventure
}
check(`won ${wonFights} fight(s), can afford a potion`, goldNow() >= 10);
check("breath weapon was used in the first fight", text().includes("Breath Weapon"));

// ---- buy a potion ----
const goldBefore = goldNow();
check("buy button clickable", click("#buy-potion-btn"));
check("potion count is 1", (root.querySelector("#adv-potions")?.textContent ?? "") === "1");
check(`gold dropped by 10 (${goldBefore} -> ${goldNow()})`, goldNow() === goldBefore - 10);

// ---- drink the potion mid-combat ----
check("reached combat for potion test", await walkToCombat());
check("potion button shows (1)", (root.querySelector("#potion-btn")?.textContent ?? "").includes("(1)"));
await fightToEnd({ usePotion: "test", useBreath: true }); // breath shortens the fight
check("potion was drunk in combat", text().includes("Quaffed"));
if (!root.querySelector("#retry-btn")) click("#continue-btn");

// ---- battle grid: tap your token, tap a glowing square, token moves ----
check("reached combat for grid test", await walkToCombat());
check("battle grid renders", !!root.querySelector(".battle-grid"));
const pTok = root.querySelector(".gcell.player-token") as HTMLElement | null;
const mTok = root.querySelector(".gcell.monster-token") as HTMLElement | null;
check("hero and monster tokens on the board", !!pTok && !!mTok);
const px0 = pTok?.dataset["x"];
const py0 = pTok?.dataset["y"];
pTok?.click(); // arm move mode
await sleep(60);
check("tapping your token highlights destinations", root.querySelectorAll(".gcell.reachable").length > 0);
const dest = root.querySelector(".gcell.reachable") as HTMLElement | null;
if (dest) dest.click();
await sleep(60);
const pTok2 = root.querySelector(".gcell.player-token") as HTMLElement | null;
check(
  "tapping a glowing square moves your token",
  !!pTok2 && (pTok2.dataset["x"] !== px0 || pTok2.dataset["y"] !== py0)
);
check("move logged in journal", text().includes("slip to a new position"));
await fleeToEnd(); // leave this fight; the flee test below starts its own
check("left the grid-test fight", click("#continue-btn"));

// ---- flee a fight ----
check("reached combat for flee test", await walkToCombat());
await fleeToEnd();
check("flee escape logged in journal", text().includes("slip away"));
check("flee continue button shown", click("#continue-btn"));
check("back at adventure after flee", !!root.querySelector("#walk-btn"));

// ---- grind to level 2 and check the new ability button ----
// Play smart: stock up on potions while affordable, then top up HP.
let bought = 0;
while (goldNow() >= 10 && bought < 3) { click("#buy-potion-btn"); bought++; }
// Best-effort top-up: if there's a potion and HP missing, drink. This is a
// soft check — the game doesn't guarantee the hero can afford a potion.
(() => {
  const hpText = () => root.querySelector("#adv-hp-text")?.textContent ?? "";
  const m = hpText().match(/(\d+)\/(\d+)/);
  const drink = root.querySelector("#drink-potion-btn") as HTMLButtonElement | null;
  if (drink && !drink.disabled) {
    drink.click();
    const m2 = hpText().match(/(\d+)\/(\d+)/);
    check("topped up before grinding", !!m2 && (!m || +m2[1] > +m[1] || +m2[1] === +m2[2]));
  } else {
    console.log("SKIP  topped up before grinding (no potion to drink)");
  }
})();
let leveled = false;
for (let i = 0; i < 8 && !leveled; i++) {
  if (!(await walkToCombat())) break;
  await fightToEnd({ usePotion: "save" });
  if (text().includes("LEVEL UP")) leveled = true;
  if (root.querySelector("#retry-btn")) break;
  click("#continue-btn");
  // Heal up between grind fights if there's a potion left.
  const drink = root.querySelector("#drink-potion-btn") as HTMLButtonElement | null;
  if (drink && !drink.disabled) drink.click();
  // Stock a potion if we can afford one.
  if (goldNow() >= 10) click("#buy-potion-btn");
}
check("hero leveled up to 2", leveled);
check("adventure screen shows Level 2", text().includes("Level 2"));
check("reached combat for ability test", await walkToCombat());
check("level-2 ability button appears", !!root.querySelector(".ability-btn"));
const abilityBtn = root.querySelector(".ability-btn") as HTMLButtonElement | null;
if (abilityBtn) {
  abilityBtn.click();
  await sleep(800);
  check("ability fired in combat", text().includes("Action Surge"));
}

console.log(failed ? "\nUI TEST: FAILURES PRESENT" : "\nUI TEST: ALL GREEN");
if (failed) throw new Error("UI TEST FAILED");
