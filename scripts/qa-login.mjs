#!/usr/bin/env node
// QA login helper.
//
// Signs a QA account in against the real Supabase project and hands the resulting
// session to the dev-server browser, so QA (or an agent driving the preview) can
// start from a logged-in state without anyone typing a password into the form.
//
//   node scripts/qa-login.mjs          # first account in the credentials file
//   node scripts/qa-login.mjs p2       # a named account
//
// Credentials live ONLY in scripts/qa-accounts.local (gitignored) and are never
// printed or written anywhere else. See scripts/qa-accounts.example for the format.
//
// The script signs in, then serves the session ONCE over loopback on port 5199 and
// exits. Run it in the background, then in the dev-server page console run:
//
//   await window.__qaLogin()
//
// which calls supabase.auth.setSession() and returns the signed-in email.

import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_FILE = resolve(repoRoot, 'frontend/.env.local')
const ACCOUNTS_FILE = resolve(repoRoot, 'scripts/qa-accounts.local')
const PORT = 5199
const TIMEOUT_MS = 10 * 60 * 1000

/** A user-facing failure: reported as a clean message, never a stack trace. */
class Fatal extends Error {}
const die = (msg) => {
  throw new Fatal(msg)
}

// Never call process.exit() in this script. A hard exit after fetch() trips a
// libuv assertion (UV_HANDLE_CLOSING) on Windows. Setting exitCode and letting
// the loop drain is both correct and fast — undici does not hold the loop open.
function failWith(message) {
  console.error(`\nqa-login: ${message}\n`)
  process.exitCode = 1
}

function parseEnvFile(path) {
  const out = new Map()
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const value = line.slice(eq + 1).trim()
    out.set(line.slice(0, eq).trim(), value.replace(/^(['"])(.*)\1$/, '$2'))
  }
  return out
}

function loadAccounts() {
  if (!existsSync(ACCOUNTS_FILE)) {
    die(
      `no credentials file yet. Copy scripts/qa-accounts.example to\n` +
        `  ${ACCOUNTS_FILE}\n` +
        `and fill in your email + password. That file is gitignored.`,
    )
  }
  const accounts = new Map()
  for (const [key, value] of parseEnvFile(ACCOUNTS_FILE)) {
    const match = /^(.+)_(EMAIL|PASSWORD)$/.exec(key)
    if (!match) continue
    const name = match[1].toLowerCase()
    const account = accounts.get(name) ?? {}
    account[match[2].toLowerCase()] = value
    accounts.set(name, account)
  }
  return accounts
}

function pickAccount() {
  const accounts = loadAccounts()
  const names = [...accounts.keys()]
  if (names.length === 0) {
    die(`no accounts in ${ACCOUNTS_FILE}. Expected lines like P1_EMAIL=… and P1_PASSWORD=…`)
  }
  const requested = process.argv[2]?.toLowerCase()
  const name = requested ?? names[0]
  const account = accounts.get(name)
  if (!account) die(`unknown account "${requested}". Available: ${names.join(', ')}`)
  if (!account.email || !account.password) {
    die(`account "${name}" needs both ${name.toUpperCase()}_EMAIL and ${name.toUpperCase()}_PASSWORD`)
  }
  return { name, ...account }
}

function loadProject() {
  if (!existsSync(ENV_FILE)) die(`missing ${ENV_FILE} — copy frontend/.env.example and fill it in.`)
  const env = parseEnvFile(ENV_FILE)
  const url = env.get('VITE_SUPABASE_URL')
  const anonKey = env.get('VITE_SUPABASE_PUBLISHABLE_KEY')
  if (!url || !anonKey) {
    die(`${ENV_FILE} needs both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.`)
  }
  return { url: url.replace(/\/$/, ''), anonKey }
}

async function signIn({ url, anonKey }, account) {
  console.log(`qa-login: signing in "${account.name}" against ${url} …`)
  let response
  try {
    response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: account.email, password: account.password }),
    })
  } catch (err) {
    die(`could not reach ${url} — ${err instanceof Error ? err.message : String(err)}`)
  }

  const session = await response.json().catch(() => ({}))
  if (!response.ok) {
    const reason = session.error_description ?? session.msg ?? session.error ?? 'unknown error'
    die(`sign-in failed for "${account.name}" (HTTP ${response.status}): ${reason}`)
  }
  if (!session.access_token || !session.refresh_token) {
    die(`sign-in returned no session for "${account.name}" — is the account confirmed?`)
  }
  return session
}

function serveOnce(session) {
  let server

  const timeout = setTimeout(() => {
    failWith('timed out waiting for the browser to collect the session.')
    server.close()
    server.closeAllConnections()
  }, TIMEOUT_MS)

  server = createServer((req, res) => {
    const origin = req.headers.origin
    const allowed = Boolean(origin) && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(allowed ? 204 : 403).end()
      return
    }
    if (!allowed) {
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('qa-login: origin not allowed\n')
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    // Tear down only once the body has actually flushed to the browser.
    res.end(JSON.stringify(session), () => {
      console.log('qa-login: session handed to the browser — done.')
      clearTimeout(timeout)
      server.close()
      server.closeAllConnections()
    })
  })

  server.on('error', (err) => {
    clearTimeout(timeout)
    failWith(
      err.code === 'EADDRINUSE'
        ? `port ${PORT} is busy — another qa-login is probably still running.`
        : err instanceof Error
          ? err.message
          : String(err),
    )
  })

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`qa-login: session waiting on http://127.0.0.1:${PORT} (served once, then exits).`)
    console.log('qa-login: in the dev-server page console run:  await window.__qaLogin()')
  })
}

try {
  const account = pickAccount()
  const project = loadProject()
  const session = await signIn(project, account)
  console.log(`qa-login: signed in as ${session.user?.email} (${session.user?.id})`)
  serveOnce(session)
} catch (err) {
  if (!(err instanceof Fatal)) throw err
  failWith(err.message)
}
