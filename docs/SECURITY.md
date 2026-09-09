# Security

The foundation includes Helmet, restricted CORS, request rate limiting, JSON body limits, Zod server-side validation, bcrypt password hashing, JWT authentication, role middleware, parameterized SQL, and a production check for required secrets.

Passwords are never stored directly. Database credentials and JWT secrets belong in `.env`, which is ignored by Git. Error responses avoid exposing internal details; server logs should be reviewed before adding more context.

Before production: replace the development JWT secret, configure the real allowed origins, add HTTPS termination, add refresh/revocation strategy, add upload scanning and private object storage, and complete audit coverage for sensitive staff actions.
