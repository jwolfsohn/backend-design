Inventory every form, every input, every interactive button (including those inside modals and nested components). Flag every auth-related element: signup, login, logout, password reset, email verification, OAuth, magic link, MFA, account deletion, change password, change email.

Use the framework-specific search patterns from the patterns file given to you (read it first). Apply its **Forms** and **Auth hints** bullets. Form syntax varies dramatically by framework — JSX `<form onSubmit>`, Vue `<form @submit>`, Svelte `<form on:submit>`, Angular `[formGroup]`, HTMX `<form hx-post>`, Astro `<form action="/api/...">`, etc. Find them all.

Write JSON to `.backend-design/state/forms.json` with this shape:

```json
{
  "forms": [
    {
      "id": "NewPostForm",
      "file": "components/NewPostForm.tsx:12",
      "purpose": "Create a new post",
      "multipart": false,
      "inputs": [
        {"name": "title", "type": "text", "validation": {"required": true, "minLength": 3, "maxLength": 200}},
        {"name": "body", "type": "textarea", "validation": {"required": true}},
        {"name": "cover_image", "type": "file", "accept": "image/*", "validation": {"required": false, "max_size_mb": 5}}
      ],
      "submits_to": "POST /api/posts",
      "on_success": "redirect to /posts/[id]",
      "evidence": ["components/NewPostForm.tsx:12"]
    }
  ],
  "standalone_buttons": [
    {
      "file": "components/PostCard.tsx:42",
      "label": "Delete",
      "action": "api_call",
      "destructive": true,
      "target": "DELETE /api/posts/:id",
      "evidence": ["components/PostCard.tsx:42"]
    }
  ],
  "auth_surface": {
    "signup": {"present": true, "file": "app/signup/page.tsx"},
    "login": {"present": true, "file": "app/login/page.tsx"},
    "logout": {"present": true, "trigger": "components/Header.tsx:23"},
    "password_reset": {"present": false},
    "email_verification": {"present": false},
    "oauth_providers": []
  }
}
```

Action values: `api_call`, `navigate`, `local_state`, `open_modal`. Set `destructive: true` for Delete/Remove/Cancel.

**Classify by intent, not by current wiring.** A button is `action: "api_call"` whenever its *purpose* is a server-side mutation, even when the current implementation is `useState`, `alert()`, a `console.log`, or a stub. The frontend's wiring is often incomplete on vibe-coded sites; the inventory's job is to capture what the button is *for*, not what it currently *does*. Specifically:

- **Always `api_call` regardless of wiring** — buttons whose label, text, or `aria-label` matches any of: `Reserve`, `Book`, `Buy`, `Checkout`, `Pay`, `Submit`, `Send`, `Subscribe`, `Save`, `Saved`, `Favorite` / `Favourite`, `Like`, `Bookmark`, `Heart`, `Star`, `Pin`, `Follow`, `Subscribe`, `Add to cart`, `Add to list`, `Add to collection`. These labels carry **persistent-collection or transactional semantics** — a heart icon on a recipe card is morally an API call even when the only handler is `setFavorited(f => !f)`. Set `target` to a best-guess endpoint (e.g. `POST /api/recipes/:id/favorite`) so signal 7 and the synthesis agent can reason about ownership.

- **`local_state`** is for genuinely local UI affordances: show/hide details, dropdown open/close, tab switching, accordion expand/collapse, image gallery cycling, modal dismiss-without-save. If you find yourself defaulting to `local_state` for a save/favorite/like-shaped button just because there's no `fetch()` call, **stop and reclassify** — the wiring is incomplete, not the intent.

- **`navigate`** is for `<Link>` / `<a href>` / `router.push()` actions that change the URL without mutating state.

- **`open_modal`** is for buttons that open a dialog containing a *separate* form/button — classify the inner action separately.

**File inputs.** For every `<input type="file">` (or `accept` attr, or framework equivalent), set `type: "file"` and capture `accept` (MIME globs) and any size validation. If the form contains any file input, set `multipart: true` at the form level — the endpoint will need to accept `multipart/form-data`. If the form uses `FormData` in JS without an `<input type="file">`, still set `multipart: true` and note the field names.

Do not output markdown — only the JSON file.
