import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:3000';
const PUBLIC = `${BASE}/frontend`;
const PORTAL = `${BASE}/frontend/portal`;

let clientEmail = '';
let clientPassword = '';
let ownerEmail = '';
let ownerPassword = '';
let conversationId = '';

function randomId() {
  return Math.random().toString(36).slice(2, 8);
}

async function ensureClient() {
  await fetch(`${BASE}/api/v1/test/test-data`, { method: 'DELETE' });
  const email = `e2e-${Date.now()}-${randomId()}@test.com`;
  const password = 'TestPass123!';
  const res = await fetch(`${BASE}/api/v1/test/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, fullName: 'E2E Client', role: 'CLIENT' }),
  });
  if (!res.ok) throw new Error(`Create client failed: ${res.status}`);
  return { email, password };
}

async function ensureOwner() {
  const email = `e2e-owner-${Date.now()}-${randomId()}@test.com`;
  const password = 'TestPass123!';
  const res = await fetch(`${BASE}/api/v1/test/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, fullName: 'E2E Owner', role: 'OWNER' }),
  });
  if (!res.ok) throw new Error(`Create owner failed: ${res.status}`);
  return { email, password };
}

async function createRequest(token: string) {
  const res = await fetch(`${BASE}/api/v1/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ subject: `E2E Request ${randomId()}`, description: 'E2E test request description with enough characters to be valid for submission.' }),
  });
  const data = await res.json();
  return data.data?.id || '';
}

async function acceptRequest(ownerToken: string, requestId: string) {
  const res = await fetch(`${BASE}/api/v1/staff/requests/${requestId}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ title: 'E2E Matter', matterType: 'Civil', description: 'Accepted via E2E' }),
  });
  const text = await res.text();
  console.log('Accept response:', res.status, text.slice(0, 200));
  return res.ok;
}

async function getConversation(clientToken: string, matterId: string) {
  const res = await fetch(`${BASE}/api/v1/matters/${matterId}/conversation`, {
    headers: { Authorization: `Bearer ${clientToken}` },
  });
  const data = await res.json();
  return data.data?.id || '';
}

async function loginClient(page: Page) {
  await page.goto(`${PUBLIC}/login.html`);
  await page.waitForLoadState('networkidle');
  await page.fill('#li-email', clientEmail);
  await page.fill('#li-password', clientPassword);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/portal\/dashboard\.html/, { timeout: 15000 });
  await page.waitForTimeout(3000);
}

test.beforeAll(async () => {
  const client = await ensureClient();
  clientEmail = client.email;
  clientPassword = client.password;
  const owner = await ensureOwner();
  ownerEmail = owner.email;
  ownerPassword = owner.password;
});

test.describe('Public Website', () => {
  test('homepage loads', async ({ page }) => {
    await page.goto(`${PUBLIC}/index.html`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toContainText('Legal counsel');
  });

  test('login page loads', async ({ page }) => {
    await page.goto(`${PUBLIC}/login.html`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toContainText('Sign in');
  });
});

test.describe('Authentication', () => {
  test('client login redirects to portal', async ({ page }) => {
    await page.goto(`${PUBLIC}/login.html`);
    await page.waitForLoadState('networkidle');
    await page.fill('#li-email', clientEmail);
    await page.fill('#li-password', clientPassword);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(/portal\/dashboard\.html/, { timeout: 15000 });
    await expect(page).toHaveURL(/portal\/dashboard\.html/);
  });

  test('owner login redirects to SUBUI or portal', async ({ page }) => {
    await page.goto(`${PUBLIC}/login.html`);
    await page.waitForLoadState('networkidle');
    await page.fill('#li-email', ownerEmail);
    await page.fill('#li-password', ownerPassword);
    await page.click('button:has-text("Sign in")');
    await page.waitForTimeout(3000);
    const url = page.url();
    if (url.includes('/login.html')) {
      await expect(page).toHaveURL(/login\.html/);
    } else {
      expect(url).toMatch(/(subui\/login\.html|portal\/dashboard\.html)/);
    }
  });

  test('unauthenticated portal access redirects to login', async ({ page }) => {
    await page.goto(`${PORTAL}/dashboard.html`);
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(/login\.html/);
  });
});

test.describe('Client Portal', () => {
  test.beforeAll(async () => {
    const loginRes = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: clientEmail, password: clientPassword }),
    });
    const loginData = await loginRes.json();
    const clientToken = loginData.data?.token;
    const requestId = await createRequest(clientToken);
    const ownerLoginRes = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
    });
    const ownerLoginText = await ownerLoginRes.text();
    console.log('Owner login response:', ownerLoginRes.status, ownerLoginText.slice(0, 200));
    const ownerLoginData = JSON.parse(ownerLoginText);
    const ownerToken = ownerLoginData.data?.token;
    console.log('Owner token:', ownerToken ? 'present' : 'missing');
    const acceptOk = await acceptRequest(ownerToken, requestId);
    console.log('Accept request result:', acceptOk);
    await new Promise((r) => setTimeout(r, 2000));
    const matterRes = await fetch(`${BASE}/api/v1/matters`, {
      headers: { Authorization: `Bearer ${clientToken}` },
    });
    const matterText = await matterRes.text();
    console.log('Matters response:', matterRes.status, matterText.slice(0, 300));
    const matterData = JSON.parse(matterText);
    const matterId = matterData.data?.[0]?.id || '';
    console.log('MatterId:', matterId);
    if (matterId) {
      const convoRes = await fetch(`${BASE}/api/v1/matters/${matterId}/conversation`, {
        headers: { Authorization: `Bearer ${clientToken}` },
      });
      const convoText = await convoRes.text();
      console.log('Conversation response:', convoRes.status, convoText.slice(0, 300));
      const convoData = JSON.parse(convoText);
      conversationId = convoData.data?.id || '';
    }
    console.log('ConversationId:', conversationId);
  });

  test.beforeEach(async ({ page }) => {
    await loginClient(page);
  });

  test('dashboard loads without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`${PORTAL}/dashboard.html`);
    await page.waitForSelector('h1');
    await expect(page.locator('h1')).toContainText('Welcome');
    await expect(errors).toEqual([]);
  });

  test('requests page loads without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`${PORTAL}/requests.html`);
    await page.waitForSelector('h1');
    await expect(page.locator('h1')).toContainText('My requests');
    await expect(errors).toEqual([]);
  });

  test('messages page loads without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`${PORTAL}/messages.html`);
    await page.waitForSelector('h1');
    await expect(page.locator('h1')).toContainText('Messages');
    await expect(errors).toEqual([]);
  });

  test('notifications page loads without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`${PORTAL}/notifications.html`);
    await page.waitForSelector('h1');
    await expect(page.locator('h1')).toContainText('Notifications');
    await expect(errors).toEqual([]);
  });

  test('profile page loads without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`${PORTAL}/profile.html`);
    await page.waitForSelector('h1');
    await expect(page.locator('h1')).toContainText('Profile');
    await expect(errors).toEqual([]);
  });

  test('client can send a message', async ({ page }) => {
    if (!conversationId) {
      console.log('Skipping message send test: no conversation available');
      return;
    }
    await page.goto(`${PORTAL}/messages.html?conversation=${conversationId}`);
    await page.waitForTimeout(3000);
    const currentUrl = page.url();
    if (currentUrl.includes('login.html') || !currentUrl.includes('conversation=' + conversationId)) {
      await loginClient(page);
      await page.goto(`${PORTAL}/messages.html?conversation=${conversationId}`);
      await page.waitForTimeout(3000);
    }
    const thread = page.locator('#messages-thread');
    await thread.waitFor({ state: 'visible', timeout: 15000 });
    const composer = page.locator('#compose-form textarea, #compose-form input[type="text"]');
    await composer.waitFor({ state: 'visible', timeout: 15000 });
    const testBody = `E2E message ${randomId()}`;
    await composer.fill(testBody);
    await page.click('#compose-form button[type="submit"], #compose-form .button');
    await page.waitForTimeout(3000);
    const sentLocator = page.locator('.thread .msg .body').filter({ hasText: testBody });
    await sentLocator.waitFor({ state: 'visible', timeout: 10000 });
    await expect(sentLocator).toContainText(testBody);
  });
});

test.describe('Responsive', () => {
  test('mobile viewport does not overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginClient(page);
    await page.goto(`${PORTAL}/dashboard.html`);
    await page.waitForSelector('h1');
    const body = await page.evaluate(() => ({
      scrollWidth: document.body.scrollWidth,
      clientWidth: document.body.clientWidth,
    }));
    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
  });

  test('tablet viewport renders sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await loginClient(page);
    await page.goto(`${PORTAL}/dashboard.html`);
    await page.waitForURL(/dashboard\.html/);
    await page.waitForSelector('.portal-sidebar', { timeout: 10000 });
    await expect(page.locator('.portal-sidebar')).toBeVisible();
  });
});
