const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { TeamClient, MentorApi } = require('../.test-output/library.cjs');
const user = { id: '11111111-1111-4111-8111-111111111111', name: 'Developer', email: 'developer@test.example' };
const account = { user, workspaces: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Team', role: 'developer' }] };
const cookie = 'mentor_collaboration=' + 'a'.repeat(64);
function store() { const values = new Map(); return { values, get: async key => values.get(key), store: async (key,value) => {values.set(key,value)}, delete: async key => {values.delete(key)} }; }
async function serverFixture() {
  const calls = []; let reject = false;
  const server = createServer((req,res) => {
    calls.push({ path:req.url,cookie:req.headers.cookie });
    req.resume();res.setHeader('Content-Type','application/json');
    if (req.url === '/api/collaboration/login' || req.url === '/api/ide/team/connect' && req.headers['x-codebase-mentor-client'] === 'vscode') { res.setHeader('Set-Cookie',cookie+'; HttpOnly; Path=/api');return res.end(JSON.stringify({user})); }
    if (reject || req.headers.cookie !== cookie) {res.statusCode=401;return res.end('{}');}
    res.end(JSON.stringify(req.url.endsWith('/capabilities') ? {enabled:true,mode:'authenticated-user',schemaVersion:1,notice:'User-owned sessions'} : account));
  }).listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, calls, reject: () => {reject=true}, close: () => new Promise(resolve=>server.close(resolve)) };
}
test('team sign-in persists only a backend-scoped session cookie, restores it, and selects authenticated checkpoint routes', async () => {
  const backend = await serverFixture();const secrets=store();
  try {
    const client=new TeamClient(()=>backend.url,secrets);
    await client.login(user.email,'a private password');
    assert.equal(client.account.user.id,user.id);
    assert.deepEqual([...secrets.values.values()],[cookie]);
    assert(!JSON.stringify([...secrets.values]).includes('a private password'));
    const restored=new TeamClient(()=>backend.url,secrets);await restored.restore();assert.equal(restored.account.user.id,user.id);
    const api=new MentorApi(()=>backend.url,{headers:()=>restored.headers,authenticated:()=>!!restored.account});
    assert.equal((await api.checkpointCapability()).mode,'authenticated-user');
    assert(backend.calls.some(c=>c.path==='/api/ide/team/checkpoints/capabilities'&&c.cookie===cookie));
    await restored.logout();assert.equal(restored.account,undefined);assert.equal(secrets.values.size,0);
  } finally {await backend.close();}
});

test('native local handoffs connect without a password prompt or login request', async () => {
  const backend = await serverFixture(); const secrets = store();
  try {
    const client = new TeamClient(() => backend.url, secrets);
    await client.connect();
    assert.equal(client.account.user.id, user.id);
    assert.deepEqual([...secrets.values.values()], [cookie]);
    assert(backend.calls.some(c => c.path === '/api/ide/team/connect'));
    assert(!backend.calls.some(c => c.path === '/api/collaboration/login'));
    const before = backend.calls.length; await client.connect();
    assert.equal(backend.calls.length, before);
    const remote = new TeamClient(() => 'https://example.test/', store());
    await assert.rejects(remote.connect(), /local/);
  } finally { await backend.close(); }
});
test('switching backends never forwards a session to the new host and expiration removes the stored session',async()=>{
  const a=await serverFixture(),b=await serverFixture();const secrets=store();let url=a.url;
  try {
    const client=new TeamClient(()=>url,secrets);await client.login(user.email,'private password');
    url=b.url;assert.equal(client.account,undefined);assert.deepEqual(client.headers,{});
    await assert.rejects(client.me(),/Sign-in required/);
    assert(b.calls.every(c=>!c.cookie));
    url=a.url;a.reject();await assert.rejects(client.me(),/Sign-in required/);
    assert.equal(client.account,undefined);assert.equal(secrets.values.size,0);
  }finally{await a.close();await b.close();}
});
test('credential-bearing destinations, traversal, and redirects are rejected without leaking session headers',async()=>{
  const backend=await serverFixture();const secrets=store();
  try {
    const client=new TeamClient(()=>backend.url,secrets);await client.login(user.email,'private password');
    const before=backend.calls.length;
    for(const path of ['/api/../private','/api/%2e%2e/private','/api/x%2fy','https://other.example/api/x']) await assert.rejects(client.request(path),/destination|trusted/);
    assert.equal(backend.calls.length,before);
    const unsafe=new TeamClient(()=> 'http://name:password@127.0.0.1:3001/',secrets);
    await assert.rejects(unsafe.request('/api/collaboration/me'),/trusted/);
  }finally{await backend.close();}
});
