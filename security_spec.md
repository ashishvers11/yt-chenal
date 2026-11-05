# ASH Creator Studio — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants

1. **Workspace Isolation (Multi-Tenant Privacy)**: Every creator workspace (`/workspaces/{workspaceId}`) and all creator-owned intelligence documents (`youtubeConnections`, `channelProfiles`, `videos`, `researchReports`, `contentIdeas`, `scripts`, `analyticsSnapshots`, `projects`) must strictly verify `ownerUid == request.auth.uid` and `request.auth.token.email_verified == true`.
2. **Admin Boundary (Zero Unrestricted Creator Snooping)**: Super Admin (`anishakumari136x@gmail.com` with `email_verified == true` or a document in `/admins/{uid}`) can manage `/users`, `/invitations`, `/usageRecords`, and `/auditLogs`, but cannot read another creator's private `/youtubeConnections`, `/scripts`, `/researchReports`, or `/analyticsSnapshots`.
3. **Anti-Update-Gap & Shadow Field Rejection**: Every `create` and `update` rule must invoke `isValid[Entity](incoming())` enforcing exact allowed keys (`hasOnly`), required keys (`hasAll`), string length bounds (`.size() <= MAX`), and immutable identity/creation fields (`ownerUid`, `workspaceId`, `createdAt`).
4. **Path Variable Hardening**: Every single-document operation (`get`, `create`, `update`, `delete`) must validate `isValidId(docId)` matching `^[a-zA-Z0-9_\-]+$` with `.size() <= 128`.
5. **Query Enforcer on `list`**: Every `allow list` rule evaluates `resource.data.ownerUid == request.auth.uid` (or `resource.data.uid == request.auth.uid` / `isAdmin()`) with zero `get()`/`exists()` calls inside `list` where avoidable.

## 2. The "Dirty Dozen" Payloads

1. **Payload 1 (Identity Spoofing on Workspace Create)**: Authenticated User A attempts to create `/workspaces/ws_1` with `ownerUid: "user_b_uid"`. -> `PERMISSION_DENIED`
2. **Payload 2 (Self-Assigned Super Admin Role)**: Authenticated User A attempts to create `/users/user_a_uid` with `role: "super_admin"` when their email is not the bootstrapped admin email. -> `PERMISSION_DENIED`
3. **Payload 3 (Unverified Admin Email Spoof)**: Attacker with `email: "anishakumari136x@gmail.com"` but `email_verified: false` attempts to read `/users/other_uid`. -> `PERMISSION_DENIED`
4. **Payload 4 (Shadow Field Injection on Script Update)**: Creator updates `/scripts/scr_1` adding `{ isFeatured: true }` not in the schema allowlist. -> `PERMISSION_DENIED`
5. **Payload 5 (Cross-Tenant Report Read)**: Creator A attempts `get` on `/researchReports/rep_owned_by_b`. -> `PERMISSION_DENIED`
6. **Payload 6 (Cross-Tenant List Scraping)**: Creator A executes an unfiltered `list` query on `/contentIdeas` without `where("ownerUid", "==", uid)`. -> `PERMISSION_DENIED`
7. **Payload 7 (ID Poisoning Attack)**: Attacker attempts to create `/projects/invalid$id!with*spaces` or a 500-char ID. -> `PERMISSION_DENIED`
8. **Payload 8 (Denial-of-Wallet String Overflow)**: Creator sends a 100,000-character string in `ContentIdea.title` (max 300). -> `PERMISSION_DENIED`
9. **Payload 9 (Immortal Field Mutation)**: Creator updates `/workspaces/ws_1` and modifies `ownerUid` or `createdAt`. -> `PERMISSION_DENIED`
10. **Payload 10 (Orphaned Child Creation)**: Creator attempts to create `/contentIdeas/idea_1` referencing a `workspaceId` that does not exist in `/workspaces/{workspaceId}` or is not owned by them. -> `PERMISSION_DENIED`
11. **Payload 11 (PII Blanket Read on `/users`)**: Authenticated User A attempts to `get` `/users/user_b_uid` to scrape email addresses. -> `PERMISSION_DENIED`
12. **Payload 12 (Value Poisoning on Update)**: Creator updates `ContentIdea.status` with an invalid enum `"hacked_status"` or number `999`. -> `PERMISSION_DENIED`
