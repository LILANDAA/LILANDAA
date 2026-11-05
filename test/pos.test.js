'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const { amountInWords, formatMoney, formatQty } = require('../src/money');

let base, server, cookie = '';

async function call(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = raw ? await res.text() : res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}
const ok = async (...a) => {
  const r = await call(...a);
  assert.ok(r.status < 300, `${a[0]} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};

test.before(async () => {
  ({ server } = createApp({ dbFile: ':memory:' }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('money helpers', () => {
  assert.equal(formatMoney(742000), '7,420.00');
  assert.equal(formatQty(2), '02');
  assert.equal(formatQty(10), '10');
  assert.equal(amountInWords(742000), 'Seven thousand four hundred and twenty Kwacha only');
  assert.equal(amountInWords(100550), 'One thousand and five Kwacha and fifty Ngwee only');
});

test('requires login', async () => {
  assert.equal((await call('/api/products')).status, 401);
  assert.equal((await call('/api/login', { method: 'POST', body: { username: 'admin', password: 'nope' } })).status, 401);
  await ok('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  assert.equal((await ok('/api/me')).role, 'admin');
});

test('full quotation -> invoice -> delivery note -> receipt flow', async () => {
  await ok('/api/settings', { method: 'PUT', body: { next_numbers: { quotation: 258, invoice: 253, delivery_note: 253 } } });
  const trunk = await ok('/api/products', { method: 'POST', body: { name: 'Medium Size Trunk', sku: 'TRK-M', price: 110000, cost: 85000, stock: 10 } });
  const drink = await ok('/api/products', { method: 'POST', body: { name: 'Fruiticana Drink', price: 12000, stock: 50 } });
  const cust = await ok('/api/customers', { method: 'POST', body: { name: 'Kaundula Day Secondary School' } });

  const q = await ok('/api/documents', { method: 'POST', body: {
    type: 'quotation', customer_id: cust.id, date: '2026-10-22',
    items: [{ product_id: trunk.id, qty: 2 }, { product_id: drink.id, qty: 10 }, { description: 'Delivery to school', qty: 1, unit_price: 5000 }],
  } });
  assert.equal(q.number, 258);
  assert.equal(q.total, 220000 + 120000 + 5000);
  assert.equal(q.validity_days, 30);
  assert.equal((await ok(`/api/products/${trunk.id}`)).stock, 10, 'quotation does not move stock');

  const inv = await ok(`/api/documents/${q.id}/convert`, { method: 'POST', body: { date: '2026-10-24' } });
  assert.equal(inv.number, 253);
  assert.equal(inv.status, 'unpaid');
  assert.equal((await ok(`/api/documents/${q.id}`)).status, 'invoiced');
  assert.equal((await ok(`/api/products/${trunk.id}`)).stock, 8, 'invoice deducts stock');
  assert.equal((await call(`/api/documents/${q.id}/convert`, { method: 'POST', body: {} })).status, 400, 'cannot invoice twice');

  // Partial delivery (no drinks), then over-delivery is rejected.
  const trunkLine = inv.items.find((i) => i.product_id === trunk.id);
  const dn = await ok('/api/documents', { method: 'POST', body: { type: 'delivery_note', source_id: inv.id, delivered_by: 'Evans. K',
    items: [{ source_item_id: trunkLine.id, description: trunkLine.description, qty: 2 }] } });
  assert.equal(dn.number, 253);
  assert.equal((await ok(`/api/products/${trunk.id}`)).stock, 8, 'delivery note from invoice does not deduct again');
  const over = await call('/api/documents', { method: 'POST', body: { type: 'delivery_note', source_id: inv.id,
    items: [{ source_item_id: trunkLine.id, description: 'x', qty: 1 }] } });
  assert.equal(over.status, 400);
  const invAfter = await ok(`/api/documents/${inv.id}`);
  assert.equal(invAfter.items.find((i) => i.product_id === drink.id).remaining_qty, 10);

  // Payments
  const r1 = await ok('/api/documents', { method: 'POST', body: { type: 'receipt', source_id: inv.id, amount: 100000, payment_method: 'mobile_money' } });
  assert.equal(r1.amount_paid, 100000);
  let i2 = await ok(`/api/documents/${inv.id}`);
  assert.equal(i2.status, 'partial');
  assert.equal(i2.balance, 245000);
  assert.equal((await call('/api/documents', { method: 'POST', body: { type: 'receipt', source_id: inv.id, amount: 999999 } })).status, 400);
  await ok('/api/documents', { method: 'POST', body: { type: 'receipt', source_id: inv.id, amount: 245000 } });
  i2 = await ok(`/api/documents/${inv.id}`);
  assert.equal(i2.status, 'paid');

  // Cannot void invoice while receipts are live; voiding a receipt reopens the balance.
  assert.equal((await call(`/api/documents/${inv.id}/void`, { method: 'POST', body: { reason: 'test' } })).status, 409);
  await ok(`/api/documents/${r1.id}/void`, { method: 'POST', body: { reason: 'Wrong amount' } });
  assert.equal((await ok(`/api/documents/${inv.id}`)).status, 'partial');

  // Printing works for every type.
  for (const id of [q.id, inv.id, dn.id, r1.id]) {
    const page = await call(`/print/${id}`, { raw: true });
    assert.equal(page.status, 200);
    assert.match(page.data, /SANKA GENERAL DEALERS/);
  }
  const invPage = (await call(`/print/${inv.id}`, { raw: true })).data;
  assert.match(invPage, /INVOICE/);
  assert.match(invPage, /6019222500107/);
  assert.match(invPage, /3,450\.00/);
  assert.match((await call(`/print/${dn.id}`, { raw: true })).data, /DELIVERY NOTE[\s\S]*Delivered by/);
  assert.match((await call(`/print/${q.id}`, { raw: true })).data, /valid for[\s\S]*30/);
});

test('POS sale receipt with change, discount, VAT and stock', async () => {
  const p = await ok('/api/products', { method: 'POST', body: { name: 'Yale Pad Lock', price: 35000, stock: 5 } });
  const r = await ok('/api/documents', { method: 'POST', body: {
    type: 'receipt', payment_method: 'cash', amount_tendered: 100000, discount: 5000, vat_rate: 16,
    items: [{ product_id: p.id, qty: 2 }],
  } });
  // (70000 - 5000) * 1.16 = 75400
  assert.equal(r.total, 75400);
  assert.equal(r.change_given, 24600);
  assert.equal(r.customer_name, 'Cash Customer');
  assert.equal((await ok(`/api/products/${p.id}`)).stock, 3);
  assert.equal((await call('/api/documents', { method: 'POST', body: { type: 'receipt', amount_tendered: 100, items: [{ product_id: p.id, qty: 1 }] } })).status, 400);

  await ok(`/api/documents/${r.id}/void`, { method: 'POST', body: { reason: 'Customer changed mind' } });
  assert.equal((await ok(`/api/products/${p.id}`)).stock, 5, 'void restores stock');

  const slip = await call(`/print/${r.id}?format=thermal`, { raw: true });
  assert.match(slip.data, /VOID/);
});

test('blocks sale when negative stock is disallowed', async () => {
  await ok('/api/settings', { method: 'PUT', body: { allow_negative_stock: '0' } });
  const p = await ok('/api/products', { method: 'POST', body: { name: 'Small Size Trunk', price: 80000, stock: 1 } });
  const r = await call('/api/documents', { method: 'POST', body: { type: 'receipt', items: [{ product_id: p.id, qty: 2 }] } });
  assert.equal(r.status, 409);
  assert.equal((await ok(`/api/products/${p.id}`)).stock, 1, 'failed sale rolled back');
  await ok('/api/settings', { method: 'PUT', body: { allow_negative_stock: '1' } });
});

test('cashier permissions and reports', async () => {
  await ok('/api/users', { method: 'POST', body: { username: 'mary', full_name: 'Mary Banda', password: 'secret1', role: 'cashier' } });
  const adminCookie = cookie;
  await ok('/api/login', { method: 'POST', body: { username: 'mary', password: 'secret1' } });
  assert.equal((await call('/api/settings', { method: 'PUT', body: { vat_rate: '16' } })).status, 403);
  assert.equal((await call('/api/products', { method: 'POST', body: { name: 'x', price: 1 } })).status, 403);
  const sale = await ok('/api/documents', { method: 'POST', body: { type: 'receipt', items: [{ description: 'Photocopy', qty: 10, unit_price: 100 }] } });
  assert.equal(sale.prepared_by_name, 'Mary Banda');
  assert.equal((await call(`/api/documents/${sale.id}/void`, { method: 'POST', body: { reason: 'x' } })).status, 403);
  cookie = adminCookie;

  const rep = await ok('/api/reports/summary?from=2000-01-01&to=2100-01-01');
  assert.ok(rep.sales.total > 0);
  assert.ok(rep.outstanding.length >= 1);
  const csv = await call('/api/export/documents.csv?from=2000-01-01&to=2100-01-01', { raw: true });
  assert.match(csv.data, /^Type,Number,Date/);
});
