/* Custom matter guided intake — multi-step form, validation, review, submission. */
(function () {
    'use strict';

    const form = document.getElementById('customMatterForm');
    if (!form) return;

    const panes = Array.from(form.querySelectorAll('.step-pane'));
    const steps = Array.from(form.querySelectorAll('.stepper .step'));
    let current = 1;

    const labelMap = {
        matterType: 'Type of matter',
        helpType: 'Help needed',
        subject: 'Subject',
        description: 'Description',
        fullName: 'Full name',
        email: 'Email',
        phone: 'Phone',
        preferredContact: 'Preferred contact',
        consent: 'Consent'
    };

    function showPane(n) {
        panes.forEach((p) => p.classList.toggle('active', Number(p.dataset.pane) === n));
        steps.forEach((s) => {
            const sn = Number(s.dataset.step);
            s.classList.toggle('active', sn === n);
            s.classList.toggle('done', sn < n);
        });
        current = n;
        if (n === 5) renderReview();
        window.scrollTo({ top: form.offsetTop - 80, behavior: 'smooth' });
    }

    function validateField(field) {
        const input = field.querySelector('input, textarea, select');
        if (!input) return true;
        const value = (input.value || '').trim();
        let valid = true;
        if (input.required && !value) valid = false;
        if (input.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) valid = false;
        field.classList.toggle('invalid', !valid);
        return valid;
    }

    function validatePane(n) {
        const pane = panes.find((p) => Number(p.dataset.pane) === n);
        if (!pane) return true;
        let ok = true;
        const groups = pane.querySelectorAll('[role="radiogroup"]');
        groups.forEach((g) => {
            const checked = g.querySelector('input:checked');
            const field = g.closest('.field') || g.parentElement;
            const valid = !!checked;
            if (field && field.classList) field.classList.toggle('invalid', !valid);
            if (!valid) ok = false;
        });
        pane.querySelectorAll('.field').forEach((f) => {
            if (!validateField(f)) ok = false;
        });
        const checkbox = pane.querySelector('input[type="checkbox"][required]');
        if (checkbox) {
            const field = checkbox.closest('.field');
            const valid = checkbox.checked;
            if (field) field.classList.toggle('invalid', !valid);
            if (!valid) ok = false;
        }
        return ok;
    }

    function gather() {
        const data = {};
        new FormData(form).forEach((v, k) => { data[k] = v; });
        return data;
    }

    function renderReview() {
        const data = gather();
        const dl = document.getElementById('cm-review');
        if (!dl) return;
        const order = ['matterType', 'helpType', 'subject', 'description', 'fullName', 'email', 'phone', 'preferredContact'];
        dl.innerHTML = order
            .filter((k) => data[k] !== undefined && data[k] !== '' && k !== 'consent')
            .map((k) => {
                const v = String(data[k]).replace(/\n/g, '<br>');
                return `<dt class="def-term">${labelMap[k] || k}</dt><dd class="def-desc">${v}</dd>`;
            })
            .join('');
    }

    form.addEventListener('click', (e) => {
        const next = e.target.closest('[data-next]');
        const prev = e.target.closest('[data-prev]');
        if (next) {
            if (!validatePane(current)) {
                const firstInvalid = panes[current - 1].querySelector('.invalid');
                if (firstInvalid) firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }
            if (current < panes.length) showPane(current + 1);
        }
        if (prev) {
            if (current > 1) showPane(current - 1);
        }
    });

    form.querySelectorAll('.choice-card input[type="radio"]').forEach((input) => {
        input.addEventListener('change', () => {
            const group = input.closest('.choice-group');
            if (!group) return;
            group.querySelectorAll('.choice-card').forEach((c) => c.classList.remove('selected'));
            const card = input.closest('.choice-card');
            if (card) card.classList.add('selected');
            const field = group.closest('.field') || group.parentElement;
            if (field) field.classList.remove('invalid');
        });
    });

    form.addEventListener('input', (e) => {
        const field = e.target.closest('.field');
        if (field && field.classList.contains('invalid')) validateField(field);
    }, true);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!validatePane(current)) return;
        const status = document.getElementById('cm-status');

        status.className = 'form-status';
        status.textContent = 'Submitting your request…';
        const data = gather();
        const subject = (data.subject || '').trim();
        const descriptionParts = [
            data.matterType ? `Type: ${data.matterType}` : '',
            data.helpType ? `Help needed: ${data.helpType}` : '',
            `Contact: ${[data.fullName, data.email, data.phone].filter(Boolean).join(' · ')}`,
            `Preferred contact: ${data.preferredContact || 'email'}`,
            '',
            (data.description || '').trim()
        ].filter(Boolean);
        const description = descriptionParts.join('\n');

        try {
            const res = await window.Site.API.createRequest({ subject, description });
            const ref = res && res.data && res.data.id;
            status.className = 'form-status success';
            status.innerHTML = '<strong>Request submitted.</strong>The firm has received your matter and will respond.' +
                (ref ? ` Your reference is <strong>#${String(ref).padStart(5,'0')}</strong>.` : '') +
                ' Redirecting to your requests…';
            form.reset();
            setTimeout(() => { window.location.href = `requests.html`; }, 1200);
        } catch (apiErr) {
            status.className = 'form-status error';
            status.innerHTML = '<strong>Could not submit your request.</strong>' + (apiErr && apiErr.message ? apiErr.message : 'Please try again.') +
                ' Your input has been preserved on this page so you can retry.';
        }
    });
})();
