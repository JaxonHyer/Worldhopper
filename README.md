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

**Status: M1 — the player.** You can walk a world: a capsule against the terrain
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

**Camera:** third person by default — you are looking at your character from
behind, and the camera slides closer when a hill or a rock is in the way. Look
up is limited (the boom would end up in the floor); **Camera** in the tuning
panel switches to first person, where the full vertical range comes back.

**Phone:** the left half of the screen is a thumb-stick (it appears where your
thumb lands), drag on the right to look, the round **jump** button is
bottom-right, and the **sprint** toggle is bottom-left. It also works with a
mouse if you just want to test the layout.

Dev keys: <kbd>`</kbd> debug overlay · <kbd>p</kbd> tuning panel ·
<kbd>v</kbd> cycle palette · <kbd>c</kbd> credits and the fan-work notice ·
<kbd>r</kbd> reset the view. On a phone the ⓘ button (always) and the ⚙/▤/◐
buttons (add `?dev=1` to the URL) give the same tools.

### URL parameters

| parameter | example | meaning |
|---|---|---|
| `seed` | `?seed=emberdark` or `?seed=4242` | rebuilds the map deterministically |
| `palette` | `?palette=cold-ridge` | atmosphere variant (`ashen-basin`, `mist-sea`, `cold-ridge`) |
| `walk`, `jump`, `gravity`, `accel`, `bob` | `?walk=9&jump=2.5&bob=0` | how walking feels |
| `striderate` | `?striderate=1.4` | how fast arms and legs may swing (cycles/second) |
| `sprint` | `?sprint=1.5` | sprint speed multiplier (1–3, default 2.2) |
| `girl` | `?girl=1` | the girl player character (default `0`, the boy) |
| `fog`, `sun`, `ambient`, `fov` | `?fog=0.0042` | atmosphere |
| `view` | `?view=first` | `third` (default, over the shoulder) or `first` (through the eyes) |
| `camdist` | `?camdist=6` | third-person boom length in metres (1.2–8) |
| `look`, `mouselook` | `?mouselook=1.4` | look sensitivity: dragging, and the captured mouse |
| `capture` | `?capture=off` | `off` = never capture the mouse; drag to look instead |
| `debug` | `?debug=1` | open the debug overlay immediately |
| `dev` | `?dev=1` | show the on-screen dev buttons (phone-friendly) |
| `touch` | `?touch=1` | force the touch controls on (for testing on a desktop) |

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
  maps/index.js            map data: palettes, landmark, prop policy, cognitiveSkin
  terrain-color.js         per-facet ground colouring (world-space, tested)
  snapshot.js              the debug snapshot shape (window.__debug, overlay, reports)
  frame-stats.js           frame-spike counters for the overlay
src/render/                three.js only; reads state, never owns it
  renderer.js  sky.js  world-view.js
src/platform/input.js      keyboard/touch/pointer -> one intent stream (no sim access)
src/ui/                    HUD (touch controls), debug overlay, tuning panel, credits, dock
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
- **The debug surface is a contract.** `window.__debug()` returns realm, player
  position, seed, entity count and the distance-from-origin canary; the smoke
  test asserts against it. `window.__worldhopper.step(seconds)` advances the sim
  deterministically, which is how the headless tests avoid measuring CI's frame
  rate instead of the game.

---

## Documentation

- [`AGENT_PROMPT.md`](AGENT_PROMPT.md) — the developer brief (rules, scope, verification duties)
- [`ROADMAP.md`](ROADMAP.md) — milestones and status
- [`DECISIONS.md`](DECISIONS.md) — one line per decision, with the reason

## Licence

MIT for the original work in this repository (`LICENSE`); the Cosmere and
everything in it belong to their author. Unofficial, non-commercial, forever.
