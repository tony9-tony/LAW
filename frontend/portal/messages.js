/* Portal — messages. Supports inbox list and thread views with near-real-time polling.
   Handles request-scoped conversations (created by owner) and matter-scoped conversations. */
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
    const thread = document.getElementById('thread');
    const threadContext = document.getElementById('thread-context');
    const meta = document.getElementById('thread-meta');
    const inboxList = document.getElementById('inbox-list');
    const inboxMeta = document.getElementById('inbox-meta');
    const form = document.getElementById('compose-form');
    const notice = document.getElementById('compose-notice');
    const msgActions = document.getElementById('msg-actions');
    let conversationId = null;
    let currentConvoRequestId = null;
    let currentConvoMatterId = null;

    const displayedMessageIds = new Set();
    let pollTimer = null;
    let lastKnownMessageId = null;
    let isPollingPaused = false;
    const POLL_INTERVAL_MS = 5000;
    const POLL_INTERVAL_HIDDEN_MS = 15000;
    let realtimeHandlersRegistered = false;
    let inboxRealtimeHandlersRegistered = false;
    const inboxConversations = new Map();

    function unregisterRealtimeHandlers() {
        const RT = window.Site && window.Site.Realtime;
        if (!RT || !realtimeHandlersRegistered) return;
        RT.off('message.created', onRealtimeMessage);
        RT.off('message.read', onRealtimeRead);
        RT.off('message.typing', onRealtimeTyping);
        RT.off('message.reaction_added', onRealtimeReaction);
        RT.off('message.reaction_removed', onRealtimeReaction);
        realtimeHandlersRegistered = false;
    }

    function unregisterInboxRealtimeHandlers() {
        const RT = window.Site && window.Site.Realtime;
        if (!RT || !inboxRealtimeHandlersRegistered) return;
        RT.off('message.created', onInboxRealtimeMessage);
        RT.off('message.read', onInboxRealtimeRead);
        inboxRealtimeHandlersRegistered = false;
    }

    function onInboxRealtimeMessage(data) {
        const cid = data.conversationId;
        const msg = data.message;
        if (!cid || !msg) return;
        const convo = inboxConversations.get(cid);
        if (convo) {
            convo.last_message_body = msg.body;
            convo.last_message_at = msg.created_at;
            if (convo.unread_count > 0) {
                convo.unread_count = convo.unread_count + 1;
            } else {
                convo.unread_count = 1;
            }
        }
        renderInbox();
    }

    function onInboxRealtimeRead(data) {
        const cid = data.conversationId;
        const convo = inboxConversations.get(cid);
        if (convo) {
            convo.unread_count = 0;
        }
        renderInbox();
    }

    function showThread() {
        unregisterRealtimeHandlers();
        unregisterInboxRealtimeHandlers();
        if (inboxEl) inboxEl.style.display = 'none';
        if (threadEl) threadEl.style.display = '';
        if (msgActions) msgActions.innerHTML = `<button class="btn ghost" id="btn-back-inbox2">← Back to conversations</button>`;
        document.getElementById('btn-back-inbox2')?.addEventListener('click', showInbox);
        if (conversationId) {
            const RT = window.Site && window.Site.Realtime;
            if (RT) {
                RT.on('message.created', onRealtimeMessage);
                RT.on('message.read', onRealtimeRead);
                RT.on('message.typing', onRealtimeTyping);
                RT.on('message.reaction_added', onRealtimeReaction);
                RT.on('message.reaction_removed', onRealtimeReaction);
                realtimeHandlersRegistered = true;
            }
        }
    }

    function onRealtimeMessage(data) {
        if (data.conversationId !== conversationId) return;
        const msg = data.message;
        if (!msg || displayedMessageIds.has(msg.id)) return;
        displayedMessageIds.add(msg.id);
        const fromClient = String(msg.sender_id) === String(API.user() && API.user().id);
        const name = msg.sender_name || (fromClient ? 'You' : 'Firm');
        const html = `
            <div class="msg ${fromClient ? 'from-client' : ''}" data-msg-id="${msg.id}">
                <div class="meta">${P.fmtDate(msg.created_at)} · ${escape(name)}</div>
                <div class="body">${escape(msg.body)}</div>
            </div>
        `;
        thread.insertAdjacentHTML('beforeend', html);
        const wasNearBottom = isNearBottom();
        if (lastKnownMessageId) lastKnownMessageId = msg.id;
        const count = thread.querySelectorAll('.msg').length;
        if (meta) meta.textContent = `${count} message${count === 1 ? '' : 's'}`;
        if (wasNearBottom) scrollToBottom();
    }

    function onRealtimeRead(data) {
        if (data.conversationId !== conversationId) return;
        const msg = thread.querySelector(`.msg[data-msg-id="${data.messageId}"]`);
        if (msg) msg.classList.add('read-by-peer');
        const readerEl = document.getElementById('thread-meta-read');
        if (readerEl) readerEl.textContent = 'Read';
    }

    function onRealtimeTyping(data) {
        if (data.conversationId !== conversationId) return;
        if (data.isTyping) {
            let el = document.getElementById('typing-indicator');
            if (!el) {
                el = document.createElement('div');
                el.id = 'typing-indicator';
                el.className = 'msg';
                el.style.opacity = '0.7';
                el.style.fontStyle = 'italic';
                thread.appendChild(el);
            }
            el.innerHTML = `<div class="meta">${escape(data.userName || 'Someone')} is typing…</div>`;
            if (isNearBottom()) scrollToBottom();
        } else {
            const el = document.getElementById('typing-indicator');
            if (el) el.remove();
        }
    }

    function onRealtimeReaction(data) {
        if (data.conversationId !== conversationId) return;
        if (data.messageId) loadReactions(data.messageId);
    }

    async function loadReactions(messageId) {
        try {
            const res = await API.request(`/messages/${messageId}/reactions`, { auth: true });
            const reactions = (res && res.data) || [];
            const msg = thread.querySelector(`.msg[data-msg-id="${messageId}"]`);
            if (msg && reactions.length > 0) {
                const existing = msg.querySelector('.reactions');
                if (existing) existing.remove();
                const html = reactions.reduce((acc, r) => acc + r.emoji, '');
                const el = document.createElement('span');
                el.className = 'reactions';
                el.textContent = html;
                msg.appendChild(el);
            }
        } catch (e) { /* ignore */ }
    }

    function showInbox() {
        unregisterRealtimeHandlers();
        unregisterInboxRealtimeHandlers();
        stopPolling();
        conversationId = null;
        lastKnownMessageId = null;
        displayedMessageIds.clear();
        currentConvoRequestId = null;
        currentConvoMatterId = null;
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

    function isNearBottom() {
        const threshold = 120;
        const appMain = document.querySelector('.portal-content');
        if (appMain) {
            return (appMain.clientHeight + appMain.scrollTop) >= (appMain.scrollHeight - threshold);
        }
        return (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - threshold);
    }

    function scrollToBottom() {
        const appMain = document.querySelector('.portal-content');
        if (appMain) {
            appMain.scrollTop = appMain.scrollHeight;
        } else {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        }
    }

    function renderThread(items, convoContext) {
        if (!items.length) {
            thread.innerHTML = `<div class="empty-state tight"><span class="ico">·</span><strong>No messages yet.</strong><p>Send a message below to start the conversation.</p></div>`;
            lastKnownMessageId = null;
            displayedMessageIds.clear();
            return;
        }
        displayedMessageIds.clear();
        thread.innerHTML = items.map((m) => {
            displayedMessageIds.add(m.id);
            const fromClient = String(m.sender_id) === String(API.user() && API.user().id);
            const name = m.sender_name || (fromClient ? 'You' : 'Firm');
            return `
                <div class="msg ${fromClient ? 'from-client' : ''}" data-msg-id="${m.id}">
                    <div class="meta">${P.fmtDate(m.created_at)} · ${escape(name)}</div>
                    <div class="body">${escape(m.body)}</div>
                </div>
            `;
        }).join('');
        const last = items[items.length - 1];
        if (last && last.id) lastKnownMessageId = last.id;
        meta.textContent = `${items.length} message${items.length === 1 ? '' : 's'}`;
        if (convoContext && threadContext) {
            threadContext.style.display = '';
            const parts = [];
            if (convoContext.request_subject) parts.push(`Request: ${escape(convoContext.request_subject)}`);
            else if (convoContext.requestId) parts.push(`Request #${String(convoContext.requestId).padStart(5, '0')}`);
            if (convoContext.matter_reference) parts.push(`Matter: ${escape(convoContext.matter_reference)}`);
            else if (convoContext.matterId) parts.push(`Matter #${String(convoContext.matterId).padStart(5, '0')}`);
            threadContext.innerHTML = `<strong>Conversation context:</strong> ${parts.join(' · ') || 'General inquiry'}`;
        }
    }

    function appendMessages(newItems) {
        if (!newItems.length) return;
        const emptyState = thread.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const wasNearBottom = isNearBottom();

        const html = newItems.map((m) => {
            displayedMessageIds.add(m.id);
            const fromClient = String(m.sender_id) === String(API.user() && API.user().id);
            const name = m.sender_name || (fromClient ? 'You' : 'Firm');
            return `
                <div class="msg ${fromClient ? 'from-client' : ''}" data-msg-id="${m.id}">
                    <div class="meta">${P.fmtDate(m.created_at)} · ${escape(name)}</div>
                    <div class="body">${escape(m.body)}</div>
                </div>
            `;
        }).join('');

        thread.insertAdjacentHTML('beforeend', html);

        const last = newItems[newItems.length - 1];
        if (last && last.id) lastKnownMessageId = last.id;

        const count = thread.querySelectorAll('.msg').length;
        meta.textContent = `${count} message${count === 1 ? '' : 's'}`;

        if (wasNearBottom) scrollToBottom();
    }

    function getPollInterval() {
        return document.visibilityState === 'visible' ? POLL_INTERVAL_MS : POLL_INTERVAL_HIDDEN_MS;
    }

    function startPolling() {
        stopPolling();
        if (!conversationId) return;
        isPollingPaused = false;
        pollTimer = setInterval(pollConversation, getPollInterval());
    }

    function stopPolling() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        isPollingPaused = false;
    }

    function pausePolling() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        isPollingPaused = true;
    }

    let pollErrorCount = 0;

    async function pollConversation() {
        if (!conversationId || isPollingPaused) return;

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
                isPollingPaused = true;
                if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
                console.warn('Messages polling paused after repeated failures.');
            }
        }
    }

    async function loadThread(convoId, context) {
        showThread();
        conversationId = convoId;
        currentConvoRequestId = context && context.requestId ? context.requestId : null;
        currentConvoMatterId = context && context.matterId ? context.matterId : null;
        thread.innerHTML = `<div class="empty-state tight"><span class="ico">·</span><strong>Loading conversation…</strong></div>`;
        meta.textContent = 'Loading…';
        if (threadContext) { threadContext.style.display = 'none'; threadContext.innerHTML = ''; }
        try {
            const detail = await API.getConversation(convoId);
            renderThread(detail.data.messages || [], detail.data);
            meta.textContent = `${(detail.data.messages || []).length} message${(detail.data.messages || []).length === 1 ? '' : 's'}`;
            await API.markConversationRead(convoId).catch(() => {});
            if (window.Portal && window.Portal.refreshUnreadIndicators) {
                window.Portal.refreshUnreadIndicators();
            }
            startPolling();
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            thread.innerHTML = `<div class="empty-state tight"><span class="ico">!</span><strong>Could not load this conversation.</strong><p>${escape(err.message || 'Please try again.')}</p><button class="btn" type="button" id="retry-thread">Retry</button></div>`;
            document.getElementById('retry-thread')?.addEventListener('click', () => loadThread(convoId, { requestId: currentConvoRequestId, matterId: currentConvoMatterId }));
        }
    }

    function renderInbox() {
        if (!inboxList) return;
        const items = Array.from(inboxConversations.values()).sort((a, b) => {
            const ta = a.last_message_at || a.created_at;
            const tb = b.last_message_at || b.created_at;
            return new Date(tb) - new Date(ta);
        });
        const totalUnread = items.reduce((sum, c) => sum + (c.unread_count || 0), 0);
        inboxMeta.textContent = `${items.length} total · ${totalUnread} unread`;

        if (window.Portal && window.Portal.refreshUnreadIndicators) {
            window.Portal.refreshUnreadIndicators();
        }

        inboxList.innerHTML = `<table class="requests-table"><thead><tr><th>Request / Matter</th><th>Last Message</th><th>Date</th><th>Status</th></tr></thead><tbody>${items.map((c) => {
            const isUnread = (c.unread_count || 0) > 0;
            const label = c.request_subject
                ? `Request: ${escape(c.request_subject)}`
                : (c.reference ? `${escape(c.reference)}${c.title ? ' — ' + escape(c.title) : ''}` : 'Conversation');
            const dot = isUnread ? '<span class="unread-dot" aria-hidden="true" title="Unread"></span>' : '';
            return `
                <tr style="cursor:pointer;" data-conversation-id="${c.id}" data-request-id="${c.request_id || ''}" data-matter-id="${c.matter_id || ''}" ${isUnread ? 'data-unread="true"' : ''}>
                    <td class="subj">${dot}${label}</td>
                    <td class="last-msg-preview">${escape(c.last_message_body || '—')}</td>
                    <td class="muted">${escape(c.last_message_at || c.created_at)}</td>
                    <td class="status-cell">${isUnread ? `<span class="pill status-new">${c.unread_count} unread</span>` : '<span class="pill status-closed">Read</span>'}</td>
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
            if (notice) {
                notice.innerHTML = '<strong>No conversation available yet.</strong> Submit a request and the firm will start a conversation once they review it.';
                notice.style.display = '';
            }
            if (form) form.style.display = 'none';
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
            showThread();
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
            showThread();
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
        const mid = p.get('matter');
        const rid = p.get('request');
        matterId = mid;
        requestId = rid;
        if (cid) {
            loadThread(cid, { requestId: rid, matterId: mid });
        } else if (mid || rid) {
            loadMatterThread();
        } else {
            showInbox();
        }
    });

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const body = form.querySelector('#msg-body').value.trim();
            if (!body || !conversationId) return;

            const submitBtn = form.querySelector('button[type="submit"]');
            const originalText = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = 'Sending…';

            const statusEl = document.getElementById('compose-status');
            if (statusEl) {
                statusEl.className = 'form-status';
                statusEl.textContent = 'Sending…';
            }

            try {
                await API.sendMessage(conversationId, body);
                form.querySelector('#msg-body').value = '';
                if (statusEl) {
                    statusEl.className = 'form-status success';
                    statusEl.textContent = 'Message sent.';
                    setTimeout(() => { statusEl.className = 'form-status'; statusEl.textContent = ''; }, 2500);
                }
                loadThread(conversationId, { requestId: currentConvoRequestId, matterId: currentConvoMatterId });
            } catch (err) {
                if (statusEl) {
                    statusEl.className = 'form-status error';
                    statusEl.innerHTML = '<strong>Failed to send.</strong> ' + escape(err && err.message ? err.message : 'Please try again.');
                }
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
            }
        });
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            if (conversationId) {
                const bodyInput = document.getElementById('msg-body');
                const hasDraft = bodyInput && bodyInput.value.trim().length > 0;
                if (hasDraft) { startPolling(); }
                else { loadThread(conversationId, { requestId: currentConvoRequestId, matterId: currentConvoMatterId }); }
            }
        } else {
            pausePolling();
        }
    });

    (async function init() {
        const p = new URLSearchParams(location.search);
        const cid = p.get('conversation');
        matterId = p.get('matter');
        requestId = p.get('request');
        if (cid) {
            await loadThread(cid, { requestId: requestId, matterId: matterId });
        } else if (matterId || requestId) {
            await loadMatterThread();
        } else {
            showInbox();
        }
    })();
})();
