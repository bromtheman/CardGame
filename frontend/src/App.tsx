import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './lib/auth'
import { supabase } from './lib/supabaseClient'
import { NavBar } from './components/NavBar'
import { RequireAuth } from './components/RequireAuth'

const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })))
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })))
const SignupPage = lazy(() => import('./pages/SignupPage').then((m) => ({ default: m.SignupPage })))
const CardsPage = lazy(() => import('./pages/CardsPage').then((m) => ({ default: m.CardsPage })))
const CreateCardPage = lazy(() => import('./pages/CreateCardPage').then((m) => ({ default: m.CreateCardPage })))
const DecksPage = lazy(() => import('./pages/DecksPage').then((m) => ({ default: m.DecksPage })))
const DeckBuilderPage = lazy(() => import('./pages/DeckBuilderPage').then((m) => ({ default: m.DeckBuilderPage })))
const LobbiesPage = lazy(() => import('./pages/LobbiesPage').then((m) => ({ default: m.LobbiesPage })))
const GamesPage = lazy(() => import('./pages/GamesPage').then((m) => ({ default: m.GamesPage })))
const GameBoardPage = lazy(() => import('./pages/game/GameBoardPage').then((m) => ({ default: m.GameBoardPage })))

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
      <Suspense fallback={<main className="p-12 text-center font-display text-2xl text-ocean-300">Charting a course…</main>}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
          <Route path="/lobbies" element={<RequireAuth><LobbiesPage /></RequireAuth>} />
          <Route path="/games" element={<RequireAuth><GamesPage /></RequireAuth>} />
          <Route path="/game/:id" element={<RequireAuth><GameBoardPage /></RequireAuth>} />
          <Route path="/decks" element={<RequireAuth><DecksPage /></RequireAuth>} />
          <Route path="/decks/:id" element={<RequireAuth><DeckBuilderPage /></RequireAuth>} />
          <Route path="/cards" element={<RequireAuth><CardsPage /></RequireAuth>} />
          <Route path="/cards/new" element={<RequireAuth><CreateCardPage /></RequireAuth>} />
        </Routes>
      </Suspense>
    </AuthProvider>
  )
}
