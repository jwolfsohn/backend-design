# Frontend search patterns

This file is consumed by the Phase-1 inventory agents. The orchestrator reads `.backend-design/config.json -> frontend.patterns_key`, picks the matching section below, and prepends it to each agent's brief so they grep the right files for the detected framework.

Each section gives:
- **Routes/screens**: where pages or route definitions live
- **Components**: where reusable UI lives
- **Network calls**: framework-specific idioms for HTTP
- **Forms**: how forms are typically written
- **Auth hints**: places to look for signup/login/middleware

---

## nextjs-app

Next.js with the App Router.

- **Routes**: `app/**/page.tsx`, `app/**/layout.tsx`, `app/**/loading.tsx`, `app/**/error.tsx`, `app/**/not-found.tsx`. File-based — no central route config.
- **API routes**: `app/api/**/route.ts` — these are existing endpoints to preserve.
- **Components**: `components/**/*.tsx`, `app/_components/**/*.tsx`, anywhere `*.tsx` is colocated.
- **Network calls**: server components with `await fetch(...)`, `"use server"` server actions, `fetch()`/`axios`/`useSWR`/`useQuery` in client components.
- **Forms**: `<form action={serverAction}>`, or controlled forms with `onSubmit`.
- **Auth hints**: `middleware.ts` (route protection), `app/api/auth/`, `lib/auth.ts`, NextAuth/Clerk imports.

## nextjs-pages

Next.js with the Pages Router.

- **Routes**: `pages/**/*.tsx` (excluding `pages/_app.tsx`, `pages/_document.tsx`, `pages/api/**`).
- **API routes**: `pages/api/**/*.ts`.
- **Components**: `components/**/*.tsx`.
- **Network calls**: `getServerSideProps`, `getStaticProps`, `getInitialProps`, fetch/axios in components.
- **Forms**: `<form onSubmit={}>`.
- **Auth hints**: `pages/api/auth/`, NextAuth setup at `pages/api/auth/[...nextauth].ts`.

## react-spa

React without a meta-framework (Vite, CRA, etc.).

- **Routes**: search for `react-router-dom` imports — `<Routes>`, `<Route>`, `createBrowserRouter`. Usually in `src/App.tsx`, `src/main.tsx`, `src/router.tsx`, or `src/routes.tsx`.
- **Components**: `src/components/`, `src/pages/`, `src/views/`, `src/features/`.
- **Network calls**: `fetch`, `axios`, `useQuery`/`useMutation` (React Query), `useSWR`, `useEffect` data-fetching.
- **Forms**: `<form onSubmit={}>` with `react-hook-form` or controlled state. Look for `useForm` imports.
- **Auth hints**: `src/context/AuthContext.tsx`, `src/hooks/useAuth.ts`, `localStorage.getItem('token')`.

## remix

Remix / React Router v7 (data mode).

- **Routes**: `app/routes/**/*.tsx`. File-based. Dot-separated nested routes (e.g. `app/routes/posts.$id.tsx`).
- **Components**: `app/components/`, `app/lib/`.
- **Network calls**: `loader` and `action` exports in each route file. Fetcher calls via `useFetcher()`.
- **Forms**: `<Form method="post">` from `@remix-run/react` (or `react-router`).
- **Auth hints**: `app/services/auth.server.ts`, `app/sessions.server.ts`, cookie-based sessions.

## gatsby

Gatsby.

- **Routes**: `src/pages/**/*.{js,tsx}`, file-based. Dynamic routes via `gatsby-node.js -> createPages`.
- **Components**: `src/components/`, `src/templates/` (dynamic page templates).
- **Network calls**: GraphQL `useStaticQuery` for build-time data; `fetch`/`axios` for runtime client calls.
- **Forms**: standard React `<form>`.
- **Auth hints**: `gatsby-plugin-create-client-paths`, custom auth components in `src/`.

## vue-spa

Vue without a meta-framework.

- **Routes**: search for `vue-router` setup — `createRouter`, `createWebHistory`. Usually `src/router.ts`, `src/router/index.ts`, or inline in `src/main.ts`.
- **Components**: `src/components/`, `src/views/` (route components), `*.vue` SFCs.
- **Network calls**: `fetch`/`axios` in `<script setup>`, composables like `useFetch`/`useApi` under `src/composables/`.
- **Forms**: `<form @submit.prevent="">`, `v-model` two-way binding on inputs.
- **Auth hints**: Pinia/Vuex stores at `src/stores/auth.ts`, route guards via `router.beforeEach`.

## nuxt

Nuxt 3.

- **Routes**: `pages/**/*.vue`, file-based. Layouts under `layouts/`.
- **Components**: `components/**/*.vue` — auto-imported.
- **Network calls**: `useFetch`, `$fetch`, `useAsyncData`. Server routes under `server/api/**/*.ts` and `server/routes/**/*.ts` — these are existing endpoints to preserve.
- **Forms**: `<form @submit.prevent="">`.
- **Auth hints**: `middleware/auth.ts`, `composables/useAuth.ts`, `@sidebase/nuxt-auth` config.

## sveltekit

SvelteKit.

- **Routes**: `src/routes/**/+page.svelte`, `src/routes/**/+layout.svelte`, `src/routes/**/+error.svelte`. File-based.
- **Data loaders**: `+page.ts` (universal), `+page.server.ts` (server-only), `+layout.{ts,server.ts}`.
- **Server endpoints**: `src/routes/**/+server.ts` — existing API to preserve.
- **Components**: `src/lib/**/*.svelte`, `src/lib/components/**/*.svelte`.
- **Network calls**: `load` functions, `fetch` (server-aware), form `actions` in `+page.server.ts`.
- **Forms**: `<form method="POST" use:enhance>` for progressive enhancement.
- **Auth hints**: `src/hooks.server.ts` (request hooks), `src/lib/server/auth.ts`, `Lucia` or `@auth/sveltekit`.

## svelte-spa

Svelte without SvelteKit.

- **Routes**: `svelte-routing`, `svelte-navigator`, or `svelte-spa-router` — search for `<Router>`, `<Route>` imports. Usually in `src/App.svelte` or `src/routes.ts`.
- **Components**: `src/lib/**/*.svelte`, `src/components/**/*.svelte`.
- **Network calls**: `fetch`/`axios` in `<script>` blocks, `onMount` for initial fetches.
- **Forms**: `<form on:submit|preventDefault={}>`.

## angular

Angular 17+.

- **Routes**: `src/app/app.routes.ts` (standalone) or `src/app/app-routing.module.ts` (module-based). Look for `Routes` array with `path`/`component` pairs.
- **Screens**: each routed `*.component.ts` is effectively a screen.
- **Components**: `src/app/**/*.component.ts` (with paired `.html` + `.css`/`.scss`).
- **Network calls**: `HttpClient` from `@angular/common/http` — `http.get`, `http.post`, etc., usually in `src/app/**/*.service.ts`.
- **Forms**: Template-driven (`ngForm`, `[(ngModel)]`) or reactive forms (`FormGroup`, `FormControl`, `formBuilder`).
- **Auth hints**: route guards (`CanActivate`, `CanMatch`), HTTP interceptors in `src/app/interceptors/`, services in `src/app/auth/`.

## astro

Astro.

- **Pages**: `src/pages/**/*.astro`, `src/pages/**/*.{md,mdx}`. File-based.
- **API endpoints**: `src/pages/api/**/*.{ts,js}` — existing routes to preserve.
- **Components**: `src/components/` — can be `.astro`, `.tsx`, `.vue`, `.svelte` (islands).
- **Network calls**: `fetch()` in the frontmatter (build-time or SSR), or in client-side islands.
- **Forms**: `<form action="/api/...">` posting to Astro endpoints.
- **Auth hints**: `src/middleware.ts`, session helpers in `src/lib/auth.ts`.

## solid-start

SolidStart.

- **Routes**: `src/routes/**/*.{tsx,ts}`. File-based.
- **Components**: `src/components/`.
- **Network calls**: `createResource`, `createAsync`, server actions (`"use server"`), API routes in `src/routes/api/**/*.ts`.
- **Forms**: `<form action={serverAction} method="post">`.

## solid-spa

SolidJS without SolidStart.

- **Routes**: `@solidjs/router` — `<Router>`, `<Route>`. Usually `src/App.tsx` or `src/index.tsx`.
- **Components**: `src/components/`, `src/pages/`.
- **Network calls**: `createResource`, `fetch`/`axios`.

## qwik

Qwik / Qwik City.

- **Routes**: `src/routes/**/index.tsx`. File-based. Layouts: `src/routes/**/layout.tsx`.
- **Components**: `src/components/`.
- **Network calls**: `routeLoader$`, `routeAction$`, `server$` — all server-side. Client fetch via `useResource$`.
- **Forms**: `<Form action={action}>`.

## htmx

HTMX-driven HTML.

- **Screens**: `**/*.html` templates. May be served by an existing backend — check first.
- **Network calls**: HTMX attributes — `hx-get`, `hx-post`, `hx-put`, `hx-delete`, `hx-patch`. Each attribute IS an endpoint call. Capture the URL and the trigger element.
- **Forms**: `<form hx-post="/url">` or buttons with `hx-post`.
- **Auth hints**: cookie-based sessions; look for login/signup HTML pages.
- **IMPORTANT**: HTMX typically pairs with an existing server. Surface this in Open Questions before designing — the user may want to extend an existing backend rather than scaffold a new one.

## vanilla

Plain HTML + JS + CSS, no framework.

- **Screens**: `**/*.html` files (each is a screen). `index.html` is the entry.
- **Network calls**: `fetch(...)`, `XMLHttpRequest`, `<form action="..." method="...">`.
- **Forms**: `<form action="/url" method="post">` or JS-controlled `<form>` with `addEventListener('submit')`.
- **Components**: none formally. Look for repeated HTML patterns and shared `<script>` files.
- **Auth hints**: localStorage/sessionStorage token reads, `<form action="/login">`-style submissions.
