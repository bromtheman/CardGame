// Dev-only QA login hook.
//
// `scripts/qa-login.mjs` signs a QA account in from Node (so no password is ever
// typed into the sign-in form) and serves the resulting session once over
// loopback. This installs the browser half of that handoff:
//
//   await window.__qaLogin()   // -> the signed-in email
//
// setSession() persists through the client's own storage and fires
// onAuthStateChange, so AuthProvider picks it up without a reload.
//
// Imported only under `import.meta.env.DEV` in main.tsx, so it is dropped from
// production builds.
import { supabase } from './supabaseClient'

declare global {
  interface Window {
    __qaLogin?: (port?: number) => Promise<string | null>
  }
}

window.__qaLogin = async (port = 5199) => {
  const res = await fetch(`http://127.0.0.1:${port}/session`)
  if (!res.ok) {
    throw new Error(`qa-login handoff failed (HTTP ${res.status}) — is scripts/qa-login.mjs running?`)
  }
  const session = (await res.json()) as { access_token: string; refresh_token: string }
  const { data, error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  if (error) throw error
  return data.session?.user.email ?? null
}
