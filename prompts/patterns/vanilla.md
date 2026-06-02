Plain HTML + JS + CSS, no framework.

- **Screens**: `**/*.html` files (each is a screen). `index.html` is the entry.
- **Network calls**: `fetch(...)`, `XMLHttpRequest`, `<form action="..." method="...">`.
- **Forms**: `<form action="/url" method="post">` or JS-controlled `<form>` with `addEventListener('submit')`.
- **Components**: none formally. Look for repeated HTML patterns and shared `<script>` files.
- **Auth hints**: localStorage/sessionStorage token reads, `<form action="/login">`-style submissions.
