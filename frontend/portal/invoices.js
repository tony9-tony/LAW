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
                        <tr class="row-link" data-href="invoices.html?id=${inv.id}">
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
            const isPaid = (inv.payment_status || '').toUpperCase() === 'PAID';
            const paymentStatusLabel = isPaid ? 'Paid' : (inv.payment_status || 'unpaid');
            // Use snapshotted payment destination from invoice if available, otherwise fall back to dynamic
            const hasSnapshot = !!(inv.payment_lipa_number || inv.payment_bank_name || inv.payment_qr_storage_key);
            const paymentMethod = inv.payment_destination_method || '';
            const paymentLabel = inv.payment_destination_label || '';
            const lipaNumber = inv.payment_lipa_number || '';
            const bankName = inv.payment_bank_name || '';
            const bankAccountName = inv.payment_bank_account_name || '';
            const bankAccountNumber = inv.payment_bank_account_number || '';
            const qrStorageKey = inv.payment_qr_storage_key || '';
            const qrContentType = inv.payment_qr_content_type || '';
            const paymentInstructions = inv.payment_instructions || 'No payment instructions available.';
            
            root.innerHTML = `
                <div class="detail-grid">
                    <div>
                        <section class="panel">
                            <div class="panel-head"><h2>Invoice</h2><span class="panel-meta">#${String(inv.id).padStart(5, '0')}</span></div>
                            <div class="panel-body">
                                <dl class="detail-meta">
                                    <dt>Matter</dt><dd><a class="link-bronze" href="${escape(matterHref)}">${escape(inv.matter_reference || '—')}${inv.matter_title ? ' · ' + escape(inv.matter_title) : ''}</a></dd>
                                    <dt>Status</dt><dd>${P.statusPill(inv.status)}</dd>
                                    <dt>Payment</dt><dd><span class="pill ${isPaid ? 'status-open' : 'status-new'}">${escape(paymentStatusLabel)}</span></dd>
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
                        ${!isPaid ? `
                        <section class="panel" id="payment-section">
                            <div class="panel-head"><h2>Pay This Invoice</h2><span class="panel-meta">Submit a payment using one of the firm's accepted methods</span></div>
                            <div class="panel-body">
                                <form id="pay-form" novalidate>
                                    <div class="field">
                                        <label for="pay-method">Payment method</label>
                                        <select id="pay-method" name="method" required></select>
                                    </div>
                                    <div class="field">
                                        <label for="pay-reference">Reference / Note (optional)</label>
                                        <input id="pay-reference" name="reference" type="text" placeholder="e.g. M-Pesa transaction ID" maxlength="200">
                                    </div>
                                    <div class="field">
                                        <label for="pay-receipt"><img src="../assets/paperclip.svg" alt="" class="input-icon">Receipt image</label>
                                        <input id="pay-receipt" name="receipt" type="file" accept="image/*" required>
                                        <span class="help">Upload a screenshot or photo of your payment confirmation.</span>
                                    </div>
                                    <div class="form-status" id="pay-status" role="status" aria-live="polite"></div>
                                    <div class="actions" style="display:flex;gap:0.75rem;justify-content:flex-end;">
                                        <button type="submit" class="btn primary">Submit payment</button>
                                    </div>
                                </form>
                            </div>
                        </section>
                        ` : ''}
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
                        ${!isPaid ? `
                        <section class="panel" id="instructions-panel">
                            <div class="panel-head"><h2>Payment Instructions</h2></div>
                            <div class="panel-body">
                                ${hasSnapshot ? `
                                    <div class="payment-details">
                                        ${paymentMethod ? `<div class="payment-method"><strong>Method:</strong> ${escape(paymentLabel || paymentMethod)}</div>` : ''}
                                        ${lipaNumber ? `<div class="payment-detail"><strong>Lipa Number:</strong> <code>${escape(lipaNumber)}</code></div>` : ''}
                                        ${bankName ? `<div class="payment-detail"><strong>Bank:</strong> ${escape(bankName)}</div>` : ''}
                                        ${bankAccountName ? `<div class="payment-detail"><strong>Account Name:</strong> ${escape(bankAccountName)}</div>` : ''}
                                        ${bankAccountNumber ? `<div class="payment-detail"><strong>Account Number:</strong> <code>${escape(bankAccountNumber)}</code></div>` : ''}
                                        ${qrStorageKey ? `<div class="payment-detail"><strong>QR Code:</strong><br><img src="${API.base()}/uploads/${escape(qrStorageKey)}?token=${API.token()}" alt="Payment QR Code" style="max-width:200px;max-height:200px;border:1px solid var(--line);border-radius:8px;"></div>` : ''}
                                        <div class="payment-detail"><strong>Instructions:</strong><pre class="instructions-text">${escape(paymentInstructions)}</pre></div>
                                    </div>
                                ` : `<pre class="instructions-text">${escape(paymentInstructions)}</pre>`}
                            </div>
                        </section>
                        ` : ''}
                    </aside>
                </div>
            `;
            const payForm = document.getElementById('pay-form');
            if (payForm) {
                initPaymentForm({
                    method: inv.payment_destination_method,
                    label: inv.payment_destination_label,
                    lipa_number: inv.payment_lipa_number,
                    bank_name: inv.payment_bank_name,
                    bank_account_name: inv.payment_bank_account_name,
                    bank_account_number: inv.payment_bank_account_number,
                    qr_storage_key: inv.payment_qr_storage_key,
                    id: inv.payment_destination_id
                });
            }
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

    async function initPaymentForm(snapshot) {
        const form = document.getElementById('pay-form');
        const methodSelect = document.getElementById('pay-method');
        const receiptInput = document.getElementById('pay-receipt');
        const statusEl = document.getElementById('pay-status');
        if (!form || !methodSelect) return;
        
        // Use snapshotted payment destination from invoice
        if (snapshot && snapshot.method) {
            const displayLabel = snapshot.label || snapshot.bank_name || snapshot.lipa_number || snapshot.method;
            methodSelect.innerHTML = `<option value="${escape(snapshot.method)}|${escape(snapshot.id || '')}">${escape(snapshot.method)} — ${escape(displayLabel)}</option>`;
        } else {
            // Fallback to dynamic destinations
            try {
                const res = await API.getPaymentDestinations();
                const dests = (res && res.data) || [];
                if (dests.length === 0) {
                    methodSelect.innerHTML = '<option value="">No payment methods configured</option>';
                } else {
                    methodSelect.innerHTML = dests.map((d) => `<option value="${escape(d.method)}|${escape(d.id)}">${escape(d.method)} — ${escape((d.label || d.bank_name || d.lipa_number || '').toString())}</option>`).join('');
                }
            } catch (err) {
                methodSelect.innerHTML = '<option value="">Could not load payment methods</option>';
            }
        }
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const file = receiptInput.files[0];
            if (!file) {
                statusEl.className = 'form-status error';
                statusEl.innerHTML = '<strong>Please upload a receipt image.</strong>';
                return;
            }
            const [method, destId] = methodSelect.value.split('|');
            statusEl.className = 'form-status';
            statusEl.textContent = 'Submitting payment…';
            const reader = new FileReader();
            reader.onload = async function () {
                const dataUrl = reader.result;
                try {
                    const payload = {
                        invoice_id: new URLSearchParams(location.search).get('id'),
                        method: method,
                        destination_id: destId,
                        reference_number: (document.getElementById('pay-reference').value || '').trim() || undefined,
                        message: '',
                        receipt: dataUrl
                    };
                    const res = await API.submitPayment(payload);
                    statusEl.className = 'form-status success';
                    statusEl.innerHTML = '<strong>Payment submitted.</strong> Your proof is under review. The firm will verify and notify you once confirmed.';
                    form.reset();
                    receiptInput.value = '';
                } catch (err) {
                    statusEl.className = 'form-status error';
                    statusEl.innerHTML = '<strong>Failed to submit payment.</strong>' + escape(err.message || '');
                }
            };
            reader.onerror = function () {
                statusEl.className = 'form-status error';
                statusEl.innerHTML = '<strong>Could not read receipt file.</strong>';
            };
            reader.readAsDataURL(file);
        });
    }

    load();
})();
