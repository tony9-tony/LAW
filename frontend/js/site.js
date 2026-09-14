/* Shared frontend helpers — site chrome, navigation, API client. */
(function () {
    'use strict';

    const FIRM = {
        name: 'Machibya Legal',
        tagline: 'Advocates & Legal Counsel',
        role: 'Emmanuel Richard Machibya — Advocate & Legal Counsel',
        location: 'Posta, Kisutu, Tanzania',
        experience: '10+ years of experience',
        year: new Date().getFullYear()
    };

    const NAV = [
        { href: 'index.html', label: 'Home' },
        { href: 'about.html', label: 'About' },
        { href: 'how-it-works.html', label: 'How It Works' },
        { href: 'legal-insights.html', label: 'Legal Insights' },
        { href: 'contact.html', label: 'Contact' },
        { href: 'login.html', label: 'Client Portal', cta: true }
    ];

    function headerHTML() {
        const current = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
        const authed = API.isAuthed();
        const items = NAV.map((item) => {
            const isCurrent = current === item.href;
            const cls = item.cta ? 'nav-cta' : '';
            const attr = isCurrent ? ' aria-current="page"' : '';
            return `<a class="${cls}" href="${item.href}"${attr}>${item.label}</a>`;
        }).join('');
        const account = authed
            ? `<a class="nav-portal" href="portal/dashboard.html">Client portal</a><button class="nav-signout" type="button" data-signout>Sign out</button>`
            : `<a class="nav-login" href="login.html">Sign in</a>`;
        return `
<header class="site-header" role="banner">
    <div class="wrap site-header-inner">
        <a class="brand" href="index.html" aria-label="${FIRM.name} home">
            <span class="brand-name">${FIRM.name}</span>
            <span class="brand-tag">${FIRM.tagline}</span>
        </a>
        <button class="nav-toggle" type="button" aria-label="Toggle navigation" aria-expanded="false" aria-controls="primary-nav">
            <span></span><span></span><span></span>
        </button>
        <nav class="primary-nav" id="primary-nav" aria-label="Primary navigation">
            ${items}
            ${account}
        </nav>
    </div>
</header>`;
    }

    function footerHTML() {
        const y = FIRM.year;
        return `
<footer class="site-footer" role="contentinfo">
    <div class="wrap">
        <div class="site-footer-grid">
            <div>
                <span class="footer-brand">${FIRM.name}</span>
                <p class="footer-meta">
                    ${FIRM.role}<br>
                    ${FIRM.location}<br>
                    ${FIRM.experience}
                </p>
            </div>
            <div>
                <h4>Firm</h4>
                <ul>
                    <li><a href="about.html">About</a></li>
                    <li><a href="legal-insights.html">Legal insights</a></li>
                    <li><a href="contact.html">Contact</a></li>
                </ul>
            </div>
            <div>
                <h4>Client portal</h4>
                <ul>
                    ${API.isAuthed() ? '<li><a href="portal/dashboard.html">Open portal</a></li><li><a href="#" data-signout>Sign out</a></li>' : '<li><a href="login.html">Sign in</a></li><li><a href="register.html">Create account</a></li>'}
                </ul>
            </div>
        </div>
        <div class="site-footer-meta">
            <span>© ${y} ${FIRM.name}. All rights reserved.</span>
            <span>${FIRM.location}</span>
        </div>
    </div>
</footer>`;
    }

    function mountChrome() {
        const headerSlot = document.querySelector('[data-site-header]');
        const footerSlot = document.querySelector('[data-site-footer]');
        if (headerSlot) headerSlot.innerHTML = headerHTML();
        if (footerSlot) footerSlot.innerHTML = footerHTML();

        const toggle = document.querySelector('.nav-toggle');
        const nav = document.getElementById('primary-nav');
        if (toggle && nav) {
            toggle.addEventListener('click', () => {
                const open = nav.classList.toggle('open');
                toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
            nav.querySelectorAll('a').forEach((a) => {
                a.addEventListener('click', () => {
                    nav.classList.remove('open');
                    toggle.setAttribute('aria-expanded', 'false');
                });
            });
        }
        document.querySelectorAll('[data-signout]').forEach((btn) => {
            btn.addEventListener('click', () => {
                logout();
                window.location.href = 'index.html';
            });
        });
    }

    /* Tiny API client. Base URL configurable via window.__API_BASE__; defaults to same-origin /api/v1. */
    const API = {
        base() {
            if (window.__API_BASE__) return window.__API_BASE__.replace(/\/$/, '');
            if (location.protocol === 'file:') return 'http://localhost:3000/api/v1';
            return '/api/v1';
        },
        token() { return localStorage.getItem('auth_token') || ''; },
        setToken(t) {
            if (t) localStorage.setItem('auth_token', t);
            else localStorage.removeItem('auth_token');
        },
        user() {
            try { return JSON.parse(localStorage.getItem('auth_user') || 'null'); }
            catch (e) { return null; }
        },
        setUser(u) {
            if (u) localStorage.setItem('auth_user', JSON.stringify(u));
            else localStorage.removeItem('auth_user');
        },
        isAuthed() {
            const user = this.user();
            return !!(this.token() && user && user.role === 'CLIENT');
        },
        clear() { this.setToken(''); this.setUser(null); },
        async request(path, { method = 'GET', body, auth = false } = {}) {
            const headers = { 'Content-Type': 'application/json' };
            if (auth && this.token()) headers['Authorization'] = `Bearer ${this.token()}`;
            const res = await fetch(this.base() + path, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined
            });
            const text = await res.text();
            let data = null;
            if (text) {
                try { data = JSON.parse(text); }
                catch (e) { data = null; }
            }
            if (!res.ok) {
                const message = (data && data.error && data.error.message) || `Request failed (${res.status})`;
                const err = new Error(message);
                err.status = res.status;
                err.code = data && data.error && data.error.code;
                err.data = data;
                throw err;
            }
            return data;
        },
        register(payload) { return this.request('/auth/register', { method: 'POST', body: payload }); },
        login(payload) { return this.request('/auth/login', { method: 'POST', body: payload }); },
        me() { return this.request('/profile', { auth: true }); },
        listRequests() { return this.request('/requests', { auth: true }); },
        createRequest(payload) { return this.request('/requests', { method: 'POST', body: payload, auth: true }); },
        getRequest(id) { return this.request(`/requests/${encodeURIComponent(id)}`, { auth: true }); },
        getRequestEvents(id) { return this.request(`/requests/${encodeURIComponent(id)}/events`, { auth: true }); },
        getRequestConversation(id) { return this.request(`/requests/${encodeURIComponent(id)}/conversation`, { auth: true }); },
        listMatters() { return this.request('/matters', { auth: true }); },
        getMatter(id) { return this.request(`/matters/${encodeURIComponent(id)}`, { auth: true }); },
        getMatterEvents(id) { return this.request(`/matters/${encodeURIComponent(id)}/events`, { auth: true }); },
        getMatterConversation(id) { return this.request(`/matters/${encodeURIComponent(id)}/conversation`, { auth: true }); },
        getMatterDocuments(id) { return this.request(`/matters/${encodeURIComponent(id)}/documents`, { auth: true }); },
        getMatterAppointments(id) { return this.request(`/matters/${encodeURIComponent(id)}/appointments`, { auth: true }); },
        listAppointments() { return this.request('/appointments', { auth: true }); },
        listNotifications(opts) {
            const qs = (opts && opts.unreadOnly) ? '?unread=true' : '';
            return this.request(`/notifications${qs}`, { auth: true });
        },
        markNotificationRead(id) { return this.request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', auth: true }); },
        markAllNotificationsRead() { return this.request('/notifications/read-all', { method: 'POST', auth: true }); },
        listConversations(opts) {
            const qs = (opts && opts.limit) ? `?limit=${encodeURIComponent(opts.limit)}&offset=${encodeURIComponent(opts.offset || 0)}` : '';
            return this.request(`/conversations${qs}`, { auth: true });
        },
        getConversation(id, opts) {
            const qs = (opts && opts.after) ? `?after=${encodeURIComponent(opts.after)}` : '';
            return this.request(`/conversations/${encodeURIComponent(id)}${qs}`, { auth: true });
        },
        sendMessage(conversationId, body) {
            return this.request(`/conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body: { body }, auth: true });
        },
        markConversationRead(id) { return this.request(`/conversations/${encodeURIComponent(id)}/read`, { method: 'POST', auth: true }); },
        getOwnerConversation(id, opts) {
            const qs = (opts && opts.after) ? `?after=${encodeURIComponent(opts.after)}` : '';
            return this.request(`/owner/conversations/${encodeURIComponent(id)}${qs}`, { auth: true });
        },
        sendOwnerMessage(conversationId, body) {
            return this.request(`/owner/conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body: { body }, auth: true });
        },
        markOwnerConversationRead(id) { return this.request(`/owner/conversations/${encodeURIComponent(id)}/read`, { method: 'POST', auth: true }); },
        listDocuments() { return this.request('/documents', { auth: true }); },
        listInvoices() { return this.request('/invoices', { auth: true }); },
        getInvoice(id) { return this.request(`/invoices/${encodeURIComponent(id)}`, { auth: true }); },
        getInvoiceItems(id) { return this.request(`/invoices/${encodeURIComponent(id)}/items`, { auth: true }); }
    };

    function logout() { API.clear(); }

    window.Site = { FIRM, NAV, mountChrome, API, logout, isAuthed: () => API.isAuthed() };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountChrome);
    } else {
        mountChrome();
    }
})();
