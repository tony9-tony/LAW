# Database

PostgreSQL 16 is the system of record. Run the local database with Docker Compose and apply migrations with `npm run db:migrate`.

The initial migration creates users, requests, appointments, matters, conversations, messages, documents, and audit logs. A registration creates a user; a request is an inquiry; a matter is created separately when the firm accepts the work. These concepts are not conflated.

Requests use an extensible status enum: `SUBMITTED`, `UNDER_REVIEW`, `ACTION_REQUIRED`, `ACCEPTED`, `SCHEDULED`, `COMPLETED`, `DECLINED`, and `CLOSED`.

Migrations are tracked in `schema_migrations` and run in filename order. Do not edit an applied migration; create a new one.
