import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="p-8 text-center">Loading…</div>
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}
