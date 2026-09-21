import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const STORAGE_DIR = path.join(process.cwd(), 'storage', 'documents');

async function ensureStorageDir() {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
}

export async function saveUploadedFile(fileBuffer, originalName, contentType) {
    await ensureStorageDir();
    const ext = path.extname(originalName || '');
    const safeName = originalName
        ? originalName.replace(/[^a-zA-Z0-9._\- ]/g, '_').replace(/\s+/g, '_')
        : 'file';
    const storedName = `${randomUUID()}${ext || ''}`;
    const storageKey = path.join('documents', storedName).replace(/\\/g, '/');
    const filePath = path.join(STORAGE_DIR, storedName);
    await fs.writeFile(filePath, fileBuffer);
    const stats = await fs.stat(filePath);
    return {
        storageKey,
        originalName: safeName,
        contentType: contentType || 'application/octet-stream',
        sizeBytes: stats.size,
    };
}

export function storageFilePath(storageKey) {
    if (!storageKey) return null;
    return path.join(process.cwd(), 'storage', storageKey.replace(/\\/g, '/').replace(/^\//, ''));
}

export async function deleteStoredFile(storageKey) {
    const filePath = storageFilePath(storageKey);
    if (!filePath) return;
    try { await fs.unlink(filePath); } catch { /* ignore missing file */ }
}
