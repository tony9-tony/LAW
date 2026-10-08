/* Owner routes — for the Machibya SUB UI / Owner Command Center.
   Guarded by requireRole('OWNER') so CLIENT, LAWYER, and STAFF cannot reach these endpoints. */

import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { authenticate, requireRole } from '../middleware/auth.js';
import { query } from '../db.js';
import { notify } from '../services/notification.service.js';
import multer from 'multer';
import { saveUploadedFile, storageFilePath, deleteStoredFile } from '../services/upload.service.js';
import { acceptRequest, declineRequest, updateRequestStatus, requestMoreInfo, processClientResponse, updateMatterStatus, addInternalNote, scheduleAppointment, rescheduleAppointment, changeAppointmentStatus, recordMatterEvent, createMatterForRequest, isConsultationRequest } from '../services/workflow.service.js';
import { verifyPayment, rejectPayment, listPaymentsForOwner, getPaymentById, getPaymentDestinations, createPaymentDestination, updatePaymentDestination, getServiceCatalog, receiptPath, uploadPaymentDestinationQR, removePaymentDestinationQR } from '../services/payment.service.js';
import { setPaymentForRequest, PAYMENT_STATUS } from '../services/billing.service.js';
import { notifyPaymentVerified, notifyPaymentRejected, notifyDocumentRequested, notifyPaymentRequested } from '../services/sse.js';
import { logAudit } from '../lib/audit.js';
import { storeDocument, removeDocument } from '../services/document.service.js';
import { findConversationFor, listMessages, postMessage, conversationForMatter } from '../services/chat.service.js';

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
        await logAudit({ actorId: request.user.sub, action: 'USER_CREATED', entityType: 'user', entityId: user.id, metadata: { role: 'OWNER', target_id: user.id } });
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
        await logAudit({ actorId: request.user.sub, action: 'USER_CREATED', entityType: 'user', entityId: user.id, metadata: { role: user.role, target_id: user.id } });
        response.status(201).json({ data: user });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/users/:id/password — the owner sets a temporary password for
   someone who forgot theirs. There is no e-mail in this system, so this is how a
   forgotten password is recovered; the person then changes it under Profile. */
ownerRouter.post('/users/:id/password', async (request, response, next) => {
    try {
        const userId = z.string().uuid().parse(request.params.id);
        const input = z.object({ password: z.string().min(12).max(200) }).parse(request.body || {});
        const { default: bcrypt } = await import('bcryptjs');
        const result = await query(
            `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, role`,
            [await bcrypt.hash(input.password, 12), userId]
        );
        if (result.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
        }
        await logAudit({ actorId: request.user.sub, action: 'PASSWORD_SET_BY_OWNER', entityType: 'user', entityId: userId, metadata: { target_id: userId, role: result.rows[0].role } });
        response.json({ data: { id: result.rows[0].id, passwordSet: true } });
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
        await logAudit({ actorId: request.user.sub, action: 'SETTING_UPDATED', entityType: 'setting', entityId: null, metadata: { key: request.params.key } });
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
        const id = await conversationForMatter(request.params.id);
        const row = await query(`SELECT id, matter_id, created_at FROM conversations WHERE id = $1`, [id]);
        response.json({ data: row.rows[0] });
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
                    d.uploaded_by, uu.role AS uploaded_by_role, uu.full_name AS uploaded_by_name, dr.description AS request_description,
                    m.reference AS matter_reference, m.title AS matter_title,
                    c.email AS client_email, c.full_name AS client_name
             FROM documents d
             JOIN matters m ON m.id = d.matter_id
             JOIN users c ON c.id = m.client_id
             JOIN users uu ON uu.id = d.uploaded_by
             LEFT JOIN document_requests dr ON dr.id = d.document_request_id
             WHERE d.status <> 'DELETED'
             ORDER BY d.created_at DESC`
        );
        response.json({ data: result.rows });
    } catch (error) {
        next(error);
    }
});

/* POST /api/v1/owner/documents — upload a document to a matter (admin). */
const ownerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
ownerRouter.post('/documents', ownerUpload.single('file'), async (request, response, next) => {
    try {
        const document = await storeDocument({
            user: request.user,
            matterId: request.body.matter_id,
            file: request.file,
            originalName: request.body.original_name || null,
            requestId: request.body.request_id || null
        });
        response.status(201).json({ data: document });
    } catch (error) { next(error); }
});

/* DELETE /api/v1/owner/documents/:id — remove a document (it stays in the audit trail). */
ownerRouter.delete('/documents/:id', async (request, response, next) => {
    try {
        await removeDocument({ user: request.user, documentId: request.params.id });
        response.json({ data: { id: request.params.id, deleted: true } });
    } catch (error) { next(error); }
});

/* GET /api/v1/owner/documents/:id/download — stream document bytes (admin). */
ownerRouter.get('/documents/:id/download', async (request, response, next) => {
    try {
        const doc = await query(
            `SELECT d.id, d.original_name, d.content_type, d.storage_key, d.status
             FROM documents d
             WHERE d.id = $1 LIMIT 1`,
            [request.params.id]
        );
        if (doc.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
        }
        const d = doc.rows[0];
        const filePath = storageFilePath(d.storage_key);
        if (!filePath) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found on server.' } });
        }
        try { await fs.access(filePath); } catch {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'File has been removed from storage.' } });
        }
        response.setHeader('Content-Type', d.content_type || 'application/octet-stream');
        response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(d.original_name || 'download')}"`);
        response.setHeader('Cache-Control', 'private, max-age=3600');
        response.sendFile(filePath);
    } catch (error) { next(error); }
});

/* --- Conversations (management view) --- */
const ownerMessageSchema = z.object({ body: z.string().trim().min(1).max(4000), parentMessageId: z.string().uuid().optional() });
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
            `SELECT c.id, c.matter_id, c.request_id, m.reference, m.title, m.status AS matter_status,
                    r.subject AS request_subject, r.status AS request_status,
                    c.created_at,
                    (SELECT COUNT(*)::int FROM messages mm JOIN users su ON su.id = mm.sender_id
                      WHERE mm.conversation_id = c.id AND mm.read_at IS NULL AND su.role = 'CLIENT') AS unread_count,
                    (SELECT CASE WHEN deleted_at IS NOT NULL THEN 'This message was deleted' ELSE body END FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_body,
                    (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at,
                    u.email AS client_email, u.full_name AS client_name
             FROM conversations c
             LEFT JOIN matters m ON m.id = c.matter_id
             LEFT JOIN requests r ON r.id = c.request_id
             JOIN users u ON u.id = COALESCE(m.client_id, r.client_id, c.client_id)
             ORDER BY last_message_at DESC NULLS LAST, c.created_at DESC
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

        const messages = await listMessages(request.user, convo.id, q);
        response.json({ data: { ...convo, messages } });
    } catch (error) { next(error); }
});

ownerRouter.post('/conversations/:id/messages', async (request, response, next) => {
    try {
        const input = ownerMessageSchema.parse(request.body);
        const convo = await findConversationFor(request.user, request.params.id);
        if (!convo) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } });
        }
        const message = await postMessage({ user: request.user, convo, body: input.body, parentMessageId: input.parentMessageId || null });
        await logAudit({ actorId: request.user.sub, action: 'OWNER_MESSAGE_SENT', entityType: 'conversation', entityId: convo.id, metadata: { message_id: message.id, body_length: input.body.length } });
        response.status(201).json({ data: message });
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
            `UPDATE messages SET read_at = NOW(), delivered_at = COALESCE(delivered_at, NOW())
             WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
            [convo.id, request.user.sub]
        );
        const { notifyConversationReadAll } = await import('../services/sse.js');
        notifyConversationReadAll(convo.id, request.user.sub).catch(() => {});
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
                    (SELECT COUNT(*)::int FROM messages mm JOIN users su ON su.id = mm.sender_id
                      WHERE mm.conversation_id = c.id AND mm.read_at IS NULL AND su.role = 'CLIENT') AS unread_count
             FROM conversations c
             LEFT JOIN matters m ON m.id = c.matter_id
             LEFT JOIN requests r ON r.id = c.request_id
             LEFT JOIN users u ON u.id = COALESCE(c.client_id, m.client_id, r.client_id)
             LEFT JOIN LATERAL (
                 SELECT CASE WHEN m.deleted_at IS NOT NULL THEN 'This message was deleted' ELSE m.body END AS body, m.created_at, m.read_at, m.sender_id
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
            `SELECT r.id, r.client_id, r.subject FROM requests r WHERE r.id = $1 LIMIT 1`,
            [request.params.id]
        );
        if (r.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Request not found' } });
        }
        const requestId = r.rows[0].id;
        const clientId = r.rows[0].client_id;

        /* Once a matter exists for this request, the matter conversation carries everything. */
        const matterOfRequest = await query(`SELECT id FROM matters WHERE originating_request_id = $1 LIMIT 1`, [requestId]);
        let convo = matterOfRequest.rowCount > 0
            ? { rowCount: 1, rows: [{ id: await conversationForMatter(matterOfRequest.rows[0].id) }] }
            : await query(
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
        const convoRow = await findConversationFor(request.user, convoId);
        const message = await postMessage({ user: request.user, convo: convoRow, body: input.body });
        await logAudit({ actorId: request.user.sub, action: 'OWNER_MESSAGE_SENT', entityType: 'conversation', entityId: convoId, metadata: { message_id: message.id, body_length: input.body.length, request_id: requestId } });

        response.status(201).json({ data: { conversation_id: convoId, message } });
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
                        (SELECT COUNT(*)::int FROM messages mm JOIN users su ON su.id = mm.sender_id
                      WHERE mm.conversation_id = c.id AND mm.read_at IS NULL AND su.role = 'CLIENT') AS unread_count,
                        (SELECT CASE WHEN deleted_at IS NOT NULL THEN 'This message was deleted' ELSE body END FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_body,
                        (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
                 FROM conversations c
                 LEFT JOIN matters m ON m.id = c.matter_id
                 LEFT JOIN requests r ON r.id = c.request_id
                 WHERE COALESCE(m.client_id, r.client_id, c.client_id) = $1
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

        const [eventsRes, documentsRes, appointmentsRes, conversationRes, docRequestsRes] = await Promise.all([
            query(
                `SELECT id, event_type, title, note, actor_id, created_at
                 FROM matter_events
                 WHERE matter_id = $1
                 ORDER BY created_at ASC`,
                [matter.id]
            ),
            query(
                `SELECT d.id, d.original_name, d.content_type, d.size_bytes,
                        d.status, d.created_at, d.updated_at, uu.role AS uploaded_by_role, uu.full_name AS uploaded_by_name
                 FROM documents d JOIN users uu ON uu.id = d.uploaded_by
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
            ,query(
                `SELECT r.id, r.description, r.note, r.due_date, r.status, r.created_at, r.fulfilled_at, d.original_name AS fulfilled_document_name
                 FROM document_requests r LEFT JOIN documents d ON d.id = r.fulfilled_document_id
                 WHERE r.matter_id = $1 ORDER BY r.created_at DESC`,
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
            conversation: conversationRes.rows[0] || null,
            document_requests: docRequestsRes.rows
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
        await logAudit({ actorId: request.user.sub, action: 'REQUEST_INFO_REQUESTED', entityType: 'request', entityId: request.params.id, metadata: { has_message: !!input.message } });
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

        // Set Payment action - available for requests that are not resolved
        const blockedStatuses = new Set(['DECLINED', 'CLOSED']);
        if (!blockedStatuses.has(status)) {
            actions.push({ key: 'set_payment', label: 'Set Payment', method: 'POST', endpoint: `/api/v1/owner/requests/${req.id}/set-payment`, schema: { amount: 'number', description: 'string', currency: 'string?' }, options: null });
        }

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
            description: z.string().trim().max(4000).optional(),
            invoiceItems: z.array(z.object({
                description: z.string().trim().min(1).max(500),
                quantity: z.number().positive(),
                unit_price: z.number().nonnegative()
            })).optional()
        }).parse(request.body);
        const result = await acceptRequest({
            requestId: request.params.id,
            actorId: request.user.sub,
            matterType: input.matterType,
            title: input.title,
            description: input.description,
            invoiceItems: input.invoiceItems
        });
        await logAudit({ actorId: request.user.sub, action: 'REQUEST_ACCEPTED', entityType: 'request', entityId: request.params.id, metadata: { invoice_id: result.invoiceId || null } });
        response.status(201).json({ data: result });
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
        await logAudit({ actorId: request.user.sub, action: 'REQUEST_DECLINED', entityType: 'request', entityId: request.params.id, metadata: { has_reason: !!input.reason } });
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
        await logAudit({ actorId: request.user.sub, action: 'INTERNAL_NOTE_ADDED', entityType: 'request', entityId: request.params.id, metadata: { note_id: result.id } });
        response.status(201).json({ data: result });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/requests/:id/set-payment — set payment amount and description for a request */
const setPaymentSchema = z.object({
    amount: z.number().positive(),
    description: z.string().trim().min(1).max(2000),
    currency: z.string().trim().max(3).default('TZS').optional()
});

ownerRouter.post('/requests/:id/set-payment', async (request, response, next) => {
    try {
        const input = setPaymentSchema.parse(request.body);
        const invoice = await setPaymentForRequest({
            requestId: request.params.id,
            actorId: request.user.sub,
            amount: input.amount,
            description: input.description,
            currency: input.currency || 'TZS'
        });
        await logAudit({ actorId: request.user.sub, action: 'PAYMENT_SET', entityType: 'request', entityId: request.params.id, metadata: { invoice_id: invoice.id, amount: input.amount, currency: input.currency || 'TZS' } });
        /* Tell the client: a notification (bell + list) and a live update on any page they have open. */
        const currency = input.currency || 'TZS';
        try {
            await notify(invoice.client_id, {
                kind: 'PAYMENT_REQUESTED',
                title: 'Payment requested',
                body: `${currency} ${Number(input.amount).toLocaleString('en-US')}: ${input.description}. Open the invoice to pay.`,
                entityType: 'invoice',
                entityId: invoice.id
            });
            await notifyPaymentRequested(invoice.client_id, { requestId: request.params.id, invoiceId: invoice.id, amount: input.amount, currency });
        } catch (notifyError) { console.error('payment notification failed', notifyError.message); }
        response.json({ data: invoice });
    } catch (error) { next(error); }
});

/* GET /api/v1/owner/requests/:id/invoice — get the invoice for a request (if any) */
ownerRouter.get('/requests/:id/invoice', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT i.id, i.matter_id, i.client_id, i.request_id, i.status, i.currency, i.subtotal, i.tax, i.total,
                    i.issued_at, i.due_at, i.paid_at, i.payment_status, i.payment_instructions,
                    i.payment_lipa_number, i.payment_bank_name, i.payment_bank_account_name, i.payment_bank_account_number,
                    i.payment_qr_storage_key, i.payment_qr_content_type, i.payment_destination_method, i.payment_destination_label,
                    i.payment_destination_id, i.created_at, i.updated_at
             FROM invoices i
             WHERE i.request_id = $1 LIMIT 1`,
            [request.params.id]
        );
        if (result.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'No invoice found for this request' } });
        }
        response.json({ data: result.rows[0] });
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
        await logAudit({ actorId: request.user.sub, action: 'INTERNAL_NOTE_ADDED', entityType: 'matter', entityId: request.params.id, metadata: { note_id: result.id } });
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
        const created = await query(
            `INSERT INTO document_requests (matter_id, requested_by, description, note, due_date)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [matter.id, request.user.sub, input.description, input.message || null, input.dueDate || null]
        );
        const convoId = await conversationForMatter(matter.id);
        const convo = await findConversationFor(request.user, convoId);
        await postMessage({ user: request.user, convo, body: `Document request: ${input.description}${input.message ? ' — ' + input.message : ''}`, kind: 'DOCUMENT_REQUEST', notifyTitle: 'Document requested' });
        await notify(matter.client_id, {
            kind: 'DOCUMENT_REQUESTED',
            title: 'Document requested',
            body: input.description.slice(0, 160),
            entityType: 'matter',
            entityId: matter.id
        });
        notifyDocumentRequested(matter.id, matter.client_id, input.description).catch(() => {});
        await recordMatterEvent(matter.id, request.user.sub, 'DOCUMENT_REQUESTED', 'Document requested', input.description);
        await logAudit({ actorId: request.user.sub, action: 'DOCUMENT_REQUEST_SENT', entityType: 'matter', entityId: matter.id, metadata: { conversation_id: convoId, document_request_id: created.rows[0].id, has_message: !!input.message } });
        response.status(201).json({ data: { id: created.rows[0].id, matterId: matter.id, reference: matter.reference, conversationId: convoId } });
    } catch (error) { next(error); }
});

/* GET /api/v1/owner/matters/:id/document-requests — what was asked and whether it arrived. */
ownerRouter.get('/matters/:id/document-requests', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT r.id, r.description, r.note, r.due_date, r.status, r.created_at, r.fulfilled_at, r.fulfilled_document_id,
                    d.original_name AS fulfilled_document_name
             FROM document_requests r LEFT JOIN documents d ON d.id = r.fulfilled_document_id
             WHERE r.matter_id = $1 ORDER BY r.created_at DESC`,
            [request.params.id]
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/document-requests/:id/cancel — no longer needed. */
ownerRouter.post('/document-requests/:id/cancel', async (request, response, next) => {
    try {
        const result = await query(
            `UPDATE document_requests SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1 AND status = 'OPEN' RETURNING id`,
            [request.params.id]
        );
        if (result.rowCount === 0) return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'No open document request found' } });
        response.json({ data: { id: result.rows[0].id, status: 'CANCELLED' } });
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
         await logAudit({ actorId: request.user.sub, action: 'MATTER_ASSIGNED', entityType: 'matter', entityId: request.params.id, metadata: { assigned_user_id: input.userId } });
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
                    m.reference AS matter_reference, m.title AS matter_title,
                    inv.id AS invoice_id, inv.total AS invoice_total, inv.payment_status AS invoice_payment_status,
                    inv.payment_destination_method AS invoice_payment_method
             FROM appointments a
             JOIN users u ON u.id = a.client_id
             LEFT JOIN matters m ON m.id = a.matter_id
             LEFT JOIN invoices inv ON inv.appointment_id = a.id
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
                    m.reference AS matter_reference, m.title AS matter_title,
                    inv.id AS invoice_id, inv.total AS invoice_total, inv.payment_status AS invoice_payment_status,
                    inv.payment_destination_method AS invoice_payment_method, inv.currency AS invoice_currency
             FROM appointments a
             JOIN users u ON u.id = a.client_id
             LEFT JOIN matters m ON m.id = a.matter_id
             LEFT JOIN invoices inv ON inv.appointment_id = a.id
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
          await logAudit({ actorId: request.user.sub, action: 'APPOINTMENT_CREATED', entityType: 'appointment', entityId: result.id, metadata: { matter_id: result.matter_id || null, client_id: result.client_id } });
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
          await logAudit({ actorId: request.user.sub, action: 'APPOINTMENT_RESCHEDULED', entityType: 'appointment', entityId: result.id, metadata: { matter_id: result.matter_id || null, client_id: result.client_id } });
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
        await logAudit({ actorId: request.user.sub, action: 'APPOINTMENT_STATUS_CHANGED', entityType: 'appointment', entityId: request.params.id, metadata: { new_status: input.status, has_reason: !!input.reason } });
        response.json({ data: result });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/appointments/:id/accept — confirm a booked consultation.
   Idempotent. Creates exactly one linked invoice (createInvoiceForAppointment).
   Does NOT create a Matter — the consultation lifecycle stays separate. */
ownerRouter.post('/appointments/:id/accept', async (request, response, next) => {
    try {
        const input = z.object({ notes: z.string().trim().max(2000).optional() }).parse(request.body || {});
        const result = await acceptConsultation({
            appointmentId: request.params.id,
            actorId: request.user.sub,
            notes: input.notes
        });
        await logAudit({
            actorId: request.user.sub,
            action: 'APPOINTMENT_CONFIRMED',
            entityType: 'appointment',
            entityId: request.params.id,
            metadata: { invoice_id: result.invoice?.id || null, notes: input.notes || null }
        });
        response.json({ data: { appointment: result.appointment, invoice: result.invoice } });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/appointments/:id/decline — decline a booked consultation. */
ownerRouter.post('/appointments/:id/decline', async (request, response, next) => {
    try {
        const input = z.object({ reason: z.string().trim().max(2000).optional() }).parse(request.body || {});
        const result = await declineConsultation({
            appointmentId: request.params.id,
            actorId: request.user.sub,
            reason: input.reason
        });
        await logAudit({
            actorId: request.user.sub,
            action: 'APPOINTMENT_CANCELLED',
            entityType: 'appointment',
            entityId: request.params.id,
            metadata: { has_reason: !!input.reason }
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
         await logAudit({ actorId: request.user.sub, action: 'APPOINTMENT_CANCELLED', entityType: 'appointment', entityId: request.params.id, metadata: { has_reason: !!reason } });
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

/* --- Payment Management --- */

/* GET /api/v1/owner/payments?method=&status=&page=&limit= */
ownerRouter.get('/payments', async (request, response, next) => {
    try {
        const q = z.object({
            method: z.enum(['mobile_money', 'bank', 'qr']).optional(),
            status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).optional(),
            invoice_id: z.string().uuid().optional(),
            page: z.coerce.number().min(1).default(1),
            limit: z.coerce.number().min(1).max(200).default(50)
        }).parse(request.query);
        const result = await listPaymentsForOwner({ method: q.method, status: q.status, invoiceId: q.invoice_id, page: q.page, limit: q.limit });
        response.json(result);
    } catch (error) { next(error); }
});

/* GET /api/v1/owner/payments/:id */
ownerRouter.get('/payments/:id', async (request, response, next) => {
    try {
        const payment = await getPaymentById(request.params.id);
        if (!payment) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment not found' } });
        }
        response.json({ data: payment });
    } catch (error) { next(error); }
});

/* GET /api/v1/owner/payments/:id/receipt — stream payment receipt (owner only). */
ownerRouter.get('/payments/:id/receipt', async (request, response, next) => {
    try {
        const payment = await getPaymentById(request.params.id);
        if (!payment) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment not found' } });
        }
        if (!payment.receipt_storage_key || !payment.receipt_content_type) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Receipt not found' } });
        }
        const filePath = receiptPath(payment.receipt_storage_key);
        if (!existsSync(filePath)) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Receipt file not found' } });
        }
        response.writeHead(200, {
            'Content-Type': payment.receipt_content_type,
            'Content-Disposition': `inline; filename="${payment.receipt_original_name || 'receipt'}"`,
            'Content-Length': payment.receipt_size_bytes || undefined,
            'Cache-Control': 'private, max-age=3600'
        });
        const stream = createReadStream(filePath);
        stream.on('error', () => response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to read receipt' } }));
        stream.pipe(response);
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/payments/:id/verify */
ownerRouter.post('/payments/:id/verify', async (request, response, next) => {
    try {
        const result = await verifyPayment({
            paymentId: request.params.id,
            actorId: request.user.sub
        });
        /* Create Matter for the request after payment is approved.
           createMatterForRequest is idempotent — if a Matter already exists
           for this request it returns the existing one.
           Consultation payments (invoice linked to an appointment) must NOT
           create a Matter — the consultation lifecycle stays separate. */
        let matter = null;
        let consultationReviewRequired = false;
        let appointmentConfirmed = false;
        if (result.invoiceRequestId) {
            const reqInfo = await query(
                `SELECT id, subject, status FROM requests WHERE id = $1 LIMIT 1`,
                [result.invoiceRequestId]
            );
            const requestRecord = reqInfo.rows[0];
            consultationReviewRequired = Boolean(requestRecord && isConsultationRequest(requestRecord.subject));

            if (consultationReviewRequired) {
                await query(
                    `UPDATE requests SET status = 'UNDER_REVIEW', updated_at = NOW()
                     WHERE id = $1 AND status NOT IN ('ACCEPTED', 'DECLINED', 'COMPLETED', 'CLOSED')`,
                    [result.invoiceRequestId]
                );
            } else {
                const title = requestRecord?.subject || 'Payment approved — matter opened';
                matter = await createMatterForRequest({
                    requestId: result.invoiceRequestId,
                    actorId: request.user.sub,
                    title: title,
                    matterType: null,
                    description: null
                });
            }
        } else if (result.invoiceAppointmentId) {
            /* Consultation payment verified — confirm the appointment. */
            const apptCheck = await query(
                `SELECT id, status FROM appointments WHERE id = $1 LIMIT 1`,
                [result.invoiceAppointmentId]
            );
            if (apptCheck.rowCount > 0 && apptCheck.rows[0].status !== 'CONFIRMED') {
                await query(
                    `UPDATE appointments SET status = 'CONFIRMED', updated_at = NOW()
                     WHERE id = $1 AND status NOT IN ('CANCELLED', 'COMPLETED', 'NO_SHOW')`,
                    [result.invoiceAppointmentId]
                );
                appointmentConfirmed = true;
            }
        }
        await logAudit({
            actorId: request.user.sub,
            action: 'PAYMENT_VERIFIED',
            entityType: 'payment',
            entityId: request.params.id,
            metadata: { invoice_id: result.invoiceId, amount: Number(result.payment.amount), matter_id: matter?.id || null, appointment_id: result.invoiceAppointmentId || null, consultation_review_required: consultationReviewRequired, appointment_confirmed: appointmentConfirmed }
        });
        await notify(result.clientId, {
            kind: 'PAYMENT_VERIFIED',
            title: 'Payment verified',
            body: 'Your payment has been verified and the invoice is now marked as paid.',
            entityType: 'payment',
            entityId: request.params.id
        });
        await notifyPaymentVerified(
            result.payment.id, result.invoiceId, result.clientId,
            Number(result.payment.amount), result.payment.currency
        );
        if (matter) {
            await notify(result.clientId, {
                kind: 'MATTER_CREATED',
                title: 'Your matter has been opened',
                body: `Reference ${matter.reference}`,
                entityType: 'matter',
                entityId: matter.id
            });
        }
        response.json({ data: { ...result.payment, matter: matter ? { id: matter.id, reference: matter.reference, status: matter.status } : null, appointment_id: result.invoiceAppointmentId || null, appointment_confirmed: appointmentConfirmed } });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/payments/:id/reject */
ownerRouter.post('/payments/:id/reject', async (request, response, next) => {
    try {
        const input = z.object({ reason: z.string().trim().min(1).max(1000).optional() }).parse(request.body || {});
        const payment = await getPaymentById(request.params.id);
        if (!payment) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment not found' } });
        }
        await rejectPayment({
            paymentId: request.params.id,
            actorId: request.user.sub,
            reason: input.reason
        });
        await logAudit({
            actorId: request.user.sub,
            action: 'PAYMENT_REJECTED',
            entityType: 'payment',
            entityId: request.params.id,
            metadata: { invoice_id: payment.invoice_id, has_reason: !!input.reason }
        });
        await notify(payment.client_id, {
            kind: 'PAYMENT_REJECTED',
            title: 'Payment rejected',
            body: input.reason
                ? `Your payment was rejected: ${input.reason.slice(0, 160)}`
                : 'Your payment was rejected. Please review the details and resubmit.',
            entityType: 'payment',
            entityId: request.params.id
        });
        await notifyPaymentRejected(request.params.id, payment.invoice_id, payment.client_id, input.reason || null);
        response.json({ data: { id: request.params.id, status: 'REJECTED' } });
    } catch (error) { next(error); }
});

/* --- Payment Destinations CRUD --- */

/* GET /api/v1/owner/payment-destinations */
ownerRouter.get('/payment-destinations', async (_request, response, next) => {
    try {
        const destinations = await getPaymentDestinations();
        response.json({ data: destinations });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/payment-destinations */
const createDestinationSchema = z.object({
    method: z.literal('mobile_money'), // Lipa Namba only: works with every mobile network and bank
    label: z.string().trim().min(1).max(200),
    lipa_number: z.string().trim().min(1).max(100),
    bank_name: z.string().trim().max(200).optional(),
    bank_account_name: z.string().trim().max(200).optional(),
    bank_account_number: z.string().trim().max(100).optional(),
    instructions: z.string().trim().max(1000).optional(),
    is_active: z.boolean().optional()
});

ownerRouter.post('/payment-destinations', async (request, response, next) => {
    try {
        const input = createDestinationSchema.parse(request.body);
        const dest = await createPaymentDestination(input);
        await logAudit({ actorId: request.user.sub, action: 'PAYMENT_DESTINATION_CREATED', entityType: 'payment_destination', entityId: dest.id, metadata: { method: dest.method } });
        response.status(201).json({ data: dest });
    } catch (error) { next(error); }
});

/* PATCH /api/v1/owner/payment-destinations/:id */
const updateDestinationSchema = z.object({
    method: z.literal('mobile_money').optional(),
    label: z.string().trim().min(1).max(200).optional(),
    lipa_number: z.string().trim().max(100).optional(),
    bank_name: z.string().trim().max(200).optional(),
    bank_account_name: z.string().trim().max(200).optional(),
    bank_account_number: z.string().trim().max(100).optional(),
    instructions: z.string().trim().max(1000).optional(),
    is_active: z.boolean().optional()
});

ownerRouter.patch('/payment-destinations/:id', async (request, response, next) => {
    try {
        const input = updateDestinationSchema.parse(request.body || {});
        const dest = await updatePaymentDestination(request.params.id, input);
        if (!dest) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment destination not found' } });
        }
        await logAudit({ actorId: request.user.sub, action: 'PAYMENT_DESTINATION_UPDATED', entityType: 'payment_destination', entityId: request.params.id, metadata: { updates: Object.keys(input) } });
        response.json({ data: dest });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/payment-destinations/:id/qr — upload QR code for payment destination */
const uploadQRSchema = z.object({
    qr: z.string().min(1)
});

ownerRouter.post('/payment-destinations/:id/qr', async (request, response, next) => {
    try {
        const input = uploadQRSchema.parse(request.body);
        const dest = await uploadPaymentDestinationQR(request.params.id, input.qr);
        if (!dest) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment destination not found' } });
        }
        await logAudit({ actorId: request.user.sub, action: 'PAYMENT_DESTINATION_QR_UPLOADED', entityType: 'payment_destination', entityId: request.params.id });
        response.json({ data: dest });
    } catch (error) { next(error); }
});

/* DELETE /api/v1/owner/payment-destinations/:id/qr — remove QR code from payment destination */
ownerRouter.delete('/payment-destinations/:id/qr', async (request, response, next) => {
    try {
        const dest = await removePaymentDestinationQR(request.params.id);
        if (!dest) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment destination not found' } });
        }
        await logAudit({ actorId: request.user.sub, action: 'PAYMENT_DESTINATION_QR_REMOVED', entityType: 'payment_destination', entityId: request.params.id });
        response.json({ data: dest });
    } catch (error) { next(error); }
});

/* --- Service Catalog CRUD --- */

/* GET /api/v1/owner/service-catalog?activeOnly= */
ownerRouter.get('/service-catalog', async (request, response, next) => {
    try {
        const activeOnly = request.query.activeOnly === 'true';
        const services = await getServiceCatalog({ activeOnly });
        response.json({ data: services });
    } catch (error) { next(error); }
});

/* POST /api/v1/owner/service-catalog */
const createServiceSchema = z.object({
    code: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(1000).optional(),
    pricing_mode: z.enum(['FIXED', 'CUSTOM']),
    fixed_price: z.coerce.number().min(0).default(0)
});

ownerRouter.post('/service-catalog', async (request, response, next) => {
    try {
        const input = createServiceSchema.parse(request.body);
        const result = await query(
            `INSERT INTO service_catalog (code, name, description, pricing_mode, fixed_price)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, code, name, description, pricing_mode, fixed_price, is_active, created_at, updated_at`,
            [input.code, input.name, input.description || null, input.pricing_mode, input.fixed_price]
        );
        await logAudit({ actorId: request.user.sub, action: 'SERVICE_CREATED', entityType: 'service_catalog', entityId: result.rows[0].id, metadata: { code: input.code, pricing_mode: input.pricing_mode } });
        response.status(201).json({ data: result.rows[0] });
    } catch (error) { next(error); }
});

/* PATCH /api/v1/owner/service-catalog/:id */
const updateServiceSchema = z.object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(1000).optional(),
    pricing_mode: z.enum(['FIXED', 'CUSTOM']).optional(),
    fixed_price: z.coerce.number().min(0).optional(),
    is_active: z.boolean().optional()
});

ownerRouter.patch('/service-catalog/:id', async (request, response, next) => {
    try {
        const input = updateServiceSchema.parse(request.body || {});
        if (Object.keys(input).length === 0) {
            return response.status(400).json({ error: { code: 'BAD_REQUEST', message: 'No fields to update' } });
        }
        const updates = [];
        const params = [];
        let i = 1;
        if (input.name !== undefined) { updates.push(`name = $${i}`); params.push(input.name); i++; }
        if (input.description !== undefined) { updates.push(`description = $${i}`); params.push(input.description); i++; }
        if (input.pricing_mode !== undefined) { updates.push(`pricing_mode = $${i}`); params.push(input.pricing_mode); i++; }
        if (input.fixed_price !== undefined) { updates.push(`fixed_price = $${i}`); params.push(input.fixed_price); i++; }
        if (input.is_active !== undefined) { updates.push(`is_active = $${i}`); params.push(input.is_active); i++; }
        params.push(request.params.id);
        const result = await query(
            `UPDATE service_catalog SET ${updates.join(', ')}, updated_at = NOW()
             WHERE id = $${i}
             RETURNING id, code, name, description, pricing_mode, fixed_price, is_active, created_at, updated_at`,
            [...params]
        );
        if (result.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Service not found' } });
        }
        await logAudit({ actorId: request.user.sub, action: 'SERVICE_UPDATED', entityType: 'service_catalog', entityId: request.params.id, metadata: { updates: Object.keys(input) } });
        response.json({ data: result.rows[0] });
    } catch (error) { next(error); }
});
