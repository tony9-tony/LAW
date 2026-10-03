import 'dotenv/config';
import crypto from 'node:crypto';

const requiredInProduction = ['DATABASE_URL', 'JWT_SECRET'];
if (process.env.NODE_ENV === 'production') {
    for (const name of requiredInProduction) {
        if (!process.env[name]) throw new Error(`${name} is required in production`);
    }
}

export const config = {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: jwtSecret(),
    corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    uploadDir: process.env.UPLOAD_DIR || 'uploads',
};

/* There is no fixed fallback secret: anyone who knew it could forge a login.
   Production refuses to start without JWT_SECRET (above). Elsewhere a random
   secret is made for this run only, so sign-ins end when the server restarts;
   set JWT_SECRET in .env to keep them. */
function jwtSecret() {
    const value = process.env.JWT_SECRET;
    if (value && value !== 'replace-with-a-long-random-secret') return value;
    if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set to a long random value in production');
    if (process.env.NODE_ENV !== 'test') console.warn('[config] JWT_SECRET is not set: using a random secret for this run. Sign-ins will end when the server restarts.');
    return crypto.randomBytes(48).toString('hex');
}
