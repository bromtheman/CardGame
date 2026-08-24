import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { isValidUsername } from '@shared/validation'
import { supabase } from '../lib/supabaseClient'

export function SignupPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!isValidUsername(username)) {
      setError('Username must be 3-20 letters, numbers, or underscores.')
      return
    }
    setBusy(true)
    try {
      const { data: free, error: rpcError } = await supabase.rpc('username_available', {
        check_name: username,
      })
      if (rpcError) throw rpcError
      if (!free) {
        setError('That username is taken.')
        return
      }
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username } },
      })
      if (signUpError) throw signUpError
      if (data.session) navigate('/')
      else setNeedsConfirm(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (needsConfirm) {
    return (
      <main className="mx-auto max-w-sm p-8 text-center">
        <h1 className="font-display text-3xl">Almost aboard!</h1>
        <p className="mt-4">Check your email to confirm your account, then sign in.</p>
        <Link className="mt-4 inline-block underline" to="/login">Go to sign in</Link>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="font-display text-3xl text-center">Enlist</h1>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
        <input className="rounded bg-ocean-900 p-2" placeholder="Username"
          value={username} onChange={(e) => setUsername(e.target.value)} />
        <input className="rounded bg-ocean-900 p-2" placeholder="Email" type="email"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="rounded bg-ocean-900 p-2" placeholder="Password" type="password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-red-400">{error}</p>}
        <button disabled={busy} className="rounded bg-brass-400 p-2 font-bold text-ocean-950">
          {busy ? 'Enlisting…' : 'Create account'}
        </button>
      </form>
      <p className="mt-4 text-center">
        Already enlisted? <Link className="underline" to="/login">Sign in</Link>
      </p>
    </main>
  )
}
