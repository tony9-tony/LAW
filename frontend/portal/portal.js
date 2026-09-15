/* Shared portal chrome — auth guard, topbar, sidebar, helpers. */
(function () {
    'use strict';

    const FIRM = window.Site && window.Site.FIRM;

    function icon(name) {
        const icons = {
            dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>',
            requests: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M4 6h16M4 12h10M4 18h16"/></svg>',
            matters: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="12" cy="12" r="3"/></svg>',
            messages: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
            appointments: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M12 11h.01M12 15h.01M12 11a3 3 0 1 0 0 4 3 3 0 0 0 0-4z"/></svg>',
            documents: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
            invoices: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15l3 3 3-3"/></svg>',
            notifications: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
            practice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
            profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
        };
        return icons[name] || '';
    }

    const NAV = [
        { href: 'dashboard.html',  label: 'Dashboard',  icon: 'dashboard' },
        { href: 'requests.html',   label: 'Requests',    icon: 'requests' },
        { href: 'matters.html',    label: 'My Matters',  icon: 'matters' },
        { href: 'messages.html',   label: 'Messages',    icon: 'messages' },
        { href: 'appointments.html', label: 'Appointments', icon: 'appointments' },
        { href: 'consultation.html', label: 'Consultation', icon: 'appointments' },
        { href: 'documents.html', label: 'Documents',     icon: 'documents' },
        { href: 'invoices.html', label: 'Invoices',       icon: 'invoices' },
        { href: 'notifications.html', label: 'Notifications', icon: 'notifications' },
        { href: 'practice.html',  label: 'Practice',     icon: 'practice' },
        { href: 'practice-areas.html', label: 'Practice Areas', icon: 'practice' },
        { href: 'profile.html',   label: 'Profile',       icon: 'profile' }
    ];

    function guard() {
        if (!window.Site || !window.Site.API || !window.Site.API.isAuthed()) {
            const target = encodeURIComponent(location.pathname.split('/').pop() || 'dashboard.html');
            window.location.replace('../login.html?next=' + target);
            return false;
        }
        document.body.classList.add('portal-loading');
        // Server-side token verification to prevent cache-based auth bypass
        const token = window.Site.API.token();
        fetch('/api/v1/profile', {
            headers: { 'Authorization': 'Bearer ' + token }
        }).then((res) => {
            document.body.classList.remove('portal-loading');
            if (!res.ok) {
                window.Site.logout();
                const target = encodeURIComponent(location.pathname.split('/').pop() || 'dashboard.html');
                window.location.replace('../login.html?next=' + target);
                return false;
            }
            return true;
        }).catch(() => {
            document.body.classList.remove('portal-loading');
            window.Site.logout();
            const target = encodeURIComponent(location.pathname.split('/').pop() || 'dashboard.html');
            window.location.replace('../login.html?next=' + target);
            return false;
        });
        return true;
    }

    function topbarHTML() {
        const u = window.Site.API.user() || {};
        const initials = (u.fullName || u.email || '·').trim().slice(0, 1).toUpperCase();
        return `
<header class="portal-topbar" role="banner">
    <div class="portal-topbar-start">
        <button type="button" class="nav-toggle" id="portalNavToggle"
                aria-label="Toggle navigation menu"
                aria-controls="portal-sidebar"
                aria-expanded="false">
            <span class="nav-toggle-bar"></span>
            <span class="nav-toggle-bar"></span>
            <span class="nav-toggle-bar"></span>
        </button>
        <a class="portal-brand" href="dashboard.html" aria-label="${(FIRM && FIRM.name) || ''} client portal">
            <span class="portal-brand-name">${(FIRM && FIRM.name) || ''}</span>
            <span class="portal-brand-tag">Client portal</span>
        </a>
    </div>
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
        const current = (new URL(location.href)).pathname.split('/').pop() || 'dashboard.html';
        const items = NAV.map((n) => {
            const target = (new URL(n.href, location.href)).pathname.split('/').pop() || n.href;
            const cls = current.toLowerCase() === target.toLowerCase() ? 'active' : '';
            const badge = (n.label === 'Messages') ? '<span class="nav-badge" id="nav-badge-messages" aria-label="unread messages" aria-hidden="true"></span>' : '';
            return `<a class="${cls}" href="${n.href}"><span class="ico" aria-hidden="true">${icon(n.icon)}</span>${n.label}${badge}</a>`;
        }).join('');
        return `
<aside class="portal-sidebar" id="portal-sidebar" aria-label="Portal navigation">
    <div class="side-section">
        <div class="side-label">Workspace</div>
        <nav class="side-nav">${items}</nav>
        <div class="side-meta">
            <strong>Need help?</strong>
            If you have any trouble accessing the portal or submitting a request, please use the <a class="link-bronze" href="../contact.html">contact page</a>.
        </div>
    </div>
</aside>`;
    }

    function refreshUnreadIndicators() {
        const badge = document.getElementById('nav-badge-messages');
        if (!badge) return;
        if (!window.Site.API.isAuthed()) {
            badge.style.display = 'none';
            return;
        }
        window.Site.API.listConversations({ limit: 100, offset: 0 })
            .then((res) => {
                const items = (res && res.data) || [];
                const total = items.reduce((sum, c) => sum + (c.unread_count || 0), 0);
                badge.textContent = total > 0 ? String(total) : '';
                badge.style.display = total > 0 ? 'inline-flex' : 'none';
            })
            .catch(() => {
                badge.style.display = 'none';
            });
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

        refreshUnreadIndicators();

        if (window.Site.Realtime) {
            const rt = window.Site.Realtime;
            const onNewMsg = () => refreshUnreadIndicators();
            rt.on('message.created', onNewMsg);
            rt.on('message.read', () => refreshUnreadIndicators());
        }

        initMobileNav();
    }

    function initMobileNav() {
        const toggle = document.getElementById('portalNavToggle');
        const sidebar = document.getElementById('portal-sidebar');
        if (!toggle || !sidebar) return;

        let overlay = document.getElementById('portalNavOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'portalNavOverlay';
            overlay.className = 'portal-nav-overlay';
            document.body.appendChild(overlay);
        }

        const open = () => {
            sidebar.classList.add('nav-open');
            overlay.classList.add('nav-open');
            toggle.setAttribute('aria-expanded', 'true');
            document.body.style.overflow = 'hidden';
        };
        const close = () => {
            sidebar.classList.remove('nav-open');
            overlay.classList.remove('nav-open');
            toggle.setAttribute('aria-expanded', 'false');
            document.body.style.overflow = '';
        };

        let isDesktop = window.matchMedia('(min-width: 861px)').matches;
        if (isDesktop) { sidebar.classList.remove('nav-open'); overlay.classList.remove('nav-open'); toggle.setAttribute('aria-expanded', 'false'); document.body.style.overflow = ''; }

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = sidebar.classList.contains('nav-open');
            if (isOpen) close(); else open();
        });

        overlay.addEventListener('click', close);

        sidebar.addEventListener('click', (e) => {
            if (e.target.tagName === 'A' || e.target.closest('a')) {
                close();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sidebar.classList.contains('nav-open')) {
                close();
            }
        });

        window.matchMedia('(min-width: 861px)').addEventListener('change', (e) => {
            if (e.matches) close();
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

    window.Portal = { mount, guard, fmtDate, fmtDateShort, statusPill, refreshUnreadIndicators };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();
