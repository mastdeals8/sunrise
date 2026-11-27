import assert from 'node:assert';
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { registerRoutes } from '../server/routes';
import { JWT_SECRET } from '../server/config';

async function testRealRoutes() {
  console.log('--- Starting Sunrise ERP Real Express Routes Integration Test ---');
  
  const app = express();
  app.use(express.json());
  const server = await registerRoutes(app);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test Express server running at ${baseUrl}`);

  // Generate authentic JWT signed with JWT_SECRET for User ID 1 (Admin/SuperAdmin)
  const authToken = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

  async function apiGet(path: string, headers: Record<string, string> = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
        ...headers,
      },
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, body: json };
  }

  // 1. Test Finance Dashboard API
  console.log('1. Testing /api/finance/dashboard...');
  const dashRes = await apiGet('/api/finance/dashboard');
  assert.strictEqual(dashRes.status, 200, 'Dashboard endpoint returned 200');
  assert.ok(typeof dashRes.body.totalRevenue === 'number', 'totalRevenue is number');
  assert.ok(typeof dashRes.body.totalReceivables === 'number', 'totalReceivables is number');
  assert.ok(dashRes.body.totalRevenue >= 0, 'totalRevenue is non-negative');
  assert.ok(dashRes.body.totalReceivables >= 0, 'totalReceivables is non-negative');
  console.log(`   ✓ Revenue: ₹${dashRes.body.totalRevenue}, AR: ₹${dashRes.body.totalReceivables}`);

  // 2. Test Customer Ledgers Summary API
  console.log('2. Testing /api/finance/ledgers/summary...');
  const ledgerRes = await apiGet('/api/finance/ledgers/summary');
  assert.strictEqual(ledgerRes.status, 200, 'Ledgers summary returned 200');
  assert.ok(Array.isArray(ledgerRes.body), 'Ledgers summary is an array');
  console.log(`   ✓ Retrieved ${ledgerRes.body.length} client ledger summaries`);
  if (ledgerRes.body.length > 0) {
    const first = ledgerRes.body[0];
    assert.ok('clientId' in first, 'Ledger item contains clientId');
    assert.ok('totalBilled' in first, 'Ledger item contains totalBilled');
    assert.ok('totalOutstanding' in first, 'Ledger item contains totalOutstanding');
    console.log(`   ✓ Sample ledger [Client ${first.clientId} - ${first.clientName}]: Billed ₹${first.totalBilled}, Outstanding ₹${first.totalOutstanding}`);
  }

  // 3. Test Aging Report API
  console.log('3. Testing /api/finance/aging...');
  const agingRes = await apiGet('/api/finance/aging');
  assert.strictEqual(agingRes.status, 200, 'Aging endpoint returned 200');
  assert.ok(agingRes.body && Array.isArray(agingRes.body.clients), 'Aging report contains clients array');
  assert.ok(agingRes.body.totals && typeof agingRes.body.totals.total === 'number', 'Aging report contains totals');
  console.log(`   ✓ Retrieved aging for ${agingRes.body.clients.length} clients; Total outstanding: ₹${agingRes.body.totals.total}`);
  for (const item of agingRes.body.clients) {
    assert.ok(item.total >= 0, 'Outstanding is non-negative');
    const bracketSum = Number(item.current || 0) + Number(item.b30 || 0) + Number(item.b60 || 0) + Number(item.b90 || 0) + Number(item.over90 || 0);
    assert.ok(Math.abs(bracketSum - Number(item.total)) < 0.05, `Aging brackets match total: ${bracketSum} vs ${item.total}`);
  }

  // 4. Test Collections Report API
  console.log('4. Testing /api/finance/collections...');
  const collRes = await apiGet('/api/finance/collections');
  assert.strictEqual(collRes.status, 200, 'Collections endpoint returned 200');
  assert.ok(Array.isArray(collRes.body), 'Collections report is an array');
  console.log(`   ✓ Retrieved ${collRes.body.length} actionable collection invoices`);
  for (const inv of collRes.body) {
    assert.ok(inv.balance > 0, 'Open collection invoice has positive balance');
    assert.ok(!['draft', 'cancelled', 'paid'].includes(inv.status), 'No drafts or paid in collections');
  }

  // 5. Verify Company Isolation via Header
  console.log('5. Testing company isolation (x-company-id)...');
  const comp1Res = await apiGet('/api/finance/dashboard', { 'x-company-id': '1' });
  assert.strictEqual(comp1Res.status, 200, 'Company 1 dashboard returned 200');
  console.log(`   ✓ Company 1 Revenue: ₹${comp1Res.body.totalRevenue}`);

  // 6. Test Specific Client Ledger Details
  console.log('6. Testing /api/finance/ledgers/client/1 (ABFRL)...');
  const client1Ledger = await apiGet('/api/finance/ledgers/client/1');
  assert.strictEqual(client1Ledger.status, 200, 'Client 1 ledger returned 200');
  assert.ok(client1Ledger.body.client, 'Client object exists');
  assert.ok(Array.isArray(client1Ledger.body.statement), 'Statement list is an array');
  assert.ok(typeof client1Ledger.body.totalOutstanding === 'number', 'totalOutstanding is number');
  console.log(`   ✓ ABFRL Ledger: ${client1Ledger.body.statement.length} statement entries, Total Outstanding: ₹${client1Ledger.body.totalOutstanding}`);

  // Clean shutdown
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  console.log('--- All Real Express Route Integration Tests Passed Successfully! ---');
}

testRealRoutes().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
