# File ownership

Who writes what, so two agents can work without merge conflicts. The roadmap's
rules of engagement apply (`ROADMAP.md` § Crew plan): **one work package = one
branch = one agent = one PR**, and **a merge conflict is a boundary bug** — it
means the lanes were crossed, not that the conflict should be brute-forced.

This file is the answer to "may I touch this?": if a directory belongs to another
lane, **open an issue describing the interface you need** and keep moving.

| Path | Lane | What it is |
|---|---|---|
| `src/core/` | **Agent 1** | World state, sim, maths, settings, maps, the skin contract, the gate, combat and enemies. Shared schemas — changes here need a `contract`-labelled PR, and the shapes themselves live in `CONTRACTS.md`. |
| `src/render/` | **Agent 1** | Everything three.js: world view, cognitive manifestation, sky, avatar, pool. |
| `src/platform/` | **Agent 1** | Input (keyboard, mouse, touch), capture, storage. |
| `src/main.js`, `index.html`, `src/style.css` | **Agent 1** | The boot and the frame loop. One writer, always. |
| `src/ui/hud.js`, `src/ui/fade.js`, `src/ui/debug-overlay.js`, `src/ui/tuning-panel.js`, `src/ui/dock.js`, `src/ui/credits.js` | **Agent 1** | Existing chrome. |
| `src/content/` *(new)* | **Agent 2** | Content data and its systems: NPC dialog JSON, definitions, later journal entries. |
| `ENEMY_TYPES` rows in `src/core/enemy.js` *(WP-3.3)* | **Agent 2, by exception** | Archetype *data* only — silhouette, speeds, ranges, timing, colours, `fightable`. The state machine around it is Agent 1's. Adding a row needs a one-line PR touching nothing else; adding a *state* needs a `contract` discussion first. |
| `src/ui/dialog.js` *(new)*, `src/ui/npc-*.js` *(new)* | **Agent 2** | New UI surfaces for the content lane. |
| `tests/unit/` | shared | Add your own files. **Do not edit another lane's test to make your change pass** — that is how a regression gets signed off. |
| `tests/e2e/` | shared | Add your own spec files, e.g. `tests/e2e/npc.spec.js`. |
| `ROADMAP.md`, `DECISIONS.md`, `AGENT_PROMPT.md`, `OWNERSHIP.md` | **Agent 1** | Living documents. Comment or open an issue; do not rewrite. |
| `README.md` | shared | Small edits welcome; keep the existing structure. |
| `.github/`, `scripts/`, `eslint.config.mjs`, `playwright.config.js` | **Agent 1** | CI and tooling. |
| `design/planets/<name>.md` | the world's author | One page per world, per the planet template. |

## Handover points between the two lanes

These are the seams, stated once so neither side has to guess:

- **An NPC is world state.** The entity list in `src/core/world-state.js` is Agent 1's file. Agent 2 defines the *content* (id, name, lines, spawn rule); if the entity shape needs a new field, that is an issue, not an edit.
- **The content loader is Agent 2's.** If NPC data needs to be reachable from the map registry, Agent 2 adds the loader under `src/content/` and asks Agent 1 for the one-line hook.
- **UI is split by file, not by convention.** New dialog and NPC UI lives in new files under `src/ui/`; the HUD's existing files are Agent 1's.
- **Tests are shared, evidence is not.** Whoever writes a feature writes its evidence, in their own spec file, with their own screenshots.

## WP-3.4 (2026-10-17): what the rule cost, and what it froze

WP-3.4 was built *inside* Agent 1's files while the handover issue was still
open. Agent 1 integrated it rather than redoing it, and the seams it added are
now the frozen contract: NPCs are `kind: 'npc'` entities placed from each map's
`npcs` list (`{ id, npcId, position, rotationY, interactRadius }`), and a dialog
pauses the sim. The lesson stands: **if you need a field or a hook that is not
there, ask; do not add it.** The cost of not asking was a second dialogue
implementation (PR #13) that had to be closed, and two red e2e tests caused by
timed walks.

## Frozen now

`CONTRACTS.md` landed with WP-3.1/WP-3.2 (2026-10-17): world state, the map's
`beacons` and `enemyPolicy`, the enemy shape and its one state machine, the
combat event log, and the spawn director's state. Read it before adding a field
anywhere in `src/core/`. The journal entry schema is still open (M4, WP-4.2).

The rule stands: **if you need a field that is not there, ask; do not add it.**

## WP-3.1 / WP-3.2 (2026-10-17): the seam that mattered

Enemies are **not** in `state.entities`. That list is the map's authored
furniture and `entityHash()` is its reproducibility fingerprint — three existing
tests assert that the hash does not move across a realm shift or a re-sim, and
two more count entities against the cognitive realm's bead-and-flame tally.
Actors that come and go are a different kind of thing, and the player has always
been kept out of the entity list for exactly this reason. So `state.enemies`
sits beside `state.player`, and both renderers read it. If you need to know
"what is in the world", there are now two collections and `CONTRACTS.md` §1 says
which is which.
