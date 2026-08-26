# Workflow — branches, merges, deploys, and the backlog

Read this before branching, merging, pushing, sequencing a deploy, or picking up
backlog work.

## Branch → gates → merge

1. Feature work happens on a branch; `main` only moves by merge.
2. Before proposing a merge, ALL gates pass on the branch
   (see [testing.md](testing.md)): `npx vitest run`,
   `npx tsc -p tsconfig.json --noEmit`, `npm --prefix frontend run build`.
3. **Secrets audit before every push** (standing user requirement). Grep the
   branch diff and any new files for secret material — service-role keys, JWTs,
   `sb_secret`, private keys:

   ```bash
   git diff main...HEAD | grep -niE 'service_role|sb_secret|SUPABASE_SERVICE|BEGIN [A-Z ]*PRIVATE KEY|eyJhbGciOi'
   ```

   Only the publishable/anon key may appear (in `frontend/.env.example`
   context). The two test-account passwords in `docs/superpowers/plans/` are a
   known, accepted exception — rotate before going public.
4. Merging is the **user's call** — ask, then merge with
   `git merge --no-ff <branch> -m "Merge <name>: <summary>"` (watch for
   fast-forward: if `main` hasn't moved, a plain merge FFs and drops the named
   merge commit — the named `--no-ff` commit is the convention). Re-run a quick
   gate on the merged result, push, delete the branch.

## Deploy sequencing (code + remote must move together)

A change that touches engine/effects/functions is not "done" at merge:

1. Land the code change (with `npm run functions:sync` in the same commit).
2. Deploy the affected function(s) — full payload, see
   [supabase.md](supabase.md).
3. Apply any migration remotely via `apply_migration` (mirrors the file in
   `supabase/migrations/`).
4. Verify live: script an E2E poke or use the browser preview.

The frontend ships via Netlify from this repo (`netlify.toml`: builds
`frontend/`, publishes `dist`) — a push to `main` deploys the live site. Deploy
the affected edge functions and migrations BEFORE pushing frontend code that
depends on them.

Old rows created by previously-deployed code are the reason `normalizeState`
exists — when changing state shape, extend it rather than assuming fresh rows.

## Git on Windows, in this harness

- In the Bash tool, use relative paths / forward slashes — `git -C C:\Users\...`
  mangles backslashes.
- Leftover worktrees from other sessions may exist under `.claude/worktrees/`
  and can hold uncommitted work — leave foreign worktrees alone; never prune or
  delete one without the user's say-so.

## Where the backlog lives

- **Spec §10** (out-of-scope future work): blueprint upload/parsing, custom card
  effects, spectators, chat, rankings/matchmaking, admin UI, turn timers,
  SS/WF/GT faction powers, mobile layout, deck import/export.
- **Hardening backlog** (smaller items): scripted full-payload function deploys,
  hook-level realtime test with a mocked client, dialog focus trap, export
  `ALL_TRIGGER_KEYS` from the registry, stuck-`starting` lobby reclaim,
  settings-jsonb size cap, per-host lobby cap, create-card quota fail-open,
  magic-byte image validation, rotate/delete test accounts + enable
  leaked-password protection before public.
- Recorded rulings (accepted quirks — don't "fix" without asking): see the
  "Known gaps" list in [architecture.md](architecture.md) and the `isMyMove`
  note in [frontend.md](frontend.md).
