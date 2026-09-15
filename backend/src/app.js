import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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
import { messageReactionsRouter } from './routes/message-reactions.routes.js';
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
app.use(cors({
    origin: (origin, cb) => {
        if (!origin || corsOrigin.includes(origin)) return cb(null, true);
        cb(new Error('Not allowed by CORS'));
    }
}));
app.use(express.json({ limit: '100kb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 5000 : 500 }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 1000, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, please try again later' } } });
app.use('/api/v1/auth', authLimiter);

    app.use((_request, response, next) => {
        response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        response.setHeader('Pragma', 'no-cache');
        response.setHeader('Expires', '0');
        next();
    });

    app.get('/', (_request, response) => response.redirect('/frontend/'));

    app.use(express.static(projectRoot));
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
    app.use('/api/v1/profile', profileRouter);
    app.use('/api/v1/staff', staffRouter);
    app.use('/api/v1/owner', ownerRouter);
app.use('/api/v1/messages', messageReactionsRouter);
app.use('/admin', adminRouter);
app.get('/api/v1/events', sseMiddleware);

if (process.env.NODE_ENV === 'test') {
    app.use('/api/v1/test', testHelperRouter);
}

app.use(notFoundHandler);
app.use(errorHandler);
