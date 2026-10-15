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

**Status: M0 — foundation.** A blank world (sky gradient, faceted ground, fog,
one landmark silhouette), the verification harness, and GitHub Pages
deployment. There is no player yet: dragging just looks around.

---

## Play it

- **Live:** <https://jaxonhyer.github.io/Worldhopper/> (GitHub Pages, built by CI)
- **Local:**
  ```bash
  npm ci
  npm run dev     # http://localhost:5173
  ```

Controls: **drag** (mouse or finger) or **arrow keys** to look around ·
<kbd>`</kbd> debug overlay · <kbd>p</kbd> tuning panel · <kbd>v</kbd> cycle
palette · <kbd>c</kbd> credits and the fan-work notice · <kbd>r</kbd> reset view.

On a phone: drag to look; the ⓘ button (always) and the ⚙/▤/◐ buttons (add
`?dev=1` to the URL) give the same harness.

### URL parameters

| parameter | example | meaning |
|---|---|---|
| `seed` | `?seed=emberdark` or `?seed=4242` | rebuilds the map deterministically |
| `palette` | `?palette=cold-ridge` | atmosphere variant (`ashen-basin`, `mist-sea`, `cold-ridge`) |
| `fog`, `sun`, `ambient`, `fov`, `look` | `?fog=0.0042` | tunables, same as the in-game panel |
| `debug` | `?debug=1` | open the debug overlay immediately |
| `dev` | `?dev=1` | show the on-screen dev buttons (phone-friendly) |

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
  config.js                app constants + the scale fence numbers
  rng.js / noise.js        seeded RNG and deterministic noise
  clock.js                 fixed-timestep sim clock (spiral-of-death guarded)
  world-state.js           THE world state: entities, observer, seeded rebuild
  look.js / math.js        look maths, clamped and NaN-proof
  settings.js              tunables: schema, URL/localStorage, clamping
  maps/index.js            map data: palettes, landmark, prop policy, cognitiveSkin
  frame-stats.js           frame-spike counters for the overlay
src/render/                three.js only; reads state, never owns it
  renderer.js  sky.js  world-view.js
src/platform/input.js      pointer/touch/keyboard -> intent (no sim access)
src/ui/                    debug overlay, tuning panel, credits, dev dock
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
- **The debug surface is a contract.** `window.__debug()` returns realm,
  position, seed, entity count and the distance-from-origin canary; the smoke
  test asserts against it.

---

## Documentation

- [`AGENT_PROMPT.md`](AGENT_PROMPT.md) — the developer brief (rules, scope, verification duties)
- [`ROADMAP.md`](ROADMAP.md) — milestones and status
- [`DECISIONS.md`](DECISIONS.md) — one line per decision, with the reason

## Licence

MIT for the original work in this repository (`LICENSE`); the Cosmere and
everything in it belong to their author. Unofficial, non-commercial, forever.
