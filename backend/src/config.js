import 'dotenv/config';

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
    jwtSecret: process.env.JWT_SECRET ?? 'development-only-secret',
    corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    uploadDir: process.env.UPLOAD_DIR || 'uploads',
};
