import { Route, Routes } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './lib/auth'
import { supabase } from './lib/supabaseClient'
import { NavBar } from './components/NavBar'
import { RequireAuth } from './components/RequireAuth'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { CardsPage } from './pages/CardsPage'
import { CreateCardPage } from './pages/CreateCardPage'

function UserMenu() {
  const { session } = useAuth()
  const { data: profile } = useQuery({
    queryKey: ['profile', session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles').select('username').eq('id', session!.user.id).single()
      if (error) throw error
      return data
    },
  })
  if (!session) return null

  async function handleSignOut() {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) console.error('Sign out failed:', error)
    } catch (err) {
      console.error('Sign out failed:', err)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-ocean-300">{profile?.username ?? '…'}</span>
      <button className="underline" onClick={() => void handleSignOut()}>Sign out</button>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <NavBar right={<UserMenu />} />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
        <Route path="/cards" element={<RequireAuth><CardsPage /></RequireAuth>} />
        <Route path="/cards/new" element={<RequireAuth><CreateCardPage /></RequireAuth>} />
      </Routes>
    </AuthProvider>
  )
}
