/* Auth forms — login and register. Calls backend API. */
(function () {
    'use strict';

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
    }

    function validateField(field) {
        const input = field.querySelector('input, textarea, select');
        if (!input) return true;

        const value = input.type === 'checkbox' ? (input.checked ? 'on' : '') : (input.value || '').trim();
        let valid = true;

        if (input.required && !value) valid = false;
        if (input.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) valid = false;
        if (input.minLength && value && value.length < Number(input.minLength)) valid = false;
        if (input.id === 'reset-confirm' && value) {
            const pwd = document.getElementById('reset-password');
            if (pwd && pwd.value !== value) valid = false;
        }

        field.classList.toggle('invalid', !valid);
        return valid;
    }

    function validate(form) {
        let ok = true;
        form.querySelectorAll('.field').forEach((field) => {
            if (!validateField(field)) ok = false;
        });
        return ok;
    }

    function bindLiveValidation(form) {
        form.addEventListener('input', (event) => {
            const field = event.target.closest('.field');
            if (field && field.classList.contains('invalid')) {
                validateField(field);
            }

            if (event.target && event.target.id === 'reset-confirm') {
                const field = document.getElementById('reset-confirm').closest('.field');
                const passwordField = document.getElementById('reset-password').closest('.field');
                if (field) validateField(field);
                if (passwordField && passwordField.classList.contains('invalid')) validateField(passwordField);
            }
        }, true);
    }

    function redirectAfterLogin(userRole) {
        if (userRole === 'OWNER') {
            setTimeout(() => { window.location.href = '../subui/login.html'; }, 500);
            return;
        }

        const params = new URLSearchParams(location.search);
        const next = params.get('next');
        const target = (next && /^[\w-]+\.html$/.test(next)) ? `portal/${next}` : 'portal/dashboard.html';
        setTimeout(() => { window.location.href = target; }, 500);
    }

    function bindForm(form, statusId, mode) {
        const status = document.getElementById(statusId);
        if (!status) return;

        bindLiveValidation(form);

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            status.className = 'form-status';
            status.textContent = mode === 'register' ? 'Creating account…' : mode === 'reset' ? 'Updating password…' : 'Signing in…';

            if (!validate(form)) {
                status.className = 'form-status error';
                status.innerHTML = '<strong>Please review the form.</strong>Required fields are missing or invalid.';
                return;
            }

            const data = {};
            new FormData(form).forEach((v, k) => { data[k] = v; });

            try {
                if (mode === 'login') {
                    const res = await window.Site.API.login({ email: data.email, password: data.password });
                    if (res && res.data) {
                        if (res.data.token) window.Site.API.setToken(res.data.token);
                        if (res.data.user) window.Site.API.setUser(res.data.user);
                    }

                    const userRole = (res && res.data && res.data.user && res.data.user.role) || '';
                    /* Lawyer and staff accounts have no workspace in the browser yet: the
                       client portal would show them an empty client file. */
                    if (userRole === 'LAWYER' || userRole === 'STAFF') {
                        window.Site.logout();
                        status.className = 'form-status error';
                        status.innerHTML = '<strong>This is a firm staff account.</strong>The client portal is for clients. Please ask the owner for access.';
                        return;
                    }
                    status.className = 'form-status success';
                    status.innerHTML = userRole === 'OWNER'
                        ? '<strong>Signed in.</strong>Redirecting to the admin sign-in…'
                        : '<strong>Signed in.</strong>Redirecting to your portal…';
                    redirectAfterLogin(userRole);
                    return;
                }

                if (mode === 'register') {
                    const res = await window.Site.API.register({ email: data.email, password: data.password, fullName: data.fullName });
                    status.className = 'form-status success';
                    status.innerHTML = '<strong>Account created.</strong>You can now sign in to the client portal.';
                    setTimeout(() => { window.location.href = 'login.html'; }, 800);
                    return;
                }

            } catch (err) {
                status.className = 'form-status error';
                const msg = err && err.message ? escapeHtml(String(err.message)) : 'The request could not be completed.';
                const label = mode === 'register'
                    ? 'Could not create account.'
                    : mode === 'forgot'
                        ? 'Recovery request failed.'
                        : mode === 'reset'
                            ? 'Password reset failed.'
                            : 'Sign-in failed.';
                status.innerHTML = `<strong>${label}</strong>${msg}`;
            }
        });
    }

    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const forgotForm = document.getElementById('forgotForm');
    const resetForm = document.getElementById('resetForm');

    if (loginForm) bindForm(loginForm, 'li-status', 'login');
    if (registerForm) bindForm(registerForm, 'rg-status', 'register');
    if (forgotForm) bindForm(forgotForm, 'forgot-status', 'forgot');
    if (resetForm) bindForm(resetForm, 'reset-status', 'reset');
})();
