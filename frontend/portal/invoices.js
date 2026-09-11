/* Portal — invoices. */
(function () {
    'use strict';
    if (!window.Site || !window.Portal || !window.Portal.guard()) return;
    const API = window.Site.API;
    const P = window.Portal;

    function escape(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
    function fmtCurrency(amount, currency) {
        if (amount == null) return '—';
        try {
            const n = Number(amount);
            if (Number.isNaN(n)) return String(amount);
            return new Intl.NumberFormat('en-TZ', { style: 'currency', currency: (currency || 'TZS').toUpperCase() }).format(n);
        } catch (e) { return String(amount); }
    }
    function fmtDateShort(s) {
        if (!s) return '—';
        try { return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return s; }
    }
    function fmtDate(s) {
        if (!s) return '—';
        try { return new Date(s).toLocaleString(); } catch (e) { return s; }
    }

    async function loadList() {
        const root = document.getElementById('invoices-root');
        const meta = document.getElementById('invoices-meta');
        if (!root) return;
        root.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading invoices…</strong></div>';
        if (meta) meta.textContent = 'Loading…';
        try {
            const res = await API.listInvoices();
            const items = (res && res.data) || [];
            if (!items.length) {
                root.innerHTML = `
                    <div class="empty-state">
                        <span class="ico">·</span>
                        <strong>No invoices yet.</strong>
                        <p>Invoices are generated for accepted matters. Once the firm opens a matter and issues billing, records will appear here.</p>
                    </div>`;
                if (meta) meta.textContent = '0 invoices';
                return;
            }
            if (meta) meta.textContent = items.length + ' invoice' + (items.length === 1 ? '' : 's');
            root.innerHTML = `
                <table class="requests-table">
                    <thead>
                        <tr>
                            <th class="col-ref">Invoice</th>
                            <th>Matter</th>
                            <th class="col-status-140">Status</th>
                            <th class="col-date-140">Issued</th>
                            <th class="col-date-140">Due</th>
                            <th style="text-align:right;">Total</th>
                        </tr>
                    </thead>
                    <tbody>${items.map((inv) => `
                        <tr class="row-link" onclick="window.location.href='invoices.html?id=${inv.id}'">
                            <td><span class="ref">#${String(inv.id).padStart(5, '0')}</span></td>
                            <td class="subj"><strong>${escape(inv.matter_reference || '—')}</strong>${inv.matter_title ? ' · ' + escape(inv.matter_title) : ''}</td>
                            <td>${P.statusPill(inv.status)}</td>
                            <td class="muted">${fmtDateShort(inv.issued_at)}</td>
                            <td class="muted">${fmtDateShort(inv.due_at)}</td>
                            <td style="text-align:right;font-family:var(--mono);font-size:0.88rem;">${fmtCurrency(inv.total, inv.currency)}</td>
                        </tr>
                    `).join('')}</tbody>
                </table>`;
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            root.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load invoices.</strong><p>${escape(err.message || 'Please try again shortly.')}</p></div>`;
            if (meta) meta.textContent = 'Error';
        }
    }

    async function loadDetail(id) {
        const root = document.getElementById('invoices-root');
        const meta = document.getElementById('invoices-meta');
        if (!root) return;
        root.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading invoice…</strong></div>';
        if (meta) meta.textContent = 'Loading…';
        try {
            const [invRes, itemsRes] = await Promise.all([
                API.getInvoice(id),
                API.getInvoiceItems(id).catch(() => ({ data: [] }))
            ]);
            const inv = invRes.data || {};
            const items = (itemsRes && itemsRes.data) || [];
            if (meta) meta.textContent = 'Invoice #' + String(inv.id).padStart(5, '0');
            const matterHref = inv.matter_id ? `matter.html?id=${inv.matter_id}` : '#';
            root.innerHTML = `
                <div class="detail-grid">
                    <div>
                        <section class="panel">
                            <div class="panel-head"><h2>Invoice</h2><span class="panel-meta">#${String(inv.id).padStart(5, '0')}</span></div>
                            <div class="panel-body">
                                <dl class="detail-meta">
                                    <dt>Matter</dt><dd><a class="link-bronze" href="${escape(matterHref)}">${escape(inv.matter_reference || '—')}${inv.matter_title ? ' · ' + escape(inv.matter_title) : ''}</a></dd>
                                    <dt>Status</dt><dd>${P.statusPill(inv.status)}</dd>
                                    <dt>Issued</dt><dd>${fmtDate(inv.issued_at)}</dd>
                                    <dt>Due</dt><dd>${fmtDate(inv.due_at)}</dd>
                                    <dt>Paid</dt><dd>${inv.paid_at ? fmtDate(inv.paid_at) : '—'}</dd>
                                    <dt>Currency</dt><dd>${escape((inv.currency || 'TZS').toUpperCase())}</dd>
                                </dl>
                            </div>
                        </section>
                        <section class="panel">
                            <div class="panel-head"><h2>Line items</h2></div>
                            <div class="panel-body tight">
                                ${items.length === 0
                                    ? '<div class="empty-state tight"><span class="ico">·</span><strong>No line items.</strong></div>'
                                    : `<table class="requests-table">
                                        <thead><tr><th>Description</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Unit price</th><th style="text-align:right;">Amount</th></tr></thead>
                                        <tbody>${items.map((it) => `
                                            <tr>
                                                <td class="subj">${escape(it.description || '—')}</td>
                                                <td style="text-align:right;font-family:var(--mono);font-size:0.88rem;">${escape(String(it.quantity || ''))}</td>
                                                <td style="text-align:right;font-family:var(--mono);font-size:0.88rem;">${fmtCurrency(it.unit_price, inv.currency)}</td>
                                                <td style="text-align:right;font-family:var(--mono);font-size:0.88rem;">${fmtCurrency(it.amount, inv.currency)}</td>
                                            </tr>
                                        `).join('')}</tbody>
                                    </table>`
                                }
                            </div>
                        </section>
                    </div>
                    <aside>
                        <section class="panel">
                            <div class="panel-head"><h2>Summary</h2></div>
                            <div class="panel-body">
                                <dl class="detail-meta">
                                    <dt>Subtotal</dt><dd style="font-family:var(--mono);">${fmtCurrency(inv.subtotal, inv.currency)}</dd>
                                    <dt>Tax</dt><dd style="font-family:var(--mono);">${fmtCurrency(inv.tax, inv.currency)}</dd>
                                    <dt>Total</dt><dd style="font-family:var(--mono);font-weight:500;">${fmtCurrency(inv.total, inv.currency)}</dd>
                                </dl>
                                <div style="margin-top:1.25rem;" class="empty-actions">
                                    <a class="btn secondary" href="invoices.html">← All invoices</a>
                                </div>
                            </div>
                        </section>
                    </aside>
                </div>
            `;
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            root.innerHTML = `<div class="alert error"><strong>Could not load this invoice.</strong>${escape(err.message || '')}</div>`;
        }
    }

    async function load() {
        const id = new URLSearchParams(location.search).get('id');
        if (id) {
            await loadDetail(id);
        } else {
            await loadList();
        }
    }

    load();
})();
