# Decisions

One line per meaningful decision, with the reason. Newest first. The owner reads
this to stay oriented; agents add to it in the same PR as the change.

## M0 — foundation (2026-10-14)

- **Vite 7.3.7 + three.js 0.186.1, both pinned exactly, in `package.json` and
  `package-lock.json`.** What is tested is what ships; no caret ranges.
- **Plain JavaScript with JSDoc types, no TypeScript build step.** The engine is
  the only dependency worth a compile step; types buy little here and cost a
  second build pipeline the owner would have to trust.
- **`base: './'` in Vite.** One build has to work from a subfolder, from
  `file://`-adjacent local serving and from Pages without configuration.
- **`.nojekyll` lives in `public/`.** It then ships automatically inside `dist/`
  and `scripts/check-dist.mjs` fails the build if it ever goes missing.
- **CI (`.github/workflows/ci.yml`) runs on every branch and PR; Pages
  (`.github/workflows/pages.yml`) only deploys from `main`.** CI is the reviewer
  (§10): green suite, then merge.
- **GitHub actions pinned to exact release tags (`@v7.0.1`, not `@v7`).** Same
  reasoning as dependencies; readable for a non-coder owner, unlike SHA pinning.
- **Screenshots are CI artifacts, not committed files.** Keeps the repo small and
  guarantees every screenshot comes from the build that actually ran.
- **The M0 world is a non-canonical "M0 Test Range" (`blank-basin`).**
  `ROADMAP.md` has no Canon anchors section yet, so nothing here invents lore;
  the placeholder is labelled `status: 'placeholder'` and asserted as such by
  tests.
- **`cognitiveSkin` exists as per-map data from day one, with `unassigned`
  values.** Freezing the shape early avoids smuggling realm appearance into
  global code later; `tests/unit/maps.test.js` fails any map that asks for glass
  beads outside the Rosharan system.
- **Three palette variants (`ashen-basin`, `mist-sea`, `cold-ridge`) instead of
  one.** A palette is a taste call: the owner picks from live variants on their
  own hardware rather than from a description (§10).
- **The blank world has one landmark silhouette (the Grey Needle) and seeded
  low-poly rock scatter.** Art direction needs something for fog to fall off;
  "landmark readable through fog" is one of the three playtest questions.
- **Fog is `FogExp2`, density 0.003 default, palette horizon colour == fog
  colour.** A mismatched horizon seams, which looks like a bug at any distance.
- **Sky is a camera-following dome with a custom ShaderMaterial and a sun disc,
  rendered with `depthTest: false` and `renderOrder: -1`.** Cheapest way to get a
  per-world gradient plus a light-direction cue; the dome radius (2000 m) stays
  inside the camera far plane.
- **Sub-LSB dither in the sky shader.** Dark gradient skies band badly on 8-bit
  displays; one line of noise removes it.
- **Ground is one displaced plane, converted to non-indexed geometry with
  per-triangle flat colours.** Intentional low-poly faceting (§6) with an
  ordinary `MeshLambertMaterial` — no custom shading, nothing to break.
- **No shadows in M0.** Nothing casts them yet; shadow cameras over a 2.4 km
  plane cost more than they explain. Revisit when the player exists (M1).
- **Custom capsule-vs-heightfield collision planned for M1; no physics engine.**
  Fully testable headlessly and it respects the scale fence.
- **Fixed 60 Hz sim tick with a 5-step spiral-of-death guard that drops (and
  counts) backlog.** Reproducible runs from a seed, and a slow device simulates
  slower instead of faster.
- **Seeded mulberry32 + integer-only value noise, no transcendentals in world
  generation.** `Math.sin`/`pow` are not bit-identical across engines; the world
  must rebuild identically on the owner's phone.
- **Seeds can be words (`?seed=emberdark`) or numbers.** Makes a seed something
  the owner can say out loud and paste back.
- **One settings schema drives the tuning panel, the URL and localStorage.**
  Three consumers, one definition — the panel can never drift from the URL.
- **`?debug=1` and `?dev=1` are separate flags.** `dev` shows on-screen dev
  buttons (phone has no backquote key); `debug` opens the overlay. Forcing the
  overlay on for every dev visit would spoil screenshots.
- **Later-milestone sliders (walk, jump, gravity, swap window) render disabled
  from M0.** The panel's shape is visible before the features exist; nothing can
  silently do nothing.
- **The dev observer camera exists in M0, look-only (no translation).** It is the
  scripted-input target the smoke test drives and the touch-look path M1 reuses;
  the M1 player controller replaces it.
- **`window.__debug()` + `window.__worldhopper` are the test contract**, and
  `document.documentElement.dataset.ready = 'true'` after two rendered frames.
  The smoke test waits on that instead of sleeping.
- **The debug overlay refreshes at 4 Hz.** A DOM write per frame would itself be
  a frame-loop cost, which the overlay exists to detect.
- **`entityHash` in the debug snapshot.** Proves a seeded rebuild is identical
  without pixel-diffing screenshots.
- **Logic never imports three.js** (`src/core/**`), and the renderer never owns
  state (`src/render/**` reads it). This is what lets the sim be tested in Node
  with no browser (§4).
- **The tiny boot note ("loading the basin…") is hidden by CSS when the game
  marks itself ready.** No spinner framework for one line of text.
- **Runtime errors surface as an on-page banner.** The owner cannot read a
  console; a broken build should say so in plain words on screen.
- **An original SVG favicon is shipped in `public/`.** Browsers request
  `/favicon.svg`; a 404 shows up as a console error and would falsely fail the
  "zero console errors" gate.
- **`NOTICE.md` carries the fan-work text, `LICENSE` is MIT for original work
  only, and the same notice appears in the in-game credits.** §9 requires it in
  both README and credits; both are asserted by the smoke test.

## M0 — follow-up: the debug snapshot is a shared, tested contract (2026-10-14)

- **`src/core/snapshot.js` owns the snapshot shape** (`buildSnapshot`,
  `SNAPSHOT_KEYS`). It was inlined in `main.js` and the debug overlay read two
  fields the snapshot no longer produced (`gl`, `scaleFence`), which threw inside
  the render loop on the first frame — a blank page that no headless probe could
  see, because the crash was in the browser. One builder, one key list.
- **A unit test pushes a real snapshot through the real overlay against a 20-line
  DOM stub.** A missing field now fails locally in milliseconds, not in CI. This
  is the cheap half of "assert game state via a debug hook" (§8).
- **`gl` info is read once, at renderer construction.** It is displayed by the
  overlay every refresh; `gl.getParameter` has no business in a frame loop.
- **CI publishes its own evidence to a rolling `ci-artifacts` branch**
  (`scripts/ci-report.mjs` + a `git push --force` of the Playwright JSON summary
  and the screenshots). Reason: the agent's sandbox can read the repository but
  *not* Actions logs and artifacts, so a red build was previously just the word
  "failed". The branch is ignored by the CI trigger to avoid a loop, and it is
  not the default branch, so no build output is committed to `main` (§3).
