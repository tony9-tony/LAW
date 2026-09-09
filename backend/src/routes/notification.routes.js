import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { listForUser, markRead, markAllRead, unreadCount } from '../services/notification.service.js';

export const notificationRouter = Router();
notificationRouter.use(authenticate);

notificationRouter.get('/', async (request, response, next) => {
    try {
        const unreadOnly = request.query.unread === 'true';
        const items = await listForUser(request.user.sub, { unreadOnly });
        const count = await unreadCount(request.user.sub);
        response.json({ data: items, unread_count: count });
    } catch (error) { next(error); }
});

notificationRouter.post('/:id/read', async (request, response, next) => {
    try {
        const ok = await markRead(request.params.id, request.user.sub);
        if (!ok) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Notification not found' } });
        }
        response.json({ data: { id: request.params.id, read: true } });
    } catch (error) { next(error); }
});

notificationRouter.post('/read-all', async (request, response, next) => {
    try {
        const count = await markAllRead(request.user.sub);
        response.json({ data: { marked: count } });
    } catch (error) { next(error); }
});
