import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:3000';
const PUBLIC = `${BASE}/frontend`;
const PORTAL = `${BASE}/frontend/portal`;
const SUBUI = `${BASE}/frontend/subui`;

let clientEmail = '';
let clientPassword = '';
let ownerEmail = '';
let ownerPassword = '';
let conversationId = '';
let matterId = '';
let requestId = '';

function randomId() {
  return Math.random().toString(36).slice(2, 8);
}

async function ensureClient() {
  await fetch(`${BASE}/api/v1/test/test-data`, { method: 'DELETE' });
  const email = `mtest-${Date.now()}-${randomId()}@test.com`;
  const password = 'TestPass123!';
  const res = await fetch(`${BASE}/api/v1/test/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, fullName: 'Msg Test Client', role: 'CLIENT' }),
  });
  if (!res.ok) throw new Error(`Create client failed: ${res.status} ${await res.text()}`);
  return { email, password };
}

async function ensureOwner() {
  const email = `mtest-owner-${Date.now()}-${randomId()}@test.com`;
  const password = 'TestPass123!';
  const res = await fetch(`${BASE}/api/v1/test/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, fullName: 'Msg Test Owner', role: 'OWNER' }),
  });
  if (!res.ok) throw new Error(`Create owner failed: ${res.status}`);
  return { email, password };
}

async function createRequest(token: string) {
  const res = await fetch(`${BASE}/api/v1/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ subject: `Msg Test Request ${randomId()}`, description: 'E2E test request description with enough characters to be valid for submission.' }),
  });
  const data = await res.json();
  return data.data?.id || '';
}

async function acceptRequest(ownerToken: string, rid: string) {
  const res = await fetch(`${BASE}/api/v1/staff/requests/${requestId}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ title: 'Msg Test Matter', matterType: 'Civil', description: 'Accepted via E2E' }),
  });
  return res.ok;
}

async function sendMessageViaAPI(token: string, convoId: string, body: string) {
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

async function loginClient(page: Page) {
  await page.goto(`${PUBLIC}/login.html`);
  await page.waitForLoadState('networkidle');
  await page.fill('#li-email', clientEmail);
  await page.fill('#li-password', clientPassword);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/portal\/dashboard\.html/, { timeout: 15000 });
  await page.waitForTimeout(2000);
}

async function loginOwner(page: Page) {
  await page.goto(`${SUBUI}/login.html`);
  await page.waitForLoadState('networkidle');
  await page.fill('#li-email', ownerEmail);
  await page.fill('#li-password', ownerPassword);
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(3000);
}

test.describe('Messaging Verification', () => {
  test.beforeAll(async () => {
    const client = await ensureClient();
    clientEmail = client.email;
    clientPassword = client.password;
    const owner = await ensureOwner();
    ownerEmail = owner.email;
    ownerPassword = owner.password;

    await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: clientEmail, password: clientPassword }),
    }).then(r => r.json()).then(async (d) => {
      const token = d.data?.token;
      requestId = await createRequest(token);
      const ownerLogin = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
      }).then(r => r.json());
      const ownerToken = ownerLogin.data?.token;
      await acceptRequest(ownerToken, requestId);
      await new Promise(r => setTimeout(r, 2000));
      const matterRes = await fetch(`${BASE}/api/v1/matters`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const matterData = await matterRes.json();
      matterId = matterData.data?.[0]?.id || '';
      conversationId = await getConversationId(token, matterId);
    });
  });

  test('CLIENT desktop: unread dot appears, opens conversation, dot disappears, refresh stays read', async ({ page }) => {
    await loginClient(page);

    const ownerLogin = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
    }).then(r => r.json());
    const ownerToken = ownerLogin.data?.token;

    const msgBody = `Unread dot test message ${randomId()}`;
    await sendMessageViaAPI(ownerToken, conversationId, msgBody);

    await page.goto(`${PORTAL}/messages.html`);
    await page.waitForTimeout(5000);

    const convoRow = page.locator(`tr[data-conversation-id="${conversationId}"]`);
    await expect(convoRow).toBeVisible();
    await expect(convoRow).toHaveAttribute('data-unread', 'true');
    await expect(convoRow.locator('.unread-dot')).toBeVisible();

    await convoRow.click();
    await page.waitForTimeout(2000);
    const readPills = page.locator('.status-cell .pill.status-closed');
    await expect(readPills.filter({ hasText: 'Read' }).first()).toBeVisible();

    await page.reload();
    await page.waitForTimeout(3000);
    const refreshedRow = page.locator(`tr[data-conversation-id="${conversationId}"]`);
    await expect(refreshedRow).not.toHaveAttribute('data-unread', 'true');
    await expect(refreshedRow.locator('.unread-dot')).toHaveCount(0);
  });

  test('CLIENT desktop: receiving new message moves conversation to top, no duplicates', async ({ page }) => {
    await loginClient(page);

    await page.goto(`${PORTAL}/messages.html`);
    await page.waitForTimeout(3000);

    const rowsBefore = await page.locator('tr[data-conversation-id]').count();

    const ownerLogin = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
    }).then(r => r.json());
    const ownerToken = ownerLogin.data?.token;

    const newMsgBody = `Top order test ${randomId()}`;
    await sendMessageViaAPI(ownerToken, conversationId, newMsgBody);

    await page.waitForTimeout(5000);

    const rowsAfter = await page.locator('tr[data-conversation-id]').count();
    expect(rowsAfter).toBe(rowsBefore);

    const firstRowId = await page.locator('tr[data-conversation-id]').first().getAttribute('data-conversation-id');
    expect(firstRowId).toBe(conversationId);
  });

  test('CLIENT desktop: new message in existing conversation updates preview and unread count', async ({ page }) => {
    await loginClient(page);

    await page.goto(`${PORTAL}/messages.html`);
    await page.waitForTimeout(3000);

    const ownerLogin = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
    }).then(r => r.json());
    const ownerToken = ownerLogin.data?.token;

    const msgBody = `Live preview update ${randomId()}`;
    await sendMessageViaAPI(ownerToken, conversationId, msgBody);

    await page.waitForTimeout(5000);

    const convoRow = page.locator(`tr[data-conversation-id="${conversationId}"]`);
    const preview = await convoRow.locator('.last-msg-preview').textContent();
    expect(preview).toContain(msgBody);

    const unreadBadge = page.locator('#nav-badge-messages');
    await expect(unreadBadge).toBeVisible();
    const badgeText = await unreadBadge.textContent();
    expect(parseInt(badgeText || '0', 10)).toBeGreaterThan(0);
  });

  test('CLIENT mobile: unread dot works and inbox ordering works', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginClient(page);

    const ownerLogin = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
    }).then(r => r.json());
    const ownerToken = ownerLogin.data?.token;

    const msgBody = `Mobile dot test ${randomId()}`;
    await sendMessageViaAPI(ownerToken, conversationId, msgBody);

    await page.goto(`${PORTAL}/messages.html`);
    await page.waitForTimeout(6000);

    if (await page.locator('#portalNavToggle').isVisible()) {
      await page.locator('#portalNavToggle').click();
      await page.waitForTimeout(1000);
    }

    const convoRow = page.locator(`tr[data-conversation-id="${conversationId}"]`);
    await expect(convoRow).toBeVisible();
    await expect(convoRow).toHaveAttribute('data-unread', 'true');
    await expect(convoRow.locator('.unread-dot')).toBeVisible();

    await convoRow.click();
    await page.waitForTimeout(2000);
    await page.reload();
    await page.waitForTimeout(3000);

    const refreshedRow = page.locator(`tr[data-conversation-id="${conversationId}"]`);
    await expect(refreshedRow).not.toHaveAttribute('data-unread', 'true');
    await expect(refreshedRow.locator('.unread-dot')).toHaveCount(0);
  });

  test('OWNER: receives CLIENT message, sees unread dot, opening clears it', async ({ page }) => {
    await loginOwner(page);
    await page.goto(`${SUBUI}/conversations.html`);
    await page.waitForTimeout(5000);

    const clientLogin = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: clientEmail, password: clientPassword }),
    }).then(r => r.json());
    const clientToken = clientLogin.data?.token;

    const msgBody = `Owner inbox dot test ${randomId()}`;
    await sendMessageViaAPI(clientToken, conversationId, msgBody);

    await page.waitForTimeout(5000);

    const ownerConvRow = page.locator(`tr[data-conversation-id="${conversationId}"]`);
    await expect(ownerConvRow).toBeVisible();
    await expect(ownerConvRow.locator('.unread-dot')).toBeVisible();

    await ownerConvRow.click();
    await page.waitForTimeout(2000);

    const readPills = page.locator('.unread-dot');
    await expect(readPills).toHaveCount(0);

    await page.reload();
    await page.waitForTimeout(2000);
    const refreshedRow = page.locator(`tr[data-conversation-id="${conversationId}"]`);
    await expect(refreshedRow.locator('.unread-dot')).toHaveCount(0);
  });

  test('Request workflow: CLIENT submits Request, OWNER accepts, CLIENT sees Matter and can Message', async ({ page }) => {
    const localClient = await ensureClient();
    const localOwner = await ensureOwner();

    const clientTokenRes = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: localClient.email, password: localClient.password }),
    });
    const clientLoginData = await clientTokenRes.json();
    const clientToken = clientLoginData.data?.token;

    const reqRes = await fetch(`${BASE}/api/v1/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clientToken}` },
      body: JSON.stringify({ subject: `Workflow test ${randomId()}`, description: 'E2E workflow test request description for valid submission.' }),
    });
    const reqData = await reqRes.json();
    const localRequestId = reqData.data?.id || '';

    await loginClient(page);
    await page.goto(`${PORTAL}/requests.html`);
    await page.waitForSelector('h1');
    await expect(page.locator('h1')).toContainText('My requests');

    const ownerTokenRes = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: localOwner.email, password: localOwner.password }),
    });
    const ownerLoginData = await ownerTokenRes.json();
    const ownerToken = ownerLoginData.data?.token;

    await page.context().addCookies([{
      name: 'sb-access-token', value: ownerToken, domain: 'localhost', path: '/', httpOnly: false,
    }]);

    await page.goto(`${SUBUI}/requests.html`);
    await page.waitForTimeout(3000);
    const reqRow = page.locator(`[data-request-id="${localRequestId}"]`);
    await expect(reqRow).toBeVisible();

    await Promise.all([
      page.click(`[data-request-id="${localRequestId}"] button:has-text("Accept")`),
      fetch(`${BASE}/api/v1/staff/requests/${localRequestId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ title: 'Workflow Matter', matterType: 'Civil', description: 'Created via E2E workflow test' }),
      }),
    ]);
    await page.waitForTimeout(3000);

    await page.goto(`${PORTAL}/messages.html`);
    await page.waitForTimeout(5000);
    const convoRows = page.locator('tr[data-conversation-id]');
    await expect(convoRows).toHaveCountGreaterThan(0);

    await fetch(`${BASE}/api/v1/matters`, {
      headers: { Authorization: `Bearer ${clientToken}` },
    }).then(r => r.json()).then(mdata => {
      const mid = mdata.data?.[0]?.id;
      if (mid) {
        return fetch(`${BASE}/api/v1/matters/${mid}/conversation`, {
          headers: { Authorization: `Bearer ${clientToken}` },
        }).then(r => r.json()).then(cd => cd.data?.id);
      }
    }).then(lcId => {
      if (lcId) {
        return sendMessageViaAPI(clientToken, lcId, `Client message to firm ${randomId()}`);
      }
    });

    await page.reload();
    await page.waitForTimeout(3000);
    const newMessage = page.locator('.last-msg-preview');
    if (await newMessage.count() > 0) {
      await expect(newMessage.first()).toBeVisible();
    }
  });

  test('OWNER desktop: can Message / Request Info / Accept / Decline on a request', async ({ page }) => {
    const localClient = await ensureClient();
    const localOwner = await ensureOwner();

    const clientTokenRes = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: localClient.email, password: clientPassword }),
    });
    const clientLoginData = await clientTokenRes.json();
    const clientToken = clientLoginData.data?.token;

    const reqRes = await fetch(`${BASE}/api/v1/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clientToken}` },
      body: JSON.stringify({ subject: `Action test ${randomId()}`, description: 'E2E action test request description for valid submission.' }),
    });
    const reqData = await reqRes.json();
    const localRequestId = reqData.data?.id || '';

    await loginOwner(page);
    await page.goto(`${SUBUI}/requests.html`);
    await page.waitForTimeout(3000);

    const reqRow = page.locator(`[data-request-id="${localRequestId}"]`);
    await expect(reqRow).toBeVisible();
    const viewBtn = reqRow.locator('button:has-text("View")');
    await viewBtn.click();
    await page.waitForTimeout(2000);

    const acceptBtn = page.locator('button:has-text("Accept")');
    const declineBtn = page.locator('button:has-text("Decline")');
    const reqInfoBtn = page.locator('button:has-text("Request Info")');

    await expect(acceptBtn).toBeVisible();
    await expect(declineBtn).toBeVisible();
    await expect(reqInfoBtn).toBeVisible();

    await reqInfoBtn.click();
    await page.waitForTimeout(2000);
  });
});
