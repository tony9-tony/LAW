/* Secure read-only streaming for uploaded payment assets.

   QR code images are stored under `uploads/payment-qr/<bucket>/<uuid>.<ext>`
   and referenced by their storage key. This route is the only way they are
   served: authentication is required (Bearer token, or ?token= for <img>
   tags), the path is validated segment-by-segment and resolved inside the
   configured upload directory, so manipulating the URL cannot reach receipts,
   matter documents, or any other project file. */
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { authenticate } from '../middleware/auth.js';
import { config } from '../config.js';

const IMAGE_TYPES = new Map([
    ['png', 'image/png'],
    ['jpg', 'image/jpeg'],
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp'],
    ['gif', 'image/gif']
]);

const BUCKET_SEGMENT = /^[A-Za-z0-9_-]{1,40}$/;
const FILE_SEGMENT = /^[A-Za-z0-9-]+\.(png|jpe?g|webp|gif)$/i;

export const uploadsRouter = Router();
uploadsRouter.use(authenticate);

uploadsRouter.get('/payment-qr/:bucket/:file', (request, response, next) => {
    try {
        const { bucket, file } = request.params;
        if (!BUCKET_SEGMENT.test(bucket) || !FILE_SEGMENT.test(file) || file.includes('..')) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
        }
        const uploadRoot = path.resolve(config.uploadDir);
        const filePath = path.resolve(uploadRoot, 'payment-qr', bucket, file);
        if (!filePath.startsWith(uploadRoot + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
        }
        const extension = path.extname(file).slice(1).toLowerCase();
        const stats = fs.statSync(filePath);
        response.writeHead(200, {
            'Content-Type': IMAGE_TYPES.get(extension) || 'application/octet-stream',
            'Content-Length': stats.size,
            'Content-Disposition': `inline; filename="payment-qr.${extension}"`,
            'Cache-Control': 'private, max-age=3600',
            'X-Content-Type-Options': 'nosniff'
        });
        const stream = fs.createReadStream(filePath);
        stream.on('error', () => response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to read file' } }));
        stream.pipe(response);
    } catch (error) { next(error); }
});