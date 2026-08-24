import { Link } from 'react-router-dom'

export function NavBar({ right }: { right?: React.ReactNode }) {
  return (
    <header className="flex items-center gap-6 border-b border-ocean-600 bg-ocean-900/80 px-6 py-3 shadow-plank">
      <Link to="/" className="flex items-center gap-3">
        <img src="/ftd-logo-large.png" alt="FTD Card Game" className="h-10" />
        <span className="font-display text-2xl text-parchment-100">FTD Card Game</span>
      </Link>
      <nav className="ml-auto flex items-center gap-4">{right}</nav>
    </header>
  )
}
