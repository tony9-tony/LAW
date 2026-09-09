/* SUBUI JavaScript module — Owner Command Center.
   Uses the shared API helper and handles auth, navigation, and data loading. */
(function () {
    'use strict';

    const tokenKey = 'auth_token';

    function token() { return localStorage.getItem(tokenKey) || ''; }

    function escape(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function api(path, opts) {
        opts = opts || {};
        const headers = { 'Content-Type': 'application/json' };
        if (opts.auth && token()) headers['Authorization'] = 'Bearer ' + token();
        return fetch((window.__API_BASE__ || '/api/v1') + path, {
            method: opts.method || 'GET',
            headers,
            body: opts.body ? JSON.stringify(opts.body) : undefined
        }).then(async (r) => {
            const t = await r.text();
            const j = t ? JSON.parse(t) : null;
            if (!r.ok) throw new Error((j && j.error && j.error.message) || ('HTTP ' + r.status));
            return j;
        });
    }

    async function loadSection(section, detailId) {
        ownerStopPolling();
        // Auth guard
        if (!token()) {
            window.location.href = 'login.html';
            return;
        }
        const container = document.getElementById('main-content');
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading...</strong></div>';
        try {
            switch (section) {
                case 'users':             await loadUsers(); break;
                case 'clients':           detailId ? await loadClientDetail(detailId) : await loadClients(); break;
                case 'lawyers':           await loadLawyers(); break;
                case 'staff':             await loadStaff(); break;
                case 'owners':            await loadOwners(); break;
                case 'requests':          detailId ? await loadRequestDetail(detailId) : await loadRequests(); break;
                case 'matters':           detailId ? await loadMatterDetail(detailId) : await loadMatters(); break;
                case 'appointments':      detailId ? await loadAppointmentDetail(detailId) : await loadAppointments(); break;
                case 'documents':         detailId ? await loadDocumentDetail(detailId) : await loadDocuments(); break;
                case 'messages':          await loadMessages(detailId); break;
                case 'notifications':     await loadNotifications(); break;
                case 'analytics':         await loadAnalyticsPage(); break;
                case 'audit':             await loadAudit(); break;
                case 'security':          await loadSecurity(); break;
                case 'roles':             await loadRoles(); break;
                case 'settings':          await loadSettings(); break;
                case 'health':            await loadHealth(); break;
                case 'dashboard':
                default:                  await loadDashboard(); break;
            }
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Error loading section.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadDashboard() {
        // Auth guard: if token is missing or invalid, redirect to login
        if (!token()) {
            window.location.href = 'login.html';
            return;
        }
        try {
            const check = await api('/profile', { auth: true });
            if (!check.data || check.data.role !== 'OWNER') {
                localStorage.removeItem(tokenKey);
                localStorage.removeItem('auth_user');
                window.location.href = 'login.html';
                return;
            }
        } catch {
            localStorage.removeItem(tokenKey);
            localStorage.removeItem('auth_user');
            window.location.href = 'login.html';
            return;
        }

        const container = document.getElementById('main-content');
        container.innerHTML = `
            <div class="page-head">
                <div>
                    <span class="kicker">Practice Dashboard</span>
                    <h1>Command Center</h1>
                    <p class="head-meta">A consolidated view of recent activity, open work, and incoming requests.</p>
                </div>
            </div>
            <section class="kpi-grid">
                <div class="kpi"><div class="kpi-label">Open Requests</div><div class="kpi-value" id="dash-requests">—</div><div class="kpi-trend" id="dash-requests-meta">Awaiting review</div></div>
                <div class="kpi"><div class="kpi-label">Active Matters</div><div class="kpi-value" id="dash-matters">—</div><div class="kpi-trend" id="dash-matters-meta">In progress</div></div>
                <div class="kpi"><div class="kpi-label">Upcoming Appointments</div><div class="kpi-value" id="dash-appts">—</div><div class="kpi-trend" id="dash-appts-meta">This week</div></div>
                <div class="kpi"><div class="kpi-label">Unread Messages</div><div class="kpi-value" id="dash-notif">—</div><div class="kpi-trend" id="dash-notif-meta">Awaiting attention</div></div>
            </section>
            <section class="panel">
                <div class="panel-head">
                    <h2>Recent Client Requests</h2>
                    <a class="btn ghost" href="#" onclick="window.location.hash='#requests';return false;">View all</a>
                </div>
                <div class="panel-body tight" id="dash-recent-requests">
                    <div class="empty-state"><span class="ico">·</span><strong>Loading...</strong></div>
                </div>
            </section>
            <section class="panel">
                <div class="panel-head">
                    <h2>Recent Messages</h2>
                    <a class="btn ghost" href="#" onclick="window.location.hash='#messages';return false;">View all</a>
                </div>
                <div class="panel-body tight" id="dash-recent-messages">
                    <div class="empty-state"><span class="ico">·</span><strong>Loading...</strong></div>
                </div>
            </section>
            <section class="panel">
                <div class="panel-head">
                    <h2>Recent Matters</h2>
                    <a class="btn ghost" href="#" onclick="window.location.hash='#matters';return false;">View all</a>
                </div>
                <div class="panel-body tight" id="dash-recent-matters">
                    <div class="empty-state"><span class="ico">·</span><strong>Loading...</strong></div>
                </div>
            </section>
        `;
        loadAnalytics();
        loadRecentRequests();
        loadRecentMessages();
        loadRecentMatters();
    }

    async function loadAnalytics() {
        try {
            const res = await api('/owner/analytics', { auth: true });
            const d = res.data;
            const setKPI = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
            setKPI('dash-requests', d.requests.open);
            setKPI('dash-matters', d.matters.active);
            setKPI('dash-appts', d.appointments.upcoming);
            setKPI('dash-notif', d.notifications.unread);
        } catch (error) {
            const setErr = (id) => { const el = document.getElementById(id); if (el) el.textContent = '!'; };
            ['dash-requests','dash-matters','dash-appts','dash-notif'].forEach(setErr);
        }
    }

    async function loadRecentRequests() {
        const el = document.getElementById('dash-recent-requests');
        try {
            const res = await api('/owner/requests', { auth: true });
            const items = (res && res.data) || [];
            if (!items.length) {
                el.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>No requests yet.</strong><p>New requests will appear here as clients submit them.</p></div>';
            } else {
                el.innerHTML = `<table class="table"><thead><tr>
                    <th>ID</th><th>Subject</th><th>Client</th><th>Status</th><th>Created</th><th>Actions</th>
                    </tr></thead><tbody>${items.slice(0, 5).map((r) => `
                    <tr>
                        <td class="mono">#${r.id.split('-')[0]}</td>
                        <td>${escape(r.subject)}</td>
                        <td class="muted">${escape(r.client_name)}</td>
                        <td>${escape(r.status)}</td>
                        <td class="muted">${escape(r.created_at)}</td>
                        <td><button class="btn small secondary" data-request="${r.id}">View</button></td>
                    </tr>
                `).join('')}</tbody></table>`;
                el.querySelectorAll('button[data-request]').forEach((btn) => {
                    btn.addEventListener('click', () => loadRequestDetail(btn.getAttribute('data-request')));
                });
            }
        } catch (error) {
            el.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load requests.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadRecentMessages() {
        const el = document.getElementById('dash-recent-messages');
        if (!el) return;
        try {
            const res = await api('/owner/conversations?limit=5', { auth: true });
            const items = (res && res.data) || [];
            if (!items.length) {
                el.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>No messages yet.</strong></div>';
                return;
            }
            el.innerHTML = items.slice(0, 5).map(c => `
                <div style="padding:0.6rem 1.25rem;border-bottom:1px solid var(--line);cursor:pointer;" onclick="loadSection('messages')">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <strong style="color:var(--ink);">${escape(c.client_name || 'Client')}</strong>
                        ${c.unread_count > 0 ? `<span class="pill status-new" style="font-size:0.65rem;">${c.unread_count} unread</span>` : ''}
                    </div>
                    <div style="color:var(--ink-mute);font-size:0.85rem;white-space:pre-wrap;overflow:hidden;text-overflow:ellipsis;">${escape((c.last_message_body || '').slice(0, 80))}</div>
                </div>
            `).join('');
        } catch (e) {
            el.innerHTML = '<div class="empty-state"><span class="ico">!</span><strong>Could not load messages.</strong></div>';
        }
    }

    async function loadRecentMatters() {
        const el = document.getElementById('dash-recent-matters');
        if (!el) return;
        try {
            const res = await api('/owner/matters', { auth: true });
            const items = (res && res.data) || [];
            if (!items.length) {
                el.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>No open matters.</strong></div>';
                return;
            }
            el.innerHTML = `<table class="table"><thead><tr>
                <th>ID</th><th>Reference</th><th>Title</th><th>Client</th><th>Status</th><th>Updated</th><th>Actions</th>
                </tr></thead><tbody>${items.slice(0, 5).map((m) => `
                <tr>
                    <td class="mono">#${m.id.split('-')[0]}</td>
                    <td class="mono">${escape(m.reference)}</td>
                    <td>${escape(m.title || '—')}</td>
                    <td class="muted">${escape(m.client_name)}</td>
                    <td>${escape(m.status)}</td>
                    <td class="muted">${escape(m.updated_at)}</td>
                    <td><button class="btn small secondary" data-matter="${m.id}">View</button></td>
                </tr>
            `).join('')}</tbody></table>`;
            el.querySelectorAll('button[data-matter]').forEach((btn) => {
                btn.addEventListener('click', () => loadMatterDetail(btn.getAttribute('data-matter')));
            });
        } catch (e) {
            el.innerHTML = '<div class="empty-state"><span class="ico">!</span><strong>Could not load matters.</strong></div>';
        }
    }

    async function loadUsers() {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/owner/users?limit=50', { auth: true });
            const items = (res && res.data) || [];
            container.innerHTML = `
                <div class="page-head">
                    <div><h1>Users</h1><p class="head-meta">Manage platform users, roles, and account status.</p></div>
                    <div class="action-row"><button class="btn primary" id="show-create-user">New User</button></div>
                </div>
                <section class="panel" id="create-user-panel" style="display:none;margin-bottom:1rem;">
                    <div class="panel-head"><h2>Create User</h2></div>
                    <div class="panel-body">
                        <form id="createUserForm" novalidate>
                            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem;">
                                <div class="field">
                                    <label for="cu-name">Full name</label>
                                    <input id="cu-name" name="fullName" type="text" autocomplete="name" minlength="2" maxlength="160" required>
                                    <span class="error">Please provide a valid name.</span>
                                </div>
                                <div class="field">
                                    <label for="cu-email">Email address</label>
                                    <input id="cu-email" name="email" type="email" autocomplete="email" required>
                                    <span class="error">Please provide a valid email.</span>
                                </div>
                                <div class="field">
                                    <label for="cu-password">Password</label>
                                    <input id="cu-password" name="password" type="password" autocomplete="new-password" minlength="12" required>
                                    <span class="help">At least 12 characters.</span>
                                    <span class="error">Password is required.</span>
                                </div>
                                <div class="field">
                                    <label for="cu-role">Role</label>
                                    <select id="cu-role" name="role" required>
                                        <option value="CLIENT">Client</option>
                                        <option value="LAWYER">Lawyer</option>
                                        <option value="STAFF">Staff</option>
                                        <option value="OWNER">Owner</option>
                                    </select>
                                </div>
                            </div>
                            <div class="page-actions" style="margin-top:1rem;">
                                <button type="submit" class="btn primary">Create User</button>
                                <button type="button" class="btn ghost" id="hide-create-user">Cancel</button>
                            </div>
                            <div class="form-status" id="cu-status" role="status" aria-live="polite" style="margin-top:0.75rem;"></div>
                        </form>
                    </div>
                </section>
                <section class="panel">
                    <div class="panel-head"><h2>All Users</h2><span class="panel-meta">${res.meta.total} total</span></div>
                    <div class="panel-body tight">
                        <table class="table">
                            <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
                            <tbody>${items.map((u) => `
                                <tr>
                                    <td class="mono">#${u.id.split('-')[0]}</td>
                                    <td>${escape(u.full_name)}</td>
                                    <td class="muted">${escape(u.email)}</td>
                                    <td>${escape(u.role)}</td>
                                    <td>${u.is_active ? '<span class=\"pill status-open\">Active</span>' : '<span class=\"pill status-closed">Inactive</span>'}</td>
                                    <td><button class="btn small secondary" data-user="${u.id}">View</button></td>
                                </tr>
                            `).join('')}</tbody>
                        </table>
                    </div>
                </section>
            `;
            document.getElementById('show-create-user')?.addEventListener('click', () => {
                const panel = document.getElementById('create-user-panel');
                if (panel) panel.style.display = 'block';
            });
            document.getElementById('hide-create-user')?.addEventListener('click', () => {
                const panel = document.getElementById('create-user-panel');
                if (panel) panel.style.display = 'none';
            });
            const createForm = document.getElementById('createUserForm');
            if (createForm) {
                createForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const status = document.getElementById('cu-status');
                    status.className = 'form-status';
                    status.textContent = 'Creating user…';
                    const data = {};
                    new FormData(createForm).forEach((v, k) => { data[k] = v; });
                    try {
                        const result = await api('/owner/users', { method: 'POST', body: data, auth: true });
                        status.className = 'form-status success';
                        status.innerHTML = '<strong>User created.</strong>Refreshing list…';
                        setTimeout(() => loadUsers(), 600);
                    } catch (err) {
                        status.className = 'form-status error';
                        status.innerHTML = `<strong>Could not create user.</strong>${escape(err.message)}`;
                    }
                });
            }
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load users.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadClients() {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/owner/clients', { auth: true });
            const items = (res && res.data) || [];
            container.innerHTML = `
                <div class="page-head"><div><h1>Clients</h1><p class="head-meta">Manage client accounts and matters.</p></div></div>
                <section class="panel">
                    <div class="panel-head"><h2>All Clients</h2><span class="panel-meta">${items.length} total</span></div>
                    <div class="panel-body tight">
                        ${items.length === 0
                            ? '<div class="empty-state"><span class="ico">·</span><strong>No clients yet.</strong><p>Clients will appear here when they register or are created.</p></div>'
                            : `<table class="table">
                            <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Status</th><th>Last Login</th><th>Created</th><th>Actions</th></tr></thead>
                            <tbody>${items.map((u) => `
                                <tr>
                                    <td class="mono">#${u.id.split('-')[0]}</td>
                                    <td>${escape(u.full_name)}</td>
                                    <td class="muted">${escape(u.email)}</td>
                                    <td>${u.is_active ? '<span class="pill status-open">Active</span>' : '<span class="pill status-closed">Inactive</span>'}</td>
                                    <td class="muted">${escape(u.last_login_at || '—')}</td>
                                    <td class="muted">${escape(u.created_at)}</td>
                                    <td><button class="btn small secondary" data-client="${u.id}">View</button></td>
                                </tr>
                            `).join('')}</tbody>
                        </table>`
                        }
                    </div>
                </section>
            `;
            container.querySelectorAll('button[data-client]').forEach((btn) => {
                btn.addEventListener('click', () => loadClientDetail(btn.getAttribute('data-client')));
            });
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load clients.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadLawyers() {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/owner/lawyers', { auth: true });
            const items = (res && res.data) || [];
            container.innerHTML = `
                <div class="page-head"><div><h1>Lawyers</h1><p class="head-meta">Manage all lawyer accounts.</p></div></div>
                <section class="panel">
                    <div class="panel-head"><h2>All Lawyers</h2><span class="panel-meta">${items.length} total</span></div>
                    <div class="panel-body tight">
                        <table class="table">
                            <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Status</th><th>Last Login</th><th>Created</th><th>Actions</th></tr></thead>
                            <tbody>${items.map((u) => `
                                <tr>
                                    <td class="mono">#${u.id.split('-')[0]}</td>
                                    <td>${escape(u.full_name)}</td>
                                    <td class="muted">${escape(u.email)}</td>
                                    <td>${u.is_active ? '<span class="pill status-open">Active</span>' : '<span class="pill status-closed">Inactive</span>'}</td>
                                    <td class="muted">${escape(u.last_login_at || '—')}</td>
                                    <td class="muted">${escape(u.created_at)}</td>
                                    <td><button class="btn small secondary">View</button></td>
                                </tr>
                            `).join('')}</tbody>
                        </table>
                    </div>
                </section>
            `;
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load lawyers.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadOwners() {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/owner/owners', { auth: true });
            const items = (res && res.data) || [];
            container.innerHTML = `
                <div class="page-head">
                    <div>
                        <h1>Owner Accounts</h1>
                        <p class="head-meta">Manage platform owner accounts.</p>
                    </div>
                    <button class="btn primary" id="btn-create-owner">Create Owner</button>
                </div>
                <section class="panel">
                    <div class="panel-head"><h2>All Owners</h2><span class="panel-meta">${items.length} total</span></div>
                    <div class="panel-body tight">
                        <table class="table">
                            <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Status</th><th>Last Login</th><th>Created</th></tr></thead>
                            <tbody>${items.map((u) => `
                                <tr>
                                    <td class="mono">#${u.id.split('-')[0]}</td>
                                    <td>${escape(u.full_name)}</td>
                                    <td class="muted">${escape(u.email)}</td>
                                    <td>${u.is_active ? '<span class="pill status-open">Active</span>' : '<span class="pill status-closed">Inactive</span>'}</td>
                                    <td class="muted">${escape(u.last_login_at || '—')}</td>
                                    <td class="muted">${escape(u.created_at)}</td>
                                </tr>
                            `).join('')}</tbody>
                        </table>
                    </div>
                </section>
            `;
            const btn = document.getElementById('btn-create-owner');
            if (btn) {
                btn.addEventListener('click', () => {
                    const modal = document.createElement('div');
                    modal.className = 'modal-overlay';
                    modal.id = 'create-owner-modal';
                    modal.innerHTML = `
                        <div class="modal" style="max-width:420px;">
                            <div class="panel-head"><h2>Create Owner Account</h2></div>
                            <div class="panel-body">
                                <form id="createOwnerForm" novalidate>
                                    <div class="field">
                                        <label for="co-name">Full name</label>
                                        <input id="co-name" name="fullName" type="text" autocomplete="name" minlength="2" maxlength="160" required>
                                        <span class="error">Please provide a valid name.</span>
                                    </div>
                                    <div class="field">
                                        <label for="co-email">Email address</label>
                                        <input id="co-email" name="email" type="email" autocomplete="email" required>
                                        <span class="error">Please provide a valid email.</span>
                                    </div>
                                    <div class="field">
                                        <label for="co-password">Password</label>
                                        <input id="co-password" name="password" type="password" autocomplete="new-password" minlength="12" required>
                                        <span class="help">At least 12 characters.</span>
                                        <span class="error">Password is required.</span>
                                    </div>
                                    <div class="field">
                                        <label for="co-confirm">Confirm password</label>
                                        <input id="co-confirm" name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required>
                                        <span class="error">Passwords do not match.</span>
                                    </div>
                                    <div class="form-status" id="co-status" role="status" aria-live="polite" style="margin-bottom:1rem;"></div>
                                    <div class="actions" style="display:flex;gap:0.75rem;justify-content:flex-end;">
                                        <button type="button" class="btn ghost" id="co-cancel">Cancel</button>
                                        <button type="submit" class="btn primary">Create Owner</button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    `;
                    document.body.appendChild(modal);

                    const validateModal = (form) => {
                        let ok = true;
                        form.querySelectorAll('.field').forEach((field) => {
                            const input = field.querySelector('input, textarea, select');
                            if (!input) return;
                            const value = (input.value || '').trim();
                            let valid = true;
                            if (input.required && !value) valid = false;
                            if (input.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) valid = false;
                            if (input.minLength && value && value.length < input.minLength) valid = false;
                            field.classList.toggle('invalid', !valid);
                            if (!valid) ok = false;
                        });
                        const pw = form.querySelector('#co-password')?.value || '';
                        const confirm = form.querySelector('#co-confirm')?.value || '';
                        const confirmField = form.querySelector('#co-confirm')?.closest('.field');
                        if (pw !== confirm) {
                            ok = false;
                            if (confirmField) confirmField.classList.add('invalid');
                        }
                        return ok;
                    };

                    const closeModal = () => modal.remove();

                    modal.querySelector('#co-cancel').addEventListener('click', closeModal);
                    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

                    modal.querySelector('#createOwnerForm').addEventListener('submit', async (e) => {
                        e.preventDefault();
                        const form = e.target;
                        const status = document.getElementById('co-status');
                        status.className = 'form-status';
                        status.textContent = 'Creating owner account…';
                        if (!validateModal(form)) {
                            status.className = 'form-status error';
                            status.innerHTML = '<strong>Please review the form.</strong>Required fields are missing or invalid.';
                            return;
                        }
                        const data = {};
                        new FormData(form).forEach((v, k) => { data[k] = v; });
                        try {
                            const res = await api('/owner/owners', { method: 'POST', body: data, auth: true });
                            status.className = 'form-status success';
                            status.innerHTML = '<strong>Owner created.</strong>Closing…';
                            setTimeout(() => { closeModal(); loadOwners(); }, 600);
                        } catch (err) {
                            status.className = 'form-status error';
                            status.innerHTML = `<strong>Failed.</strong>${err.message}`;
                        }
                    });
                });
            }
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load owners.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadStaff() {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/owner/staff', { auth: true });
            const items = (res && res.data) || [];
            container.innerHTML = `
                <div class="page-head"><div><h1>Staff</h1><p class="head-meta">Manage all staff accounts.</p></div></div>
                <section class="panel">
                    <div class="panel-head"><h2>All Staff</h2><span class="panel-meta">${items.length} total</span></div>
                    <div class="panel-body tight">
                        <table class="table">
                            <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Status</th><th>Last Login</th><th>Created</th><th>Actions</th></tr></thead>
                            <tbody>${items.map((u) => `
                                <tr>
                                    <td class="mono">#${u.id.split('-')[0]}</td>
                                    <td>${escape(u.full_name)}</td>
                                    <td class="muted">${escape(u.email)}</td>
                                    <td>${u.is_active ? '<span class="pill status-open">Active</span>' : '<span class="pill status-closed">Inactive</span>'}</td>
                                    <td class="muted">${escape(u.last_login_at || '—')}</td>
                                    <td class="muted">${escape(u.created_at)}</td>
                                    <td><button class="btn small secondary">View</button></td>
                                </tr>
                            `).join('')}</tbody>
                        </table>
                    </div>
                </section>
            `;
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load staff.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadRequests() {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/owner/requests', { auth: true });
            const items = (res && res.data) || [];
            container.innerHTML = `
                <div class="page-head"><div><h1>Service Requests</h1><p class="head-meta">Manage all client service requests and their status.</p></div></div>
                <section class="panel">
                    <div class="panel-head"><h2>All Requests</h2><span class="panel-meta">${items.length} total</span></div>
                    <div class="panel-body tight">
                        <table class="table">
                            <thead><tr><th>ID</th><th>Subject</th><th>Client</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
                            <tbody>${items.map((r) => `
                                <tr>
                                    <td class="mono">#${r.id.split('-')[0]}</td>
                                    <td>${escape(r.subject)}</td>
                                    <td class="muted">${escape(r.client_name)}</td>
                                    <td>${escape(r.status)}</td>
                                    <td class="muted">${escape(r.created_at)}</td>
                                    <td><button class="btn small secondary" data-request="${r.id}">View</button></td>
                                </tr>
                            `).join('')}</tbody>
                        </table>
                    </div>
                </section>
            `;
            container.querySelectorAll('button[data-request]').forEach((btn) => {
                btn.addEventListener('click', () => loadRequestDetail(btn.getAttribute('data-request')));
            });
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load requests.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadRequestDetail(id) {
        const container = document.getElementById('main-content');
        try {
            const res = await api(`/owner/requests/${encodeURIComponent(id)}`, { auth: true });
            const r = (res && res.data) || {};
            container.innerHTML = `
                <div class="page-head">
                    <div>
                        <span class="kicker">Request</span>
                        <h1>${escape(r.subject)}</h1>
                        <p class="head-meta">Request #${escape(r.id.split('-')[0])}</p>
                    </div>
                    <div class="action-row">
                        <button class="btn ghost" id="back-requests">← Back</button>
                        ${r.matter_id ? `<button class="btn primary" id="start-convo">Start Conversation</button>` : ''}
                    </div>
                </div>
                <section class="panel">
                    <div class="panel-head"><h2>Request Details</h2></div>
                    <div class="panel-body">
                        <table class="table">
                            <tbody>
                                <tr><th style="width:30%">Client</th><td>${escape(r.client_name || '—')}<br><span class="muted">${escape(r.client_email || '')}</span></td></tr>
                                <tr><th>Status</th><td>${escape(r.status || '—')}</td></tr>
                                <tr><th>Created</th><td class="muted">${escape(r.created_at || '—')}</td></tr>
                                <tr><th>Updated</th><td class="muted">${escape(r.updated_at || '—')}</td></tr>
                                ${r.matter_id ? `<tr><th>Related Matter</th><td>${escape(r.matter_reference || '')} — ${escape(r.matter_title || '')}<br><span class="muted">${escape(r.matter_type || '')} · ${escape(r.matter_status || '')}</span></td></tr>` : ''}
                            </tbody>
                        </table>
                        <div style="margin-top:1.5rem;">
                            <h3 style="font-size:0.78rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:0.5rem;">Description</h3>
                            <p style="white-space:pre-wrap;color:var(--ink-soft);line-height:1.6;">${escape(r.description || 'No description provided.')}</p>
                        </div>
                    </div>
                </section>
            `;
            document.getElementById('back-requests')?.addEventListener('click', loadRequests);
            const startBtn = document.getElementById('start-convo');
            if (startBtn) {
                startBtn.addEventListener('click', async () => {
                    try {
                        const convoRes = await api(`/owner/matters/${encodeURIComponent(r.matter_id)}/conversation`, { auth: true });
                        const convo = (convoRes && convoRes.data) || {};
                        if (convo.id) {
                            currentOwnerConversationId = convo.id;
                            loadMessages();
                        }
                    } catch (err) {
                        alert(err.message || 'Could not start conversation.');
                    }
                });
            }
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load request.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadMatters() {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/owner/matters', { auth: true });
            const items = (res && res.data) || [];
            container.innerHTML = `
                <div class="page-head"><div><h1>Matters / Cases</h1><p class="head-meta">Manage all legal matters and cases.</p></div></div>
                <section class="panel">
                    <div class="panel-head"><h2>All Matters</h2><span class="panel-meta">${items.length} total</span></div>
                    <div class="panel-body tight">
                        ${items.length === 0
                            ? '<div class="empty-state"><span class="ico">·</span><strong>No matters yet.</strong><p>Matters will appear here when a client request is accepted.</p></div>'
                            : `<table class="table">
                            <thead><tr><th>ID</th><th>Reference</th><th>Title</th><th>Client</th><th>Assignee</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
                            <tbody>${items.map((m) => `
                                <tr>
                                    <td class="mono">#${m.id.split('-')[0]}</td>
                                    <td>${escape(m.reference)}</td>
                                    <td>${escape(m.title || '—')}</td>
                                    <td class="muted">${escape(m.client_name)}</td>
                                    <td class="muted">${escape(m.assignee_name || '—')}</td>
                                    <td>${escape(m.status)}</td>
                                    <td class="muted">${escape(m.created_at)}</td>
                                    <td><button class="btn small secondary" data-matter="${m.id}">View</button></td>
                                </tr>
                            `).join('')}</tbody>
                        </table>`
                        }
                    </div>
                </section>
            `;
            container.querySelectorAll('button[data-matter]').forEach((btn) => {
                btn.addEventListener('click', () => loadMatterDetail(btn.getAttribute('data-matter')));
            });
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load matters.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadAppointments() {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/owner/appointments', { auth: true });
            const items = (res && res.data) || [];
            container.innerHTML = `
                <div class="page-head"><div><h1>Appointments</h1><p class="head-meta">Manage all scheduled appointments.</p></div></div>
                <section class="panel">
                    <div class="panel-head"><h2>All Appointments</h2><span class="panel-meta">${items.length} total</span></div>
                    <div class="panel-body tight">
                        ${items.length === 0
                            ? '<div class="empty-state"><span class="ico">·</span><strong>No appointments scheduled.</strong></div>'
                            : `<table class="table">
                            <thead><tr><th>ID</th><th>Client</th><th>Date/Time</th><th>Matter</th><th>Status</th><th>Actions</th></tr></thead>
                            <tbody>${items.map((a) => `
                                <tr>
                                    <td class="mono">#${a.id.split('-')[0]}</td>
                                    <td>${escape(a.client_name)}</td>
                                    <td class="muted">${escape(a.starts_at)}</td>
                                    <td class="muted">${escape(a.matter_reference || '—')}</td>
                                    <td>${escape(a.status)}</td>
                                    <td><button class="btn small secondary" data-appt="${a.id}">View</button></td>
                                </tr>
                            `).join('')}</tbody>
                        </table>`
                        }
                    </div>
                </section>
            `;
            container.querySelectorAll('button[data-appt]').forEach((btn) => {
                btn.addEventListener('click', () => loadAppointmentDetail(btn.getAttribute('data-appt')));
            });
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load appointments.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadDocuments() {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/owner/documents', { auth: true });
            const items = (res && res.data) || [];
            container.innerHTML = `
                <div class="page-head"><div><h1>Documents</h1><p class="head-meta">Manage all uploaded documents and files.</p></div></div>
                <section class="panel">
                    <div class="panel-head"><h2>All Documents</h2><span class="panel-meta">${items.length} total</span></div>
                    <div class="panel-body tight">
                        ${items.length === 0
                            ? '<div class="empty-state"><span class="ico">·</span><strong>No documents uploaded yet.</strong></div>'
                            : `<table class="table">
                            <thead><tr><th>ID</th><th>Matter</th><th>Original Name</th><th>Client</th><th>Size</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
                            <tbody>${items.map((d) => `
                                <tr>
                                    <td class="mono">#${d.id.split('-')[0]}</td>
                                    <td>${escape(d.matter_reference)}</td>
                                    <td>${escape(d.original_name)}</td>
                                    <td class="muted">${escape(d.client_name)}</td>
                                    <td class="muted">${escape(d.size_bytes ? d.size_bytes + ' bytes' : '—')}</td>
                                    <td>${escape(d.status)}</td>
                                    <td class="muted">${escape(d.created_at)}</td>
                                    <td><button class="btn small secondary" data-doc="${d.id}">View</button></td>
                                </tr>
                            `).join('')}</tbody>
                        </table>`
                        }
                    </div>
                </section>
            `;
            container.querySelectorAll('button[data-doc]').forEach((btn) => {
                btn.addEventListener('click', () => loadDocumentDetail(btn.getAttribute('data-doc')));
            });
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load documents.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    let currentOwnerConversationId = null;
    let ownerPollTimer = null;
    let ownerLastKnownMessageId = null;
    let ownerDisplayedMessageIds = new Set();
    let ownerIsPollingPaused = false;
    const OWNER_POLL_INTERVAL_MS = 5000;
    const OWNER_POLL_INTERVAL_HIDDEN_MS = 15000;

    function ownerIsNearBottom() {
        const threshold = 120;
        const appMain = document.querySelector('.app-main');
        if (appMain) {
            return (appMain.clientHeight + appMain.scrollTop) >= (appMain.scrollHeight - threshold);
        }
        return (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - threshold);
    }

    function ownerScrollToBottom() {
        const appMain = document.querySelector('.app-main');
        if (appMain) {
            appMain.scrollTop = appMain.scrollHeight;
        } else {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        }
    }

    function ownerStartPolling() {
        ownerStopPolling();
        if (!currentOwnerConversationId) return;
        ownerIsPollingPaused = false;
        ownerPollTimer = setInterval(ownerPollConversation, document.visibilityState === 'visible' ? OWNER_POLL_INTERVAL_MS : OWNER_POLL_INTERVAL_HIDDEN_MS);
    }

    function ownerStopPolling() {
        if (ownerPollTimer) {
            clearInterval(ownerPollTimer);
            ownerPollTimer = null;
        }
        ownerIsPollingPaused = false;
    }

    function ownerPausePolling() {
        if (ownerPollTimer) {
            clearInterval(ownerPollTimer);
            ownerPollTimer = null;
        }
        ownerIsPollingPaused = true;
    }

    function ownerAppendMessages(newItems) {
        if (!newItems.length) return;
        const thread = document.getElementById('owner-thread');
        if (!thread) return;

        const emptyState = thread.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const wasNearBottom = ownerIsNearBottom();

        const html = newItems.map((m) => {
            ownerDisplayedMessageIds.add(m.id);
            const isOwner = m.sender_role === 'OWNER';
            return `
                <div class="msg ${isOwner ? 'from-client' : ''}">
                    <div class="meta">${escape(m.sender_name || (isOwner ? 'Firm' : 'Client'))} · ${escape(m.created_at)}</div>
                    <div class="body">${escape(m.body)}</div>
                </div>
            `;
        }).join('');

        thread.insertAdjacentHTML('beforeend', html);

        const last = newItems[newItems.length - 1];
        if (last && last.id) ownerLastKnownMessageId = last.id;

        const count = thread.querySelectorAll('.msg').length;
        const metaEl = document.querySelector('.panel-head .panel-meta');
        if (metaEl) metaEl.textContent = `${count} message${count === 1 ? '' : 's'}`;

        if (wasNearBottom) {
            ownerScrollToBottom();
        }
    }

    async function ownerPollConversation() {
        if (!currentOwnerConversationId || ownerIsPollingPaused) return;

        try {
            const qs = ownerLastKnownMessageId ? `?after=${encodeURIComponent(ownerLastKnownMessageId)}` : '';
            const res = await api(`/owner/conversations/${encodeURIComponent(currentOwnerConversationId)}${qs}`, { auth: true });
            const messages = (res && res.data && res.data.messages) || [];
            const newMessages = messages.filter(m => !ownerDisplayedMessageIds.has(m.id));
            if (newMessages.length > 0) {
                ownerAppendMessages(newMessages);
            }
        } catch (err) {
            if (err && err.status === 401) {
                window.location.href = 'login.html';
                return;
            }
        }
    }

    async function loadMessages(conversationId) {
        const container = document.getElementById('main-content');
        if (conversationId) {
            currentOwnerConversationId = conversationId;
        }
        if (currentOwnerConversationId) {
            await loadOwnerConversationDetail(currentOwnerConversationId);
            return;
        }
        await loadMessagesInbox();
    }

    async function loadMessagesInbox() {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/owner/conversations', { auth: true });
            const items = (res && res.data) || [];
            const totalUnread = items.reduce((sum, c) => sum + (c.unread_count || 0), 0);
            container.innerHTML = `
                <div class="page-head">
                    <div>
                        <span class="kicker">Communications</span>
                        <h1>Messages</h1>
                        <p class="head-meta">${totalUnread > 0 ? `<strong>${totalUnread} unread</strong> across all conversations.` : 'No unread messages.'} Review and reply to client conversations.</p>
                    </div>
                </div>
                <section class="panel">
                    <div class="panel-head"><h2>Conversations</h2><span class="panel-meta">${items.length} total</span></div>
                    <div class="panel-body tight">
                        <table class="table">
                            <thead><tr><th>Matter</th><th>Client</th><th>Last Message</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
                            <tbody>${items.map((c) => `
                                <tr>
                                    <td class="mono">${escape(c.reference)}${c.title ? ' — ' + escape(c.title) : ''}</td>
                                    <td>${escape(c.client_name)}<br><span class="muted">${escape(c.client_email)}</span></td>
                                    <td>${escape(c.last_message_body || '—')}</td>
                                    <td class="muted">${escape(c.last_message_at || c.created_at)}</td>
                                    <td>${(c.unread_count > 0) ? `<span class="pill status-new">Unread (${c.unread_count})</span>` : '<span class="pill status-closed">Read</span>'}</td>
                                    <td><button class="btn small secondary" data-conversation-id="${c.id}">Open</button></td>
                                </tr>
                            `).join('')}</tbody>
                        </table>
                        ${!items.length ? '<div class="empty-state"><span class="ico">·</span><strong>No conversations yet.</strong><p>Conversations will appear here when clients message through their matters.</p></div>' : ''}
                    </div>
                </section>
            `;
            container.querySelectorAll('button[data-conversation-id]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    currentOwnerConversationId = btn.getAttribute('data-conversation-id');
                    loadMessages();
                });
            });
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load conversations.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadOwnerConversationDetail(id) {
        const container = document.getElementById('main-content');
        try {
            const [detailRes] = await Promise.all([
                api(`/owner/conversations/${encodeURIComponent(id)}`, { auth: true }),
                api(`/owner/conversations/${encodeURIComponent(id)}/read`, { method: 'POST', auth: true }).catch(() => ({})),
            ]);
            const convo = detailRes.data || {};
            const messages = (convo.messages) || [];
            ownerDisplayedMessageIds.clear();
            messages.forEach(m => ownerDisplayedMessageIds.add(m.id));
            const last = messages[messages.length - 1];
            if (last && last.id) ownerLastKnownMessageId = last.id;
            container.innerHTML = `
                <div class="page-head">
                    <div>
                        <span class="kicker">Conversation</span>
                        <h1>${escape(convo.reference || 'Matter')}${convo.title ? ' — ' + escape(convo.title) : ''}</h1>
                        <p class="head-meta">Client: ${escape(convo.client_name || '—')} (${escape(convo.client_email || '')})</p>
                    </div>
                    <div class="action-row">
                        <button class="btn ghost" id="btn-back-inbox">← Back to inbox</button>
                    </div>
                </div>
                <section class="panel" aria-labelledby="thread-head">
                    <div class="panel-head">
                        <h2 id="thread-head">Thread</h2>
                        <span class="panel-meta">${messages.length} message${messages.length === 1 ? '' : 's'}</span>
                    </div>
                    <div class="panel-body">
                        <div class="thread" id="owner-thread">
                            ${messages.length ? messages.map((m) => {
                                const isOwner = m.sender_role === 'OWNER';
                                return `
                                    <div class="msg ${isOwner ? 'from-client' : ''}">
                                        <div class="meta">${escape(m.sender_name || (isOwner ? 'Firm' : 'Client'))} · ${escape(m.created_at)}</div>
                                        <div class="body">${escape(m.body)}</div>
                                    </div>
                                `;
                            }).join('') : '<div class="empty-state tight"><span class="ico">·</span><strong>No messages yet.</strong></div>'}
                        </div>
                        <div class="compose">
                            <form id="owner-reply-form">
                                <div class="field">
                                    <label for="owner-reply-body">Reply to client</label>
                                    <textarea id="owner-reply-body" name="body" placeholder="Write your reply…" required></textarea>
                                </div>
                                <div class="page-actions">
                                    <button type="submit" class="btn primary">Send reply <span class="arrow" aria-hidden="true">→</span></button>
                                </div>
                            </form>
                        </div>
                    </div>
                </section>
            `;
            document.getElementById('btn-back-inbox')?.addEventListener('click', () => {
                ownerStopPolling();
                currentOwnerConversationId = null;
                ownerLastKnownMessageId = null;
                ownerDisplayedMessageIds.clear();
                loadMessages();
            });
            const replyForm = document.getElementById('owner-reply-form');
            if (replyForm) {
                replyForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const body = replyForm.querySelector('#owner-reply-body').value.trim();
                    if (!body) return;
                    const btn = replyForm.querySelector('button[type="submit"]');
                    btn.disabled = true;
                    try {
                        await api(`/owner/conversations/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { body }, auth: true });
                        replyForm.reset();
                        await loadOwnerConversationDetail(id);
                        ownerStartPolling();
                    } catch (err) {
                        alert(err.message || 'Could not send reply.');
                    } finally {
                        btn.disabled = false;
                    }
                });
            }
            ownerStartPolling();
        } catch (error) {
            ownerStopPolling();
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load conversation.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadNotifications() {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/owner/notifications', { auth: true });
            const items = (res && res.data) || [];
            container.innerHTML = `
                <div class="page-head"><div><h1>Notifications</h1><p class="head-meta">Manage all system notifications.</p></div></div>
                <section class="panel">
                    <div class="panel-head"><h2>All Notifications</h2><span class="panel-meta">${items.length} total</span></div>
                    <div class="panel-body tight">
                        ${items.length === 0
                            ? '<div class="empty-state"><span class="ico">·</span><strong>No notifications yet.</strong></div>'
                            : `<table class="table">
                            <thead><tr><th>ID</th><th>Recipient</th><th>Kind</th><th>Title</th><th>Entity</th><th>Created</th><th>Actions</th></tr></thead>
                            <tbody>${items.map((n) => {
                                const entityLabel = n.entity_type ? `${n.entity_type}:${n.entity_id ? '#' + n.entity_id.split('-')[0] : '—'}` : '—';
                                return `
                                <tr>
                                    <td class="mono">#${n.id.split('-')[0]}</td>
                                    <td>${escape(n.recipient_name)}</td>
                                    <td class="muted">${escape(n.kind)}</td>
                                    <td>${escape(n.title)}</td>
                                    <td class="muted">${entityLabel}</td>
                                    <td class="muted">${escape(n.created_at)}</td>
                                    <td>${n.entity_type && n.entity_id ? `<button class="btn small secondary" data-notify-entity="${n.entity_type}" data-notify-id="${n.entity_id}">Go to</button>` : '<span class="muted">—</span>'}</td>
                                </tr>`;
                            }).join('')}</tbody>
                        </table>`
                        }
                    </div>
                </section>
            `;
            container.querySelectorAll('button[data-notify-entity]').forEach((btn) => {
                const entityType = btn.getAttribute('data-notify-entity');
                const entityId = btn.getAttribute('data-notify-id');
                btn.addEventListener('click', () => {
                    switch (entityType) {
                        case 'client':    loadClientDetail(entityId); break;
                        case 'matter':    loadMatterDetail(entityId); break;
                        case 'request':   loadRequestDetail(entityId); break;
                        case 'appointment': loadAppointmentDetail(entityId); break;
                        case 'document':  loadDocumentDetail(entityId); break;
                        case 'conversation': loadMessages(entityId); break;
                        default:          loadDashboard();
                    }
                });
            });
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load notifications.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadClientDetail(id) {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/owner/clients/' + encodeURIComponent(id), { auth: true });
            const c = res.data;
            const matters = res.matters || [];
            const requests = res.requests || [];
            const appointments = res.appointments || [];
            const conversations = res.conversations || [];

            container.innerHTML = `
                <div class="page-head">
                    <div>
                        <span class="kicker">Client</span>
                        <h1>${escape(c.full_name)}</h1>
                        <p class="head-meta">${escape(c.email)} · #${escape(c.id.split('-')[0])}</p>
                    </div>
                    <div class="action-row">
                        <button class="btn ghost" id="btn-back-clients">← Back to Clients</button>
                    </div>
                </div>
                <section class="panel">
                    <div class="panel-head"><h2>Client Information</h2></div>
                    <div class="panel-body">
                        <table class="table">
                            <tbody>
                                <tr><th style="width:30%">Full Name</th><td>${escape(c.full_name || '—')}</td></tr>
                                <tr><th>Email</th><td>${escape(c.email || '—')}</td></tr>
                                <tr><th>Status</th><td>${c.is_active ? '<span class="pill status-open">Active</span>' : '<span class="pill status-closed">Inactive</span>'}</td></tr>
                                <tr><th>Member Since</th><td class="muted">${escape(c.created_at || '—')}</td></tr>
                                <tr><th>Last Login</th><td class="muted">${escape(c.last_login_at || '—')}</td></tr>
                            </tbody>
                        </table>
                    </div>
                </section>
                <section class="panel">
                    <div class="panel-head"><h2>Matters (${matters.length})</h2></div>
                    <div class="panel-body tight">
                        ${matters.length === 0
                            ? '<div class="empty-state tight"><span class="ico">·</span><strong>No matters for this client.</strong></div>'
                            : `<table class="table"><thead><tr><th>Reference</th><th>Title</th><th>Type</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>${matters.map((m) => `
                            <tr>
                                <td class="mono">${escape(m.reference)}</td>
                                <td>${escape(m.title || '—')}</td>
                                <td class="muted">${escape(m.matter_type || '—')}</td>
                                <td>${escape(m.status)}</td>
                                <td class="muted">${escape(m.created_at)}</td>
                                <td><button class="btn small secondary" data-matter="${m.id}">View</button></td>
                            </tr>
                        `).join('')}</tbody></table>`
                        }
                    </div>
                </section>
                <section class="panel">
                    <div class="panel-head"><h2>Requests (${requests.length})</h2></div>
                    <div class="panel-body tight">
                        ${requests.length === 0
                            ? '<div class="empty-state tight"><span class="ico">·</span><strong>No requests from this client.</strong></div>'
                            : `<table class="table"><thead><tr><th>Subject</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>${requests.map((r) => `
                            <tr>
                                <td>${escape(r.subject)}</td>
                                <td>${escape(r.status)}</td>
                                <td class="muted">${escape(r.created_at)}</td>
                                <td><button class="btn small secondary" data-request="${r.id}">View</button></td>
                            </tr>
                        `).join('')}</tbody></table>`
                        }
                    </div>
                </section>
                <section class="panel">
                    <div class="panel-head"><h2>Appointments (${appointments.length})</h2></div>
                    <div class="panel-body tight">
                        ${appointments.length === 0
                            ? '<div class="empty-state tight"><span class="ico">·</span><strong>No appointments.</strong></div>'
                            : `<table class="table"><thead><tr><th>Date/Time</th><th>Matter</th><th>Status</th><th>Actions</th></tr></thead><tbody>${appointments.map((a) => `
                            <tr>
                                <td class="muted">${escape(a.starts_at)}</td>
                                <td class="muted">${escape(a.matter_reference || '—')}</td>
                                <td>${escape(a.status)}</td>
                                <td><button class="btn small secondary" data-appt="${a.id}">View</button></td>
                            </tr>
                        `).join('')}</tbody></table>`
                        }
                    </div>
                </section>
                <section class="panel">
                    <div class="panel-head"><h2>Conversations (${conversations.length})</h2></div>
                    <div class="panel-body tight">
                        ${conversations.length === 0
                            ? '<div class="empty-state tight"><span class="ico">·</span><strong>No conversations.</strong></div>'
                            : `<table class="table"><thead><tr><th>Matter</th><th>Client</th><th>Last Message</th><th>Date</th><th>Unread</th><th>Actions</th></tr></thead><tbody>${conversations.map((convo) => `
                            <tr>
                                <td class="mono">${escape(convo.reference || '')}</td>
                                <td>${escape(convo.client_name || '—')}</td>
                                <td>${escape((convo.last_message_body || '').slice(0, 60))}</td>
                                <td class="muted">${escape(convo.last_message_at || '—')}</td>
                                <td>${convo.unread_count > 0 ? `<span class="pill status-new">${convo.unread_count}</span>` : '<span class="muted">0</span>'}</td>
                                <td><button class="btn small secondary" data-convo="${convo.id}">Open</button></td>
                            </tr>
                        `).join('')}</tbody></table>`
                        }
                    </div>
                </section>
            `;
            document.getElementById('btn-back-clients')?.addEventListener('click', loadClients);
            container.querySelectorAll('button[data-matter]').forEach((btn) => {
                btn.addEventListener('click', () => loadMatterDetail(btn.getAttribute('data-matter')));
            });
            container.querySelectorAll('button[data-request]').forEach((btn) => {
                btn.addEventListener('click', () => loadRequestDetail(btn.getAttribute('data-request')));
            });
            container.querySelectorAll('button[data-appt]').forEach((btn) => {
                btn.addEventListener('click', () => loadAppointmentDetail(btn.getAttribute('data-appt')));
            });
            container.querySelectorAll('button[data-convo]').forEach((btn) => {
                btn.addEventListener('click', () => loadMessages(btn.getAttribute('data-convo')));
            });
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load client.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadMatterDetail(id) {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/owner/matters/' + encodeURIComponent(id), { auth: true });
            const m = res.data;
            const events = res.events || [];
            const documents = res.documents || [];
            const appointments = res.appointments || [];
            const conversation = res.conversation || null;
            const originatingRequest = res.originating_request || null;

            container.innerHTML = `
                <div class="page-head">
                    <div>
                        <span class="kicker">Matter</span>
                        <h1>${escape(m.title || 'Untitled Matter')}</h1>
                        <p class="head-meta">${escape(m.reference)} · ${escape(m.matter_type || '—')}</p>
                    </div>
                    <div class="action-row">
                        <button class="btn ghost" id="btn-back-matters">← Back to Matters</button>
                        ${conversation ? `<button class="btn small secondary" id="btn-open-conversation">Open Conversation</button>` : ''}
                        ${m.assigned_to ? `<button class="btn small secondary" id="btn-view-client">View Client</button>` : ''}
                    </div>
                </div>
                <section class="panel">
                    <div class="panel-head"><h2>Matter Information</h2></div>
                    <div class="panel-body">
                        <table class="table">
                            <tbody>
                                <tr><th style="width:30%">Reference</th><td class="mono">${escape(m.reference)}</td></tr>
                                <tr><th>Title</th><td>${escape(m.title || '—')}</td></tr>
                                <tr><th>Type</th><td>${escape(m.matter_type || '—')}</td></tr>
                                <tr><th>Status</th><td>${escape(m.status)}</td></tr>
                                <tr><th>Client</th><td>${escape(m.client_name || '—')}</td></tr>
                                <tr><th>Assignee</th><td class="muted">${escape(m.assignee_name || '—')}</td></tr>
                                <tr><th>Created</th><td class="muted">${escape(m.created_at)}</td></tr>
                                <tr><th>Updated</th><td class="muted">${escape(m.updated_at)}</td></tr>
                            </tbody>
                        </table>
                        ${m.description ? `<div style="margin-top:1.5rem;"><h3 style="font-size:0.78rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:0.5rem;">Description</h3><p style="white-space:pre-wrap;color:var(--ink-soft);line-height:1.6;">${escape(m.description)}</p></div>` : ''}
                    </div>
                </section>
                ${originatingRequest ? `
                <section class="panel">
                    <div class="panel-head"><h2>Originating Request</h2></div>
                    <div class="panel-body">
                        <table class="table">
                            <tbody>
                                <tr><th style="width:30%">Subject</th><td>${escape(originatingRequest.subject)}</td></tr>
                                <tr><th>Status</th><td>${escape(originatingRequest.status)}</td></tr>
                                <tr><th>Created</th><td class="muted">${escape(originatingRequest.created_at)}</td></tr>
                            </tbody>
                        </table>
                        <div style="margin-top:1rem;"><button class="btn small secondary" data-request="${originatingRequest.id}">View Request</button></div>
                        <div style="margin-top:1rem;"><h3 style="font-size:0.78rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:0.5rem;">Description</h3><p style="white-space:pre-wrap;color:var(--ink-soft);line-height:1.6;">${escape(originatingRequest.description || 'No description provided.')}</p></div>
                    </div>
                </section>
                ` : ''}
                <section class="panel">
                    <div class="panel-head"><h2>Documents (${documents.length})</h2></div>
                    <div class="panel-body tight">
                        ${documents.length === 0
                            ? '<div class="empty-state tight"><span class="ico">·</span><strong>No documents in this matter.</strong></div>'
                            : `<table class="table"><thead><tr><th>Name</th><th>Size</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>${documents.map((d) => `
                            <tr>
                                <td>${escape(d.original_name)}</td>
                                <td class="muted">${escape(d.size_bytes ? d.size_bytes + ' bytes' : '—')}</td>
                                <td>${escape(d.status)}</td>
                                <td class="muted">${escape(d.created_at)}</td>
                                <td><button class="btn small secondary" data-doc="${d.id}">View</button></td>
                            </tr>
                        `).join('')}</tbody></table>`
                        }
                    </div>
                </section>
                <section class="panel">
                    <div class="panel-head"><h2>Appointments (${appointments.length})</h2></div>
                    <div class="panel-body tight">
                        ${appointments.length === 0
                            ? '<div class="empty-state tight"><span class="ico">·</span><strong>No appointments for this matter.</strong></div>'
                            : `<table class="table"><thead><tr><th>Date/Time</th><th>Status</th><th>Notes</th><th>Actions</th></tr></thead><tbody>${appointments.map((a) => `
                            <tr>
                                <td class="muted">${escape(a.starts_at)}</td>
                                <td>${escape(a.status)}</td>
                                <td class="muted">${escape(a.notes || '—')}</td>
                                <td><button class="btn small secondary" data-appt="${a.id}">View</button></td>
                            </tr>
                        `).join('')}</tbody></table>`
                        }
                    </div>
                </section>
                <section class="panel">
                    <div class="panel-head"><h2>Activity Timeline</h2></div>
                    <div class="panel-body tight">
                        ${events.length === 0
                            ? '<div class="empty-state tight"><span class="ico">·</span><strong>No events recorded.</strong></div>'
                            : `<table class="table"><thead><tr><th>Date</th><th>Event</th><th>Title</th><th>Note</th></tr></thead><tbody>${events.map((e) => `
                            <tr>
                                <td class="muted">${escape(e.created_at)}</td>
                                <td class="muted">${escape(e.event_type)}</td>
                                <td>${escape(e.title)}</td>
                                <td class="muted">${escape(e.note || '—')}</td>
                            </tr>
                        `).join('')}</tbody></table>`
                        }
                    </div>
                </section>
            `;
            document.getElementById('btn-back-matters')?.addEventListener('click', loadMatters);
            document.getElementById('btn-open-conversation')?.addEventListener('click', () => {
                if (conversation) loadMessages(conversation.id);
            });
            document.getElementById('btn-view-client')?.addEventListener('click', () => {
                loadClientDetail(m.client_id);
            });
            container.querySelectorAll('button[data-request]').forEach((btn) => {
                btn.addEventListener('click', () => loadRequestDetail(btn.getAttribute('data-request')));
            });
            container.querySelectorAll('button[data-doc]').forEach((btn) => {
                btn.addEventListener('click', () => loadDocumentDetail(btn.getAttribute('data-doc')));
            });
            container.querySelectorAll('button[data-appt]').forEach((btn) => {
                btn.addEventListener('click', () => loadAppointmentDetail(btn.getAttribute('data-appt')));
            });
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load matter.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadAppointmentDetail(id) {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/owner/appointments/' + encodeURIComponent(id), { auth: true });
            const a = res.data;
            container.innerHTML = `
                <div class="page-head">
                    <div>
                        <span class="kicker">Appointment</span>
                        <h1>#${escape(a.id.split('-')[0])}</h1>
                        <p class="head-meta">${escape(a.client_name || '—')}</p>
                    </div>
                    <div class="action-row">
                        <button class="btn ghost" id="btn-back-appointments">← Back to Appointments</button>
                    </div>
                </div>
                <section class="panel">
                    <div class="panel-head"><h2>Appointment Details</h2></div>
                    <div class="panel-body">
                        <table class="table">
                            <tbody>
                                <tr><th style="width:30%">Client</th><td>${escape(a.client_name || '—')}<br><span class="muted">${escape(a.client_email || '')}</span></td></tr>
                                <tr><th>Starts At</th><td class="muted">${escape(a.starts_at || '—')}</td></tr>
                                <tr><th>Ends At</th><td class="muted">${escape(a.ends_at || '—')}</td></tr>
                                <tr><th>Status</th><td>${escape(a.status || '—')}</td></tr>
                                ${a.matter_reference ? `<tr><th>Matter</th><td>${escape(a.matter_reference)} — ${escape(a.matter_title || '')}</td></tr>` : ''}
                                <tr><th>Created</th><td class="muted">${escape(a.created_at || '—')}</td></tr>
                                <tr><th>Updated</th><td class="muted">${escape(a.updated_at || '—')}</td></tr>
                            </tbody>
                        </table>
                        ${a.notes ? `<div style="margin-top:1.5rem;"><h3 style="font-size:0.78rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:0.5rem;">Notes</h3><p style="white-space:pre-wrap;color:var(--ink-soft);line-height:1.6;">${escape(a.notes)}</p></div>` : ''}
                    </div>
                </section>
            `;
            document.getElementById('btn-back-appointments')?.addEventListener('click', loadAppointments);
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load appointment.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadDocumentDetail(id) {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/owner/documents/' + encodeURIComponent(id), { auth: true });
            const d = res.data;
            const now = new Date();
            const createdAt = new Date(d.created_at);
            const diffHours = Math.floor((now - createdAt) / (1000 * 60 * 60));
            const diffDays = Math.floor(diffHours / 24);
            const uploadedAgo = diffDays > 0 ? `${diffDays} day${diffDays > 1 ? 's' : ''} ago` : diffHours > 0 ? `${diffHours} hour${diffHours > 1 ? 's' : ''} ago` : 'just now';
            container.innerHTML = `
                <div class="page-head">
                    <div>
                        <span class="kicker">Document</span>
                        <h1>${escape(d.original_name)}</h1>
                        <p class="head-meta">${escape(d.matter_reference)} — ${escape(d.client_name || '—')} · Uploaded ${uploadedAgo}</p>
                    </div>
                    <div class="action-row">
                        <button class="btn ghost" id="btn-back-documents">← Back to Documents</button>
                        <a class="btn primary" href="#" onclick="alert('Document storage is not yet configured.');return false;">Download</a>
                    </div>
                </div>
                <section class="panel">
                    <div class="panel-head"><h2>Document Details</h2></div>
                    <div class="panel-body">
                        <table class="table">
                            <tbody>
                                <tr><th style="width:30%">File Name</th><td>${escape(d.original_name)}</td></tr>
                                <tr><th>Content Type</th><td>${escape(d.content_type || '—')}</td></tr>
                                <tr><th>Size</th><td>${escape(d.size_bytes ? d.size_bytes + ' bytes' : '—')}</td></tr>
                                <tr><th>Status</th><td>${escape(d.status || '—')}</td></tr>
                                <tr><th>Matter</th><td>${escape(d.matter_reference || '—')} — ${escape(d.matter_title || '')}</td></tr>
                                <tr><th>Client</th><td>${escape(d.client_name || '—')}<br><span class="muted">${escape(d.client_email || '')}</span></td></tr>
                                <tr><th>Uploaded By</th><td class="muted">${escape(d.uploaded_by || '—')}</td></tr>
                                <tr><th>Created</th><td class="muted">${escape(d.created_at)}</td></tr>
                                <tr><th>Updated</th><td class="muted">${escape(d.updated_at)}</td></tr>
                            </tbody>
                        </table>
                    </div>
                </section>
            `;
            document.getElementById('btn-back-documents')?.addEventListener('click', loadDocuments);
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load document.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadAnalyticsPage() {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/owner/analytics', { auth: true });
            const d = res.data;
            container.innerHTML = `
                <div class="page-head"><div><h1>Analytics & Reports</h1><p class="head-meta">Real-time platform metrics and data insights.</p></div></div>
                <section class="kpi-grid">
                    <div class="kpi"><div class="kpi-label">Total Users</div><div class="kpi-value">${d.users.total}</div></div>
                    <div class="kpi"><div class="kpi-label">Clients</div><div class="kpi-value">${d.users.clients}</div></div>
                    <div class="kpi"><div class="kpi-label">Lawyers</div><div class="kpi-value">${d.users.lawyers}</div></div>
                    <div class="kpi"><div class="kpi-label">Staff</div><div class="kpi-value">${d.users.staff}</div></div>
                    <div class="kpi"><div class="kpi-label">Open Requests</div><div class="kpi-value">${d.requests.open}</div></div>
                    <div class="kpi"><div class="kpi-label">Total Matters</div><div class="kpi-value">${d.matters.total}</div></div>
                    <div class="kpi"><div class="kpi-label">Active Matters</div><div class="kpi-value">${d.matters.active}</div></div>
                    <div class="kpi"><div class="kpi-label">Upcoming Appts</div><div class="kpi-value">${d.appointments.upcoming}</div></div>
                </section>
                <section class="panel">
                    <div class="panel-head"><h2>Request Status Distribution</h2></div>
                    <div class="panel-body"><div class="bar-chart">
                        ${d.requests.statusDistribution.map((s) => `
                            <div class="bar-row">
                                <span class="bar-label">${escape(s.status.replace(/_/g, ' '))}</span>
                                <div class="bar-track"><div class="bar-fill" style="width: ${Math.min(100, (s.count / Math.max(1, d.requests.open)) * 100)}%"></div></div>
                                <span class="bar-value">${s.count}</span>
                            </div>
                        `).join('')}
                    </div></div>
                </section>
            `;
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load analytics.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadAudit() {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/owner/audit-logs?limit=50', { auth: true });
            const items = (res && res.data) || [];
            container.innerHTML = `
                <div class="page-head"><div><h1>Audit Logs</h1><p class="head-meta">System activity and user actions.</p></div></div>
                <section class="panel">
                    <div class="panel-head"><h2>Recent Activity</h2><span class="panel-meta">${res.meta ? res.meta.total : items.length} total records</span></div>
                    <div class="panel-body tight">
                        ${items.length === 0
                            ? '<div class="empty-state"><span class="ico">·</span><strong>No audit events yet.</strong></div>'
                            : `<table class="table">
                            <thead><tr><th>ID</th><th>Actor</th><th>Action</th><th>Entity</th><th>Date</th><th>Actions</th></tr></thead>
                            <tbody>${items.map((a) => `
                                <tr>
                                    <td class="mono">#${a.id.split('-')[0]}</td>
                                    <td class="muted">${escape(a.actor_email)}</td>
                                    <td>${escape(a.action)}</td>
                                    <td class="muted">${escape(a.entity_type)}</td>
                                    <td class="muted">${escape(a.created_at)}</td>
                                    <td><button class="btn small secondary" disabled>View</button></td>
                                </tr>
                            `).join('')}</tbody>
                        </table>`
                        }
                    </div>
                </section>
            `;
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load audit logs.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadSecurity() {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/owner/security-events?limit=50', { auth: true });
            const items = (res && res.data) || [];
            container.innerHTML = `
                <div class="page-head"><div><h1>Security Activity</h1><p class="head-meta">Security events and system alerts.</p></div></div>
                <section class="panel">
                    <div class="panel-head"><h2>Recent Security Events</h2><span class="panel-meta">${items.length} total events</span></div>
                    <div class="panel-body tight">
                        ${items.length === 0
                            ? '<div class="empty-state"><span class="ico">·</span><strong>No security events.</strong></div>'
                            : `<table class="table">
                            <thead><tr><th>ID</th><th>Event</th><th>Severity</th><th>Actor</th><th>IP</th><th>Date</th><th>Actions</th></tr></thead>
                            <tbody>${items.map((s) => `
                                <tr>
                                    <td class="mono">#${s.id.split('-')[0]}</td>
                                    <td>${escape(s.event_type)}</td>
                                    <td><span class="pill status-${s.severity}">${escape(s.severity)}</span></td>
                                    <td class="muted">${escape(s.actor_email)}</td>
                                    <td class="mono">${escape(s.ip_address || '—')}</td>
                                    <td class="muted">${escape(s.created_at)}</td>
                                    <td><button class="btn small secondary" disabled>View</button></td>
                                </tr>
                            `).join('')}</tbody>
                        </table>`
                        }
                    </div>
                </section>
            `;
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load security events.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadRoles() {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/owner/permissions', { auth: true });
            const data = res.data;
            let html = `
                <div class="page-head"><div><h1>Roles & Permissions</h1><p class="head-meta">Manage system roles and access permissions.</p></div></div>
                <section class="panel">
                    <div class="panel-head"><h2>Permission Matrix</h2></div>
                    <div class="panel-body">
            `;
            Object.entries(data).forEach(([category, perms]) => {
                html += `
                    <div class="panel">
                        <div class="panel-head"><h3>${category.charAt(0).toUpperCase() + category.slice(1)}</h3></div>
                        <div class="panel-body tight">
                            <table class="table">
                                <thead><tr><th>Code</th><th>Description</th><th>Granted To</th></tr></thead>
                                <tbody>${perms.map((p) => `
                                    <tr>
                                        <td class="mono">${p.code}</td>
                                        <td>${p.description}</td>
                                        <td class="muted">${p.grantedTo || '—'}</td>
                                    </tr>
                                `).join('')}</tbody>
                            </table>
                        </div>
                    </div>
                `;
            });
            html += `</div></section>`;
            container.innerHTML = html;
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load permissions.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadSettings() {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/owner/settings', { auth: true });
            const items = (res.data) || [];
            let html;
            if (!items.length) {
                html = `
                    <div class="page-head"><div><h1>Settings</h1><p class="head-meta">System-wide configuration and preferences.</p></div></div>
                    <div class="empty-state"><span class="ico">·</span><strong>No system settings configured.</strong></div>
                `;
            } else {
            html = `
                <div class="page-head"><div><h1>Settings</h1><p class="head-meta">System-wide configuration and preferences.</p></div></div>
                <section class="panel">
                    <div class="panel-head"><h2>System Settings</h2></div>
                    <div class="panel-body">
                        <table class="table">
                            <thead><tr><th>Key</th><th>Value</th><th>Description</th><th>Category</th><th>Last Updated</th></tr></thead>
                            <tbody>
                    `;
            items.forEach((s) => {
                const val = typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value);
                html += `
                    <tr>
                        <td class="mono">${escape(s.key)}</td>
                        <td>${escape(val)}</td>
                        <td>${escape(s.description || '—')}</td>
                        <td class="muted">${escape(s.category)}</td>
                        <td class="muted">${escape(s.updated_at)}</td>
                    </tr>
                `;
            });
            html += `
                            </tbody>
                        </table>
                    </div>
                </section>
            `;
            }
            container.innerHTML = html;
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load settings.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadHealth() {
        const container = document.getElementById('main-content');
        try {
            const res = await api('/health', { auth: true });
            const health = res.data;
            container.innerHTML = `
                <div class="page-head"><div><h1>System Health</h1><p class="head-meta">System status and health checks.</p></div></div>
                <section class="panel">
                    <div class="panel-head"><h2>Health Status</h2><span class="panel-meta">Last checked: ${new Date().toLocaleString()}</span></div>
                    <div class="panel-body">
                        <div class="kpi-grid">
                            <div class="kpi"><div class="kpi-label">API Status</div><div class="kpi-value" style="color: ${health.status === 'ok' ? 'var(--success)' : 'var(--danger)'}">${escape(health.status)}</div></div>
                            <div class="kpi"><div class="kpi-label">Database</div><div class="kpi-value" style="color: ${health.db === 'connected' ? 'var(--success)' : 'var(--danger)'}">${escape(health.db || 'Unknown')}</div></div>
                            <div class="kpi"><div class="kpi-label">Memory</div><div class="kpi-value">${escape(health.memory || 'Unknown')}</div></div>
                        </div>
                    </div>
                </section>
            `;
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Health check failed.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    function loadCurrentUser() {
        api('/profile', { auth: true })
            .then((res) => {
                const user = res && res.data ? res.data : { fullName: 'Emmanuel Richard Machibya', email: 'ermachibya@firm.tz', role: 'OWNER' };
                const nameEl = document.getElementById('subui-user-name');
                if (nameEl) nameEl.textContent = user.full_name || user.fullName || user.email || 'Emmanuel Richard Machibya';
                const roleEl = document.getElementById('subui-user');
                if (roleEl) roleEl.textContent = user.role || 'OWNER';

                if (user.role !== 'OWNER') {
                    document.getElementById('main-content').innerHTML = '<div class="empty-state"><span class="ico">!</span><strong>Access denied.</strong><p>This area is reserved for platform owners.</p></div>';
                }
            })
            .catch(() => {
                window.location.href = 'login.html';
            });
    }

    document.getElementById('subui-signout')?.addEventListener('click', () => {
        localStorage.removeItem(tokenKey);
        localStorage.removeItem('auth_user');
        window.location.href = 'login.html';
    });

    function updateTopbar(section) {
        const crumbs = document.querySelector('.topbar .crumbs');
        if (!crumbs) return;
        const label = {
            dashboard: 'Dashboard',
            clients: 'Clients',
            requests: 'Requests',
            matters: 'Matters',
            appointments: 'Appointments',
            documents: 'Documents',
            messages: 'Messages',
            notifications: 'Notifications',
            analytics: 'Analytics',
            audit: 'Audit',
            security: 'Security',
            settings: 'Settings',
            health: 'Health'
        };
        const name = label[section] || 'Dashboard';
        crumbs.innerHTML = `<span>Practice</span><strong>${name}</strong>`;
    }

    function navigateFromHash() {
        const hash = window.location.hash.replace('#', '');
        let section = hash;
        let detailId = null;
        if (hash && hash.includes('/')) {
            const parts = hash.split('/');
            section = parts[0];
            detailId = parts.slice(1).join('/');
        }
        document.querySelectorAll('.sidebar-nav a').forEach((l) => l.classList.remove('active'));
        if (section) {
            const link = document.querySelector(`.sidebar-nav a[href="#${section}"]`);
            if (link) {
                link.classList.add('active');
                updateTopbar(section);
                loadSection(section, detailId);
            } else {
                updateTopbar('dashboard');
                loadDashboard();
            }
            return;
        }
        const dashboardLink = document.querySelector('.sidebar-nav a[href="#dashboard"]');
        if (dashboardLink) dashboardLink.classList.add('active');
        updateTopbar('dashboard');
        loadDashboard();
    }

    document.querySelectorAll('.sidebar-nav a').forEach((link) => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const section = link.getAttribute('href').substring(1);
            window.location.hash = section ? '#' + section : '#';
        });
    });

    window.addEventListener('hashchange', navigateFromHash);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            if (currentOwnerConversationId) {
                const replyBody = document.getElementById('owner-reply-body');
                const hasDraft = replyBody && replyBody.value.trim().length > 0;
                if (hasDraft) {
                    ownerStartPolling();
                } else {
                    loadOwnerConversationDetail(currentOwnerConversationId);
                }
            }
        } else {
            ownerPausePolling();
        }
    });

    loadCurrentUser();
    navigateFromHash();
})();