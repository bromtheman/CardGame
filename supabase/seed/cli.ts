import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildSeedSql, loadSeedData } from './transform'

const { cards, heroPowers } = await loadSeedData()
const sql = buildSeedSql(cards, heroPowers)
const out = join(dirname(fileURLToPath(import.meta.url)), 'seed_data.sql')
writeFileSync(out, sql)
console.log(`Wrote ${cards.length} cards + ${heroPowers.length} hero powers to ${out}`)
