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
            payments: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 14h.01M15 14h.01M7 19l1-1h8l1 1z"/></svg>',
            notifications: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
            practice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
            profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
        };
        return icons[name] || '';
    }

    /* In the order a client uses them: start something, follow it, pay, keep the record. */
    const NAV = [
        { href: 'dashboard.html',  label: 'Dashboard',  icon: 'dashboard' },
        { href: 'custom-matter.html', label: 'New request', icon: 'requests' },
        { href: 'consultation.html', label: 'Book consultation', icon: 'appointments' },
        { href: 'requests.html',   label: 'My requests', icon: 'requests' },
        { href: 'matters.html',    label: 'My matters',  icon: 'matters' },
        { href: 'messages.html',   label: 'Messages',    icon: 'messages' },
        { href: 'appointments.html', label: 'Appointments', icon: 'appointments' },
        { href: 'documents.html', label: 'Documents',     icon: 'documents' },
        { href: 'invoices.html', label: 'Invoices',       icon: 'invoices' },
        { href: 'payments.html', label: 'Payments',       icon: 'payments' },
        { href: 'notifications.html', label: 'Notifications', icon: 'notifications' },
        { href: 'practice.html',  label: 'Practice areas', icon: 'practice' },
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
            /* A network hiccup, or the check being cut short because the person
               already moved to another page, is not a sign-out: only a 401 above is. */
            document.body.classList.remove('portal-loading');
            return true;
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
        <a class="public-link" href="../index.html">← Back to website</a>
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
            See the <a class="link-bronze" href="../how-it-works.html#faq">questions and answers</a>, or call or WhatsApp the firm on <a class="link-bronze" href="tel:+255714840951">+255 714 840 951</a> or <a class="link-bronze" href="tel:+255657259584">+255 657 259 584</a>.
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
                const total = items.reduce((sum, c) => sum + (Number(c.unread_count) || 0), 0);
                badge.textContent = total > 0 ? String(total) : '';
                badge.style.display = total > 0 ? 'inline-flex' : 'none';
            })
            .catch(() => {
                badge.style.display = 'none';
            });
    }

    /* Small live toast, so something new from the firm is noticed without a reload. */
    function toast(title, body, href) {
        try {
            let host = document.getElementById('portal-toasts');
            if (!host) {
                host = document.createElement('div');
                host.id = 'portal-toasts';
                host.setAttribute('aria-live', 'polite');
                document.body.appendChild(host);
            }
            const el = document.createElement(href ? 'a' : 'div');
            el.className = 'portal-toast';
            if (href) el.href = href;
            el.innerHTML = '<strong></strong><span></span>';
            el.firstChild.textContent = title;
            el.lastChild.textContent = body || '';
            host.appendChild(el);
            setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 6000);
        } catch (e) { /* toasts are a nicety */ }
    }

    /* Run fn (debounced) whenever any of these live events arrive. */
    function onLive(types, fn) {
        const rt = window.Site && window.Site.Realtime;
        if (!rt) return;
        let timer = null;
        const run = () => { clearTimeout(timer); timer = setTimeout(fn, 250); };
        (Array.isArray(types) ? types : [types]).forEach((t) => rt.on(t, run));
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

        document.addEventListener('click', (e) => {
            const link = e.target.closest('.row-link[data-href], [data-nav]');
            if (!link) return;
            e.preventDefault();
            const href = link.getAttribute('data-href') || link.getAttribute('data-nav');
            if (href) window.location.href = href;
        });

        refreshUnreadIndicators();

        if (window.Site.Realtime) {
            const rt = window.Site.Realtime;
            const onNewMsg = (data) => {
                refreshUnreadIndicators();
                const m = data && data.message;
                const me = window.Site.API.user() || {};
                const onMessagesPage = /messages\.html$/i.test(location.pathname);
                if (m && String(m.sender_id) !== String(me.id) && !onMessagesPage) {
                    toast('New message from the firm', m.body ? String(m.body).slice(0, 90) : '', 'messages.html' + (data.conversationId ? '?conversation=' + encodeURIComponent(data.conversationId) : ''));
                }
            };
            rt.on('message.created', onNewMsg);
            rt.on('message.read', () => refreshUnreadIndicators());
            rt.on('matter.created', (d) => toast('Your matter has been opened', d && d.reference ? 'Reference ' + d.reference : '', 'matter.html?id=' + encodeURIComponent(d.matterId)));
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

    /* "8 Oct 2026, 10:14": the same readable form on every page. */
    function fmtDate(s) {
        if (!s) return '—';
        const d = new Date(s);
        if (isNaN(d.getTime())) return String(s);
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }
    function fmtDateShort(s) {
        if (!s) return '—';
        try { return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return s; }
    }
    /* Plain words for the status codes the server uses. */
    const STATUS_LABELS = {
        submitted: 'Submitted', under_review: 'Under review', action_required: 'Action required', accepted: 'Accepted',
        declined: 'Declined', scheduled: 'Scheduled', completed: 'Completed', closed: 'Closed', open: 'Open', active: 'Active',
        on_hold: 'On hold', resolved: 'Resolved', confirmed: 'Confirmed', cancelled: 'Cancelled', no_show: 'Missed',
        draft: 'Draft', issued: 'Issued', paid: 'Paid', overdue: 'Overdue', unpaid: 'Not paid', payment_required: 'Payment required',
        payment_pending_verification: 'Pending verification', payment_rejected: 'Rejected', pending: 'Pending verification',
        verified: 'Confirmed', rejected: 'Rejected', new: 'New'
    };
    function statusLabel(status) {
        const key = String(status || 'new').toLowerCase().replace(/\s+/g, '_');
        return STATUS_LABELS[key] || String(status || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
    }
    function statusPill(status) {
        const s = (status || 'new').toLowerCase().replace(/\s+/g, '_');
        return `<span class="pill status-${s}">${statusLabel(status)}</span>`;
    }

    /* Short, readable reference for an id (ids are long UUIDs): "B29FE05C". */
    function shortRef(id) {
        const v = String(id == null ? '' : id);
        return /^[0-9a-f]{8}-/i.test(v) ? v.slice(0, 8).toUpperCase() : v.padStart(5, '0');
    }

    window.Portal = { mount, toast, onLive, guard, fmtDate, fmtDateShort, statusPill, statusLabel, refreshUnreadIndicators, shortRef };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();
