import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db.js';
import { ensureOwned } from '../lib/authorization.js';
import { logAudit } from '../lib/audit.js';

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
        /* Storage backend is not yet wired. Return a controlled 501 so the
           portal can show an honest "not yet available" state instead of
           pretending to serve bytes. The metadata + ownership check happens
           here so the security boundary is enforced. */
        return response.status(501).json({
            error: {
                code: 'STORAGE_NOT_CONFIGURED',
                message: 'Document storage is not yet configured. The metadata is recorded but bytes cannot be served yet.'
            }
        });
    } catch (error) { next(error); }
});
