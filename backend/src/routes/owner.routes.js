/* Owner routes — for the Machibya SUB UI / Owner Command Center.
   Guarded by requireRole('OWNER') so CLIENT, LAWYER, and STAFF cannot reach these endpoints. */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { query } from '../db.js';
import { notify } from '../services/notification.service.js';

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

/* --- All Requests (management view) --- */
/* GET /api/v1/owner/requests */
ownerRouter.get('/requests', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT r.id, r.subject, r.description, r.status, r.client_id,
                    r.created_at, r.updated_at,
                    u.email AS client_email, u.full_name AS client_name,
                    m.id AS matter_id, m.reference AS matter_reference
             FROM requests r
             JOIN users u ON u.id = r.client_id
             LEFT JOIN matters m ON m.originating_request_id = r.id
             ORDER BY r.created_at DESC`
        );
        response.json({ data: result.rows });
    } catch (error) {
        next(error);
    }
});

/* GET /api/v1/owner/requests/:id — full request detail for OWNER */
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
        response.json({ data: row.rows[0] });
    } catch (error) {
        next(error);
    }
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

/* --- All Appointments (management view) --- */
/* GET /api/v1/owner/appointments */
ownerRouter.get('/appointments', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT a.id, a.starts_at, a.ends_at, a.status, a.notes, a.client_id,
                    a.created_at, a.updated_at,
                    u.email AS client_email, u.full_name AS client_name
             FROM appointments a
             JOIN users u ON u.id = a.client_id
             ORDER BY a.starts_at DESC`
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
            `SELECT c.id, c.matter_id, m.reference, m.title, m.status AS matter_status,
                    c.created_at,
                    u.id AS client_id, u.email AS client_email, u.full_name AS client_name
             FROM conversations c
             JOIN matters m ON m.id = c.matter_id
             JOIN users u ON u.id = m.client_id
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
            `SELECT c.id, c.matter_id, m.client_id
             FROM conversations c
             JOIN matters m ON m.id = c.matter_id
             WHERE c.id = $1 LIMIT 1`,
            [request.params.id]
        );
        if (convoResult.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } });
        }
        const convo = convoResult.rows[0];

        const inserted = await query(
            `INSERT INTO messages (conversation_id, sender_id, body)
             VALUES ($1, $2, $3)
             RETURNING id, sender_id, body, created_at`,
            [convo.id, request.user.sub, input.body]
        );

        await notify(convo.client_id, {
            kind: 'NEW_MESSAGE',
            title: 'New message from the firm',
            body: input.body.slice(0, 120),
            entityType: 'conversation',
            entityId: convo.id
        });

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
            `SELECT c.id AS conversation_id, c.matter_id, c.created_at AS conversation_created,
                    m2.body AS last_message_body,
                    m2.created_at AS last_message_at,
                    s.email AS sender_email, s.full_name AS sender_name,
                    u.email AS client_email, u.full_name AS client_name,
                    m2.read_at AS last_message_read,
                    (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND read_at IS NULL) AS unread_count
             FROM conversations c
             JOIN matters m ON m.id = c.matter_id
             JOIN users u ON u.id = m.client_id
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

/* --- Appointment Detail --- */
/* GET /api/v1/owner/appointments/:id */
ownerRouter.get('/appointments/:id', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT a.id, a.client_id, a.matter_id, a.request_id,
                     a.starts_at, a.ends_at, a.status, a.notes,
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
