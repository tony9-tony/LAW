/* Auth forms — login and register. Calls backend API. */
(function () {
    'use strict';

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
        return ok;
    }

    function bindForm(form, statusId, mode) {
        const status = document.getElementById(statusId);
        form.addEventListener('input', (e) => {
            const field = e.target.closest('.field');
            if (field && field.classList.contains('invalid')) {
                const input = field.querySelector('input, textarea, select');
                if (!input) return;
                const value = (input.value || '').trim();
                let valid = true;
                if (input.required && !value) valid = false;
                if (input.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) valid = false;
                if (input.minLength && value && value.length < input.minLength) valid = false;
                field.classList.toggle('invalid', !valid);
            }
        }, true);

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            status.className = 'form-status';
            status.textContent = mode === 'register' ? 'Creating account…' : 'Signing in…';
            if (!validate(form)) {
                status.className = 'form-status error';
                status.innerHTML = '<strong>Please review the form.</strong>Required fields are missing or invalid.';
                return;
            }

            const data = {};
            new FormData(form).forEach((v, k) => { data[k] = v; });

            try {
                const res = mode === 'register'
                    ? await window.Site.API.register({ email: data.email, password: data.password, fullName: data.fullName })
                    : await window.Site.API.login({ email: data.email, password: data.password });

                if (mode === 'login' && res && res.data) {
                    if (res.data.token) window.Site.API.setToken(res.data.token);
                    if (res.data.user) window.Site.API.setUser(res.data.user);
                }

                 status.className = 'form-status success';
                const userRole = (res && res.data && res.data.user && res.data.user.role) || '';
                if (mode === 'login' && userRole === 'OWNER') {
                    status.innerHTML = '<strong>Signed in.</strong> Redirecting to the Admin Portal login…';
                } else {
                    status.innerHTML = mode === 'register'
                        ? '<strong>Account created.</strong>You can now sign in to the client portal.'
                        : '<strong>Signed in.</strong>Redirecting to your portal…';
                }

                if (mode === 'login') {
                    if (userRole === 'OWNER') {
                        setTimeout(() => { window.location.href = '../subui/login.html'; }, 500);
                    } else {
                        const params = new URLSearchParams(location.search);
                        const next = params.get('next');
                        const target = (next && /^[\w-]+\.html$/.test(next)) ? `portal/${next}` : 'portal/dashboard.html';
                        setTimeout(() => { window.location.href = target; }, 500);
                    }
                } else {
                    setTimeout(() => { window.location.href = 'login.html'; }, 800);
                }
            } catch (err) {
                status.className = 'form-status error';
                const msg = err && err.message ? String(err.message).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) : 'The request could not be completed.';
                status.innerHTML = `<strong>${mode === 'register' ? 'Could not create account.' : 'Sign-in failed.'}</strong>${msg}`;
            }
        });
    }

    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    if (loginForm) bindForm(loginForm, 'li-status', 'login');
    if (registerForm) bindForm(registerForm, 'rg-status', 'register');
})();
