# Architecture

Two front-ends, one backend, one database.

```text
                    POSTGRESQL
                         │
                    BACKEND API
                    /         \
                   /           \
          CLIENT PORTAL       SUBUI
          (customers)         (internal staff)
```

The backend is the only thing that talks to PostgreSQL. The two front-ends never share code, never share session, never share database connections. They speak only to the documented HTTP API.

## Authentication & authorization

- JWT (1 hour, HS256). `JWT_SECRET` must be set in production.
- The middleware `authenticate` parses the bearer token, verifies it, and attaches `{ sub, role, email }` to `request.user`.
- For staff routes, `requireRole('LAWYER','STAFF')` enforces a role check after authentication.
- Every client-facing route additionally uses `ensureOwned(table, id, userId)` to verify the resource belongs to the authenticated user before returning it.
- Profile endpoints ignore any user-supplied id — identity is derived from the JWT.
- The DB pool has `max: 10` connections; queries use parameterised SQL throughout.
- Rate limiting: 100 req / 15 min per IP via `express-rate-limit`.
- Helmet is enabled; CORS is restricted to `CORS_ORIGIN`.

## Real-time

The notification and message models are transport-agnostic. Today they are delivered via REST polling. When a real-time transport (WebSockets) is added, the model does not need to change — only the delivery layer.

## File storage

Document metadata is recorded in the `documents` table. `GET /documents/:id/download` enforces ownership and returns `501 STORAGE_NOT_CONFIGURED` until a storage backend is wired. Documents never live at predictable public URLs.
