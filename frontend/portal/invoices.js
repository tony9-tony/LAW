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
                <div class="inv-table-wrap"><table class="requests-table inv-table">
                    <thead>
                        <tr>
                            <th class="col-ref">Invoice</th>
                            <th class="inv-hide-sm">Matter</th>
                            <th class="col-status-140">Status</th>
                            <th class="inv-hide-sm">Payment</th>
                            <th class="col-date-140 inv-hide-sm">Issued</th>
                            <th class="inv-total">Total</th>
                        </tr>
                    </thead>
                    <tbody>${items.map((inv) => `
                        <tr class="row-link" data-href="invoices.html?id=${inv.id}">
                            <td><span class="ref">#${P.shortRef(inv.id)}</span></td>
                            <td class="subj inv-hide-sm">${inv.matter_reference ? `<strong>${escape(inv.matter_reference)}</strong>${inv.matter_title ? ' · ' + escape(inv.matter_title) : ''}` : '<span class="muted">After payment</span>'}</td>
                            <td>${P.statusPill(inv.status)}</td>
                            <td class="inv-hide-sm">${inv.payment_status ? `<span class="pill ${inv.payment_status === 'PAID' ? 'status-open' : 'status-new'}">${escape(String(inv.payment_status).replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()))}</span>` : '<span class="muted">—</span>'}</td>
                            <td class="muted inv-hide-sm">${fmtDateShort(inv.issued_at || inv.created_at)}</td>
                            <td class="inv-total">${fmtCurrency(inv.total, inv.currency)}</td>
                        </tr>
                    `).join('')}</tbody>
                </table></div>`;
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
            const [invRes, itemsRes, destRes] = await Promise.all([
                API.getInvoice(id),
                API.getInvoiceItems(id).catch(() => ({ data: [] })),
                API.getPaymentDestinations().catch(() => ({ data: [] }))
            ]);
            const inv = invRes.data || {};
            const items = (itemsRes && itemsRes.data) || [];
            const destinations = ((destRes && destRes.data) || []).filter((d) => d.method === 'mobile_money' || (d.lipa_number && String(d.lipa_number).trim())); /* Lipa Namba is the only payment method */
            if (meta) meta.textContent = 'Invoice #' + P.shortRef(inv.id);
            const matterHref = inv.matter_id ? `matter.html?id=${inv.matter_id}` : '#';
            const isPaid = (inv.payment_status || '').toUpperCase() === 'PAID';
            const PAYMENT_LABELS = { PAYMENT_REQUIRED: 'Payment required', PAYMENT_PENDING_VERIFICATION: 'Awaiting verification', PAYMENT_REJECTED: 'Proof not accepted, please resubmit', PAID: 'Paid', UNPAID: 'Unpaid' };
            const paymentStatusLabel = isPaid ? 'Paid' : (PAYMENT_LABELS[String(inv.payment_status || 'UNPAID').toUpperCase()] || String(inv.payment_status).replace(/_/g, ' '));
            const awaitingVerification = String(inv.payment_status || '').toUpperCase() === 'PAYMENT_PENDING_VERIFICATION';
            // Use snapshotted payment destination from invoice if available, otherwise fall back to dynamic
            const hasSnapshot = !!(inv.payment_lipa_number || inv.payment_qr_storage_key);
            const paymentMethod = inv.payment_lipa_number ? 'mobile_money' : (inv.payment_destination_method === 'mobile_money' ? 'mobile_money' : '');
            const paymentLabel = inv.payment_destination_label || '';
            const lipaNumber = inv.payment_lipa_number || '';
            const qrStorageKey = inv.payment_qr_storage_key || '';
            const qrContentType = inv.payment_qr_content_type || '';
            const paymentInstructions = inv.payment_instructions || 'No payment instructions available.';
            const snapshotDestination = paymentMethod ? {
                id: inv.payment_destination_id,
                method: paymentMethod,
                label: paymentLabel,
                lipa_number: lipaNumber,
                qr_storage_key: qrStorageKey,
                qr_content_type: qrContentType,
                instructions: paymentInstructions
            } : null;
            const availableDestinations = destinations.length ? destinations : (snapshotDestination ? [snapshotDestination] : []);

            function methodLabel(method) {
                return 'LIPA NAMBA';
            }

            /* QR images are streamed from the authenticated uploads route; the
               token is required because payment assets are never served publicly. */
            function qrImageSrc(storageKey) {
                return storageKey ? `${API.base()}/uploads/${storageKey}?token=${encodeURIComponent(API.token())}` : '';
            }

            function destinationDetails(destination) {
                if (!destination) return '<p class="text-mute-block">No payment method selected.</p>';
                const method = destination.method;
                const instructions = destination.instructions ? `<p class="payment-instruction">${escape(destination.instructions)}</p>` : '';
                if (method === 'mobile_money' || destination.lipa_number) {
                    /* Show the QR uploaded by the admin for THIS Lipa Number in
                       Global Settings (same payment_destinations row), so the
                       number and its code are always displayed together. */
                    const qrBlock = destination.qr_storage_key
                        ? `<img src="${qrImageSrc(destination.qr_storage_key)}" alt="Payment QR code for this Lipa Number" class="payment-qr"><p class="payment-instruction">Scan this QR code with any mobile money or banking app, or use the Lipa Namba above.</p>`
                        : '';
                    return `<div class="selected-payment selected-payment--lipa"><span class="kicker">LIPA NAMBA</span><div class="payment-value-row"><code>${escape(destination.lipa_number || '—')}</code><button type="button" class="btn small secondary" data-copy-payment="${escape(destination.lipa_number || '')}">Copy</button></div><p class="payment-instruction"><strong>Pay from any mobile network or any bank</strong> using this Lipa Namba.</p>${instructions}${qrBlock}</div>`;
                }
                return '<p class="text-mute-block">Pay by Lipa Namba. No other method is available.</p>';
            }
            
            root.innerHTML = `
                <div class="detail-grid inv-detail">
                    <div class="inv-main">
                        <section class="panel">
                            <div class="panel-head"><h2>Invoice</h2><span class="panel-meta">#${P.shortRef(inv.id)}</span></div>
                            <div class="panel-body">
                                <dl class="detail-meta">
                                    <dt>Matter</dt><dd>${inv.matter_reference ? `<a class="link-bronze" href="${escape(matterHref)}">${escape(inv.matter_reference)}${inv.matter_title ? ' · ' + escape(inv.matter_title) : ''}</a>` : '<span class="text-soft">Opens once your payment is confirmed</span>'}</dd>
                                    <dt>Payment</dt><dd><span class="pill ${isPaid ? 'status-open' : 'status-new'}">${escape(paymentStatusLabel)}</span></dd>
                                    <dt>Issued</dt><dd>${fmtDateShort(inv.issued_at || inv.created_at)}</dd>
                                    <dt>Due</dt><dd>${fmtDateShort(inv.due_at)}</dd>
                                    <dt>Paid</dt><dd>${inv.paid_at ? fmtDateShort(inv.paid_at) : '—'}</dd>
                                    <dt>Currency</dt><dd>${escape((inv.currency || 'TZS').toUpperCase())}</dd>
                                </dl>
                            </div>
                        </section>
                        <section class="panel">
                            <div class="panel-head"><h2>Line items</h2></div>
                            <div class="panel-body tight">
                                ${items.length === 0
                                    ? '<div class="empty-state tight"><span class="ico">·</span><strong>No line items.</strong></div>'
                                    : `<table class="requests-table inv-items">
                                        <thead><tr><th>Description</th><th style="text-align:right;">Qty</th><th class="inv-hide-sm" style="text-align:right;">Unit price</th><th style="text-align:right;">Amount</th></tr></thead>
                                        <tbody>${items.map((it) => `
                                            <tr>
                                                <td class="subj">${escape(it.description || '—')}</td>
                                                <td style="text-align:right;font-family:var(--mono);font-size:0.88rem;">${escape(String(it.quantity || ''))}</td>
                                                <td class="inv-hide-sm" style="text-align:right;font-family:var(--mono);font-size:0.88rem;">${fmtCurrency(it.unit_price, inv.currency)}</td>
                                                <td style="text-align:right;font-family:var(--mono);font-size:0.88rem;">${fmtCurrency(it.amount, inv.currency)}</td>
                                            </tr>
                                        `).join('')}</tbody>
                                    </table>`
                                }
                            </div>
                        </section>
                        ${!isPaid ? `
                        <section class="panel" id="payment-section">
                            <div class="panel-head"><h2>Payment</h2><span class="panel-meta">Amount due ${fmtCurrency(inv.total, inv.currency)}</span></div>
                            <div class="panel-body">
                                ${awaitingVerification ? '<div class="alert info"><strong>Payment proof received.</strong> The firm is checking it. You will get a notification as soon as it is confirmed, and your matter will open.</div>' : availableDestinations.length ? `<button type="button" class="btn primary" id="pay-now">Pay Now</button>
                                <div id="payment-checkout" hidden>
                                    <div class="payment-method-choices" id="payment-method-choices" aria-label="Choose payment method">
                                        ${availableDestinations.map((d) => `<button type="button" class="payment-method-choice" data-method="${escape(d.method)}" data-destination-id="${escape(d.id || '')}"><span>${methodLabel(d.method)}</span><small>${escape(d.label || '')}</small></button>`).join('')}
                                    </div>
                                    <div id="selected-payment-details"></div>
                                    <form id="pay-form" novalidate hidden>
                                        <input type="hidden" id="pay-method" name="method">
                                        <input type="hidden" id="pay-destination-id" name="destination_id">
                                        <div class="field"><label for="pay-reference">Payment reference (optional)</label><input id="pay-reference" name="reference" type="text" maxlength="200" placeholder="Transaction reference"></div>
                                        <div class="field"><label for="pay-receipt">Payment proof</label><input id="pay-receipt" name="receipt" type="file" accept="image/*,application/pdf" required></div>
                                        <div class="form-status" id="pay-status" role="status" aria-live="polite"></div>
                                        <div class="actions"><button type="submit" class="btn primary">Submit payment proof</button></div>
                                    </form>
                                </div>` : '<div class="empty-state tight"><span class="ico">·</span><strong>Payment is not available yet.</strong><p>The firm has not configured a payment destination for this invoice.</p></div>'}
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
                    </aside>
                </div>
            `;
            const outer = root.closest('.panel'); if (outer) outer.classList.add('panel-flat');
            const payForm = document.getElementById('pay-form');
            if (payForm || document.getElementById('pay-now')) initPaymentForm({ destinations: availableDestinations, renderDetails: destinationDetails });
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

    async function initPaymentForm({ destinations = [], renderDetails } = {}) {
        const payNow = document.getElementById('pay-now');
        const checkout = document.getElementById('payment-checkout');
        const choices = document.getElementById('payment-method-choices');
        const selectedDetails = document.getElementById('selected-payment-details');
        const form = document.getElementById('pay-form');
        const methodSelect = document.getElementById('pay-method');
        const destinationInput = document.getElementById('pay-destination-id');
        const receiptInput = document.getElementById('pay-receipt');
        const statusEl = document.getElementById('pay-status');
        if (!checkout || !choices || !selectedDetails) return;

        const findDestination = (method, id) => destinations.find((d) => d.method === method && (!id || d.id === id));
        const selectDestination = (destination, button) => {
            if (!destination) return;
            choices.querySelectorAll('.payment-method-choice').forEach((choice) => choice.classList.toggle('selected', choice === button));
            selectedDetails.innerHTML = renderDetails(destination);
            selectedDetails.querySelectorAll('[data-copy-payment]').forEach((copyButton) => {
                copyButton.addEventListener('click', async () => {
                    try { await navigator.clipboard.writeText(copyButton.dataset.copyPayment || ''); copyButton.textContent = 'Copied'; } catch { copyButton.textContent = 'Copy unavailable'; }
                });
            });
            methodSelect.value = destination.method;
            destinationInput.value = destination.id || '';
            form.hidden = false;
        };
        payNow?.addEventListener('click', () => {
            checkout.hidden = false;
            payNow.hidden = true;
            choices.querySelector('.payment-method-choice')?.focus();
        });
        choices.querySelectorAll('.payment-method-choice').forEach((button) => {
            button.addEventListener('click', () => selectDestination(findDestination(button.dataset.method, button.dataset.destinationId), button));
        });
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const file = receiptInput.files[0];
            if (!file) {
                statusEl.className = 'form-status error';
                statusEl.innerHTML = '<strong>Please upload a receipt image.</strong>';
                return;
            }
            const method = methodSelect.value;
            const destId = destinationInput.value;
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
                    statusEl.innerHTML = '<strong>Payment submitted.</strong> Your proof is under review. The firm will verify it and notify you; your matter opens once it is confirmed.';
                    form.querySelector('button[type="submit"]')?.setAttribute('disabled', 'disabled');
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
    /* Live: when the firm requests payment, the invoice appears (or updates) without a refresh,
       unless the client is in the middle of paying. */
    const RT = window.Site && window.Site.Realtime;
    if (RT) {
        const refresh = () => {
            const paying = document.getElementById('payment-checkout') && !document.getElementById('payment-checkout').hidden;
            if (!paying) load();
        };
        ['payment.requested', 'payment.verified', 'payment.rejected'].forEach((t) => RT.on(t, refresh));
    }
})();
