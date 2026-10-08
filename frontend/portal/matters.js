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
                tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><strong>No matters yet.</strong><p>Matters are created once the firm accepts a request. Until then, your requests appear under <a href="requests.html">Requests</a>.</p></td></tr>`;
                if (meta) meta.textContent = '0 matters';
                return;
            }
            if (meta) meta.textContent = items.length + ' matter' + (items.length === 1 ? '' : 's');
            tbody.innerHTML = items.map((m) => `
                <tr class="row-link" data-href="matter.html?id=${m.id}">
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
            tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><span class="ico"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg></span><strong>Could not load your matters.</strong><p>${escape(err.message || 'Please try again shortly.')}</p><button class="btn" type="button" id="retry-matters">Retry</button></td></tr>`;
            if (meta) meta.textContent = 'Error';
            document.getElementById('retry-matters')?.addEventListener('click', load);
        }
    }

    window.retryMatters = load;
    load();
    P.onLive(['matter.created','matter.status_changed','request.accepted','payment.verified','message.created'], load);
})();
