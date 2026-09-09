# API reference

Base URL: `/api/v1`. All authenticated endpoints expect `Authorization: Bearer <jwt>`.
The JWT carries `{ sub: <user-id-uuid>, role: 'CLIENT'|'LAWYER'|'STAFF', email }` and is signed with `JWT_SECRET` (1 hour expiry).

## Domain model

```text
USER (clients + internal staff)
 │
 ├── REQUEST          (client inquiry — does NOT auto-create a matter)
 │      │
 │      └── REVIEW (SUBUI/staff)
 │              │
 │              ├── ACCEPTED  → creates MATTER (one-to-one)
 │              └── DECLINED
 │
 ├── MATTER / CASE    (formal engagement, opened by staff)
 │      │
 │      ├── APPOINTMENTS
 │      ├── DOCUMENTS
 │      ├── CONVERSATION → MESSAGES
 │      └── EVENTS  (timeline)
 │
 └── NOTIFICATIONS   (in-app, transport-agnostic — REST today, WebSockets later)
```

A client can never read another client's data: every client route derives the user from the JWT and verifies ownership server-side.

## Endpoints

### Public
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/health` | — | `{ data: { status: 'ok' } }` |
| POST | `/auth/register` | `{ email, password, fullName }` | password ≥ 12 chars. Returns user (no auto-login). |
| POST | `/auth/login` | `{ email, password }` | Returns `{ data: { token, user } }` |

### Authenticated — client
| Method | Path | Returns |
|---|---|---|
| GET | `/profile` | The authenticated user's own account |
| GET | `/requests` | List of the client's requests |
| POST | `/requests` | Create a new request |
| GET | `/requests/:id` | Single request (ownership-checked); includes `originating_matter` if accepted |
| GET | `/requests/:id/events` | Timeline events for a single request |
| GET | `/matters` | List the client's matters |
| GET | `/matters/:id` | Single matter (ownership-checked) |
| GET | `/matters/:id/events` | Matter timeline |
| GET | `/matters/:id/documents` | Documents for the matter |
| GET | `/matters/:id/appointments` | Appointments for the matter |
| GET | `/matters/:id/conversation` | The matter's 1:1 conversation (auto-created on first read) |
| GET | `/conversations` | List the client's conversations (supports `?limit=` and `?offset=`) |
| GET | `/conversations/:id` | Conversation + paginated messages (`?limit=`, `?before=`, `?after=`) |
| POST | `/conversations/:id/messages` | `{ body }` — sends a message as the authenticated client |
| POST | `/conversations/:id/read` | Marks all incoming messages as read |
| GET | `/appointments` | All of the client's appointments |
| GET | `/notifications` | All notifications (or `?unread=true`); includes `unread_count` |
| POST | `/notifications/:id/read` | Mark one as read |
| POST | `/notifications/read-all` | Mark every unread notification as read |
| GET | `/documents` | All documents across the client's matters |
| GET | `/documents/:id/download` | Ownership-checked. Returns 501 `STORAGE_NOT_CONFIGURED` until storage backend is wired. |

### Owner
| Method | Path | Returns |
|---|---|---|
| GET | `/owner/conversations` | List all conversations with client, matter, last message, and unread count |
| GET | `/owner/conversations/:id` | Conversation detail with paginated messages (`?limit=`, `?before=`, `?after=`) |
| POST | `/owner/conversations/:id/messages` | `{ body }` — sends a message as the authenticated owner |
| POST | `/owner/conversations/:id/read` | Marks all messages in the conversation as read |
| GET | `/owner/messages` | Overview of all conversations (last message, client, read status, unread count) |

### Staff (`LAWYER` or `STAFF` role)
| Method | Path | Notes |
|---|---|---|
| GET | `/staff/requests` | All requests across all clients |
| POST | `/staff/requests/:id/accept` | `{ title, matterType?, description? }` — creates a matter and emits timeline + notification |
| POST | `/staff/requests/:id/decline` | `{ reason? }` — emits timeline + notification |
| POST | `/staff/requests/:id/status` | `{ status: 'UNDER_REVIEW' \| 'ACTION_REQUIRED' \| 'SCHEDULED' \| 'COMPLETED' \| 'CLOSED', note? }` |

## Error format

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request input is invalid" } }
```

Common codes: `UNAUTHENTICATED`, `INVALID_TOKEN`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATUS`, `MATTER_EXISTS`, `ALREADY_RESOLVED`, `REFERENCE_GENERATION_FAILED`, `STORAGE_NOT_CONFIGURED`, `INTERNAL_ERROR`.

## Migrations

| File | Purpose |
|---|---|
| `001_initial.sql` | Schema foundation: `users`, `requests`, `matters`, `appointments`, `conversations`, `messages`, `documents`, `audit_logs`, plus `user_role` / `request_status` enums. |
| `002_portal_domain.sql` | Additive portal columns + `notifications`, `request_events`, `matter_events` tables. |
| `003_integrity.sql` | `UNIQUE (matter_id)` on `conversations` to prevent duplicate-conversation races. |
