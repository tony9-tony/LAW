import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db.js';
import { config } from '../config.js';
import { notifyNotificationCreated } from '../services/sse.js';
import { logAudit } from '../lib/audit.js';

export const profileRouter = Router();
profileRouter.use(authenticate);

/* Supported photo MIME types and their extensions. */
const PHOTO_TYPES = new Map([
    ['image/png', '.png'],
    ['image/jpeg', '.jpg'],
    ['image/webp', '.webp'],
    ['image/gif', '.gif']
]);
const MAX_PHOTO_BYTES = 2 * 1024 * 1024; /* 2 MB */

function uploadRoot() {
    const dir = path.resolve(config.uploadDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function photoPath(storageKey) {
    const dir = path.join(uploadRoot(), path.dirname(storageKey));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(uploadRoot(), storageKey);
}

profileRouter.get('/', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT id, email, full_name, role, is_active, created_at, updated_at,
                    photo_content_type, photo_updated_at
             FROM users WHERE id = $1 LIMIT 1`,
            [request.user.sub]
        );
        if (result.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
        }
        response.json({ data: result.rows[0] });
    } catch (error) { next(error); }
});

/* PATCH /api/v1/profile — update email/full_name (OWNER cannot be downgraded). */
profileRouter.patch('/', async (request, response, next) => {
    try {
        const input = z.object({
            full_name: z.string().trim().min(1).max(200).optional(),
            email: z.string().email().optional()
        }).parse(request.body || {});

        const updates = [];
        const params = [];
        let i = 1;
        if (input.full_name !== undefined) { updates.push(`full_name = $${i}`); params.push(input.full_name); i++; }
        if (input.email !== undefined) { updates.push(`email = $${i}`); params.push(input.email); i++; }
        if (updates.length === 0) {
            return response.status(400).json({ error: { code: 'BAD_REQUEST', message: 'No fields to update' } });
        }
        params.push(request.user.sub);
        const result = await query(
            `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${i}
             RETURNING id, email, full_name, role, is_active, updated_at`,
            params
        );
        await logAudit({ actorId: request.user.sub, action: 'PROFILE_UPDATED', entityType: 'user', entityId: request.user.sub, metadata: { fields: updates.map(u => u.replace(/ .*/,'').replace(/"/g,'')) } });
        response.json({ data: result.rows[0] });
    } catch (error) { next(error); }
});

/* POST /api/v1/profile/photo — upload a profile photo (Base64 data URL). */
profileRouter.post('/photo', async (request, response, next) => {
    try {
        const input = z.object({
            photo: z.string().min(1)
        }).parse(request.body || {});

        const match = input.photo.match(/^data:(image\/[a-z.+-]+);base64,(.+)$/i);
        if (!match) {
            return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid image data' } });
        }
        const mime = match[1].toLowerCase();
        if (!PHOTO_TYPES.has(mime)) {
            return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Unsupported image type' } });
        }
        let buffer;
        try {
            buffer = Buffer.from(match[2], 'base64');
        } catch {
            return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid base64 data' } });
        }
        if (buffer.length > MAX_PHOTO_BYTES) {
            return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Photo exceeds 2 MB' } });
        }

        const ext = PHOTO_TYPES.get(mime);
        const storageKey = `profiles/${request.user.sub.slice(0, 2)}/${crypto.randomUUID()}${ext}`;
        const filePath = photoPath(storageKey);
        fs.writeFileSync(filePath, buffer);

        await query(
            `UPDATE users SET photo_storage_key = $1, photo_content_type = $2,
                    photo_etag = $3, photo_updated_at = NOW(), updated_at = NOW()
             WHERE id = $4`,
            [storageKey, mime, crypto.randomUUID(), request.user.sub]
        );

        await notifyNotificationCreated(request.user.sub, {
            id: crypto.randomUUID(),
            kind: 'PROFILE_UPDATED',
            title: 'Profile photo updated',
            body: 'Your profile photo has been updated.',
            entity_type: 'profile',
            entity_id: request.user.sub,
            created_at: new Date().toISOString()
        });
        await logAudit({ actorId: request.user.sub, action: 'PROFILE_PHOTO_UPLOADED', entityType: 'user', entityId: request.user.sub });

        response.json({ data: { photo_updated_at: new Date().toISOString() } });
    } catch (error) { next(error); }
});

/* GET /api/v1/profile/photo — serve the authenticated user's photo (streaming). */
profileRouter.get('/photo', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT photo_storage_key, photo_content_type, photo_etag FROM users WHERE id = $1 LIMIT 1`,
            [request.user.sub]
        );
        if (result.rowCount === 0 || !result.rows[0].photo_storage_key) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'No photo on record' } });
        }
        const row = result.rows[0];
        if (request.headers['if-none-match'] === `"${row.photo_etag}"`) {
            response.writeHead(304);
            return response.end();
        }
        const filePath = photoPath(row.photo_storage_key);
        if (!fs.existsSync(filePath)) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Photo not found' } });
        }
        response.writeHead(200, {
            'Content-Type': row.photo_content_type,
            'ETag': `"${row.photo_etag}"`,
            'Cache-Control': 'private, max-age=86400'
        });
        const stream = fs.createReadStream(filePath);
        stream.on('error', () => response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to read photo' } }));
        stream.pipe(response);
    } catch (error) { next(error); }
});

/* --- Settings --- */
profileRouter.get('/settings', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT theme, notify_email, notify_push, reduced_motion, font_size, updated_at
             FROM user_settings WHERE user_id = $1`,
            [request.user.sub]
        );
        if (result.rowCount === 0) {
            return response.json({ data: { theme: 'system', notify_email: true, notify_push: true, reduced_motion: false, font_size: 'medium' } });
        }
        response.json({ data: result.rows[0] });
    } catch (error) { next(error); }
});

profileRouter.patch('/settings', async (request, response, next) => {
    try {
        const input = z.object({
            theme: z.enum(['light', 'dark', 'system']).optional(),
            notify_email: z.boolean().optional(),
            notify_push: z.boolean().optional(),
            reduced_motion: z.boolean().optional(),
            font_size: z.enum(['small', 'medium', 'large']).optional()
        }).parse(request.body || {});

        const cols = [];
        const params = [];
        let i = 1;
        for (const [k, v] of Object.entries(input)) {
            if (v === undefined) continue;
            cols.push(`"${k}" = $${i}`);
            params.push(v);
            i++;
        }
        if (!cols.length) {
            return response.status(400).json({ error: { code: 'BAD_REQUEST', message: 'No settings to update' } });
        }
        const result = await query(
            `INSERT INTO user_settings (user_id, theme, notify_email, notify_push, reduced_motion, font_size, updated_at)
             VALUES ($${i}, 'system', true, true, false, 'medium', NOW())
             ON CONFLICT (user_id) DO UPDATE SET ${cols.join(', ')}, updated_at = NOW()
             RETURNING user_id, theme, notify_email, notify_push, reduced_motion, font_size, updated_at`,
            [...params, request.user.sub]
        );
        await logAudit({ actorId: request.user.sub, action: 'SETTINGS_UPDATED', entityType: 'user', entityId: request.user.sub, metadata: { fields: cols.map(c => c.replace(/ .*/,'').replace(/"/g,'')) } });
        response.json({ data: result.rows[0] });
    } catch (error) { next(error); }
});
