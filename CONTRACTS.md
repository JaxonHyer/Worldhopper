# Contracts — the frozen shared schemas

`OWNERSHIP.md` says who writes which file. This file says what the *shapes* are
that cross between them. These are the schemas two agents (and later five) build
against, so a change to any of them is a `contract`-labelled PR, discussed before
it is written — not a field added quietly because it was convenient.

Landed with **WP-3.1 / WP-3.2** (2026-10-17), which is what `OWNERSHIP.md`
promised: these two work packages define the last of the shared schemas.

The rule underneath all of it, from the developer brief: **if you ever find
yourself maintaining two versions of the world, stop.** Every shape below exists
once, in world state, and rendering only reads it.

---

## 1. World state (`src/core/world-state.js`)

One object per loaded map, rebuilt from the seed, never mutated by rendering.

```
{
  mapId, seed, realm, tick, simTime, environment,

  entities,    // the map's AUTHORED FURNITURE: landmarks, rocks, NPCs.
               // Static, seeded once. entityHash() fingerprints this list, and
               // that hash is the map's reproducibility proof.
  obstacles,   // DERIVED from entities. Never authored twice.
  player,      // a living actor (see §3)
  enemies,     // living actors, spawned at runtime (see §4)
  combat,      // hearts, beacon, the event log's counters (see §5)
  events,      // the combat log (see §6)
  spawner,     // the spawn director's own state (see §7)
}
```

**The line that matters:** `entities` is furniture, and `player` + `enemies` are
actors. An actor comes and goes; furniture does not. The player has never been
an entity, and enemies follow the player rather than the rocks — which is also
why spawning a pack does not move `entityHash`, and why the realm-shift test can
still assert that a shift touches nothing.

`stepWorld(state, dt, intent, context)` is the only writer. `context` is
`{ map, seed, obstacles, settings }` and is **optional**: several tests advance
the clock with nothing in the world to react to it, and combat must not throw
because a context is missing.

Order inside a step is part of the contract: player → punch → combat bookkeeping
→ enemies → spawn director. An enemy's strike therefore resolves against where
the player actually is *this* tick.

---

## 2. Map additions (`PlanetConfig`)

Two new optional blocks. A map with neither simply has no encounters and no
checkpoints, and nothing breaks.

```js
beacons: [
  { id, label, position: { x, z }, clearance? }   // [0] is the opening respawn
]

enemyPolicy: {
  types: ['crag-lurker', 'storm-warden'],  // archetype ids, <= 3 (FAIRNESS.maxArchetypes)
  weights: [9, 1],                          // how often each appears (owner, 2026-10-17:
                                           //   Chasmfiends RARE — one in ten draws)
  initial: 3,                               // alive at load, via the ring
  maxActive: 4,                             // this world's ceiling (<= 6, hard)
  spawnInterval: 8,                         // seconds between top-up attempts
  spawnMin: 24, spawnMax: 40,               // ring around the player, metres
  despawnRadius: 95,                        // metres: past this it is culled
  leashRange: 46,                           // metres from home: past this it quits

  // Authored spots, placed BEFORE the ring at load, unchanged by seed order:
  placements: [
    {
      typeId: 'storm-warden', x: 2, z: -20, home?: {x, z},
      aggroRange: 5,                        // per-enemy aggro override (metres);
                                            // falls back to the owner's slider.
                                            // The pool-side Chasmfiend sleeps on
                                            // 5 m so the gate's routes never wake it.
    },
  ],
}
```

`beacons[0]` is always where the player starts, so a fresh run has somewhere to
come back to. Rocks are scattered with a clearance around every beacon, because
a checkpoint you cannot stand at is not a checkpoint.

---

## 3. The player's attack

`player.attack`, created by `createAttack()`:

```
{ phase: 'idle'|'windup'|'active'|'recover', timer, cooldown, swing, resolved }
```

`swing` (0..1) is what the avatar animates from — one source of truth, so the arm
the player sees is the swing the sim resolved. Structural numbers live in
`ATTACK`; the feel numbers (`punchDamage`, `punchCooldown`) are settings.

---

## 4. An enemy

A plain JSON-serialisable object in `state.enemies`. **No closures, no three.js,
no functions** — world state has to stay describable, comparable and
`JSON.stringify`-able.

```
{
  id, kind: 'enemy', typeId, name,
  fightable, health, maxHealth, radius, height,
  state,                  // ENEMY_STATES — see below
  timer, cooldown, windup,
  home: {x, z}, position: {x, y, z}, velocity, knockback: {x, z}, yaw,
  roamTarget: {x, z}, roamTimer,
  hitFlash, recoil, stridePhase, tell,
  dying, dead, deathTimer, remove, awareFor
}
```

`tell` (0..1) is the wind-up's own progress and is the single number the rig
animates its telegraph from. `remove` is set by the machine; the director splices.

### The state machine (one, shared by every archetype)

```
idle  --player inside aggro-->  alert  --alertTime-->  hunt
hunt  --inside attackRange & off cooldown-->  attack  --windup-->  hunt
hunt  --past leash, or you outrun it-->  disengage  --home-->  idle
any   --health <= 0-->  dying  --deathTimer-->  removed
```

An **archetype is a row in `ENEMY_TYPES`, never a second machine.** WP-3.3 adds
archetypes by adding data. `ENEMY_TYPES[id]` supplies: silhouette (`legs`,
`arms`, `radius`, `height`, optional `dims` overrides — the owner's 14-leg
giant needed more limbs than the budget default, which is data, and the rig
fans pairs along the body for `legs > 4`), speeds (`roamSpeed`, `huntSpeed`),
ranges (`attackRange`, `roamRadius`), timing (`windupScale`, `attackCooldown`,
`alertTime`), threat (`damage`), whether it can be fought (`fightable`), option
`flinchWhenFaced` (see §6 `flinch`), its colours including `tell` and the
optional namesake `spines`, and optional `texture` part references
(`body`/`head`/`limb`) into `core/enemy-skins.js` — baked AI art, 32×32 RGBA
pixel data, original assets, nearest-filtered so the Minecraft tier holds.

### The fairness contract (binding, and machine-checked)

| rule | where it is enforced | where it is asserted |
|---|---|---|
| every damage source telegraphs first | `emitEvent(telegraph)` before `emitEvent(damage)`, for the player's punch too | `tests/unit/enemy.test.js` over a whole run; `tests/e2e/combat.spec.js` inside a real browser |
| ≥ 0.4 s wind-up | `resolveWindup()` floors it *after* the slider and the archetype scale | `tests/unit/combat.test.js`, `tests/unit/enemy.test.js` |
| no untelegraphed attack from off-screen | `alert` is always emitted before any wind-up, and the aggro mark + ground ring draw it | the `alert.tick <= telegraph.tick` assertion |
| hit → knockback + ~1 s invulnerability | `damagePlayer()` sets `invuln = FAIRNESS.invulnAfterHit` | the hit-stun-chain test |
| aggro and leash ranges; disengaging always works | `disengage` walks home ignoring the player | the leash test |
| at least one enemy per world cannot be fought | `fightable: false` on `storm-warden`; a punch emits `immune` and nothing else | the archetype test and the immune test |
| ≤ 6 alive at once, ≤ 3 archetypes | `activeCap()` clamps slider, map and hard cap together | the cap tests |

---

## 5. `state.combat`

```
{ health, maxHealth, invuln, hurt, dead, deaths,
  hitsTaken, hitsLanded, swings,
  beacon: { id, label, x, z, y }, beaconsTouched }
```

`hurt` (0..1) decays in the sim and drives the red vignette; the renderer never
decides how red the screen is. Healing happens when a beacon *becomes* yours, not
continuously while you stand on it — a shrine you cannot be hurt next to is an
invulnerability field, not a checkpoint.

---

## 6. The combat event log

`state.events`, bounded at `EVENT_LOG_MAX` (128). This is the fairness
contract's evidence channel: a headless test reads it with no browser, and the
snapshot ships its last 24 entries out as `combat.events`.

```
{ tick, kind, by?, to?, windup?, amount?, type?, at?, distance?, awareFor? }
```

`kind` is one of `EVENTS`: `telegraph`, `damage`, `punch`, `immune`, `death`,
`defeat`, `alert`, `disengage`, `spawn`, `respawn`, `beacon`, `flinch`.

Adding a kind is a contract change: the tests that walk the log are the reason
the log exists, and a kind they do not know about is a rule nobody is checking.

`flinch` (added 2026-10-17, resolving issue #21) means a telegraphed strike was
**aborted because the player stood their ground and faced the attacker** —
available where a per-archetype `flinchWhenFaced` flag is set, default off. The
Inquisitor rule from the roadmap, shipped generically. It lives on the
Chasmfiend and is deliberately nowhere else: on a killable enemy it would make
every fight spongy on a phone; on the unkillable giant it gives the player a
defence that is not a weapon. Distance guard: past arm's length it is too late.

---

## 7. The spawn director

`state.spawner = { rng, count, timer, spawned, culled }` — one uint32 of RNG and
three counters. Nothing else, deliberately: `createRng()` is a closure and a
closure in world state is either unserialisable or a `{}` that silently resets.
`rngStep(state)` in `src/core/rng.js` is the pure form, and `createRng` is built
on it, so both produce the identical stream.

The director is what "procedural roaming" means here:

- **where** an enemy appears is drawn from that stream — a ring around the
  player, never in the pool, never inside a rock, never on an NPC;
- **what it does until it notices you** is a procedural wander around its own
  home (`pickRoamTarget`), from the same stream;
- the world is culled behind you (`despawnRadius`) and topped up ahead of you
  (`spawnInterval`), so a long walk neither empties the world nor grows it
  without bound.

Same seed + same inputs ⇒ the same encounter. Asserted in
`tests/unit/enemy.test.js`.

---

## 8. Snapshot additions

`combat` is a **top-level** key in `SNAPSHOT_KEYS`, not a corner of `ui`. `ui` is
a whitelist and a field added there without a matching line in
`src/core/snapshot.js` disappears without a sound — that trap has already cost
two CI runs. `combat` carries `roster` (who is where, up to the cap) so a test
can walk up to a *specific* enemy instead of hoping one wanders past.

---

## 9. Journal entries — reserved, not yet frozen

M4's WP-4.2 owns the journal and its save schema. Nothing is frozen here yet;
this section is a placeholder so the shape of this file is honest about what it
does and does not cover.
