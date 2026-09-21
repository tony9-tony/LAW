import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db.js';
import { ensureOwned } from '../lib/authorization.js';
import { logAudit } from '../lib/audit.js';
import multer from 'multer';
import { saveUploadedFile, storageFilePath, deleteStoredFile } from '../services/upload.service.js';
import fs from 'node:fs/promises';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

export const documentRouter = Router();
documentRouter.use(authenticate);

/* Documents accessible to the authenticated client across all matters. */
documentRouter.get('/', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT d.id, d.matter_id, d.original_name, d.content_type, d.size_bytes,
                    d.status, d.created_at, d.updated_at,
                    m.reference AS matter_reference, m.title AS matter_title
             FROM documents d
             JOIN matters m ON m.id = d.matter_id
             WHERE m.client_id = $1 AND d.status <> 'DELETED'
             ORDER BY d.created_at DESC`,
            [request.user.sub]
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

/* POST /api/v1/documents — upload a document to one of the client's matters. */
documentRouter.post('/', upload.single('file'), async (request, response, next) => {
    try {
        if (!request.file) {
            return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'File is required. Attach it as "file" in a multipart/form-data request.' } });
        }
        const { matter_id } = request.body;
        if (!matter_id) {
            return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'matter_id is required.' } });
        }

        const matterCheck = await query(
            `SELECT id, client_id FROM matters WHERE id = $1 LIMIT 1`,
            [matter_id]
        );
        if (matterCheck.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Matter not found.' } });
        }
        if (matterCheck.rows[0].client_id !== request.user.sub) {
            return response.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this matter.' } });
        }

        const fileInfo = await saveUploadedFile(
            request.file.buffer,
            request.file.originalname,
            request.file.mimetype
        );

        const inserted = await query(
            `INSERT INTO documents
                (matter_id, uploaded_by, storage_key, original_name, content_type, size_bytes, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'AVAILABLE', NOW(), NOW())
             RETURNING id, matter_id, uploaded_by, storage_key, original_name, content_type, size_bytes, status, created_at, updated_at`,
            [matter_id, request.user.sub, fileInfo.storageKey, fileInfo.originalName, fileInfo.contentType, fileInfo.sizeBytes]
        );

        await logAudit({
            actorId: request.user.sub,
            action: 'DOCUMENT_UPLOADED',
            entityType: 'document',
            entityId: inserted.rows[0].id,
            metadata: { matter_id, original_name: fileInfo.originalName, size_bytes: fileInfo.sizeBytes }
        });

        response.status(201).json({ data: inserted.rows[0] });
    } catch (error) { next(error); }
});

documentRouter.get('/:id/download', async (request, response, next) => {
    try {
        const doc = await query(
            `SELECT d.id, d.matter_id, d.original_name, d.content_type, d.storage_key, d.status,
                    m.client_id
             FROM documents d JOIN matters m ON m.id = d.matter_id
             WHERE d.id = $1 LIMIT 1`,
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
        response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(d.original_name || 'download')}"`);
        response.setHeader('Cache-Control', 'private, max-age=3600');
        response.sendFile(filePath);
    } catch (error) { next(error); }
});
