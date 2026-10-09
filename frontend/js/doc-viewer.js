/* In-app viewer for documents and pictures (client portal and owner centre).
   Opens over the current page - never a new tab - on an A4-sized sheet
   (210 x 297 mm, scaled down on small screens). Long documents scroll inside
   the overlay. PDFs and pictures are shown; other files offer Download.

   window.DocViewer.open({ url, headers, name, type })   fetches then shows
   window.DocViewer.openBlob(blob, { name, type })        shows a file already fetched */
(function () {
    'use strict';
    if (window.DocViewer) return;

    const A4_RATIO = 297 / 210;
    const SHOWABLE = /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/i;
    const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    const ICON_DOWN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';

    const css = `
.dv-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(10,16,22,.82);display:flex;flex-direction:column;animation:dv-in .15s ease}
@keyframes dv-in{from{opacity:0}to{opacity:1}}
.dv-bar{flex:0 0 auto;display:flex;align-items:center;gap:.75rem;padding:.7rem 1rem;background:#0f1a24;color:#fff;box-shadow:0 2px 12px rgba(0,0,0,.35)}
.dv-name{flex:1 1 auto;min-width:0;font:600 .95rem/1.3 system-ui,-apple-system,'Segoe UI',sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dv-btn{display:inline-flex;align-items:center;gap:.4rem;border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;border-radius:6px;padding:.45rem .8rem;font:600 .8rem system-ui,sans-serif;cursor:pointer;text-decoration:none}
.dv-btn:hover,.dv-btn:focus-visible{background:rgba(255,255,255,.12);outline:none}
.dv-btn.dv-close{padding:.45rem}
.dv-scroll{flex:1 1 auto;overflow:auto;padding:1.25rem 1rem 2rem;-webkit-overflow-scrolling:touch}
.dv-sheet{margin:0 auto;background:#fff;box-shadow:0 10px 40px rgba(0,0,0,.45);width:min(210mm,100%);min-height:calc(min(210mm,100vw - 2rem) * ${A4_RATIO});display:flex;align-items:flex-start;justify-content:center}
.dv-sheet img{display:block;width:100%;height:auto}
.dv-sheet iframe{display:block;border:0;width:100%;height:calc(min(210mm,100vw - 2rem) * ${A4_RATIO})}
.dv-msg{align-self:center;margin:auto;padding:2.5rem 1.5rem;text-align:center;font:1rem/1.6 system-ui,sans-serif;color:#23303b}
.dv-msg strong{display:block;font-size:1.1rem;margin-bottom:.4rem}
.dv-msg .dv-btn{color:#0f1a24;border-color:#0f1a24;margin-top:1rem}
.dv-loading{color:#fff;text-align:center;padding:3rem 1rem;font:1rem system-ui,sans-serif}
@media (max-width:600px){.dv-bar{padding:.6rem .7rem}.dv-btn span{display:none}.dv-scroll{padding:.75rem .5rem 1.5rem}}`;

    let current = null;

    function ensureStyle() {
        if (document.getElementById('dv-style')) return;
        const s = document.createElement('style');
        s.id = 'dv-style';
        s.textContent = css;
        document.head.appendChild(s);
    }

    function close() {
        if (!current) return;
        current.overlay.remove();
        if (current.url) URL.revokeObjectURL(current.url);
        document.removeEventListener('keydown', current.onKey);
        document.documentElement.style.overflow = current.prevOverflow;
        if (current.returnFocus && current.returnFocus.focus) current.returnFocus.focus();
        current = null;
    }

    function shell(name) {
        close();
        ensureStyle();
        const overlay = document.createElement('div');
        overlay.className = 'dv-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', name || 'Document');
        overlay.innerHTML = `<div class="dv-bar"><span class="dv-name"></span><a class="dv-btn dv-download" hidden>${ICON_DOWN}<span>Download</span></a><button type="button" class="dv-btn dv-close" aria-label="Close">${ICON_CLOSE}</button></div><div class="dv-scroll"><div class="dv-loading">Opening…</div></div>`;
        overlay.querySelector('.dv-name').textContent = name || 'Document';
        overlay.querySelector('.dv-close').addEventListener('click', close);
        overlay.querySelector('.dv-scroll').addEventListener('click', (e) => { if (e.target.classList.contains('dv-scroll')) close(); });
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', onKey);
        current = { overlay, onKey, url: null, prevOverflow: document.documentElement.style.overflow, returnFocus: document.activeElement };
        document.documentElement.style.overflow = 'hidden';
        document.body.appendChild(overlay);
        overlay.querySelector('.dv-close').focus();
        return overlay;
    }

    function guessType(name) {
        const ext = String(name || '').toLowerCase().split('.').pop();
        return { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[ext] || '';
    }

    function render(overlay, blob, name, type) {
        const scroll = overlay.querySelector('.dv-scroll');
        const kind = (SHOWABLE.test(type || '') ? type : '') || (SHOWABLE.test(blob.type || '') ? blob.type : '') || guessType(name);
        /* Only PDFs and pictures are drawn; the blob gets that safe type explicitly. */
        const url = URL.createObjectURL(SHOWABLE.test(kind) ? new Blob([blob], { type: kind }) : blob);
        current.url = url;
        const dl = overlay.querySelector('.dv-download');
        dl.href = url;
        dl.download = name || 'document';
        dl.hidden = false;
        const sheet = document.createElement('div');
        sheet.className = 'dv-sheet';
        if (/^image\//.test(kind)) {
            const img = document.createElement('img');
            img.alt = name || 'Picture';
            img.src = url;
            sheet.appendChild(img);
        } else if (kind === 'application/pdf') {
            const frame = document.createElement('iframe');
            frame.title = name || 'Document';
            frame.src = url + '#view=FitH';
            sheet.appendChild(frame);
        } else {
            sheet.innerHTML = '<div class="dv-msg"><strong>This file cannot be shown here.</strong>Word, Excel and other files open in their own program. Download it to open it.</div>';
            const btn = dl.cloneNode(true);
            btn.hidden = false;
            sheet.querySelector('.dv-msg').appendChild(btn);
        }
        scroll.innerHTML = '';
        scroll.appendChild(sheet);
    }

    function fail(overlay, message) {
        const scroll = overlay.querySelector('.dv-scroll');
        scroll.innerHTML = '<div class="dv-sheet"><div class="dv-msg"><strong>Could not open the file.</strong></div></div>';
        scroll.querySelector('.dv-msg').appendChild(document.createTextNode(message || 'Please try again.'));
    }

    async function open({ url, headers, name, type } = {}) {
        const overlay = shell(name);
        try {
            const res = await fetch(url, { headers: headers || {}, credentials: 'same-origin' });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error((data && data.error && data.error.message) || `The file could not be loaded (${res.status}).`);
            }
            const blob = await res.blob();
            if (current && current.overlay === overlay) render(overlay, blob, name, type);
        } catch (err) {
            if (current && current.overlay === overlay) fail(overlay, err.message);
        }
    }

    function openBlob(blob, { name, type } = {}) {
        const overlay = shell(name);
        render(overlay, blob, name, type);
    }

    window.DocViewer = { open, openBlob, close, canShow: (typeOrName) => SHOWABLE.test(typeOrName || '') || !!guessType(typeOrName) };
})();
