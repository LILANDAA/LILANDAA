'use strict';
// Business logic for the POS: products, customers, documents (quotation,
// invoice, delivery note, receipt), stock and reports.
//
// Conventions:
//  * Every money value going in and out of this module is integer ngwee.
//  * Stock is deducted when goods are sold: on an invoice, on a POS sale
//    receipt, or on a delivery note that is NOT linked to an invoice (the
//    invoice already deducted it). Voiding a document reverses its stock.

const { transaction, hashPassword, DOC_TYPES } = require('./db');
const { HttpError } = require('./money');

const DOC_LABELS = {
  quotation: 'Quotation',
  invoice: 'Invoice',
  delivery_note: 'Delivery Note',
  receipt: 'Receipt',
};
const PAYMENT_METHODS = ['cash', 'mobile_money', 'bank_transfer', 'card', 'cheque'];

const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function assert(cond, message, status = 400) {
  if (!cond) throw new HttpError(status, message);
}

function intMoney(v, field) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  assert(Number.isInteger(n), `${field} must be a whole number of ngwee`);
  return n;
}

function cleanStr(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function createServices(db) {
  // ---------------------------------------------------------------- settings
  function getSettings() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const counters = db.prepare('SELECT type, next_number FROM counters').all();
    settings.next_numbers = Object.fromEntries(counters.map((c) => [c.type, c.next_number]));
    return settings;
  }

  function updateSettings(patch) {
    return transaction(db, () => {
      const upsert = db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      );
      for (const [k, v] of Object.entries(patch || {})) {
        if (k === 'next_numbers') continue;
        assert(/^[a-z_]{1,40}$/.test(k), `Invalid setting ${k}`);
        upsert.run(k, v === null || v === undefined ? '' : String(v));
      }
      if (patch && patch.next_numbers) {
        for (const [type, n] of Object.entries(patch.next_numbers)) {
          assert(DOC_TYPES.includes(type), `Unknown document type ${type}`);
          const num = Number(n);
          assert(Number.isInteger(num) && num > 0, 'Next number must be a positive whole number');
          const taken = db.prepare('SELECT 1 FROM documents WHERE type = ? AND number >= ?').get(type, num);
          assert(!taken, `${DOC_LABELS[type]} numbers from ${num} are already in use`);
          db.prepare('UPDATE counters SET next_number = ? WHERE type = ?').run(num, type);
        }
      }
      return getSettings();
    });
  }

  // ------------------------------------------------------------------- users
  const publicUser = (u) => u && ({ id: u.id, username: u.username, full_name: u.full_name, role: u.role, active: !!u.active });

  function listUsers() {
    return db.prepare('SELECT * FROM users ORDER BY username').all().map(publicUser);
  }

  function createUser({ username, full_name, password, role = 'cashier' }) {
    assert(cleanStr(username), 'Username is required');
    assert(cleanStr(full_name), 'Full name is required');
    assert(password && String(password).length >= 6, 'Password must be at least 6 characters');
    assert(['admin', 'cashier'].includes(role), 'Role must be admin or cashier');
    const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username.trim());
    assert(!exists, 'Username already exists', 409);
    const r = db.prepare('INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(username.trim(), full_name.trim(), hashPassword(password), role);
    return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid));
  }

  function updateUser(id, { full_name, password, role, active }) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    assert(user, 'User not found', 404);
    if (full_name !== undefined) assert(cleanStr(full_name), 'Full name is required');
    if (role !== undefined) assert(['admin', 'cashier'].includes(role), 'Role must be admin or cashier');
    if (password !== undefined && password !== '') assert(String(password).length >= 6, 'Password must be at least 6 characters');
    const demoting = (role !== undefined && role !== 'admin') || active === false;
    if (user.role === 'admin' && demoting) {
      const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;
      assert(admins > 1, 'At least one active administrator is required');
    }
    db.prepare(`UPDATE users SET full_name = COALESCE(?, full_name), role = COALESCE(?, role),
      active = COALESCE(?, active), password_hash = COALESCE(?, password_hash) WHERE id = ?`).run(
      full_name !== undefined ? full_name.trim() : null,
      role ?? null,
      active === undefined ? null : active ? 1 : 0,
      password ? hashPassword(password) : null,
      id
    );
    if (active === false || password) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  }

  // ---------------------------------------------------------------- products
  function listProducts({ q, active, low_stock } = {}) {
    const where = [];
    const params = [];
    if (q) {
      where.push('(name LIKE ? OR sku LIKE ? OR category LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (active !== undefined && active !== '') {
      where.push('active = ?');
      params.push(active === true || active === '1' || active === 'true' ? 1 : 0);
    }
    if (low_stock === '1' || low_stock === true) where.push('track_stock = 1 AND stock <= reorder_level');
    const sql = `SELECT * FROM products ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name`;
    return db.prepare(sql).all(...params);
  }

  function getProduct(id) {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    assert(p, 'Product not found', 404);
    return p;
  }

  function productFields(input, existing = {}) {
    const merged = { ...existing, ...input };
    const name = cleanStr(merged.name);
    assert(name, 'Product name is required');
    const fields = {
      sku: cleanStr(merged.sku),
      name,
      category: cleanStr(merged.category),
      unit: cleanStr(merged.unit),
      price: intMoney(merged.price, 'Price'),
      cost: intMoney(merged.cost, 'Cost'),
      reorder_level: Number(merged.reorder_level || 0),
      track_stock: merged.track_stock === false || merged.track_stock === 0 ? 0 : 1,
      active: merged.active === false || merged.active === 0 ? 0 : 1,
    };
    assert(fields.price >= 0 && fields.cost >= 0, 'Prices cannot be negative');
    if (fields.sku) {
      const dup = db.prepare('SELECT id FROM products WHERE sku = ? AND id != ?').get(fields.sku, existing.id || 0);
      assert(!dup, `SKU/barcode ${fields.sku} is already used by another product`, 409);
    }
    return fields;
  }

  function createProduct(input, user) {
    return transaction(db, () => {
      const f = productFields(input);
      const r = db.prepare(`INSERT INTO products (sku, name, category, unit, price, cost, reorder_level, track_stock, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(f.sku, f.name, f.category, f.unit, f.price, f.cost, f.reorder_level, f.track_stock, f.active);
      const opening = Number(input.stock || 0);
      if (opening) moveStock(r.lastInsertRowid, opening, 'opening', null, 'Opening stock', user);
      return getProduct(r.lastInsertRowid);
    });
  }

  function updateProduct(id, input) {
    const existing = getProduct(id);
    const f = productFields(input, existing);
    db.prepare(`UPDATE products SET sku = ?, name = ?, category = ?, unit = ?, price = ?, cost = ?, reorder_level = ?,
      track_stock = ?, active = ? WHERE id = ?`).run(f.sku, f.name, f.category, f.unit, f.price, f.cost, f.reorder_level, f.track_stock, f.active, id);
    return getProduct(id);
  }

  function moveStock(productId, qtyChange, reason, documentId, note, user) {
    db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(qtyChange, productId);
    db.prepare('INSERT INTO stock_movements (product_id, qty_change, reason, document_id, note, user_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(productId, qtyChange, reason, documentId, note, user ? user.id : null);
  }

  function adjustStock(id, { qty_change, reason = 'adjustment', note }, user) {
    const qty = Number(qty_change);
    assert(Number.isFinite(qty) && qty !== 0, 'Quantity change must be a non-zero number');
    assert(['restock', 'adjustment', 'damage', 'return', 'count'].includes(reason), 'Invalid reason');
    return transaction(db, () => {
      getProduct(id);
      moveStock(id, qty, reason, null, cleanStr(note), user);
      return getProduct(id);
    });
  }

  function productMovements(id) {
    getProduct(id);
    return db.prepare(`SELECT m.*, d.type AS document_type, d.number AS document_number, u.full_name AS user_name
      FROM stock_movements m LEFT JOIN documents d ON d.id = m.document_id LEFT JOIN users u ON u.id = m.user_id
      WHERE m.product_id = ? ORDER BY m.id DESC LIMIT 200`).all(id);
  }

  // --------------------------------------------------------------- customers
  function listCustomers({ q } = {}) {
    const balanceSql = `(SELECT COALESCE(SUM(total - amount_paid), 0) FROM documents
      WHERE customer_id = c.id AND type = 'invoice' AND voided_at IS NULL)`;
    if (q) {
      return db.prepare(`SELECT c.*, ${balanceSql} AS balance FROM customers c
        WHERE name LIKE ? OR phone LIKE ? OR tpin LIKE ? ORDER BY name`).all(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    return db.prepare(`SELECT c.*, ${balanceSql} AS balance FROM customers c ORDER BY name`).all();
  }

  function getCustomer(id) {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    assert(c, 'Customer not found', 404);
    c.documents = db.prepare(`SELECT id, type, number, date, status, total, amount_paid, voided_at FROM documents
      WHERE customer_id = ? ORDER BY date DESC, id DESC`).all(id);
    c.balance = c.documents
      .filter((d) => d.type === 'invoice' && !d.voided_at)
      .reduce((s, d) => s + d.total - d.amount_paid, 0);
    return c;
  }

  function customerFields(input) {
    const name = cleanStr(input.name);
    assert(name, 'Customer name is required');
    return [name, cleanStr(input.address), cleanStr(input.phone), cleanStr(input.email), cleanStr(input.tpin), cleanStr(input.notes)];
  }

  function createCustomer(input) {
    const r = db.prepare('INSERT INTO customers (name, address, phone, email, tpin, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(...customerFields(input));
    return getCustomer(r.lastInsertRowid);
  }

  function updateCustomer(id, input) {
    const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    assert(existing, 'Customer not found', 404);
    db.prepare('UPDATE customers SET name = ?, address = ?, phone = ?, email = ?, tpin = ?, notes = ? WHERE id = ?')
      .run(...customerFields({ ...existing, ...input }), id);
    return getCustomer(id);
  }

  // --------------------------------------------------------------- documents
  function nextNumber(type) {
    const row = db.prepare('SELECT next_number FROM counters WHERE type = ?').get(type);
    db.prepare('UPDATE counters SET next_number = next_number + 1 WHERE type = ?').run(type);
    return row.next_number;
  }

  function listDocuments({ type, status, q, from, to, customer_id, limit = 200 } = {}) {
    const where = [];
    const params = [];
    if (type) { where.push('type = ?'); params.push(type); }
    if (status === 'void') where.push('voided_at IS NOT NULL');
    else if (status) { where.push('status = ? AND voided_at IS NULL'); params.push(status); }
    if (from) { where.push('date >= ?'); params.push(from); }
    if (to) { where.push('date <= ?'); params.push(to); }
    if (customer_id) { where.push('customer_id = ?'); params.push(Number(customer_id)); }
    if (q) {
      where.push('(customer_name LIKE ? OR CAST(number AS TEXT) = ?)');
      params.push(`%${q}%`, String(q).replace(/\D/g, ''));
    }
    const sql = `SELECT * FROM documents ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY date DESC, id DESC LIMIT ?`;
    return db.prepare(sql).all(...params, Math.min(Number(limit) || 200, 5000));
  }

  function getDocument(id) {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
    assert(doc, 'Document not found', 404);
    doc.items = db.prepare('SELECT * FROM document_items WHERE document_id = ? ORDER BY position, id').all(id);
    doc.source = doc.source_id
      ? db.prepare('SELECT id, type, number, date, total FROM documents WHERE id = ?').get(doc.source_id)
      : null;
    doc.related = db.prepare(`SELECT id, type, number, date, status, total, amount_paid, voided_at FROM documents
      WHERE source_id = ? ORDER BY id`).all(id);
    if (doc.type === 'invoice') {
      // How much of each invoice line has already gone out on delivery notes.
      const delivered = db.prepare(`SELECT di.source_item_id, SUM(di.qty) AS qty FROM document_items di
        JOIN documents d ON d.id = di.document_id
        WHERE d.source_id = ? AND d.type = 'delivery_note' AND d.voided_at IS NULL GROUP BY di.source_item_id`).all(id);
      const map = Object.fromEntries(delivered.map((r) => [r.source_item_id, r.qty]));
      for (const item of doc.items) {
        item.delivered_qty = map[item.id] || 0;
        item.remaining_qty = Math.max(0, item.qty - item.delivered_qty);
      }
      doc.balance = doc.total - doc.amount_paid;
    }
    return doc;
  }

  function normaliseItems(items, { requirePrices }) {
    assert(Array.isArray(items) && items.length > 0, 'Add at least one item');
    assert(items.length <= 200, 'Too many items');
    return items.map((it, i) => {
      const qty = Number(it.qty);
      assert(Number.isFinite(qty) && qty > 0, `Line ${i + 1}: quantity must be greater than zero`);
      let product = null;
      if (it.product_id) {
        product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(it.product_id));
        assert(product, `Line ${i + 1}: product not found`);
      }
      const description = cleanStr(it.description) || (product && product.name);
      assert(description, `Line ${i + 1}: description is required`);
      const unit_price = it.unit_price === undefined || it.unit_price === null || it.unit_price === ''
        ? (product ? product.price : 0)
        : intMoney(it.unit_price, `Line ${i + 1} unit price`);
      assert(unit_price >= 0, `Line ${i + 1}: unit price cannot be negative`);
      if (requirePrices) assert(unit_price > 0 || it.allow_zero, `Line ${i + 1}: unit price is required`);
      return {
        product_id: product ? product.id : null,
        source_item_id: it.source_item_id ? Number(it.source_item_id) : null,
        description,
        qty,
        unit_price,
        amount: Math.round(qty * unit_price),
        product,
      };
    });
  }

  function computeTotals(items, discount, vatRate) {
    const subtotal = items.reduce((s, it) => s + it.amount, 0);
    assert(discount >= 0 && discount <= subtotal, 'Discount must be between zero and the sub total');
    assert(vatRate >= 0 && vatRate <= 100, 'VAT rate must be between 0 and 100');
    const vat_amount = Math.round(((subtotal - discount) * vatRate) / 100);
    return { subtotal, discount, vat_rate: vatRate, vat_amount, total: subtotal - discount + vat_amount };
  }

  function resolveCustomer(input) {
    if (input.customer_id) {
      const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(input.customer_id));
      assert(c, 'Customer not found');
      return {
        customer_id: c.id,
        customer_name: cleanStr(input.customer_name) || c.name,
        customer_address: cleanStr(input.customer_address) ?? (c.address || ''),
      };
    }
    return {
      customer_id: null,
      customer_name: cleanStr(input.customer_name) || '',
      customer_address: cleanStr(input.customer_address) || '',
    };
  }

  function deductStock(items, documentId, user, reason) {
    const allowNegative = getSettings().allow_negative_stock !== '0';
    for (const it of items) {
      if (!it.product || !it.product.track_stock) continue;
      const current = db.prepare('SELECT stock FROM products WHERE id = ?').get(it.product.id).stock;
      assert(allowNegative || current >= it.qty,
        `Not enough stock for ${it.product.name}: ${current} available, ${it.qty} required`, 409);
      moveStock(it.product.id, -it.qty, reason, documentId, null, user);
    }
  }

  function insertDocument(fields, items) {
    const cols = Object.keys(fields);
    const r = db.prepare(`INSERT INTO documents (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...cols.map((c) => fields[c]));
    const id = r.lastInsertRowid;
    const ins = db.prepare(`INSERT INTO document_items (document_id, position, product_id, source_item_id, description, qty, unit_price, amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    items.forEach((it, i) => ins.run(id, i, it.product_id, it.source_item_id, it.description, it.qty, it.unit_price, it.amount));
    return Number(id);
  }

  function refreshInvoicePayment(invoiceId) {
    const paid = db.prepare(`SELECT COALESCE(SUM(amount_paid), 0) AS paid FROM documents
      WHERE source_id = ? AND type = 'receipt' AND voided_at IS NULL`).get(invoiceId).paid;
    const inv = db.prepare('SELECT total FROM documents WHERE id = ?').get(invoiceId);
    const status = paid <= 0 ? 'unpaid' : paid >= inv.total ? 'paid' : 'partial';
    db.prepare('UPDATE documents SET amount_paid = ?, status = ? WHERE id = ?').run(paid, status, invoiceId);
  }

  function createDocument(input, user) {
    const type = input.type;
    assert(DOC_TYPES.includes(type), 'Unknown document type');
    const date = cleanStr(input.date) || today();
    assert(/^\d{4}-\d{2}-\d{2}$/.test(date), 'Date must be YYYY-MM-DD');
    const settings = getSettings();

    return transaction(db, () => {
      const base = {
        type,
        date,
        ...resolveCustomer(input),
        notes: cleanStr(input.notes),
        prepared_by: user ? user.id : null,
        prepared_by_name: cleanStr(input.prepared_by_name) || (user ? user.full_name : null),
      };
      let source = null;
      if (input.source_id) {
        source = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(input.source_id));
        assert(source, 'Source document not found');
        assert(!source.voided_at, 'Source document has been voided');
        base.source_id = source.id;
        if (!input.customer_id && !input.customer_name) {
          base.customer_id = source.customer_id;
          base.customer_name = source.customer_name;
          base.customer_address = source.customer_address;
        }
      }

      if (type === 'receipt' && source) {
        // Payment received against an invoice.
        assert(source.type === 'invoice', 'Payments can only be recorded against an invoice');
        const amount = intMoney(input.amount, 'Amount');
        const balance = source.total - source.amount_paid;
        assert(amount > 0, 'Payment amount must be greater than zero');
        assert(amount <= balance, `Payment exceeds the balance due (${balance / 100})`);
        const method = input.payment_method || 'cash';
        assert(PAYMENT_METHODS.includes(method), 'Invalid payment method');
        const tendered = input.amount_tendered ? intMoney(input.amount_tendered, 'Amount tendered') : amount;
        assert(tendered >= amount, 'Amount tendered is less than the payment');
        const id = insertDocument({
          ...base,
          number: nextNumber(type),
          status: 'paid',
          subtotal: amount,
          total: amount,
          amount_paid: amount,
          payment_method: method,
          payment_reference: cleanStr(input.payment_reference),
          amount_tendered: tendered,
          change_given: tendered - amount,
        }, [{ product_id: null, source_item_id: null, qty: 1, unit_price: amount, amount,
          description: `Payment for Invoice No. ${source.number}` }]);
        refreshInvoicePayment(source.id);
        return getDocument(id);
      }

      if (type === 'delivery_note') {
        const items = normaliseItems(input.items, { requirePrices: false });
        if (source) {
          assert(source.type === 'invoice', 'Delivery notes can only be created from an invoice');
          const srcDoc = getDocument(source.id);
          const lines = Object.fromEntries(srcDoc.items.map((it) => [it.id, it]));
          for (const it of items) {
            const line = lines[it.source_item_id];
            assert(line, `"${it.description}" is not on Invoice No. ${source.number}`);
            assert(it.qty <= line.remaining_qty + 1e-9,
              `Cannot deliver ${it.qty} of "${line.description}"; only ${line.remaining_qty} left to deliver`);
            it.product_id = line.product_id;
            it.unit_price = line.unit_price;
            it.amount = Math.round(it.qty * line.unit_price);
          }
        }
        const totals = computeTotals(items, 0, 0);
        const id = insertDocument({
          ...base,
          number: nextNumber(type),
          status: 'delivered',
          ...totals,
          delivered_by: cleanStr(input.delivered_by) || (user ? user.full_name : null),
        }, items);
        if (!source) deductStock(items, id, user, 'delivery');
        return getDocument(id);
      }

      // quotation, invoice and POS sale receipt share line-item pricing.
      const items = normaliseItems(input.items, { requirePrices: false });
      const vatRate = input.vat_rate === undefined || input.vat_rate === '' ? Number(settings.vat_rate || 0) : Number(input.vat_rate);
      const totals = computeTotals(items, intMoney(input.discount, 'Discount'), vatRate);

      if (type === 'quotation') {
        const validity = Number(input.validity_days || settings.quotation_validity_days || 30);
        assert(Number.isInteger(validity) && validity > 0, 'Validity must be a whole number of days');
        const id = insertDocument({ ...base, number: nextNumber(type), status: 'open', ...totals, validity_days: validity }, items);
        return getDocument(id);
      }

      if (type === 'invoice') {
        if (source) {
          assert(source.type === 'quotation', 'Invoices can only be created from a quotation');
          assert(source.status === 'open', `Quotation No. ${source.number} has already been invoiced`);
        }
        const id = insertDocument({ ...base, number: nextNumber(type), status: 'unpaid', ...totals }, items);
        deductStock(items, id, user, 'sale');
        if (source) db.prepare("UPDATE documents SET status = 'invoiced' WHERE id = ?").run(source.id);
        return getDocument(id);
      }

      // POS sale receipt: paid in full at the counter.
      assert(!source, 'A sale receipt cannot have a source document');
      const method = input.payment_method || 'cash';
      assert(PAYMENT_METHODS.includes(method), 'Invalid payment method');
      const tendered = input.amount_tendered === undefined || input.amount_tendered === ''
        ? totals.total
        : intMoney(input.amount_tendered, 'Amount tendered');
      assert(tendered >= totals.total, 'Amount tendered is less than the total');
      const id = insertDocument({
        ...base,
        customer_name: base.customer_name || 'Cash Customer',
        number: nextNumber(type),
        status: 'paid',
        ...totals,
        amount_paid: totals.total,
        payment_method: method,
        payment_reference: cleanStr(input.payment_reference),
        amount_tendered: tendered,
        change_given: tendered - totals.total,
      }, items);
      deductStock(items, id, user, 'sale');
      return getDocument(id);
    });
  }

  function convertQuotation(id, user, overrides = {}) {
    const q = getDocument(id);
    assert(q.type === 'quotation', 'Only quotations can be converted to invoices');
    return createDocument({
      type: 'invoice',
      source_id: q.id,
      customer_id: q.customer_id,
      customer_name: q.customer_name,
      customer_address: q.customer_address,
      date: overrides.date,
      discount: q.discount,
      vat_rate: q.vat_rate,
      notes: q.notes,
      items: q.items.map((it) => ({ product_id: it.product_id, description: it.description, qty: it.qty, unit_price: it.unit_price })),
    }, user);
  }

  function voidDocument(id, reason, user) {
    assert(cleanStr(reason), 'A reason is required to void a document');
    return transaction(db, () => {
      const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
      assert(doc, 'Document not found', 404);
      assert(!doc.voided_at, 'Document is already void');
      // An invoice made from a quotation stands on its own, so a quotation can
      // always be voided; anything else needs its follow-ups voided first.
      const live = doc.type === 'quotation' ? []
        : db.prepare('SELECT type, number FROM documents WHERE source_id = ? AND voided_at IS NULL').all(id);
      assert(live.length === 0,
        `Void the linked ${live.map((d) => `${DOC_LABELS[d.type]} No. ${d.number}`).join(', ')} first`, 409);

      const movements = db.prepare('SELECT * FROM stock_movements WHERE document_id = ?').all(id);
      for (const m of movements) moveStock(m.product_id, -m.qty_change, 'void', id, `Void ${DOC_LABELS[doc.type]} No. ${doc.number}`, user);

      db.prepare("UPDATE documents SET voided_at = datetime('now'), voided_by = ?, void_reason = ?, status = 'void' WHERE id = ?")
        .run(user ? user.id : null, reason.trim(), id);
      if (doc.source_id) {
        const src = db.prepare('SELECT * FROM documents WHERE id = ?').get(doc.source_id);
        if (doc.type === 'receipt' && src.type === 'invoice') refreshInvoicePayment(src.id);
        if (doc.type === 'invoice' && src.type === 'quotation' && !src.voided_at) {
          db.prepare("UPDATE documents SET status = 'open' WHERE id = ?").run(src.id);
        }
      }
      return getDocument(id);
    });
  }

  // ----------------------------------------------------------------- reports
  function report({ from, to } = {}) {
    from = from || today();
    to = to || from;
    const range = [from, to];
    const live = "voided_at IS NULL AND date BETWEEN ? AND ?";

    const salesRows = db.prepare(`SELECT type, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total,
      COALESCE(SUM(discount), 0) AS discount, COALESCE(SUM(vat_amount), 0) AS vat
      FROM documents WHERE ${live} AND (type = 'invoice' OR (type = 'receipt' AND source_id IS NULL)) GROUP BY type`).all(...range);
    const pos = salesRows.find((r) => r.type === 'receipt') || { count: 0, total: 0, discount: 0, vat: 0 };
    const inv = salesRows.find((r) => r.type === 'invoice') || { count: 0, total: 0, discount: 0, vat: 0 };

    const payments = db.prepare(`SELECT payment_method AS method, COUNT(*) AS count, SUM(amount_paid) AS total
      FROM documents WHERE ${live} AND type = 'receipt' GROUP BY payment_method ORDER BY total DESC`).all(...range);

    const topProducts = db.prepare(`SELECT di.description, di.product_id, SUM(di.qty) AS qty, SUM(di.amount) AS total,
      SUM(di.qty * COALESCE(p.cost, 0)) AS cost
      FROM document_items di JOIN documents d ON d.id = di.document_id LEFT JOIN products p ON p.id = di.product_id
      WHERE d.voided_at IS NULL AND d.date BETWEEN ? AND ? AND (d.type = 'invoice' OR (d.type = 'receipt' AND d.source_id IS NULL))
      GROUP BY COALESCE(CAST(di.product_id AS TEXT), di.description) ORDER BY total DESC LIMIT 20`).all(...range);

    const daily = db.prepare(`SELECT date, SUM(total) AS total, COUNT(*) AS count FROM documents
      WHERE ${live} AND (type = 'invoice' OR (type = 'receipt' AND source_id IS NULL)) GROUP BY date ORDER BY date`).all(...range);

    const outstanding = db.prepare(`SELECT id, number, date, customer_name, total, amount_paid, total - amount_paid AS balance
      FROM documents WHERE type = 'invoice' AND voided_at IS NULL AND status != 'paid' ORDER BY date`).all();

    const lowStock = db.prepare(`SELECT id, name, sku, stock, reorder_level FROM products
      WHERE active = 1 AND track_stock = 1 AND stock <= reorder_level ORDER BY stock`).all();

    const openQuotes = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total FROM documents
      WHERE type = 'quotation' AND status = 'open' AND voided_at IS NULL`).get();

    const grossProfit = topProducts.reduce((s, p) => s + p.total - Math.round(p.cost), 0);

    return {
      from, to,
      sales: { total: pos.total + inv.total, pos_sales: pos, invoices: inv, gross_profit_top_items: grossProfit },
      payments,
      collected: payments.reduce((s, p) => s + p.total, 0),
      daily,
      top_products: topProducts,
      outstanding,
      outstanding_total: outstanding.reduce((s, o) => s + o.balance, 0),
      low_stock: lowStock,
      open_quotations: openQuotes,
    };
  }

  function backup() {
    const tables = ['settings', 'counters', 'users', 'products', 'customers', 'documents', 'document_items', 'stock_movements'];
    const out = { exported_at: new Date().toISOString() };
    for (const t of tables) {
      out[t] = db.prepare(`SELECT * FROM ${t}`).all();
      if (t === 'users') out[t] = out[t].map(({ password_hash, ...u }) => u);
    }
    return out;
  }

  return {
    getSettings, updateSettings,
    listUsers, createUser, updateUser,
    listProducts, getProduct, createProduct, updateProduct, adjustStock, productMovements,
    listCustomers, getCustomer, createCustomer, updateCustomer,
    listDocuments, getDocument, createDocument, convertQuotation, voidDocument,
    report, backup,
  };
}

module.exports = { createServices, DOC_LABELS, PAYMENT_METHODS, today };
