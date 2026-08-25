// Copies shared modules into each function per shared-manifest.json.
// Run: npm run functions:sync
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(
  readFileSync(join(root, 'supabase', 'functions', 'shared-manifest.json'), 'utf8'),
)
for (const [fn, files] of Object.entries(manifest)) {
  for (const f of files) {
    const dest = join(root, 'supabase', 'functions', fn, 'shared', f)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(join(root, 'shared', f), dest)
    console.log(`synced ${fn}/shared/${f}`)
  }
}
