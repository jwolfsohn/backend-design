You are reviewing a backend design produced by the synthesis agent. Read `.backend-design/state/*.json`, `.backend-design/config.json`, and `.backend-design/gaps.json`. For each of the four axes below, look for the listed concrete patterns. Only write a question when the issue is **real and load-bearing for v1**, not a generic "consider X" platitude. **Cap output at 8 questions total.** Each question gets `category: "skeptic"`, an `axis` field, an opinionated `recommendation`, and `evidence` file:line(s) drawn from the state.

**Security**
- Endpoints with path params named `:userId`, `:accountId`, `:id`, etc., where no `path_params[i].scopes_query: true` check is declared — IDOR risk. Ask whether to add ownership checks.
- POST/PATCH/DELETE endpoints with no declared rate limit when the global rate limit is loose — suggest tighter limits on destructive routes.
- Entity fields named `email`, `phone`, `ssn`, `dob`, `address` exposed in list endpoints with `auth: "none"` — PII exposure.
- Auth-required endpoints whose `triggered_by` is a clearly public screen.
- Auth endpoints whose `inferred_from_signal` doesn't match `auth.json.inferred_from` — sign that the auth path is mis-categorized (e.g. endpoint says `auth_path` but `auth.json` says `token_storage_key`).
- Entities with a `user_id` FK (or any FK to the auth entity) when `auth.strategy === "none"` and `auth.inferred_from` starts with `judgment:` — writes will accept `user_id` from the request body (untrusted) or leave it NULL. The synthesis-emitted Tier-1 question asks whether to add auth at all; this is the orthogonal question of what the write contract should be while auth is absent. Surface as: "v1 ships anonymously per signal 7 — should the write endpoint at least reject client-supplied `user_id` to avoid impersonation when auth later lands?"

**Scalability & data integrity**
- List endpoints with `filterable_fields` or `sortable_fields` where the target entity has no matching `indexes` entry covering those columns.
- List endpoints with no `pagination.strategy` set — unbounded result sets.
- Detail endpoints whose response references >2 related entities — likely N+1 unless explicit eager loading is intended.
- Multi-step business flows visible in the UI (signup → email-verify → onboarding, or cart → checkout → payment) where intermediate state lives in the DB but no transaction boundary is implied.

**Multi-tenancy / ownership**
- Entities that look user-owned (have an FK to the auth entity) but where some endpoints don't filter by it.
- Org-shaped screens (path `/orgs/...`, components named `OrgX`) where entities lack an `org_id` FK.
- Sharing / collaboration UI (invite, members, roles) with no join table.

**Operability**
- No `/health` or `/ready` endpoint declared.
- Webhook endpoints with no idempotency mechanism (no `request_id` dedup, no `Idempotency-Key` header support).
- Payment / order POST endpoints with no `Idempotency-Key` support.
- Inconsistent error response shapes across endpoints (some return `{ error: string }`, others `{ message }`) — surface as one consolidation question.

**Output format** (matches existing `open_questions.json`):

```json
{
  "id": "skeptic-security-idor-orgs-orgid",
  "title": "[skeptic/security] GET /api/orgs/:orgId/posts may leak across tenants",
  "question": "The :orgId path param doesn't have scopes_query: true, so a logged-in user from Org A could request Org B's posts. Should the handler verify the authenticated user is a member of :orgId before querying?",
  "context": "Endpoint app/orgs/[orgId]/posts/page.tsx:8 → GET /api/orgs/:orgId/posts; path_params: [{name: 'orgId', scopes_query: false}]. The Org entity has a Members join table.",
  "recommendation": "Yes — add scopes_query: true and check membership in the handler. Without this, IDOR is the most likely security incident.",
  "evidence": ["app/orgs/[orgId]/posts/page.tsx:8", "entities.json -> Org"],
  "category": "skeptic",
  "axis": "security"
}
```

**Do not duplicate** questions already in `open_questions.json` (skim them first). If an axis has no concrete issues, skip it — don't pad with generic questions. Write the full augmented array back to `.backend-design/state/open_questions.json` (preserve the existing entries, append yours). Also write your raw findings (one entry per finding, with longer reasoning) to `.backend-design/state/skeptic_findings.json` for traceability.
