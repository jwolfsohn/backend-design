Angular 17+.

- **Routes**: `src/app/app.routes.ts` (standalone) or `src/app/app-routing.module.ts` (module-based). Look for `Routes` array with `path`/`component` pairs.
- **Screens**: each routed `*.component.ts` is effectively a screen.
- **Components**: `src/app/**/*.component.ts` (with paired `.html` + `.css`/`.scss`).
- **Network calls**: `HttpClient` from `@angular/common/http` — `http.get`, `http.post`, etc., usually in `src/app/**/*.service.ts`.
- **Forms**: Template-driven (`ngForm`, `[(ngModel)]`) or reactive forms (`FormGroup`, `FormControl`, `formBuilder`).
- **Auth hints**: route guards (`CanActivate`, `CanMatch`), HTTP interceptors in `src/app/interceptors/`, services in `src/app/auth/`.
