import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from './config.js';
import { healthRouter } from './routes/health.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { requestRouter } from './routes/request.routes.js';
import { matterRouter } from './routes/matter.routes.js';
import { appointmentRouter } from './routes/appointment.routes.js';
import { notificationRouter } from './routes/notification.routes.js';
import { conversationRouter } from './routes/conversation.routes.js';
import { documentRouter } from './routes/document.routes.js';
import { profileRouter } from './routes/profile.routes.js';
import { staffRouter } from './routes/staff.routes.js';
import { ownerRouter } from './routes/owner.routes.js';
import { invoiceRouter } from './routes/invoice.routes.js';
import { ownerInvoiceRouter } from './routes/owner-invoice.routes.js';
import { paymentRouter } from './routes/payment.routes.js';
import { supportRouter } from './routes/support.routes.js';
import { uploadsRouter } from './routes/uploads.routes.js';
import { messageReactionsRouter } from './routes/message-reactions.routes.js';
import { messageActionsRouter } from './routes/message-actions.routes.js';
import { testHelperRouter } from './routes/test-helper.routes.js';
import { Router } from 'express';
import { notFoundHandler, errorHandler } from './middleware/errors.js';
import { sseMiddleware } from './services/sse.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

const adminRouter = Router();
adminRouter.get('/', (_request, response) => response.redirect('/subui/login.html'));

export const app = express();
app.use(helmet());
const corsOrigin = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
/* The site, the portal and the API are served by this same server, so a
   browser calling the API from its own pages (same host) is always allowed,
   on localhost, a LAN address or a tunnel. CORS_ORIGIN lists any OTHER sites
   allowed to call it. */
const sameOrigin = (origin, request) => {
    try { return new URL(origin).host === request.get('host'); } catch { return false; }
};
app.use(cors((request, cb) => {
    const origin = request.get('origin');
    if (!origin || corsOrigin.includes(origin) || sameOrigin(origin, request)) return cb(null, { origin: true, credentials: true });
    const error = new Error('Not allowed by CORS');
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    return cb(error);
}));
/* Rate limiting runs before body parsing so oversized upload payloads are
   still throttled instead of being buffered unchecked. */
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 5000 : 500 }));
/* Upload endpoints receive base64 data URLs inside JSON, so those prefixes
   need a body limit that covers the service-level file limits
   (QR code 10 MB, payment receipt 5 MB) plus base64/JSON overhead.
   Everything else keeps the strict 100kb default below — that global limit
   is what used to reject a normal-sized QR image with "request entity too
   large" before the QR file validation ever ran. */
app.use('/api/v1/owner/payment-destinations', express.json({ limit: '16mb' }));
app.use('/api/v1/payments', express.json({ limit: '8mb' }));
app.use(express.json({ limit: '100kb' }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 1000, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, please try again later' } } });
app.use('/api/v1/auth', authLimiter);
// Password guessing: at most 10 failed sign-ins per 15 minutes from one address
// for one e-mail. Successful sign-ins do not count.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.LOGIN_ATTEMPT_LIMIT) || (process.env.NODE_ENV === 'test' ? 1000 : 10),
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (request) => `${ipKeyGenerator(request.ip)}|${String(request.body?.email || '').toLowerCase().slice(0, 200)}`,
    message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many failed sign-in attempts. Please wait 15 minutes and try again.' } },
});
app.use('/api/v1/auth/login', loginLimiter);

    app.use((_request, response, next) => {
        response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        response.setHeader('Pragma', 'no-cache');
        response.setHeader('Expires', '0');
        next();
    });

    app.get('/', (_request, response) => response.redirect('/frontend/'));

    
    app.use('/frontend', express.static(path.join(projectRoot, 'frontend')));
    app.use('/subui', express.static(path.join(projectRoot, 'subui')));
    app.use('/subui', (request, response, next) => {
        if ((request.method === 'GET' || request.method === 'HEAD') && !path.extname(request.path)) {
            return response.sendFile(path.join(projectRoot, 'subui', 'index.html'));
        }
        next();
    });

app.use('/api/v1/health', healthRouter);
    app.use('/api/v1/auth', authRouter);
    app.use('/api/v1/requests', requestRouter);
    app.use('/api/v1/matters', matterRouter);
    app.use('/api/v1/appointments', appointmentRouter);
    app.use('/api/v1/notifications', notificationRouter);
    app.use('/api/v1/conversations', conversationRouter);
    app.use('/api/v1/documents', documentRouter);
    app.use('/api/v1/invoices', invoiceRouter);
    app.use('/api/v1/owner/invoices', ownerInvoiceRouter);
app.use('/api/v1/payments', paymentRouter);
app.use('/api/v1/uploads', uploadsRouter);
    app.use('/api/v1/profile', profileRouter);
    app.use('/api/v1/staff', staffRouter);
    app.use('/api/v1/owner', ownerRouter);
app.use('/api/v1/messages', messageActionsRouter);
app.use('/api/v1/messages', messageReactionsRouter);
app.use('/api/v1/support', supportRouter);
app.use('/admin', adminRouter);
app.get('/api/v1/events', sseMiddleware);

if (process.env.NODE_ENV === 'test') {
    app.use('/api/v1/test', testHelperRouter);
}

app.use(notFoundHandler);
app.use(errorHandler);
