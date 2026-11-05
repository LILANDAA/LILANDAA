'use strict';
// Loads demo data: the products from the sample stationery and the same
// Quotation 258, Invoice 253 and Delivery Note 253 for Kaundula Day Secondary
// School, plus a till sale receipt. Usage: npm run demo [-- path/to/db]
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { createServices } = require('../src/services');

const dbFile = process.argv[2] || process.env.DB_FILE || path.join(__dirname, '..', 'data', 'pos.db');
const db = openDatabase(dbFile);
const svc = createServices(db);
const admin = db.prepare("SELECT * FROM users WHERE username = 'admin'").get();
const user = { ...admin, full_name: 'Evans Kabwe' };

if (db.prepare('SELECT COUNT(*) AS n FROM documents').get().n > 0) {
  console.log('Database already has documents; demo data not loaded.');
  process.exit(0);
}

const products = [
  ['TRK-M', 'Medium Size Trunk', 'Trunks', 'pcs', 1100, 850, 10],
  ['TRK-S', 'Small Size Trunk', 'Trunks', 'pcs', 800, 600, 8],
  ['YALE-PL', 'Yale Pad Lock', 'Hardware', 'pcs', 350, 260, 40],
  ['FRT-DRK', 'Fruiticana Drink', 'Beverages', 'pcs', 120, 90, 60],
  ['VAT-750', 'Vatra Still 12 x 750mls', 'Beverages', 'pack', 60, 42, 50],
  ['JOE-90', 'Joe Shorties 90g x 24', 'Snacks', 'box', 130, 100, 30],
  ['A4-RM', 'A4 Paper Ream', 'Stationery', 'ream', 95, 70, 25],
  ['PEN-BL', 'Ball Pen (Blue) x 50', 'Stationery', 'box', 75, 50, 20],
].map(([sku, name, category, unit, price, cost, stock]) =>
  svc.createProduct({ sku, name, category, unit, price: price * 100, cost: cost * 100, stock, reorder_level: 5 }, user));

const school = svc.createCustomer({ name: 'Kaundula Day Secondary School', address: '', phone: '' });
svc.updateSettings({ next_numbers: { quotation: 258, invoice: 253, delivery_note: 253, receipt: 101 } });

const lines = [[0, 2], [1, 1], [2, 6], [3, 10], [4, 10], [5, 4]];
const items = lines.map(([i, qty]) => ({ product_id: products[i].id, description: products[i].name + (i < 2 && qty > 1 ? 's' : ''), qty }));
items[2].description = 'Yale Pad Locks';
items[5].description = 'Joe Shorties 90g x 24';

const quote = svc.createDocument({ type: 'quotation', customer_id: school.id, date: '2026-10-22', validity_days: 30, items }, user);
const invoice = svc.convertQuotation(quote.id, user, { date: '2026-10-24' });
// Partial delivery: everything except the Fruiticana drinks.
svc.createDocument({
  type: 'delivery_note', source_id: invoice.id, date: '2026-10-24', delivered_by: 'Evans. K',
  items: invoice.items.filter((it) => !/Fruiticana/.test(it.description)).map((it) => ({ source_item_id: it.id, description: it.description, qty: it.qty })),
}, user);
svc.createDocument({ type: 'receipt', source_id: invoice.id, date: '2026-10-28', amount: 400000, payment_method: 'bank_transfer', payment_reference: 'ZANACO-TRF-8812' }, user);
svc.createDocument({
  type: 'receipt', date: '2026-10-28', payment_method: 'cash', amount_tendered: 100000,
  items: [{ product_id: products[3].id, qty: 3 }, { product_id: products[6].id, qty: 2 }],
}, user);

console.log(`Demo data loaded into ${dbFile}`);
console.log(`Quotation ${quote.number}, Invoice ${invoice.number}, Delivery Note 253, Receipts 101-102`);
