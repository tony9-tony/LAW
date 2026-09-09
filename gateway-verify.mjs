import http from 'http';

function req(path, opts = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, 'http://localhost:3000');
        const request = http.request(url, {
            method: opts.method || 'GET',
            headers: Object.assign({}, opts.headers),
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString();
                let data = null;
                try { data = JSON.parse(text); } catch (_) { data = text; }
                resolve({ status: res.statusCode, data, headers: res.headers });
            });
        });
        request.on('error', reject);
        if (opts.body) request.write(opts.body);
        request.end();
    });
}

async function main() {
    console.log('=== GATEWAY VERIFICATION ===\n');

    // 1. Root landing page
    const root = await req('/');
    console.log('1. / (root landing):', root.status, root.headers['content-type']);
    console.log('   Contains gateway:', typeof root.data === 'string' && root.data.includes('How would you like to continue?'));

    // 2. /admin redirects to /subui/login.html
    const admin = await req('/admin', { headers: { 'Origin': 'http://localhost:3000' } });
    console.log('2. /admin:', admin.status, 'location:', admin.headers.location);

    // 3. Public website still accessible
    const site = await req('/frontend/index.html');
    console.log('3. /frontend/index.html:', site.status);

    // 4. Client login
    const login = await req('/frontend/login.html');
    console.log('4. /frontend/login.html:', login.status);

    // 5. Admin Portal
    const subuiLogin = await req('/subui/login.html');
    console.log('5. /subui/login.html:', subuiLogin.status);

    // 6. OWNER login works
    const ownerLogin = await req('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:3000' },
        body: JSON.stringify({ email: 'owner@example.com', password: 'OwnerPass123!' })
    });
    console.log('6. OWNER login:', ownerLogin.status, 'role:', ownerLogin.data.data.user.role);
    const token = ownerLogin.data.data.token;

    // 7. SUBUI sections work
    const requests = await req('/api/v1/owner/requests', {
        headers: { 'Authorization': 'Bearer ' + token, 'Origin': 'http://localhost:3000' }
    });
    console.log('7. OWNER /owner/requests:', requests.status);

    // 8. CLIENT cannot access
    const reg = await req('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:3000' },
        body: JSON.stringify({ email: 'client-test-' + Date.now() + '@example.com', password: 'longenoughpw1', fullName: 'Client Test' })
    });
    const clientLogin = await req('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:3000' },
        body: JSON.stringify({ email: reg.data.data.email, password: 'longenoughpw1' })
    });
    const clientToken = clientLogin.data.data.token;
    const forbidden = await req('/api/v1/owner/requests', {
        headers: { 'Authorization': 'Bearer ' + clientToken, 'Origin': 'http://localhost:3000' }
    });
    console.log('8. CLIENT /owner/requests:', forbidden.status, '(expected 403)');

    // 9. CLIENT cannot bypass via /admin
    const bypass = await req('/admin', {
        headers: { 'Authorization': 'Bearer ' + clientToken, 'Origin': 'http://localhost:3000' }
    });
    console.log('9. CLIENT /admin bypass:', bypass.status, '(expected 302 redirect to /subui/login.html)');

    console.log('\n=== GATEWAY VERIFICATION COMPLETE ===');
}

main().catch((e) => { console.error(e); process.exit(1); });