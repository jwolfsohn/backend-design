Vue without a meta-framework.

- **Routes**: search for `vue-router` setup — `createRouter`, `createWebHistory`. Usually `src/router.ts`, `src/router/index.ts`, or inline in `src/main.ts`.
- **Components**: `src/components/`, `src/views/` (route components), `*.vue` SFCs.
- **Network calls**: `fetch`/`axios` in `<script setup>`, composables like `useFetch`/`useApi` under `src/composables/`.
- **Forms**: `<form @submit.prevent="">`, `v-model` two-way binding on inputs.
- **Auth hints**: Pinia/Vuex stores at `src/stores/auth.ts`, route guards via `router.beforeEach`.
