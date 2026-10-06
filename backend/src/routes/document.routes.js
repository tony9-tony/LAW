import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db.js';
import { logAudit } from '../lib/audit.js';
import multer from 'multer';
import { storageFilePath } from '../services/upload.service.js';
import { storeDocument, removeDocument } from '../services/document.service.js';
import fs from 'node:fs/promises';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

export const documentRouter = Router();
documentRouter.use(authenticate);

const LIST_COLUMNS = `d.id, d.matter_id, d.original_name, d.content_type, d.size_bytes,
                    d.status, d.created_at, d.updated_at, d.uploaded_by, d.document_request_id,
                    m.reference AS matter_reference, m.title AS matter_title,
                    uu.role AS uploaded_by_role, uu.full_name AS uploaded_by_name,
                    dr.description AS request_description`;
const LIST_FROM = `FROM documents d
             JOIN matters m ON m.id = d.matter_id
             JOIN users uu ON uu.id = d.uploaded_by
             LEFT JOIN document_requests dr ON dr.id = d.document_request_id`;

/* Documents accessible to the authenticated client across all matters. */
documentRouter.get('/', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT ${LIST_COLUMNS} ${LIST_FROM}
             WHERE m.client_id = $1 AND d.status <> 'DELETED'
             ORDER BY d.created_at DESC`,
            [request.user.sub]
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

/* Documents the firm is still waiting for from this client. */
documentRouter.get('/requests', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT r.id, r.matter_id, r.description, r.note, r.due_date, r.status, r.created_at,
                    m.reference AS matter_reference, m.title AS matter_title
             FROM document_requests r JOIN matters m ON m.id = r.matter_id
             WHERE m.client_id = $1 AND r.status = 'OPEN'
             ORDER BY r.created_at DESC`,
            [request.user.sub]
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

/* POST /api/v1/documents — upload a document to one of the client's matters.
   Send request_id to answer one of the firm's document requests. */
documentRouter.post('/', upload.single('file'), async (request, response, next) => {
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

documentRouter.get('/:id', async (request, response, next) => {
    try {
        if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
        const result = await query(
            `SELECT ${LIST_COLUMNS}, d.storage_key ${LIST_FROM}
             WHERE d.id = $1 AND m.client_id = $2 AND d.status <> 'DELETED' LIMIT 1`,
            [request.params.id, request.user.sub]
        );
        if (result.rowCount === 0) return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
        response.json({ data: result.rows[0] });
    } catch (error) { next(error); }
});

documentRouter.delete('/:id', async (request, response, next) => {
    try {
        await removeDocument({ user: request.user, documentId: request.params.id });
        response.json({ data: { id: request.params.id, deleted: true } });
    } catch (error) { next(error); }
});

documentRouter.get('/:id/download', async (request, response, next) => {
    try {
        const doc = await query(
            `SELECT d.id, d.matter_id, d.original_name, d.content_type, d.storage_key, d.status,
                    m.client_id
             FROM documents d JOIN matters m ON m.id = d.matter_id
             WHERE d.id = $1 AND d.status <> 'DELETED' LIMIT 1`,
            [request.params.id]
        );
        if (doc.rowCount === 0 || doc.rows[0].client_id !== request.user.sub) {
            await logAudit({ actorId: request.user.sub, action: 'DOCUMENT_ACCESS_DENIED', entityType: 'document', entityId: null, metadata: { document_id: request.params.id } });
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
        }
        const d = doc.rows[0];
        const filePath = storageFilePath(d.storage_key);
        if (!filePath) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found on server.' } });
        }
        try {
            await fs.access(filePath);
        } catch {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'File has been removed from storage.' } });
        }
        response.setHeader('Content-Type', d.content_type || 'application/octet-stream');
        response.setHeader('Content-Disposition', `${request.query.inline === '1' ? 'inline' : 'attachment'}; filename="${encodeURIComponent(d.original_name || 'download')}"`);
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Cache-Control', 'private, max-age=3600');
        response.sendFile(filePath);
    } catch (error) { next(error); }
});
