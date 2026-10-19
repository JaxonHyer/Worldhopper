# Worldhopper

*working title — an **unofficial, non-commercial** fan project (see [NOTICE.md](NOTICE.md))*

A low-poly 3D planet-exploration game. You are a worldhopper-scholar: walk small
worlds on foot, dip into the **Cognitive Realm** — a flat, orthographic reading
of the *same* world — to see truth the physical eye cannot, survive the world's
dangers, attune to different magic systems, and open each world's
**Perpendicularity** to hop onward.

- Touchstone: *Outer Wilds* — a tiny system where every location is built around
  exactly one idea.
- Anti-reference: *No Man's Sky* — infinite scale, crafting and grind are
  explicitly out of scope.

**Status: M2 — the Cognitive Realm (in progress).** You can walk a world: a capsule against the terrain
heightfield, solid rocks and landmark, jump with coyote time and a jump buffer,
and a phone-first control scheme (thumb-stick, look-drag, jump button, sprint
toggle). The
camera is **third person** — a boom behind your character, which pulls in rather
than pass through terrain (`?view=first` puts you back behind the eyes). Every
feel number — walk speed, jump height, gravity, acceleration, view bob, camera
distance — is a live slider in the tuning panel.

**Art direction:** characters are **blocky and pixelated** — ten boxes wearing
tiny textures (an 8×8 head with a face on it, an 8×12 shirt, 4×12 sleeves and
trouser legs) drawn with nearest-neighbour filtering, so the pixels stay pixels.
The face is Minecraft-style: two eyes with whites, a nose, a jaw, hair over the
top and round the back. The player wears ordinary clothes — a plain shirt, plain
trousers, boots — and there are **two of them**: a boy and a girl, chosen by one
boolean (`?girl=1`, or **Girl player character** in the tuning panel). The girl
is the same ten boxes with slimmer arms; her long hair is **painted into her
textures** (down the sides of her head, and over the shoulders of her shirt)
rather than modelled, so she costs the renderer exactly what the boy costs.
Enemies
(M3) and NPCs (M5) follow the same recipe. The *world* stays low-poly faceted.
Both are generated in code — no imported models, no image files, no canvas: the
art is data (`src/core/pixel-art.js`) turned into textures at load.

Because the camera sits behind you, your character faces **the way it is
walking** — so walking backwards (or turning round) puts the face in view.

---

## Play it

- **Live:** <https://jaxonhyer.github.io/Worldhopper/> (GitHub Pages, built by CI)
- **Local:**
  ```bash
  npm ci
  npm run dev     # http://localhost:5173
  ```

**Desktop:** **click the world to capture the mouse** — after that the camera
follows the mouse with no button held, and <kbd>Esc</kbd> releases it (the
crosshair shows while captured). <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>
or the arrow keys walk · <kbd>space</kbd> jump · <kbd>Q</kbd>/<kbd>E</kbd> turn
without a mouse. If capture is refused (an embedded frame, for instance) or
switched off with `?capture=off`, dragging with the button held looks around
instead — the game is playable either way.

**Animation:** the walk cycle is driven by distance travelled, so the legs
always match the ground — but the *rate* is capped (`Animation speed cap` in the
panel, `?striderate=`), because at 7.9 m/s an uncapped stride would swing the
legs five times a second and read as a vibration. Past the cap the limbs widen
their swing instead of quickening, so a sprint still looks like a sprint.

**Sprint:** hold <kbd>shift</kbd> on a desktop; on a phone tap the round
**sprint** button at the bottom-left once (it is a toggle, so the thumb that
would hold it is free for the stick) — it lights up while it is on. Either way
it multiplies the walk speed by `Sprint speed` (`?sprint=`, default 2.2×) while
you are actually moving, and it is the *speed* that changes: the stride rate
stays capped, so a sprint widens the swing rather than blurring it.

**The realm shift (M2) — walk into the Perpendicularity.** Fourteen metres
ahead of where you land there is a **pool**, and stepping into it shifts you
between the Physical and the Cognitive Realm, behind a **fade to black**. There
is no key for it and no button: a Perpendicularity is a gate between realms, so
the shift is a place you go, not a control you press. Walk out and back in to
shift again (standing in it does not flap you between realms, and arriving in it
does not bounce you straight back).

The **Cognitive lens** is the same world drawn again: orthographic, high-angle,
centred on you, with a badge at the bottom of the screen saying which realm you
are in. The world state is untouched by a shift — asserted two ways (a unit test
walks the same seed in both realms to the same entity hash; the browser test
steps into the pool and checks the tick, the entity hash and the player position
across the fade). Walking, jumping and looking all still work in the lens;
`Realm transition (ms)` sets the length of the fade, and `Cognitive lens height`
sets how much of the world it shows.

**Hop between worlds — walking between two gates.** A Perpendicularity is
only ever a realm swap: into the pool is a flip — so a worldhop is TWO of
them. Go into your gate (you're in the Cognitive Realm), then WALK to a
*different* gate on that flat plane. There's now **a laid trail of small
ochre flint markers** between the two wells of light in the lens, so the way
there reads at a glance from the pool's column. Stepping into the second well
lands you on the other planet, at its pool; the return trip is the same two
gates in reverse (Roshar ↔ "the Quiet Basin" for now, a stub destination
proving the door closes behind you and still counts as a door).

**And the far side is safe from them — by canon, too:** everything that lives
on the physical side **cannot see you while you are in the Cognitive
Realm**. Hunting an enemy? Step through the veil and it loses your trail
right there (it goes home, not through the dimension). Walking on that other
plane, they don't see you, no matter what they were doing.

**Do one thing you can only do there.** In the Cognitive Realm, four small
**memory-flames** stand on Roshar's pool obsidian — walk through one and it
stays lit (they don't exist in the physical world at all; that is the entire
"only solvable there" rule). Each lit flame raises an obsidian stepping stone
in the physical pool; the fourth completes a dry causeway across the basin.

**The other realm has a look, and it is per-world data.** `cognitiveSkin` says
what *this* world's subastral is made of, because canon says every world's is
different — Shadesmar is Roshar's, and it is glass beads, while Scadrial's is
mist. Roshar is the first world to author one and is now **the world the game
opens on** (`src/worlds/roshar/`): objects become dark glass beads, the living
become flames, water
inverts to obsidian, the land is a bead sea, and the sky is black with a single
frail sun that never moves. The M0 test range is still there for harness work
(`?map=blank-basin`), and it draws **nothing** in the other realm — it has no
canon, so it has no subastral, and that absence is itself tested. The guard that keeps it honest is a test, not a
comment: **beads and the bead sea are refused on any map whose system is not
`rosharan`**, and a map with no authored skin draws nothing at all — the test
range behaves exactly as it did before skins existed.

**Camera:** third person by default — you are looking at your character from
behind, and the camera slides closer when a hill or a rock is in the way. Look
up is limited (the boom would end up in the floor); **Camera** in the tuning
panel switches to first person, where the full vertical range comes back.

**Talk to people:** walk up to someone and a **Talk** prompt appears — tap it
on a phone, or press <kbd>F</kbd> (or <kbd>Enter</kbd>) at a keyboard. The
conversation pauses the world while the card is open; <kbd>Esc</kbd> closes it.
There are two people so far: a wanderer on the test range and Kurin on Roshar.
Their words are JSON files under `src/content/npcs/`, one per person.

**The world is inhabited, and it fights back.** Enemies appear in a ring around
you and wander their own patch until they notice you; the director keeps the
world populated as you explore and empties it behind you, so a long walk neither
runs out of company nor accumulates an army. Two Rosharan archetypes, from the
owner's design passes: the **Whitespine** — a fast, spined quadruped worth
**ten punches**, with snappy reactions and white plates along a back built to
read in the fog — and the **Chasmfiend**: a centipede-crab the length of a
street, a chain of shell forty legs deep with pincers that rise before it
strikes. **You cannot fight it at all.** Chasmfiends are rare (one in ten
wandering draws), except for the one that always guards the Perpendicularity
when the game loads — for testing. Punch it and your fist recoils off the
shell; the one defence is to **stand your ground and look at it**, and its
strike breaks off. Its shell is solid **end to end** — walk into any section
and it's a wall like a rock's, head to tail. Both are slower than you walk — go
around it and you're gone.

**Fight back:** <kbd>J</kbd> at a keyboard, a left click once the mouse is
captured, or the amber **punch** button on a phone. One tap is one swing; the
cooldown decides how soon you may throw another.

**Getting hurt is readable, never cheap.** Every attack is wound up for at least
0.4 s before it lands — the enemy leans back and a ring opens on the ground at
its feet — and it does not track you while it does, so stepping sideways is a
real answer. A hit costs a heart, shoves you away, and gives you about a second
of grace; there are no damage numbers and no hit-stun chains. Run out of hearts
and you fall: one card, a fade, and you are back at the last beacon with
everything you had. **Beacons** (the Waystone at Roshar's spawn, the Ridge Cairn
out on the rock) are where you respawn and where you heal.

Every one of those numbers is a slider in the tuning panel under **combat &
encounters** — hearts, punch damage and cooldown, enemy damage, wind-up, speed,
aggro range, and how many are alive at once. Two of them have floors the panel
cannot go below (0.4 s wind-up, six enemies), because those are the fairness
contract's numbers. Set `?enemies=0` to turn encounters off entirely.

**Phone:** the left half of the screen is a thumb-stick (it appears where your
thumb lands), drag on the right to look, the round **jump** button is
bottom-right with **punch** just left of it, and the **sprint** toggle is
bottom-left. Hearts sit top-left. It also works with a mouse if you just want to
test the layout.

Dev keys: <kbd>`</kbd> debug overlay · <kbd>p</kbd>
tuning panel ·
<kbd>v</kbd> cycle palette · <kbd>c</kbd> credits and the fan-work notice ·
<kbd>r</kbd> reset the view. On a phone the ⓘ button (always) and the ⚙/▤/◐
buttons (add `?dev=1` to the URL) give the same tools.

### URL parameters

| parameter | example | meaning |
|---|---|---|
| `seed` | `?seed=emberdark` or `?seed=4242` | rebuilds the map deterministically |
| `map` | `?map=blank-basin` | which world: `roshar` (the default) or `blank-basin` (the M0 test range) |
| `palette` | `?palette=highstorm-light` | atmosphere variant — the names belong to the loaded map (`storm-shore`, `highstorm-light` on Roshar; `ashen-basin`, `mist-sea`, `cold-ridge` on the test range), and each world declares which one it opens on |
| `walk`, `jump`, `gravity`, `accel`, `bob` | `?walk=9&jump=2.5&bob=0` | how walking feels |
| `striderate` | `?striderate=1.4` | how fast arms and legs may swing (cycles/second) |
| `sprint` | `?sprint=1.5` | sprint speed multiplier (1–3, default 2.2) |
| `girl` | `?girl=1` | the girl player character (default `0`, the boy) |
| `realmzoom` | `?realmzoom=80` | how much world the Cognitive lens shows, in metres (16–140) |
| `fadems` | `?fadems=900` | how long the realm transition takes (0–2000 ms; 0 is a cut) |
| `realm` | `?realm=cognitive` | start in the Cognitive lens, without walking to the pool |
| `fog`, `sun`, `ambient`, `fov` | `?fog=0.0042` | atmosphere |
| `view` | `?view=first` | `third` (default, over the shoulder) or `first` (through the eyes) |
| `camdist` | `?camdist=6` | third-person boom length in metres (1.2–8) |
| `look`, `mouselook` | `?mouselook=1.4` | look sensitivity: dragging, and the captured mouse |
| `capture` | `?capture=off` | `off` = never capture the mouse; drag to look instead |
| `debug` | `?debug=1` | open the debug overlay immediately |
| `dev` | `?dev=1` | show the on-screen dev buttons (phone-friendly) |
| `touch` | `?touch=1` | force the touch controls on (for testing on a desktop) |
| `hearts` | `?hearts=5` | how much health you carry (3–5) |
| `punchdmg`, `punchcd` | `?punchdmg=2&punchcd=0.3` | how hard a punch is, and how soon you may throw another |
| `enemydmg`, `windup`, `enemyspeed` | `?windup=0.8` | what a strike costs (×), how long the telegraph is (s, floor 0.4), and how fast they move (×) |
| `aggro` | `?aggro=24` | how close you have to get before an enemy notices you (m) |
| `enemies` | `?enemies=0` | how many are alive at once (0–6; `0` turns encounters off) |

The tuning panel mirrors every change into the URL and into `localStorage`, and
has a **copy link** button — paste that link back to the agent to hand over a
tuned feel as a value, not as a description.

---

## How this project is built

| | |
|---|---|
| Engine | [three.js](https://threejs.org) `0.186.1`, pinned exact — no other 3D/engine dependency |
| Build | Vite `7.3.7`, `base: './'`, output never committed |
| Host | GitHub Pages via GitHub Actions (`upload-pages-artifact` + `deploy-pages`) |
| Runtime network | **none** — no CDNs, no web fonts, no analytics, no external requests |
| Tests | `node --test` for logic + Playwright/Chromium for the headless smoke test |
| Simulation | fixed 60 Hz timestep, seeded RNG, reproducible from `?seed=` |
| Player | capsule vs heightfield + cylinder obstacles; no physics dependency |

Not used on purpose: `SharedArrayBuffer`, wasm threads, COOP/COEP headers (Pages
cannot send them), physics engines, floating-origin precision systems (the
[scale fence](AGENT_PROMPT.md) makes them unnecessary).

### Commands

```bash
npm run dev        # dev server
npm run build      # production build -> dist/
npm run preview    # serve dist/ locally
npm run lint       # correctness only: undefined names, dead code (no style rules)
npm run test:unit  # logic + scene-graph tests, headless, no browser
npm run test:dist  # Pages constraints on dist/ (.nojekyll, relative paths, no external URLs, size)
npm run test:e2e   # builds, serves, drives the game in headless Chromium
npm test           # all of the above, in order
```

`npm run test:e2e` writes screenshots to `artifacts/screenshots/` and a report to
`artifacts/playwright-report/`. Both are gitignored; CI uploads them as
artifacts on every run.

---

## Repository map

```
index.html                 the canvas + boot note
src/main.js                bootstrap: settings -> state -> renderer -> sim loop -> UI
src/core/                  logic only, no DOM, no three.js (all headless-tested)
  config.js                app constants, the scale fence, the player's constants
  rng.js / noise.js        seeded RNG and deterministic noise
  clock.js                 fixed-timestep sim clock (spiral-of-death guarded)
  world-state.js           THE world state: entities, player, seeded rebuild
  player.js                movement, gravity, jump, collision (no physics engine)
  terrain.js               terrain height sampling
  stick.js                 virtual-stick + move-intent maths
  look.js / math.js        look maths, clamped and NaN-proof
  settings.js              tunables: schema, URL/localStorage, clamping
  gate.js                  the Perpendicularity: where it is, and when it fires
  combat.js                hearts, the punch, death/respawn, the event log
  enemy.js                 archetypes, the one state machine, the spawn director
  maps/index.js            map registry: which worlds exist, and how to pick one
  skin.js                  the cognitiveSkin contract + the canon guard
  worlds/roshar/           the first authored world: palette, landmark, its skin
  terrain-color.js         per-facet ground colouring (world-space, tested)
  snapshot.js              the debug snapshot shape (window.__debug, overlay, reports)
  frame-stats.js           frame-spike counters for the overlay
src/content/               authored data: NPC dialogue, one JSON file per person
  npcs.js                  dialogue loader, validator and state machine (no DOM)
src/render/                three.js only; reads state, never owns it
  renderer.js  sky.js  world-view.js  npc-view.js (blocky figures, nameplates)
  enemy-view.js            box-part enemy rigs + procedural animation + the tell
src/platform/input.js      keyboard/touch/pointer -> one intent stream (no sim access)
src/ui/                    HUD (touch controls), hearts, dialog card, debug overlay, tuning panel, credits, dock
tests/unit/                node --test, no browser
tests/e2e/                 Playwright smoke, interaction, mobile and screenshot specs
scripts/check-dist.mjs     static assertions on the built output
.github/workflows/         ci.yml (gates) and pages.yml (deploy)
```

Design rules that are enforced by tests rather than by memory:

- **One world state, two realms.** The Cognitive Realm (M2) is the same scene
  through a different camera and material pass — never a second copy of the
  world.
- **The scale fence.** A whole system spans ≤ ~8 km; planets are 30–80 m; camera
  near ≥ 0.3, far ≤ 5000; nothing two-surface-coplanar without a ≥1 cm offset.
  `tests/unit/scale-fence.test.js` fails the build if any of that drifts.
- **Per-world appearance is data.** `cognitiveSkin` lives in the map, and glass
  beads are only legal over the Rosharan system.
- **The fairness contract is a test, not a promise.** Every damage event in the
  combat log must be preceded by its source's telegraph, no enemy may wind up in
  under 0.4 s, and every enemy has a leash it cannot cross. A unit test walks a
  whole simulated run and asserts all three; the browser test reads the same log
  back out of the shipped build.
- **The debug surface is a contract.** `window.__debug()` returns realm, player
  position, seed, entity count, the combat block and the distance-from-origin
  canary; the smoke test asserts against it. `window.__worldhopper.step(seconds)` advances the sim
  deterministically, which is how the headless tests avoid measuring CI's frame
  rate instead of the game.

---

## Documentation

- [`AGENT_PROMPT.md`](AGENT_PROMPT.md) — the developer brief (rules, scope, verification duties)
- [`ROADMAP.md`](ROADMAP.md) — milestones and status
- [`DECISIONS.md`](DECISIONS.md) — one line per decision, with the reason
- [`CONTRACTS.md`](CONTRACTS.md) — the frozen shared schemas: world state, the enemy shape and its state machine, the combat event log
- [`OWNERSHIP.md`](OWNERSHIP.md) — which agent writes which file

## Licence

MIT for the original work in this repository (`LICENSE`); the Cosmere and
everything in it belong to their author. Unofficial, non-commercial, forever.
