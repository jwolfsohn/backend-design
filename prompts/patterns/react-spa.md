React without a meta-framework (Vite, CRA, etc.).

- **Routes**: search for `react-router-dom` imports — `<Routes>`, `<Route>`, `createBrowserRouter`. Usually in `src/App.tsx`, `src/main.tsx`, `src/router.tsx`, or `src/routes.tsx`.
- **Components**: `src/components/`, `src/pages/`, `src/views/`, `src/features/`.
- **Network calls**: `fetch`, `axios`, `useQuery`/`useMutation` (React Query), `useSWR`, `useEffect` data-fetching.
- **Forms**: `<form onSubmit={}>` with `react-hook-form` or controlled state. Look for `useForm` imports.
- **Auth hints**: `src/context/AuthContext.tsx`, `src/hooks/useAuth.ts`, `localStorage.getItem('token')`.
