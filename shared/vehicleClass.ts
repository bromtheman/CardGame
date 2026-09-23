import { VEHICLE_TYPES } from './gameSettings.ts'

// "Is this a ship?" — asked by placement pools, isAiShip, the DWG boarding
// party and Double Up, SS Braveheart's duel pick, WF Harbringer's pool, the
// fleet-battle omission rule, Change Order, Cathode's duel and the bot's move
// menu.
//
// A Hovercraft (VEHICLE_TYPES.HOVER, 2026-09-22 hovercraft amendment §4)
// counts as a ship for EVERY rule; the one place it differs is its FtD spawn
// altitude (shared/customBattle.ts). So no rule compares vehicleType to
// VEHICLE_TYPES.SHIP directly — it asks here, and the next ship class is one
// line.
//
// A LEAF module: it imports gameSettings and nothing else, so the engine, the
// effects, the bot and the frontend can all read it without an import cycle.
export function isShipClass(vehicleType: string | null | undefined): boolean {
  return vehicleType === VEHICLE_TYPES.SHIP || vehicleType === VEHICLE_TYPES.HOVER
}
