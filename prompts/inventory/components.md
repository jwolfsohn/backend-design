Map every component file in this frontend. Also catalog every shared-state container (Context/Provider, Zustand/Redux/Jotai/Recoil/MobX/Pinia/Vuex/NgRx stores) and every `localStorage`/`sessionStorage`/cookie key.

Use the framework-specific search patterns from the patterns file given to you (read it first). Apply its **Components** bullets to find component files. For shared state, search for the idioms appropriate to the framework (e.g. Pinia `defineStore` for Vue, services + DI for Angular, Svelte stores for SvelteKit).

Write JSON to `.backend-design/state/components.json` with this shape:

```json
{
  "components": [
    {
      "name": "PostCard",
      "file": "components/PostCard.tsx",
      "props": [{"name": "post", "type": "Post", "required": true}],
      "renders": ["Button", "Link", "Avatar"],
      "hooks": ["useRouter", "useAuth"],
      "reads": ["Post.title", "Post.body", "Post.author.name"],
      "evidence": ["components/PostCard.tsx:1"]
    }
  ],
  "shared_state": {
    "contexts": [
      {"file": "lib/AuthContext.tsx", "name": "AuthContext", "shape": {"user": "User | null"}, "consumers": ["app/layout.tsx:5", "components/Header.tsx:12"]}
    ],
    "stores": [
      {"file": "lib/cart.ts", "library": "zustand", "shape": {"items": "CartItem[]", "total": "number"}, "mutators": ["addItem", "removeItem"]}
    ],
    "storage_keys": [
      {"key": "auth_token", "type": "localStorage", "evidence": ["lib/api.ts:8"]}
    ]
  }
}
```

Infer props from usage if TS types are missing. Do not stop at depth 2 — go to leaf components. Do not output markdown — only the JSON file.
