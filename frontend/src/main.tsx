import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './theme/index.css'
import App from './App.tsx'

// Dev-only: installs window.__qaLogin() for scripts/qa-login.mjs. Dropped from prod builds.
if (import.meta.env.DEV) import('./lib/qaLogin')

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnReconnect: 'always', retry: 2 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
