# Legal Services Platform

V1 foundation for a premium legal services platform. The firm name is intentionally represented by `[Law Firm Name]` until confirmed.

## Architecture

- `frontend/`: static public website and portal entry pages.
- `backend/`: Node.js API with Express, validation, auth middleware, and services.
- `subui/`: separate internal interface shell for lawyer/staff workflows.
- `database/`: PostgreSQL migrations and migration runner.
- `docs/`: architecture, data, API, security, and development notes.
- `backend/tests/`: API smoke tests.

The browser surfaces communicate with the backend API. Business rules and database access remain server-side so a future mobile client can use the same API.

## Requirements

- Node.js 20 or newer
- npm
- PostgreSQL 16 instance

## Setup

```powershell
Copy-Item .env.example .env
npm install
```

Ensure PostgreSQL is running at localhost:5432 with a database named "legal_platform" and user "postgres" with password "postgres".

```powershell
npm run db:migrate
```

Review `.env` before starting. Never commit it.

## Run

```powershell
npm run dev
```

Open `frontend/index.html` for the public website or `subui/index.html` for the internal shell. The root `index.html` links to the public website.

The API is available at `http://localhost:3000/api/v1`. Its health check is `GET /api/v1/health`.

## Test

```powershell
npm test
```

Tests currently cover API availability and the protected request route. Database-backed auth and request workflow tests require PostgreSQL and will be expanded with the implementation.

## Development workflow

1. Confirm the requirement and its owning boundary.
2. Update the relevant API, migration, or frontend module.
3. Update documentation when a contract changes.
4. Run `npm test` and the relevant manual smoke check.
5. Keep secrets in environment variables and avoid placing private data in public routes.

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for conventions and [docs/SECURITY.md](docs/SECURITY.md) for security responsibilities.
