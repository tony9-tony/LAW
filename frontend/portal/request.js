/* Portal — request detail with clear messaging action. */
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

    function statusFlow(status) {
        const s = (status || '').toUpperCase();
        const steps = [
            { key: 'submitted', label: 'Submitted' },
            { key: 'under_review', label: 'Under review' },
            { key: 'accepted', label: 'Accepted' },
            { key: 'matter_created', label: 'Matter opened' }
        ];
        const stateIndex = {
            'NEW': 0, 'SUBMITTED': 0, 'PENDING': 0, 'OPEN': 0,
            'UNDER_REVIEW': 1, 'IN_PROGRESS': 1, 'ACTION_REQUIRED': 1,
            'ACCEPTED': 2, 'SCHEDULED': 2,
            'COMPLETED': 3, 'CLOSED': 3, 'DECLINED': -1
        };
        const current = stateIndex[s] ?? 0;
        if (s === 'DECLINED') {
            return '<div class="status-flow">' +
                steps.map((st, i) => `<span class="step ${i === 0 ? 'done' : ''}">${st.label}</span>`).join(' <span class="arrow">→</span> ') +
                ' <span class="step" style="border-color:var(--danger);color:var(--danger);">Declined</span></div>';
        }
        return '<div class="status-flow">' +
            steps.map((st, i) => {
                let cls = '';
                if (i < current) cls = 'done';
                else if (i === current) cls = 'active';
                return `<span class="step ${cls}">${st.label}</span>`;
            }).join(' <span class="arrow">→</span> ') +
            '</div>';
    }

    async function load() {
        const id = getParam('id');
        const root = document.getElementById('root');
        const actionsEl = document.getElementById('page-actions');
        if (!id) {
            root.innerHTML = `<div class="alert error"><strong>Missing reference.</strong>Open this page from <a class="link-bronze" href="requests.html">Your requests</a>.</div>`;
            if (actionsEl) actionsEl.innerHTML = '';
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
            if (actionsEl) actionsEl.innerHTML = '';
            return;
        }

        document.getElementById('ref').textContent = `Reference #${String(request.id).padStart(5, '0')}`;
        document.getElementById('subject').textContent = request.subject || 'Request details';
        document.getElementById('head-meta').textContent = request.description ? 'Submitted on ' + P.fmtDateShort(request.created_at) : 'No description provided.';
        document.title = `${request.subject || 'Request'} | Client Portal`;

        const { meta, body } = splitDescription(request.description);
        const metaRows = [
            ['Status', P.statusPill(request.status)],
            ['Submitted', P.fmtDate(request.created_at)],
            ['Last update', P.fmtDate(request.updated_at || request.created_at)],
            ...meta.map(([k, v]) => [k, escape(v)])
        ];

        // Determine messaging action
        let messagesHref = '#';
        let messageLabel = 'Message lawyer';
        let messageBtnClass = 'btn primary';
        let messageNote = '';

        if (request.originating_matter && request.originating_matter.id) {
            messagesHref = `messages.html?matter=${request.originating_matter.id}`;
            messageLabel = 'Open conversation';
            messageNote = 'A matter has been opened. Your conversation with the firm is linked below.';
        } else {
            // Try to find an existing request-scoped conversation
            let existingConvo = null;
            try {
                const convos = await API.listConversations({ limit: 50 });
                const convList = (convos && convos.data) || [];
                existingConvo = convList.find((c) => String(c.request_id) === String(request.id));
            } catch (e) { /* ignore */ }

            if (existingConvo) {
                messagesHref = `messages.html?conversation=${existingConvo.id}`;
                messageLabel = 'Open conversation';
                messageNote = 'The firm has started a conversation about this request.';
            } else {
                const s = (request.status || '').toUpperCase();
                if (['ACCEPTED', 'SCHEDULED', 'IN_PROGRESS', 'UNDER_REVIEW', 'ACTION_REQUIRED'].includes(s)) {
                    messageNote = 'A matter should be linked to this request. Please contact the firm if you need assistance.';
                    messageBtnClass = 'btn secondary';
                } else if (s === 'DECLINED') {
                    messageNote = 'This request was declined. If you have a new matter, please submit a new request.';
                    messageBtnClass = 'btn secondary';
                } else {
                    messageNote = 'The firm will review your request and respond here. You will be able to message once a conversation is started.';
                    messageBtnClass = 'btn secondary';
                }
            }
        }

        if (actionsEl) {
            actionsEl.innerHTML = `
                <a class="${messageBtnClass}" href="${escape(messagesHref)}">${messageLabel} <span class="arrow" aria-hidden="true">→</span></a>
                <a class="btn secondary" href="documents.html">Documents</a>
            `;
        }

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
                <div class="label">Request submitted</div>
                <div class="note">You submitted this request to the firm for review.</div>
            </li>
            <li>
                <div class="ts">Next</div>
                <div class="label">Awaiting firm review</div>
                <div class="note">The firm will respond. Updates will appear here.</div>
            </li>
        `;

        const matterLink = request.originating_matter && request.originating_matter.id
            ? `<a class="link-bronze" href="matter.html?id=${request.originating_matter.id}">${escape(request.originating_matter.reference || 'matter')} — ${escape(request.originating_matter.title || 'View matter')}</a>`
            : '<span class="muted">Not yet created</span>';

        root.innerHTML = `
            <div class="detail-grid">
                <div>
                    <section class="panel">
                        <div class="panel-head"><h2>Request information</h2><span class="panel-meta">Submitted by you</span></div>
                        <div class="panel-body">
                            <div class="status-flow">${statusFlow(request.status)}</div>
                            <dl class="detail-meta" style="margin-top:1.25rem;">
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
                            <p class="text-small-mute">${escape(messageNote)}</p>
                            <a class="${messageBtnClass}" href="${escape(messagesHref)}" style="margin-top:0.75rem;">${messageLabel} <span class="arrow" aria-hidden="true">→</span></a>
                            <a class="btn secondary spacer-2" href="documents.html">View related documents</a>
                        </div>
                    </section>

                    <section class="panel">
                        <div class="panel-head"><h2>Related matter</h2></div>
                        <div class="panel-body">
                            <dl class="detail-meta">
                                <dt>Matter</dt><dd>${matterLink}</dd>
                            </dl>
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
        if (s === 'SCHEDULED') return 'A consultation has been scheduled. Please check your messages for details.';
        if (s === 'COMPLETED' || s === 'CLOSED') return 'This request is closed. If you need further assistance, please submit a new request.';
        return 'The firm will review your request and respond. You can track progress here and message the firm once a conversation is available.';
    }

    load();
})();
