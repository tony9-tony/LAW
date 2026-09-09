/* SUBUI login/setup — external script to satisfy CSP `script-src 'self'`. */
(function () {
    'use strict';

    const API_BASE = (window.__API_BASE__ || '/api/v1');

    function validate(form) {
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
        if (ok && form.id === 'setupForm') {
            const pw = form.querySelector('#su-password')?.value || '';
            const confirm = form.querySelector('#su-confirm')?.value || '';
            const confirmField = form.querySelector('#su-confirm')?.closest('.field');
            if (pw !== confirm) {
                ok = false;
                if (confirmField) confirmField.classList.add('invalid');
            }
        }
        return ok;
    }

    async function checkSetupStatus() {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
            const res = await fetch(API_BASE + '/auth/setup-status', { signal: controller.signal });
            clearTimeout(timeout);
            if (!res.ok) throw new Error('Could not verify setup status');
            const result = await res.json();
            return result.data.setupRequired;
        } catch (e) {
            clearTimeout(timeout);
            console.error('Setup status check failed:', e);
            throw e;
        }
    }

    function showPanel(panelId) {
        ['setup-panel', 'login-panel', 'loading-panel', 'error-panel'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = (id === panelId) ? 'block' : 'none';
        });
    }

    async function init() {
        try {
            const needsSetup = await checkSetupStatus();
            if (needsSetup) {
                showPanel('setup-panel');
                bindSetupForm();
            } else {
                showPanel('login-panel');
                bindLoginForm();
            }
        } catch (e) {
            showPanel('error-panel');
            document.getElementById('retry-btn')?.addEventListener('click', init);
        }
    }

    function bindSetupForm() {
        const form = document.getElementById('setupForm');
        const status = document.getElementById('su-status');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            status.className = 'form-status';
            status.textContent = 'Creating owner account…';
            if (!validate(form)) {
                status.className = 'form-status error';
                status.innerHTML = '<strong>Please review the form.</strong>Required fields are missing or invalid.';
                return;
            }
            const data = {};
            new FormData(form).forEach((v, k) => { data[k] = v; });
            data.role = 'OWNER';
            try {
                const res = await fetch(API_BASE + '/auth/setup-owner', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const text = await res.text();
                const result = text ? JSON.parse(text) : null;
                if (!res.ok) {
                    const message = (result && result.error && result.error.message) || `Request failed (${res.status})`;
                    throw new Error(message);
                }
                if (result && result.data && result.data.token) {
                    localStorage.setItem('auth_token', result.data.token);
                    localStorage.setItem('auth_user', JSON.stringify(result.data.user || {}));
                }
                status.className = 'form-status success';
                status.innerHTML = '<strong>Owner account created.</strong>Redirecting to Admin Portal…';
                setTimeout(() => { window.location.href = 'index.html'; }, 800);
            } catch (err) {
                status.className = 'form-status error';
                status.innerHTML = `<strong>Setup failed.</strong>${err.message}`;
            }
        });
    }

    function bindLoginForm() {
        const form = document.getElementById('loginForm');
        const status = document.getElementById('li-status');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            status.className = 'form-status';
            status.textContent = 'Signing in…';
            if (!validate(form)) {
                status.className = 'form-status error';
                status.innerHTML = '<strong>Please review the form.</strong>Required fields are missing or invalid.';
                return;
            }
            const data = {};
            new FormData(form).forEach((v, k) => { data[k] = v; });
            try {
                const res = await fetch(API_BASE + '/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const text = await res.text();
                const result = text ? JSON.parse(text) : null;
                if (!res.ok) {
                    const message = (result && result.error && result.error.message) || `Request failed (${res.status})`;
                    throw new Error(message);
                }
                if (result && result.data && result.data.token) {
                    localStorage.setItem('auth_token', result.data.token);
                    localStorage.setItem('auth_user', JSON.stringify(result.data.user || {}));
                }
                const user = result && result.data && result.data.user ? result.data.user : {};
                if (user.role !== 'OWNER') {
                    localStorage.removeItem('auth_token');
                    localStorage.removeItem('auth_user');
                    status.className = 'form-status error';
                    status.innerHTML = '<strong>Access denied.</strong>This area is reserved for platform owners.';
                    return;
                }
                status.className = 'form-status success';
                status.innerHTML = '<strong>Signed in.</strong>Redirecting to Admin Portal…';
                setTimeout(() => { window.location.href = 'index.html'; }, 500);
            } catch (err) {
                status.className = 'form-status error';
                status.innerHTML = `<strong>Sign-in failed.</strong>${err.message}`;
            }
        });
    }

    function backToWebsite() {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        window.location.href = '/';
    }

    async function showCreateAccount() {
        const status = document.getElementById('li-status');
        try {
            const needsSetup = await checkSetupStatus();
            if (needsSetup) {
                showPanel('setup-panel');
                bindSetupForm();
            } else {
                status.className = 'form-status error';
                status.innerHTML = '<strong>Setup already complete.</strong>Owner accounts already exist. Contact your administrator.';
            }
        } catch (e) {
            status.className = 'form-status error';
            status.innerHTML = '<strong>Could not verify setup status.</strong>Please try again.';
        }
    }

    document.getElementById('back-to-website')?.addEventListener('click', backToWebsite);
    document.getElementById('show-create-account')?.addEventListener('click', showCreateAccount);

    init();
})();
