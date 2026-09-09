/* Portal — matter detail. */
(function () {
    'use strict';
    if (!window.Site || !window.Portal || !window.Portal.guard()) return;
    const API = window.Site.API;
    const P = window.Portal;

    function escape(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

    async function load() {
        const id = new URLSearchParams(location.search).get('id');
        const root = document.getElementById('root');
        if (!id) {
            root.innerHTML = `<div class="alert error"><strong>Missing reference.</strong>Open this page from the dashboard.</div>`;
            return;
        }
        let matter;
        try {
            const r = await API.getMatter(id);
            matter = r.data;
        } catch (err) {
            if (err && err.status === 401) { window.location.replace('../login.html'); return; }
            root.innerHTML = `<div class="alert error"><strong>Could not load this matter.</strong>${escape(err.message || '')}</div>`;
            return;
        }
        document.getElementById('ref').textContent = `Reference ${escape(matter.reference)}`;
        document.getElementById('title').textContent = matter.title || 'Matter';
        document.getElementById('head-meta').textContent = matter.description || 'A formal engagement with the firm.';
        document.getElementById('msg-link').href = `messages.html?matter=${matter.id}`;
        document.title = `${matter.title || 'Matter'} | Client Portal`;

        const [events, docs, appts] = await Promise.all([
            API.getMatterEvents(matter.id).catch(() => ({ data: [] })),
            API.getMatterDocuments(matter.id).catch(() => ({ data: [] })),
            API.getMatterAppointments(matter.id).catch(() => ({ data: [] }))
        ]);

        const timeline = (events.data || []).length ? events.data.map((e) => `
            <li>
                <div class="ts">${P.fmtDate(e.created_at)}</div>
                <div class="label">${escape(e.title || e.event_type)}</div>
                ${e.note ? `<div class="note">${escape(e.note)}</div>` : ''}
            </li>
        `).join('') : '<li><div class="note">No activity yet.</div></li>';

        const apptRows = (appts.data || []).map((a) => `
            <div class="activity-row">
                <div class="dot"></div>
                <div class="body">
                    <div class="ts">${P.fmtDate(a.starts_at)} — ${P.fmtDate(a.ends_at)}</div>
                    <div class="lead"><strong>${escape((a.status || '').replace(/_/g,' '))}</strong>${a.notes ? ' · ' + escape(a.notes) : ''}</div>
                </div>
            </div>
        `).join('') || '<p class="text-mute-block">No appointments scheduled yet.</p>';

        const docRows = (docs.data || []).map((d) => `
            <div class="doc-row">
                <span class="doc-icon">DOC</span>
                <div>
                    <div class="doc-name">${escape(d.original_name)}</div>
                    <div class="doc-meta">${P.fmtDateShort(d.created_at)} · ${escape((d.status || 'AVAILABLE').toUpperCase())}</div>
                </div>
                <span></span><span></span>
            </div>
        `).join('') || '<p class="text-mute-block">No documents on this matter yet.</p>';

        root.innerHTML = `
            <div class="detail-grid">
                <div>
                    <section class="panel">
                        <div class="panel-head"><h2>Overview</h2></div>
                        <div class="panel-body">
                            <dl class="detail-meta">
                                <dt>Reference</dt><dd>${escape(matter.reference)}</dd>
                                <dt>Status</dt><dd>${P.statusPill(matter.status)}</dd>
                                <dt>Type</dt><dd>${escape(matter.matter_type || '—')}</dd>
                                <dt>Opened</dt><dd>${P.fmtDate(matter.created_at)}</dd>
                                <dt>Last update</dt><dd>${P.fmtDate(matter.updated_at || matter.created_at)}</dd>
                            </dl>
                            ${matter.description ? `<div class="section-divider">${escape(matter.description)}</div>` : ''}
                        </div>
                    </section>

                    <section class="panel">
                        <div class="panel-head"><h2>Timeline</h2></div>
                        <div class="panel-body"><ul class="timeline">${timeline}</ul></div>
                    </section>

                    <section class="panel">
                        <div class="panel-head"><h2>Appointments</h2></div>
                        <div class="panel-body">${apptRows}</div>
                    </section>

                    <section class="panel">
                        <div class="panel-head"><h2>Documents</h2></div>
                        <div class="panel-body tight">${docRows}</div>
                    </section>
                </div>

                <aside>
                    <section class="panel">
                        <div class="panel-head"><h2>Quick actions</h2></div>
                        <div class="panel-body">
                            <a class="btn" href="messages.html?matter=${matter.id}">Message the firm</a>
                            <a class="btn secondary spacer-2" href="requests.html?id=${matter.originating_request_id || ''}">View originating request</a>
                        </div>
                    </section>
                </aside>
            </div>
        `;
    }

    load();
})();
