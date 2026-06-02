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

**File inputs.** For every `<input type="file">` (or `accept` attr, or framework equivalent), set `type: "file"` and capture `accept` (MIME globs) and any size validation. If the form contains any file input, set `multipart: true` at the form level — the endpoint will need to accept `multipart/form-data`. If the form uses `FormData` in JS without an `<input type="file">`, still set `multipart: true` and note the field names.

Do not output markdown — only the JSON file.
