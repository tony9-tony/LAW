/* Portal — messages. Inbox of conversations, and the thread itself (reply,
   reactions, delete for me / everyone, delivery status, typing, documents),
   which is the shared chat widget in ../js/chat-widget.js. */
(function () {
    'use strict';
    if (!window.Site || !window.Portal || !window.Portal.guard()) return;
    const API = window.Site.API;
    const P = window.Portal;

    function escape(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

    const params = new URLSearchParams(location.search);
    let matterId = params.get('matter');
    let requestId = params.get('request');
    const inboxEl = document.getElementById('messages-inbox');
    const threadEl = document.getElementById('messages-thread');
    const chatRoot = document.getElementById('chat-root');
    const threadContext = document.getElementById('thread-context');
    const meta = document.getElementById('thread-meta');
    const inboxList = document.getElementById('inbox-list');
    const inboxMeta = document.getElementById('inbox-meta');
    const notice = document.getElementById('compose-notice');
    const msgActions = document.getElementById('msg-actions');
    const thread = chatRoot;
    const form = null;
    let conversationId = null;
    let chat = null;
    let inboxRealtimeHandlersRegistered = false;
    const inboxConversations = new Map();

    function stopChat() { if (chat) { chat.destroy(); chat = null; } }

    function unregisterInboxRealtimeHandlers() {
        const RT = window.Site && window.Site.Realtime;
        if (!RT || !inboxRealtimeHandlersRegistered) return;
        RT.off('message.created', onInboxRealtimeMessage);
        RT.off('message.read', onInboxRealtimeRead);
        inboxRealtimeHandlersRegistered = false;
    }
    function onInboxRealtimeMessage(data) {
        const convo = inboxConversations.get(data.conversationId);
        const msg = data.message;
        if (!convo || !msg) return loadInbox();
        convo.last_message_body = msg.body;
        convo.last_message_at = msg.created_at;
        if (data.conversationId !== conversationId) convo.unread_count = (Number(convo.unread_count) || 0) + 1;
        renderInbox();
    }
    function onInboxRealtimeRead(data) {
        const convo = inboxConversations.get(data.conversationId);
        if (convo) convo.unread_count = 0;
        renderInbox();
    }

    function showInbox() {
        stopChat();
        unregisterInboxRealtimeHandlers();
        conversationId = null;
        if (threadEl) threadEl.style.display = 'none';
        if (inboxEl) inboxEl.style.display = '';
        if (msgActions) msgActions.innerHTML = `<a class="btn secondary" href="requests.html">← Back to requests</a>`;
        loadInbox();
        const RT = window.Site && window.Site.Realtime;
        if (RT && !inboxRealtimeHandlersRegistered) {
            RT.on('message.created', onInboxRealtimeMessage);
            RT.on('message.read', onInboxRealtimeRead);
            inboxRealtimeHandlersRegistered = true;
        }
    }

    async function loadThread(convoId, context) {
        stopChat();
        conversationId = convoId;
        /* Two-pane layout: the conversation list stays beside the open thread. */
        if (!inboxConversations.size) loadInbox();
        const RTi = window.Site && window.Site.Realtime;
        if (RTi && !inboxRealtimeHandlersRegistered) {
            RTi.on('message.created', onInboxRealtimeMessage);
            RTi.on('message.read', onInboxRealtimeRead);
            inboxRealtimeHandlersRegistered = true;
        }
        if (inboxEl) inboxEl.style.display = 'none';
        if (threadEl) threadEl.style.display = '';
        if (msgActions) msgActions.innerHTML = `<button class="btn ghost" id="btn-back-inbox2">← Back to conversations</button>`;
        document.getElementById('btn-back-inbox2')?.addEventListener('click', () => {
            const href = new URL(location); href.searchParams.delete('conversation'); history.pushState({}, '', href); showInbox();
        });
        if (notice) notice.style.display = 'none';
        if (threadContext) { threadContext.style.display = 'none'; threadContext.innerHTML = ''; }
        meta.textContent = '';
        chatRoot.innerHTML = '<div class="empty-state tight"><span class="ico">·</span><strong>Loading conversation…</strong></div>';
        try {
            const detail = await API.request(`/conversations/${encodeURIComponent(convoId)}?limit=1`, { auth: true });
            const c = detail.data || {};
            if (threadContext) {
                const parts = [];
                const known = inboxConversations.get(convoId) || {};
                const subject = c.request_subject || known.request_subject;
                const reference = c.reference || known.reference;
                const title = c.title || known.title;
                if (subject) parts.push(`Request: ${escape(subject)}`);
                if (reference) parts.push(`Matter: ${escape(reference)}${title ? ' — ' + escape(title) : ''}`);
                threadContext.style.display = '';
                threadContext.innerHTML = `<strong>Conversation context:</strong> ${parts.join(' · ') || 'General inquiry'}`;
            }
            const me = API.user() || {};
            chat = window.ChatWidget.mount(chatRoot, {
                conversationId: convoId,
                selfId: me.id,
                otherLabel: 'The firm',
                firmFirst: true,
                firmHasWritten: c.firm_has_written !== false,
                apiBase: API.base(),
                token: () => API.token(),
                loginUrl: '../login.html',
                http: (path, o) => API.request(path, { auth: true, method: (o && o.method) || 'GET', body: o && o.body }),
                paths: { thread: `/conversations/${encodeURIComponent(convoId)}`, send: `/conversations/${encodeURIComponent(convoId)}/messages`, read: `/conversations/${encodeURIComponent(convoId)}/read` },
                onActivity: () => { if (window.Portal && window.Portal.refreshUnreadIndicators) window.Portal.refreshUnreadIndicators(); }
            });
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            chatRoot.innerHTML = `<div class="empty-state tight"><span class="ico">!</span><strong>Could not load this conversation.</strong><p>${escape(err.message || 'Please try again.')}</p><button class="btn" type="button" id="retry-thread">Retry</button></div>`;
            document.getElementById('retry-thread')?.addEventListener('click', () => loadThread(convoId, context));
        }
    }

    function renderInbox() {
        if (!inboxList) return;
        const items = Array.from(inboxConversations.values()).sort((a, b) => {
            const ta = a.last_message_at || a.created_at;
            const tb = b.last_message_at || b.created_at;
            return new Date(tb) - new Date(ta);
        });
        const totalUnread = items.reduce((sum, c) => sum + (Number(c.unread_count) || 0), 0);
        inboxMeta.textContent = `${items.length} total · ${totalUnread} unread`;

        if (window.Portal && window.Portal.refreshUnreadIndicators) {
            window.Portal.refreshUnreadIndicators();
        }

        inboxList.innerHTML = `<table class="requests-table"><thead><tr><th>Request / Matter</th><th>Last Message</th><th>Date</th><th>Status</th></tr></thead><tbody>${items.map((c) => {
            const isUnread = (Number(c.unread_count) || 0) > 0;
            const label = c.request_subject
                ? `Request: ${escape(c.request_subject)}`
                : (c.reference ? `${escape(c.reference)}${c.title ? ' — ' + escape(c.title) : ''}` : 'Conversation');
            const dot = isUnread ? '<span class="unread-dot" aria-hidden="true" title="Unread"></span>' : '';
            return `
                <tr style="cursor:pointer;${c.id === conversationId ? 'box-shadow:inset 3px 0 0 var(--gold,#c4a15a);background:var(--bg-soft);' : ''}" data-conversation-id="${c.id}" data-request-id="${c.request_id || ''}" data-matter-id="${c.matter_id || ''}" ${isUnread ? 'data-unread="true"' : ''}>
                    <td class="subj">${dot}${label}</td>
                    <td class="last-msg-preview">${escape(c.last_message_body || '—')}</td>
                    <td class="muted">${escape(P.fmtDateShort ? P.fmtDateShort(c.last_message_at || c.created_at) : (c.last_message_at || c.created_at))}</td>
                    <td class="status-cell">${isUnread ? `<span class="pill status-new">${Number(c.unread_count) || 0} unread</span>` : '<span class="pill status-closed">Read</span>'}</td>
                </tr>
            `;
        }).join('')}</tbody></table>`;
        inboxList.querySelectorAll('tr[data-conversation-id]').forEach((row) => {
            row.addEventListener('click', () => {
                const cid = row.getAttribute('data-conversation-id');
                const rid = row.getAttribute('data-request-id');
                const mid = row.getAttribute('data-matter-id');
                const href = new URL(location);
                href.searchParams.set('conversation', cid);
                if (rid) href.searchParams.set('request', rid);
                if (mid) href.searchParams.set('matter', mid);
                history.pushState({ conversationId: cid, requestId: rid, matterId: mid }, '', href);
                loadThread(cid, { requestId: rid, matterId: mid });
            });
        });
    }

    async function loadInbox() {
        if (!inboxList) return;
        inboxList.innerHTML = `<div class="empty-state"><span class="ico">·</span><strong>Loading conversations…</strong></div>`;
        inboxMeta.textContent = 'Loading…';
        try {
            const res = await API.listConversations({ limit: 50 });
            const items = (res && res.data) || [];
            inboxConversations.clear();
            items.forEach((c) => inboxConversations.set(c.id, c));
            if (!items.length) {
                inboxList.innerHTML = `
                    <div class="empty-state">
                        <span class="ico">·</span>
                        <strong>No conversations yet.</strong>
                        <p>When the firm responds to your request or matter, your threads will appear here. Submit a request to get started.</p>
                        <div class="empty-actions">
                            <a class="btn" href="custom-matter.html">Submit a request <span class="arrow">→</span></a>
                            <a class="btn secondary" href="consultation.html">Book consultation</a>
                        </div>
                    </div>`;
                return;
            }
            renderInbox();
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            inboxList.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load conversations.</strong><p>${escape(err.message || 'Please try again.')}</p></div>`;
        }
    }

    async function loadMatterThread() {
        if (!matterId && requestId) {
            try {
                const r = await API.getRequest(requestId);
                if (r.data && r.data.originating_matter && r.data.originating_matter.id) {
                    matterId = r.data.originating_matter.id;
                }
            } catch (e) { /* fall through */ }
        }
        if (!matterId) {
            if (requestId) {
                try {
                    const r = await API.getRequestConversation(requestId);
                    if (r.data && r.data.id) {
                        conversationId = r.data.id;
                        loadThread(conversationId, { requestId });
                        return;
                    }
                } catch (err) {
                    if (err && err.status === 401) { window.location.replace('../login.html'); return; }
                }
            }
            if (notice) {
                notice.innerHTML = '<strong>No conversation available yet.</strong> Submit a request and the firm will start a conversation once they review it.';
                notice.style.display = '';
            }
            thread.innerHTML = `
                <div class="empty-state tight">
                    <span class="ico">·</span>
                    <strong>Conversation will appear here.</strong>
                    <p>Once the firm reviews your request and creates a matter (or starts a conversation directly), your messages will appear here. Check your requests for status updates.</p>
                    <div class="empty-actions">
                        <a class="btn" href="requests.html">View my requests</a>
                        <a class="btn secondary" href="request.html?id=${requestId || ''}">Request details</a>
                    </div>
                </div>`;
            if (inboxEl) inboxEl.style.display = 'none';
            if (threadEl) threadEl.style.display = '';
            return;
        }
        try {
            const r = await API.getMatterConversation(matterId);
            if (r.data && r.data.id) {
                conversationId = r.data.id;
                loadThread(conversationId, { matterId: matterId, requestId: requestId });
            }
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            thread.innerHTML = `<div class="empty-state tight"><span class="ico">·</span><strong>No conversation available for this matter.</strong><p>Please select a different matter or check back later.</p></div>`;
            if (inboxEl) inboxEl.style.display = 'none';
            if (threadEl) threadEl.style.display = '';
        }
    }

    document.getElementById('btn-back-inbox')?.addEventListener('click', () => {
        const href = new URL(location);
        href.searchParams.delete('conversation');
        history.pushState({}, '', href);
        showInbox();
    });

    window.addEventListener('popstate', () => {
        const p = new URLSearchParams(location.search);
        const cid = p.get('conversation');
        matterId = p.get('matter');
        requestId = p.get('request');
        if (cid) loadThread(cid, { requestId, matterId });
        else if (matterId || requestId) loadMatterThread();
        else showInbox();
    });

    (async function init() {
        const p = new URLSearchParams(location.search);
        const cid = p.get('conversation');
        matterId = p.get('matter');
        requestId = p.get('request');
        if (cid) await loadThread(cid, { requestId, matterId });
        else if (matterId || requestId) await loadMatterThread();
        else showInbox();
    })();
})();
