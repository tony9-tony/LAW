/* Portal — appointments. */
(function () {
    'use strict';
    if (!window.Site || !window.Portal || !window.Portal.guard()) return;
    const API = window.Site.API;
    const P = window.Portal;

    function escape(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

    function renderList(container, items, metaEl) {
        if (!items.length) {
            container.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>No appointments.</strong></div>';
            metaEl.textContent = '0';
            return;
        }
        container.innerHTML = items.map((a) => {
            const start = P.fmtDate(a.starts_at);
            const end = a.ends_at ? P.fmtDate(a.ends_at) : '';
            const matterLink = a.matter_id
                ? `<a class="link-bronze_soft" href="matter.html?id=${a.matter_id}">${escape(a.matter_reference || 'Matter')}</a>`
                : '<span class="muted">Unassigned</span>';
            return `
                <div class="doc-row">
                    <span class="doc-icon">${P.fmtDateShort(a.starts_at).replace(/[A-Za-z\s]/g, '').slice(2, 5) || 'APPT'}</span>
                    <div>
                        <div class="doc-name">${start}${end ? ' — ' + end : ''}</div>
                        <div class="doc-meta">${matterLink} ${a.matter_title ? '· ' + escape(a.matter_title) : ''}</div>
                        ${a.notes ? `<div class="doc-meta">${escape(a.notes)}</div>` : ''}
                    </div>
                    <span class="pill">${escape((a.status || 'scheduled').toUpperCase())}</span>
                </div>
            `;
        }).join('');
        metaEl.textContent = items.length + ' appointment' + (items.length === 1 ? '' : 's');
    }

    async function load() {
        const upcomingRoot = document.getElementById('upcoming-root');
        const pastRoot = document.getElementById('past-root');
        const upcomingMeta = document.getElementById('upcoming-meta');
        const pastMeta = document.getElementById('past-meta');
        try {
            const res = await API.listAppointments();
            const all = (res && res.data) || [];
            const now = new Date();
            const valid = all.filter((a) => a.starts_at);
            const upcoming = valid.filter((a) => new Date(a.starts_at) > now && !/cancelled|completed/i.test(a.status || '')).sort((x, y) => new Date(x.starts_at) - new Date(y.starts_at));
            const past = valid.filter((a) => new Date(a.starts_at) <= now).sort((x, y) => new Date(y.starts_at) - new Date(x.starts_at));
            renderList(upcomingRoot, upcoming, upcomingMeta);
            renderList(pastRoot, past, pastMeta);
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            upcomingRoot.innerHTML = '<div class="empty-state"><span class="ico">!</span><strong>Could not load appointments.</strong><p>' + escape(err.message || 'Please try again shortly.') + '</p></div>';
            pastRoot.innerHTML = '';
            upcomingMeta.textContent = 'Error';
            pastMeta.textContent = 'Error';
        }
    }

    function initBooking() {
        const btn = document.getElementById('btn-book-appt');
        const panel = document.getElementById('booking-panel');
        const form = document.getElementById('booking-form');
        const cancelBtn = document.getElementById('bk-cancel');
        const status = document.getElementById('booking-status');
        if (!btn || !panel || !form) return;

        btn.addEventListener('click', () => {
            panel.style.display = '';
            btn.style.display = 'none';
            status.className = 'form-status';
            status.textContent = '';
        });

        cancelBtn.addEventListener('click', () => {
            panel.style.display = 'none';
            btn.style.display = '';
            form.reset();
            status.className = 'form-status';
            status.textContent = '';
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            status.className = 'form-status';
            status.textContent = 'Submitting your request…';

            const data = {};
            new FormData(form).forEach((v, k) => { data[k] = v; });

            const subject = (data.subject || '').trim();
            const descriptionLines = [
                data.consultType ? `Consultation type: ${data.consultType}` : '',
                `Preferred: ${[data.preferredDate, data.preferredTime].filter(Boolean).join(' ') || 'Flexible'}`,
                data.alternateDate || data.alternateTime ? `Alternate: ${[data.alternateDate, data.alternateTime].filter(Boolean).join(' ') || ''}` : '',
                data.format ? `Format: ${data.format}` : '',
                '',
                (data.description || '').trim()
            ].filter(Boolean);
            const description = descriptionLines.join('\n');

            if (!subject || subject.length < 3) {
                status.className = 'form-status error';
                status.innerHTML = '<strong>Please review the form.</strong> Subject must be at least 3 characters.';
                return;
            }
            if (!description || description.length < 10) {
                status.className = 'form-status error';
                status.innerHTML = '<strong>Please review the form.</strong> Description must be at least 10 characters.';
                return;
            }

            try {
                const res = await API.createRequest({ subject, description });
                const ref = res && res.data && res.data.id;
                status.className = 'form-status success';
                status.innerHTML = '<strong>Request submitted — under review.</strong>The firm has received your consultation request and will confirm an appointment.' +
                    (ref ? ` Your reference is <strong>#${String(ref).padStart(5,'0')}</strong>.` : '') +
                    ' Refreshing…';
                form.reset();
                setTimeout(() => {
                    panel.style.display = 'none';
                    btn.style.display = '';
                    load();
                }, 1200);
            } catch (apiErr) {
                status.className = 'form-status error';
                status.innerHTML = '<strong>Could not submit your request.</strong>' + (apiErr && apiErr.message ? apiErr.message : 'Please try again.');
            }
        });
    }

    load();
    initBooking();
})();
