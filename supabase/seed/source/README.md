Card/hero-power source data, originally copied verbatim from
https://github.com/joey101937/ftd-cg-backend (src/gameConstants) and read by
../transform.ts.

These files are now the authority and ARE hand-edited — every effect-wiring
wave and the 2026-08-30 balance pass edited them in place. Two rules follow:
after any edit run `npm run seed:build` in the same commit (supabase/seed/
seedDataSync.test.ts fails otherwise), and treat a card's `name` as immutable —
transform.ts derives each row's uuid from `card:<faction>:<name>`, so renaming a
card mints a new id and orphans every deck holding the old one.

Deleting a card from these files only stops it being upserted; the row already
in the database survives, and so does every saved deck referencing it. A
removal needs its own SQL.
Note: files export multiple arrays with mixed names (e.g. LH-Built-in.js
exports TG_ROBOTICS and lhVehicles); the card's own `faction` field is
authoritative, not the filename.
