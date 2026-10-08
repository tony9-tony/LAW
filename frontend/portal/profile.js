/* Portal — profile: account details, name and password. */
(function () {
    'use strict';
    if (!window.Site || !window.Portal || !window.Portal.guard()) return;
    const API = window.Site.API;

    function set(id, v) { const el = document.getElementById(id); if (el) el.textContent = v || '—'; }
    function say(el, kind, title, text) {
        if (!el) return;
        el.className = 'form-status' + (kind ? ' ' + kind : '');
        el.innerHTML = '';
        const strong = document.createElement('strong');
        strong.textContent = title;
        el.appendChild(strong);
        if (text) el.appendChild(document.createTextNode(' ' + text));
    }

    async function load() {
        try {
            const res = await API.me();
            const u = res.data || {};
            set('meta-name', u.full_name);
            set('meta-email', u.email);
            set('meta-status', u.is_active ? 'Active' : 'Inactive');
            set('meta-created', u.created_at ? window.Portal.fmtDateShort(u.created_at) : '—');
            const nameInput = document.getElementById('pf-name');
            if (nameInput) nameInput.value = u.full_name || '';
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

    document.getElementById('name-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const status = document.getElementById('name-status');
        const name = (document.getElementById('pf-name').value || '').trim();
        if (name.length < 2) { say(status, 'error', 'Please enter your full name.'); return; }
        say(status, '', 'Saving…');
        try {
            await API.request('/profile', { method: 'PATCH', body: { full_name: name }, auth: true });
            say(status, 'success', 'Saved.', 'Your name is updated.');
            load();
        } catch (err) { say(status, 'error', 'Could not save.', err.message || ''); }
    });

    document.getElementById('password-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const status = document.getElementById('password-status');
        const current = form.currentPassword.value;
        const next = form.newPassword.value;
        if (!current) { say(status, 'error', 'Enter your current password.'); return; }
        if (next.length < 12) { say(status, 'error', 'The new password is too short.', 'Use at least 12 characters.'); return; }
        if (next !== form.confirm.value) { say(status, 'error', 'The new passwords do not match.'); return; }
        say(status, '', 'Changing password…');
        try {
            await API.request('/profile/password', { method: 'POST', body: { currentPassword: current, newPassword: next }, auth: true });
            form.reset();
            say(status, 'success', 'Password changed.', 'Use the new password next time you sign in.');
        } catch (err) { say(status, 'error', 'Could not change the password.', err.message || ''); }
    });

    load();
})();
