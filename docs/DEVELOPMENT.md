# Development

Use clear names and keep modules small. Route handlers should validate input and delegate business work to services. Database queries should remain behind the database boundary. Do not add real firm claims, testimonials, credentials, or contact information until supplied and reviewed.

For a new feature, identify whether it belongs to the public website, client portal, SUBUI, API, service layer, or database. Add a migration for schema changes and update `docs/API.md` for contract changes. Run `npm test` before handing work over.

The current V1 foundation uses static HTML/CSS to minimize frontend JavaScript. A richer frontend framework can be introduced later without moving business logic out of the API.
