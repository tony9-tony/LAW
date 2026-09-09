/* Portal — request detail view. */
(function () {
    'use strict';
    if (!window.Site || !window.Portal || !window.Portal.guard()) return;
    const API = window.Site.API;
    const P = window.Portal;

    function escape(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
    function getParam(name) {
        return new URLSearchParams(location.search).get(name);
    }
    function splitDescription(desc) {
        if (!desc) return { meta: [], body: '' };
        const lines = desc.split('\n');
        const meta = [];
        let i = 0;
        while (i < lines.length && lines[i].includes(':')) {
            const [k, ...rest] = lines[i].split(':');
            meta.push([k.trim(), rest.join(':').trim()]);
            i++;
        }
        if (i < lines.length && lines[i] === '') i++;
        return { meta, body: lines.slice(i).join('\n').trim() };
    }

    async function load() {
        const id = getParam('id');
        const root = document.getElementById('root');
        if (!id) {
            root.innerHTML = `<div class="alert error"><strong>Missing reference.</strong>Open this page from <a href="requests.html">Your requests</a>.</div>`;
            return;
        }

        let request;
        try {
            const res = await API.getRequest(id);
            request = res.data;
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            if (err && err.status === 404) {
                root.innerHTML = `<div class="alert error"><strong>Not found.</strong>This request does not exist or does not belong to your account.</div>`;
            } else {
                root.innerHTML = `<div class="alert error"><strong>Could not load this request.</strong>${escape(err.message || '')}</div>`;
            }
            return;
        }

        document.getElementById('ref').textContent = `Reference #${String(request.id).padStart(5, '0')}`;
        document.getElementById('subject').textContent = request.subject || 'Request details';
        document.title = `${request.subject || 'Request'} | Client Portal`;

        const { meta, body } = splitDescription(request.description);
        const metaRows = [
            ['Status', P.statusPill(request.status)],
            ['Submitted', P.fmtDate(request.created_at)],
            ['Last update', P.fmtDate(request.updated_at || request.created_at)],
            ...meta.map(([k, v]) => [k, escape(v)])
        ];

        let events = [];
        try {
            const ev = await API.getRequestEvents(id);
            events = (ev && ev.data) || [];
        } catch (e) { /* timeline optional */ }

        const timelineItems = events.length ? events.map((ev) => `
            <li>
                <div class="ts">${P.fmtDate(ev.created_at)}</div>
                <div class="label">${escape(ev.title || ev.event_type)}</div>
                ${ev.note ? `<div class="note">${escape(ev.note)}</div>` : ''}
            </li>
        `).join('') : `
            <li>
                <div class="ts">${P.fmtDate(request.created_at)}</div>
                <div class="label">Matter submitted</div>
                <div class="note">You submitted this request to the firm for review.</div>
            </li>
            <li>
                <div class="ts">${P.fmtDate(request.updated_at || request.created_at)}</div>
                <div class="label">${statusLabel(request.status)}</div>
                <div class="note">The current status reflects the firm's last update.</div>
            </li>
            <li>
                <div class="ts">Next</div>
                <div class="label">Review and reply</div>
                <div class="note">The firm will respond. Updates will appear here.</div>
            </li>
        `;

        const messagesHref = (request.originating_matter && request.originating_matter.id)
            ? `messages.html?matter=${request.originating_matter.id}`
            : `messages.html?request=${request.id}`;

        root.innerHTML = `
            <div class="detail-grid">
                <div>
                    <section class="panel">
                        <div class="panel-head"><h2>Request information</h2><span class="panel-meta">Submitted by you</span></div>
                        <div class="panel-body">
                            <dl class="detail-meta">
                                ${metaRows.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${v}</dd>`).join('')}
                            </dl>
                            ${body ? `<div class="section-divider">${escape(body)}</div>` : ''}
                        </div>
                    </section>

                    <section class="panel">
                        <div class="panel-head"><h2>Timeline</h2><span class="panel-meta">From submission onward</span></div>
                        <div class="panel-body">
                            <ul class="timeline">${timelineItems}</ul>
                        </div>
                    </section>
                </div>

                <aside>
                    <section class="panel">
                        <div class="panel-head"><h2>Next action</h2></div>
                        <div class="panel-body">
                            <p class="text-soft">${acceptedCopy(request.status)}</p>
                            <a class="btn" href="${escape(messagesHref)}">Open conversation</a>
                            <a class="btn secondary spacer-2" href="documents.html">View related documents</a>
                        </div>
                    </section>

                    <section class="panel">
                        <div class="panel-head"><h2>Reference</h2></div>
                        <div class="panel-body">
                            <dl class="detail-meta">
                                <dt>ID</dt><dd class="ref">#${String(request.id).padStart(5, '0')}</dd>
                                <dt>Account</dt><dd>${escape((API.user() && API.user().email) || '—')}</dd>
                            </dl>
                        </div>
                    </section>
                </aside>
            </div>
        `;
    }

    function acceptedCopy(status) {
        const s = (status || '').toUpperCase();
        if (s === 'ACCEPTED') return 'This request has been accepted. A matter has been opened and the firm will reach out via secure message.';
        if (s === 'DECLINED') return 'The firm has reviewed this request and is unable to take it on at this time.';
        if (s === 'UNDER_REVIEW') return 'The firm is reviewing your request. You will be notified when the status changes.';
        if (s === 'SCHEDULED') return 'A consultation has been scheduled. Please check your messages.';
        if (s === 'COMPLETED' || s === 'CLOSED') return 'This request is closed. If you need further assistance, please submit a new matter.';
        return 'Submitting this request did not create a confirmed engagement. The firm will review and respond.';
    }

    function statusLabel(s) {
        const norm = (s || 'new').toLowerCase().replace(/\s+/g, '_');
        const labels = {
            new: 'Request received',
            submitted: 'Request received',
            pending: 'Pending review',
            open: 'Open',
            in_progress: 'Under review',
            under_review: 'Under review',
            scheduled: 'Scheduled',
            confirmed: 'Confirmed',
            closed: 'Closed',
            completed: 'Completed'
        };
        return labels[norm] || (s || 'New');
    }

    load();
})();
