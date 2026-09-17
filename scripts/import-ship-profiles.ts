// Import one FtDArmament ship report into shared/shipProfiles/<FACTION>.ts.
//
//   npm run profiles:import -- "C:\Users\JFinn\FtDArmament\reports\DWG.cards.md"
//
// The faction is the report's filename stem (DWG.cards.md → DWG). The parser
// (scripts/ship-profiles/parseShipReport.ts) is strict and names the ship on
// any problem; nothing is written until the whole report parses. A NEW
// faction also needs its export spread into SHIP_PROFILES in
// shared/shipProfiles.ts, the file added to supabase/functions/
// shared-manifest.json, and `npm run functions:sync` run — then
// shared/shipProfiles.test.ts pins every key to a seeded card.

import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseShipReport, renderProfilesModule } from './ship-profiles/parseShipReport'

const reportPath = process.argv[2]
if (!reportPath) {
  console.error('usage: tsx scripts/import-ship-profiles.ts <path to FACTION.cards.md>')
  process.exit(2)
}

const sourceName = basename(reportPath)
const faction = sourceName.split('.')[0]
if (!/^[A-Z]{2,3}$/.test(faction)) {
  console.error(`cannot read a faction code from "${sourceName}" — expected e.g. DWG.cards.md`)
  process.exit(2)
}

const profiles = parseShipReport(readFileSync(reportPath, 'utf8'), faction)
const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'shared', 'shipProfiles', `${faction}.ts`)
writeFileSync(outPath, renderProfilesModule(faction, sourceName, profiles), 'utf8')
console.log(`${Object.keys(profiles).length} ${faction} profiles → ${outPath}`)
