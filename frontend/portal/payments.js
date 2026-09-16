/* Portal — payments history. */
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
    function fmtDate(s) {
        if (!s) return '—';
        try { return new Date(s).toLocaleString(); } catch (e) { return s; }
    }

    async function loadList() {
        const root = document.getElementById('payments-root');
        const meta = document.getElementById('payments-meta');
        if (!root) return;
        root.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading payments…</strong></div>';
        if (meta) meta.textContent = 'Loading…';
        try {
            const res = await API.listPayments();
            const items = (res && res.data) || [];
            if (!items.length) {
                root.innerHTML = `
                    <div class="empty-state">
                        <span class="ico">·</span>
                        <strong>No payments yet.</strong>
                        <p>Make a payment from any unpaid invoice to see a record here.</p>
                    </div>`;
                if (meta) meta.textContent = '0 payments';
                return;
            }
            if (meta) meta.textContent = items.length + ' payment' + (items.length === 1 ? '' : 's');
            root.innerHTML = `
                <table class="requests-table">
                    <thead>
                        <tr>
                            <th class="col-ref">Payment</th>
                            <th>Invoice</th>
                            <th class="col-status-140">Status</th>
                            <th style="text-align:right;">Amount</th>
                            <th class="col-date-140">Submitted</th>
                            <th class="col-date-140">Verified</th>
                        </tr>
                    </thead>
                    <tbody>${items.map((p) => `
                        <tr class="row-link" data-href="payments.html?id=${p.id}">
                            <td><span class="ref">#${String(p.id).padStart(5, '0')}</span></td>
                            <td class="muted">#${p.invoice_id ? p.invoice_id.split('-')[0] : '—'}</td>
                            <td>${P.statusPill(p.status || 'pending')}</td>
                            <td style="text-align:right;font-family:var(--mono);font-size:0.88rem;">${fmtCurrency(p.amount, p.currency)}</td>
                            <td class="muted">${fmtDate(p.created_at)}</td>
                            <td class="muted">${fmtDate(p.verified_at || p.paid_at)}</td>
                        </tr>
                    `).join('')}</tbody>
                </table>
            `;
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            root.innerHTML = `<div class="empty-state"><span class="ico">!</span><strong>Could not load payments.</strong><p>${escape(err.message || 'Please try again shortly.')}</p></div>`;
            if (meta) meta.textContent = 'Error';
        }
    }

    async function loadDetail(id) {
        const root = document.getElementById('payments-root');
        const meta = document.getElementById('payments-meta');
        if (!root) return;
        root.innerHTML = '<div class="empty-state"><span class="ico">·</span><strong>Loading payment…</strong></div>';
        if (meta) meta.textContent = 'Loading…';
        try {
            const res = await fetch(window.Site.API.base() + '/payments/' + encodeURIComponent(id), {
                headers: { 'Authorization': 'Bearer ' + API.token() }
            });
            const text = await res.text();
            const data = text ? JSON.parse(text) : {};
            if (!res.ok) {
                throw new Error((data && data.error && data.error.message) || ('HTTP ' + res.status));
            }
            const p = data.data || {};
            if (meta) meta.textContent = 'Payment #' + String(p.id).padStart(5, '0');
            root.innerHTML = `
                <div class="detail-grid">
                    <div>
                        <section class="panel">
                            <div class="panel-head"><h2>Payment</h2><span class="panel-meta">#${String(p.id).padStart(5, '0')}</span></div>
                            <div class="panel-body">
                                <dl class="detail-meta">
                                    <dt>Invoice</dt><dd>#${escape(p.invoice_id ? p.invoice_id.split('-')[0] : '—')}</dd>
                                    <dt>Status</dt><dd>${P.statusPill(p.status || 'pending')}</dd>
                                    <dt>Amount</dt><dd>${fmtCurrency(p.amount, p.currency)}</dd>
                                    <dt>Method</dt><dd>${escape(p.method || '—')}</dd>
                                    <dt>Reference</dt><dd>${escape(p.reference || '—')}</dd>
                                    <dt>Submitted</dt><dd>${fmtDate(p.created_at)}</dd>
                                    <dt>Verified</dt><dd>${fmtDate(p.verified_at || '—')}</dd>
                                    <dt>Receipt</dt><dd>${p.receipt_storage_key ? `<a href="${API.base()}/payments/${encodeURIComponent(p.id)}/receipt?token=${API.token()}" target="_blank">View receipt</a>` : '—'}</dd>
                                    ${p.note ? `<dt>Note</dt><dd>${escape(p.note)}</dd>` : ''}
                                </dl>
                            </div>
                        </section>
                    </div>
                    <aside>
                        <section class="panel">
                            <div class="panel-head"><h2>Actions</h2></div>
                            <div class="panel-body">
                                <div class="actions">
                                    <a class="btn secondary" href="payments.html">← All payments</a>
                                </div>
                            </div>
                        </section>
                    </aside>
                </div>
            `;
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            root.innerHTML = `<div class="alert error"><strong>Could not load this payment.</strong>${escape(err.message || '')}</div>`;
            if (meta) meta.textContent = 'Error';
        }
    }

    function load() {
        const id = new URLSearchParams(location.search).get('id');
        if (id) {
            loadDetail(id);
        } else {
            loadList();
        }
    }

    load();
})();
