/* Portal dashboard — request-first summary. */
(function () {
    'use strict';
    if (!window.Site || !window.Portal || !window.Portal.guard()) return;
    const API = window.Site.API;
    const P = window.Portal;

    const u = API.user() || {};
    if (u.fullName) {
        const t = document.getElementById('welcome-title');
        if (t) t.textContent = `Welcome, ${u.fullName.split(' ')[0]}.`;
    }

    function setKpi(id, value, metaId, meta) {
        const el = document.getElementById(id);
        const m = metaId && document.getElementById(metaId);
        if (el) el.textContent = value;
        if (m && meta) m.textContent = meta;
    }

    async function loadRequests() {
        try {
            const res = await API.listRequests();
            const rows = (res && res.data) || [];
            const tbody = document.getElementById('recent-body');
            if (!rows.length) {
                tbody.innerHTML = `<tr><td colspan="5" class="empty-state tight"><span class="ico">·</span><strong>No requests yet.</strong><p>Submit a request to begin working with the firm. Your request will be reviewed and you will receive a response here.</p><div class="empty-actions"><a class="btn" href="custom-matter.html">Submit a request <span class="arrow">→</span></a><a class="btn secondary" href="consultation.html">Book consultation</a></div></td></tr>`;
            } else {
                tbody.innerHTML = rows.slice(0, 6).map((r) => `
                    <tr class="row-link" onclick="window.location.href='request.html?id=${r.id}'">
                        <td><span class="ref">#${String(r.id).padStart(5, '0')}</span></td>
                        <td class="subj"><strong>${escape(r.subject || '—')}</strong></td>
                        <td>${P.statusPill(r.status)}</td>
                        <td class="muted">${P.fmtDateShort(r.created_at)}</td>
                        <td class="muted">${P.fmtDateShort(r.updated_at || r.created_at)}</td>
                    </tr>
                `).join('');
            }
            const open = rows.filter((r) => (r.status || '').toLowerCase() !== 'closed').length;
            const review = rows.filter((r) => ['new', 'pending', 'open', 'in_progress', 'under_review', 'submitted', 'action_required'].includes((r.status || '').toLowerCase())).length;
            setKpi('kpi-open', String(open), 'kpi-open-meta', rows.length + ' total');
            setKpi('kpi-review', String(review));

            // Next action
            const next = document.getElementById('next-action');
            if (next) {
                if (!rows.length) {
                    next.innerHTML = '<strong>Get started</strong>Submit a request to begin working with the firm.';
                } else if (review > 0) {
                    const top = rows.find((r) => (r.status || '').toLowerCase() !== 'closed') || rows[0];
                    next.innerHTML = `<strong>Awaiting review</strong>Reference <a class="link-bronze" href="request.html?id=${top.id}">#${String(top.id).padStart(5,'0')}</a> is being reviewed by the firm.`;
                } else {
                    next.innerHTML = '<strong>All caught up</strong>No requests are currently awaiting review.';
                }
            }

            // Activity feed
            const activity = document.getElementById('activity-body');
            if (activity) {
                if (!rows.length) {
                    activity.innerHTML = '<p class="text-mute-block">No activity yet. Once the firm reviews your request or updates your matter, activity will appear here.</p>';
                } else {
                    const items = rows.slice(0, 5).map((r) => `
                        <div class="activity-row">
                            <div class="dot"></div>
                            <div class="body">
                                <div class="ts">${P.fmtDate(r.updated_at || r.created_at)}</div>
                                <div class="lead"><strong>${escape(r.subject || '—')}</strong> — ${P.statusPill(r.status)}</div>
                            </div>
                            <a class="btn small secondary open" href="request.html?id=${r.id}">Open</a>
                        </div>
                    `).join('');
                    activity.innerHTML = items;
                }
            }
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            const tbody = document.getElementById('recent-body');
            if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="empty-state tight"><span class="ico">!</span><strong>Could not load requests.</strong><p>${escape(err.message || 'Please try again shortly.')}</p><button class="btn" type="button" id="retry-requests">Retry</button></td></tr>`;
            document.getElementById('retry-requests')?.addEventListener('click', loadRequests);
        }
    }

    async function loadAppointmentsAndNext() {
        const kpi = document.getElementById('kpi-appts');
        const kpiMeta = document.getElementById('kpi-appts-meta');
        const nextEl = document.getElementById('next-action');
        try {
            const res = await API.listAppointments();
            const items = (res && res.data) || [];
            const now = new Date();
            const upcoming = items.filter((a) => new Date(a.starts_at) > now && !/cancelled|completed/i.test(a.status || ''));
            if (kpi) kpi.textContent = String(upcoming.length);
            if (kpiMeta) kpiMeta.textContent = items.length + ' on record';
            if (nextEl && upcoming.length) {
                const next = upcoming[0];
                const link = next.matter_id
                    ? ` · <a class="link-bronze" href="matter.html?id=${next.matter_id}">${escape(next.matter_reference || 'matter')}</a>`
                    : '';
                nextEl.innerHTML = `<strong>Next appointment</strong>${P.fmtDate(next.starts_at)}${link}`;
            }
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            if (kpi) kpi.textContent = '—';
            if (kpiMeta) kpiMeta.textContent = err.message || 'Error';
        }
    }

    async function loadMatters() {
        const body = document.getElementById('matters-body');
        try {
            const res = await API.listMatters();
            const items = (res && res.data) || [];
            const active = items.filter((m) => (m.status || '').toUpperCase() !== 'CLOSED').length;
            document.getElementById('kpi-matters') && (document.getElementById('kpi-matters').textContent = String(active));
            document.getElementById('kpi-matters-meta') && (document.getElementById('kpi-matters-meta').textContent = items.length + ' total');
            if (!items.length) {
                body.innerHTML = `<div class="empty-state tight"><span class="ico">·</span><strong>No matters yet.</strong><p>Matters are created only after the firm accepts a request. Until then, your requests appear under <a class="link-bronze" href="requests.html">Requests</a>.</p></div>`;
                return;
            }
            body.innerHTML = items.map((m) => `
                <a class="doc-row" href="matter.html?id=${m.id}">
                    <span class="doc-icon">${escape((m.reference || 'M').replace(/^M-?/, '').slice(0, 4))}</span>
                    <div>
                        <div class="doc-name">${escape(m.reference)} · ${escape(m.title || 'Matter')}</div>
                        <div class="doc-meta">${escape(m.matter_type || '—')} · Opened ${P.fmtDateShort(m.created_at)}</div>
                    </div>
                    <span></span>
                    ${P.statusPill(m.status)}
                </a>
            `).join('');
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            if (body) body.innerHTML = `<div class="empty-state tight"><span class="ico">!</span><strong>Could not load matters.</strong><p>${escape(err.message || 'Please try again.')}</p></div>`;
        }
    }

    async function loadNotifications() {
        const kpi = document.getElementById('kpi-notif');
        const kpiMeta = document.getElementById('kpi-notif-meta');
        try {
            const res = await API.listNotifications({ unreadOnly: true });
            const unread = (res && res.unread_count) || 0;
            const items = (res && res.data) || [];
            setKpi('kpi-notif', String(unread), 'kpi-notif-meta', items.length + ' total');
            const banner = document.getElementById('notif-banner');
            if (banner) {
                if (unread > 0) {
                    banner.classList.remove('hidden');
                    banner.innerHTML = `<strong>${unread} unread notification${unread === 1 ? '' : 's'}.</strong> Open <a class="link-bronze" href="notifications.html">notifications</a> to review.`;
                } else {
                    banner.classList.add('hidden');
                }
            }
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            setKpi('kpi-notif', '—', 'kpi-notif-meta', err.message || 'Error');
        }
    }

    function escape(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

    async function loadDashboardData() {
        const promises = [
            loadRequests(),
            loadMatters(),
            loadAppointmentsAndNext(),
            loadNotifications()
        ];
        await Promise.allSettled(promises);
    }
    loadDashboardData();
})();
