Walk every screen in this frontend. A screen = anything the user can navigate to or that takes over the viewport: a route, a modal, a drawer, a wizard step, a tab panel that swaps content, an empty state, an error state, a loading state. Do not skip "obvious" screens (404, sign-in, settings sub-pages).

Use the framework-specific search patterns from the patterns file given to you (read it first). Apply its **Routes** / **Screens** / **Pages** bullets to find routes and pages. Cross-reference layout files. For mobile/desktop adaptations (responsive states), treat distinct visual breakpoints as separate screens only if they expose different functionality.

Write a JSON array to `.backend-design/state/screens.json` where each element is:

```json
{
  "id": "post-detail",
  "path": "/posts/[id]",
  "trigger": null,
  "file": "app/posts/[id]/page.tsx",
  "entities_displayed": ["Post", "Comment", "User"],
  "children": ["PostBody", "CommentList", "CommentForm"],
  "data_fetches": [
    {"method": "GET", "url": "/api/posts/[id]", "consumed_at": "app/posts/[id]/page.tsx:12"},
    {"method": "GET", "url": "/api/posts/[id]/comments", "consumed_at": "app/posts/[id]/page.tsx:18"}
  ],
  "nav_out": [
    {"to": "/users/[id]", "trigger_label": "author avatar"},
    {"to": "/posts/[id]/edit", "trigger_label": "Edit"}
  ],
  "auth_required": false,
  "evidence": ["app/posts/[id]/page.tsx:1"]
}
```

For non-URL screens (modals, wizard steps): set `path` to `null` and fill `trigger` with the file:line and label of what opens it. Always include `evidence`. Do not output any markdown — only write the JSON file. Be exhaustive.
