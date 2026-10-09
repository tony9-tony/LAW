# ET CETRA ADVOCATES — Legal Services Platform

The website, client portal and owner command centre for **ET CETRA ADVOCATES COMPANY LIMITED** (Emmanuel Richard Machibya, Advocate & Legal Counsel, Posta, Kisutu).

## Architecture

- `frontend/`: public website (Home, About, How it works, Legal insights, Contact, sign-in and sign-up) and the client portal (`frontend/portal/`: requests, matters, consultation, appointments, documents, invoices, payments, messages, notifications, profile).
- `subui/`: owner command centre (requests, matters, staff, billing, payment verification, messaging).
- `backend/`: Node.js API (Express, zod validation, JWT sessions, helmet, rate limits, SSE for live messages).
- `database/`: PostgreSQL migrations and the migration runner.
- `docs/`: architecture, data, API, security and development notes.
- `backend/tests/`: API tests (`node --test`); `e2e/`: browser tests (Playwright).

The browser surfaces talk to the API only, so a future mobile app can use the same API.

## Requirements

- Node.js 20 or newer, npm
- PostgreSQL 16

## Setup

```powershell
Copy-Item .env.example .env
npm install
npm run db:migrate
```

Edit `.env` before the first start:

- `DATABASE_URL`: your PostgreSQL connection. Use a real password, not `postgres/postgres`, outside your own computer.
- `JWT_SECRET`: a long random value. Make one with
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
  It is required in production; without it, a random secret is made for each run and everyone is signed out when the server restarts.
- AI Support (optional, on by default): the public chat answers open questions with a **Qwen model running on this computer through Ollama** (install Ollama and a Qwen model, e.g. `ollama pull qwen2.5:7b`). See the AI Support section below.

## AI Support (public chat)

- **What the model knows:** only `PUBLIC_FACTS` and the FAQ in `backend/src/data/support-knowledge.js`, plus the visitor's one question. It never gets the database, accounts, other clients, staff, amounts or settings, so there is nothing internal for it to reveal.
- **Order of answers:** refusals first (actions on accounts, and internal questions such as staff, clients, admin, database or "ignore your instructions" never reach the model); a clear FAQ match gets the verified answer at once; other English questions go to Qwen; if Qwen is off, busy or slow, the verified answer is used.
- **Every AI reply is checked:** phone numbers other than the firm's, e-mail addresses, links and money amounts are replaced before the visitor sees them; markdown and `<think>` text are removed.
- **Kiswahili:** answered from the verified Kiswahili answers. The installed `qwen2.5-coder` writes poor Kiswahili; with a better model set `SUPPORT_AI_SWAHILI=1`.
- **Speed:** on a computer without a graphics card an answer takes about 10–35 s; the model is loaded when the server starts so the first visitor does not wait for it. Settings: `SUPPORT_AI=0` (off), `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS`; `QWEN_API_KEY` uses cloud Qwen instead (questions then leave the computer).
- Tests: `backend/tests/support-ai.test.js` (a fake Ollama server checks the prompt and the cleaning).

Never commit `.env`.

## Run

```powershell
npm run dev
```

Open http://localhost:3000 — the website is at `/frontend/`, the owner command centre at `/subui/` (or `/admin`). The API is at `/api/v1`; its health check is `GET /api/v1/health`.

The first owner account is created once from the command centre's setup screen (`/auth/setup-owner`). After that, the owner adds clients and other owners under **Users & passwords**; public sign-up always creates a **client**.

## Who uses what

- **Client**: the public website and the client portal (`/frontend/portal/`). The portal's Dashboard and the public **How it works** page show the steps from request to service.
- **Owner** (the advocate / administrator): the Owner Command Center (`/subui/`). Its Dashboard shows the owner's steps: review the request, set the payment, verify the receipt, run the matter.
- **Lawyer / Staff** roles exist in the database and API, but have no browser workspace yet; signing in with one shows a clear message instead of an empty client portal.

## Forgotten passwords

The system sends no e-mail. A client who forgot their password contacts the firm (the *Forgot password?* page explains this). The owner opens **Users & passwords**, presses **Set temporary password** and gives it to the client directly (`POST /api/v1/owner/users/:id/password`, audited as `PASSWORD_SET_BY_OWNER`). The client signs in and chooses their own under **Profile, Change password** (`POST /api/v1/profile/password`, needs the current password).

## Security

- **Sessions:** at sign-in the server puts the token in an httpOnly, SameSite=Lax cookie (`law_session`, Secure in production). Page scripts never hold it, so an injected script cannot steal it. API clients may still send `Authorization: Bearer <token>`. Signing out calls `POST /api/v1/auth/logout`, which removes the cookie.
- **Sign-up:** `POST /auth/register` ignores any `role` it is sent and always creates a CLIENT.
- **Password guessing:** at most 10 failed sign-ins per 15 minutes for one e-mail from one address (`LOGIN_ATTEMPT_LIMIT` to change it); successful sign-ins do not count.
- **CORS:** pages served by this server may always call the API; `CORS_ORIGIN` lists any other site allowed to.
- **Test helpers** (`/api/v1/test/...`, which create users of any role) exist only when `NODE_ENV=test`.

See [docs/SECURITY.md](docs/SECURITY.md) for more.

## Test

```powershell
npm test
```

Runs the API tests against the database in `DATABASE_URL` (use a test database, never the live one: set `DATABASE_URL` to a separate database such as `law_test` for that window, then `npm run db:migrate` and `npm test`). The browser tests need the server running with `NODE_ENV=test` (they create users through the test helpers):

```powershell
$env:NODE_ENV="test"; npm run dev      # in one window
npx playwright test                      # in another
```

## Development workflow

1. Confirm the requirement and its owning boundary.
2. Update the relevant API, migration or frontend module.
3. Update documentation when a contract changes.
4. Run `npm test` and the relevant browser check.
5. Keep secrets in environment variables and private data out of public routes.

Old one-off scripts, page backups and database dumps live in `_archive/` (not in Git). See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for conventions.
