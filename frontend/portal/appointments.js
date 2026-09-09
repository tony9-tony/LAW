/* Portal — appointments. */
(function () {
    'use strict';
    if (!window.Site || !window.Portal || !window.Portal.guard()) return;
    const API = window.Site.API;
    const P = window.Portal;

    function escape(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

    function renderList(container, items, metaEl) {
        if (!items.length) {
            container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>No appointments.</strong></div>';
            metaEl.textContent = '0';
            return;
        }
        container.innerHTML = items.map((a) => {
            const start = P.fmtDate(a.starts_at);
            const end = a.ends_at ? P.fmtDate(a.ends_at) : '';
            const matterLink = a.matter_id
                ? `<a class="link-bronze_soft" href="matter.html?id=${a.matter_id}">${escape(a.matter_reference || 'Matter')}</a>`
                : '<span class="muted">Unassigned</span>';
            return `
                <div class="doc-row">
                    <span class="doc-icon">${P.fmtDateShort(a.starts_at).replace(/[A-Za-z\s]/g, '').slice(2, 5) || 'APPT'}</span>
                    <div>
                        <div class="doc-name">${start}${end ? ' — ' + end : ''}</div>
                        <div class="doc-meta">${matterLink} ${a.matter_title ? '· ' + escape(a.matter_title) : ''}</div>
                        ${a.notes ? `<div class="doc-meta">${escape(a.notes)}</div>` : ''}
                    </div>
                    <span class="pill">${escape((a.status || 'scheduled').toUpperCase())}</span>
                </div>
            `;
        }).join('');
        metaEl.textContent = items.length + ' appointment' + (items.length === 1 ? '' : 's');
    }

    async function load() {
        const upcomingRoot = document.getElementById('upcoming-root');
        const pastRoot = document.getElementById('past-root');
        const upcomingMeta = document.getElementById('upcoming-meta');
        const pastMeta = document.getElementById('past-meta');
        try {
            const res = await API.listAppointments();
            const all = (res && res.data) || [];
            const now = new Date();
            const valid = all.filter((a) => a.starts_at);
            const upcoming = valid.filter((a) => new Date(a.starts_at) > now && !/cancelled|completed/i.test(a.status || '')).sort((x, y) => new Date(x.starts_at) - new Date(y.starts_at));
            const past = valid.filter((a) => new Date(a.starts_at) <= now).sort((x, y) => new Date(y.starts_at) - new Date(x.starts_at));
            renderList(upcomingRoot, upcoming, upcomingMeta);
            renderList(pastRoot, past, pastMeta);
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            upcomingRoot.innerHTML = '<div class="empty-state"><span class="ico">!</span><strong>Could not load appointments.</strong><p>' + escape(err.message || 'Please try again shortly.') + '</p></div>';
            pastRoot.innerHTML = '';
            upcomingMeta.textContent = 'Error';
            pastMeta.textContent = 'Error';
        }
    }

    load();
})();
