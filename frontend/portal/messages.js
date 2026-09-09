/* Portal — messages. Supports both inbox list and matter-bound thread views with near-real-time polling. */
(function () {
    'use strict';
    if (!window.Site || !window.Portal || !window.Portal.guard()) return;
    const API = window.Site.API;
    const P = window.Portal;

    function escape(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

    const params = new URLSearchParams(location.search);
    let matterId = params.get('matter');
    const requestId = params.get('request');
    const inboxEl = document.getElementById('messages-inbox');
    const threadEl = document.getElementById('messages-thread');
    const thread = document.getElementById('thread');
    const meta = document.getElementById('thread-meta');
    const inboxList = document.getElementById('inbox-list');
    const inboxMeta = document.getElementById('inbox-meta');
    const form = document.getElementById('compose-form');
    const notice = document.getElementById('compose-notice');
    let conversationId = null;

    const displayedMessageIds = new Set();
    let pollTimer = null;
    let lastKnownMessageId = null;
    let isPollingPaused = false;
    const POLL_INTERVAL_MS = 5000;
    const POLL_INTERVAL_HIDDEN_MS = 15000;

    function showThread() {
        if (inboxEl) inboxEl.style.display = 'none';
        if (threadEl) threadEl.style.display = '';
        if (conversationId) {
            const RT = window.Site && window.Site.Realtime;
            if (RT) {
                RT.on('message.created', onRealtimeMessage);
                RT.on('message.read', onRealtimeRead);
                RT.on('message.typing', onRealtimeTyping);
                RT.on('message.reaction_added', onRealtimeReaction);
                RT.on('message.reaction_removed', onRealtimeReaction);
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
            <div class="msg ${fromClient ? 'from-client' : ''}">
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
        // Mark messages as read visually
        if (data.conversationId !== conversationId) return;
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
            if (wasNearBottom()) scrollToBottom();
        } else {
            const el = document.getElementById('typing-indicator');
            if (el) el.remove();
        }
    }

    function onRealtimeReaction(data) {
        if (data.conversationId !== conversationId) return;
        // Re-fetch reactions for the message
        if (data.messageId) loadReactions(data.messageId);
    }

    async function loadReactions(messageId) {
        try {
            const res = await API.request(`/messages/${messageId}/reactions`);
            const reactions = (res && res.data) || [];
            // Update UI — reactions shown near message
        } catch (e) { /* ignore */ }
    }

    function showInbox() {
        stopPolling();
        conversationId = null;
        lastKnownMessageId = null;
        displayedMessageIds.clear();
        if (threadEl) threadEl.style.display = 'none';
        if (inboxEl) inboxEl.style.display = '';
        loadInbox();
    }

    function isNearBottom() {
        const threshold = 120;
        return (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - threshold);
    }

    function scrollToBottom() {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }

    function renderThread(items) {
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
                <div class="msg ${fromClient ? 'from-client' : ''}">
                    <div class="meta">${P.fmtDate(m.created_at)} · ${escape(name)}</div>
                    <div class="body">${escape(m.body)}</div>
                </div>
            `;
        }).join('');
        const last = items[items.length - 1];
        if (last && last.id) lastKnownMessageId = last.id;
        meta.textContent = `${items.length} message${items.length === 1 ? '' : 's'}`;
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
                <div class="msg ${fromClient ? 'from-client' : ''}">
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

        if (wasNearBottom) {
            scrollToBottom();
        }
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
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        isPollingPaused = false;
    }

    function pausePolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        isPollingPaused = true;
    }

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
        } catch (err) {
            if (err && err.status === 401) {
                window.location.replace('../login.html');
                return;
            }
        }
    }

    async function loadThread(convoId, matterIdParam) {
        showThread();
        conversationId = convoId;
        thread.innerHTML = `<div class="empty-state tight"><span class="ico">·</span><strong>Loading conversation…</strong></div>`;
        meta.textContent = 'Loading…';
        try {
            const detail = await API.getConversation(convoId);
            renderThread(detail.data.messages || []);
            meta.textContent = `${(detail.data.messages || []).length} message${(detail.data.messages || []).length === 1 ? '' : 's'}`;
            await API.markConversationRead(convoId).catch(() => {});
            startPolling();
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            thread.innerHTML = `<div class="empty-state tight"><span class="ico">!</span><strong>Could not load this conversation.</strong><p>${escape(err.message || 'Please try again.')}</p></div>`;
        }
    }

    async function loadInbox() {
        if (!inboxList) return;
        inboxList.innerHTML = `<div class="empty-state"><span class="ico">·</span><strong>Loading conversations…</strong></div>`;
        inboxMeta.textContent = 'Loading…';
        try {
            const res = await API.listConversations({ limit: 50 });
            const items = (res && res.data) || [];
            const totalUnread = items.reduce((sum, c) => sum + (c.unread_count || 0), 0);
            inboxMeta.textContent = `${items.length} total · ${totalUnread} unread`;
            if (!items.length) {
                inboxList.innerHTML = `<div class="empty-state"><span class="ico">·</span><strong>No conversations yet.</strong><p>When you message the firm from a matter, your threads will appear here.</p></div>`;
                return;
            }
            inboxList.innerHTML = `<table class="table"><thead><tr><th>Matter</th><th>Last Message</th><th>Date</th><th>Status</th></tr></thead><tbody>${items.map((c) => `
                <tr style="cursor:pointer;" data-conversation-id="${c.id}">
                    <td class="mono">${escape(c.reference)}${c.title ? ' — ' + escape(c.title) : ''}</td>
                    <td>${escape(c.last_message_body || '—')}</td>
                    <td class="muted">${escape(c.last_message_at || c.created_at)}</td>
                    <td>${(c.unread_count > 0) ? `<span class="pill status-new">Unread (${c.unread_count})</span>` : '<span class="pill status-closed">Read</span>'}</td>
                </tr>
            `).join('')}</tbody></table>`;
            inboxList.querySelectorAll('tr[data-conversation-id]').forEach((row) => {
                row.addEventListener('click', () => {
                    const cid = row.getAttribute('data-conversation-id');
                    const href = new URL(location);
                    href.searchParams.set('conversation', cid);
                    history.pushState({ conversationId: cid }, '', href);
                    loadThread(cid);
                });
            });
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
            if (notice) notice.innerHTML = '<strong>No matter selected.</strong>Open a matter to view its conversation.';
            form.style.display = 'none';
            thread.innerHTML = `<div class="empty-state tight"><span class="ico">·</span><strong>Pick a matter to start a conversation.</strong><p>Each matter has its own private thread with the firm.</p><a class="btn" href="matters.html">Open my matters</a></div>`;
            showThread();
            return;
        }
        try {
            const r = await API.getMatterConversation(matterId);
            if (r.data && r.data.id) {
                conversationId = r.data.id;
                await loadThread(conversationId, matterId);
            } else {
                thread.innerHTML = `<div class="empty-state tight"><span class="ico">·</span><strong>No conversation for this matter yet.</strong><p>Send a message below to start the conversation.</p></div>`;
                showThread();
            }
        } catch (e) {
            thread.innerHTML = `<div class="empty-state tight"><span class="ico">!</span><strong>Could not load this conversation.</strong><p>${escape(e.message || 'Please try again.')}</p></div>`;
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
        if (cid) {
            loadThread(cid);
        } else if (matterId) {
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
            const btn = form.querySelector('button[type="submit"]');
            btn.disabled = true;
            try {
                await API.sendMessage(conversationId, body);
                form.reset();
                await loadThread(conversationId);
            } catch (err) {
                if (err && err.status === 401) { window.location.replace('../login.html'); return; }
                alert(err.message || 'Could not send your message.');
            } finally {
                btn.disabled = false;
            }
        });
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            if (conversationId) {
                const bodyInput = document.getElementById('msg-body');
                const hasDraft = bodyInput && bodyInput.value.trim().length > 0;
                if (hasDraft) {
                    startPolling();
                } else {
                    loadThread(conversationId);
                }
            }
        } else {
            pausePolling();
        }
    });

    (async function init() {
        const p = new URLSearchParams(location.search);
        const cid = p.get('conversation');
        if (cid) {
            await loadThread(cid);
        } else if (matterId) {
            await loadMatterThread();
        } else {
            showInbox();
        }
    })();
})();
