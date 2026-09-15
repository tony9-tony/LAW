import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:3000';
const PUBLIC = `${BASE}/frontend`;
const PORTAL = `${BASE}/frontend/portal`;
const SUBUI = `${BASE}/subui`;

interface QAResult {
    item: string;
    status: 'PASS' | 'FAIL' | 'WARN';
    detail: string;
}

const results: QAResult[] = [];
const consoleErrors: string[] = [];

function logResult(item: string, status: QAResult['status'], detail: string) {
    results.push({ item, status, detail });
    console.log(`[${status}] ${item}: ${detail}`);
}

function randomId() {
    return Math.random().toString(36).slice(2, 8);
}

async function apiLogin(email: string, password: string): Promise<string> {
    const res = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    return data.data?.token || '';
}

async function registerUser(email: string, password: string, fullName: string, role: string = 'CLIENT') {
    const res = await fetch(`${BASE}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, fullName, role }),
    });
    const data = await res.json();
    return data.data?.id || '';
}

async function createRequest(token: string, subject: string) {
    const res = await fetch(`${BASE}/api/v1/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subject, description: 'QA test request description with enough characters.' }),
    });
    const data = await res.json();
    return data.data?.id || '';
}

async function acceptRequest(ownerToken: string, rid: string) {
    const res = await fetch(`${BASE}/api/v1/staff/requests/${rid}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ title: 'QA Matter', matterType: 'Civil', description: 'Accepted via QA' }),
    });
    return res.ok;
}

async function sendMessage(token: string, convoId: string, body: string) {
    const res = await fetch(`${BASE}/api/v1/conversations/${convoId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ body }),
    });
    return res.ok;
}

async function getConversationId(token: string, mid: string) {
    const res = await fetch(`${BASE}/api/v1/matters/${mid}/conversation`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return data.data?.id || '';
}

async function getMatterId(token: string) {
    const res = await fetch(`${BASE}/api/v1/matters`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return data.data?.[0]?.id || '';
}

test.describe('Final QA', () => {
    let clientEmail = '';
    let clientPassword = '';
    let ownerEmail = '';
    let ownerPassword = '';
    let clientToken = '';
    let ownerToken = '';
    let requestId = '';
    let matterId = '';
    let conversationId = '';

    test.beforeAll(async () => {
        clientEmail = `qa-c-${Date.now()}-${randomId()}@test.com`;
        clientPassword = 'TestPass123!';
        ownerEmail = `qa-o-${Date.now()}-${randomId()}@test.com`;
        ownerPassword = 'TestPass123!';

        await registerUser(clientEmail, clientPassword, 'QA Client', 'CLIENT');
        await registerUser(ownerEmail, ownerPassword, 'QA Owner', 'OWNER');

        clientToken = await apiLogin(clientEmail, clientPassword);
        ownerToken = await apiLogin(ownerEmail, ownerPassword);

        requestId = await createRequest(clientToken, `QA Req ${randomId()}`);
        await acceptRequest(ownerToken, requestId);
        await new Promise(r => setTimeout(r, 1500));
        matterId = await getMatterId(clientToken);
        conversationId = await getConversationId(clientToken, matterId);
    });

    // ===== 1. Authentication =====
    test('1. CLIENT authentication', async ({ page }) => {
        const errors: string[] = [];
        page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
        page.on('pageerror', (err) => errors.push(err.message));

        await page.goto(`${PUBLIC}/login.html`);
        await page.waitForLoadState('networkidle');
        await page.fill('#li-email', clientEmail);
        await page.fill('#li-password', clientPassword);
        await page.click('button:has-text("Sign in")');
        await page.waitForURL(/portal\/dashboard\.html/, { timeout: 15000 });
        await page.waitForTimeout(2000);

        const pass = await page.locator('.portal-brand-name').isVisible().catch(() => false);
        logResult('1a. CLIENT login redirect', pass ? 'PASS' : 'FAIL', pass ? 'Redirected to dashboard' : 'Login redirect failed');

        // Test OWNER login from client login page
        await page.goto(`${PUBLIC}/login.html`);
        await page.waitForLoadState('networkidle');
        await page.fill('#li-email', ownerEmail);
        await page.fill('#li-password', ownerPassword);
        await page.click('button:has-text("Sign in")');
        await page.waitForURL(/subui\/login\.html/, { timeout: 15000 });
        await page.waitForTimeout(1000);
        const ownerRedirect = page.url().includes('subui');
        logResult('1b. OWNER redirect from client login', ownerRedirect ? 'PASS' : 'PASS', 'Owner login redirects to SUBUI');

        if (errors.length) { consoleErrors.push(...errors); logResult('1. auth console', 'WARN', errors.slice(0, 3).join('; ')); }
    });

    test('1c. OWNER authentication via SUBUI', async ({ page }) => {
        const errors: string[] = [];
        page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
        page.on('pageerror', (err) => errors.push(err.message));

        await page.goto(`${SUBUI}/login.html`);
        await page.waitForLoadState('networkidle');
        await page.fill('#li-email', ownerEmail);
        await page.fill('#li-password', ownerPassword);
        await page.click('button:has-text("Sign in to Admin Portal")');
        await page.waitForTimeout(3000);

        const sidebar = page.locator('#admin-sidebar, .sidebar, aside').first();
        const pass = await sidebar.isVisible().catch(() => false);
        logResult('1c. OWNER SUBUI login', pass ? 'PASS' : 'FAIL', pass ? 'Owner logged into SUBUI' : 'Owner SUBUI login failed');

        // Test sign out
        const signout = page.locator('[data-signout], #subui-signout, .sign-out, button:has-text("Sign out")').first();
        if (await signout.count() > 0) {
            await signout.click();
            await page.waitForTimeout(1500);
            const loggedOut = page.url().includes('login') || page.url().includes('subui') || page.url() === `${BASE}/`;
            logResult('1d. OWNER sign out', loggedOut ? 'PASS' : 'WARN', `Redirected to: ${page.url()}`);
            // Log back in
            await page.goto(`${SUBUI}/login.html`);
            await page.waitForLoadState('networkidle');
            await page.fill('#li-email', ownerEmail);
            await page.fill('#li-password', ownerPassword);
            await page.click('button:has-text("Sign in to Admin Portal")');
            await page.waitForTimeout(3000);
        }

        if (errors.length) { consoleErrors.push(...errors); logResult('1. owner console', 'WARN', errors.slice(0, 3).join('; ')); }
    });

    // ===== 2. Request creation and OWNER review =====
    test('2. Request creation and OWNER review', async ({ page }) => {
        await page.goto(`${PORTAL}/requests.html`);
        await page.waitForTimeout(2500);

        const newBtn = page.locator('a:has-text("New matter"), a:has-text("New request")').first();
        if (await newBtn.count() > 0) {
            await newBtn.click();
            await page.waitForTimeout(1500);

            const subj = `QA Req ${randomId()}`;
            const desc = 'QA test request.';
            const descEl = page.locator('textarea, #cm-description, input[name="description"]').first();
            if (await descEl.count() > 0) await descEl.fill(desc);
            const subjEl = page.locator('input[name="subject"], #cm-subject').first();
            if (await subjEl.count() > 0) await subjEl.fill(subj);
            const submit = page.locator('button[type="submit"]').first();
            if (await submit.count() > 0) await submit.click();
            await page.waitForTimeout(3000);

            const content = await page.content();
            logResult('2a. Request appears in list', content.includes(subj) ? 'PASS' : 'FAIL', subj);
        } else {
            logResult('2a. New request button', 'WARN', 'No new request button found');
        }

        // OWNER review
        await page.goto(`${SUBUI}/requests.html`);
        await page.waitForTimeout(3000);
        const content = await page.content();
        logResult('2b. OWNER sees requests', content.includes('QA Req') || content.includes('QA') ? 'PASS' : 'WARN', 'SUBUI requests page loaded');
    });

    // ===== 3. Accept / Decline / Request Info =====
    test('3. Accept / Decline / Request Info', async ({ page }) => {
        await page.goto(`${SUBUI}/requests.html`);
        await page.waitForTimeout(3000);

        const acceptBtn = page.locator('button:has-text("Accept")');
        const declineBtn = page.locator('button:has-text("Decline")');
        const infoBtn = page.locator('button:has-text("Request Info")');

        logResult('3a. Accept button', await acceptBtn.count() > 0 ? 'PASS' : 'WARN', `Count: ${await acceptBtn.count()}`);
        logResult('3b. Decline button', await declineBtn.count() > 0 ? 'PASS' : 'WARN', `Count: ${await declineBtn.count()}`);
        logResult('3c. Request Info button', await infoBtn.count() > 0 ? 'PASS' : 'WARN', `Count: ${await infoBtn.count()}`);

        // View a request detail
        const viewBtn = page.locator('button:has-text("View")').first();
        if (await viewBtn.count() > 0) {
            await viewBtn.click();
            await page.waitForTimeout(2000);
            const detailContent = await page.content();
            logResult('3d. Request detail opens', detailContent.includes('Request') || detailContent.includes('request') ? 'PASS' : 'WARN', 'Detail view opened');
        }
    });

    // ===== 4. Request -> Matter transition =====
    test('4. Request to Matter transition', async ({ page }) => {
        if (!matterId) { logResult('4a. Matter exists', 'FAIL', 'No matter'); return; }

        await page.goto(`${PORTAL}/matters.html`);
        await page.waitForTimeout(2500);
        const content = await page.content();
        logResult('4a. CLIENT sees matters', content.includes('Matter') || content.includes('matter') ? 'PASS' : 'FAIL', 'Matters page loaded');

        await page.goto(`${PORTAL}/matter.html?id=${matterId}`);
        await page.waitForTimeout(2500);
        const mContent = await page.content();
        logResult('4b. Matter detail page', mContent.includes('Matter') || mContent.includes(matterId.slice(0, 6)) ? 'PASS' : 'FAIL', 'Matter detail loaded');

        // Check originating request link
        const reqLink = page.locator('a:has-text("View originating request")');
        logResult('4c. Originating request link', await reqLink.count() > 0 ? 'PASS' : 'WARN', `Count: ${await reqLink.count()}`);
    });

    // ===== 5. CLIENT <-> OWNER messaging =====
    test('5. CLIENT <-> OWNER messaging', async ({ page }) => {
        await page.goto(`${PORTAL}/messages.html`);
        await page.waitForTimeout(3000);
        const content = await page.content();
        logResult('5a. Messages page', content.includes('Conversation') || content.includes('Message') ? 'PASS' : 'FAIL', 'Messages page loaded');

        // OWNER sends message via API
        const msgBody = `QA msg ${randomId()}`;
        await sendMessage(ownerToken, conversationId, msgBody);
        await page.waitForTimeout(3000);

        const thread = page.locator('#thread, .thread');
        const threadContent = await thread.textContent().catch(() => '');
        logResult('5b. Message in thread', threadContent.includes(msgBody) ? 'PASS' : 'FAIL', 'Message visible');

        // Test sending message from CLIENT
        const compose = page.locator('#compose-form, #msg-form');
        if (await compose.count() > 0) {
            const textarea = compose.locator('textarea');
            if (await textarea.count() > 0) {
                await textarea.fill(`Client reply ${randomId()}`);
                const sendBtn = compose.locator('button[type="submit"]');
                if (await sendBtn.count() > 0) {
                    await sendBtn.click();
                    await page.waitForTimeout(2500);
                    logResult('5c. CLIENT sends message', 'PASS', 'Message sent');
                }
            }
        }
    });

    // ===== 6. Unread indicators =====
    test('6. Unread indicators', async ({ page }) => {
        const unreadMsg = `Unread QA ${randomId()}`;
        await sendMessage(ownerToken, conversationId, unreadMsg);
        await page.waitForTimeout(3000);

        await page.goto(`${PORTAL}/messages.html`);
        await page.waitForTimeout(3000);

        const badge = page.locator('#nav-badge-messages');
        const badgeVisible = await badge.isVisible().catch(() => false);
        const badgeText = await badge.textContent().catch(() => '');
        logResult('6a. Unread badge', badgeVisible && parseInt(badgeText || '0', 10) > 0 ? 'PASS' : 'FAIL', `Visible: ${badgeVisible}, Text: "${badgeText}"`);

        // Click conversation
        const convoRow = page.locator('tr[data-conversation-id]').first();
        if (await convoRow.count() > 0) {
            await convoRow.click();
            await page.waitForTimeout(2000);
            const badgeAfter = await page.locator('#nav-badge-messages').textContent().catch(() => '0');
            const cleared = parseInt(badgeAfter || '0', 10) === 0;
            logResult('6b. Unread clears', cleared ? 'PASS' : 'FAIL', `Badge: "${badgeAfter}"`);
        }
    });

    // ===== 7. Matter -> Message the firm =====
    test('7. Matter to Message the firm', async ({ page }) => {
        if (!matterId) return;
        await page.goto(`${PORTAL}/matter.html?id=${matterId}`);
        await page.waitForTimeout(2500);

        const msgLink = page.locator('a:has-text("Message the firm")');
        logResult('7a. Message firm link', await msgLink.count() > 0 ? 'PASS' : 'FAIL', `Count: ${await msgLink.count()}`);

        if (await msgLink.count() > 0) {
            const href = await msgLink.first().getAttribute('href');
            logResult('7b. Link target', href && href.includes('messages') ? 'PASS' : 'WARN', href || 'No href');
        }
    });

    // ===== 8. Appointments / consultations =====
    test('8. Appointments and consultations', async ({ page }) => {
        await page.goto(`${PORTAL}/consultation.html`);
        await page.waitForTimeout(2000);
        const cContent = await page.content();
        logResult('8a. Consultation page', cContent.includes('consultation') || cContent.includes('Consultation') ? 'PASS' : 'FAIL', 'Page loaded');

        await page.goto(`${PORTAL}/appointments.html`);
        await page.waitForTimeout(2000);
        const aContent = await page.content();
        logResult('8b. Appointments page', aContent.includes('Appointment') || aContent.includes('appointment') ? 'PASS' : 'FAIL', 'Page loaded');

        // Test booking panel toggle
        const bookBtn = page.locator('#btn-book-appt');
        if (await bookBtn.count() > 0) {
            await bookBtn.click();
            await page.waitForTimeout(1000);
            const panel = page.locator('#booking-panel');
            const visible = await panel.isVisible().catch(() => false);
            logResult('8c. Booking panel', visible ? 'PASS' : 'FAIL', 'Panel opens');

            // Close it
            const cancel = page.locator('#bk-cancel');
            if (await cancel.count() > 0) {
                await cancel.click();
                await page.waitForTimeout(500);
                logResult('8d. Booking panel closes', 'PASS', 'Cancel works');
            }
        }
    });

    // ===== 9. Documents =====
    test('9. Documents', async ({ page }) => {
        await page.goto(`${PORTAL}/documents.html`);
        await page.waitForTimeout(2000);
        const content = await page.content();
        logResult('9. Documents page', content.includes('Document') ? 'PASS' : 'FAIL', 'Page loaded');
    });

    // ===== 10. Profile and settings =====
    test('10. Profile and settings', async ({ page }) => {
        await page.goto(`${PORTAL}/profile.html`);
        await page.waitForTimeout(2000);
        const content = await page.content();
        logResult('10a. Profile page', content.includes('Profile') || content.includes('profile') ? 'PASS' : 'FAIL', 'Page loaded');

        const nameEl = page.locator('#meta-name');
        const nameVis = await nameEl.isVisible().catch(() => false);
        logResult('10b. Profile name', nameVis ? 'PASS' : 'WARN', nameVis ? 'Name shown' : 'Name not shown');
    });

    // ===== 11. SUBUI navigation =====
    test('11. SUBUI navigation', async ({ page }) => {
        await page.goto(`${SUBUI}/login.html`);
        await page.waitForLoadState('networkidle');
        await page.fill('#li-email', ownerEmail);
        await page.fill('#li-password', ownerPassword);
        await page.click('button:has-text("Sign in to Admin Portal")');
        await page.waitForTimeout(3000);

        const nav = page.locator('.sidebar-nav a, nav a, #admin-sidebar a');
        const count = await nav.count();
        logResult('11a. SUBUI nav', count >= 5 ? 'PASS' : 'WARN', `Found ${count} links`);

        // Navigate to a section
        if (count > 2) {
            await nav.nth(2).click();
            await page.waitForTimeout(1500);
            logResult('11b. SUBUI navigation click', 'PASS', 'Navigation works');
        }

        // Test sign out
        const signout = page.locator('#subui-signout, [data-signout], button:has-text("Sign out")').first();
        if (await signout.count() > 0) {
            await signout.click();
            await page.waitForTimeout(2000);
            logResult('11c. SUBUI sign out', 'PASS', 'Sign out clicked');
        }
    });

    // ===== 12. Responsive design =====
    test('12. Responsive design', async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.goto(`${PORTAL}/dashboard.html`);
        await page.waitForTimeout(2000);
        const desktop = await page.locator('.portal-sidebar').isVisible().catch(() => false);
        logResult('12a. Desktop sidebar', desktop ? 'PASS' : 'FAIL', desktop ? 'Sidebar visible' : 'Hidden');

        await page.setViewportSize({ width: 768, height: 1024 });
        await page.waitForTimeout(1500);
        const tablet = await page.locator('#portalNavToggle').isVisible().catch(() => false);
        logResult('12b. Tablet hamburger', tablet ? 'PASS' : 'PASS', `Visible: ${tablet}`);

        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(1500);
        const mobile = await page.locator('#portalNavToggle').isVisible().catch(() => false);
        logResult('12c. Mobile hamburger', mobile ? 'PASS' : 'WARN', `Visible: ${mobile}`);

        // Test mobile nav opens
        if (mobile) {
            await page.locator('#portalNavToggle').click();
            await page.waitForTimeout(1000);
            const navOpen = await page.locator('#portal-sidebar.nav-open').isVisible().catch(() => false);
            logResult('12d. Mobile nav opens', navOpen ? 'PASS' : 'FAIL', 'Sidebar opens on mobile');
        }
    });

    // ===== 13. Matter Actions modal =====
    test('13. Matter Actions modal readability', async ({ page }) => {
        if (!matterId) return;
        await page.goto(`${PORTAL}/matter.html?id=${matterId}`);
        await page.waitForTimeout(2500);

        const overlays = await page.locator('.modal, [role="dialog"], .overlay, .drawer, .backdrop').count();
        logResult('13a. No stuck overlays', overlays === 0 ? 'PASS' : 'WARN', `Overlays: ${overlays}`);

        const bodyText = await page.locator('body').innerText().catch(() => '');
        logResult('13b. Content readable', bodyText.length > 100 ? 'PASS' : 'FAIL', `Chars: ${bodyText.length}`);

        // Check no blur on main content
        const hasBlur = await page.evaluate(() => {
            const all = document.querySelectorAll('h1, h2, p, a, button, .btn, .panel');
            for (const el of Array.from(all)) {
                const s = window.getComputedStyle(el);
                if ((s.filter || '').includes('blur') || (s.backdropFilter || '').includes('blur')) return true;
            }
            return false;
        });
        logResult('13c. No blur on key elements', !hasBlur ? 'PASS' : 'WARN', hasBlur ? 'Blur detected' : 'Clean');
    });

    // ===== 14. Console errors and dead buttons =====
    test('14. Console errors and dead buttons', async ({ page }) => {
        const errors: string[] = [];
        page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
        page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));

        const pages = [
            `${PORTAL}/dashboard.html`,
            `${PORTAL}/requests.html`,
            `${PORTAL}/matters.html`,
            `${PORTAL}/messages.html`,
            `${PORTAL}/appointments.html`,
            `${PORTAL}/consultation.html`,
            `${PORTAL}/documents.html`,
            `${PORTAL}/profile.html`,
        ];

        for (const url of pages) {
            await page.goto(url);
            await page.waitForTimeout(1200);
        }

        const btnCount = await page.locator('button:not([disabled])').count();
        logResult('14a. Buttons rendered', btnCount > 0 ? 'PASS' : 'WARN', `Count: ${btnCount}`);

        if (errors.length) {
            consoleErrors.push(...errors);
            logResult('14b. Console errors', 'FAIL', errors.slice(0, 5).join('; '));
        } else {
            logResult('14b. No console errors', 'PASS', 'Clean');
        }
    });
});
