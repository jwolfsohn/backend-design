Gatsby.

- **Routes**: `src/pages/**/*.{js,tsx}`, file-based. Dynamic routes via `gatsby-node.js -> createPages`.
- **Components**: `src/components/`, `src/templates/` (dynamic page templates).
- **Network calls**: GraphQL `useStaticQuery` for build-time data; `fetch`/`axios` for runtime client calls.
- **Forms**: standard React `<form>`.
- **Auth hints**: `gatsby-plugin-create-client-paths`, custom auth components in `src/`.
