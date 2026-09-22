/* Portal — documents. */
(function () {
    'use strict';
    if (!window.Site || !window.Portal || !window.Portal.guard()) return;
    const API = window.Site.API;
    const P = window.Portal;

    function escape(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
    function ext(name) {
        const m = (name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
        return (m && m[1]) ? m[1].toUpperCase().slice(0, 4) : 'DOC';
    }
    function bytes(n) {
        if (!n && n !== 0) return '—';
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    function showToast(message, type) {
        const container = getToastContainer();
        const toast = document.createElement('div');
        toast.className = 'portal-toast portal-toast-' + (type || 'info');
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'polite');
        const icon = type === 'success' ? '✓' : type === 'error' ? '!' : type === 'warning' ? '⚠' : 'ℹ';
        toast.innerHTML = '<span class="portal-toast-icon">' + icon + '</span><span class="portal-toast-message">' + escape(message) + '</span>';
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('portal-toast-show'));
        setTimeout(() => {
            toast.classList.remove('portal-toast-show');
            toast.addEventListener('transitionend', () => toast.remove(), { once: true });
        }, 4500);
    }

    function getToastContainer() {
        let c = document.getElementById('portal-toast-container');
        if (!c) {
            c = document.createElement('div');
            c.id = 'portal-toast-container';
            c.className = 'portal-toast-container';
            document.body.appendChild(c);
            const style = document.createElement('style');
            style.textContent = `
                .portal-toast-container {
                    position: fixed; bottom: 24px; right: 24px; z-index: 1001;
                    display: flex; flex-direction: column; gap: 10px; pointer-events: none;
                }
                .portal-toast {
                    pointer-events: auto; display: flex; align-items: center; gap: 10px;
                    padding: 12px 16px; border-radius: 6px; font-size: 0.875rem; line-height: 1.4;
                    background: rgba(33, 33, 33, 0.9); color: #fff; border: 1px solid #4a4a4a;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
                    transform: translateX(120%) translateY(10px); opacity: 0;
                    transition: transform 0.3s cubic-bezier(0.16,1,0.3,1), opacity 0.3s;
                }
                [data-theme="light"] .portal-toast { background: #fff; border-color: #d6d0c4; color: #1a1714; }
                .portal-toast-show { transform: translateX(0) translateY(0); opacity: 1; }
                .portal-toast-icon { flex-shrink: 0; width: 20px; height: 20px; display: flex;
                    align-items: center; justify-content: center; font-size: 0.9rem; font-weight: 700;
                    border-radius: 50%; background: rgba(255,255,255,0.2); }
                .portal-toast-error .portal-toast-icon { background: rgba(168,74,58,0.25); }
                .portal-toast-warning .portal-toast-icon { background: rgba(184,134,46,0.25); }
                .portal-toast-success .portal-toast-icon { background: rgba(45,106,79,0.25); }
                .portal-toast-message { flex: 1; }
                @media (max-width: 480px) {
                    .portal-toast-container { left: 12px; right: 12px; bottom: 12px; }
                    .portal-toast { min-width: 0; max-width: none; }
                }
            `;
            document.head.appendChild(style);
        }
        return c;
    }

    async function load() {
        const root = document.getElementById('docs-root');
        const meta = document.getElementById('docs-meta');
        root.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading documents…</strong></div>';
        meta.textContent = 'Loading…';
        try {
            const res = await API.listDocuments();
            const items = (res && res.data) || [];
            if (!items.length) {
                root.innerHTML = `<div class="empty-state"><span class="ico">·</span><strong>No documents yet.</strong><p>Documents shared with you by the firm will appear here.</p></div>`;
                meta.textContent = '0 documents';
                return;
            }
            root.innerHTML = `<div class="docs-list">${items.map((d) => `
                <div class="doc-card">
                    <div class="doc-card-top">
                        <span class="doc-icon">${ext(d.original_name)}</span>
                        <div class="doc-card-info">
                            <div class="doc-name">${escape(d.original_name || 'Document')}</div>
                            <div class="doc-meta">${escape(d.matter_reference || '')} ${d.matter_title ? '· ' + escape(d.matter_title) : ''} · ${P.fmtDateShort(d.created_at)}</div>
                        </div>
                    </div>
                    <div class="doc-card-bottom">
                        <span class="doc-size">${bytes(d.size_bytes)}</span>
                        <span class="pill">${escape((d.status || 'AVAILABLE').toUpperCase())}</span>
                        <button class="btn small secondary" data-view-doc="${d.id}">View</button>
                        <button class="btn small" data-download="${d.id}" data-name="${escape(d.original_name)}">Download</button>
                    </div>
                </div>
            `).join('')}</div>`;
            meta.textContent = items.length + ' document' + (items.length === 1 ? '' : 's');
            bindActions();
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            root.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load documents.</strong><p>${escape(err.message || 'Please try again shortly.')}</p></div>`;
            meta.textContent = 'Error';
        }
    }

    async function loadDocumentDetail(docId) {
        const root = document.getElementById('docs-root');
        const meta = document.getElementById('docs-meta');
        root.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading document…</strong></div>';
        meta.textContent = 'Loading…';
        try {
            const res = await API.request(`/documents/${encodeURIComponent(docId)}`, { auth: true });
            const d = res.data;
            const canDownload = !!(d.storage_key || d.content_type);
            root.innerHTML = `
                <div class="doc-detail">
                    <div class="doc-detail-head">
                        <div>
                            <span class="kicker">Document</span>
                            <h1>${escape(d.original_name || 'Document')}</h1>
                            <p class="head-meta">${escape(d.matter_reference || '')} ${d.matter_title ? '· ' + escape(d.matter_title) : ''} · Uploaded ${P.fmtDateShort(d.created_at)}</p>
                        </div>
                        <div class="action-row">
                            <button class="btn ghost" id="btn-back-docs">← Back</button>
                            ${canDownload ? `<button class="btn primary" data-download="${d.id}" data-name="${escape(d.original_name)}">Download</button>` : ''}
                        </div>
                    </div>
                    <section class="panel">
                        <div class="panel-head"><h2>Details</h2></div>
                        <div class="panel-body">
                            <table class="table detail-meta">
                                <tbody>
                                    <tr><th>File Name</th><td>${escape(d.original_name)}</td></tr>
                                    <tr><th>Content Type</th><td>${escape(d.content_type || '—')}</td></tr>
                                    <tr><th>Size</th><td>${escape(d.size_bytes ? bytes(d.size_bytes) : '—')}</td></tr>
                                    <tr><th>Status</th><td><span class="pill">${escape((d.status || 'AVAILABLE').toUpperCase())}</span></td></tr>
                                    <tr><th>Matter</th><td>${escape(d.matter_reference || '—')} — ${escape(d.matter_title || '')}</td></tr>
                                    <tr><th>Uploaded</th><td class="muted">${escape(d.created_at)}</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </section>
                </div>
            `;
            meta.textContent = '';
            document.getElementById('btn-back-docs')?.addEventListener('click', load);
            bindDownloads();
        } catch (err) {
            root.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load document.</strong><p>${escape(err.message || 'Please try again shortly.')}</p></div>`;
            meta.textContent = 'Error';
        }
    }

    function openUploadModal() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-card">
                <div class="modal-card-head">
                    <h3>Upload Document</h3>
                    <button class="modal-close-btn" aria-label="Close">&times;</button>
                </div>
                <form class="modal-form" id="portal-upload-form">
                    <label>Matter
                        <select name="matter_id" required>
                            <option value="">Select matter…</option>
                        </select>
                    </label>
                    <label>File
                        <input type="file" name="file" accept="*/*" required />
                    </label>
                    <label>Original name (optional)
                        <input type="text" name="original_name" placeholder="Defaults to uploaded file name" />
                    </label>
                    <div class="form-status" id="upload-status" role="status" aria-live="polite" style="margin-top:0.75rem;"></div>
                    <div class="modal-form-actions">
                        <button type="submit" class="btn primary">Upload</button>
                        <button type="button" class="btn ghost modal-cancel">Cancel</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(overlay);

        const matterSelect = overlay.querySelector('select[name="matter_id"]');
        API.listMatters().then((res) => {
            const matters = (res && res.data) || [];
            if (!matters.length) {
                const statusEl = overlay.querySelector('#upload-status');
                if (statusEl) {
                    statusEl.className = 'form-status error';
                    statusEl.innerHTML = '<strong>No matters available.</strong>You do not have any matters yet. Please wait for a matter to be created before uploading documents.';
                }
                return;
            }
            matters.forEach((m) => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = `${m.reference || m.id} — ${m.title || 'Untitled'}`;
                matterSelect.appendChild(opt);
            });
        }).catch(() => { const statusEl = overlay.querySelector('#upload-status'); if (statusEl) { statusEl.className = 'form-status error'; statusEl.textContent = 'Could not load matters. Please try again.'; } });

        const close = () => document.body.removeChild(overlay);
        overlay.querySelector('.modal-close-btn').addEventListener('click', close);
        overlay.querySelector('.modal-cancel').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        overlay.querySelector('#portal-upload-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            const matterId = form.matter_id.value.trim();
            const fileInput = form.file;
            const originalName = form.original_name.value.trim();
            if (!matterId) { showToast('Please select a matter.', 'warning'); return; }
            if (!fileInput.files || !fileInput.files[0]) { showToast('Please choose a file.', 'warning'); return; }
            const fd = new FormData();
            fd.append('file', fileInput.files[0]);
            fd.append('matter_id', matterId);
            if (originalName) fd.append('original_name', originalName);
            const submitBtn = form.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Uploading…';
            try {
                await API.uploadDocument(fd);
                close();
                await load();
            } catch (err) {
                const statusEl = overlay.querySelector('#upload-status');
                if (statusEl) {
                    statusEl.className = 'form-status error';
                    statusEl.innerHTML = '<strong>Upload failed.</strong>' + escape(err.message || 'Unknown error');
                }
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Upload';
            }
        });

        overlay.style.display = 'flex';
    }

    function bindActions() {
        document.querySelectorAll('button[data-view-doc]').forEach((btn) => {
            btn.addEventListener('click', () => loadDocumentDetail(btn.getAttribute('data-view-doc')));
        });
        bindDownloads();
    }

    function bindDownloads() {
        document.querySelectorAll('button[data-download]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const docId = btn.getAttribute('data-download');
                const fileName = btn.getAttribute('data-name') || 'download';
                try {
                    const token = API.token();
                    const base = API.base();
                    const res = await fetch(`${base}/documents/${encodeURIComponent(docId)}/download`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (!res.ok) {
                        const data = await res.json().catch(() => ({}));
                        throw new Error((data && data.error && data.error.message) || `Download failed (${res.status})`);
                    }
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = fileName;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (err) {
                    showToast('Could not download document: ' + (err.message || 'Unknown error'), 'error');
                }
            });
        });
    }

    document.getElementById('btn-upload-document')?.addEventListener('click', openUploadModal);
    load();
})();
