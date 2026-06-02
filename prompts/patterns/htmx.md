HTMX-driven HTML.

- **Screens**: `**/*.html` templates. May be served by an existing backend — check first.
- **Network calls**: HTMX attributes — `hx-get`, `hx-post`, `hx-put`, `hx-delete`, `hx-patch`. Each attribute IS an endpoint call. Capture the URL and the trigger element.
- **Forms**: `<form hx-post="/url">` or buttons with `hx-post`.
- **Auth hints**: cookie-based sessions; look for login/signup HTML pages.
- **IMPORTANT**: HTMX typically pairs with an existing server. Surface this in Open Questions before designing — the user may want to extend an existing backend rather than scaffold a new one.
