/* Portal — matters list. */
(function () {
    'use strict';
    if (!window.Site || !window.Portal || !window.Portal.guard()) return;
    const API = window.Site.API;
    const P = window.Portal;

    function escape(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

    async function load() {
        const tbody = document.getElementById('matters-body');
        const meta = document.getElementById('count-meta');
        try {
            const res = await API.listMatters();
            const items = (res && res.data) || [];
            if (!items.length) {
                tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><span class="ico">·</span><strong>No matters yet.</strong><p>Matters are created once the firm accepts a request. Until then, your requests appear under <a href="requests.html">Requests</a>.</p></td></tr>`;
                if (meta) meta.textContent = '0 matters';
                return;
            }
            if (meta) meta.textContent = items.length + ' matter' + (items.length === 1 ? '' : 's');
            tbody.innerHTML = items.map((m) => `
                <tr class="row-link" onclick="window.location.href='matter.html?id=${m.id}'">
                    <td><span class="ref">${escape(m.reference || '—')}</span></td>
                    <td class="subj"><strong>${escape(m.title || '—')}</strong></td>
                    <td>${P.statusPill(m.status)}</td>
                    <td class="muted">${P.fmtDateShort(m.created_at)}</td>
                    <td class="muted">${P.fmtDateShort(m.updated_at || m.created_at)}</td>
                </tr>
            `).join('');
        } catch (err) {
            if (err && err.status === 401) {
                window.location.replace('../login.html');
                return;
            }
            tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><span class="ico">!</span><strong>Could not load your matters.</strong><p>${escape(err.message || 'Please try again shortly.')}</p><button class="btn" type="button" onclick="location.reload()">Retry</button></td></tr>`;
            if (meta) meta.textContent = 'Error';
        }
    }

    load();
})();
