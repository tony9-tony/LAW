/* Public AI Support widget — floating button + compact chatbox. */
(function () {
    'use strict';
    if (window.AISupport) return;
    var API = '/api/v1/support';
    var state = { open: false, lang: 'en', greeted: false };
    var els = {};
    var ACTION_LINK = { book: 'login.html?next=consultation.html', request: 'login.html?next=custom-matter.html', contact: 'contact.html', faq: 'index.html#ai-faq', payments: 'how-it-works.html' };
    function build() {
        var host = document.createElement('div');
        host.id = 'ai-support';
        host.innerHTML =
            '<div id="ai-support-teaser" role="status" hidden><button type="button" class="ai-teaser-x" aria-label="Dismiss">&times;</button><strong>Need legal guidance?</strong><span>Ask our assistant — free, 24/7.</span></div>' +
            '<button type="button" id="ai-support-fab" aria-label="Open AI Support chat" aria-expanded="false" aria-controls="ai-support-panel">' +
            '<span class="ai-fab-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><circle cx="8" cy="11" r="1.3" fill="#fff"/><circle cx="12" cy="11" r="1.3" fill="#fff"/><circle cx="16" cy="11" r="1.3" fill="#fff"/></svg><i class="ai-fab-online"></i></span>' +
            '<span class="ai-fab-text"><b>Ask AI Support</b><small>Online now</small></span>' +
            '</button>' +
            '<section id="ai-support-panel" role="dialog" aria-modal="false" aria-label="AI Support chat" hidden>' +
            '<header class="ai-head"><div><strong>AI Support</strong><span class="ai-sub">Guidance only — not a lawyer</span></div>' +
            '<button type="button" id="ai-support-close" aria-label="Close chat">&times;</button></header>' +
            '<div id="ai-support-log" role="log" aria-live="polite"></div>' +
            '<div id="ai-support-actions" aria-label="Quick actions"></div>' +
            '<form id="ai-support-form"><label class="sr-only" for="ai-support-input">Type your question</label>' +
            '<input id="ai-support-input" type="text" maxlength="2000" autocomplete="off" placeholder="Ask a question…" />' +
            '<button type="submit" aria-label="Send">Send</button></form>' +
            '</section>';
        document.body.appendChild(host);
        els.host = host;
        els.fab = host.querySelector('#ai-support-fab');
        els.panel = host.querySelector('#ai-support-panel');
        els.log = host.querySelector('#ai-support-log');
        els.actions = host.querySelector('#ai-support-actions');
        els.form = host.querySelector('#ai-support-form');
        els.input = host.querySelector('#ai-support-input');
        els.close = host.querySelector('#ai-support-close');
        els.teaser = host.querySelector('#ai-support-teaser');
        els.teaser.addEventListener('click', function (e) { if (e.target.classList.contains('ai-teaser-x')) { dismissTeaser(true); } else { open(); } });
        var seen = false; try { seen = sessionStorage.getItem('aiTeaser') === '1'; } catch (e) {}
        if (!seen) setTimeout(function () { if (!state.open) els.teaser.hidden = false; }, 4000);
        els.fab.addEventListener('click', toggle);
        els.close.addEventListener('click', close);
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.open) close(); });
        els.form.addEventListener('submit', onSubmit);
    }
    function dismissTeaser(remember) {
        if (!els.teaser) return;
        els.teaser.hidden = true;
        if (remember) { try { sessionStorage.setItem('aiTeaser', '1'); } catch (e) {} }
    }
    function toggle() { state.open ? close() : open(); }
    function open() {
        state.open = true;
        dismissTeaser(true);
        els.panel.hidden = false;
        els.host.classList.add('open');
        els.fab.setAttribute('aria-expanded', 'true');
        if (!state.greeted) { state.greeted = true; loadGreeting(); }
        setTimeout(function () { els.input.focus(); }, 60);
    }
    function close() {
        state.open = false;
        els.panel.hidden = true;
        els.host.classList.remove('open');
        els.fab.setAttribute('aria-expanded', 'false');
        els.fab.focus();
    }
    function bubble(who, text) {
        var d = document.createElement('div');
        d.className = 'ai-msg ai-' + who;
        d.textContent = text;
        els.log.appendChild(d);
        els.log.scrollTop = els.log.scrollHeight;
    }
    function typing(on) {
        var t = els.log.querySelector('.ai-typing');
        if (on && !t) { t = document.createElement('div'); t.className = 'ai-msg ai-bot ai-typing'; t.textContent = '…'; els.log.appendChild(t); }
        if (!on && t) t.remove();
        els.log.scrollTop = els.log.scrollHeight;
    }
    function renderActions(actions) {
        els.actions.innerHTML = '';
        (actions || []).forEach(function (a) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'ai-action';
            b.textContent = a.label;
            b.addEventListener('click', function () { onAction(a.id); });
            els.actions.appendChild(b);
        });
    }
    async function get(url) {
        var r = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error('request failed');
        return r.json();
    }
    async function loadGreeting() {
        try {
            var d = await get(API + '/greeting?lang=' + state.lang);
            bubble('bot', d.data.reply);
            renderActions(d.data.actions);
        } catch (e) { bubble('bot', 'Hello! How can I help you today?'); }
    }
    async function onAction(id) {
        if (id === 'faq') {
            bubble('user', state.lang === 'sw' ? 'Maswali' : 'FAQ');
            try {
                var d = await get(API + '/faq?lang=' + state.lang);
                bubble('bot', state.lang === 'sw' ? 'Haya ni maswali yanayoulizwa mara kwa mara:' : 'Here are common questions:');
                var wrap = document.createElement('div');
                wrap.className = 'ai-faq-list';
                d.data.faq.forEach(function (f) {
                    var b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'ai-faq-item';
                    b.textContent = f.q;
                    b.addEventListener('click', function () { askFaq(f.id, f.q); });
                    wrap.appendChild(b);
                });
                els.log.appendChild(wrap);
                els.log.scrollTop = els.log.scrollHeight;
            } catch (e) { bubble('bot', 'Sorry — the FAQ list is unavailable right now.'); }
            return;
        }
        var map = { book: 'login.html?next=consultation.html', request: 'login.html?next=custom-matter.html', contact: 'contact.html', payments: 'how-it-works.html' };
        if (map[id]) window.location.href = map[id];
    }
    async function askFaq(id, q) {
        bubble('user', q);
        typing(true);
        try {
            var d = await get(API + '/faq/' + encodeURIComponent(id) + '?lang=' + state.lang);
            typing(false);
            bubble('bot', d.data.reply);
        } catch (e) { typing(false); bubble('bot', 'Sorry — that answer is unavailable right now.'); }
    }
    async function onSubmit(e) {
        e.preventDefault();
        var text = els.input.value.trim();
        if (!text) return;
        els.input.value = '';
        bubble('user', text);
        typing(true);
        try {
            var r = await fetch(API + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ message: text }) });
            var d = await r.json();
            if (!r.ok) throw new Error('request failed');
            typing(false);
            if (d.data.lang) state.lang = d.data.lang;
            bubble('bot', d.data.reply);
        } catch (err) {
            typing(false);
            bubble('bot', 'Sorry — I could not reach the support service. Please try again, or use Contact Office.');
        }
    }
    window.AISupport = { open: open, close: close, toggle: toggle };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
})();
