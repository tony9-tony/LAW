/* Chat widget used by the client portal and the owner centre.
   Reply, reactions, delete for me / for everyone, delivery status (sent,
   delivered, read), typing indicator, document cards, live updates over SSE.

   ChatWidget.mount(container, {
       conversationId, selfId,
       http(path, { method, body }) -> Promise<json>   // paths are relative to /api/v1
       apiBase, token(),
       paths: { thread, send, read },
       otherLabel: 'The firm' | 'Client',
       onActivity()                                    // called after read / new message
   }) -> { destroy(), reload() }                       */
(function () {
    'use strict';

    const EMOJIS = ['👍', '❤️', '😂', '😮', '🙏'];
    const DELETED_TEXT = 'This message was deleted';

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const timeOf = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
    const dayOf = (iso) => {
        const d = new Date(iso); const now = new Date();
        const same = (a, b) => a.toDateString() === b.toDateString();
        const y = new Date(now); y.setDate(now.getDate() - 1);
        if (same(d, now)) return 'Today';
        if (same(d, y)) return 'Yesterday';
        return d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
    };
    const sizeOf = (n) => (!n && n !== 0) ? '' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

    function injectStyles() {
        if (document.getElementById('chat-widget-styles')) return;
        const css = `
.cw{display:flex;flex-direction:column;gap:.75rem}
.cw-thread{display:flex;flex-direction:column;gap:.15rem;max-height:62vh;min-height:260px;overflow-y:auto;padding:.5rem .25rem;scroll-behavior:smooth}
.cw-day{align-self:center;margin:.9rem 0 .5rem;padding:.2rem .75rem;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-mute,#8a857e);background:var(--bg-elev-2,#1a1a1a);border:1px solid var(--line-soft,#1f1b18);border-radius:999px}
.cw-row{display:flex;flex-direction:column;max-width:78%;position:relative}
.cw-row.mine{align-self:flex-end;align-items:flex-end}
.cw-row.theirs{align-self:flex-start;align-items:flex-start}
.cw-row.gap{margin-top:.55rem}
.cw-name{font-size:.72rem;color:var(--ink-mute,#8a857e);margin:0 .5rem .15rem}
.cw-bubble{position:relative;padding:.5rem .75rem .35rem;border-radius:14px;border:1px solid var(--line,#2a2520);background:var(--bg-elev-2,#1a1a1a);color:var(--ink,#f3efe8);font-size:.93rem;line-height:1.5;white-space:pre-wrap;word-break:break-word;min-width:64px}
.cw-row.mine .cw-bubble{background:var(--brown-muted,rgba(122,79,46,.22));border-color:var(--brown,#7a4f2e);border-bottom-right-radius:4px}
.cw-row.theirs .cw-bubble{border-bottom-left-radius:4px}
.cw-row.flash .cw-bubble{animation:cwflash 1.2s ease}
@keyframes cwflash{0%,60%{box-shadow:0 0 0 3px var(--brown-soft,#946236)}100%{box-shadow:none}}
.cw-bubble.deleted{font-style:italic;color:var(--ink-mute,#8a857e);background:transparent;border-style:dashed}
.cw-bubble.request{border-color:var(--warn,#b8862e);background:var(--warn-bg,rgba(184,134,46,.1))}
.cw-meta{display:flex;justify-content:flex-end;align-items:center;gap:.3rem;margin-top:.15rem;font-size:.68rem;color:var(--ink-mute,#8a857e)}
.cw-tick{letter-spacing:-.18em;font-size:.8rem}
.cw-tick.read{color:#4fa3e8}
.cw-quote{display:block;margin:0 0 .35rem;padding:.3rem .55rem;border-left:3px solid var(--brown-soft,#946236);background:rgba(0,0,0,.25);border-radius:4px;font-size:.8rem;cursor:pointer;text-align:left;width:100%;color:inherit;font-family:inherit}
.cw-quote strong{display:block;font-size:.72rem;color:var(--brown-soft,#c8935a)}
.cw-quote span{display:block;color:var(--ink-soft,#c4bfb6);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cw-doc{display:flex;align-items:center;gap:.6rem;margin:.1rem 0 .35rem;padding:.5rem .6rem;border:1px solid var(--line,#2a2520);border-radius:8px;background:rgba(0,0,0,.25)}
.cw-doc-ico{width:34px;height:34px;display:grid;place-items:center;border-radius:6px;background:var(--brown-muted,rgba(122,79,46,.2));font-size:.62rem;font-weight:700;letter-spacing:.04em}
.cw-doc-info{min-width:0;flex:1}.cw-doc-info b{display:block;font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cw-doc-info small{color:var(--ink-mute,#8a857e)}
.cw-doc button{font:inherit;font-size:.78rem;padding:.3rem .65rem;border-radius:6px;border:1px solid var(--line,#2a2520);background:var(--bg-elev-3,#202020);color:var(--ink,#f3efe8);cursor:pointer}
.cw-reacts{display:flex;flex-wrap:wrap;gap:.25rem;margin-top:-.2rem;position:relative;z-index:1}
.cw-react{font:inherit;font-size:.8rem;padding:.05rem .45rem;border-radius:999px;border:1px solid var(--line,#2a2520);background:var(--bg-elev-3,#202020);color:var(--ink,#f3efe8);cursor:pointer}
.cw-react.mine{border-color:var(--brown-soft,#946236);background:var(--brown-muted,rgba(122,79,46,.25))}
.cw-more{position:absolute;top:2px;right:4px;opacity:0;border:0;background:var(--bg-elev-3,#202020);color:var(--ink-soft,#c4bfb6);border-radius:6px;width:22px;height:22px;line-height:1;cursor:pointer;font-size:.8rem;transition:opacity .12s}
.cw-row:hover .cw-more,.cw-more:focus-visible{opacity:1}
@media (hover:none){.cw-more{opacity:.75}}
.cw-menu{position:fixed;z-index:9999;min-width:180px;padding:.35rem;border:1px solid var(--line,#2a2520);border-radius:10px;background:var(--bg-elev,#141414);box-shadow:0 12px 40px rgba(0,0,0,.55)}
.cw-menu-emoji{display:flex;gap:.15rem;padding:.2rem .2rem .45rem;border-bottom:1px solid var(--line-soft,#1f1b18);margin-bottom:.25rem}
.cw-menu-emoji button{font-size:1.15rem;border:0;background:transparent;cursor:pointer;border-radius:6px;padding:.15rem .3rem}.cw-menu-emoji button:hover{background:var(--bg-elev-3,#202020)}
.cw-menu-item{display:block;width:100%;text-align:left;font:inherit;font-size:.85rem;padding:.45rem .6rem;border:0;border-radius:6px;background:transparent;color:var(--ink,#f3efe8);cursor:pointer}
.cw-menu-item:hover{background:var(--bg-elev-3,#202020)}.cw-menu-item.danger{color:#e07a67}
.cw-typing{min-height:1.2rem;font-size:.78rem;font-style:italic;color:var(--ink-mute,#8a857e);padding:0 .5rem}
.cw-typing i{display:inline-block;width:4px;height:4px;margin:0 1px;border-radius:50%;background:currentColor;animation:cwdot 1s infinite}.cw-typing i:nth-child(2){animation-delay:.15s}.cw-typing i:nth-child(3){animation-delay:.3s}
@keyframes cwdot{0%,80%,100%{opacity:.25}40%{opacity:1}}
.cw-compose{display:flex;flex-direction:column;gap:.4rem;border-top:1px solid var(--line,#2a2520);padding-top:.75rem}
.cw-replybar{display:flex;align-items:center;gap:.6rem;padding:.4rem .6rem;border-left:3px solid var(--brown-soft,#946236);background:var(--bg-elev-2,#1a1a1a);border-radius:6px;font-size:.82rem}
.cw-replybar div{flex:1;min-width:0}.cw-replybar strong{display:block;font-size:.72rem;color:var(--brown-soft,#c8935a)}.cw-replybar span{display:block;color:var(--ink-soft,#c4bfb6);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cw-replybar button{border:0;background:transparent;color:var(--ink-mute,#8a857e);cursor:pointer;font-size:1.1rem}
.cw-inputrow{display:flex;gap:.5rem;align-items:flex-end}
.cw-input{flex:1;resize:none;min-height:44px;max-height:160px;padding:.65rem .8rem;border-radius:12px;border:1px solid var(--line,#2a2520);background:var(--bg-soft,#0f0f0f);color:var(--ink,#f3efe8);font:inherit;font-size:.93rem;line-height:1.4}
.cw-input:focus{outline:none;border-color:var(--brown-soft,#946236)}
.cw-send{height:44px;padding:0 1.1rem;border-radius:12px;border:1px solid var(--brown,#7a4f2e);background:var(--brown,#7a4f2e);color:#fff;font:inherit;font-weight:600;cursor:pointer}.cw-send:disabled{opacity:.5;cursor:default}
.cw-wait{padding:.75rem 1rem;border:1px solid var(--info,#6a8aa8);background:var(--info-bg,rgba(106,138,168,.08));border-radius:8px;font-size:.88rem;color:var(--ink-soft,#c4bfb6)}
.cw-hint{font-size:.72rem;color:var(--ink-faint,#5c5852)}
.cw-error{color:#e07a67;font-size:.8rem}
.cw-empty{padding:2.5rem 1rem;text-align:center;color:var(--ink-mute,#8a857e)}
.cw-dialog-back{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.6);display:grid;place-items:center;padding:1rem}
.cw-dialog{width:min(360px,100%);padding:1.2rem;border:1px solid var(--line,#2a2520);border-radius:12px;background:var(--bg-elev,#141414);color:var(--ink,#f3efe8)}
.cw-dialog h4{margin:0 0 .35rem;font-size:1.05rem}.cw-dialog p{margin:0 0 1rem;font-size:.85rem;color:var(--ink-soft,#c4bfb6)}
.cw-dialog .actions{display:flex;flex-direction:column;gap:.45rem}
.cw-dialog button{font:inherit;padding:.6rem .8rem;border-radius:8px;border:1px solid var(--line,#2a2520);background:var(--bg-elev-3,#202020);color:var(--ink,#f3efe8);cursor:pointer}
.cw-dialog button.danger{border-color:#a84a3a;color:#e07a67}
`;
        const style = document.createElement('style');
        style.id = 'chat-widget-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    function mount(container, opts) {
        injectStyles();
        const state = { messages: [], replyTo: null, typingTimer: null, lastTypingSent: 0, typingOff: null, es: null, esOpenedBefore: false, pollTimer: null, destroyed: false };
        const selfId = String(opts.selfId);
        const other = opts.otherLabel || 'The other side';

        container.innerHTML = `
            <div class="cw">
                <div class="cw-thread" role="log" aria-live="polite"></div>
                <div class="cw-typing" aria-live="polite"></div>
                <div class="cw-wait" hidden><strong>The firm will message you first.</strong> As soon as your advocate writes to you here, you can reply. You will also get a notification.</div>
                <form class="cw-compose" autocomplete="off">
                    <div class="cw-replybar" hidden></div>
                    <div class="cw-inputrow">
                        <textarea class="cw-input" rows="1" maxlength="4000" placeholder="Write a message…" aria-label="Message"></textarea>
                        <button class="cw-send" type="submit">Send</button>
                    </div>
                    <div class="cw-hint">Enter to send · Shift+Enter for a new line. Please avoid sharing ID numbers or bank details in chat.</div>
                    <div class="cw-error" role="alert"></div>
                </form>
            </div>`;
        const threadEl = container.querySelector('.cw-thread');
        const typingEl = container.querySelector('.cw-typing');
        const form = container.querySelector('.cw-compose');
        const input = container.querySelector('.cw-input');
        const sendBtn = container.querySelector('.cw-send');
        const replyBar = container.querySelector('.cw-replybar');
        const errorEl = container.querySelector('.cw-error');
        const waitEl = container.querySelector('.cw-wait');
        /* The firm speaks first: a client can reply only once the firm has written. */
        function setCanWrite(ok) {
            form.hidden = !ok;
            waitEl.hidden = ok;
        }
        setCanWrite(!opts.firmFirst || opts.firmHasWritten !== false);

        const mineOf = (m) => String(m.sender_id) === selfId;
        const byId = (id) => state.messages.find((m) => m.id === id);
        const nearBottom = () => threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight < 140;
        const toBottom = () => { threadEl.scrollTop = threadEl.scrollHeight; };

        /* ---------- rendering ---------- */
        function tickHtml(m) {
            if (!mineOf(m) || m.deleted) return '';
            const s = m.status || 'sent';
            const label = s === 'read' ? 'Read' : s === 'delivered' ? 'Delivered' : 'Sent';
            return `<span class="cw-tick ${s === 'read' ? 'read' : ''}" title="${label}" aria-label="${label}">${s === 'sent' ? '✓' : '✓✓'}</span>`;
        }
        function reactionsHtml(m) {
            if (!m.reactions || !m.reactions.length || m.deleted) return '';
            const groups = new Map();
            m.reactions.forEach((r) => {
                const g = groups.get(r.emoji) || { n: 0, mine: false };
                g.n += 1; if (String(r.user_id) === selfId) g.mine = true;
                groups.set(r.emoji, g);
            });
            return `<div class="cw-reacts">${[...groups].map(([e, g]) => `<button type="button" class="cw-react ${g.mine ? 'mine' : ''}" data-react="${esc(e)}" data-id="${m.id}" aria-label="${esc(e)} ${g.n}">${esc(e)}${g.n > 1 ? ' ' + g.n : ''}</button>`).join('')}</div>`;
        }
        function docHtml(m) {
            if (!m.document_id || m.deleted) return '';
            const ext = ((m.document_name || '').match(/\.([a-z0-9]+)$/i) || [, 'DOC'])[1].toUpperCase().slice(0, 4);
            return `<div class="cw-doc"><span class="cw-doc-ico">${esc(ext)}</span><div class="cw-doc-info"><b>${esc(m.document_name || 'Document')}</b><small>${esc(sizeOf(m.document_size))}</small></div><button type="button" data-download="${m.document_id}" data-name="${esc(m.document_name || 'document')}">Download</button></div>`;
        }
        function quoteHtml(m) {
            if (!m.parent || m.deleted) return '';
            const who = String(m.parent.sender_id) === selfId ? 'You' : (m.parent.sender_name || other);
            return `<button type="button" class="cw-quote" data-goto="${m.parent.id}"><strong>${esc(who)}</strong><span>${esc(m.parent.deleted ? DELETED_TEXT : m.parent.body)}</span></button>`;
        }
        function rowHtml(m, prev) {
            const mine = mineOf(m);
            const newGroup = !prev || String(prev.sender_id) !== String(m.sender_id) || dayOf(prev.created_at) !== dayOf(m.created_at);
            const name = !mine && newGroup ? `<div class="cw-name">${esc(m.sender_name || other)}</div>` : '';
            const bubbleClass = `cw-bubble${m.deleted ? ' deleted' : ''}${m.kind === 'DOCUMENT_REQUEST' ? ' request' : ''}`;
            const body = m.deleted ? `🚫 ${DELETED_TEXT}` : esc(m.body);
            return `<div class="cw-row ${mine ? 'mine' : 'theirs'}${newGroup ? ' gap' : ''}" data-id="${m.id}">
                ${name}
                <div class="${bubbleClass}">
                    ${m.deleted ? '' : `<button type="button" class="cw-more" data-more="${m.id}" aria-label="Message options">⌄</button>`}
                    ${quoteHtml(m)}${docHtml(m)}${body}
                    <div class="cw-meta"><span>${esc(timeOf(m.created_at))}</span>${tickHtml(m)}</div>
                </div>
                ${reactionsHtml(m)}
            </div>`;
        }
        function render(keepScroll) {
            const stick = !keepScroll || nearBottom();
            const prevTop = threadEl.scrollTop;
            if (!state.messages.length) {
                threadEl.innerHTML = '<div class="cw-empty"><strong>No messages yet.</strong><div>Write below to start the conversation.</div></div>';
                return;
            }
            let html = ''; let lastDay = '';
            state.messages.forEach((m, i) => {
                const d = dayOf(m.created_at);
                if (d !== lastDay) { html += `<div class="cw-day">${esc(d)}</div>`; lastDay = d; }
                html += rowHtml(m, state.messages[i - 1] && dayOf(state.messages[i - 1].created_at) === d ? state.messages[i - 1] : null);
            });
            threadEl.innerHTML = html;
            if (stick) toBottom(); else threadEl.scrollTop = prevTop;
        }
        function patchRow(m) {            /* re-render one message without disturbing the scroll */
            const el = threadEl.querySelector(`.cw-row[data-id="${m.id}"]`);
            if (!el) return render(true);
            const i = state.messages.indexOf(m);
            const tmp = document.createElement('div');
            tmp.innerHTML = rowHtml(m, state.messages[i - 1] || null);
            el.replaceWith(tmp.firstElementChild);
        }

        /* ---------- data ---------- */
        async function load(initial) {
            try {
                const res = await opts.http(opts.paths.thread + '?limit=200');
                state.messages = (res.data && res.data.messages) || [];
                render(!initial);
                if (initial) toBottom();
                markRead();
            } catch (err) {
                if (err && err.status === 401) { window.location.replace(opts.loginUrl || '/frontend/login.html'); return; }
                threadEl.innerHTML = `<div class="cw-empty"><strong>Could not load this conversation.</strong><div>${esc(err.message || 'Please try again.')}</div></div>`;
            }
        }
        let readBusy = false;
        async function markRead() {
            if (readBusy || document.visibilityState !== 'visible') return;
            if (!state.messages.some((m) => !mineOf(m) && !m.read_at && !m.deleted)) { opts.onActivity && opts.onActivity(); return; }
            readBusy = true;
            try {
                await opts.http(opts.paths.read, { method: 'POST' });
                state.messages.forEach((m) => { if (!mineOf(m)) m.read_at = m.read_at || new Date().toISOString(); });
                opts.onActivity && opts.onActivity();
            } catch { /* retried on the next event */ } finally { readBusy = false; }
        }

        /* ---------- sending ---------- */
        function setReply(m) {
            state.replyTo = m || null;
            if (!m) { replyBar.hidden = true; replyBar.innerHTML = ''; return; }
            const who = mineOf(m) ? 'You' : (m.sender_name || other);
            replyBar.hidden = false;
            replyBar.innerHTML = `<div><strong>Replying to ${esc(who)}</strong><span>${esc(m.deleted ? DELETED_TEXT : m.body)}</span></div><button type="button" aria-label="Cancel reply">×</button>`;
            replyBar.querySelector('button').addEventListener('click', () => setReply(null));
            input.focus();
        }
        function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; }
        function sendTyping(isTyping) {
            opts.http('/messages/typing', { method: 'POST', body: { conversationId: opts.conversationId, isTyping } }).catch(() => {});
        }
        input.addEventListener('input', () => {
            autosize();
            const now = Date.now();
            if (input.value.trim() && now - state.lastTypingSent > 2500) { state.lastTypingSent = now; sendTyping(true); }
            clearTimeout(state.typingOff);
            state.typingOff = setTimeout(() => { state.lastTypingSent = 0; sendTyping(false); }, 2500);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
            if (e.key === 'Escape' && state.replyTo) setReply(null);
        });
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const body = input.value.trim();
            if (!body) return;
            errorEl.textContent = '';
            sendBtn.disabled = true;
            clearTimeout(state.typingOff); state.lastTypingSent = 0; sendTyping(false);
            try {
                const res = await opts.http(opts.paths.send, { method: 'POST', body: { body, parentMessageId: state.replyTo ? state.replyTo.id : undefined } });
                const msg = res.data;
                if (msg && !byId(msg.id)) {
                    msg.sender_id = msg.sender_id || selfId;
                    state.messages.push(msg);
                    render(false);
                }
                input.value = ''; autosize(); setReply(null);
                opts.onActivity && opts.onActivity();
            } catch (err) {
                if (err && err.code === 'WAIT_FOR_FIRM') { setCanWrite(false); }
                else errorEl.textContent = 'Message not sent. ' + (err && err.message ? err.message : 'Please try again.');
            } finally { sendBtn.disabled = false; input.focus(); }
        });

        /* ---------- message menu, reactions, delete ---------- */
        let menuEl = null;
        function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
        function openMenu(m, anchor, point) {
            closeMenu();
            const mine = mineOf(m);
            menuEl = document.createElement('div');
            menuEl.className = 'cw-menu';
            menuEl.setAttribute('role', 'menu');
            menuEl.innerHTML = `
                <div class="cw-menu-emoji">${EMOJIS.map((e) => `<button type="button" data-emoji="${e}" aria-label="React ${e}">${e}</button>`).join('')}</div>
                <button type="button" class="cw-menu-item" data-act="reply" role="menuitem">Reply</button>
                <button type="button" class="cw-menu-item" data-act="copy" role="menuitem">Copy text</button>
                <button type="button" class="cw-menu-item danger" data-act="delete" role="menuitem">Delete…</button>`;
            document.body.appendChild(menuEl);
            const r = point ? { left: point.x, bottom: point.y, right: point.x } : anchor.getBoundingClientRect();
            const w = menuEl.offsetWidth, h = menuEl.offsetHeight;
            let left = Math.min(Math.max(8, (mine ? r.right - w : r.left)), window.innerWidth - w - 8);
            let top = r.bottom + 4; if (top + h > window.innerHeight - 8) top = Math.max(8, r.bottom - h - 30);
            menuEl.style.left = left + 'px'; menuEl.style.top = top + 'px';
            menuEl.addEventListener('click', (e) => {
                const emojiBtn = e.target.closest('[data-emoji]');
                if (emojiBtn) { closeMenu(); toggleReaction(m, emojiBtn.dataset.emoji); return; }
                const act = e.target.closest('[data-act]');
                if (!act) return;
                closeMenu();
                if (act.dataset.act === 'reply') setReply(m);
                if (act.dataset.act === 'copy') { try { navigator.clipboard.writeText(m.body || ''); } catch { /* ignore */ } }
                if (act.dataset.act === 'delete') askDelete(m);
            });
        }
        document.addEventListener('click', onDocClick);
        function onDocClick(e) { if (menuEl && !menuEl.contains(e.target) && !e.target.closest('.cw-more')) closeMenu(); }
        document.addEventListener('keydown', onDocKey);
        function onDocKey(e) { if (e.key === 'Escape') closeMenu(); }

        async function toggleReaction(m, emoji) {
            const has = (m.reactions || []).some((r) => r.emoji === emoji && String(r.user_id) === selfId);
            const before = m.reactions ? m.reactions.slice() : [];
            m.reactions = has ? before.filter((r) => !(r.emoji === emoji && String(r.user_id) === selfId)) : [...before, { emoji, user_id: selfId }];
            patchRow(m);
            try {
                if (has) await opts.http(`/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`, { method: 'DELETE' });
                else await opts.http(`/messages/${m.id}/reactions`, { method: 'POST', body: { emoji } });
            } catch (err) { m.reactions = before; patchRow(m); errorEl.textContent = err.message || 'Could not react.'; }
        }
        function askDelete(m) {
            const back = document.createElement('div');
            back.className = 'cw-dialog-back';
            const canAll = mineOf(m) && !m.deleted;
            back.innerHTML = `<div class="cw-dialog" role="dialog" aria-modal="true" aria-label="Delete message">
                <h4>Delete message?</h4>
                <p>${canAll ? 'You can remove it just for you, or for everyone in this conversation.' : 'This removes it from your view only. The other side keeps it.'}</p>
                <div class="actions">
                    ${canAll ? '<button type="button" class="danger" data-scope="everyone">Delete for everyone</button>' : ''}
                    <button type="button" data-scope="me">Delete for me</button>
                    <button type="button" data-scope="cancel">Cancel</button>
                </div></div>`;
            document.body.appendChild(back);
            const done = () => back.remove();
            back.addEventListener('click', async (e) => {
                if (e.target === back) return done();
                const b = e.target.closest('[data-scope]'); if (!b) return;
                const scope = b.dataset.scope;
                if (scope === 'cancel') return done();
                b.disabled = true;
                try {
                    await opts.http(`/messages/${m.id}?scope=${scope}`, { method: 'DELETE' });
                    applyDeleted(m.id, scope);
                    done();
                } catch (err) { done(); errorEl.textContent = err.message || 'Could not delete the message.'; }
            });
        }
        function applyDeleted(id, scope) {
            const m = byId(id); if (!m) return;
            if (scope === 'me') { state.messages = state.messages.filter((x) => x.id !== id); if (state.replyTo && state.replyTo.id === id) setReply(null); render(true); return; }
            m.deleted = true; m.body = ''; m.reactions = []; m.document_id = null;
            state.messages.forEach((x) => { if (x.parent && x.parent.id === id) x.parent = { ...x.parent, deleted: true, body: DELETED_TEXT }; });
            if (state.replyTo && state.replyTo.id === id) setReply(null);
            render(true);
        }

        /* ---------- clicks inside the thread ---------- */
        threadEl.addEventListener('click', async (e) => {
            const more = e.target.closest('[data-more]');
            if (more) { const m = byId(more.dataset.more); if (m) openMenu(m, more); return; }
            const react = e.target.closest('[data-react]');
            if (react) { const m = byId(react.dataset.id); if (m) toggleReaction(m, react.dataset.react); return; }
            const go = e.target.closest('[data-goto]');
            if (go) {
                const el = threadEl.querySelector(`.cw-row[data-id="${go.dataset.goto}"]`);
                if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1300); }
                return;
            }
            const dl = e.target.closest('[data-download]');
            if (dl) { download(dl.dataset.download, dl.dataset.name, dl); }
        });
        threadEl.addEventListener('contextmenu', (e) => {
            const row = e.target.closest('.cw-row'); if (!row) return;
            const m = byId(row.dataset.id); if (!m || m.deleted) return;
            e.preventDefault(); openMenu(m, row, { x: e.clientX, y: e.clientY });
        });
        let pressTimer = null;                       /* long-press on phones */
        threadEl.addEventListener('touchstart', (e) => {
            const row = e.target.closest('.cw-row'); if (!row) return;
            const t = e.touches[0];
            pressTimer = setTimeout(() => { const m = byId(row.dataset.id); if (m && !m.deleted) openMenu(m, row, { x: t.clientX, y: t.clientY }); }, 520);
        }, { passive: true });
        ['touchend', 'touchmove', 'touchcancel'].forEach((ev) => threadEl.addEventListener(ev, () => clearTimeout(pressTimer), { passive: true }));

        async function download(documentId, name, btn) {
            if (btn) btn.disabled = true;
            try {
                const path = (opts.downloadPath ? opts.downloadPath(documentId) : `/documents/${encodeURIComponent(documentId)}/download`);
                const res = await fetch(opts.apiBase + path, { headers: { Authorization: 'Bearer ' + opts.token() } });
                if (!res.ok) throw new Error('Download failed (' + res.status + ')');
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = name || 'document';
                document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
            } catch (err) { errorEl.textContent = err.message || 'Could not download the document.'; }
            finally { if (btn) btn.disabled = false; }
        }

        /* ---------- live events ---------- */
        function showTyping(name, on) {
            clearTimeout(state.typingTimer);
            if (!on) { typingEl.innerHTML = ''; return; }
            typingEl.innerHTML = `${esc(name || other)} is typing <i></i><i></i><i></i>`;
            state.typingTimer = setTimeout(() => { typingEl.innerHTML = ''; }, 4500);
        }
        async function refreshReactions(messageId) {
            const m = byId(messageId); if (!m) return;
            try { const res = await opts.http(`/messages/${messageId}/reactions`); m.reactions = res.data || []; patchRow(m); } catch { /* ignore */ }
        }
        function onEvent(evt) {
            let data; try { data = JSON.parse(evt.data); } catch { return; }
            if (data.conversationId && data.conversationId !== opts.conversationId) return;
            switch (data.type) {
                case 'message.created': {
                    const m = data.message; if (!m || byId(m.id)) return;
                    state.messages.push({ ...m, reactions: [], read_at: null });
                    if (opts.firmFirst && String(m.sender_id) !== selfId) setCanWrite(true);
                    showTyping(null, false);
                    render(true);
                    markRead();
                    break;
                }
                case 'message.read': {
                    state.messages.forEach((m) => { if (mineOf(m) && (!data.messageId || data.messageId === m.id)) m.status = 'read'; });
                    render(true); break;
                }
                case 'message.delivered': {
                    state.messages.forEach((m) => { if (mineOf(m) && (m.status === 'sent' || !m.status) && (!data.messageId || data.messageId === m.id)) m.status = 'delivered'; });
                    render(true); break;
                }
                case 'message.typing': showTyping(data.userName, data.isTyping); break;
                case 'message.reaction_added': case 'message.reaction_removed': refreshReactions(data.messageId); break;
                case 'message.deleted': applyDeleted(data.messageId, data.scope === 'me' ? 'me' : 'everyone'); break;
                default: break;
            }
        }
        function connect() {
            if (!window.EventSource || state.destroyed) return;
            const es = new EventSource(`${opts.apiBase}/events?token=${encodeURIComponent(opts.token())}`);
            state.es = es;
            es.onmessage = onEvent;
            es.onopen = () => { if (state.esOpenedBefore) load(false); state.esOpenedBefore = true; };
        }
        connect();
        /* Safety net if the live connection is down: refresh every 10 seconds. */
        state.pollTimer = setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            if (!state.es || state.es.readyState !== 1) load(false);
        }, 10000);
        const onVisible = () => { if (document.visibilityState === 'visible') { markRead(); } };
        document.addEventListener('visibilitychange', onVisible);

        load(true);

        return {
            reload: () => load(false),
            destroy() {
                state.destroyed = true;
                if (state.es) state.es.close();
                clearInterval(state.pollTimer); clearTimeout(state.typingTimer); clearTimeout(state.typingOff);
                document.removeEventListener('click', onDocClick);
                document.removeEventListener('keydown', onDocKey);
                document.removeEventListener('visibilitychange', onVisible);
                closeMenu();
                container.innerHTML = '';
            }
        };
    }

    window.ChatWidget = { mount };
})();
