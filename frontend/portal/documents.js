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
        const svg = (d) => '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
        const icon = type === 'success' ? svg('<path d="M20 6 9 17l-5-5"/>') : type === 'error' || type === 'warning' ? svg('<path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/>') : svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>');
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

    function who(d) { return d.uploaded_by_role === 'OWNER' ? 'Shared by the firm' : 'Uploaded by you'; }
    function canPreview(d) { return /^(application\/pdf|image\/)/.test(d.content_type || ''); }

    async function load() {
        const root = document.getElementById('docs-root');
        const meta = document.getElementById('docs-meta');
        const reqRoot = document.getElementById('docs-requests');
        meta.textContent = 'Loading…';
        try {
            const [res, reqRes] = await Promise.all([API.listDocuments(), API.request('/documents/requests', { auth: true }).catch(() => ({ data: [] }))]);
            const items = (res && res.data) || [];
            const requests = (reqRes && reqRes.data) || [];
            if (reqRoot) {
                reqRoot.innerHTML = requests.length ? `
                    <section class="panel" aria-labelledby="req-head" style="border-color:var(--warn);">
                        <div class="panel-head"><h2 id="req-head">The firm is waiting for ${requests.length} document${requests.length === 1 ? '' : 's'}</h2><span class="panel-meta">Upload to answer</span></div>
                        <div class="panel-body tight">
                            ${requests.map((r) => `
                                <div class="doc-card" style="margin:.75rem;">
                                    <div class="doc-card-top"><span class="doc-icon">!</span>
                                        <div class="doc-card-info">
                                            <div class="doc-name">${escape(r.description)}</div>
                                            <div class="doc-meta">${escape(r.matter_reference || '')}${r.matter_title ? ' · ' + escape(r.matter_title) : ''} · asked ${P.fmtDateShort(r.created_at)}${r.due_date ? ' · due ' + P.fmtDateShort(r.due_date) : ''}${r.note ? ' · ' + escape(r.note) : ''}</div>
                                        </div>
                                    </div>
                                    <div class="doc-card-bottom"><button class="btn small" data-answer="${r.id}" data-matter="${r.matter_id}" data-desc="${escape(r.description)}">Upload this document</button></div>
                                </div>`).join('')}
                        </div>
                    </section>` : '';
                reqRoot.querySelectorAll('button[data-answer]').forEach((btn) => btn.addEventListener('click', () => openUploadModal({ matterId: btn.dataset.matter, requestId: btn.dataset.answer, description: btn.dataset.desc })));
            }
            if (!items.length) {
                root.innerHTML = `<div class="empty-state"><strong>No documents yet.</strong><p>Documents you upload, and those the firm shares with you, appear here.</p></div>`;
                meta.textContent = '0 documents';
                return;
            }
            root.innerHTML = `<div class="docs-list">${items.map((d) => `
                <div class="doc-card">
                    <div class="doc-card-top">
                        <span class="doc-icon">${ext(d.original_name)}</span>
                        <div class="doc-card-info">
                            <div class="doc-name">${escape(d.original_name || 'Document')}</div>
                            <div class="doc-meta">${escape(d.matter_reference || '')} ${d.matter_title ? '· ' + escape(d.matter_title) : ''} · ${P.fmtDateShort(d.created_at)} · ${who(d)}${d.request_description ? ' · for: ' + escape(d.request_description) : ''}</div>
                        </div>
                    </div>
                    <div class="doc-card-bottom">
                        <span class="doc-size">${bytes(d.size_bytes)}</span>
                        <span class="pill">${escape((d.status || 'AVAILABLE').toUpperCase())}</span>
                        <button class="btn small secondary" data-view-doc="${d.id}">Details</button>
                        ${canPreview(d) ? `<button class="btn small secondary" data-preview="${d.id}" data-type="${escape(d.content_type)}">Preview</button>` : ''}
                        <button class="btn small" data-download="${d.id}" data-name="${escape(d.original_name)}">Download</button>
                        ${d.uploaded_by_role !== 'OWNER' ? `<button class="btn small ghost" data-remove="${d.id}" data-name="${escape(d.original_name)}">Remove</button>` : ''}
                    </div>
                </div>
            `).join('')}</div>`;
            meta.textContent = items.length + ' document' + (items.length === 1 ? '' : 's');
            bindActions();
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            root.innerHTML = `<div class="empty-state"><span class="ico"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg></span><strong>Could not load documents.</strong><p>${escape(err.message || 'Please try again shortly.')}</p></div>`;
            meta.textContent = 'Error';
        }
    }

    async function loadDocumentDetail(docId) {
        const root = document.getElementById('docs-root');
        const meta = document.getElementById('docs-meta');
        root.innerHTML = '<div class="empty-state"><strong>Loading document…</strong></div>';
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
                                    <tr><th>Added by</th><td>${escape(d.uploaded_by_role === 'OWNER' ? 'The firm' : 'You')}</td></tr>
                                    ${d.request_description ? `<tr><th>Answers request</th><td>${escape(d.request_description)}</td></tr>` : ''}
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
            root.innerHTML = `<div class="empty-state"><span class="ico"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg></span><strong>Could not load document.</strong><p>${escape(err.message || 'Please try again shortly.')}</p></div>`;
            meta.textContent = 'Error';
        }
    }

    function openUploadModal(prefill) {
        prefill = prefill || {};
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-card">
                <div class="modal-card-head">
                    <h3>${prefill.requestId ? 'Upload requested document' : 'Upload a document'}</h3>${prefill.description ? `<p class="muted" style="margin:.25rem 0 0">${escape(prefill.description)}</p>` : ''}
                    <button class="modal-close-btn" aria-label="Close">&times;</button>
                </div>
                <form class="modal-form" id="portal-upload-form">
                    <p class="muted modal-hint">Documents are attached to a matter that has been opened after payment.</p>
                    <label>Matter
                        <select name="matter_id" required>
                            <option value="">Select matter…</option>
                        </select>
                    </label>
                    <label>Document title
                        <input type="text" name="original_name" required maxlength="160" placeholder="e.g. Signed lease agreement" />
                    </label>
                    <label>Your document
                        <input type="file" name="file" accept="*/*" required />
                    </label>
                    <div class="modal-form-actions">
                        <button type="button" class="btn secondary modal-cancel">Close</button>
                        <button type="submit" class="btn primary">Upload</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(overlay);

        const matterSelect = overlay.querySelector('select[name="matter_id"]');
        API.listMatters().then((res) => {
            const matters = (res && res.data) || [];
            if (!matters.length) {
                const hint = overlay.querySelector('.modal-hint');
                if (hint) hint.innerHTML = '<strong>No matter yet.</strong> Documents can be uploaded once your request is paid and the firm has opened your matter.';
                overlay.querySelector('button[type="submit"]').disabled = true;
                return;
            }
            matters.forEach((m) => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = `${m.reference || m.id} — ${m.title || 'Untitled'}`;
                matterSelect.appendChild(opt);
            });
            if (prefill.matterId) { matterSelect.value = prefill.matterId; if (prefill.requestId) matterSelect.disabled = true; }
        }).catch(() => showToast('Could not load matters. Please try again.', 'error'));

        const close = () => document.body.removeChild(overlay);
        overlay.querySelector('.modal-close-btn').addEventListener('click', close);
        overlay.querySelector('.modal-cancel').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        overlay.querySelector('#portal-upload-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            const matterId = (prefill.matterId || form.matter_id.value).trim();
            const fileInput = form.file;
            const originalName = form.original_name.value.trim();
            if (!matterId) { showToast('Please select a matter.', 'warning'); return; }
            if (!fileInput.files || !fileInput.files[0]) { showToast('Please choose a file.', 'warning'); return; }
            const fd = new FormData();
            fd.append('file', fileInput.files[0]);
            fd.append('matter_id', matterId);
            if (!originalName) { showToast('Please enter a document title.', 'warning'); return; }
            const picked = fileInput.files[0].name || '';
            const ext = picked.includes('.') ? picked.slice(picked.lastIndexOf('.')) : '';
            fd.append('original_name', ext && !originalName.toLowerCase().endsWith(ext.toLowerCase()) ? originalName + ext : originalName);
            if (prefill.requestId) fd.append('request_id', prefill.requestId);
            const submitBtn = form.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Uploading…';
            try {
                await API.uploadDocument(fd);
                close();
                await load();
            } catch (err) {
                showToast('Upload failed: ' + (err.message || 'Unknown error'), 'error');
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Upload';
            }
        });

        overlay.style.display = 'flex';
    }

    async function fetchBlob(docId, inline) {
        const res = await fetch(`${API.base()}/documents/${encodeURIComponent(docId)}/download${inline ? '?inline=1' : ''}`, { headers: { 'Authorization': `Bearer ${API.token()}` } });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error((data && data.error && data.error.message) || `Request failed (${res.status})`);
        }
        return res.blob();
    }

    function bindActions() {
        document.querySelectorAll('button[data-preview]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const win = window.open('', '_blank');
                try {
                    const blob = await fetchBlob(btn.getAttribute('data-preview'), true);
                    const url = URL.createObjectURL(new Blob([blob], { type: btn.getAttribute('data-type') || blob.type }));
                    if (win) win.location.href = url;
                } catch (err) { if (win) win.close(); showToast('Could not open the document: ' + (err.message || 'Unknown error'), 'error'); }
            });
        });
        document.querySelectorAll('button[data-remove]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm(`Remove "${btn.getAttribute('data-name')}"? The firm will no longer see it.`)) return;
                try { await API.request(`/documents/${encodeURIComponent(btn.getAttribute('data-remove'))}`, { method: 'DELETE', auth: true }); await load(); }
                catch (err) { showToast('Could not remove the document: ' + (err.message || 'Unknown error'), 'error'); }
            });
        });
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

    document.getElementById('btn-upload-document')?.addEventListener('click', () => openUploadModal());
    load();
    /* Live: a document the firm shares, or a new request for one, shows up without refreshing. */
    const RT = window.Site && window.Site.Realtime;
    if (RT) {
        const refresh = () => { if (!document.querySelector('.doc-detail') && !document.querySelector('.modal-overlay')) load(); };
        ['document.created', 'document.requested'].forEach((t) => RT.on(t, refresh));
    }
})();
