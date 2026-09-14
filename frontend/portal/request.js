/* Portal — request detail with inline messaging composer. */
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

    /* --- Messaging state --- */
    let conversationId = null;
    let displayedMessageIds = new Set();
    let lastKnownMessageId = null;
    let pollTimer = null;
    const POLL_INTERVAL_MS = 5000;
    const POLL_INTERVAL_HIDDEN_MS = 15000;
    let realtimeHandlersRegistered = false;

    const threadEl = document.getElementById('msg-thread');
    const msgStatusEl = document.getElementById('msg-status');
    const msgMetaEl = document.getElementById('msg-meta');
    const msgForm = document.getElementById('msg-form');
    const msgBodyInput = document.getElementById('msg-body');
    const msgSection = document.getElementById('message-section');

    function unregisterRealtimeHandlers() {
        const RT = window.Site && window.Site.Realtime;
        if (!RT || !realtimeHandlersRegistered) return;
        RT.off('message.created', onRealtimeMessage);
        RT.off('message.read', onRealtimeRead);
        realtimeHandlersRegistered = false;
    }

    function onRealtimeMessage(data) {
        if (!conversationId || data.conversationId !== conversationId) return;
        const msg = data.message;
        if (!msg || displayedMessageIds.has(msg.id)) return;
        displayedMessageIds.add(msg.id);
        const fromClient = String(msg.sender_id) === String(API.user() && API.user().id);
        const html = renderMessage(msg, fromClient);
        threadEl.insertAdjacentHTML('beforeend', html);
        if (lastKnownMessageId) lastKnownMessageId = msg.id;
        updateMsgCount();
        scrollToBottom();
    }

    function onRealtimeRead(data) {
        if (!conversationId || data.conversationId !== conversationId) return;
    }

    function registerRealtimeHandlers() {
        if (realtimeHandlersRegistered) return;
        const RT = window.Site && window.Site.Realtime;
        if (RT) {
            RT.on('message.created', onRealtimeMessage);
            RT.on('message.read', onRealtimeRead);
            realtimeHandlersRegistered = true;
        }
    }

    function renderMessage(m, fromClient) {
        const name = m.sender_name || (fromClient ? 'You' : 'Firm');
        return `
            <div class="msg ${fromClient ? 'from-client' : ''}">
                <div class="meta">${P.fmtDate(m.created_at)} · ${escape(name)}</div>
                <div class="body">${escape(m.body)}</div>
            </div>
        `;
    }

    function renderThread(items) {
        if (!items || !items.length) {
            threadEl.innerHTML = `<div class="empty-state tight"><span class="ico">·</span><strong>No messages yet.</strong><p>Type your message below to start the conversation.</p></div>`;
            lastKnownMessageId = null;
            displayedMessageIds.clear();
            return;
        }
        displayedMessageIds.clear();
        threadEl.innerHTML = items.map((m) => {
            displayedMessageIds.add(m.id);
            const fromClient = String(m.sender_id) === String(API.user() && API.user().id);
            return renderMessage(m, fromClient);
        }).join('');
        const last = items[items.length - 1];
        if (last && last.id) lastKnownMessageId = last.id;
        updateMsgCount();
        scrollToBottom();
    }

    function appendMessages(newItems) {
        if (!newItems || !newItems.length) return;
        const emptyState = threadEl.querySelector('.empty-state');
        if (emptyState) emptyState.remove();
        const wasNearBottom = isNearBottom();
        const html = newItems.map((m) => {
            displayedMessageIds.add(m.id);
            const fromClient = String(m.sender_id) === String(API.user() && API.user().id);
            return renderMessage(m, fromClient);
        }).join('');
        threadEl.insertAdjacentHTML('beforeend', html);
        const last = newItems[newItems.length - 1];
        if (last && last.id) lastKnownMessageId = last.id;
        updateMsgCount();
        if (wasNearBottom) scrollToBottom();
    }

    function updateMsgCount() {
        if (msgMetaEl) {
            const count = threadEl.querySelectorAll('.msg').length;
            msgMetaEl.textContent = `${count} message${count === 1 ? '' : 's'}`;
        }
    }

    function scrollToBottom() {
        const content = document.querySelector('.portal-content');
        if (content) {
            content.scrollTop = content.scrollHeight;
        } else {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        }
    }

    function isNearBottom() {
        const content = document.querySelector('.portal-content');
        if (content) {
            return (content.clientHeight + content.scrollTop) >= (content.scrollHeight - 120);
        }
        return (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 120);
    }

    function getPollInterval() {
        return document.visibilityState === 'visible' ? POLL_INTERVAL_MS : POLL_INTERVAL_HIDDEN_MS;
    }

    function startPolling() {
        stopPolling();
        if (!conversationId) return;
        pollTimer = setInterval(pollConversation, getPollInterval());
    }

    function stopPolling() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    function pausePolling() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    let pollErrorCount = 0;

    async function pollConversation() {
        if (!conversationId) return;
        try {
            const opts = lastKnownMessageId ? { after: lastKnownMessageId } : {};
            const res = await API.getConversation(conversationId, opts);
            const messages = (res && res.data && res.data.messages) || [];
            const newMessages = messages.filter(m => !displayedMessageIds.has(m.id));
            if (newMessages.length > 0) {
                appendMessages(newMessages);
            }
            pollErrorCount = 0;
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            pollErrorCount += 1;
            if (pollErrorCount >= 3) {
                pausePolling();
            }
        }
    }

    async function loadConversation(requestId, matterId) {
        if (!msgSection || !threadEl) return;
        msgSection.style.display = '';
        if (msgMetaEl) msgMetaEl.textContent = 'Starting conversation…';
        threadEl.innerHTML = `<div class="empty-state tight"><span class="ico">·</span><strong>Loading conversation…</strong></div>`;

        try {
            let convo;
            if (matterId) {
                const res = await API.getMatterConversation(matterId);
                convo = res.data;
            } else {
                const res = await API.getRequestConversation(requestId);
                convo = res.data;
            }
            conversationId = convo.id;
            const detail = await API.getConversation(conversationId);
            renderThread(detail.data.messages || []);
            if (msgMetaEl) {
                const count = (detail.data.messages || []).length;
                msgMetaEl.textContent = `${count} message${count === 1 ? '' : 's'}`;
            }
            await API.markConversationRead(conversationId).catch(() => {});
            registerRealtimeHandlers();
            startPolling();
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            threadEl.innerHTML = `<div class="empty-state tight"><span class="ico">!</span><strong>Could not load conversation.</strong><p>${escape(err.message || 'Please try again.')}</p></div>`;
            if (msgMetaEl) msgMetaEl.textContent = 'Error';
        }
    }

    async function sendMessage() {
        if (!conversationId) return;
        const body = msgBodyInput.value.trim();
        if (!body) return;

        const submitBtn = msgForm.querySelector('button[type="submit"]');
        const originalText = submitBtn ? submitBtn.innerHTML : '';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = 'Sending…';
        }
        if (msgStatusEl) {
            msgStatusEl.className = 'form-status';
            msgStatusEl.textContent = 'Sending…';
        }
        msgBodyInput.disabled = true;

        try {
            const res = await API.sendMessage(conversationId, body);
            const msg = res.data;
            displayedMessageIds.add(msg.id);
            const fromClient = String(msg.sender_id) === String(API.user() && API.user().id);
            threadEl.insertAdjacentHTML('beforeend', renderMessage(msg, fromClient));
            lastKnownMessageId = msg.id;
            updateMsgCount();
            scrollToBottom();
            msgBodyInput.value = '';
            if (msgStatusEl) {
                msgStatusEl.className = 'form-status success';
                msgStatusEl.textContent = 'Message sent.';
                setTimeout(() => { msgStatusEl.className = 'form-status'; msgStatusEl.textContent = ''; }, 2500);
            }
        } catch (err) {
            if (msgStatusEl) {
                msgStatusEl.className = 'form-status error';
                msgStatusEl.innerHTML = '<strong>Failed to send.</strong> ' + escape(err.message || 'Please try again.');
            }
        } finally {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = originalText; }
            msgBodyInput.disabled = false;
        }
    }

    function initComposer() {
        if (!msgForm) return;
        // Prevent empty submission
        msgForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const body = msgBodyInput.value.trim();
            if (!body) {
                if (msgStatusEl) {
                    msgStatusEl.className = 'form-status error';
                    msgStatusEl.textContent = 'Please write a message before sending.';
                }
                msgBodyInput.focus();
                return;
            }
            await sendMessage();
        });

        // Enter key sends (Shift+Enter for newline)
        msgBodyInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                msgForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            }
        });
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            if (conversationId) {
                const draft = msgBodyInput && msgBodyInput.value.trim().length > 0;
                if (draft) { startPolling(); }
                else { loadConversation(conversationId, null); }
            }
        } else {
            pausePolling();
        }
    });

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

        // Determine messaging action for the "Next action" panel
        let messagesHref = '#';
        let messageLabel = 'Message lawyer';
        let messageBtnClass = 'btn primary';
        let messageNote = '';

        if (request.originating_matter && request.originating_matter.id) {
            messagesHref = `messages.html?matter=${request.originating_matter.id}`;
            messageLabel = 'Open conversation';
            messageNote = 'A matter has been opened. Your conversation with the firm is linked below.';
        } else {
            messageNote = 'You can message the lawyer directly below. The firm will respond as soon as possible.';
        }

        if (actionsEl) {
            actionsEl.innerHTML = `
                <a class="${messageBtnClass}" href="${escape(messagesHref)}" style="margin-top:0.75rem;">${messageLabel} <span class="arrow" aria-hidden="true">→</span></a>
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

        // Initialize the inline message composer
        initComposer();
        if (msgSection) msgSection.style.display = '';
        await loadConversation(id, request.originating_matter && request.originating_matter.id ? request.originating_matter.id : null);
    }

    function acceptedCopy(status) {
        const s = (status || '').toUpperCase();
        if (s === 'ACCEPTED') return 'This request has been accepted. A matter has been opened and the firm will reach out via secure message.';
        if (s === 'DECLINED') return 'The firm has reviewed this request and is unable to take it on at this time.';
        if (s === 'UNDER_REVIEW') return 'The firm is reviewing your request. You will be notified when the status changes.';
        if (s === 'SCHEDULED') return 'A consultation has been scheduled. Please check your messages for details.';
        if (s === 'COMPLETED' || s === 'CLOSED') return 'This request is closed. If you need further assistance, please submit a new request.';
        return 'The firm will review your request and respond. You can track progress here and message the firm.';
    }

    load();
})();
