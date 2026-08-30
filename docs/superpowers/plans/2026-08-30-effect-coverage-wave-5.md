# Effect coverage — wave 5 implementation plan

The last wave. Five cards — Ambush, Ongoing Attrition, Sub Killer, Recurring
Threat, Sabotage — plus the two decisions the spec deferred twice: where DP5
lives, and whether decision 3's alert card is built.

**Baseline measured on this branch** (not copied from the handoff, which said
661 — the wave-4 follow-up added ten):

| Gate | Result |
|---|---|
| `npx vitest run` | **671 passed / 32 files**, 0 failed |
| `npx tsc -p tsconfig.json --noEmit` | exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| `npm --prefix frontend run lint` | exit 0, **7** warnings across 5 files (the inherited set) |

`KNOWN_GAPS` = 5 (all wave 5), `PARTIAL` = 0, `EXEMPT` = 1.

**Correction to the handoff, §3:** all five cards already carry their trigger
key and effect name in the seed source — `ambushEffect`,
`ongoingAttritionEffect` (both `playOnZoneEffect`), `subKillerEffect`,
`recurringThreatEffect`, `sabotageEffect` (all `playOnVehicleEffect`). Wave 5
authors implementations, not seed `meta`. Both keys are already in G3's
`REACHABLE_TRIGGERS` `ability` row, so trap 4.2 does not bite this wave —
**provided no new trigger key is introduced**, which this design deliberately
avoids.

---

## 1. Decision A — where DP5 lives (spec §4.3's DP5 row)

§4.3 predicts `state.scheduled[]`. The code says: **split, by what the rider
does, not by which card owns it.**

| Rider's job | Home | Cards |
|---|---|---|
| change how a battle or a placement in **one zone** resolves | `state.zoneEffects` | Ambush, Ongoing Attrition, Sub Killer |
| watch one **vehicle** across the turn | `state.scheduled` | Sabotage |
| expire at the end of the turn that set it | `ZoneEffect.expiresOnTurn` (new) | Ambush, Ongoing Attrition, Sub Killer |

Why not `scheduled` for the three zone riders:

- They must be **read at battle lock and at placement time**, not only at turn
  end. `state.zoneEffects` already has a lock dispatch, a board badge, a
  `normalizeState` default, and the catalog probe's fourth source.
  `state.scheduled` has none of that and is only ever read in `endTurn`.
- Their rules are **public and binding on the opponent**. Ambush's "deploy
  after the defending player" is an instruction the *defender* has to follow in
  From The Depths; they cannot follow a rule they cannot see. A zone badge is
  the existing mechanism for exactly that.
- Putting the rider in one list and its expiry in another would make one card
  two rows that must be kept in step.

Why `scheduled` is still right for Sabotage: it watches an instance, not a
zone, so it has nothing to badge and nothing to dispatch at lock. It is
§4.3's DP5 row built exactly as written.

**Consequence — `endTurn` gains a turn-end pass for the *ending* side.**
Today's `scheduled` loop runs after the turn flips and serves the **incoming**
side, so the earliest it can fire for the acting player is a full round later.
All four tails read "…the turn", meaning the actor's own turn (§7.3 ruling
below), so they need a pass that runs **before** the increment, while the board
still stands as it did when the turn ended. That placement also settles
Sabotage's only ambiguity: a Temporary hull is culled at the *next* turn's
start, so it did survive this one.

The tails are implemented **in `endTurn`**, not dispatched as effects. That is
not a shortcut — `endTurn` already contains `changeOrderDraw`'s whole
redelivery, so card-tail-at-turn-end is a shape this function already owns.
Dispatching instead would need a new payload discriminator, a new module, and
`{ needsCatalog: true }` on two more effects purely so the dispatcher could
mint a payload card the tails never read.

## 2. Decision B — the alert card (decision 3, §4.2 departure 4)

**Narrowed out of existence.** No engine-set alert card is built; decision 3 is
closed with no customer.

Decision 3 survived three narrowings to reach "wave 5's riders — an effect
planted on the opponent's own next battle, where nothing else announces
itself". Walking the five:

| Card | Whose battle/action does the rider touch? | What announces it |
|---|---|---|
| Ambush | the actor's **own** offensive battle | zone badge, a public log line at lock, and `distanceM` on the `BattleOverlay` |
| Ongoing Attrition | the actor's **own** zone activation | zone badge, a public log line, and the enemy base HP dropping |
| Sub Killer | the actor's **own** future deployments | zone badge; the removal is visible on the board |
| Recurring Threat | the **opponent's** attack — the one case | zone badge **and** a public `pendingEffect` at lock **and** the summon in the `BattleOverlay` |
| Sabotage | nothing; it grants a keyword now | `FRAGILE` renders on the target chip immediately |

Only Recurring Threat is planted on the opponent's own battle, and it is the
loudest of the five: a permanent badge from the moment it is played, then a
public choice dialog at the instant it matters. An alert banner would add
nothing and would inherit `SET_ALERT_CARD`'s 409-on-collision rule (§4.3,
departure 2). `SET_ALERT_CARD` stays a manual action with no UI caller, exactly
as it is today.

## 3. Rulings this wave adds to §7.3

1. **"The turn" in a rider's tail is the actor's own turn.** Ambush ("if the
   turn ends"), Ongoing Attrition ("for the rest of the turn"), Sub Killer
   ("for the rest of the turn") and Sabotage ("if it survives the turn") all
   resolve at that player's `END_TURN`, before the turn number moves.
2. **"Destroy" fires `onDeathEffect`; "remove from play" does not.** Recurring
   Threat says *destroy*, Sub Killer says *remove from play*. Both texts are in
   this one wave, which is what makes the contrast evidence rather than
   convenience. Sub Killer routes through `discardCard` like every other exit
   (a captured hull still goes home; a `summonOnly` hull still never reaches a
   discard) but fires nothing — the same treatment `sacrificeEntry` already
   gives Iron Cordon's sacrifice.
3. **Ongoing Attrition counts zone population on both halves of its sentence.**
   "Attacking with more vehicles than your opponent" and "for each vehicle you
   have in the zone more than your opponent" are one count, not two: the damage
   clause names the zone explicitly, and `ATTACK_ENEMY_BASE` has no committed
   selection to read, so a selection-based condition would silently restrict
   the card to fleet attacks when its trigger is "if that zone is activated".
   Condition and formula collapse to `surplus > 0`.
4. **Ongoing Attrition respects the Blocker and a fallen base**, as every other
   base-damage path does (`ATTACK_ENEMY_BASE`'s own guards; `dwgWatersAftermath`
   re-checks both). A blocked activation deals no damage, so the rider is not
   consumed and still draws at turn end.
5. **Ambush's zone is public.** There is no private zone-effect mechanism, and
   inventing one would be the same problem `pendingEffect.options` already has
   (§4.2, departure 5). It is also *required* to be public: the defender must
   know the spawn distance changed and that the ambusher deploys last.
6. **Ambush is consumed by the battle, Ongoing Attrition by its damage.** Each
   follows its own printed compensation clause. Ambush's is "if the turn ends
   and you have **not fought** in that zone" — so fighting spends it whether or
   not the offer was taken. Ongoing Attrition's is "if this card leaves play
   **without dealing damage**" — so only damage spends it.
7. **"Defensive fleet battle" (Recurring Threat) is any battle the claimant
   defends**, forced or declared, per §7.3's Catshark ruling that a forced
   battle is a battle.

## 4. Departures from §4.3's DP2, recorded (DP2 departures 8–9)

**DP2 departure 8 — the lock rider pass scans BOTH sides.** Wave 4 built it
defender-only, and its own final review flagged that as an open question
(handoff §5, item 3). Ambush and Ongoing Attrition are attacker-side riders, so
the pass now dispatches every `state.zoneEffects` entry on the battle's zone
with `isDefender` computed per rider rather than hard-coded `true`. DWG Waters
is unaffected: `dwgWatersDefensiveGuest` already returns on `!battle.isDefender`.

**DP2 departure 9 — a bombardment dispatches the ATTACKER's riders too.**
`dispatchZoneInterception` serves the defender (DWG Waters' clause 3). Ongoing
Attrition fires on the aggressor's own `ATTACK_ENEMY_BASE`, so a second,
separately named dispatch runs after the damage lands and `checkVictory`, with
`isDefender: false`. It must not reach `dwgWatersInterception`, which today
branches on `phase === 'baseAttack'` alone and would intercept its owner's own
bombardment — so that function gains an `isDefender` guard, which is what its
card text ("if the enemy attacks you directly in this zone") always meant.

## 5. State shape

Two new optional fields on `ZoneEffect` (`shared/engine/gameInit.ts`) and one
new `scheduled` member. Both are `PublicGameState` changes.

| Field | Type | Meaning | `normalizeState` |
|---|---|---|---|
| `ZoneEffect.expiresOnTurn` | `number \| undefined` | expire at the end of this half-turn; **absent = permanent** | none needed — absent already means permanent, which is what every existing row is |
| `ZoneEffect.data` | `Record<string, unknown> \| undefined` | effect-owned rider state, the same shape `PendingEffect.data` and `BattleContinuation.data` already use | none needed — absent means "no state" |
| `scheduled[]` | union gains `{ type: 'sabotageWatch'; side; dueTurn; instanceId }` | Sabotage's watch | `scheduled` already defaults to `[]` |

`ZoneEffect.data` carries `{ drawOnExpiry: true }` for Ambush and Ongoing
Attrition and `{ summon: SnapshotCard }` for Recurring Threat. One generic
field rather than one field per card, for the reason the other two `data` bags
exist.

**Recurring Threat stores the whole snapshot, not a name.** The catalog the
engine is handed is `is_built_in = true` only, so a name would fail for exactly
the vehicles a DWG player is likeliest to build. The stored value is
`discardSnapshotOf(entry, actor)` — the one derivation `discardCard` itself
writes, which already strips `costDelta` and a captor's `ownerSide`, so the
remembered hull is a clean card rather than a loaned one.

Both halves of the state-shape pair are needed for the frontend too:
`PublicGameState.activeBattle` is structurally duplicated in `gameInit.ts`, but
`ZoneEffect` is a named export both sides import, so `zoneEffectBadges.ts` sees
the new fields for free.

## 6. Tasks

Each task: failing test first, then implementation, then `npx vitest run` with
the before→after count. Tasks 2–7 each end with a **dedicated review pass**
against the card text and this plan, per handoff §6 — the four freeze-adjacent
ones (3, 4, 6, 7) are non-negotiable.

### Task 1 — spec amendments

`docs/superpowers/specs/2026-08-27-effect-coverage-design.md`: §4.3's DP5 row
rewritten to the §1 split; DP2 departures 8 and 9 added after departure 7;
decision 3 closed in §2's log and in §4.2's departure 4; §7.3 gains the seven
rulings of §3 above; §8's wave-5 table gains the mechanism each card actually
got. No code.

### Task 2 — DP5 state shape and the turn-end pass

- `gameInit.ts`: `ZoneEffect.expiresOnTurn?`, `ZoneEffect.data?`, the
  `scheduled` union member. `buildInitialGame` needs no change (both lists
  already start empty).
- `gameEngine.ts` `endTurn`: a new block immediately after `endingSide` is
  captured and **before** `turnNumber` moves —
  (a) `state.scheduled` items whose `side === endingSide` and `type ===
  'sabotageWatch'` and `dueTurn <= turnNumber` are processed and dropped;
  every other type, including `changeOrderDraw`, is carried forward untouched
  by this pass and left to the existing incoming-side loop;
  (b) `state.zoneEffects` entries whose `side === endingSide` and
  `expiresOnTurn !== undefined` and `expiresOnTurn <= turnNumber` are removed,
  drawing a card first when `data.drawOnExpiry === true`.
- Tests (`shared/engine/gameEngine.test.ts`): a permanent rider survives ten
  END_TURNs; a rest-of-turn rider is gone after its owner's END_TURN and
  **not** after the opponent's; `drawOnExpiry` draws exactly one card and logs;
  a rider without it draws none; a `changeOrderDraw` for the ending side is
  **not** eaten by the new pass and still lands two turns later.

### Task 3 — rider dispatch: both sides at lock, attacker side on a bombardment

- `battleTriggers.ts`: `dispatchBattleLock`'s rider loop drops its
  `defenderSide` filter and computes `isDefender` per rider; new
  `dispatchZoneActivation(game, ctx, zoneId, actor)` dispatching the
  **actor's** riders with `phase: 'baseAttack'`, `isDefender: false`,
  `isParticipant: false`.
- `baseAttack.ts`: call it after `checkVictory` and beside
  `dispatchBaseAttackVictory`, so an intercepted or refused bombardment
  dispatches nothing.
- `dwgEffects.ts`: `dwgWatersInterception` returns early unless
  `battle.isDefender`.
- Tests (`shared/engine/battleTriggers.test.ts`, `dwgEffects.test.ts`): an
  attacker-side rider fires at lock and reads `isDefender: false`; a
  defender-side rider still fires and still reads `true`; DWG Waters on a zone
  its owner is **bombarding** does not intercept its own attack (the
  regression guard for departure 9); the dispatch order attacker-then-defender
  is fixed.

### Task 4 — Ambush (`shared/effects/wfEffects.ts`)

`AMBUSH_DISTANCE_M = 600` in `gameSettings.ts`. One registry name,
`ambushEffect`, three occasions told apart by the payload exactly as DWG Waters
does it: no `battle`/`resolution` → claim the zone (rider with
`expiresOnTurn: turnNumber`, `data: { drawOnExpiry: true }`); `battle.phase ===
'lock' && !battle.isDefender` → **remove the rider first**, then offer;
`resolution` → apply.

The offer is a `choice()` yes/no ("Spring your Ambush…"), because the card says
"you may" twice and closer spawn is not always wanted. Applying: `distanceM`
reduced by `AMBUSH_DISTANCE_M`, clamped at `SPAWN_DISTANCE_MIN_M` the way
`tacticalPositioning` clamps, `distanceModifiedBy` **untouched** (Ambush is not
that hero power and must not spend it), plus one public log line carrying both
permissions.

- Refuse a re-claim of a zone the actor already holds an Ambush on, as
  `dwgWatersClaim` does, so the play is not spent on a no-op.
- Removing the rider before the offer is what makes the "unused → draw" tail
  correct when the choice is *dropped* for a taken slot (§4.2, departure 4):
  the player fought, so no draw either way.
- Tests: claim writes one rider; lock as aggressor consumes it and offers;
  accept moves the distance and clamps at the floor; decline moves nothing;
  lock as **defender** in that zone does not consume it; a second battle the
  same turn gets no offer; END_TURN with the rider intact draws one card;
  END_TURN after a battle draws none; the offer is dropped (not overwritten)
  when a slot is already owed, and the rider is still consumed.

### Task 5 — Ongoing Attrition (`shared/effects/dwgEffects.ts`)

`ONGOING_ATTRITION_DAMAGE_PER_VEHICLE = 40_000`. One name,
`ongoingAttritionEffect`: claim (rider with `expiresOnTurn`,
`data: { drawOnExpiry: true }`); fire on `battle.phase === 'lock' ||
'baseAttack'` when `!battle.isDefender`.

Damage = `surplus × 40_000` where `surplus = own zone population − enemy zone
population`, applied to `zone.baseHp[enemy]` with `Math.max(0, …)`, then
`checkVictory`. Guards, in order: surplus ≤ 0 → nothing; base already at 0 →
nothing; an enemy `BLOCKER` in the zone → nothing, with a log line. Only a
strike that lands removes the rider (ruling 6).

- Tests: 3-vs-1 at lock deals 80k and removes the rider; 1-vs-1 deals nothing
  and leaves it; a bombardment fires it on top of the bombardment damage; a
  Blocker suppresses it and leaves the rider; a defender-side lock in that zone
  does not fire it; damage is clamped at zero HP and `checkVictory` runs (two
  fallen zones ends the game); END_TURN after a strike draws nothing, after a
  fizzle draws one.

### Task 6 — Sub Killer (`shared/effects/owEffects.ts` + `placement.ts`)

`subKillerEffect`, `playOnVehicleEffect`. Validate: target is an **enemy**
vehicle; `vehicleType ∈ {sub, plane, airship}`; the actor holds **no** `GT`
vehicle in that zone. Then remove the entry from `zone.cards[enemy]` and route
it through `discardCard(game, enemySide, entry)` — no death trigger (ruling 2)
— and push a rider with `expiresOnTurn: turnNumber` and no `drawOnExpiry`.

`legalZonesFor(state, side, card)` excludes any zone carrying that side's
`subKillerEffect` rider when `card.faction === 'GT'`. That is the single
legality function both `PLAY_CARD_TO_ZONE` and
`PLAY_CARD_TARGETING_CARD_IN_HAND` gate on and the one HandBar highlights from,
so the block reaches the server, the client preview and the board highlight in
one edit. `MOVE_VEHICLE` is deliberately untouched: the card says *play*.

The rider is dispatched at lock like any other (it lives in `zoneEffects`), so
the effect must return `true` untouched on any `battle` payload. It needs **no**
`{ needsCatalog: true }`: without a catalog the lock dispatcher simply skips it,
which costs nothing.

- Tests: a legal removal takes the sub off the board and into the enemy's
  discard; the enemy's `onDeathEffect` does **not** fire; a target that is a
  ship or tank 400s; a friendly target 400s; a zone where the actor has a GT
  vehicle 400s; `legalZonesFor` drops that zone for a GT vehicle and keeps it
  for a non-GT one; the block is gone after the actor's END_TURN; a lock
  dispatch on that zone is a no-op.

### Task 7 — Recurring Threat (`shared/effects/dwgEffects.ts` + `battleTriggers.ts`)

Extract `battleResolve.ts`'s death-trigger dispatch into
`fireDeathEffect(game, ctx, side, entry): void` in `battleTriggers.ts` and call
it from both places, so "destroy" means one thing.

`recurringThreatEffect`, `{ needsCatalog: true }` — required even though the
summon reads the stored snapshot, because `dispatchBattleLock` mints the
rider's payload card from `ctx.catalog` by `cardName`; without the flag the
probe never loads a catalog and the rider is skipped in production while every
unit test passes (trap 4.5's exact shape).

Play: validate a **friendly** target; remove it from the zone; push the
permanent rider (`data: { summon: discardSnapshotOf(entry, actor) }`, no
`expiresOnTurn`); `discardCard`; **then** `fireDeathEffect` last, so a
suspending or drawing death effect cannot interleave with our own writes.

Lock: `battle.isDefender` only, and only when the defender has at least one of
its own **board** hulls in the battle — DWG Waters' "alongside your fleet needs
a fleet" guard, needed here for the same reason (clause 3's guardian-only
battle must not also draw a Recurring Threat hull). Offer a yes/no `choice()`;
on accept, `mintHull` from the stored snapshot through `copyMeta`, then
`joinBattle(game, actor, id, entry)` so it is a battle summon that evaporates
on approval (§4.4).

- Tests: play destroys the target, fires its `onDeathEffect`, and writes one
  permanent rider carrying the snapshot; an enemy target 400s; the rider
  survives END_TURN; a defensive lock in that zone offers, accept puts the copy
  in `summons` **and not** on the board, decline puts nothing; an offensive
  lock in that zone offers nothing; a guardian-only defensive battle offers
  nothing; two Recurring Threats on one zone both offer (one at a time — the
  second is dropped, logged, and the first still resolves); the summon
  evaporates on `DECIDE_BATTLE_REPORT` with nothing in `state.destroyed`; a
  **player-made** vehicle round-trips (the catalog-name path would fail here);
  `CATALOG_EFFECTS.has('recurringThreatEffect')` asserted at runtime.

### Task 8 — Sabotage (`shared/effects/owEffects.ts`)

`sabotageEffect`: `grantKeywords({ keywords: [KEYWORDS.FRAGILE], target:
'field' })` — unrestricted as to side, since the text says only "a vehicle" —
then push `{ type: 'sabotageWatch', side: actor, dueTurn: game.turnNumber,
instanceId: target }`. Task 2's ending-side pass draws when `findVehicle` still
finds the instance.

- Tests: FRAGILE lands and is idempotent on a hull that already has it; the
  watch draws exactly one card when the hull is alive at the actor's END_TURN;
  none when it died in a battle first; the item is dropped either way; a
  Temporary hull still counts as surviving (culled at the *next* turn's start);
  a hull already carrying FRAGILE cannot be repaired, which
  `autoRepairIds`/`validateRepairChoices` already enforce — assert it end to
  end so the card's whole point is pinned.

### Task 9 — frontend and test hygiene

- `zoneEffectBadges.ts`: four new `ZONE_EFFECT_DISPLAY` entries and their icons
  in `BoardZone.tsx`'s `ZONE_EFFECT_ICONS` (`crosshair`, `torpedo`, `noSubs`,
  `ship2` — all already in `assets/icons/`). Badge `key` gains the array index:
  two Recurring Threats on one zone for one side are legal and would otherwise
  collide as React keys.
- `shared/engine/placement.test.ts`: rename its `ambushEffect` /
  `sabotageEffect` unimplemented stand-ins to `t_`-prefixed synthetics
  (testing.md names both as wave 5's problem). Registering the real names makes
  those assertions go red — loudly, per testing.md's own correction — so this
  must land with Tasks 4 and 8.

### Task 10 — close the guard

`KNOWN_GAPS` emptied, `toHaveLength(5)` → `toHaveLength(0)`, the wave loop
extended to `wave 5`. `npm run seed:build` (no `meta` changed this wave, so the
SQL should be byte-identical — run it and confirm, rather than assume).
`npm run functions:sync` in the same commit as every `shared/` change. Grep the
seed source for each of the five names before calling the wave done (blind
spot 5).

### Task 11 — deploy, live smoke, close-out

- Rebase on `main`, run all four gates, secrets audit.
- Extend `scripts/smoke-wave4.mjs` into `scripts/smoke-wave5.mjs`: point its
  `required` deck lists at the five cards and drive the paths no unit test
  reaches — the catalog probe for a `zoneEffects` rider that mints from a
  **stored snapshot** (new), the both-sides lock dispatch, and `legalZonesFor`
  rejecting a GT play through the real function.
- Merging to `main` deploys (handoff 4.1). If an out-of-band deploy is needed:
  `npm run functions:deploy -- game-action`, never the MCP tool; verify the
  version incremented and verify **by content**.
- The close-out doc the kickoff asks for, in place of a wave-6 handoff: all 65
  cards against §8, the rulings reality contradicted, and what is left
  unverified.

## 7. Risks this plan is carrying deliberately

| Risk | Mitigation |
|---|---|
| Widening the lock rider pass changes shipped DWG Waters behaviour | It already guards on `isDefender`; a regression test pins that, and departure 9's `dwgWatersInterception` guard closes the bombardment half |
| A lock-time choice competes for the one slot (Ambush, Recurring Threat) | Both route through `choice()`, which drops rather than overwrites; both consume/keep their rider **before** offering, so the drop is not silently free |
| `endTurn` gaining a second `scheduled` pass could eat `changeOrderDraw` | The new pass switches on `type` and handles only `sabotageWatch`; a test asserts a `changeOrderDraw` survives it |
| `ZoneEffect` growing fields breaks a live row | Both are optional and absent means what every existing row already means; no `normalizeState` default is required, and this plan says so out loud rather than skipping the question |
| A `zoneEffects` rider without `{ needsCatalog: true }` dies in production only | ⚠ **This row was wrong as written, and implementation caught it.** It claimed only Recurring Threat needed the flag because only Recurring Threat reads a catalog. The flag is not about what the effect reads: `fireRider` mints the rider's *payload card* from `ctx.catalog` by `cardName`, so **any rider that must be reached needs it** — Ambush and Ongoing Attrition carry it too. Sub Killer is the sole exception, because its rider is pure data that never needs to run. A runtime `CATALOG_EFFECTS` assertion now pins all four, and the negative case for Sub Killer |
