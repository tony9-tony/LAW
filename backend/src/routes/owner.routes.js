/* Owner routes — for the Machibya SUB UI / Owner Command Center.
   Guarded by requireRole('OWNER') so CLIENT, LAWYER, and STAFF cannot reach these endpoints. */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { query } from '../db.js';
import { notify } from '../services/notification.service.js';
import { acceptRequest, declineRequest, updateRequestStatus, requestMoreInfo, processClientResponse, updateMatterStatus, addInternalNote, scheduleAppointment, rescheduleAppointment, changeAppointmentStatus, recordMatterEvent } from '../services/workflow.service.js';

export const ownerRouter = Router();
ownerRouter.use(authenticate, requireRole('OWNER'));

/* --- Users --- */
/* GET /api/v1/owner/users?search=&role=&status=&sort=&page=&limit= */
ownerRouter.get('/users', async (request, response, next) => {
    try {
        const q = z.object({
            search: z.string().optional(),
            role: z.enum(['CLIENT', 'LAWYER', 'STAFF', 'OWNER']).optional(),
            status: z.enum(['active', 'inactive']).optional(),
            sort: z.enum(['created_at', 'email', 'full_name']).optional().default('created_at'),
            page: z.coerce.number().min(1).default(1),
            limit: z.coerce.number().min(1).max(200).default(50),
        }).parse(request.query);

        const offset = (q.page - 1) * q.limit;
        const conditions = [];
        const params = [];
        let i = 1;

        if (q.search) {
            conditions.push(`(u.email ILIKE $${i} OR u.full_name ILIKE $${i})`);
            params.push('%' + q.search + '%');
            i++;
        }
        if (q.role) {
            conditions.push(`u.role = $${i}::user_role`);
            params.push(q.role);
            i++;
        }
        if (q.status) {
            conditions.push(`u.is_active = $${i}`);
            params.push(q.status === 'active');
            i++;
        }

        const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const sortDir = request.query.dir === 'asc' ? 'ASC' : 'DESC';

        const result = await query(
            `SELECT u.id, u.email, u.full_name, u.role, u.is_active,
                    u.created_at, u.updated_at,
                    (l.last_login_at) AS last_login_at
             FROM users u
             LEFT JOIN (
                 SELECT DISTINCT ON (actor_id) actor_id, created_at AS last_login_at
                 FROM audit_logs
                 WHERE action = 'LOGIN'
                 ORDER BY actor_id, created_at DESC
             ) l ON l.actor_id = u.id
             ${whereClause}
             ORDER BY u.${q.sort} ${sortDir}
             LIMIT $${i} OFFSET $${i + 1}`,
            [...params, q.limit, offset]
        );

        const countResult = await query(
            `SELECT COUNT(*)::int AS total FROM users u ${whereClause}`,
            params
        );

        const totalItems = countResult.rows[0].total;
        const totalPages = Math.ceil(totalItems / q.limit);

        response.json({
            data: result.rows,
            meta: {
                total: totalItems,
                page: q.page,
                limit: q.limit,
                totalPages,
                hasNext: q.page < totalPages,
                hasPrev: q.page > 1,
            }
        });
    } catch (error) {
        next(error);
    }
});

/* GET /api/v1/owner/users/:id */
ownerRouter.get('/users/:id', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.created_at, u.updated_at
             FROM users u WHERE u.id = $1 LIMIT 1`,
            [request.params.id]
        );
        if (result.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
        }
        response.json({ data: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

/* GET /api/v1/owner/owners */
ownerRouter.get('/owners', async (_request, response, next) => {
    try {
        const result = await query(
            `SELECT u.id, u.email, u.full_name, u.is_active, u.created_at, u.updated_at,
                    (l.last_login_at) AS last_login_at
             FROM users u
             LEFT JOIN (
                 SELECT DISTINCT ON (actor_id) actor_id, created_at AS last_login_at
                 FROM audit_logs
                 WHERE action = 'LOGIN'
                 ORDER BY actor_id, created_at DESC
             ) l ON l.actor_id = u.id
             WHERE u.role = 'OWNER'
             ORDER BY u.created_at DESC`
        );
        response.json({ data: result.rows });
    } catch (error) {
        next(error);
    }
});

/* POST /api/v1/owner/owners */
const createOwnerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(12),
    fullName: z.string().trim().min(2).max(160),
});
ownerRouter.post('/owners', async (request, response, next) => {
    try {
        const input = createOwnerSchema.parse(request.body);
        const { registerUser } = await import('../services/auth.service.js');
        const user = await registerUser({ ...input, role: 'OWNER' });
        response.status(201).json({ data: user });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/users */
const createUserSchema = z.object({
    email: z.string().email(),
    password: z.string().min(12),
    fullName: z.string().trim().min(2).max(160),
    role: z.enum(['CLIENT', 'LAWYER', 'STAFF', 'OWNER']),
});
ownerRouter.post('/users', async (request, response, next) => {
    try {
        const input = createUserSchema.parse(request.body);
        const { registerUser } = await import('../services/auth.service.js');
        const user = await registerUser(input);
        response.status(201).json({ data: user });
    } catch (error) { next(error); }
});

/* PATCH /api/v1/owner/users/:id - update role, status, name */
const updateUserSchema = z.object({
    fullName: z.string().trim().min(2).max(160).optional(),
    role: z.enum(['CLIENT', 'LAWYER', 'STAFF', 'OWNER']).optional(),
    isActive: z.boolean().optional(),
});

ownerRouter.patch('/users/:id', async (request, response, next) => {
    try {
        const input = updateUserSchema.parse(request.body);
        const updates = [];
        const params = [];
        let i = 1;

        if (input.fullName !== undefined) {
            updates.push(`full_name = $${i}`);
            params.push(input.fullName);
            i++;
        }
        if (input.role !== undefined) {
            updates.push(`role = $${i}::user_role`);
            params.push(input.role);
            i++;
        }
        if (input.isActive !== undefined) {
            updates.push(`is_active = $${i}`);
            params.push(input.isActive);
            i++;
        }
        if (updates.length === 0) {
            return response.status(400).json({ error: { code: 'BAD_REQUEST', message: 'No fields to update' } });
        }

        const result = await query(
            `UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
             WHERE id = $${i}
             RETURNING id, email, full_name, role, is_active, created_at, updated_at`,
            [...params, request.params.id]
        );
        if (result.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
        }
        response.json({ data: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

/* --- Analytics --- */
/* GET /api/v1/owner/analytics */
ownerRouter.get('/analytics', async (request, response, next) => {
    try {
        const [userCount, clientCount, lawyerCount, staffCount,
               openRequests, totalMatters, activeMatters,
               upcomingAppointments, unreadNotifications] = await Promise.all([
            query('SELECT COUNT(*)::int AS count FROM users'),
            query(`SELECT COUNT(*)::int AS count FROM users WHERE role = 'CLIENT'`),
            query(`SELECT COUNT(*)::int AS count FROM users WHERE role = 'LAWYER' AND is_active = TRUE`),
            query(`SELECT COUNT(*)::int AS count FROM users WHERE role = 'STAFF' AND is_active = TRUE`),
            query(`SELECT COUNT(*)::int AS count FROM requests WHERE status NOT IN ('COMPLETED', 'DECLINED', 'CLOSED')`),
            query('SELECT COUNT(*)::int AS count FROM matters'),
            query(`SELECT COUNT(*)::int AS count FROM matters WHERE status = 'OPEN'`),
            query(`SELECT COUNT(*)::int AS count FROM appointments WHERE starts_at > NOW() AND status NOT IN ('CANCELLED', 'COMPLETED')`),
            query(`SELECT COUNT(*)::int AS count FROM notifications WHERE read_at IS NULL`),
        ]);

        const statusDistribution = await query(
            `SELECT status, COUNT(*)::int AS count FROM requests GROUP BY status ORDER BY status`
        );

        const matterStatusDistribution = await query(
            `SELECT status, COUNT(*)::int AS count FROM matters GROUP BY status ORDER BY status`
        );

        response.json({
            data: {
                users: {
                    total: userCount.rows[0].count,
                    clients: clientCount.rows[0].count,
                    lawyers: lawyerCount.rows[0].count,
                    staff: staffCount.rows[0].count,
                },
                requests: {
                    open: openRequests.rows[0].count,
                    statusDistribution: statusDistribution.rows,
                },
                matters: {
                    total: totalMatters.rows[0].count,
                    active: activeMatters.rows[0].count,
                    statusDistribution: matterStatusDistribution.rows,
                },
                appointments: {
                    upcoming: upcomingAppointments.rows[0].count,
                },
                notifications: {
                    unread: unreadNotifications.rows[0].count,
                },
            }
        });
    } catch (error) {
        next(error);
    }
});

/* --- Audit Logs --- */
/* GET /api/v1/owner/audit-logs?search=&event_type=&actor_id=&page=&limit= */
ownerRouter.get('/audit-logs', async (request, response, next) => {
    try {
        const q = z.object({
            search: z.string().optional(),
            action: z.string().optional(),
            actor_id: z.string().uuid().optional(),
            entity_type: z.string().optional(),
            page: z.coerce.number().min(1).default(1),
            limit: z.coerce.number().min(1).max(200).default(50),
        }).safeParse(request.query);

        if (!q.success) {
            return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters' } });
        }
        const parsed = q.data;
        const offset = (parsed.page - 1) * parsed.limit;
        const conditions = [];
        const params = [];
        let i = 1;

        if (parsed.search) {
            conditions.push(`(action ILIKE $${i} OR entity_type ILIKE $${i} OR metadata::text ILIKE $${i})`);
            params.push('%' + parsed.search + '%');
            i++;
        }
        if (parsed.action) {
            conditions.push(`action = $${i}`);
            params.push(parsed.action);
            i++;
        }
        if (parsed.actor_id) {
            conditions.push(`actor_id = $${i}`);
            params.push(parsed.actor_id);
            i++;
        }
        if (parsed.entity_type) {
            conditions.push(`entity_type = $${i}`);
            params.push(parsed.entity_type);
            i++;
        }

        const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

        const result = await query(
            `SELECT al.id, al.actor_id, al.action, al.entity_type, al.entity_id,
                    al.metadata, al.created_at,
                    u.email AS actor_email, u.full_name AS actor_name
             FROM audit_logs al
             LEFT JOIN users u ON u.id = al.actor_id
             ${whereClause}
             ORDER BY al.created_at DESC
             LIMIT $${i} OFFSET $${i + 1}`,
            [...params, parsed.limit, offset]
        );

        const countResult = await query(
            `SELECT COUNT(*)::int AS total FROM audit_logs ${whereClause}`,
            params
        );

        response.json({
            data: result.rows,
            meta: {
                total: countResult.rows[0].total,
                page: parsed.page,
                limit: parsed.limit,
                totalPages: Math.ceil(countResult.rows[0].total / parsed.limit),
            }
        });
    } catch (error) {
        next(error);
    }
});

/* --- Security Events --- */
/* GET /api/v1/owner/security-events */
ownerRouter.get('/security-events', async (request, response, next) => {
    try {
        const q = z.object({
            event_type: z.string().optional(),
            severity: z.enum(['info', 'warning', 'error', 'critical']).optional(),
            page: z.coerce.number().min(1).default(1),
            limit: z.coerce.number().min(1).max(200).default(50),
        }).safeParse(request.query);

        if (!q.success) {
            return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters' } });
        }
        const parsed = q.data;

        const conditions = [];
        const params = [];
        let i = 1;
        if (parsed.event_type) {
            conditions.push(`event_type = $${i}`);
            params.push(parsed.event_type);
            i++;
        }
        if (parsed.severity) {
            conditions.push(`severity = $${i}`);
            params.push(parsed.severity);
            i++;
        }
        const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const offset = (parsed.page - 1) * parsed.limit;

        const result = await query(
            `SELECT se.id, se.actor_id, se.event_type, se.target_user_id,
                    se.ip_address, se.user_agent, se.metadata, se.severity, se.created_at,
                    u.email AS actor_email, tu.email AS target_email
             FROM security_events se
             LEFT JOIN users u ON u.id = se.actor_id
             LEFT JOIN users tu ON tu.id = se.target_user_id
             ${whereClause}
             ORDER BY se.created_at DESC
             LIMIT $${i} OFFSET $${i + 1}`,
            [...params, parsed.limit, offset]
        );

        const countResult = await query(
            `SELECT COUNT(*)::int AS total FROM security_events ${whereClause}`,
            params
        );

        response.json({
            data: result.rows,
            meta: {
                total: countResult.rows[0].total,
                page: parsed.page,
                limit: parsed.limit,
                totalPages: Math.ceil(countResult.rows[0].total / parsed.limit),
            }
        });
    } catch (error) {
        next(error);
    }
});

/* --- Permissions --- */
/* GET /api/v1/owner/permissions */
ownerRouter.get('/permissions', async (_request, response, next) => {
    try {
        const result = await query(
            `SELECT p.id, p.code, p.description, p.category,
                    rp.role AS granted_to
             FROM permissions p
             LEFT JOIN role_permissions rp ON rp.permission_id = p.id
             ORDER BY p.category, p.code`
        );
        const grouped = {};
        result.rows.forEach((row) => {
            if (!grouped[row.category]) grouped[row.category] = [];
            grouped[row.category].push({
                id: row.id,
                code: row.code,
                description: row.description,
                grantedTo: row.granted_to,
            });
        });
        response.json({ data: grouped });
    } catch (error) {
        next(error);
    }
});

/* --- Settings --- */
/* GET /api/v1/owner/settings */
ownerRouter.get('/settings', async (_request, response, next) => {
    try {
        const result = await query(
            `SELECT key, value, description, category, updated_by, updated_at
             FROM system_settings ORDER BY category, key`
        );
        response.json({ data: result.rows });
    } catch (error) {
        next(error);
    }
});

/* PATCH /api/v1/owner/settings/:key */
const updateSettingSchema = z.object({
    value: z.any(),
});

ownerRouter.patch('/settings/:key', async (request, response, next) => {
    try {
        const input = updateSettingSchema.parse(request.body);
        const result = await query(
            `UPDATE system_settings SET value = $1, updated_by = $2, updated_at = NOW()
             WHERE key = $3
             RETURNING key, value, description, category, updated_at`,
            [JSON.stringify(input.value), request.user.sub, request.params.key]
        );
        if (result.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Setting not found' } });
        }
        response.json({ data: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

/* --- Requests overview (enhanced) --- */
/* See bottom of file for the enhanced GET /api/v1/owner/requests with search/filter/sort — */
/* GET /api/v1/owner/requests/:id — full request detail for OWNER with related data */
ownerRouter.get('/requests/:id', async (request, response, next) => {
    try {
        const row = await query(
            `SELECT r.id, r.subject, r.description, r.status, r.client_id,
                    r.created_at, r.updated_at,
                    u.email AS client_email, u.full_name AS client_name,
                    m.id AS matter_id, m.reference AS matter_reference,
                    m.title AS matter_title, m.matter_type AS matter_type,
                    m.status AS matter_status, m.assigned_to AS matter_assigned_to
             FROM requests r
             JOIN users u ON u.id = r.client_id
             LEFT JOIN matters m ON m.originating_request_id = r.id
             WHERE r.id = $1 LIMIT 1`,
            [request.params.id]
        );
        if (row.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Request not found' } });
        }
        const [infoReqs, responses, events, notes] = await Promise.all([
            query(
                `SELECT id, requested_by, items, message, deadline, created_at
                 FROM request_info_requests WHERE request_id = $1 ORDER BY created_at DESC`,
                [request.params.id]
            ),
            query(
                `SELECT cr.id, cr.info_request_id, cr.response, cr.created_at,
                        u.email AS client_email, u.full_name AS client_name
                 FROM client_responses cr JOIN users u ON u.id = cr.client_id
                 WHERE cr.request_id = $1 ORDER BY cr.created_at DESC`,
                [request.params.id]
            ),
            query(
                `SELECT id, actor_id, event_type, title, note, created_at FROM request_events
                 WHERE request_id = $1 ORDER BY created_at ASC`,
                [request.params.id]
            ),
            query(
                `SELECT id, author_id, note, created_at FROM internal_notes
                 WHERE entity_type = 'request' AND entity_id = $1 ORDER BY created_at ASC`,
                [request.params.id]
            )
        ]);
        response.json({
            data: row.rows[0],
            info_requests: infoReqs.rows,
            client_responses: responses.rows,
            events: events.rows,
            internal_notes: notes.rows
        });
    } catch (error) { next(error); }
});

/* GET /api/v1/owner/matters/:id/conversation — OWNER access to matter conversation */
ownerRouter.get('/matters/:id/conversation', async (request, response, next) => {
    try {
        const result = await query(
            `INSERT INTO conversations (matter_id) VALUES ($1)
             ON CONFLICT (matter_id) DO NOTHING
             RETURNING id, matter_id, created_at`,
            [request.params.id]
        );
        if (result.rowCount === 1) {
            return response.json({ data: result.rows[0] });
        }
        const existing = await query(
            `SELECT id, matter_id, created_at FROM conversations WHERE matter_id = $1 LIMIT 1`,
            [request.params.id]
        );
        response.json({ data: existing.rows[0] });
    } catch (error) {
        next(error);
    }
});

/* --- All Matters (management view) --- */
/* GET /api/v1/owner/matters */
ownerRouter.get('/matters', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT m.id, m.reference, m.title, m.matter_type, m.description,
                    m.status, m.client_id, m.assigned_to, m.created_at, m.updated_at,
                    c.email AS client_email, c.full_name AS client_name,
                    a.email AS assignee_email, a.full_name AS assignee_name
             FROM matters m
             JOIN users c ON c.id = m.client_id
             LEFT JOIN users a ON a.id = m.assigned_to
             ORDER BY m.created_at DESC`
        );
        response.json({ data: result.rows });
    } catch (error) {
        next(error);
    }
});

/* --- All Documents (management view) --- */
/* GET /api/v1/owner/documents */
ownerRouter.get('/documents', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT d.id, d.matter_id, d.original_name, d.content_type, d.size_bytes,
                    d.status, d.created_at, d.updated_at,
                    m.reference AS matter_reference, m.title AS matter_title,
                    c.email AS client_email, c.full_name AS client_name
             FROM documents d
             JOIN matters m ON m.id = d.matter_id
             JOIN users c ON c.id = m.client_id
             WHERE d.status <> 'DELETED'
             ORDER BY d.created_at DESC`
        );
        response.json({ data: result.rows });
    } catch (error) {
        next(error);
    }
});

/* --- Conversations (management view) --- */
const ownerMessageSchema = z.object({ body: z.string().trim().min(1).max(4000) });
const ownerConversationListSchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0)
});
const ownerConversationDetailSchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before: z.string().uuid().optional(),
    after: z.string().uuid().optional()
});

ownerRouter.get('/conversations', async (request, response, next) => {
    try {
        const q = ownerConversationListSchema.parse(request.query);
        const result = await query(
            `SELECT c.id, c.matter_id, m.reference, m.title, m.status AS matter_status,
                    c.created_at,
                    (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND read_at IS NULL) AS unread_count,
                    (SELECT body FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_body,
                    (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at,
                    u.email AS client_email, u.full_name AS client_name
             FROM conversations c
             JOIN matters m ON m.id = c.matter_id
             JOIN users u ON u.id = m.client_id
             ORDER BY c.created_at DESC
             LIMIT $1 OFFSET $2`,
            [q.limit, q.offset]
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

ownerRouter.get('/conversations/:id', async (request, response, next) => {
    try {
        const q = ownerConversationDetailSchema.parse(request.query);
        const result = await query(
            `SELECT c.id, c.matter_id, c.request_id, c.subject,
                    m.reference, m.title, m.status AS matter_status,
                    COALESCE(m.client_id, r.client_id, c.client_id) AS client_id,
                    u.email AS client_email, u.full_name AS client_name,
                    c.created_at
             FROM conversations c
             LEFT JOIN matters m ON m.id = c.matter_id
             LEFT JOIN requests r ON r.id = c.request_id
             LEFT JOIN users u ON u.id = COALESCE(m.client_id, r.client_id, c.client_id)
             WHERE c.id = $1 LIMIT 1`,
            [request.params.id]
        );
        if (result.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } });
        }
        const convo = result.rows[0];

        let messagesQuery = `
            SELECT m.id, m.sender_id, m.body, m.created_at, m.read_at,
                    u.role AS sender_role, u.full_name AS sender_name
            FROM messages m
            JOIN users u ON u.id = m.sender_id
            WHERE m.conversation_id = $1
        `;
        const params = [convo.id];

        if (q.before) {
            messagesQuery += ` AND m.created_at < (SELECT created_at FROM messages WHERE id = $${params.length + 1})`;
            params.push(q.before);
        } else if (q.after) {
            messagesQuery += ` AND m.created_at > (SELECT created_at FROM messages WHERE id = $${params.length + 1})`;
            params.push(q.after);
        }

        messagesQuery += ` ORDER BY m.created_at ASC LIMIT $${params.length + 1}`;
        params.push(q.limit);

        const messages = await query(messagesQuery, params);
        response.json({ data: { ...convo, messages: messages.rows } });
    } catch (error) { next(error); }
});

ownerRouter.post('/conversations/:id/messages', async (request, response, next) => {
    try {
        const input = ownerMessageSchema.parse(request.body);
        const convoResult = await query(
            `SELECT c.id, c.matter_id, c.request_id, c.client_id,
                    COALESCE(m.client_id, r.client_id, c.client_id) AS client_id
             FROM conversations c
             LEFT JOIN matters m ON m.id = c.matter_id
             LEFT JOIN requests r ON r.id = c.request_id
             WHERE c.id = $1 LIMIT 1`,
            [request.params.id]
        );
        if (convoResult.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } });
        }
        const convo = convoResult.rows[0];
        const clientId = convo.client_id;

        const inserted = await query(
            `INSERT INTO messages (conversation_id, sender_id, body)
             VALUES ($1, $2, $3)
             RETURNING id, sender_id, body, created_at`,
            [convo.id, request.user.sub, input.body]
        );

        await notify(clientId, {
            kind: 'NEW_MESSAGE',
            title: 'New message from the firm',
            body: input.body.slice(0, 120),
            entityType: 'conversation',
            entityId: convo.id
        });
        const { notifyMessageCreated } = await import('../services/sse.js');
        notifyMessageCreated(convo.id, inserted.rows[0].id, request.user.sub, input.body);

        response.status(201).json({ data: inserted.rows[0] });
    } catch (error) { next(error); }
});

ownerRouter.post('/conversations/:id/read', async (request, response, next) => {
    try {
        const convoResult = await query(
            `SELECT c.id FROM conversations c WHERE c.id = $1 LIMIT 1`,
            [request.params.id]
        );
        if (convoResult.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } });
        }
        const convo = convoResult.rows[0];
        await query(
            `UPDATE messages SET read_at = NOW()
             WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
            [convo.id, request.user.sub]
        );
        response.json({ data: { conversation_id: convo.id, read: true } });
    } catch (error) { next(error); }
});

/* --- Messages overview (management view) --- */
/* GET /api/v1/owner/messages */
ownerRouter.get('/messages', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT c.id AS conversation_id, c.matter_id, c.request_id, c.subject, c.created_at AS conversation_created,
                    m2.body AS last_message_body,
                    m2.created_at AS last_message_at,
                    s.email AS sender_email, s.full_name AS sender_name,
                    u.email AS client_email, u.full_name AS client_name,
                    m2.read_at AS last_message_read,
                    (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND read_at IS NULL) AS unread_count
             FROM conversations c
             LEFT JOIN matters m ON m.id = c.matter_id
             LEFT JOIN requests r ON r.id = c.request_id
             LEFT JOIN users u ON u.id = COALESCE(c.client_id, m.client_id, r.client_id)
             LEFT JOIN LATERAL (
                 SELECT m.body, m.created_at, m.read_at, m.sender_id
                 FROM messages m
                 WHERE m.conversation_id = c.id
                 ORDER BY m.created_at DESC
                 LIMIT 1
             ) m2 ON TRUE
             LEFT JOIN users s ON s.id = m2.sender_id
             ORDER BY m2.created_at DESC NULLS LAST`
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/requests/:id/message — message the client about a request
   (creates/reuses a request-scoped conversation so messaging works before a
   matter exists). */
ownerRouter.post('/requests/:id/message', async (request, response, next) => {
    try {
        const input = ownerMessageSchema.parse(request.body);
        const r = await query(
            `SELECT r.id, r.client_id FROM requests r WHERE r.id = $1 LIMIT 1`,
            [request.params.id]
        );
        if (r.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Request not found' } });
        }
        const requestId = r.rows[0].id;
        const clientId = r.rows[0].client_id;

        let convo = await query(
            `SELECT c.id FROM conversations c WHERE c.request_id = $1 LIMIT 1`,
            [requestId]
        );
        if (convo.rowCount === 0) {
            convo = await query(
                `INSERT INTO conversations (request_id, client_id, subject)
                 VALUES ($1, $2, $3)
                 RETURNING id`,
                [requestId, clientId, r.rows[0].subject || null]
            );
        }
        const convoId = convo.rows[0].id;

        const inserted = await query(
            `INSERT INTO messages (conversation_id, sender_id, body)
             VALUES ($1, $2, $3)
             RETURNING id, sender_id, body, created_at`,
            [convoId, request.user.sub, input.body]
        );

        await notify(clientId, {
            kind: 'NEW_MESSAGE',
            title: 'New message from the firm',
            body: input.body.slice(0, 120),
            entityType: 'conversation',
            entityId: convoId
        });
        const { notifyMessageCreated } = await import('../services/sse.js');
        notifyMessageCreated(convoId, inserted.rows[0].id, request.user.sub, input.body);

        response.status(201).json({ data: { conversation_id: convoId, message: inserted.rows[0] } });
    } catch (error) { next(error); }
});

/* --- Clients (management view) --- */
/* GET /api/v1/owner/clients */
ownerRouter.get('/clients', async (_request, response, next) => {
    try {
        const result = await query(
            `SELECT u.id, u.email, u.full_name, u.is_active,
                    u.created_at, u.updated_at,
                    (l.last_login_at) AS last_login_at
             FROM users u
             LEFT JOIN (
                 SELECT DISTINCT ON (actor_id) actor_id, created_at AS last_login_at
                 FROM audit_logs
                 WHERE action = 'LOGIN'
                 ORDER BY actor_id, created_at DESC
             ) l ON l.actor_id = u.id
             WHERE u.role = 'CLIENT'
             ORDER BY u.created_at DESC`
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

/* --- Lawyers (management view) --- */
/* GET /api/v1/owner/lawyers */
ownerRouter.get('/lawyers', async (_request, response, next) => {
    try {
        const result = await query(
            `SELECT u.id, u.email, u.full_name, u.is_active,
                    u.created_at, u.updated_at,
                    (l.last_login_at) AS last_login_at
             FROM users u
             LEFT JOIN (
                 SELECT DISTINCT ON (actor_id) actor_id, created_at AS last_login_at
                 FROM audit_logs
                 WHERE action = 'LOGIN'
                 ORDER BY actor_id, created_at DESC
             ) l ON l.actor_id = u.id
             WHERE u.role = 'LAWYER'
             ORDER BY u.created_at DESC`
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

/* --- Staff (management view) --- */
/* GET /api/v1/owner/staff */
ownerRouter.get('/staff', async (_request, response, next) => {
    try {
        const result = await query(
            `SELECT u.id, u.email, u.full_name, u.is_active,
                    u.created_at, u.updated_at,
                    (l.last_login_at) AS last_login_at
             FROM users u
             LEFT JOIN (
                 SELECT DISTINCT ON (actor_id) actor_id, created_at AS last_login_at
                 FROM audit_logs
                 WHERE action = 'LOGIN'
                 ORDER BY actor_id, created_at DESC
             ) l ON l.actor_id = u.id
             WHERE u.role = 'STAFF'
             ORDER BY u.created_at DESC`
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

/* --- All Notifications (management view) --- */
/* GET /api/v1/owner/notifications */
ownerRouter.get('/notifications', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT n.id, n.user_id, n.kind, n.title, n.body, n.entity_type,
                    n.entity_id, n.read_at, n.created_at,
                    u.email AS recipient_email, u.full_name AS recipient_name
             FROM notifications n
             JOIN users u ON u.id = n.user_id
             ORDER BY n.created_at DESC`
        );
        response.json({ data: result.rows });
    } catch (error) {
        next(error);
    }
});

/* --- Client Detail --- */
/* GET /api/v1/owner/clients/:id — full client context for single-lawyer practice */
ownerRouter.get('/clients/:id', async (request, response, next) => {
    try {
        const clientRes = await query(
            `SELECT u.id, u.email, u.full_name, u.is_active, u.created_at, u.updated_at,
                    (l.last_login_at) AS last_login_at
             FROM users u
             LEFT JOIN (
                 SELECT DISTINCT ON (actor_id) actor_id, created_at AS last_login_at
                 FROM audit_logs WHERE action = 'LOGIN'
                 ORDER BY actor_id, created_at DESC
             ) l ON l.actor_id = u.id
             WHERE u.id = $1 AND u.role = 'CLIENT' LIMIT 1`,
            [request.params.id]
        );
        if (clientRes.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Client not found' } });
        }
        const client = clientRes.rows[0];

        const [mattersRes, requestsRes, appointmentsRes, conversationsRes] = await Promise.all([
            query(
                `SELECT m.id, m.reference, m.title, m.matter_type, m.status, m.created_at
                 FROM matters m
                 WHERE m.client_id = $1
                 ORDER BY m.created_at DESC`,
                [client.id]
            ),
            query(
                `SELECT r.id, r.subject, r.status, r.created_at, r.updated_at
                 FROM requests r
                 WHERE r.client_id = $1
                 ORDER BY r.created_at DESC`,
                [client.id]
            ),
            query(
                `SELECT a.id, a.starts_at, a.ends_at, a.status, a.notes, a.created_at,
                        m.reference AS matter_reference
                 FROM appointments a
                 LEFT JOIN matters m ON m.id = a.matter_id
                 WHERE a.client_id = $1
                 ORDER BY a.starts_at DESC`,
                [client.id]
            ),
            query(
                `SELECT c.id, c.matter_id, m.reference, m.title AS matter_title,
                        c.created_at,
                        (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND read_at IS NULL) AS unread_count,
                        (SELECT body FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_body,
                        (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
                 FROM conversations c
                 JOIN matters m ON m.id = c.matter_id
                 WHERE m.client_id = $1
                 ORDER BY c.created_at DESC`,
                [client.id]
            )
        ]);

        response.json({
            data: client,
            matters: mattersRes.rows,
            requests: requestsRes.rows,
            appointments: appointmentsRes.rows,
            conversations: conversationsRes.rows
        });
    } catch (error) { next(error); }
});

/* --- Matter Detail --- */
/* GET /api/v1/owner/matters/:id — full matter context */
ownerRouter.get('/matters/:id', async (request, response, next) => {
    try {
        const matterRes = await query(
            `SELECT m.id, m.reference, m.title, m.matter_type, m.description,
                     m.status, m.client_id, m.originating_request_id, m.assigned_to,
                     m.created_at, m.updated_at,
                     c.email AS client_email, c.full_name AS client_name,
                     a.email AS assignee_email, a.full_name AS assignee_name
             FROM matters m
             JOIN users c ON c.id = m.client_id
             LEFT JOIN users a ON a.id = m.assigned_to
             WHERE m.id = $1 LIMIT 1`,
            [request.params.id]
        );
        if (matterRes.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Matter not found' } });
        }
        const matter = matterRes.rows[0];

        const [eventsRes, documentsRes, appointmentsRes, conversationRes] = await Promise.all([
            query(
                `SELECT id, event_type, title, note, actor_id, created_at
                 FROM matter_events
                 WHERE matter_id = $1
                 ORDER BY created_at ASC`,
                [matter.id]
            ),
            query(
                `SELECT d.id, d.original_name, d.content_type, d.size_bytes,
                        d.status, d.created_at, d.updated_at
                 FROM documents d
                 WHERE d.matter_id = $1 AND d.status <> 'DELETED'
                 ORDER BY d.created_at DESC`,
                [matter.id]
            ),
            query(
                `SELECT id, starts_at, ends_at, status, notes, created_at, updated_at
                 FROM appointments
                 WHERE matter_id = $1
                 ORDER BY starts_at ASC`,
                [matter.id]
            ),
            query(
                `SELECT id, created_at FROM conversations WHERE matter_id = $1 LIMIT 1`,
                [matter.id]
            )
        ]);

        let originatingRequest = null;
        if (matter.originating_request_id) {
            const reqRes = await query(
                `SELECT id, subject, description, status, client_id, created_at, updated_at
                 FROM requests WHERE id = $1 LIMIT 1`,
                [matter.originating_request_id]
            );
            originatingRequest = reqRes.rows[0] || null;
        }

        response.json({
            data: matter,
            originating_request: originatingRequest,
            events: eventsRes.rows,
            documents: documentsRes.rows,
            appointments: appointmentsRes.rows,
            conversation: conversationRes.rows[0] || null
        });
    } catch (error) { next(error); }
});

/* --- Document Detail --- */
/* GET /api/v1/owner/documents/:id */
ownerRouter.get('/documents/:id', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT d.id, d.matter_id, d.original_name, d.content_type,
                     d.size_bytes, d.storage_key, d.status,
                     d.uploaded_by, d.created_at, d.updated_at,
                     m.reference AS matter_reference, m.title AS matter_title,
                     u.email AS client_email, u.full_name AS client_name
             FROM documents d
             JOIN matters m ON m.id = d.matter_id
             JOIN users u ON u.id = m.client_id
             WHERE d.id = $1 LIMIT 1`,
             [request.params.id]
        );
        if (result.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
        }
        response.json({ data: result.rows[0] });
    } catch (error) { next(error); }
});

/* --- Workflow: Request Actions --- */

/* POST /api/v1/owner/requests/:id/request-info — request more information from client */
const requestInfoSchema = z.object({
    items: z.string().trim().min(1).max(2000),
    message: z.string().trim().max(2000).optional(),
    deadline: z.string().datetime().optional()
});

ownerRouter.post('/requests/:id/request-info', async (request, response, next) => {
    try {
        const input = requestInfoSchema.parse(request.body);
        const result = await requestMoreInfo({
            requestId: request.params.id,
            actorId: request.user.sub,
            items: input.items,
            message: input.message,
            deadline: input.deadline
        });
        response.status(201).json({ data: result });
    } catch (error) { next(error); }
});

/* GET /api/v1/owner/requests/:id/info-requests — list info requests for a request */
ownerRouter.get('/requests/:id/info-requests', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT id, requested_by, items, message, deadline, created_at, u.email AS requested_by_email, u.full_name AS requested_by_name
             FROM request_info_requests rir
             JOIN users u ON u.id = rir.requested_by
             WHERE request_id = $1
             ORDER BY created_at DESC`,
            [request.params.id]
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

/* GET /api/v1/owner/requests/:id/responses — list client responses for a request */
ownerRouter.get('/requests/:id/responses', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT id, info_request_id, client_id, response, created_at, u.email AS client_email, u.full_name AS client_name
             FROM client_responses cr
             JOIN users u ON u.id = cr.client_id
             WHERE request_id = $1
             ORDER BY created_at DESC`,
            [request.params.id]
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

/* GET /api/v1/owner/requests/:id/actions — context-aware admin actions for a request */
ownerRouter.get('/requests/:id/actions', async (request, response, next) => {
    try {
        const r = await query(
            `SELECT id, client_id, status, subject FROM requests WHERE id = $1 LIMIT 1`,
            [request.params.id]
        );
        if (r.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Request not found' } });
        }
        const req = r.rows[0];
        const status = req.status;
        const actions = [];
        actions.push({ key: 'review', label: 'Review request', method: 'GET', endpoint: `/api/v1/owner/requests/${req.id}`, schema: null, options: null });
        actions.push({ key: 'message_client', label: 'Message client', method: 'POST', endpoint: `/api/v1/owner/requests/${req.id}/message`, schema: { body: 'string' }, options: null });

        if (['SUBMITTED', 'UNDER_REVIEW', 'ACTION_REQUIRED'].includes(status)) {
            actions.push({ key: 'accept', label: 'Accept matter', method: 'POST', endpoint: `/api/v1/owner/requests/${req.id}/accept`, schema: { title: 'string', matterType: 'string', description: 'string' }, options: null });
            actions.push({ key: 'request_info', label: 'Request more information', method: 'POST', endpoint: `/api/v1/owner/requests/${req.id}/request-info`, schema: { items: 'array', message: 'string', deadline: 'datetime' }, options: null });
            actions.push({ key: 'decline', label: 'Decline request', method: 'POST', endpoint: `/api/v1/owner/requests/${req.id}/decline`, schema: { reason: 'string' }, options: null });
        }
        if (status === 'ACTION_REQUIRED') {
            actions.push({ key: 'review_response', label: 'Review client response', method: 'GET', endpoint: `/api/v1/owner/requests/${req.id}/responses`, schema: null, options: null });
        }
        if (['ACCEPTED', 'ACTION_REQUIRED', 'UNDER_REVIEW'].includes(status)) {
            const m = await query(`SELECT id FROM matters WHERE originating_request_id = $1 LIMIT 1`, [req.id]);
            if (m.rowCount > 0) {
                actions.push({ key: 'view_matter', label: 'View matter', method: 'GET', endpoint: `/api/v1/owner/matters/${m.rows[0].id}`, schema: null, options: null });
            }
        }

        response.json({ data: { request_id: req.id, status, actions } });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/requests/:id/accept — accept a request and create the matter */
ownerRouter.post('/requests/:id/accept', async (request, response, next) => {
    try {
        const input = z.object({
            matterType: z.string().trim().max(120).optional(),
            title: z.string().trim().min(3).max(200),
            description: z.string().trim().max(4000).optional()
        }).parse(request.body);
        const matter = await acceptRequest({
            requestId: request.params.id,
            actorId: request.user.sub,
            matterType: input.matterType,
            title: input.title,
            description: input.description
        });
        response.status(201).json({ data: matter });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/requests/:id/decline — decline a request */
ownerRouter.post('/requests/:id/decline', async (request, response, next) => {
    try {
        const input = z.object({ reason: z.string().trim().max(2000).optional() }).parse(request.body || {});
        const result = await declineRequest({
            requestId: request.params.id,
            actorId: request.user.sub,
            reason: input.reason
        });
        response.json({ data: result });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/requests/:id/status — update request status */
ownerRouter.post('/requests/:id/status', async (request, response, next) => {
    try {
        const input = z.object({
            status: z.enum(['UNDER_REVIEW', 'ACTION_REQUIRED', 'SCHEDULED', 'COMPLETED', 'CLOSED']),
            note: z.string().trim().max(2000).optional()
        }).parse(request.body);
        const result = await updateRequestStatus({
            requestId: request.params.id,
            actorId: request.user.sub,
            status: input.status,
            note: input.note
        });
        response.json({ data: result });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/requests/:id/internal-note — add internal note to a request */
ownerRouter.post('/requests/:id/internal-note', async (request, response, next) => {
    try {
        const input = z.object({ note: z.string().trim().min(1).max(2000) }).parse(request.body);
        const result = await addInternalNote({
            entityType: 'request',
            entityId: request.params.id,
            authorId: request.user.sub,
            note: input.note
        });
        response.status(201).json({ data: result });
    } catch (error) { next(error); }
});

/* --- Workflow: Matter Actions --- */

/* POST /api/v1/owner/matters/:id/status — update matter status */
ownerRouter.post('/matters/:id/status', async (request, response, next) => {
    try {
        const input = z.object({
            status: z.enum(['OPEN', 'ACTIVE', 'ON_HOLD', 'RESOLVED', 'CLOSED']),
            reason: z.string().trim().max(2000).optional()
        }).parse(request.body);
        const result = await updateMatterStatus({
            matterId: request.params.id,
            actorId: request.user.sub,
            status: input.status,
            reason: input.reason
        });
        response.json({ data: result });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/matters/:id/internal-note — add internal note to a matter */
ownerRouter.post('/matters/:id/internal-note', async (request, response, next) => {
    try {
        const input = z.object({ note: z.string().trim().min(1).max(2000) }).parse(request.body);
        const result = await addInternalNote({
            entityType: 'matter',
            entityId: request.params.id,
            authorId: request.user.sub,
            note: input.note
        });
        response.status(201).json({ data: result });
    } catch (error) { next(error); }
});

/* GET /api/v1/owner/matters/:id/internal-notes — list internal notes for a matter */
ownerRouter.get('/matters/:id/internal-notes', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT id, author_id, note, created_at, u.full_name AS author_name
             FROM internal_notes
             JOIN users u ON u.id = internal_notes.author_id
             WHERE entity_type = 'matter' AND entity_id = $1
             ORDER BY created_at DESC`,
            [request.params.id]
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

/* --- Workflow: Document Request --- */

/* POST /api/v1/owner/matters/:id/document-request — request a document from the client */
const documentRequestSchema = z.object({
    description: z.string().trim().min(1).max(2000),
    message: z.string().trim().max(2000).optional(),
    dueDate: z.string().datetime().optional()
});

ownerRouter.post('/matters/:id/document-request', async (request, response, next) => {
    try {
        const input = documentRequestSchema.parse(request.body);
        const matterRes = await query(
            `SELECT m.id, m.client_id, m.reference FROM matters m WHERE m.id = $1 LIMIT 1`,
            [request.params.id]
        );
        if (matterRes.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Matter not found' } });
        }
        const matter = matterRes.rows[0];
        const convoRes = await query(
            `INSERT INTO conversations (matter_id) VALUES ($1)
             ON CONFLICT (matter_id) DO NOTHING
             RETURNING id`,
            [matter.id]
        );
        const convoId = convoRes.rowCount === 1 ? convoRes.rows[0].id :
            (await query(`SELECT id FROM conversations WHERE matter_id = $1 LIMIT 1`, [matter.id])).rows[0].id;
        await query(
            `INSERT INTO messages (conversation_id, sender_id, body)
             VALUES ($1, $2, $3)`,
            [convoId, request.user.sub, `Document request: ${input.description}${input.message ? ' — ' + input.message : ''}`]
        );
        await notify(matter.client_id, {
            kind: 'DOCUMENT_REQUESTED',
            title: 'Document requested',
            body: input.description.slice(0, 160),
            entityType: 'matter',
            entityId: matter.id
        });
        response.status(201).json({ data: { matterId: matter.id, reference: matter.reference, conversationId: convoId } });
    } catch (error) { next(error); }
});

/* --- Enhanced: Owner requests list with search/filter/sort --- */

/* GET /api/v1/owner/requests?search=&status=&urgency=&sort=&page=&limit= */
ownerRouter.get('/requests', async (request, response, next) => {
    try {
        const q = z.object({
            search: z.string().optional(),
            status: z.string().optional(),
            urgency: z.string().optional(),
            sort: z.enum(['created_at', 'updated_at', 'status']).optional().default('created_at'),
            page: z.coerce.number().min(1).default(1),
            limit: z.coerce.number().min(1).max(200).default(50)
        }).parse(request.query);

        const offset = (q.page - 1) * q.limit;
        const conditions = [];
        const params = [];
        let i = 1;

        if (q.search) {
            conditions.push(`(r.subject ILIKE $${i} OR r.description ILIKE $${i} OR u.email ILIKE $${i} OR u.full_name ILIKE $${i})`);
            params.push('%' + q.search + '%');
            i++;
        }
        if (q.status) {
            conditions.push(`r.status = $${i}`);
            params.push(q.status.toUpperCase());
            i++;
        }

        const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const sortDir = request.query.dir === 'asc' ? 'ASC' : 'DESC';

        const result = await query(
            `SELECT r.id, r.subject, r.description, r.status, r.client_id,
                    r.created_at, r.updated_at,
                    u.email AS client_email, u.full_name AS client_name,
                    m.id AS matter_id, m.reference AS matter_reference
             FROM requests r
             JOIN users u ON u.id = r.client_id
             LEFT JOIN matters m ON m.originating_request_id = r.id
             ${whereClause}
             ORDER BY r.${q.sort} ${sortDir}
             LIMIT $${i} OFFSET $${i + 1}`,
            [...params, q.limit, offset]
        );

        const countResult = await query(
            `SELECT COUNT(*)::int AS total FROM requests r
             JOIN users u ON u.id = r.client_id
             ${whereClause}`,
            params
        );

        response.json({
            data: result.rows,
            meta: {
                total: countResult.rows[0].total,
                page: q.page,
                limit: q.limit,
                totalPages: Math.ceil(countResult.rows[0].total / q.limit)
            }
        });
    } catch (error) { next(error); }
});

/* --- Matter Actions --- */
/* GET /api/v1/owner/matters/:id/actions — returns available actions for this matter */
ownerRouter.get('/matters/:id/actions', async (request, response, next) => {
    try {
        const matterRow = await query(
            `SELECT m.id, m.client_id, m.status, m.assigned_to, m.originating_request_id
             FROM matters m WHERE m.id = $1 LIMIT 1`,
            [request.params.id]
        );
        if (matterRow.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Matter not found' } });
        }
        const matter = matterRow.rows[0];
        const status = matter.status;

        const convoRow = await query(`SELECT id FROM conversations WHERE matter_id = $1 LIMIT 1`, [matter.id]);
        const conversationId = convoRow.rowCount > 0 ? convoRow.rows[0].id : null;

        const statusTransitions = {
            OPEN: ['ACTIVE', 'ON_HOLD', 'RESOLVED', 'CLOSED'],
            ACTIVE: ['ON_HOLD', 'RESOLVED', 'CLOSED'],
            ON_HOLD: ['ACTIVE', 'CLOSED'],
            RESOLVED: ['ACTIVE', 'CLOSED'],
            CLOSED: []
        };

        const actions = [];

        actions.push({
            key: 'change_status',
            label: 'Change status',
            method: 'POST',
            endpoint: `/api/v1/owner/matters/${matter.id}/status`,
            schema: { status: 'enum', reason: 'string' },
            options: statusTransitions[status] || []
        });

        actions.push({
            key: 'add_internal_note',
            label: 'Add internal note',
            method: 'POST',
            endpoint: `/api/v1/owner/matters/${matter.id}/internal-note`,
            schema: { note: 'string' },
            options: null
        });

        actions.push({
            key: 'schedule_appointment',
            label: 'Schedule appointment',
            method: 'POST',
            endpoint: '/api/v1/owner/appointments',
            schema: { startsAt: 'datetime', endsAt: 'datetime', notes: 'string' },
            options: null
        });

        actions.push({
            key: 'request_document',
            label: 'Request document',
            method: 'POST',
            endpoint: `/api/v1/owner/matters/${matter.id}/document-request`,
            schema: { description: 'string', message: 'string', dueDate: 'datetime' },
            options: null
        });

        actions.push({
            key: 'send_message',
            label: 'Message client',
            method: 'POST',
            endpoint: conversationId
                ? `/api/v1/owner/conversations/${conversationId}/messages`
                : `/api/v1/conversations?matterId=${encodeURIComponent(matter.id)}`,
            schema: { body: 'string' },
            options: null
        });

        if (matter.originating_request_id) {
            actions.push({
                key: 'view_originating_request',
                label: 'View originating request',
                method: 'GET',
                endpoint: `/api/v1/owner/requests/${matter.originating_request_id}`,
                schema: null,
                options: null
            });
        }

        if (!matter.assigned_to) {
            actions.push({
                key: 'assign_lawyer',
                label: 'Assign lawyer/staff',
                method: 'POST',
                endpoint: `/api/v1/owner/matters/${matter.id}/assign`,
                schema: { userId: 'uuid' },
                options: null
            });
        }

        response.json({
            data: {
                matter_id: matter.id,
                status: matter.status,
                actions
            }
        });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/matters/:id/assign — assign a lawyer/staff member to a matter */
ownerRouter.post('/matters/:id/assign', async (request, response, next) => {
    try {
        const input = z.object({ userId: z.string().uuid() }).parse(request.body);
        const assignment = await query(
            `UPDATE matters SET assigned_to = $1, updated_at = NOW()
             WHERE id = $2 AND $1 IN (SELECT id FROM users WHERE role IN ('LAWYER', 'STAFF') AND is_active = TRUE)
             RETURNING id, assigned_to, updated_at`,
            [input.userId, request.params.id]
        );
        if (assignment.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Matter or user not found' } });
        }
        const assigned = await query(
            `SELECT u.email, u.full_name FROM users u WHERE u.id = $1 LIMIT 1`,
            [input.userId]
        );
        await recordMatterEvent(
            request.params.id,
            request.user.sub,
            'ASSIGNED',
            'Matter assigned',
            `Assigned to ${assigned.rows[0]?.full_name || assigned.rows[0]?.email || input.userId}.`
        );
        await notify(input.userId, {
            kind: 'MATTER_ASSIGNED',
            title: 'Assigned to you',
            body: `You have been assigned to a matter.`,
            entityType: 'matter',
            entityId: request.params.id
        });
        response.json({ data: assignment.rows[0] });
    } catch (error) { next(error); }
});

/* --- Admin Appointments & Consultations --- */

const APPOINTMENT_STATUSES = ['SCHEDULED', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'];
const CONSULTATION_TYPES = ['INITIAL_CONSULTATION', 'MATTER_CONSULTATION', 'FOLLOW_UP', 'GENERAL_CONSULTATION'];
const MEETING_MODES = ['IN_PERSON', 'PHONE', 'VIDEO'];

/* GET /api/v1/owner/appointments?client_id=&matter_id=&status=&from=&to=&type=&mode=&q=&page=&limit= */
ownerRouter.get('/appointments', async (request, response, next) => {
    try {
        const q = z.object({
            client_id: z.string().uuid().optional(),
            matter_id: z.string().uuid().optional(),
            status: z.string().optional(),
            from: z.string().datetime().optional(),
            to: z.string().datetime().optional(),
            type: z.enum(['INITIAL_CONSULTATION', 'MATTER_CONSULTATION', 'FOLLOW_UP', 'GENERAL_CONSULTATION']).optional(),
            mode: z.enum(['IN_PERSON', 'PHONE', 'VIDEO']).optional(),
            q: z.string().optional(),
            page: z.coerce.number().min(1).default(1),
            limit: z.coerce.number().min(1).max(200).default(50),
        }).parse(request.query);

        const offset = (q.page - 1) * q.limit;
        const conditions = [];
        const params = [];
        let i = 1;

        if (q.client_id) { conditions.push(`a.client_id = $${i}`); params.push(q.client_id); i++; }
        if (q.matter_id) { conditions.push(`a.matter_id = $${i}`); params.push(q.matter_id); i++; }
        if (q.status) { conditions.push(`a.status = $${i}`); params.push(q.status.toUpperCase()); i++; }
        if (q.from) { conditions.push(`a.starts_at >= $${i}`); params.push(q.from); i++; }
        if (q.to) { conditions.push(`a.ends_at <= $${i}`); params.push(q.to); i++; }
        if (q.type) { conditions.push(`a.consultation_type = $${i}`); params.push(q.type); i++; }
        if (q.mode) { conditions.push(`a.meeting_mode = $${i}`); params.push(q.mode); i++; }
        if (q.q) {
            conditions.push(`(u.email ILIKE $${i} OR u.full_name ILIKE $${i} OR m.reference ILIKE $${i} OR a.notes ILIKE $${i})`);
            params.push('%' + q.q + '%');
            i++;
        }

        const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const result = await query(
            `SELECT a.id, a.client_id, a.matter_id, a.request_id, a.consultation_type, a.meeting_mode,
                    a.duration_minutes, a.location_details, a.starts_at, a.ends_at, a.status, a.notes,
                    a.created_at, a.updated_at,
                    u.email AS client_email, u.full_name AS client_name,
                    m.reference AS matter_reference, m.title AS matter_title
             FROM appointments a
             JOIN users u ON u.id = a.client_id
             LEFT JOIN matters m ON m.id = a.matter_id
             ${whereClause}
             ORDER BY a.starts_at ASC
             LIMIT $${i} OFFSET $${i + 1}`,
            [...params, q.limit, offset]
        );

        const countResult = await query(
            `SELECT COUNT(*)::int AS total FROM appointments a
             JOIN users u ON u.id = a.client_id
             LEFT JOIN matters m ON m.id = a.matter_id
             ${whereClause}`,
            params
        );

        response.json({
            data: result.rows,
            meta: {
                total: countResult.rows[0].total,
                page: q.page,
                limit: q.limit,
                totalPages: Math.ceil(countResult.rows[0].total / q.limit)
            }
        });
    } catch (error) { next(error); }
});

/* GET /api/v1/owner/appointments/:id */
ownerRouter.get('/appointments/:id', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT a.id, a.client_id, a.matter_id, a.request_id, a.consultation_type, a.meeting_mode,
                    a.duration_minutes, a.location_details, a.starts_at, a.ends_at, a.status, a.notes,
                    a.created_at, a.updated_at,
                    u.email AS client_email, u.full_name AS client_name,
                    m.reference AS matter_reference, m.title AS matter_title
             FROM appointments a
             JOIN users u ON u.id = a.client_id
             LEFT JOIN matters m ON m.id = a.matter_id
             WHERE a.id = $1 LIMIT 1`,
            [request.params.id]
        );
        if (result.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Appointment not found' } });
        }
        response.json({ data: result.rows[0] });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/appointments — schedule consultation/appointment */
const createAppointmentSchema = z.object({
    clientId: z.string().uuid(),
    matterId: z.string().uuid().optional(),
    requestId: z.string().uuid().optional(),
    consultationType: z.enum(CONSULTATION_TYPES).optional(),
    meetingMode: z.enum(MEETING_MODES).optional(),
    durationMinutes: z.coerce.number().int().min(1).max(1440).optional(),
    locationDetails: z.string().trim().max(500).optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    notes: z.string().trim().max(2000).optional()
});

ownerRouter.post('/appointments', async (request, response, next) => {
    try {
        const input = createAppointmentSchema.parse(request.body);
        if (!input.matterId && !input.requestId) {
            /* General consultation without a matter is allowed. */
        }
        const result = await scheduleAppointment({
            clientId: input.clientId,
            matterId: input.matterId,
            requestId: input.requestId,
            consultationType: input.consultationType,
            meetingMode: input.meetingMode,
            durationMinutes: input.durationMinutes,
            locationDetails: input.locationDetails,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            notes: input.notes,
            actorId: request.user.sub
        });
        response.status(201).json({ data: result });
    } catch (error) { next(error); }
});

/* PATCH /api/v1/owner/appointments/:id — reschedule / update details */
const updateAppointmentSchema = z.object({
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    consultationType: z.enum(CONSULTATION_TYPES).optional(),
    meetingMode: z.enum(MEETING_MODES).optional(),
    durationMinutes: z.coerce.number().int().min(1).max(1440).optional(),
    locationDetails: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(2000).optional()
});

ownerRouter.patch('/appointments/:id', async (request, response, next) => {
    try {
        const input = updateAppointmentSchema.parse(request.body);
        const result = await rescheduleAppointment({
            appointmentId: request.params.id,
            actorId: request.user.sub,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            consultationType: input.consultationType,
            meetingMode: input.meetingMode,
            durationMinutes: input.durationMinutes,
            locationDetails: input.locationDetails,
            notes: input.notes
        });
        response.json({ data: result });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/appointments/:id/status — change status (confirm/cancel/complete/no-show) */
const appointmentStatusSchema = z.object({
    status: z.enum(APPOINTMENT_STATUSES),
    reason: z.string().trim().max(2000).optional()
});

ownerRouter.post('/appointments/:id/status', async (request, response, next) => {
    try {
        const input = appointmentStatusSchema.parse(request.body);
        const result = await changeAppointmentStatus({
            appointmentId: request.params.id,
            actorId: request.user.sub,
            status: input.status,
            reason: input.reason
        });
        response.json({ data: result });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/appointments/:id/cancel */
ownerRouter.post('/appointments/:id/cancel', async (request, response, next) => {
    try {
        const { reason } = z.object({ reason: z.string().trim().max(2000).optional() }).parse(request.body || {});
        const result = await changeAppointmentStatus({
            appointmentId: request.params.id, actorId: request.user.sub, status: 'CANCELLED', reason
        });
        response.json({ data: result });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/appointments/:id/complete */
ownerRouter.post('/appointments/:id/complete', async (request, response, next) => {
    try {
        const result = await changeAppointmentStatus({
            appointmentId: request.params.id, actorId: request.user.sub, status: 'COMPLETED'
        });
        response.json({ data: result });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/appointments/:id/no-show */
ownerRouter.post('/appointments/:id/no-show', async (request, response, next) => {
    try {
        const result = await changeAppointmentStatus({
            appointmentId: request.params.id, actorId: request.user.sub, status: 'NO_SHOW'
        });
        response.json({ data: result });
    } catch (error) { next(error); }
});
