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
                <div class="doc-row">
                    <span class="doc-icon">${ext(d.original_name)}</span>
                    <div>
                        <div class="doc-name">${escape(d.original_name || 'Document')}</div>
                        <div class="doc-meta">${escape(d.matter_reference || '')} ${d.matter_title ? '· ' + escape(d.matter_title) : ''} · ${P.fmtDateShort(d.created_at)}</div>
                    </div>
                    <span class="doc-size">${bytes(d.size_bytes)}</span>
                    <span class="pill">${escape((d.status || 'AVAILABLE').toUpperCase())}</span>
                </div>
            `).join('')}</div>`;
            meta.textContent = items.length + ' document' + (items.length === 1 ? '' : 's');
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            root.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load documents.</strong><p>${escape(err.message || 'Please try again shortly.')}</p></div>`;
            meta.textContent = 'Error';
        }
    }

    load();
})();
