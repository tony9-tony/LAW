/* Portal — notifications. */
(function () {
    'use strict';
    if (!window.Site || !window.Portal || !window.Portal.guard()) return;
    const API = window.Site.API;
    const P = window.Portal;

    function escape(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

    function linkFor(n) {
        if (n.entity_type === 'request') return `request.html?id=${n.entity_id}`;
        if (n.entity_type === 'matter') return `matter.html?id=${n.entity_id}`;
        if (n.entity_type === 'conversation') return `messages.html?conversation=${n.entity_id}`;
        return '#';
    }

    async function load() {
        const root = document.getElementById('notif-root');
        const meta = document.getElementById('notif-meta');
        try {
            const res = await API.listNotifications();
            const items = (res && res.data) || [];
            if (!items.length) {
                root.innerHTML = `<div class="empty-state"><span class="ico">·</span><strong>No notifications.</strong><p>Updates from the firm will appear here.</p></div>`;
                meta.textContent = '0 notifications';
                return;
            }
            root.innerHTML = items.map((n) => {
                const unread = !n.read_at;
                const href = linkFor(n);
                return `
                    <a class="doc-row" href="${escape(href)}" data-notif="${n.id}" data-read="${unread ? 'false' : 'true'}">
                        <span class="doc-icon">${unread ? '●' : '○'}</span>
                        <div>
                            <div class="doc-name">${escape(n.title)}</div>
                            <div class="doc-meta">${escape(n.kind.replace(/_/g, ' '))} · ${P.fmtDate(n.created_at)}</div>
                            ${n.body ? `<div class="doc-meta">${escape(n.body)}</div>` : ''}
                        </div>
                        <span class="doc-size">${unread ? 'Unread' : 'Read'}</span>
                        <span class="pill">${unread ? 'NEW' : 'READ'}</span>
                    </a>
                `;
            }).join('');
            meta.textContent = items.length + ' notification' + (items.length === 1 ? '' : 's') + ` · ${res.unread_count || 0} unread`;

            root.querySelectorAll('a[data-notif]').forEach((el) => {
                el.addEventListener('click', async () => {
                    if (el.dataset.read === 'true') return;
                    try { await API.markNotificationRead(el.dataset.notif); } catch (e) { /* ignore */ }
                });
            });
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            root.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load notifications.</strong><p>${escape(err.message || 'Please try again.')}</p></div>`;
            meta.textContent = 'Error';
        }
    }

    document.getElementById('mark-all').addEventListener('click', async () => {
        const meta = document.getElementById('notif-meta');
        const prev = meta ? meta.textContent : '';
        try {
            await API.markAllNotificationsRead();
            await load();
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            if (meta) { meta.textContent = escape(err.message || 'Could not mark notifications as read.'); meta.style.color = 'var(--danger)'; }
        }
    });

    load();
})();
