/* Shared portal chrome — auth guard, topbar, sidebar, helpers. */
(function () {
    'use strict';

    const FIRM = window.Site && window.Site.FIRM;

    function icon(name) {
        const icons = {
            dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>',
            matters: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="12" cy="12" r="3"/></svg>',
            requests: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6h16M4 12h10M4 18h16"/></svg>',
            messages: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
            documents: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
            notifications: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
            profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
            appointments: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M12 11h.01M12 15h.01M12 11a3 3 0 1 0 0 4 3 3 0 0 0 0-4z"/></svg>'
        };
        return icons[name] || '';
    }

    const NAV = [
        { href: 'dashboard.html',  label: 'Dashboard',  icon: 'dashboard' },
        { href: 'matters.html',    label: 'My Matters',  icon: 'matters' },
        { href: 'requests.html',   label: 'Requests',    icon: 'requests' },
        { href: 'messages.html',   label: 'Messages',    icon: 'messages' },
        { href: 'appointments.html', label: 'Appointments', icon: 'appointments' },
        { href: 'documents.html', label: 'Documents',     icon: 'documents' },
        { href: 'notifications.html', label: 'Notifications', icon: 'notifications' },
        { href: 'profile.html',   label: 'Profile',       icon: 'profile' }
    ];

    function guard() {
        if (!window.Site || !window.Site.API || !window.Site.API.isAuthed()) {
            const target = encodeURIComponent(location.pathname.split('/').pop() || 'dashboard.html');
            window.location.replace('../login.html?next=' + target);
            return false;
        }
        // Server-side token verification to prevent cache-based auth bypass
        const token = window.Site.API.token();
        fetch('/api/v1/profile', {
            headers: { 'Authorization': 'Bearer ' + token }
        }).then((res) => {
            if (!res.ok) {
                window.Site.logout();
                const target = encodeURIComponent(location.pathname.split('/').pop() || 'dashboard.html');
                window.location.replace('../login.html?next=' + target);
            }
        }).catch(() => {
            window.Site.logout();
            const target = encodeURIComponent(location.pathname.split('/').pop() || 'dashboard.html');
            window.location.replace('../login.html?next=' + target);
        });
        return true;
    }

    function topbarHTML() {
        const u = window.Site.API.user() || {};
        const initials = (u.fullName || u.email || '·').trim().slice(0, 1).toUpperCase();
        return `
<header class="portal-topbar" role="banner">
    <a class="portal-brand" href="dashboard.html" aria-label="${(FIRM && FIRM.name) || ''} client portal">
        <span class="portal-brand-name">${(FIRM && FIRM.name) || ''}</span>
        <span class="portal-brand-tag">Client portal</span>
    </a>
    <div class="portal-actions">
        <a class="public-link" href="/">← Back to website</a>
        <div class="portal-user">
            <span>${u.fullName || u.email || 'Signed in'}</span>
            <span class="avatar" aria-hidden="true">${initials}</span>
        </div>
        <button class="signout-btn" type="button" data-signout>Sign out</button>
    </div>
</header>`;
    }

    function sidebarHTML() {
        const current = (location.pathname.split('/').pop() || 'dashboard.html').toLowerCase();
        const items = NAV.map((n) => {
            const cls = current === n.href ? 'active' : '';
            return `<a class="${cls}" href="${n.href}"><span class="ico" aria-hidden="true">${icon(n.icon)}</span>${n.label}</a>`;
        }).join('');
        return `
<aside class="portal-sidebar" aria-label="Portal navigation">
    <div class="side-section">
        <div class="side-label">Workspace</div>
        <nav>${items}</nav>
        <div class="side-meta">
            <strong>Need help?</strong>
            If you have any trouble accessing the portal or submitting a request, please use the <a class="link-bronze" href="../contact.html">contact page</a>.
        </div>
    </div>
</aside>`;
    }

    function mount() {
        if (!guard()) return;
        const top = document.querySelector('[data-portal-topbar]');
        const side = document.querySelector('[data-portal-sidebar]');
        if (top) top.innerHTML = topbarHTML();
        if (side) side.innerHTML = sidebarHTML();
        document.querySelectorAll('[data-signout]').forEach((btn) => {
            btn.addEventListener('click', () => {
                window.Site.logout();
                window.location.href = '../login.html';
            });
        });
    }

    function fmtDate(s) {
        if (!s) return '—';
        try { return new Date(s).toLocaleString(); } catch (e) { return s; }
    }
    function fmtDateShort(s) {
        if (!s) return '—';
        try { return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return s; }
    }
    function statusPill(status) {
        const s = (status || 'new').toLowerCase().replace(/\s+/g, '_');
        const label = (status || 'new').replace(/_/g, ' ');
        return `<span class="pill status-${s}">${label}</span>`;
    }

    window.Portal = { mount, guard, fmtDate, fmtDateShort, statusPill };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();
