Svelte without SvelteKit.

- **Routes**: `svelte-routing`, `svelte-navigator`, or `svelte-spa-router` — search for `<Router>`, `<Route>` imports. Usually in `src/App.svelte` or `src/routes.ts`.
- **Components**: `src/lib/**/*.svelte`, `src/components/**/*.svelte`.
- **Network calls**: `fetch`/`axios` in `<script>` blocks, `onMount` for initial fetches.
- **Forms**: `<form on:submit|preventDefault={}>`.
