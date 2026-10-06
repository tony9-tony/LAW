/* Documents: storing a file against a matter, and making sure it reaches the
   other side (matter timeline, the matter's chat, a notification and a live
   event). A document that answers a document request closes that request. */
import path from 'node:path';
import { query } from '../db.js';
import { saveUploadedFile } from './upload.service.js';
import { recordMatterEvent } from './workflow.service.js';
import { conversationForMatter, findConversationFor, postMessage } from './chat.service.js';
import { notifyDocumentCreated } from './sse.js';
import { logAudit } from '../lib/audit.js';

/* Files that can run code are never accepted. */
const BLOCKED_EXTENSIONS = new Set(['.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.js', '.mjs', '.vbs', '.ps1', '.sh', '.jar', '.html', '.htm', '.svg', '.php']);

function fail(statusCode, code, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

export async function storeDocument({ user, matterId, file, originalName, requestId = null }) {
    if (!file) throw fail(400, 'VALIDATION_ERROR', 'File is required. Attach it as "file" in a multipart/form-data request.');
    if (!matterId) throw fail(400, 'VALIDATION_ERROR', 'matter_id is required.');
    const shownName = originalName || file.originalname;
    if (BLOCKED_EXTENSIONS.has(path.extname(shownName || '').toLowerCase()) || BLOCKED_EXTENSIONS.has(path.extname(file.originalname || '').toLowerCase())) {
        throw fail(400, 'FILE_TYPE_NOT_ALLOWED', 'This type of file cannot be uploaded. Use PDF, Word, Excel, an image or a similar document.');
    }
    const matter = (await query(`SELECT id, client_id, reference, title FROM matters WHERE id = $1 LIMIT 1`, [matterId])).rows[0];
    if (!matter) throw fail(404, 'NOT_FOUND', 'Matter not found.');
    const isFirm = user.role === 'OWNER';
    if (!isFirm && matter.client_id !== user.sub) throw fail(403, 'FORBIDDEN', 'You do not have access to this matter.');

    let documentRequest = null;
    if (requestId) {
        documentRequest = (await query(
            `SELECT id, description FROM document_requests WHERE id = $1 AND matter_id = $2 AND status = 'OPEN' LIMIT 1`,
            [requestId, matter.id]
        )).rows[0];
        if (!documentRequest) throw fail(404, 'NOT_FOUND', 'That document request is not open any more.');
    }

    const info = await saveUploadedFile(file.buffer, shownName, file.mimetype);
    const inserted = await query(
        `INSERT INTO documents (matter_id, uploaded_by, storage_key, original_name, content_type, size_bytes, status, document_request_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'AVAILABLE', $7, NOW(), NOW())
         RETURNING id, matter_id, uploaded_by, original_name, content_type, size_bytes, status, document_request_id, created_at, updated_at`,
        [matter.id, user.sub, info.storageKey, info.originalName, info.contentType, info.sizeBytes, documentRequest ? documentRequest.id : null]
    );
    const document = inserted.rows[0];

    if (documentRequest) {
        await query(
            `UPDATE document_requests SET status = 'FULFILLED', fulfilled_document_id = $2, fulfilled_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [documentRequest.id, document.id]
        );
    }

    /* Where it lands: the matter timeline, the matter's chat, a notification and a live event. */
    await recordMatterEvent(matter.id, user.sub, 'DOCUMENT_UPLOADED',
        isFirm ? 'Document shared by the firm' : 'Document uploaded by the client',
        documentRequest ? `${document.original_name} (for: ${documentRequest.description})` : document.original_name);
    const convo = await findConversationFor(user, await conversationForMatter(matter.id));
    const body = isFirm
        ? `Shared a document: ${document.original_name}`
        : documentRequest ? `Uploaded "${document.original_name}" for: ${documentRequest.description}` : `Uploaded a document: ${document.original_name}`;
    await postMessage({ user, convo, body, kind: 'DOCUMENT', documentId: document.id, notifyTitle: isFirm ? 'New document from the firm' : `New document · ${matter.reference || 'matter'}` });
    notifyDocumentCreated(matter.id, matter.client_id, { id: document.id, original_name: document.original_name }, user.sub, documentRequest ? documentRequest.id : null).catch(() => {});
    await logAudit({ actorId: user.sub, action: 'DOCUMENT_UPLOADED', entityType: 'document', entityId: document.id, metadata: { matter_id: matter.id, original_name: document.original_name, size_bytes: document.size_bytes, request_id: documentRequest ? documentRequest.id : null } });
    return document;
}

/* Soft delete. Reopens the document request this file had answered. */
export async function removeDocument({ user, documentId }) {
    const doc = (await query(
        `SELECT d.id, d.uploaded_by, d.matter_id, d.original_name, m.client_id FROM documents d JOIN matters m ON m.id = d.matter_id WHERE d.id = $1 AND d.status <> 'DELETED'`,
        [documentId]
    )).rows[0];
    if (!doc) throw fail(404, 'NOT_FOUND', 'Document not found');
    const isFirm = user.role === 'OWNER';
    if (!isFirm && (doc.client_id !== user.sub || doc.uploaded_by !== user.sub)) throw fail(403, 'FORBIDDEN', 'You can only remove documents you uploaded.');
    await query(`UPDATE documents SET status = 'DELETED', updated_at = NOW() WHERE id = $1`, [doc.id]);
    await query(`UPDATE document_requests SET status = 'OPEN', fulfilled_document_id = NULL, fulfilled_at = NULL, updated_at = NOW() WHERE fulfilled_document_id = $1`, [doc.id]);
    await recordMatterEvent(doc.matter_id, user.sub, 'DOCUMENT_REMOVED', 'Document removed', doc.original_name);
    await logAudit({ actorId: user.sub, action: 'DOCUMENT_DELETED', entityType: 'document', entityId: doc.id, metadata: { matter_id: doc.matter_id } });
    return doc;
}
