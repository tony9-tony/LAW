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
            if (!r.ok) {
                const err = new Error((j && j.error && j.error.message) || ('HTTP ' + r.status));
                err.status = r.status;
                err.body = j;
                throw err;
            }
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
                case 'invoices':          detailId ? await loadInvoiceDetail(detailId) : await loadInvoices(); break;
                case 'dashboard':
                default:                  await loadDashboard(); break;
            }
        } catch (error) {
            if (error && error.status === 401) {
                localStorage.removeItem(tokenKey);
                localStorage.removeItem('auth_user');
                window.location.href = 'login.html';
                return;
            }
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Error loading section.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    function updateTopbar(section) {
        let title = 'Dashboard';
        let kicker = 'Overview';
        if (section === 'clients') { title = 'Clients'; kicker = 'Practice'; }
        else if (section === 'requests') { title = 'Requests'; kicker = 'Intake'; }
        else if (section === 'matters') { title = 'Matters'; kicker = 'Practice'; }
        else if (section === 'appointments') { title = 'Appointments'; kicker = 'Scheduling'; }
        else if (section === 'documents') { title = 'Documents'; kicker = 'Practice'; }
        else if (section === 'messages') { title = 'Messages'; kicker = 'Communication'; }
        else if (section === 'notifications') { title = 'Notifications'; kicker = 'Alerts'; }
        else if (section === 'settings') { title = 'Settings'; kicker = 'Configuration'; }
        else if (section === 'analytics') { title = 'Analytics'; kicker = 'Insights'; }
        else if (section === 'audit') { title = 'Audit'; kicker = 'Compliance'; }
        else if (section === 'security') { title = 'Security'; kicker = 'Protection'; }
        else if (section === 'health') { title = 'Health'; kicker = 'System'; }
        else if (section === 'invoices') { title = 'Invoices'; kicker = 'Billing'; }
        else if (section === 'roles') { title = 'Roles'; kicker = 'Access'; }
        else if (section === 'users') { title = 'Users'; kicker = 'Administration'; }
        else if (section === 'lawyers') { title = 'Lawyers'; kicker = 'Administration'; }
        else if (section === 'staff') { title = 'Staff'; kicker = 'Administration'; }
        else if (section === 'owners') { title = 'Owners'; kicker = 'Administration'; }

        const titleEl = document.getElementById('page-title');
        const kickerEl = document.querySelector('.kicker');
        const crumbs = document.querySelector('.topbar .crumbs');

        if (titleEl) titleEl.textContent = title;
        if (kickerEl) kickerEl.textContent = kicker;
        document.title = title + ' | SUBUI';
        if (crumbs) {
            const label = crumbs.querySelector('strong');
            if (label) label.textContent = title;
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
                    <span class="kicker">Overview</span>
                    <h1 id="page-title">Dashboard.</h1>
                    <p class="head-meta">A consolidated view of recent activity, open work, and incoming requests. Detailed modules are accessible from the sidebar.</p>
                </div>
            </div>

            <section class="kpi-grid" aria-label="Key indicators">
                <div class="kpi"><div class="kpi-label">Open requests</div><div class="kpi-value" id="kpi-open">—</div><div class="kpi-trend" id="kpi-open-meta">Loading…</div></div>
                <div class="kpi"><div class="kpi-label">Pending intake</div><div class="kpi-value" id="kpi-intake">—</div><div class="kpi-trend">Custom matter submissions</div></div>
                <div class="kpi"><div class="kpi-label">Appointments</div><div class="kpi-value" id="kpi-appts">—</div><div class="kpi-trend">Upcoming this week</div></div>
                <div class="kpi"><div class="kpi-label">Active matters</div><div class="kpi-value" id="kpi-matters">—</div><div class="kpi-trend">In progress</div></div>
            </section>

            <section class="panel" aria-labelledby="req-head">
                <div class="panel-head">
                    <h2 id="req-head">Recent requests</h2>
                    <a class="btn ghost" href="#">View all</a>
                </div>
                <div class="panel-body tight">
                    <table class="table">
                        <thead>
                            <tr>
                                <th class="col-id">ID</th>
                                <th>Subject</th>
                                <th class="col-status">Status</th>
                                <th class="col-date">Submitted</th>
                            </tr>
                        </thead>
                        <tbody id="requests-body">
                            <tr><td colspan="4" class="empty-state"><strong>Loading requests…</strong></td></tr>
                        </tbody>
                    </table>
                </div>
            </section>

            <section class="panel" aria-labelledby="local-head">
                <div class="panel-head">
                    <h2 id="local-head">Analytics</h2>
                    <span class="panel-meta">Real-time platform metrics</span>
                </div>
                <div class="panel-body tight" id="analytics-data">
                    <div class="empty-state"><span class="ico">·</span><strong>Loading analytics…</strong></div>
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
            setKPI('kpi-open', d.requests.open);
            setKPI('kpi-matters', d.matters.active);
            setKPI('kpi-appts', d.appointments.upcoming);
        } catch (error) {
            const setErr = (id) => { const el = document.getElementById(id); if (el) el.textContent = '!'; };
            ['kpi-open','kpi-matters','kpi-appts'].forEach(setErr);
        }
    }

    async function loadRecentRequests() {
        const el = document.getElementById('requests-body');
        try {
            const res = await api('/owner/requests', { auth: true });
            const items = (res && res.data) || [];
            if (!items.length) {
                el.innerHTML = '<tr><td colspan="4" class="empty-state"><strong>No requests yet.</strong><p>New requests will appear here as clients submit them.</p></td></tr>';
            } else {
                el.innerHTML = items.map((r) => `
                    <tr>
                        <td class="mono">#${r.id.split('-')[0]}</td>
                        <td>${escape(r.subject)}</td>
                        <td>${escape(r.status)}</td>
                        <td class="muted">${escape(r.created_at)}</td>
                    </tr>
                `).join('');
            }
        } catch (error) {
            el.innerHTML = `<tr><td colspan="4" class="empty-state"><span class="ico">!</span><strong>Could not load requests.</strong><p>${escape(error.message)}</p></td></tr>`;
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
                <div style="padding:0.6rem 1.25rem;border-bottom:1px solid var(--line);cursor:pointer;" onclick="window.location.hash='#messages';return false;">
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
            el.innerHTML = `<table class="table"><thead><tr><th>ID</th><th>Reference</th><th>Title</th><th>Client</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead><tbody>${items.map((m) => `
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

    // Professional modal system
    function Modal(options) {
        this.options = { title: 'Modal', description: '', onSubmit: null, onCancel: null, submitText: 'Submit', cancelText: 'Cancel', fields: [], ...options };
        this.element = null;
        this.overlay = null;
        this.isOpen = false;
        this.loading = false;
        this.formData = {};
        this.errors = {};
        this.init();
    }

    Modal.prototype.init = function() {
        this.element = document.createElement('div');
        this.element.className = 'modal';
        this.element.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content">
                <div class="modal-header">
                    <h2 class="modal-title">${escape(this.options.title)}</h2>
                    <button class="modal-close" aria-label="Close">×</button>
                </div>
                ${this.options.description ? `<div class="modal-description"><p>${escape(this.options.description)}</p></div>` : ''}
                <form class="modal-form">
                    ${this.options.fields.map(field => {
                        let inputHtml = '';
                        const fieldId = 'field-' + field.name;
                        
                        if (field.type === 'textarea') {
                            inputHtml = `<textarea id="${fieldId}" class="form-control" placeholder="${escape(field.placeholder || '')}" ${field.required ? 'required' : ''}>${escape(field.value || '')}</textarea>`;
                        } else if (field.type === 'select') {
                            inputHtml = `<select id="${fieldId}" class="form-control" ${field.required ? 'required' : ''}>${field.options.map(opt => `<option value="${opt.value}" ${opt.value === field.value ? 'selected' : ''}>${escape(opt.label)}</option>`).join('')}</select>`;
                        } else {
                            inputHtml = `<input type="${field.type}" id="${fieldId}" class="form-control" placeholder="${escape(field.placeholder || '')}" value="${escape(field.value || '')}" ${field.required ? 'required' : ''} ${field.type === 'datetime-local' ? '' : ''}>`;
                        }
                        
                        return `
                            <div class="form-group">
                                <label for="${fieldId}" class="form-label">${escape(field.label)}${field.required ? ' *' : ''}</label>
                                ${inputHtml}
                                ${this.errors[field.name] ? `<div class="error-message">${escape(this.errors[field.name])}</div>` : ''}
                            </div>
                        `;
                    }).join('')}
                </form>
                <div class="modal-footer">
                    <button type="button" class="btn btn-primary modal-submit-btn" ${this.loading ? 'disabled' : ''}>${escape(this.options.submitText)}</button>
                    <button type="button" class="btn btn-secondary modal-cancel-btn">${escape(this.options.cancelText)}</button>
                </div>
            </div>
        `;

        this.overlay = this.element.querySelector('.modal-overlay');
        this.form = this.element.querySelector('.modal-form');
        this.closeBtn = this.element.querySelector('.modal-close');
        this.submitBtn = this.element.querySelector('.modal-submit-btn');
        this.cancelBtn = this.element.querySelector('.modal-cancel-btn');
        
        this.closeBtn.addEventListener('click', () => this.close());
        this.cancelBtn.addEventListener('click', () => this.close());
        this.overlay.addEventListener('click', () => this.close());
        
        this.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleSubmit();
        });
        
        document.body.appendChild(this.element);
    }

    Modal.prototype.show = function() {
        this.isOpen = true;
        this.loading = false;
        this.errors = {};
        this.element.style.display = 'flex';
        this.updateSubmitButtonState();
    };

    Modal.prototype.close = function() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.element.style.display = 'none';
        document.body.removeChild(this.element);
    };

    Modal.prototype.updateSubmitButtonState = function() {
        if (this.submitBtn) {
            this.submitBtn.disabled = this.loading;
            this.submitBtn.textContent = this.loading ? 'Loading...' : this.options.submitText;
        }
    };

    Modal.prototype.handleSubmit = async function() {
        this.loading = true;
        this.updateSubmitButtonState();
        
        this.formData = {};
        this.options.fields.forEach(field => {
            const fieldId = 'field-' + field.name;
            const element = this.element.querySelector('#' + fieldId);
            if (element) {
                this.formData[field.name] = field.type === 'textarea' ? element.value : element.value;
            }
        });
        
        try {
            await this.options.onSubmit(this.formData);
            this.close();
        } catch (error) {
            console.error('Modal submit error:', error);
            this.errors = { general: error.message || 'An error occurred' };
            if (this.element && this.element.querySelector('.form-group')) {
                const formGroups = this.element.querySelectorAll('.form-group');
                formGroups.forEach(group => {
                    const input = group.querySelector('.form-control');
                    if (input && input.value) {
                        input.classList.add('error');
                    }
                });
            }
        }
        
        this.loading = false;
        this.updateSubmitButtonState();
    };

    function showModal(options) {
        return new Modal(options);
    }

    // Modal CSS styles
    (function() {
        const style = document.createElement('style');
        style.textContent = `
            .modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 10000;
                align-items: center;
                justify-content: center;
            }
            .modal-overlay {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
            }
            .modal-content {
                position: relative;
                border-radius: 12px;
                padding: 24px;
                max-width: 500px;
                width: 90%;
                max-height: 90vh;
                overflow-y: auto;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
            }
            .modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 16px;
                padding-bottom: 16px;
                border-bottom: 1px solid var(--line);
            }
            .modal-title {
                margin: 0;
                font-size: 1.25rem;
                font-weight: 600;
                color: var(--ink);
            }
            .modal-close {
                background: none;
                border: none;
                font-size: 1.5rem;
                cursor: pointer;
                color: var(--ink-mute);
                padding: 4px;
                border-radius: 4px;
            }
            .modal-close:hover {
                background: var(--bg-hover);
                color: var(--ink);
            }
            .modal-description {
                margin-bottom: 20px;
                color: var(--ink-mute);
                line-height: 1.5;
            }
            .modal-form {
                margin-bottom: 20px;
            }
            .form-group {
                margin-bottom: 16px;
            }
            .form-label {
                display: block;
                margin-bottom: 6px;
                font-weight: 500;
                color: var(--ink);
                font-size: 0.875rem;
            }
            .form-control {
                width: 100%;
                padding: 10px 12px;
                border: 1px solid var(--line);
                border-radius: 8px;
                font-size: 0.875rem;
                transition: border-color 0.2s;
                box-sizing: border-box;
            }
            .form-control:focus {
                outline: none;
                border-color: var(--primary);
                box-shadow: 0 0 0 3px rgba(var(--primary-rgb), 0.1);
            }
            .form-control.error {
                border-color: #ef4444;
            }
            .error-message {
                color: #ef4444;
                font-size: 0.75rem;
                margin-top: 4px;
            }
            .modal-footer {
                display: flex;
                gap: 12px;
                justify-content: flex-end;
                padding-top: 16px;
                border-top: 1px solid var(--line);
            }
            .btn {
                padding: 10px 16px;
                border: none;
                border-radius: 8px;
                font-size: 0.875rem;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 80px;
            }
            .btn-primary {
                background: var(--primary);
                color: white;
            }
            .btn-primary:hover:not(:disabled) {
                background: var(--primary-dark);
            }
            .btn-primary:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }
            .btn-secondary {
                background: transparent;
                color: var(--ink-mute);
                border: 1px solid var(--line);
            }
            .btn-secondary:hover {
                background: var(--bg-hover);
                color: var(--ink);
            }
            @media (max-width: 640px) {
                .modal-content {
                    width: 95%;
                    padding: 20px;
                }
                .modal-footer {
                    flex-direction: column;
                }
                .btn {
                    width: 100%;
                }
            }
        `;
        document.head.appendChild(style);
    })();

    function updatePageTitle(section) { updateTopbar(section); }
    // Professional modal system
    function Modal(options) {
        this.options = { title: 'Modal', description: '', onSubmit: null, onCancel: null, submitText: 'Submit', cancelText: 'Cancel', fields: [], ...options };
        this.element = null;
        this.overlay = null;
        this.isOpen = false;
        this.loading = false;
        this.formData = {};
        this.errors = {};
        this.init();
    }

    Modal.prototype.init = function() {
        this.element = document.createElement('div');
        this.element.className = 'modal';
        this.element.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content">
                <div class="modal-header">
                    <h2 class="modal-title">${escape(this.options.title)}</h2>
                    <button class="modal-close" aria-label="Close">×</button>
                </div>
                ${this.options.description ? `<div class="modal-description"><p>${escape(this.options.description)}</p></div>` : ''}
                <form class="modal-form">
                    ${this.options.fields.map(field => {
                        let inputHtml = '';
                        const fieldId = 'field-' + field.name;
                        
                        if (field.type === 'textarea') {
                            inputHtml = `<textarea id="${fieldId}" class="form-control" placeholder="${escape(field.placeholder || '')}" ${field.required ? 'required' : ''}>${escape(field.value || '')}</textarea>`;
                        } else if (field.type === 'select') {
                            inputHtml = `<select id="${fieldId}" class="form-control" ${field.required ? 'required' : ''}>${field.options.map(opt => `<option value="${opt.value}" ${opt.value === field.value ? 'selected' : ''}>${escape(opt.label)}</option>`).join('')}</select>`;
                        } else if (field.type === 'textarea' || field.type === 'text' || field.type === 'email' || field.type === 'date' || field.type === 'datetime-local' || field.type === 'textarea') {
                            inputHtml = `<input type="${field.type === 'textarea' ? 'text' : field.type}" id="${fieldId}" class="form-control" placeholder="${escape(field.placeholder || '')}" value="${escape(field.value || '')}" ${field.required ? 'required' : ''} ${field.type === 'datetime-local' ? '' : ''}>`;
                            if (field.type === 'textarea') {
                                inputHtml = `<textarea id="${fieldId}" class="form-control" placeholder="${escape(field.placeholder || '')}" ${field.required ? 'required' : ''}>${escape(field.value || '')}</textarea>`;
                            }
                        } else {
                            inputHtml = `<input type="${field.type}" id="${fieldId}" class="form-control" placeholder="${escape(field.placeholder || '')}" value="${escape(field.value || '')}" ${field.required ? 'required' : ''}>`;
                        }
                        
                        return `
                            <div class="form-group">
                                <label for="${fieldId}" class="form-label">${escape(field.label)}${field.required ? ' *' : ''}</label>
                                ${inputHtml}
                                ${this.errors[field.name] ? `<div class="error-message">${escape(this.errors[field.name])}</div>` : ''}
                            </div>
                        `;
                    }).join('')}
                </form>
                <div class="modal-footer">
                    <button type="button" class="btn btn-primary modal-submit-btn" ${this.loading ? 'disabled' : ''}>${escape(this.options.submitText)}</button>
                    <button type="button" class="btn btn-secondary modal-cancel-btn">${escape(this.options.cancelText)}</button>
                </div>
            </div>
        `;

        this.overlay = this.element.querySelector('.modal-overlay');
        this.form = this.element.querySelector('.modal-form');
        this.closeBtn = this.element.querySelector('.modal-close');
        this.submitBtn = this.element.querySelector('.modal-submit-btn');
        this.cancelBtn = this.element.querySelector('.modal-cancel-btn');
        
        this.closeBtn.addEventListener('click', () => this.close());
        this.cancelBtn.addEventListener('click', () => this.close());
        this.overlay.addEventListener('click', () => this.close());
        
        this.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleSubmit();
        });
        
        document.body.appendChild(this.element);
    }

    Modal.prototype.show = function() {
        this.isOpen = true;
        this.loading = false;
        this.errors = {};
        this.element.style.display = 'flex';
        this.updateSubmitButtonState();
    };

    Modal.prototype.close = function() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.element.style.display = 'none';
        document.body.removeChild(this.element);
    };

    Modal.prototype.updateSubmitButtonState = function() {
        if (this.submitBtn) {
            this.submitBtn.disabled = this.loading;
            this.submitBtn.textContent = this.loading ? 'Loading...' : this.options.submitText;
        }
    };

    Modal.prototype.handleSubmit = async function() {
        this.loading = true;
        this.updateSubmitButtonState();
        
        this.formData = {};
        this.options.fields.forEach(field => {
            const fieldId = 'field-' + field.name;
            const element = this.element.querySelector('#' + fieldId);
            if (element) {
                this.formData[field.name] = field.type === 'textarea' ? element.value : element.value;
            }
        });
        
        try {
            await this.options.onSubmit(this.formData);
            this.close();
        } catch (error) {
            console.error('Modal submit error:', error);
            this.errors = { general: error.message || 'An error occurred' };
            if (this.element && this.element.querySelector('.form-group')) {
                const formGroups = this.element.querySelectorAll('.form-group');
                formGroups.forEach(group => {
                    const input = group.querySelector('.form-control');
                    if (input && input.value) {
                        input.classList.add('error');
                    }
                });
            }
        }
        
        this.loading = false;
        this.updateSubmitButtonState();
    };

    function showModal(options) {
        return new Modal(options);
    }

    // Modal CSS styles
    (function() {
        const style = document.createElement('style');
        style.textContent = `
            .modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 10000;
                align-items: center;
                justify-content: center;
            }
            .modal-overlay {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
            }
            .modal-content {
                position: relative;
                border-radius: 12px;
                padding: 24px;
                max-width: 500px;
                width: 90%;
                max-height: 90vh;
                overflow-y: auto;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
            }
            .modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 16px;
                padding-bottom: 16px;
                border-bottom: 1px solid var(--line);
            }
            .modal-title {
                margin: 0;
                font-size: 1.25rem;
                font-weight: 600;
                color: var(--ink);
            }
            .modal-close {
                background: none;
                border: none;
                font-size: 1.5rem;
                cursor: pointer;
                color: var(--ink-mute);
                padding: 4px;
                border-radius: 4px;
            }
            .modal-close:hover {
                background: var(--bg-hover);
                color: var(--ink);
            }
            .modal-description {
                margin-bottom: 20px;
                color: var(--ink-mute);
                line-height: 1.5;
            }
            .modal-form {
                margin-bottom: 20px;
            }
            .form-group {
                margin-bottom: 16px;
            }
            .form-label {
                display: block;
                margin-bottom: 6px;
                font-weight: 500;
                color: var(--ink);
                font-size: 0.875rem;
            }
            .form-control {
                width: 100%;
                padding: 10px 12px;
                border: 1px solid var(--line);
                border-radius: 8px;
                font-size: 0.875rem;
                transition: border-color 0.2s;
                box-sizing: border-box;
            }
            .form-control:focus {
                outline: none;
                border-color: var(--primary);
                box-shadow: 0 0 0 3px rgba(var(--primary-rgb), 0.1);
            }
            .form-control.error {
                border-color: #ef4444;
            }
            .error-message {
                color: #ef4444;
                font-size: 0.75rem;
                margin-top: 4px;
            }
            .modal-footer {
                display: flex;
                gap: 12px;
                justify-content: flex-end;
                padding-top: 16px;
                border-top: 1px solid var(--line);
            }
            .btn {
                padding: 10px 16px;
                border: none;
                border-radius: 8px;
                font-size: 0.875rem;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 80px;
            }
            .btn-primary {
                background: var(--primary);
                color: white;
            }
            .btn-primary:hover:not(:disabled) {
                background: var(--primary-dark);
            }
            .btn-primary:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }
            .btn-secondary {
                background: transparent;
                color: var(--ink-mute);
                border: 1px solid var(--line);
            }
            .btn-secondary:hover {
                background: var(--bg-hover);
                color: var(--ink);
            }
            @media (max-width: 640px) {
                .modal-content {
                    width: 95%;
                    padding: 20px;
                }
                .modal-footer {
                    flex-direction: column;
                }
                .btn {
                    width: 100%;
                }
            }
        `;
        document.head.appendChild(style);
    })();

    function updatePageTitle(section) { updateTopbar(section); }

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
                <div style="padding:0.6rem 1.25rem;border-bottom:1px solid var(--line);cursor:pointer;" onclick="window.location.hash='#messages';return false;">
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
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading users…</strong></div>';
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
                                    <td>${u.is_active ? '<span class="pill status-open">Active</span>' : '<span class="pill status-closed">Inactive</span>'}</td>
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
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading clients…</strong></div>';
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
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading lawyers…</strong></div>';
        try {
            const res = await api('/owner/lawyers', { auth: true });
            const items = (res && res.data) || [];
            container.innerHTML = `
                <div class="page-head"><div><h1>Lawyers</h1><p class="head-meta">Manage all lawyer accounts.</p></div></div>
                <section class="panel">
                    <div class="panel-head"><h2>All Lawyers</h2><span class="panel-meta">${items.length} total</span></div>
                    <div class="panel-body tight">
                        ${items.length === 0
                            ? '<div class="empty-state"><span class="ico">·</span><strong>No lawyers found.</strong></div>'
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
                                    <td><button class="btn small secondary">View</button></td>
                                </tr>
                            `).join('')}</tbody>
                        </table>`
                        }
                    </div>
                </section>
            `;
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load lawyers.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadOwners() {
        const container = document.getElementById('main-content');
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading owners…</strong></div>';
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
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading staff…</strong></div>';
        try {
            const res = await api('/owner/staff', { auth: true });
            const items = (res && res.data) || [];
            container.innerHTML = `
                <div class="page-head"><div><h1>Staff</h1><p class="head-meta">Manage all staff accounts.</p></div></div>
                <section class="panel">
                    <div class="panel-head"><h2>All Staff</h2><span class="panel-meta">${items.length} total</span></div>
                    <div class="panel-body tight">
                        ${items.length === 0
                            ? '<div class="empty-state"><span class="ico">·</span><strong>No staff found.</strong></div>'
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
                                    <td><button class="btn small secondary">View</button></td>
                                </tr>
                            `).join('')}</tbody>
                        </table>`
                        }
                    </div>
                </section>
            `;
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load staff.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadRequests() {
        const container = document.getElementById('main-content');
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading requests…</strong></div>';
        try {
            const res = await api('/owner/requests', { auth: true });
            const items = (res && res.data) || [];
            container.innerHTML = `
                <div class="page-head"><div><h1>Service Requests</h1><p class="head-meta">Manage all client service requests and their status.</p></div></div>
                <section class="panel">
                    <div class="panel-head"><h2>All Requests</h2><span class="panel-meta">${items.length} total</span></div>
                    <div class="panel-body tight">
                        ${items.length === 0
                            ? '<div class="empty-state"><span class="ico">·</span><strong>No requests yet.</strong><p>New requests will appear here as clients submit them.</p></div>'
                            : `<table class="table">
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
                        </table>`
                        }
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
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading request…</strong></div>';
        try {
            const res = await api(`/owner/requests/${encodeURIComponent(id)}`, { auth: true });
            const r = (res && res.data) || {};
            container.innerHTML = `
                <div class="page-head">
                    <div>
                        <span class="kicker">Request</span>
                        <h1>${escape(r.subject || '—')}</h1>
                        <p class="head-meta">Request #${escape(r.id.split('-')[0])}</p>
                    </div>
                    <div class="action-row">
                        <button class="btn ghost" id="back-requests">← Back</button>
                        <button class="btn primary" id="message-client">Message client</button>
                        ${r.matter_id ? `<button class="btn" id="start-convo">Open matter conversation</button>` : ''}
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

            const messageClientBtn = document.getElementById('message-client');
            if (messageClientBtn) {
                messageClientBtn.addEventListener('click', async () => {
                    if (r.matter_id) {
                        try {
                            const convoRes = await api(`/owner/matters/${encodeURIComponent(r.matter_id)}/conversation`, { auth: true });
                            const convo = (convoRes && convoRes.data) || {};
                            if (convo.id) { navigateTo('messages', convo.id); }
                        } catch (err) { alert(err.message || 'Could not open conversation.'); }
                        return;
                    }
                    // No matter yet — ask for initial message to create request-scoped conversation
                    const modal = document.createElement('div');
                    modal.className = 'modal-overlay';
                    modal.id = 'msg-client-modal';
                    modal.innerHTML = `
                        <div class="modal" style="max-width:520px;">
                            <div class="panel-head"><h2>Message client — Request #${escape(r.id.split('-')[0])}</h2></div>
                            <div class="panel-body">
                                <p style="color:var(--ink-mute);font-size:0.88rem;margin:0 0 1rem;">This will start a conversation linked to this request. The client will be notified.</p>
                                <form id="msg-client-form" novalidate>
                                    <div class="field">
                                        <label for="mc-body">Message</label>
                                        <textarea id="mc-body" name="body" rows="4" maxlength="4000" placeholder="Write your message to the client…" required></textarea>
                                        <span class="error">Please write a message (at least 1 character).</span>
                                    </div>
                                    <div class="form-status" id="mc-status" role="status" aria-live="polite" style="margin-top:0.75rem;"></div>
                                    <div class="actions" style="display:flex;gap:0.75rem;justify-content:flex-end;margin-top:1rem;">
                                        <button type="button" class="btn ghost" id="mc-cancel">Cancel</button>
                                        <button type="submit" class="btn primary">Send message</button>
                                    </div>
                                </form>
                            </div>
                        </div>`;
                    document.body.appendChild(modal);
                    const closeModal = () => modal.remove();
                    modal.querySelector('#mc-cancel').addEventListener('click', closeModal);
                    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
                    const msgForm = modal.querySelector('#msg-client-form');
                    const statusEl = modal.querySelector('#mc-status');
                    if (msgForm) {
                        msgForm.addEventListener('submit', async (e) => {
                            e.preventDefault();
                            statusEl.className = 'form-status';
                            statusEl.textContent = 'Sending…';
                            const body = (modal.querySelector('#mc-body')?.value || '').trim();
                            if (!body) { statusEl.className = 'form-status error'; statusEl.innerHTML = '<strong>Please write a message.</strong>'; return; }
                            try {
                                const convoRes = await api(`/owner/requests/${encodeURIComponent(r.id)}/message`, { method: 'POST', body: { body }, auth: true });
                                const convoId = (convoRes && convoRes.data && convoRes.data.conversation_id) || null;
                                if (convoId) { closeModal(); navigateTo('messages', convoId); }
                                else { statusEl.className = 'form-status error'; statusEl.innerHTML = '<strong>Message sent but no conversation returned.</strong>'; }
                            } catch (err) { statusEl.className = 'form-status error'; statusEl.innerHTML = `<strong>Failed.</strong> ${escape(err.message)}`; }
                        });
                    }
                });
            }

            const startBtn = document.getElementById('start-convo');
            if (startBtn) {
                startBtn.addEventListener('click', async () => {
                    try {
                        const convoRes = await api(`/owner/matters/${encodeURIComponent(r.matter_id)}/conversation`, { auth: true });
                        const convo = (convoRes && convoRes.data) || {};
                        if (convo.id) { navigateTo('messages', convo.id); }
                    } catch (err) { alert(err.message || 'Could not open conversation.'); }
                });
            }
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load request.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadMatters() {
        const container = document.getElementById('main-content');
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading matters…</strong></div>';
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
            const res = await api('/owner/appointments?limit=100', { auth: true });
            const items = (res && res.data) || [];
            const now = new Date();
            const upcoming = items.filter((a) => new Date(a.starts_at) > now && !/cancelled|completed|no_show/i.test(a.status || ''));
            const past = items.filter((a) => new Date(a.starts_at) <= now || /cancelled|completed|no_show/i.test(a.status || ''));

            container.innerHTML = `
                <div class="page-head">
                    <div><h1>Appointments / Consultations</h1><p class="head-meta">Schedule and manage all client appointments and consultations.</p></div>
                    <button class="btn primary" id="btn-schedule-appt">Schedule Consultation</button>
                </div>
                <section class="panel">
                    <div class="panel-head"><h2>Upcoming</h2><span class="panel-meta">${upcoming.length} upcoming</span></div>
                    <div class="panel-body tight">
                        ${upcoming.length === 0
                            ? '<div class="empty-state tight"><span class="ico">·</span><strong>No upcoming appointments.</strong></div>'
                            : `<table class="table"><thead><tr><th>Date/Time</th><th>Client</th><th>Matter</th><th>Status</th><th>Actions</th></tr></thead><tbody>${upcoming.map((a) => `
                                <tr>
                                    <td class="muted">${escape(a.starts_at)}${a.ends_at ? ' — ' + escape(a.ends_at) : ''}</td>
                                    <td>${escape(a.client_name)}</td>
                                    <td class="muted">${escape(a.matter_reference || '—')}</td>
                                    <td>${escape(a.status)}</td>
                                    <td>
                                        <button class="btn small secondary" data-appt="${a.id}">View</button>
                                        <button class="btn small" data-cancel="${a.id}">Cancel</button>
                                        <button class="btn small" data-complete="${a.id}">Complete</button>
                                    </td>
                                </tr>
                            `).join('')}</tbody></table>`}
                    </div>
                </section>
                <section class="panel">
                    <div class="panel-head"><h2>Past / Cancelled</h2><span class="panel-meta">${past.length} total</span></div>
                    <div class="panel-body tight">
                        ${past.length === 0
                            ? '<div class="empty-state tight"><span class="ico">·</span><strong>No past appointments.</strong></div>'
                            : `<table class="table"><thead><tr><th>Date/Time</th><th>Client</th><th>Matter</th><th>Status</th><th>Actions</th></tr></thead><tbody>${past.map((a) => `
                                <tr>
                                    <td class="muted">${escape(a.starts_at)}${a.ends_at ? ' — ' + escape(a.ends_at) : ''}</td>
                                    <td>${escape(a.client_name)}</td>
                                    <td class="muted">${escape(a.matter_reference || '—')}</td>
                                    <td>${escape(a.status)}</td>
                                    <td><button class="btn small secondary" data-appt="${a.id}">View</button></td>
                                </tr>
                            `).join('')}</tbody></table>`}
                    </div>
                </section>
                ${scheduleAppointmentModal()}
            `;

            document.getElementById('btn-schedule-appt')?.addEventListener('click', () => {
                document.getElementById('schedule-appt-modal').style.display = 'block';
            });

            container.querySelectorAll('button[data-appt]').forEach((btn) => {
                btn.addEventListener('click', () => loadAppointmentDetail(btn.getAttribute('data-appt')));
            });
            container.querySelectorAll('button[data-cancel]').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const id = btn.getAttribute('data-cancel');
                    if (!confirm('Cancel this appointment?')) return;
                    try {
                        await api('/owner/appointments/' + encodeURIComponent(id) + '/cancel', { method: 'POST', auth: true });
                        alert('Appointment cancelled.');
                        loadAppointments();
                    } catch (e) {
                        alert('Failed: ' + (e.message || ''));
                    }
                });
            });
            container.querySelectorAll('button[data-complete]').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const id = btn.getAttribute('data-complete');
                    try {
                        await api('/owner/appointments/' + encodeURIComponent(id) + '/complete', { method: 'POST', auth: true });
                        alert('Appointment marked complete.');
                        loadAppointments();
                    } catch (e) {
                        alert('Failed: ' + (e.message || ''));
                    }
                });
            });

            const scheduleForm = document.getElementById('schedule-appt-form');
            if (scheduleForm) {
                scheduleForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const statusEl = document.getElementById('sa-status');
                    statusEl.className = 'form-status';
                    statusEl.textContent = 'Scheduling…';
                    const data = {};
                    new FormData(scheduleForm).forEach((v, k) => { data[k] = v; });
                    try {
                        await api('/owner/appointments', { method: 'POST', body: data, auth: true });
                        statusEl.className = 'form-status success';
                        statusEl.innerHTML = '<strong>Appointment scheduled.</strong>Refreshing…';
                        setTimeout(() => loadAppointments(), 600);
                    } catch (err) {
                        statusEl.className = 'form-status error';
                        statusEl.innerHTML = `<strong>Failed.</strong>${err.message}`;
                    }
                });
            }
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load appointments.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    function scheduleAppointmentModal() {
        return `
        <div class="modal-overlay" id="schedule-appt-modal" style="display:none;">
            <div class="modal" style="max-width:520px;">
                <div class="panel-head"><h2>Schedule Consultation</h2></div>
                <div class="panel-body">
                    <form id="schedule-appt-form" novalidate>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                            <div class="field">
                                <label for="sa-client">Client</label>
                                <select id="sa-client" name="clientId" required>
                                    <option value="">Select client…</option>
                                </select>
                                <span class="error">Select a client.</span>
                            </div>
                            <div class="field">
                                <label for="sa-matter">Matter (optional)</label>
                                <select id="sa-matter" name="matterId">
                                    <option value="">None / General</option>
                                </select>
                            </div>
                            <div class="field">
                                <label for="sa-start">Start</label>
                                <input id="sa-start" name="startsAt" type="datetime-local" required>
                                <span class="error">Required.</span>
                            </div>
                            <div class="field">
                                <label for="sa-end">End</label>
                                <input id="sa-end" name="endsAt" type="datetime-local" required>
                                <span class="error">Required.</span>
                            </div>
                        </div>
                        <div class="field" style="margin-top:1rem;">
                            <label for="sa-notes">Notes / Instructions</label>
                            <textarea id="sa-notes" name="notes" rows="3" maxlength="2000"></textarea>
                        </div>
                        <div class="form-status" id="sa-status" role="status" aria-live="polite" style="margin-top:0.75rem;"></div>
                        <div class="actions" style="display:flex;gap:0.75rem;justify-content:flex-end;margin-top:1rem;">
                            <button type="button" class="btn ghost" id="sa-cancel">Cancel</button>
                            <button type="submit" class="btn primary">Schedule</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
        `;
    }

    async function loadDocuments() {
        const container = document.getElementById('main-content');
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading documents…</strong></div>';
        try {
            const res = await api('/owner/documents', { auth: true });
            const items = (res && res.data) || [];
            container.innerHTML = `
                <div class="page-head">
                    <div><h1>Documents</h1><p class="head-meta">Manage all uploaded documents and files.</p></div>
                </div>
                <section class="panel">
                    <div class="panel-head"><h2>All Documents</h2><span class="panel-meta">${items.length} total</span></div>
                    <div class="panel-body tight">
                        ${items.length === 0
                            ? '<div class="empty-state"><span class="ico">·</span><strong>No documents uploaded yet.</strong></div>'
                            : `<table class="table">
                            <thead><tr><th>Matter</th><th>Original Name</th><th>Client</th><th>Size</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
                            <tbody>${items.map((d) => `
                                <tr>
                                    <td class="muted">${escape(d.matter_reference || '—')}</td>
                                    <td>${escape(d.original_name)}</td>
                                    <td>${escape(d.client_name)}</td>
                                    <td class="muted">${escape(d.size_bytes ? (d.size_bytes / 1024).toFixed(1) + ' KB' : '—')}</td>
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
    let ownerSse = null;
    let ownerSseReconnectTimer = null;
    let ownerSseReconnectDelay = 1000;
    const OWNER_SSE_MAX_RECONNECT_DELAY = 10000;

    function ownerSseUrl() {
        const t = token();
        return t ? '/api/v1/events?token=' + encodeURIComponent(t) : '';
    }

    function ownerSseConnect() {
        ownerSseDisconnect();
        if (!currentOwnerConversationId) return;
        const url = ownerSseUrl();
        if (!url) return;
        try {
            const es = new EventSource(url);
            es.onopen = () => {
                ownerSseReconnectDelay = 1000;
                ownerStopPolling();
            };
            es.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'message.created' && data.conversationId === currentOwnerConversationId) {
                        if (!ownerDisplayedMessageIds.has(data.message && data.message.id)) {
                            ownerAppendMessages([data.message]);
                        }
                    }
                } catch (e) { /* ignore malformed */ }
            };
            es.onerror = () => {
                if (es) { es.close(); }
                ownerSseScheduleReconnect();
            };
            ownerSse = es;
        } catch (e) {
            ownerSseScheduleReconnect();
        }
    }

    function ownerSseDisconnect() {
        if (ownerSseReconnectTimer) {
            clearTimeout(ownerSseReconnectTimer);
            ownerSseReconnectTimer = null;
        }
        ownerSseReconnectDelay = 1000;
        if (ownerSse) {
            ownerSse.close();
            ownerSse = null;
        }
    }

    function ownerSseScheduleReconnect() {
        if (ownerSseReconnectTimer) return;
        ownerSseReconnectTimer = setTimeout(async () => {
            ownerSseReconnectTimer = null;
            const t = token();
            if (!t) return;
            try {
                await api('/profile', { auth: true });
            } catch (err) {
                if (err && err.status === 401) {
                    return;
                }
            }
            ownerSseConnect();
        }, ownerSseReconnectDelay);
        ownerSseReconnectDelay = Math.min(ownerSseReconnectDelay * 2, OWNER_SSE_MAX_RECONNECT_DELAY);
    }

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
        } else {
            ownerStopPolling();
            ownerSseDisconnect();
            currentOwnerConversationId = null;
            ownerLastKnownMessageId = null;
            ownerDisplayedMessageIds.clear();
        }
        if (currentOwnerConversationId) {
            await loadOwnerConversationDetail(currentOwnerConversationId);
            return;
        }
        await loadMessagesInbox();
    }

    async function loadMessagesInbox() {
        const container = document.getElementById('main-content');
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading messages…</strong></div>';
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
                        ${items.length === 0
                            ? '<div class="empty-state"><span class="ico">·</span><strong>No conversations yet.</strong><p>Conversations will appear here when clients message through their matters.</p></div>'
                            : `<table class="table">
                            <thead><tr><th>Matter</th><th>Client</th><th>Last Message</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
                            <tbody>${items.map((c) => `
                                <tr>
                                    <td class="mono">${escape(c.reference || '—')}${c.title ? ' — ' + escape(c.title) : ''}</td>
                                    <td>${escape(c.client_name || '—')}<br><span class="muted">${escape(c.client_email || '')}</span></td>
                                    <td>${escape(c.last_message_body || '—')}</td>
                                    <td class="muted">${escape(c.last_message_at || c.created_at)}</td>
                                    <td>${(c.unread_count > 0) ? `<span class="pill status-new">Unread (${c.unread_count})</span>` : '<span class="pill status-closed">Read</span>'}</td>
                                    <td><button class="btn small secondary" data-conversation-id="${c.id}">Open</button></td>
                                </tr>
                            `).join('')}</tbody>
                        </table>`
                        }
                    </div>
                </section>
            `;
            container.querySelectorAll('button[data-conversation-id]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    navigateTo('messages', btn.getAttribute('data-conversation-id'));
                });
            });
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load conversations.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadOwnerConversationDetail(id) {
        const container = document.getElementById('main-content');
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading conversation…</strong></div>';
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
                navigateTo('messages');
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
                    } catch (err) {
                        alert(err.message || 'Could not send reply.');
                    } finally {
                        btn.disabled = false;
                    }
                });
            }
            ownerSseConnect();
        } catch (error) {
            ownerStopPolling();
            ownerSseDisconnect();
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load conversation.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadNotifications() {
        const container = document.getElementById('main-content');
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading notifications…</strong></div>';
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
                            <thead><tr><th>Recipient</th><th>Kind</th><th>Title</th><th>Entity</th><th>Created</th><th>Actions</th></tr></thead>
                            <tbody>${items.map((n) => {
                                const entityLabel = n.entity_type ? `${n.entity_type}:${n.entity_id ? '#' + n.entity_id.split('-')[0] : '—'}` : '—';
                                return `
                                <tr>
                                    <td>${escape(n.recipient_name || '—')}</td>
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
                        case 'conversation': navigateTo('messages', entityId); break;
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
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading client…</strong></div>';
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
                        <h1>${escape(c.full_name || '—')}</h1>
                        <p class="head-meta">${escape(c.email || '—')} · #${escape(c.id.split('-')[0])}</p>
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
                btn.addEventListener('click', () => navigateTo('messages', btn.getAttribute('data-convo')));
            });
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load client.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadMatterDetail(id) {
        const container = document.getElementById('main-content');
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading matter…</strong></div>';
        try {
            const [res, actionsRes] = await Promise.all([
                api('/owner/matters/' + encodeURIComponent(id), { auth: true }),
                api('/owner/matters/' + encodeURIComponent(id) + '/actions', { auth: true }).catch(() => ({ data: { actions: [] } }))
            ]);
            const m = res.data;
            const events = res.events || [];
            const documents = res.documents || [];
            const appointments = res.appointments || [];
            const conversation = res.conversation || null;
            const originatingRequest = res.originating_request || null;
            const availableActions = (actionsRes && actionsRes.data && actionsRes.data.actions) || [];

            const actionOptions = availableActions.map((a) => {
                if (a.key === 'change_status' && a.options && a.options.length) {
                    return a.options.map((s) => `<option value="${escape(s)}">${escape(s.replace(/_/g, ' '))}</option>`).join('');
                }
                return '';
            });

            let dropdownItems = availableActions.map((a) => {
                const label = escape(a.label);
                if (a.key === 'change_status') {
                    const opts = (a.options || []).map((s) => `<option value="${escape(s)}">${escape(s.replace(/_/g, ' '))}</option>`).join('');
                    return `<div class="dropdown-item" data-action="${a.key}" style="padding:0.4rem 0.75rem;cursor:pointer;">
                        <div style="font-size:0.75rem;font-weight:600;color:var(--ink-mute);margin-bottom:0.25rem;">${label}</div>
                        <select class="action-select" style="width:100%;">
                            <option value="">Choose a status…</option>
                            ${opts}
                        </select>
                    </div>`;
                }
                return `<div class="dropdown-item" data-action="${a.key}" style="padding:0.5rem 0.75rem;cursor:pointer;">
                    <div style="font-size:0.8rem;font-weight:600;">${label}</div>
                </div>`;
            }).join('');

            const dropdownMenu = availableActions.length > 0 ? `
                <div class="quick-actions-dropdown" id="quick-actions-dropdown" style="display:none;position:absolute;top:100%;right:0;z-index:1000;background:var(--panel-bg);border:1px solid var(--line);border-radius:6px;min-width:220px;box-shadow:0 4px 12px rgba(0,0,0,0.15);">
                    ${dropdownItems}
                    <div style="border-top:1px solid var(--line);padding:0.4rem 0.75rem;font-size:0.72rem;color:var(--ink-mute);">Press ESC to close</div>
                </div>
            ` : '';

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
                        ${availableActions.length > 0 ? `<button class="btn small secondary dropdown-toggle" id="btn-quick-actions" type="button">Quick Actions ▼</button>` : ''}
                    </div>
                </div>
                ${dropdownMenu}
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
                if (conversation) navigateTo('messages', conversation.id);
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

            /* Quick Actions dropdown handlers */
            const qaBtn = document.getElementById('btn-quick-actions');
            const qaDropdown = document.getElementById('quick-actions-dropdown');
            if (qaBtn && qaDropdown) {
                qaBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const rect = qaBtn.getBoundingClientRect();
                    qaDropdown.style.top = (rect.bottom + window.scrollY) + 'px';
                    qaDropdown.style.right = (window.innerWidth - rect.right + window.scrollX) + 'px';
                    qaDropdown.style.display = qaDropdown.style.display === 'none' ? 'block' : 'none';
                });
                document.addEventListener('click', () => { if (qaDropdown) qaDropdown.style.display = 'none'; });
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape' && qaDropdown) qaDropdown.style.display = 'none';
                });
                qaDropdown.querySelectorAll('.dropdown-item').forEach((item) => {
                    item.addEventListener('click', () => handleAction(item.getAttribute('data-action'), m, qaDropdown));
                });
            }
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load matter.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function handleAction(actionKey, matter, dropdownEl) {
        if (dropdownEl) dropdownEl.style.display = 'none';
        try {
            if (actionKey === 'change_status') {
                const modal = new Modal({
                    title: 'Change Matter Status',
                    description: 'Enter a reason for this status change.',
                    fields: [
                        { name: 'status', label: 'New Status', type: 'select', required: true, options: [
                            { value: 'ACTIVE', label: 'Active' },
                            { value: 'ON_HOLD', label: 'On Hold' },
                            { value: 'COMPLETED', label: 'Completed' },
                            { value: 'CANCELLED', label: 'Cancelled' }
                        ] },
                        { name: 'reason', label: 'Reason (Optional)', type: 'textarea', required: false }
                    ],
                    onSubmit: async (formData) => {
                        await api(`/owner/matters/${encodeURIComponent(matter.id)}/status`, {
                            method: 'POST',
                            auth: true,
                            body: { status: formData.status, reason: formData.reason || undefined }
                        });
                        loadMatterDetail(matter.id);
                    }
                });
                modal.show();
            } else if (actionKey === 'add_internal_note') {
                const modal = new Modal({
                    title: 'Add Internal Note',
                    description: 'Add an internal note for this matter. This will be visible only to staff.',
                    fields: [
                        { name: 'note', label: 'Internal Note', type: 'textarea', required: true }
                    ],
                    onSubmit: async (formData) => {
                        await api(`/owner/matters/${encodeURIComponent(matter.id)}/internal-note`, {
                            method: 'POST',
                            auth: true,
                            body: { note: formData.note.trim() }
                        });
                        loadMatterDetail(matter.id);
                    }
                });
                modal.show();
            } else if (actionKey === 'schedule_appointment') {
                const modal = new Modal({
                    title: 'Schedule Appointment',
                    description: 'Enter appointment details.',
                    fields: [
                        { name: 'startsAt', label: 'Start Date/Time', type: 'datetime-local', required: true },
                        { name: 'endsAt', label: 'End Date/Time', type: 'datetime-local', required: true },
                        { name: 'notes', label: 'Notes (Optional)', type: 'textarea', required: false }
                    ],
                    onSubmit: async (formData) => {
                        if (!formData.startsAt || !formData.endsAt) {
                            throw new Error('Start and end times are required');
                        }
                        await api('/owner/appointments', {
                            method: 'POST',
                            auth: true,
                            body: {
                                matterId: matter.id,
                                clientId: matter.client_id,
                                startsAt: formData.startsAt,
                                endsAt: formData.endsAt,
                                notes: formData.notes || undefined
                            }
                        });
                        loadMatterDetail(matter.id);
                    }
                });
                modal.show();
            } else if (actionKey === 'request_document') {
                const modal = new Modal({
                    title: 'Request Document',
                    description: 'Enter document request details.',
                    fields: [
                        { name: 'description', label: 'Document Description', type: 'textarea', required: true },
                        { name: 'message', label: 'Message to Client (Optional)', type: 'textarea', required: false },
                        { name: 'dueDate', label: 'Due Date (Optional)', type: 'date', required: false }
                    ],
                    onSubmit: async (formData) => {
                        if (!formData.description || !formData.description.trim()) {
                            throw new Error('Document description is required');
                        }
                        await api(`/owner/matters/${encodeURIComponent(matter.id)}/document-request`, {
                            method: 'POST',
                            auth: true,
                            body: {
                                description: formData.description.trim(),
                                message: formData.message || undefined,
                                dueDate: formData.dueDate || undefined
                            }
                        });
                        loadMatterDetail(matter.id);
                    }
                });
                modal.show();
            } else if (actionKey === 'send_message') {
                const modal = new Modal({
                    title: 'Send Message',
                    description: 'Send a message to the client.',
                    fields: [
                        { name: 'body', label: 'Message', type: 'textarea', required: true }
                    ],
                    onSubmit: async (formData) => {
                        if (!formData.body || !formData.body.trim()) {
                            throw new Error('Message is required');
                        }
                        const convoRes = await api('/owner/matters/' + encodeURIComponent(matter.id) + '/conversation', {
                            method: 'GET',
                            auth: true
                        });
                        const conversationId = convoRes.data.id;
                        await api('/owner/conversations/' + encodeURIComponent(conversationId) + '/messages', {
                            method: 'POST',
                            auth: true,
                            body: { body: formData.body.trim() }
                        });
                        loadMatterDetail(matter.id);
                    }
                });
                modal.show();
            } else if (actionKey === 'assign_lawyer') {
                const modal = new Modal({
                    title: 'Assign Lawyer/Staff',
                    description: 'Enter the email address of the lawyer or staff member to assign to this matter.',
                    fields: [
                        { name: 'email', label: 'Email Address', type: 'email', required: true }
                    ],
                    onSubmit: async (formData) => {
                        if (!formData.email || !formData.email.trim()) {
                            throw new Error('Email is required');
                        }
                        const userRes = await api('/owner/users?search=' + encodeURIComponent(formData.email.trim()), { auth: true });
                        const user = (userRes.data || []).find((u) => u.role !== 'CLIENT');
                        if (!user) {
                            throw new Error('No active lawyer/staff found with that email');
                        }
                        await api(`/owner/matters/${encodeURIComponent(matter.id)}/assign`, {
                            method: 'POST',
                            auth: true,
                            body: { userId: user.id }
                        });
                        loadMatterDetail(matter.id);
                    }
                });
                modal.show();
            } else if (actionKey === 'view_originating_request') {
                loadRequestDetail(matter.originating_request_id);
            }
        } catch (err) {
            new Modal({
                title: 'Error',
                description: err.message || 'An error occurred while performing this action.',
                onSubmit: () => {}
            }).show();
        }
    }

    async function loadAppointmentDetail(id) {
        const container = document.getElementById('main-content');
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading appointment…</strong></div>';
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
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading document…</strong></div>';
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
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading analytics…</strong></div>';
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
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading audit logs…</strong></div>';
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
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading security events…</strong></div>';
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
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading permissions…</strong></div>';
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
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading settings…</strong></div>';
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
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Checking system health…</strong></div>';
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

    async function loadInvoices() {
        const container = document.getElementById('main-content');
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading invoices…</strong></div>';
        try {
            const res = await api('/owner/invoices', { auth: true });
            const items = (res && res.data) || [];
            container.innerHTML = `
                <div class="page-head"><div><h1>Invoices</h1><p class="head-meta">Manage client invoices and billing.</p></div></div>
                <section class="panel">
                    <div class="panel-head"><h2>All Invoices</h2><span class="panel-meta">${items.length} total</span></div>
                    <div class="panel-body tight">
                        ${items.length === 0
                            ? '<div class="empty-state"><span class="ico">·</span><strong>No invoices yet.</strong></div>'
                            : `<table class="table">
                            <thead><tr><th>ID</th><th>Matter</th><th>Client</th><th>Status</th><th>Total</th><th>Issued</th><th>Due</th><th>Actions</th></tr></thead>
                            <tbody>${items.map((inv) => `
                                <tr>
                                    <td class="mono">#${inv.id.split('-')[0]}</td>
                                    <td class="muted">${escape(inv.matter_reference || '—')}</td>
                                    <td>${escape(inv.client_name || '—')}</td>
                                    <td>${escape(inv.status)}</td>
                                    <td class="muted">${escape(inv.currency || 'TZS')} ${Number(inv.total || 0).toFixed(2)}</td>
                                    <td class="muted">${escape(inv.issued_at || '—')}</td>
                                    <td class="muted">${escape(inv.due_at || '—')}</td>
                                    <td><button class="btn small secondary" data-invoice="${inv.id}">View</button></td>
                                </tr>
                            `).join('')}</tbody>
                        </table>`
                        }
                    </div>
                </section>
            `;
            container.querySelectorAll('button[data-invoice]').forEach((btn) => {
                btn.addEventListener('click', () => loadInvoiceDetail(btn.getAttribute('data-invoice')));
            });
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load invoices.</strong><p>${escape(error.message)}</p></div>`;
        }
    }

    async function loadInvoiceDetail(id) {
        const container = document.getElementById('main-content');
        container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading invoice…</strong></div>';
        try {
            const [invoiceRes, itemsRes] = await Promise.all([
                api('/owner/invoices/' + encodeURIComponent(id), { auth: true }),
                api('/owner/invoices/' + encodeURIComponent(id) + '/items', { auth: true }).catch(() => ({ data: [] }))
            ]);
            const inv = invoiceRes.data;
            const items = (itemsRes && itemsRes.data) || [];
            container.innerHTML = `
                <div class="page-head">
                    <div>
                        <span class="kicker">Invoice</span>
                        <h1>#${escape(inv.id.split('-')[0])}</h1>
                        <p class="head-meta">${escape(inv.matter_reference || '—')} · ${escape(inv.client_name || '—')}</p>
                    </div>
                    <div class="action-row">
                        <button class="btn ghost" id="btn-back-invoices">← Back to Invoices</button>
                    </div>
                </div>
                <section class="panel">
                    <div class="panel-head"><h2>Invoice Details</h2></div>
                    <div class="panel-body">
                        <table class="table">
                            <tbody>
                                <tr><th style="width:30%">Status</th><td>${escape(inv.status)}</td></tr>
                                <tr><th>Currency</th><td>${escape(inv.currency || 'TZS')}</td></tr>
                                <tr><th>Subtotal</th><td>${escape(inv.currency || 'TZS')} ${Number(inv.subtotal || 0).toFixed(2)}</td></tr>
                                <tr><th>Tax</th><td>${escape(inv.currency || 'TZS')} ${Number(inv.tax || 0).toFixed(2)}</td></tr>
                                <tr><th>Total</th><td>${escape(inv.currency || 'TZS')} ${Number(inv.total || 0).toFixed(2)}</td></tr>
                                <tr><th>Issued</th><td class="muted">${escape(inv.issued_at || '—')}</td></tr>
                                <tr><th>Due</th><td class="muted">${escape(inv.due_at || '—')}</td></tr>
                                <tr><th>Paid</th><td class="muted">${escape(inv.paid_at || '—')}</td></tr>
                            </tbody>
                        </table>
                    </div>
                </section>
                <section class="panel">
                    <div class="panel-head"><h2>Line Items</h2></div>
                    <div class="panel-body tight">
                        ${items.length === 0
                            ? '<div class="empty-state tight"><span class="ico">·</span><strong>No line items.</strong></div>'
                            : `<table class="table"><thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead><tbody>${items.map((it) => `
                                <tr>
                                    <td>${escape(it.description)}</td>
                                    <td class="muted">${escape(it.quantity)}</td>
                                    <td class="muted">${escape(it.unit_price)}</td>
                                    <td class="muted">${escape(it.amount)}</td>
                                </tr>
                            `).join('')}</tbody></table>`
                            }
                    </div>
                </section>
            `;
            document.getElementById('btn-back-invoices')?.addEventListener('click', loadInvoices);
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load invoice.</strong><p>${escape(error.message)}</p></div>`;
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

    function startAuthPoller() {
        setInterval(async () => {
            try {
                await api('/profile', { auth: true });
            } catch (err) {
                if (err && err.status === 401) {
                    localStorage.removeItem(tokenKey);
                    localStorage.removeItem('auth_user');
                    window.location.href = 'login.html';
                }
            }
        }, 5 * 60 * 1000);
    }

    document.getElementById('subui-signout')?.addEventListener('click', () => {
        ownerSseDisconnect();
        localStorage.removeItem(tokenKey);
        localStorage.removeItem('auth_user');
        window.location.href = 'login.html';
    });

    const subuiSections = [
        'dashboard', 'users', 'clients', 'lawyers', 'staff', 'owners', 'requests', 'matters',
        'appointments', 'documents', 'messages', 'notifications', 'invoices', 'analytics',
        'audit', 'security', 'roles', 'settings', 'health'
    ];
    const sectionAliases = {
        notification: 'notifications',
        message: 'messages',
        matter: 'matters',
        request: 'requests',
        appointment: 'appointments',
        document: 'documents',
        invoice: 'invoices',
        client: 'clients',
        user: 'users',
        lawyer: 'lawyers',
        owner: 'owners',
        analytic: 'analytics',
        setting: 'settings'
    };

    function normalizeSection(section) {
        const normalized = String(section || '').toLowerCase().replace(/^\/+|\/+$/g, '');
        return sectionAliases[normalized] || normalized;
    }

    function readRoute() {
        const hash = window.location.hash || '';
        if (hash.length > 1) {
            return hash.substring(1).replace(/^\/+/, '');
        }

        const pathname = window.location.pathname || '';
        const prefix = '/subui/';
        if (!pathname.startsWith(prefix)) {
            return '';
        }

        const route = pathname.substring(prefix.length).replace(/^\/+|\/+$/g, '');
        if (!route || route === 'index.html') {
            return '';
        }

        const parts = route.split('/').filter(Boolean);
        if (parts[0] === 'dashboard') {
            parts.shift();
        }
        return parts.join('/');
    }

    function navigateTo(section, detailId) {
        const normalized = normalizeSection(section);
        const route = normalized === 'dashboard'
            ? '/subui/'
            : '/subui/' + normalized + (detailId ? '/' + encodeURIComponent(detailId) : '');

        if (window.location.pathname !== route || window.location.hash) {
            window.history.pushState({ section: normalized, detailId: detailId || null }, '', route);
        }
        navigateFromLocation();
    }

    function navigateFromLocation() {
        const route = readRoute();
        const parts = route ? route.split('/') : [];
        let section = normalizeSection(parts[0] || 'dashboard');
        let detailId = parts.length > 1 ? parts.slice(1).join('/') : null;

        if (!subuiSections.includes(section)) {
            section = 'dashboard';
            detailId = null;
        }
        if (section === 'dashboard') {
            detailId = null;
        }

        document.querySelectorAll('.sidebar-nav a').forEach((link) => link.classList.remove('active'));
        const link = document.querySelector('.sidebar-nav a[href="#' + section + '"]');
        if (link) link.classList.add('active');

        updateTopbar(section);
        loadSection(section, detailId);
    }

    document.querySelectorAll('.sidebar-nav a').forEach((link) => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo(link.getAttribute('href').substring(1));
        });
    });

    window.addEventListener('hashchange', navigateFromLocation);
    window.addEventListener('popstate', navigateFromLocation);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            if (currentOwnerConversationId && !(ownerSse && ownerSse.readyState === EventSource.OPEN)) {
                ownerSseConnect();
            }
        }
    });

    loadCurrentUser();
    startAuthPoller();
    navigateFromLocation();
})();