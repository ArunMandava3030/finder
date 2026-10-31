import { lazy, Suspense } from 'react';
import PublicApp from './PublicApp.jsx';
const ServerApp = lazy(() => import('./ServerApp.jsx'));
export default function App() {
  return import.meta.env.VITE_SEARCH_MODE === 'server'
    ? <Suspense fallback={<p>Loading Elsewhere…</p>}><ServerApp /></Suspense>
    : <PublicApp />;
}
