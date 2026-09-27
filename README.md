# D&D Location RPG — Web Alpha

Phase 2 of the roadmap ("the port"): the Python prototype's game logic,
ported to TypeScript and wrapped in a mobile-first web UI. No frameworks —
just Vite + vanilla TypeScript, so the code stays readable.

## Run it

```bash
cd ~/workspace/dnd-rpg-web
npm install     # once
npm run dev     # dev server, usually http://localhost:5173
```

Open the URL **on your phone** (same Wi-Fi) for the real feel — it's
mobile-first. `npm run build` produces a static `dist/` folder that can be
hosted anywhere.

## Test the game logic (no browser needed)

```bash
npm run smoke
```

This seeds the RNG and simulates hundreds of combats plus a long walk in
plain Node, printing win rates and sanity checks (depth gating, encounters
firing, no crashes).

## Layout

```
src/
  main.ts            # boot: styles + App
  style.css          # dark-fantasy, mobile-first styles
  smoke.ts           # Node smoke test (not bundled into the app)
  domtest.ts         # headless UI click-through test via jsdom (not bundled)
  game/              # DOM-free game logic — ports of dnd_location_rpg.py
    rng.ts           # seeded PRNG (mulberry32) + randint/rollDice/choice
    registries.ts    # species, classes, encounter tables, getBiomeMonster
    character.ts     # Character: stats, HP/AC, abilities, takeDamage
    combat.ts        # Combat: steppable turn engine (start/attack/breath/answer)
    engine.ts        # AdventureEngine: walk, checkpoints, encounters, events
  ui/
    journal.ts       # scrollable log panel
    app.ts           # the three screens: creation, adventure, combat
```

`src/game/` never touches the DOM, so it can be unit-tested in Node
independently of the UI.

## Test the UI wiring (no browser needed)

```bash
npm run uitest
```

This drives the real App through creation → adventure → combat → victory
using jsdom: it buys a potion, drinks it mid-fight, flees a fight, grinds
to level 2, and fires the new level-2 ability button. The RNG is seeded
(2032) so the scripted hero survives the whole flow deterministically.

## What's in this milestone

- Character creation (name, 9 species, 12 classes, live stat preview)
- Walk-to-explore loop with distance checkpoints and a journal
- Turn-based combat: Attack button, Dragonborn Breath Weapon button,
  initiative, Second Wind, Sneak Attack, Smite, Metamagic, Wild Shape,
  Relentless Endurance — all ported from the Python build
- Victory loot + catch-breath healing, defeat flow, depth-gated encounters
  (no Owlbears before 600m)
- **Potions:** Healing Potion (2d4+2) for 10g in the adventure-screen shop
  (~1 goblin kill). Drinking is a **swift action** — you quaff and still
  attack that round. You can also drink outside combat to top up between
  fights. A turn-cost heal mathematically can't save a glass cannon (you
  trade a ~3.25-damage attack for ~3 net HP while the goblin deals ~3.85
  unanswered), so potions work like D&D 2024's bonus-action rule instead.
- **Fleeing:** 50% + 5% × (your DEX mod − monster DEX mod), clamped 20–90%.
  Success ends the fight (no loot/XP); failure gives the monster a free hit.
- **EXP & levels:** monsters award maxHp + 5 × attack bonus XP
  (Goblin 27, Wolf 38, Owlbear 75). Level N needs 100 × N total XP.
  Level-ups add hit die + CON to max HP and heal you by the gain.
- **Level 2:** every class unlocks a once-per-combat ability button —
  Action Surge, Reckless Attack, Steady Aim, Magic Missile, Cure Wounds,
  Divine Smite, Hunter's Mark, Hex, Moonbeam, Stunning Strike,
  Vicious Mockery, Twinned Spell.
- **Level 3:** each class gets a passive upgrade (e.g. Ranger's Favored
  Enemy, which was described but never implemented until now).

## Balance (300-fight sims, `npm run smoke`)

- Fighter vs Goblin 83% · vs Dire Wolf 43% · Wizard vs Goblin 42%
- 3 potions: Wizard vs Goblin 42% → **55%** · Fighter vs Wolf 43% → 59%
  (helps glass cannons, doesn't trivialize — and at 10g a pop you can't
  afford to chug every fight)
- Flee: Rogue vs Goblin escapes ~43% (formula says ~45%)
- Level 2 alone takes the Wizard 42% → 87% vs Goblins (the HP gain);
  with Magic Missile + potions it's ~100%

## Deliberately out of scope (later phases)

- Real GPS tracking (Walk button stands in for it)
- 3D graphics, sound, accounts/backend

## Notes for Ron

- One behavior fix vs. the Python build: a successfully picked trapped
  chest now actually adds its gold to your purse (the Python version
  announced the gold but never credited it — same bug the victory loot
  had before it was fixed).
- Breath Weapon is a manual button here (like the tkinter GUI), not the
  auto-fire from the console version — it takes your turn when used.
