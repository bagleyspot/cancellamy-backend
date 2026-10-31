# Cancellamy API contract

Types: [api-types.ts](./api-types.ts) (source of truth for bodies). Base URL `/api/v1`, JSON.
Auth: `Authorization: Bearer <accessToken>`; the refresh token lives in the httpOnly cookie `cnc_rt`
(path `/api/v1/auth`, `SameSite=Lax`). Send requests with `credentials: 'include'`.
Dev: the Vite dev server proxies `/api` to `http://localhost:3000`.
Errors: `ApiError` (see types). Validation errors are 400 with `message: string[]`.
OpenAPI UI: `/api/docs`, JSON: `/api/docs-json`.

## Auth and account

| Method | Path | Auth | Body → Response |
|---|---|---|---|
| POST | /auth/register | - | RegisterRequest → 201 AuthResponse (+ cookie). Sends verification email. 409 `EMAIL_TAKEN` |
| POST | /auth/login | - | LoginRequest → AuthResponse (+ cookie). 401 `INVALID_CREDENTIALS` |
| POST | /auth/refresh | cookie | → `{ accessToken }` (rotates the cookie). 401 if missing/invalid |
| POST | /auth/logout | cookie | → 204, clears cookie |
| POST | /auth/verify-email | - | TokenRequest → 204. 400 `INVALID_TOKEN` |
| POST | /auth/resend-verification | yes | → 204 |
| POST | /auth/forgot-password | - | ForgotPasswordRequest → 204 always |
| POST | /auth/reset-password | - | ResetPasswordRequest → 204. 400 `INVALID_TOKEN`; revokes all sessions |
| GET | /me | yes | → UserDto |
| PATCH | /me | yes | UpdateMeRequest → UserDto |
| POST | /me/change-password | yes | ChangePasswordRequest → 204 |
| GET | /me/export | yes | → JSON file (all user data, decrypted), `Content-Disposition: attachment` |
| DELETE | /me | yes | DeleteAccountRequest → 204. Hard-deletes user, profiles, requests, messages |

## Profiles (family members)

| Method | Path | Body → Response |
|---|---|---|
| GET | /profiles | → ProfileDto[] |
| POST | /profiles | ProfileInput → 201 ProfileDto (409 `PROFILE_LIMIT_REACHED`; 403 `EMAIL_NOT_VERIFIED`) |
| GET | /profiles/:id | → ProfileDto |
| PATCH | /profiles/:id | Partial<ProfileInput> → ProfileDto |
| DELETE | /profiles/:id | → 204 (cancels queued requests, deletes the profile data) |
| GET | /profiles/:id/authorization/text | → AuthorizationTextDto |
| POST | /profiles/:id/authorization | SignAuthorizationRequest → 201 AuthorizationDto (status draft→ready) |
| GET | /profiles/:id/authorization/pdf | → application/pdf (the signed delega) |
| DELETE | /profiles/:id/authorization | → 204 (revokes, status→draft, queued requests cancelled) |
| POST | /profiles/:id/activate | → ActivateProfileResponse (needs status `ready`; 409 `PROFILE_NOT_READY`; 403 `EMAIL_NOT_VERIFIED`; includes `dailyEmailBatchSize` for BullMQ fair-share) |
| POST | /profiles/:id/pause | → ProfileDto |
| POST | /profiles/:id/resume | → ProfileDto |

Editing the profile after activation is allowed; it does not re-send past requests.

## Requests

| Method | Path | Body → Response |
|---|---|---|
| GET | /requests | ListRequestsQuery (query string) → Paginated<RequestListItem> |
| GET | /requests/summary?profileId= | → SummaryDto |
| GET | /requests/:id | → RequestDetail |
| POST | /requests/custom | CustomRequestInput → 201 RequestListItem (409 `CUSTOM_LIMIT_REACHED`) |
| POST | /requests/:id/mark-done | → RequestDetail. Manual action done by the user: status `action_required`→`sent`, dueAt = now+30d |
| POST | /requests/:id/outcome | OutcomeRequest → RequestDetail. Manual outcome decided by the user after reading a reply |
| POST | /requests/:id/provide-id | multipart `file` (pdf/jpg/png, ≤5MB) + optional `note` → RequestDetail. Forwarded by email to the broker, never stored; status→`sent` |
| POST | /requests/:id/reminder | → RequestDetail. Allowed when `canRemind` (sent/replied/overdue and ≥15 days since last outgoing mail) |
| POST | /requests/:id/escalate | → ComplaintDto. Allowed when `canEscalate` (overdue); status→`escalated` |
| GET | /requests/:id/complaint.pdf | → application/pdf |
| POST | /requests/:id/cancel | → RequestDetail (status→`cancelled`) |
| POST | /requests/:id/simulate-reply | SimulateReplyRequest → RequestDetail. ONLY in dry-run (403 `SIMULATION_DISABLED` otherwise) |

Status machine (backend-enforced, 409 `INVALID_STATE` otherwise):
`queued → sent → (replied | overdue | completed | refused | action_required)`,
`action_required → sent` (mark-done / provide-id), `overdue → escalated`, `completed → (renewal creates a NEW request, cycle+1)`.
Manual-channel requests are created directly in `action_required`.

## Brokers (public registry) and config

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | /config | - | PublicConfigDto |
| GET | /brokers?q=&category=&status=&sendable=&page=&limit= | - | Paginated<BrokerDto> |
| GET | /brokers/stats | - | BrokerStatsDto |
| GET | /brokers/:id | - | BrokerDto |

## Notifications and reports

| Method | Path | Response |
|---|---|---|
| GET | /notifications?unread=true&page=&limit= | Paginated<NotificationDto> |
| GET | /notifications/unread-count | `{ count: number }` |
| POST | /notifications/read | body `{ ids?: string[] }` (omit = all) → 204 |
| GET | /reports?profileId= | ReportDto[] (newest first) |
| POST | /reports/generate | body `{ profileId }` → ReportDto (current month) |

## Admin (role `admin`)

| Method | Path | Response |
|---|---|---|
| GET | /admin/stats | AdminStatsDto |
| GET | /admin/brokers?q=&category=&status=&page=&limit= | Paginated<BrokerDto> |
| PATCH | /admin/brokers/:id | AdminBrokerPatch → BrokerDto. `markets` (ISO country codes or `ALL` / `EU` / `EEA`) says where the broker operates: one without markets and headquarters is not contacted automatically; admin edits survive a reseed |
| POST | /admin/brokers/reseed | → `{ created, updated }` |
| GET | /admin/inbound-unmatched | UnmatchedInboundDto[] |
| POST | /admin/inbound-unmatched/:id/assign | `{ requestId }` → 204 |
| GET | /admin/outbox?page=&limit= | Paginated<OutboxItemDto> |

## Health (no prefix)

`GET /health` → `{ status: 'ok' }`; `GET /health/ready` → 200 `{ status: 'ok', mongo: 'up' }` or 503.

## UI → API mapping (what each screen needs)

- Landing: `/brokers/stats`, `/config`.
- Register / login / verify / reset: auth endpoints. After register show "check your email".
- Onboarding wizard: create profile (steps: personal data → contacts and addresses → authorization text + signature → confirm & activate). Needs verified email to create/activate.
- Dashboard: `/requests/summary`, `/requests?group=action_required`, recent activity; profile switcher when >1 profile.
- Requests list with tabs per group, filters, search, pagination; detail page with timeline, messages, and contextual actions (mark-done with prefilled text, provide-id upload, reminder, escalate → complaint draft, outcome buttons after a reply, cancel, simulate reply in dry-run).
- Custom removal form (`/requests/custom`).
- Profiles page (family), edit profile, authorization view/PDF/revoke, pause/resume.
- Brokers catalogue (public) with search and filters; broker detail dialog.
- Reports page; notification bell with unread count and a list.
- Settings: notification toggles, change password, export data, delete account.
- Admin: stats, broker table with sendEnabled toggle and status edit, unmatched inbound inbox, outbox.

---

# v2 additions

All new types are at the end of [api-types.ts](./api-types.ts). `GET /config` now returns `features` (FeatureFlags),
`leaderboardMinUsers` and `attachmentRetentionDays`: **the UI must hide every screen/section whose flag is false**.
Endpoints of a disabled feature answer `404` with `code: FEATURE_DISABLED`.

## 1 · Sender (send from the user's own mailbox)

| Method | Path | Body → Response |
|---|---|---|
| GET | /profiles/:id/sender | → SenderDto |
| PUT | /profiles/:id/sender | SetSenderRequest → SenderDto. With `mode: 'smtp'` the connection is tested first; 400 `SMTP_CONNECTION_FAILED` (message explains) or `SMTP_HOST_NOT_ALLOWED` (private/loopback hosts and ports other than 25/465/587/2525 are refused); `fromAddress` must be one of the profile emails |
| POST | /profiles/:id/sender/test | SmtpSettingsInput (optional; default = saved) → `{ ok: true }` or the same 400 errors. Connection test only, nothing is sent |
| DELETE | /profiles/:id/sender | → SenderDto (mode back to `cancellamy`) |

Emails then leave with `From` = the user's address, `Reply-To` = Cancellamy's alias. If the mailbox rejects the
credentials, `lastError` is set, the user is notified and the profile's queued requests wait until the sender is saved again.
`MessageDto.via` tells how each message was delivered.

## 2 · Evidence dossier

`GET /requests/:id/dossier.zip?timestamp=true|false` → `application/zip` (Bearer). Contents: cover PDF, delega PDF,
messages (txt + json), timeline, `manifest.json` (SHA-256 of every file), `manifest.sha256`, `LEGGIMI.txt` and, with
`timestamp=true` and `features.dossierTimestamp`, `manifest.tsr` (RFC 3161). Timestamp authority down → 502 `TIMESTAMP_UNAVAILABLE`.

## 3 · Identity and right of access

| Method | Path | Body → Response |
|---|---|---|
| GET | /profiles/:id/identity | → IdentityDto |
| POST | /profiles/:id/identity/send-code | SendCodeRequest → 204 (email code by mail, phone code by SMS; 429 `VERIFICATION_RATE_LIMITED`; phone needs `features.identityPhone`) |
| POST | /profiles/:id/identity/confirm | ConfirmCodeRequest → IdentityDto. 400 `VERIFICATION_CODE_INVALID` |
| POST | /requests/access | CreateAccessRequestsInput → 201 CreateAccessRequestsResponse. Needs an **active** profile with `identityVerified` (else 403 `IDENTITY_REQUIRED`) and `features.accessRequests` |
| PUT | /requests/:id/findings | AccessFindingsInput → RequestDetail (only `kind: 'access'`) |
| GET | /profiles/:id/data-map | → DataMapDto |
| GET | /requests/:id/messages/:messageId/attachments/:attachmentId | → file download (incoming files only, until `expiresAt`) |

Access requests are normal requests with `kind: 'access'` (same states; `completed` = the broker answered with data or
declared it holds none). They never auto-renew. `GET /requests` accepts `kind`.

## 4 · Breach check

| Method | Path | Response |
|---|---|---|
| GET | /profiles/:id/breaches | BreachSummaryDto (`enabled: false` when no API key) |
| POST | /profiles/:id/breaches/check | 202 `{ queued: number }`; at most once per hour per profile (429 otherwise) |

## 5 · Delisting

| Method | Path | Body → Response |
|---|---|---|
| GET | /delistings?profileId=&status=&page=&limit= | Paginated<DelistingDto> |
| POST | /delistings | DelistingInput → 201 DelistingDto (profile must be owned; max 100 per user) |
| GET | /delistings/:id | → DelistingDto |
| GET | /delistings/:id/guide | → DelistingGuideDto |
| PATCH | /delistings/:id | DelistingPatch → DelistingDto. Allowed transitions: to_submit→submitted, submitted→approved/partially_approved/denied, denied/partially_approved→appealed, appealed→approved/partially_approved/denied, any open→cancelled; else 409 `INVALID_STATE` |
| DELETE | /delistings/:id | → 204 |

## 6 · Leaderboard (public)

`GET /brokers/leaderboard?sort=responseRate&order=desc&category=` → LeaderboardDto. Only aggregates of brokers with at
least `minUsers` distinct users; simulations (dry-run) never count. Cached for 10 minutes.

## 7 · Telemarketing defence

| Method | Path | Body → Response |
|---|---|---|
| GET | /nuisance?profileId= | → NuisanceOverviewDto |
| POST | /nuisance | NuisanceReportInput → 201 NuisanceReportDto |
| DELETE | /nuisance/:id | → 204 |
| POST | /nuisance/complaint | NuisanceComplaintRequest → ComplaintDto (draft segnalazione al Garante) |
| GET | /nuisance/complaint.pdf?profileId= | → application/pdf |

A notification reminds the user 15 days after the RPO registration to check it and report unwanted contacts.

## UI → API mapping (v2)

- **Profile page:** "Mittente" card (GET/PUT/DELETE sender, test), "Identità" card (identity, send-code, confirm), "Violazioni" card (breaches, check; show the attribution and a link to haveibeenpwned.com), data-map link.
- **Request detail:** download dossier (checkbox "con marca temporale" only if `dossierTimestamp`), attachments download buttons on incoming messages, for `kind: 'access'` a findings form and a badge; `via` shown on each message.
- **/app/accesso ("Cosa sai di me"):** if identity not verified, explain and link to the profile identity card; otherwise broker picker (public catalogue, search, max 20) → POST /requests/access; below it the data map (table of brokers × found/not found, category chips and counts) with the findings form per request.
- **/app/deindicizzazione:** list + create form (profile, engine, URL, query, reason, explanation), detail with guide (steps, statement with copy button, link to the form), status buttons ("L'ho inviata", esito, ricorso).
- **/app/telemarketing:** RPO status card (link to its request), report form and list, top callers, button "Prepara la segnalazione al Garante" → text + steps + PDF.
- **/classifica (public):** leaderboard table with sorting and category filter, explanation of the privacy threshold; broker catalogue rows may link to it.
- Navigation entries and public links appear only when the matching feature flag is true.
