/* Consultation booking — client-side validation, creates an Appointment +
   linked Invoice via the existing API. No Matter is created. */
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

    function buildStartEnd() {
        const date = (form.querySelector('input[name="preferredDate"]') || {}).value || '';
        const time = (form.querySelector('input[name="preferredTime"]') || {}).value || '';
        if (!date) return { error: 'Please choose a preferred date.' };
        const start = new Date(`${date}T${time || '09:00'}`);
        if (Number.isNaN(start.getTime())) return { error: 'Preferred date/time is invalid.' };
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        return { startsAt: start.toISOString(), endsAt: end.toISOString() };
    }

    function mapConsultationType(label) {
        if (!label) return null;
        const map = {
            'Initial': 'INITIAL_CONSULTATION',
            'Follow-up': 'FOLLOW_UP',
            'Document review': 'MATTER_CONSULTATION',
            'Advisory': 'GENERAL_CONSULTATION'
        };
        return map[label] || null;
    }

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

        const time = buildStartEnd();
        if (time.error) {
            status.className = 'form-status error';
            status.innerHTML = '<strong>Please review the form.</strong>' + time.error;
            return;
        }

        const payload = {
            consultationType: mapConsultationType(data.consultType),
            meetingMode: (data.format || '').toLowerCase().includes('video') ? 'VIDEO'
                : (data.format || '').toLowerCase().includes('phone') ? 'PHONE' : 'IN_PERSON',
            durationMinutes: 60,
            locationDetails: data.format || null,
            startsAt: time.startsAt,
            endsAt: time.endsAt,
            notes: [
                `Consultation type: ${data.consultType || 'Not specified'}`,
                `Existing client: ${data.existing || 'No'}`,
                `Format: ${data.format || 'In person'}`,
                (data.phone ? `Phone: ${data.phone}` : ''),
                (data.description || '').trim()
            ].filter(Boolean).join('\n')
        };

        try {
            const res = await window.Site.API.bookConsultation(payload);
            const appt = res && res.data && res.data.apointment || (res && res.data && res.data.appointment);
            const invoice = res && res.data && res.data.invoice;
            const ref = appt ? appt.id : null;
            status.className = 'form-status success';
            status.innerHTML = '<strong>Consultation booked.</strong>The firm has received your booking. An invoice has been created and is now awaiting payment.' +
                (ref ? ` Your reference is <strong>#${String(ref).padStart(5,'0')}</strong>.` : '') +
                ' Redirecting to your appointments…';
            form.reset();
            setTimeout(() => { window.location.href = `appointments.html`; }, 1200);
        } catch (apiErr) {
            status.className = 'form-status error';
            status.innerHTML = '<strong>Could not book your consultation.</strong>' + (apiErr && apiErr.message ? apiErr.message : 'Please try again.');
        }
    });
})();