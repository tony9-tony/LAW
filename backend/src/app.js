import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
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
import { feedbackRouter, ownerFeedbackRouter } from './routes/feedback.routes.js';
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
import { verifiedUser } from './lib/session.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

const adminRouter = Router();
adminRouter.get('/', (_request, response) => response.redirect('/subui/login.html'));

export const app = express();
/* Visitors reaching the site through a tunnel or proxy on this computer all arrive
   from 127.0.0.1; trusting the forwarded address from a local proxy only lets the
   limits below count each visitor separately. TRUST_PROXY overrides it. */
app.set('trust proxy', trustProxySetting(process.env.TRUST_PROXY));
function trustProxySetting(value) {
    const text = String(value ?? '').trim();
    if (!text) return 'loopback';
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (/^\d+$/.test(text)) return Number(text);
    return text;
}
/* Pages, styles and scripts travel gzipped (about a fifth of the size). The
   live update stream is left alone so messages arrive at once. */
app.use(compression({ filter: (request, response) => request.path !== '/api/v1/events' && compression.filter(request, response) }));
/* The in-app document viewer shows a fetched file from a blob: URL (pictures in
   an <img>, PDFs in an <iframe>); everything else keeps helmet's defaults, except
   "upgrade-insecure-requests": it made browsers fetch every style, script and
   picture over https, so the site loaded blank and unusable when opened over plain
   http from another device (http://<this computer's address>:3000). The pages only
   use their own relative addresses, so there is nothing insecure to upgrade. */
app.use(helmet({
    referrerPolicy: { policy: 'same-origin' },
    contentSecurityPolicy: {
        directives: {
            'img-src': ["'self'", 'data:', 'blob:'],
            'frame-src': ["'self'", 'blob:'],
            'upgrade-insecure-requests': null,
        },
    },
}));
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
/* Only the API is limited: a page view loads a dozen pictures, styles and
   scripts, and counting those locked out ordinary visitors after a few pages.
   Each signed-in person has their own allowance; visitors who are not signed in
   are counted by address. (It used to be 500 per address for everyone: a few
   busy pages, or several people on one office connection or tunnel, used it up
   and every page stopped working for 15 minutes.) API_RATE_LIMIT changes it. */
const apiRateLimit = Number(process.env.API_RATE_LIMIT) || (process.env.NODE_ENV === 'test' ? 5000 : 3000);
app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: apiRateLimit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (request) => {
        const user = verifiedUser(request);
        return user && user.sub ? `user:${user.sub}` : `ip:${ipKeyGenerator(request.ip)}`;
    },
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Please wait a few minutes and try again.' } },
}));
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

    /* API answers carry private data: never stored. */
    app.use('/api', (_request, response, next) => {
        response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        response.setHeader('Pragma', 'no-cache');
        response.setHeader('Expires', '0');
        next();
    });
    /* Pages, styles and scripts are checked with the server on every visit
       (a quick "not modified" when unchanged), so updates show at once.
       Pictures and fonts rarely change and are kept for a week. */
    const staticOptions = {
        setHeaders(response, filePath) {
            const long = /\.(jpe?g|jfif|png|webp|avif|gif|svg|ico|woff2?)$/i.test(filePath);
            response.setHeader('Cache-Control', long ? 'public, max-age=604800' : 'no-cache');
        },
    };

    app.get('/', (_request, response) => response.redirect('/frontend/'));
/* Browsers ask for /favicon.ico on every page; without this it was a 404 in the console. */
app.get('/favicon.ico', (_request, response) => response.sendFile(path.join(projectRoot, 'favicon.ico')));

    
    app.use('/frontend', express.static(path.join(projectRoot, 'frontend'), staticOptions));
    app.use('/subui', express.static(path.join(projectRoot, 'subui'), staticOptions));
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
    app.use('/api/v1/owner/feedback', ownerFeedbackRouter);
app.use('/api/v1/owner', ownerRouter);
app.use('/api/v1/feedback', feedbackRouter);
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
