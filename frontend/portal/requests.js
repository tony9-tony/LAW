/* Portal — requests list. */
(function () {
    'use strict';
    if (!window.Site || !window.Portal || !window.Portal.guard()) return;
    const API = window.Site.API;
    const P = window.Portal;

    function escape(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

    async function load() {
        const tbody = document.getElementById('all-body');
        const meta = document.getElementById('count-meta');
        try {
            const res = await API.listRequests();
            const rows = (res && res.data) || [];
            if (!rows.length) {
                tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><span class="ico">·</span><strong>You haven't submitted any requests yet.</strong><p>Use the custom matter intake or book a consultation to begin.</p><div class="empty-actions"><a class="btn" href="../custom-matter.html">Submit a matter <span class="arrow">→</span></a><a class="btn secondary" href="../consultation.html">Book consultation</a></div></td></tr>`;
                meta.textContent = '0 requests';
                return;
            }
            tbody.innerHTML = rows.map((r) => `
                <tr class="row-link" onclick="window.location.href='request.html?id=${r.id}'">
                    <td><span class="ref">#${String(r.id).padStart(5, '0')}</span></td>
                    <td class="subj"><strong>${escape(r.subject || '—')}</strong></td>
                    <td>${P.statusPill(r.status)}</td>
                    <td class="muted">${P.fmtDateShort(r.created_at)}</td>
                    <td class="muted">${P.fmtDateShort(r.updated_at || r.created_at)}</td>
                </tr>
            `).join('');
            meta.textContent = rows.length + ' request' + (rows.length === 1 ? '' : 's');
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><span class="ico">!</span><strong>Could not load your requests.</strong><p>${escape(err.message || 'Please try again shortly.')}</p><button class="btn" type="button" onclick="location.reload()">Retry</button></td></tr>`;
            meta.textContent = 'Error';
        }
    }

    load();
})();
