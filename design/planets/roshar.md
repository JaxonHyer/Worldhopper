# Roshar — the first authored world

One page per planet, per the planet template in `ROADMAP.md`. This is the M3–M5
brief for Roshar: what exists today, and what its own work package still owes.

## Name & inspiration

Roshar, second planet of the Rosharan system (the roadmap's v1 setting). Canon
world, and the one with the deepest canon — which means the least invention is
allowed here. The patch is the **peaks above the pool**, so the player's first
gate is the canon Perpendicularity rather than a new one.

*Not modelled yet, deliberately:* ~0.7 g gravity, crem, rockbuds, highstorms,
the three moons. All are per-map or terrain-kit work that the roadmap wants
designed with the owner.

## The rule

**This world is what the other realm is for.** Roshar's Cognitive Realm is the
canon Shadesmar — glass beads for objects, flames for living things, obsidian for
water, a bead sea for land, a black sky with one frail fixed sun — and the patch
exists so that the realm shift reads as a *place*, not a filter. Every later
world is measured against it: if a world's subastral is not obviously some other
world's, this one taught nothing.

## Palette

Two variants today, both in `src/worlds/roshar/index.js`:

- **A · Storm shore** — crem-grey rock, hazy warm sky, the pool the only cool colour.
- **B · Highstorm light** — colder, denser, the needle a hard shape in the haze.

Same geometry, different atmosphere; the owner picks on their own hardware.

## Landmark

**The Stormbreak Needle** — one silhouette, visible from most of the patch. A
project-invented shape (no canon landmark is claimed); the roadmap's one-landmark
rule is what matters, and the terrain kit that will carry it properly is M5 work.

## `cognitiveSkin`

Roshar's row of the canon table, transcribed in `src/worlds/roshar/index.js`:

| | Form | Notes |
|---|---|---|
| Objects | `glass-beads` | one bead per object, sized to the object |
| Living | `flame` | the player today; enemies and NPCs when they exist |
| Water | `solid-obsidian` | the pool inverts; it does not vanish |
| Land | `bead-sea` | a window of beads carried around the player, seated in the terrain |
| Light | `black-sky-frail-white-sun` | fixed direction, `dayNightCycle: false` |

`glass-beads` and `bead-sea` are reserved to `system: 'rosharan'` by the canon
guard in `src/core/skin.js`, and only the *map's* system counts — a skin cannot
promote itself. Every colour in the skin is a taste value, not canon.

**Open for the owner:** the bead sea's density and bead size; whether the ground
under the beads should be visible at all; the frail sun's size and strength.

## Enemies

≤3 archetypes, Roshar-flavoured, owner design pass (WP-3.3). None authored yet.
The one that cannot be fought is *not yet chosen*.

## NPCs

0–2 (WP-3.4), dialogue as JSON data. None authored yet.

## Perpendicularity

The pool, 14 m ahead of the spawn, `open: true` until WP-4.1 gives it a puzzle.

## Sound bed

1–2 ambient loops. None yet; audio has not started.

## The one question

**Does the inversion read?** Walk into the pool and look at the same rock twice:
once as rock, once as its bead. If the second image does not feel like *the thing
itself seen from somewhere else*, the skin is decoration rather than a realm.
