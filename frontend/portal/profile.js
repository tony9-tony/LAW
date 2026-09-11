/* Portal — profile. */
(function () {
    'use strict';
    if (!window.Site || !window.Portal || !window.Portal.guard()) return;
    const API = window.Site.API;

    function set(id, v) { const el = document.getElementById(id); if (el) el.textContent = v || '—'; }

    async function load() {
        try {
            const res = await API.me();
            const u = res.data || {};
            set('meta-name', u.full_name);
            set('meta-email', u.email);
            set('meta-status', u.is_active ? 'Active' : 'Inactive');
            set('meta-created', u.created_at ? new Date(u.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) : '—');
            /* Keep local user object fresh so other pages see latest. */
            API.setUser({ id: u.id, email: u.email, fullName: u.full_name, role: u.role || 'CLIENT' });
        } catch (err) {
            /* Fallback to cached user info. */
            const u = API.user() || {};
            set('meta-name', u.fullName);
            set('meta-email', u.email);
            set('meta-status', u.id ? 'Active' : '—');
            set('meta-created', '—');
        }
    }

    load();
})();
