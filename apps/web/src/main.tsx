import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import MapPage from './pages/MapPage';
import EventDrawer from './components/EventDrawer';
import { env } from './env';
import './index.css';

// Error capture only (no tracing/replay) — global handlers pick up render and
// unhandled-promise errors. Disabled when the DSN is absent (local dev).
if (env.sentryDsn) {
    Sentry.init({ dsn: env.sentryDsn, environment: import.meta.env.MODE });
}

const queryClient = new QueryClient();

const router = createBrowserRouter([
    {
        path: '/',
        element: <MapPage />,
        children: [{ path: 'eventos/:id', element: <EventDrawer /> }],
    },
    { path: '*', element: <Navigate to="/" replace /> },
]);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root element');

createRoot(rootEl).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
        </QueryClientProvider>
    </StrictMode>,
);
