/* Consultation booking — client-side validation, builds a request, calls existing API. */
(function () {
    'use strict';

    const form = document.getElementById('consultForm');
    if (!form) return;

    const status = document.getElementById('cb-status');

    function validate() {
        let ok = true;
        form.querySelectorAll('.field').forEach((field) => {
            const input = field.querySelector('input, textarea, select');
            if (!input) return;
            const value = (input.value || '').trim();
            let valid = true;
            if (input.required && !value) valid = false;
            if (input.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) valid = false;
            field.classList.toggle('invalid', !valid);
            if (!valid) ok = false;
        });
        const typeChosen = form.querySelector('input[name="consultType"]:checked');
        const group = form.querySelector('[role="radiogroup"]');
        if (group) {
            const field = group.closest('.field') || group.parentElement;
            if (!typeChosen) {
                if (field && field.classList) field.classList.add('invalid');
                ok = false;
            } else if (field) field.classList.remove('invalid');
        }
        return ok;
    }

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
        if (field && field.classList.contains('invalid')) {
            const input = field.querySelector('input, textarea, select');
            if (!input) return;
            const value = (input.value || '').trim();
            let valid = true;
            if (input.required && !value) valid = false;
            if (input.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) valid = false;
            field.classList.toggle('invalid', !valid);
        }
    }, true);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        status.className = 'form-status';
        if (!validate()) {
            status.className = 'form-status error';
            status.innerHTML = '<strong>Please review the form.</strong>Required fields are missing or invalid.';
            const first = form.querySelector('.invalid');
            if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        status.className = 'form-status';
        status.textContent = 'Submitting your request…';

        const data = {};
        new FormData(form).forEach((v, k) => { data[k] = v; });

        const subject = (data.subject || `${data.consultType} consultation`).trim();
        const descriptionLines = [
            `Consultation type: ${data.consultType || 'Not specified'}`,
            `Existing client: ${data.existing || 'No'}`,
            `Preferred: ${[data.preferredDate, data.preferredTime].filter(Boolean).join(' ') || 'Flexible'}`,
            data.alternateDate || data.alternateTime ? `Alternate: ${[data.alternateDate, data.alternateTime].filter(Boolean).join(' ') || ''}` : '',
            `Format: ${data.format || 'In person'}`,
            '',
            (data.description || '').trim()
        ].filter(Boolean);
        const description = descriptionLines.join('\n');

        try {
            const res = await window.Site.API.createRequest({ subject, description });
            const ref = res && res.data && res.data.id;
            status.className = 'form-status success';
            status.innerHTML = '<strong>Request submitted — under review.</strong>The firm has received your consultation request and will confirm an appointment.' +
                (ref ? ` Your reference is <strong>#${String(ref).padStart(5,'0')}</strong>.` : '') +
                ' No appointment is confirmed until the firm responds. Redirecting to your requests…';
            form.reset();
            setTimeout(() => { window.location.href = `requests.html`; }, 1200);
        } catch (apiErr) {
            status.className = 'form-status error';
            status.innerHTML = '<strong>Could not submit your request.</strong>' + (apiErr && apiErr.message ? apiErr.message : 'Please try again.');
        }
    });
})();
