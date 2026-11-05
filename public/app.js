'use strict';
/* Point of Sale single-page app (no framework, no build step).
   All money from the API is integer ngwee; inputs are typed in Kwacha. */

// ------------------------------------------------------------------ helpers
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => {
  const neg = n < 0; const a = Math.abs(Math.round(n || 0));
  const s = `${Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(a % 100).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
};
const K = (n) => `${state.settings.currency || 'K'} ${money(n)}`;
const toNgwee = (v) => {
  const n = Number(String(v ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const kw = (ngwee) => (ngwee ? (ngwee / 100).toFixed(2) : '');
const todayIso = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const fmtDate = (iso) => { const [y, m, d] = String(iso || '').split('-'); return d ? `${d}/${m}/${y}` : ''; };
const qtyFmt = (q) => (Number.isInteger(Number(q)) ? String(q) : Number(q).toFixed(3).replace(/0+$/, ''));
const DOC = { quotation: 'Quotation', invoice: 'Invoice', delivery_note: 'Delivery Note', receipt: 'Receipt' };
const METHODS = { cash: 'Cash', mobile_money: 'Mobile Money', bank_transfer: 'Bank Transfer', card: 'Card', cheque: 'Cheque' };
const isAdmin = () => state.user && state.user.role === 'admin';
const docStatus = (d) => (d.voided_at ? 'void' : d.status);
const badge = (s) => `<span class="badge ${esc(s)}">${esc(String(s).replace('_', ' '))}</span>`;
const methodOptions = (sel = 'cash') => Object.entries(METHODS).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');

const state = { user: null, settings: {}, products: [], cart: newCart() };

function newCart() {
  return { lines: [], customer_id: null, customer_name: '', customer_address: '', discount: '', vat_rate: null, payment_method: 'cash', tendered: '', reference: '' };
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (res.status === 401 && path !== '/api/login') {
    state.user = null;
    location.hash = '#/login';
    throw new Error('Please log in');
  }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

function toast(msg, err = false) {
  const div = document.createElement('div');
  div.textContent = msg;
  if (err) div.className = 'err';
  $('#toast').append(div);
  setTimeout(() => div.remove(), err ? 5000 : 2600);
}

async function guard(fn) {
  try { return await fn(); } catch (e) { toast(e.message, true); return undefined; }
}

function modal(html, { wide = false } = {}) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="backdrop"><div class="modal ${wide ? 'wide' : ''}">${html}</div></div>`;
  const el = $('.modal', root);
  const close = () => { root.innerHTML = ''; };
  $('.backdrop', root).addEventListener('mousedown', (e) => { if (e.target.classList.contains('backdrop')) close(); });
  $$('[data-close]', el).forEach((b) => b.addEventListener('click', close));
  const first = $('input:not([type=hidden]), select, textarea', el);
  if (first) setTimeout(() => first.focus(), 30);
  return { el, close };
}

function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return out;
}

function printDoc(id, format) {
  window.open(`/print/${id}?autoprint=1${format ? `&format=${format}` : ''}`, '_blank');
}

// ------------------------------------------------------------------- router
const routes = {
  login: viewLogin,
  pos: viewPos,
  documents: viewDocuments,
  doc: viewDocument,
  new: viewEditor,
  products: viewProducts,
  customers: viewCustomers,
  customer: viewCustomer,
  reports: viewReports,
  settings: viewSettings,
};

async function router() {
  const [pathPart, queryPart] = location.hash.replace(/^#\/?/, '').split('?');
  const [name = 'pos', ...rest] = pathPart.split('/');
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  $('#modal-root').innerHTML = '';

  if (!state.user && name !== 'login') {
    try {
      state.user = await api('/api/me');
      state.settings = await api('/api/settings');
    } catch { return; }
  }
  const view = routes[name] || viewPos;
  if (name === 'login') return view($('#app'));
  shell(name);
  const main = $('#main');
  main.innerHTML = '<p class="muted">Loading…</p>';
  try {
    await view(main, rest, query);
  } catch (e) {
    main.innerHTML = `<div class="card"><b>Could not load this page.</b><p class="muted">${esc(e.message)}</p></div>`;
  }
}

function shell(active) {
  const links = [
    ['pos', 'Point of Sale'],
    ['documents', 'Documents'],
    ['products', 'Products & Stock'],
    ['customers', 'Customers'],
    ['reports', 'Reports'],
    ['settings', 'Settings'],
  ];
  const section = active === 'doc' || active === 'new' ? 'documents' : active === 'customer' ? 'customers' : active;
  $('#app').innerHTML = `
    <div class="shell">
      <nav class="side">
        <div class="logo">${esc(state.settings.business_name || 'POS')}</div>
        ${links.map(([k, v]) => `<a href="#/${k}" class="${section === k ? 'active' : ''}">${v}</a>`).join('')}
        <div class="grow"></div>
        <div class="who">${esc(state.user.full_name)} · ${esc(state.user.role)}</div>
        <a href="#" id="logout">Log out</a>
      </nav>
      <main class="main" id="main"></main>
    </div>`;
  $('#logout').addEventListener('click', async (e) => {
    e.preventDefault();
    await guard(() => api('/api/logout', { method: 'POST' }));
    state.user = null;
    location.hash = '#/login';
  });
}

// -------------------------------------------------------------------- login
function viewLogin(el) {
  el.innerHTML = `
    <div class="login"><form class="card" id="f">
      <div class="brand">Point of Sale</div>
      <p class="muted" style="text-align:center;margin-top:0">Sign in to continue</p>
      <label>Username<input name="username" autocomplete="username" required></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary big" style="width:100%;justify-content:center">Sign in</button>
    </form></div>`;
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    await guard(async () => {
      state.user = await api('/api/login', { method: 'POST', body: formData(e.target) });
      state.settings = await api('/api/settings');
      location.hash = '#/pos';
    });
  });
  $('input', el).focus();
}

// ---------------------------------------------------------------------- POS
async function loadProducts() {
  state.products = await api('/api/products?active=1');
  return state.products;
}

async function viewPos(el) {
  await loadProducts();
  const cart = state.cart;
  if (cart.vat_rate === null) cart.vat_rate = state.settings.vat_rate || '0';
  const categories = [...new Set(state.products.map((p) => p.category).filter(Boolean))].sort();

  el.innerHTML = `
    <div class="pos">
      <section>
        <div class="row">
          <input id="search" placeholder="Search product or scan barcode / SKU and press Enter" style="flex:1;min-width:220px">
          <select id="cat" style="width:auto"><option value="">All categories</option>${categories.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
          <button class="btn" id="custom">+ Custom item</button>
        </div>
        <div class="products" id="tiles"></div>
      </section>
      <aside class="card cart" id="cart"></aside>
    </div>`;

  const tiles = $('#tiles');
  const drawTiles = () => {
    const q = $('#search').value.trim().toLowerCase();
    const cat = $('#cat').value;
    const list = state.products.filter((p) => (!cat || p.category === cat)
      && (!q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)));
    tiles.innerHTML = list.map((p) => `
      <button class="tile" data-id="${p.id}">
        <span class="n">${esc(p.name)}</span>
        ${p.track_stock ? `<span class="s ${p.stock <= p.reorder_level ? 'low' : ''}">Stock: ${qtyFmt(p.stock)}${p.unit ? ` ${esc(p.unit)}` : ''}</span>` : ''}
        <span class="p">${K(p.price)}</span>
      </button>`).join('') || `<p class="muted">No products found. ${isAdmin() ? '<a href="#/products">Add products</a>' : ''}</p>`;
  };
  tiles.addEventListener('click', (e) => {
    const t = e.target.closest('.tile');
    if (t) addToCart(state.products.find((p) => p.id === Number(t.dataset.id)));
  });
  $('#search').addEventListener('input', drawTiles);
  $('#cat').addEventListener('change', drawTiles);
  $('#search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = e.target.value.trim().toLowerCase();
    if (!q) return;
    const exact = state.products.find((p) => (p.sku || '').toLowerCase() === q);
    const matches = state.products.filter((p) => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q));
    const hit = exact || (matches.length === 1 ? matches[0] : null);
    if (hit) { addToCart(hit); e.target.value = ''; drawTiles(); } else toast(matches.length ? 'Several matches — tap one' : 'No product found', !matches.length);
  });
  $('#custom').addEventListener('click', () => {
    cart.lines.push({ product_id: null, description: '', qty: 1, price: '' });
    drawCart();
    const inputs = $$('.cart-line .desc input');
    inputs[inputs.length - 1]?.focus();
  });

  function addToCart(p) {
    const line = cart.lines.find((l) => l.product_id === p.id);
    if (line) line.qty = Number(line.qty) + 1;
    else cart.lines.push({ product_id: p.id, description: p.name, qty: 1, price: kw(p.price) || '0' });
    drawCart();
  }

  const totals = () => {
    const subtotal = cart.lines.reduce((s, l) => s + Math.round(Number(l.qty || 0) * (toNgwee(l.price) || 0)), 0);
    const discount = Math.min(toNgwee(cart.discount) || 0, subtotal);
    const vat = Math.round(((subtotal - discount) * Number(cart.vat_rate || 0)) / 100);
    return { subtotal, discount, vat, total: subtotal - discount + vat };
  };

  function drawCart() {
    const t = totals();
    const tendered = toNgwee(cart.tendered);
    const change = cart.tendered && !Number.isNaN(tendered) ? tendered - t.total : 0;
    $('#cart').innerHTML = `
      <div class="row" style="justify-content:space-between"><h2 style="margin:0">Current sale</h2>
        <button class="btn sm" id="clear" ${cart.lines.length ? '' : 'disabled'}>Clear</button></div>
      <div class="row">
        <input id="cust" list="custlist" placeholder="Customer (optional) — e.g. Kaundula Day Secondary School" value="${esc(cart.customer_name)}" style="flex:1">
        <datalist id="custlist"></datalist>
      </div>
      <div>
        <div class="cart-head"><span>Item</span><span>Qty</span><span>Price</span><span class="right">Amount</span><span></span></div>
        <div class="cart-lines">${cart.lines.length ? cart.lines.map((l, i) => `
          <div class="cart-line" data-i="${i}">
            <div class="desc"><input data-f="description" value="${esc(l.description)}" placeholder="Description"></div>
            <input data-f="qty" type="number" min="0" step="any" value="${esc(l.qty)}">
            <input data-f="price" inputmode="decimal" value="${esc(l.price)}" placeholder="0.00">
            <div class="amt">${money(Math.round(Number(l.qty || 0) * (toNgwee(l.price) || 0)))}</div>
            <button class="x" data-del="${i}" title="Remove">×</button>
          </div>`).join('') : '<div class="empty-cart">Tap a product to add it</div>'}</div>
      </div>
      <div class="grid2">
        <label>Discount (K)<input id="disc" inputmode="decimal" value="${esc(cart.discount)}" placeholder="0.00"></label>
        <label>VAT %<input id="vat" type="number" min="0" max="100" step="any" value="${esc(cart.vat_rate)}"></label>
      </div>
      <div class="sum">
        <span>Sub total</span><span class="right">${money(t.subtotal)}</span>
        ${t.discount ? `<span>Discount</span><span class="right">-${money(t.discount)}</span>` : ''}
        ${t.vat ? `<span>VAT ${esc(cart.vat_rate)}%</span><span class="right">${money(t.vat)}</span>` : ''}
        <span class="grand">TOTAL</span><span class="grand right">${K(t.total)}</span>
      </div>
      <div class="grid2">
        <label>Payment method<select id="method">${methodOptions(cart.payment_method)}</select></label>
        <label>Amount tendered (K)<input id="tendered" inputmode="decimal" value="${esc(cart.tendered)}" placeholder="${kw(t.total) || '0.00'}"></label>
      </div>
      ${cart.payment_method !== 'cash' ? `<label>Payment reference<input id="ref" value="${esc(cart.reference)}" placeholder="Transaction ID / cheque no."></label>` : ''}
      <div class="sum"><span>Change</span><span class="right" style="font-weight:700;color:${change < 0 ? 'var(--bad)' : 'var(--ok)'}">${K(change)}</span></div>
      <button class="btn ok big" id="pay" ${cart.lines.length ? '' : 'disabled'}>Charge ${K(t.total)} &amp; print receipt</button>
      <div class="grid2">
        <button class="btn" id="asquote" ${cart.lines.length ? '' : 'disabled'}>Save as Quotation</button>
        <button class="btn" id="asinvoice" ${cart.lines.length ? '' : 'disabled'}>Save as Invoice</button>
      </div>`;
    bindCart();
  }

  function bindCart() {
    const c = $('#cart');
    $$('.cart-line input', c).forEach((inp) => {
      inp.addEventListener('change', () => {
        const i = Number(inp.closest('.cart-line').dataset.i);
        cart.lines[i][inp.dataset.f] = inp.value;
        drawCart();
      });
    });
    $$('[data-del]', c).forEach((b) => b.addEventListener('click', () => { cart.lines.splice(Number(b.dataset.del), 1); drawCart(); }));
    $('#clear').addEventListener('click', () => { state.cart = newCart(); state.cart.vat_rate = state.settings.vat_rate || '0'; viewPos(el); });
    $('#disc').addEventListener('change', (e) => { cart.discount = e.target.value; drawCart(); });
    $('#vat').addEventListener('change', (e) => { cart.vat_rate = e.target.value; drawCart(); });
    $('#method').addEventListener('change', (e) => { cart.payment_method = e.target.value; drawCart(); });
    $('#tendered').addEventListener('change', (e) => { cart.tendered = e.target.value; drawCart(); });
    $('#ref')?.addEventListener('change', (e) => { cart.reference = e.target.value; });
    const cust = $('#cust');
    let custTimer;
    cust.addEventListener('input', () => {
      clearTimeout(custTimer);
      custTimer = setTimeout(async () => {
        const list = await guard(() => api(`/api/customers?q=${encodeURIComponent(cust.value)}`)) || [];
        $('#custlist').innerHTML = list.slice(0, 15).map((x) => `<option value="${esc(x.name)}">`).join('');
        cust._matches = list;
      }, 200);
    });
    cust.addEventListener('change', () => {
      const m = (cust._matches || []).find((x) => x.name === cust.value);
      cart.customer_name = cust.value;
      cart.customer_id = m ? m.id : null;
      cart.customer_address = m ? m.address || '' : '';
    });
    $('#pay').addEventListener('click', () => checkout('receipt'));
    $('#asquote').addEventListener('click', () => checkout('quotation'));
    $('#asinvoice').addEventListener('click', () => checkout('invoice'));
  }

  async function checkout(type) {
    const t = totals();
    for (const [i, l] of cart.lines.entries()) {
      if (!String(l.description).trim()) return toast(`Line ${i + 1} needs a description`, true);
      if (!(Number(l.qty) > 0)) return toast(`Line ${i + 1} needs a quantity`, true);
      if (Number.isNaN(toNgwee(l.price))) return toast(`Line ${i + 1} has an invalid price`, true);
    }
    const body = {
      type,
      customer_id: cart.customer_id,
      customer_name: cart.customer_name,
      customer_address: cart.customer_address,
      discount: toNgwee(cart.discount) || 0,
      vat_rate: cart.vat_rate,
      items: cart.lines.map((l) => ({ product_id: l.product_id, description: l.description, qty: Number(l.qty), unit_price: toNgwee(l.price) || 0 })),
    };
    if (type === 'receipt') {
      const tendered = cart.tendered === '' ? t.total : toNgwee(cart.tendered);
      if (Number.isNaN(tendered) || tendered < t.total) return toast('Amount tendered is less than the total', true);
      Object.assign(body, { payment_method: cart.payment_method, amount_tendered: tendered, payment_reference: cart.reference });
    }
    if (type !== 'receipt' && !cart.customer_name.trim()) {
      if (!confirm(`No customer entered. Save the ${DOC[type]} anyway?`)) return;
    }
    const doc = await guard(() => api('/api/documents', { method: 'POST', body }));
    if (!doc) return;
    state.cart = newCart();
    state.cart.vat_rate = state.settings.vat_rate || '0';
    if (type === 'receipt') {
      const m = modal(`
        <h2>Sale complete — Receipt No. ${doc.number}</h2>
        <div class="sum" style="font-size:16px;margin:12px 0">
          <span>Total</span><span class="right">${K(doc.total)}</span>
          <span>Tendered</span><span class="right">${K(doc.amount_tendered)}</span>
          <span class="grand">Change</span><span class="grand right">${K(doc.change_given)}</span>
        </div>
        <div class="actions">
          <button class="btn" id="p-a5">Print receipt (A5)</button>
          <button class="btn" id="p-slip">Print 80mm slip</button>
          <button class="btn primary" data-close>New sale</button>
        </div>`);
      $('#p-a5', m.el).addEventListener('click', () => printDoc(doc.id));
      $('#p-slip', m.el).addEventListener('click', () => printDoc(doc.id, 'thermal'));
      viewPos(el); // redraw the empty till underneath the open modal
    } else {
      toast(`${DOC[type]} No. ${doc.number} saved`);
      location.hash = `#/doc/${doc.id}`;
    }
  }

  drawTiles();
  drawCart();
  $('#search').focus();
}

// ---------------------------------------------------------------- documents
async function viewDocuments(el, _rest, query) {
  const type = query.type || '';
  const qs = new URLSearchParams(Object.fromEntries(Object.entries({ type, q: query.q, status: query.status, from: query.from, to: query.to }).filter(([, v]) => v)));
  const docs = await api(`/api/documents?${qs}`);
  const statuses = { '': ['open', 'invoiced', 'unpaid', 'partial', 'paid', 'delivered', 'void'], quotation: ['open', 'invoiced', 'void'], invoice: ['unpaid', 'partial', 'paid', 'void'], delivery_note: ['delivered', 'void'], receipt: ['paid', 'void'] }[type];
  const tab = (t, label) => `<a href="#/documents${t ? `?type=${t}` : ''}" class="${type === t ? 'active' : ''}">${label}</a>`;

  el.innerHTML = `
    <div class="topbar"><h1>Documents</h1>
      <div class="row">
        <a class="btn" href="#/new/quotation">+ Quotation</a>
        <a class="btn" href="#/new/invoice">+ Invoice</a>
        <a class="btn" href="#/new/delivery_note">+ Delivery Note</a>
        <a class="btn primary" href="#/pos">+ Sale (Receipt)</a>
      </div></div>
    <div class="tabs">${tab('', 'All')}${tab('quotation', 'Quotations')}${tab('invoice', 'Invoices')}${tab('delivery_note', 'Delivery Notes')}${tab('receipt', 'Receipts')}</div>
    <form class="row" id="filters" style="margin-bottom:12px">
      <input name="q" placeholder="Customer or number" value="${esc(query.q)}" style="max-width:240px">
      <select name="status" style="width:auto"><option value="">Any status</option>${statuses.map((s) => `<option ${query.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <input type="date" name="from" value="${esc(query.from)}" style="width:auto">
      <input type="date" name="to" value="${esc(query.to)}" style="width:auto">
      <button class="btn">Filter</button>
      <a class="btn" href="/api/export/documents.csv?${qs}">Export CSV</a>
    </form>
    <table class="list">
      <tr><th>Type</th><th>No.</th><th>Date</th><th>Customer</th><th>Status</th><th class="num">Total</th><th class="num">Balance</th><th></th></tr>
      ${docs.map((d) => `
        <tr class="click" data-id="${d.id}">
          <td>${DOC[d.type]}</td><td><b>${d.number}</b></td><td class="nowrap">${fmtDate(d.date)}</td>
          <td>${esc(d.customer_name) || '<span class="muted">—</span>'}</td><td>${badge(docStatus(d))}</td>
          <td class="num">${money(d.total)}</td>
          <td class="num">${d.type === 'invoice' && !d.voided_at ? money(d.total - d.amount_paid) : ''}</td>
          <td class="right"><button class="btn sm" data-print="${d.id}">Print</button></td>
        </tr>`).join('') || '<tr><td colspan="8" class="muted">No documents yet.</td></tr>'}
    </table>`;
  $('#filters').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(Object.entries({ type, ...formData(e.target) }).filter(([, v]) => v));
    location.hash = `#/documents?${new URLSearchParams(f)}`;
  });
  $$('tr.click', el).forEach((tr) => tr.addEventListener('click', (e) => {
    const p = e.target.closest('[data-print]');
    if (p) return printDoc(p.dataset.print);
    location.hash = `#/doc/${tr.dataset.id}`;
  }));
}

async function viewDocument(el, [id]) {
  const d = await api(`/api/documents/${id}`);
  const isVoid = !!d.voided_at;
  const actions = [];
  actions.push(`<button class="btn primary" id="print">Print</button>`);
  if (d.type === 'receipt') actions.push(`<button class="btn" id="slip">Print 80mm slip</button>`);
  if (!isVoid && d.type === 'quotation' && d.status === 'open') actions.push(`<button class="btn ok" id="convert">Convert to Invoice</button>`);
  if (!isVoid && d.type === 'invoice') {
    if (d.items.some((it) => it.remaining_qty > 0)) actions.push(`<a class="btn" href="#/new/delivery_note?from=${d.id}">Create Delivery Note</a>`);
    if (d.balance > 0) actions.push(`<button class="btn ok" id="pay">Record payment</button>`);
  }
  if (['quotation', 'invoice', 'delivery_note'].includes(d.type) || (d.type === 'receipt' && !d.source_id)) {
    actions.push(`<a class="btn" href="#/new/${d.type === 'receipt' ? 'invoice' : d.type}?copy=${d.id}">Duplicate${d.type === 'receipt' ? ' as Invoice' : ''}</a>`);
  }
  if (!isVoid && isAdmin()) actions.push(`<button class="btn bad" id="void">Void</button>`);

  const priced = d.type !== 'delivery_note';
  el.innerHTML = `
    <div class="topbar">
      <h1>${DOC[d.type]} No. ${d.number} ${badge(docStatus(d))}</h1>
      <div class="row">${actions.join('')}</div>
    </div>
    ${isVoid ? `<div class="card" style="border-color:var(--bad);margin-bottom:12px"><b style="color:var(--bad)">Voided</b> on ${esc(d.voided_at)} — ${esc(d.void_reason)}</div>` : ''}
    <div class="cards">
      <div class="card stat"><div class="k">${d.type === 'receipt' ? 'Received from' : 'Customer'}</div><div style="font-weight:600">${esc(d.customer_name) || '—'}</div><div class="muted" style="white-space:pre-line">${esc(d.customer_address)}</div></div>
      <div class="card stat"><div class="k">Date</div><div class="v">${fmtDate(d.date)}</div><div class="muted">by ${esc(d.prepared_by_name || '')}</div></div>
      ${priced ? `<div class="card stat"><div class="k">Total</div><div class="v">${K(d.total)}</div></div>` : ''}
      ${d.type === 'invoice' ? `<div class="card stat"><div class="k">Balance due</div><div class="v" style="color:${d.balance > 0 ? 'var(--bad)' : 'var(--ok)'}">${K(d.balance)}</div><div class="muted">Paid ${K(d.amount_paid)}</div></div>` : ''}
      ${d.type === 'receipt' ? `<div class="card stat"><div class="k">Payment</div><div style="font-weight:600">${METHODS[d.payment_method] || ''}</div><div class="muted">Tendered ${K(d.amount_tendered)} · Change ${K(d.change_given)}${d.payment_reference ? `<br>Ref ${esc(d.payment_reference)}` : ''}</div></div>` : ''}
      ${d.type === 'quotation' ? `<div class="card stat"><div class="k">Valid for</div><div class="v">${d.validity_days} days</div></div>` : ''}
      ${d.type === 'delivery_note' ? `<div class="card stat"><div class="k">Delivered by</div><div style="font-weight:600">${esc(d.delivered_by)}</div></div>` : ''}
    </div>
    <table class="list">
      <tr><th>Qty</th><th>Description</th>${priced ? '<th class="num">Unit Price</th><th class="num">Amount</th>' : ''}${d.type === 'invoice' ? '<th class="num">Delivered</th>' : ''}</tr>
      ${d.items.map((it) => `<tr><td>${qtyFmt(it.qty)}</td><td>${esc(it.description)}</td>${priced ? `<td class="num">${money(it.unit_price)}</td><td class="num">${money(it.amount)}</td>` : ''}${d.type === 'invoice' ? `<td class="num">${qtyFmt(it.delivered_qty)} / ${qtyFmt(it.qty)}</td>` : ''}</tr>`).join('')}
      ${priced ? `
        ${d.discount || d.vat_amount ? `<tr><td></td><td class="right">Sub total</td><td></td><td class="num">${money(d.subtotal)}</td>${d.type === 'invoice' ? '<td></td>' : ''}</tr>` : ''}
        ${d.discount ? `<tr><td></td><td class="right">Discount</td><td></td><td class="num">-${money(d.discount)}</td>${d.type === 'invoice' ? '<td></td>' : ''}</tr>` : ''}
        ${d.vat_amount ? `<tr><td></td><td class="right">VAT @ ${d.vat_rate}%</td><td></td><td class="num">${money(d.vat_amount)}</td>${d.type === 'invoice' ? '<td></td>' : ''}</tr>` : ''}
        <tr><td></td><td class="right"><b>TOTAL ${esc(state.settings.currency || 'K')}</b></td><td></td><td class="num"><b>${money(d.total)}</b></td>${d.type === 'invoice' ? '<td></td>' : ''}</tr>` : ''}
    </table>
    ${d.notes ? `<p><b>Notes:</b> ${esc(d.notes)}</p>` : ''}
    ${d.source || d.related.length ? `
      <h2 style="margin-top:18px">Linked documents</h2>
      <table class="list">
        ${d.source ? `<tr class="click" data-id="${d.source.id}"><td>Created from</td><td>${DOC[d.source.type]} No. ${d.source.number}</td><td>${fmtDate(d.source.date)}</td><td class="num">${money(d.source.total)}</td><td></td></tr>` : ''}
        ${d.related.map((r) => `<tr class="click" data-id="${r.id}"><td>${r.type === 'receipt' ? 'Payment' : 'Follow-up'}</td><td>${DOC[r.type]} No. ${r.number}</td><td>${fmtDate(r.date)}</td><td class="num">${money(r.total)}</td><td>${badge(docStatus(r))}</td></tr>`).join('')}
      </table>` : ''}`;

  $$('tr.click', el).forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/doc/${tr.dataset.id}`; }));
  $('#print').addEventListener('click', () => printDoc(d.id));
  $('#slip')?.addEventListener('click', () => printDoc(d.id, 'thermal'));
  $('#convert')?.addEventListener('click', async () => {
    if (!confirm(`Create an invoice from Quotation No. ${d.number}?`)) return;
    const inv = await guard(() => api(`/api/documents/${d.id}/convert`, { method: 'POST', body: { date: todayIso() } }));
    if (inv) { toast(`Invoice No. ${inv.number} created`); location.hash = `#/doc/${inv.id}`; }
  });
  $('#pay')?.addEventListener('click', () => paymentModal(d));
  $('#void')?.addEventListener('click', async () => {
    const reason = prompt(`Reason for voiding ${DOC[d.type]} No. ${d.number}:`);
    if (!reason) return;
    const r = await guard(() => api(`/api/documents/${d.id}/void`, { method: 'POST', body: { reason } }));
    if (r) { toast('Document voided'); router(); }
  });
}

function paymentModal(inv) {
  const m = modal(`
    <h2>Record payment — Invoice No. ${inv.number}</h2>
    <p class="muted">${esc(inv.customer_name)} · Balance due <b>${K(inv.balance)}</b></p>
    <form id="pf">
      <div class="grid2">
        <label>Amount received (K)<input name="amount" inputmode="decimal" value="${kw(inv.balance)}" required></label>
        <label>Date<input name="date" type="date" value="${todayIso()}" required></label>
        <label>Payment method<select name="payment_method">${methodOptions()}</select></label>
        <label>Reference<input name="payment_reference" placeholder="Txn ID / cheque no."></label>
      </div>
      <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn ok">Save &amp; print receipt</button></div>
    </form>`);
  $('#pf', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const amount = toNgwee(f.amount);
    if (!(amount > 0)) return toast('Enter a valid amount', true);
    const r = await guard(() => api('/api/documents', { method: 'POST', body: { type: 'receipt', source_id: inv.id, amount, date: f.date, payment_method: f.payment_method, payment_reference: f.payment_reference } }));
    if (r) { m.close(); toast(`Receipt No. ${r.number} saved`); printDoc(r.id); router(); }
  });
}

// ----------------------------------------------------- document editor (new)
async function viewEditor(el, [type], query) {
  if (!DOC[type] || type === 'receipt') { location.hash = '#/documents'; return; }
  await loadProducts();
  const productByName = new Map(state.products.map((p) => [p.name.toLowerCase(), p]));
  const doc = {
    customer_id: null, customer_name: '', customer_address: '', date: todayIso(), discount: '', vat_rate: state.settings.vat_rate || '0',
    validity_days: state.settings.quotation_validity_days || '30', delivered_by: state.user.full_name, notes: '', source_id: null,
    lines: [{ product_id: null, description: '', qty: 1, price: '' }],
  };
  let source = null;
  if (query.from) {
    // Delivery note from an invoice: only undelivered quantities.
    source = await api(`/api/documents/${query.from}`);
    Object.assign(doc, { source_id: source.id, customer_id: source.customer_id, customer_name: source.customer_name, customer_address: source.customer_address });
    doc.lines = source.items.filter((it) => it.remaining_qty > 0).map((it) => ({
      source_item_id: it.id, product_id: it.product_id, description: it.description, qty: it.remaining_qty, max: it.remaining_qty, price: kw(it.unit_price), include: true,
    }));
  } else if (query.copy) {
    const c = await api(`/api/documents/${query.copy}`);
    Object.assign(doc, { customer_id: c.customer_id, customer_name: c.customer_name === 'Cash Customer' ? '' : c.customer_name, customer_address: c.customer_address, discount: kw(c.discount), vat_rate: String(c.vat_rate), notes: c.notes || '' });
    doc.lines = c.items.map((it) => ({ product_id: it.product_id, description: it.description, qty: it.qty, price: kw(it.unit_price) }));
  } else if (query.customer) {
    const c = await api(`/api/customers/${query.customer}`);
    Object.assign(doc, { customer_id: c.id, customer_name: c.name, customer_address: c.address || '' });
  }
  const priced = type !== 'delivery_note';
  const fromInvoice = !!source;

  el.innerHTML = `
    <div class="topbar"><h1>New ${DOC[type]}${source ? ` <span class="muted" style="font-weight:400">from Invoice No. ${source.number}</span>` : ''}</h1></div>
    <form id="ef" class="card">
      <div class="grid3">
        <label>M/S (customer)<input name="customer_name" list="custlist" value="${esc(doc.customer_name)}" ${fromInvoice ? 'readonly' : ''} required></label>
        <label>Address / second line<input name="customer_address" value="${esc(doc.customer_address)}" ${fromInvoice ? 'readonly' : ''}></label>
        <label>Date<input type="date" name="date" value="${doc.date}" required></label>
      </div>
      <datalist id="custlist"></datalist>
      <datalist id="prodlist">${state.products.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>
      <table class="editor-lines">
        <thead><tr>${fromInvoice ? '<th style="width:30px"></th>' : ''}<th style="width:90px">Qty</th><th>Description</th>${priced ? '<th style="width:130px">Unit price (K)</th><th style="width:120px" class="right">Amount</th>' : ''}<th style="width:30px"></th></tr></thead>
        <tbody id="lines"></tbody>
      </table>
      ${fromInvoice ? '' : '<button type="button" class="btn sm" id="addline" style="margin:6px 0 14px">+ Add line</button>'}
      <div class="grid3">
        ${priced ? `<label>Discount (K)<input name="discount" inputmode="decimal" value="${esc(doc.discount)}" placeholder="0.00"></label>
        <label>VAT %<input name="vat_rate" type="number" min="0" max="100" step="any" value="${esc(doc.vat_rate)}"></label>` : ''}
        ${type === 'quotation' ? `<label>Valid for (days)<input name="validity_days" type="number" min="1" value="${esc(doc.validity_days)}"></label>` : ''}
        ${type === 'delivery_note' ? `<label>Delivered by<input name="delivered_by" value="${esc(doc.delivered_by)}"></label>` : ''}
        <label>Prepared by<input name="prepared_by_name" value="${esc(state.user.full_name)}"></label>
      </div>
      <label>Notes (optional, printed)<textarea name="notes" rows="2">${esc(doc.notes)}</textarea></label>
      <div class="row" style="justify-content:space-between">
        <div id="totals" style="font-size:18px;font-weight:700"></div>
        <div class="row"><a class="btn" href="#/documents">Cancel</a><button class="btn primary big">Save &amp; print</button></div>
      </div>
    </form>`;

  const drawLines = () => {
    $('#lines').innerHTML = doc.lines.map((l, i) => `
      <tr data-i="${i}">
        ${fromInvoice ? `<td><input type="checkbox" data-f="include" ${l.include ? 'checked' : ''}></td>` : ''}
        <td><input data-f="qty" type="number" min="0" step="any" value="${esc(l.qty)}" ${l.max ? `max="${l.max}"` : ''}></td>
        <td><input data-f="description" list="prodlist" value="${esc(l.description)}" ${fromInvoice ? 'readonly' : ''} placeholder="Type or pick a product"></td>
        ${priced ? `<td><input data-f="price" inputmode="decimal" value="${esc(l.price)}"></td>
        <td class="right nowrap">${money(Math.round(Number(l.qty || 0) * (toNgwee(l.price) || 0)))}</td>` : ''}
        <td>${fromInvoice ? '' : `<button type="button" class="x" data-del="${i}">×</button>`}</td>
      </tr>`).join('');
    const sub = doc.lines.reduce((s, l) => s + Math.round(Number(l.qty || 0) * (toNgwee(l.price) || 0)), 0);
    if (priced) {
      const f = formData($('#ef'));
      const disc = toNgwee(f.discount) || 0;
      const vat = Math.round(((sub - disc) * Number(f.vat_rate || 0)) / 100);
      $('#totals').textContent = `TOTAL ${K(sub - disc + vat)}`;
    } else {
      $('#totals').textContent = `${doc.lines.filter((l) => !fromInvoice || l.include).length} line(s)`;
    }
  };
  $('#lines').addEventListener('change', (e) => {
    const inp = e.target;
    const i = Number(inp.closest('tr').dataset.i);
    const line = doc.lines[i];
    if (inp.dataset.f === 'include') line.include = inp.checked;
    else line[inp.dataset.f] = inp.value;
    if (inp.dataset.f === 'description' && !fromInvoice) {
      const p = productByName.get(inp.value.trim().toLowerCase());
      line.product_id = p ? p.id : null;
      if (p) line.price = kw(p.price) || line.price;
    }
    drawLines();
  });
  $('#lines').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    doc.lines.splice(Number(b.dataset.del), 1);
    if (!doc.lines.length) doc.lines.push({ product_id: null, description: '', qty: 1, price: '' });
    drawLines();
  });
  $('#addline')?.addEventListener('click', () => { doc.lines.push({ product_id: null, description: '', qty: 1, price: '' }); drawLines(); $$('#lines tr:last-child input[data-f=description]')[0]?.focus(); });
  $('#ef').addEventListener('input', (e) => { if (['discount', 'vat_rate'].includes(e.target.name)) drawLines(); });

  const custInput = $('[name=customer_name]');
  let matches = [];
  custInput.addEventListener('input', async () => {
    matches = await guard(() => api(`/api/customers?q=${encodeURIComponent(custInput.value)}`)) || [];
    $('#custlist').innerHTML = matches.slice(0, 15).map((c) => `<option value="${esc(c.name)}">`).join('');
  });
  custInput.addEventListener('change', () => {
    const m = matches.find((c) => c.name === custInput.value);
    doc.customer_id = m ? m.id : null;
    if (m && m.address) $('[name=customer_address]').value = m.address;
  });

  $('#ef').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const lines = doc.lines.filter((l) => (fromInvoice ? l.include : String(l.description).trim()));
    if (!lines.length) return toast('Add at least one item', true);
    for (const [i, l] of lines.entries()) {
      if (!(Number(l.qty) > 0)) return toast(`Line ${i + 1} needs a quantity`, true);
      if (l.max && Number(l.qty) > l.max) return toast(`Only ${l.max} of "${l.description}" left to deliver`, true);
      if (priced && Number.isNaN(toNgwee(l.price))) return toast(`Line ${i + 1} has an invalid price`, true);
    }
    const body = {
      type,
      source_id: doc.source_id,
      customer_id: doc.customer_id,
      customer_name: f.customer_name,
      customer_address: f.customer_address,
      date: f.date,
      notes: f.notes,
      prepared_by_name: f.prepared_by_name,
      discount: priced ? toNgwee(f.discount) || 0 : 0,
      vat_rate: priced ? f.vat_rate : 0,
      validity_days: f.validity_days,
      delivered_by: f.delivered_by,
      items: lines.map((l) => ({ product_id: l.product_id, source_item_id: l.source_item_id, description: l.description, qty: Number(l.qty), unit_price: priced ? toNgwee(l.price) || 0 : undefined })),
    };
    const saved = await guard(() => api('/api/documents', { method: 'POST', body }));
    if (saved) { toast(`${DOC[type]} No. ${saved.number} saved`); printDoc(saved.id); location.hash = `#/doc/${saved.id}`; }
  });
  drawLines();
}

// ----------------------------------------------------------------- products
async function viewProducts(el, _rest, query) {
  const list = await api(`/api/products?${new URLSearchParams({ q: query.q || '', low_stock: query.low || '' })}`);
  const value = list.reduce((s, p) => s + (p.track_stock ? Math.max(0, p.stock) * p.cost : 0), 0);
  el.innerHTML = `
    <div class="topbar"><h1>Products &amp; Stock</h1>
      <div class="row">${isAdmin() ? '<button class="btn primary" id="add">+ Add product</button>' : ''}</div></div>
    <form class="row" id="pf" style="margin-bottom:12px">
      <input name="q" placeholder="Search name, SKU or category" value="${esc(query.q)}" style="max-width:280px">
      <label class="check" style="margin:0"><input type="checkbox" name="low" ${query.low ? 'checked' : ''}> Low stock only</label>
      <button class="btn">Search</button>
      <span class="muted">${list.length} products · stock value at cost ${K(value)}</span>
    </form>
    <table class="list">
      <tr><th>Name</th><th>SKU / Barcode</th><th>Category</th><th class="num">Price</th><th class="num">Cost</th><th class="num">Stock</th><th></th></tr>
      ${list.map((p) => `
        <tr data-id="${p.id}">
          <td><b>${esc(p.name)}</b>${p.active ? '' : ' <span class="badge">inactive</span>'}</td>
          <td>${esc(p.sku)}</td><td>${esc(p.category)}</td>
          <td class="num">${money(p.price)}</td><td class="num">${money(p.cost)}</td>
          <td class="num">${p.track_stock ? `${qtyFmt(p.stock)} ${esc(p.unit || '')} ${p.stock <= p.reorder_level ? badge('low') : ''}` : '<span class="muted">not tracked</span>'}</td>
          <td class="right nowrap">
            <button class="btn sm" data-a="hist">History</button>
            ${isAdmin() ? '<button class="btn sm" data-a="adj">Stock</button> <button class="btn sm" data-a="edit">Edit</button>' : ''}
          </td>
        </tr>`).join('') || '<tr><td colspan="7" class="muted">No products.</td></tr>'}
    </table>`;
  $('#pf').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = formData(e.target);
    location.hash = `#/products?${new URLSearchParams({ q: f.q, low: f.low ? '1' : '' })}`;
  });
  $('#add')?.addEventListener('click', () => productModal());
  $$('[data-a]', el).forEach((b) => b.addEventListener('click', () => {
    const p = list.find((x) => x.id === Number(b.closest('tr').dataset.id));
    if (b.dataset.a === 'edit') productModal(p);
    if (b.dataset.a === 'adj') stockModal(p);
    if (b.dataset.a === 'hist') historyModal(p);
  }));
}

function productModal(p) {
  const isNew = !p;
  p = p || { track_stock: 1, active: 1 };
  const m = modal(`
    <h2>${isNew ? 'Add product' : `Edit ${esc(p.name)}`}</h2>
    <form id="f">
      <label>Name<input name="name" value="${esc(p.name)}" required></label>
      <div class="grid2">
        <label>SKU / Barcode<input name="sku" value="${esc(p.sku)}"></label>
        <label>Category<input name="category" value="${esc(p.category)}"></label>
        <label>Selling price (K)<input name="price" inputmode="decimal" value="${kw(p.price)}" required></label>
        <label>Cost price (K)<input name="cost" inputmode="decimal" value="${kw(p.cost)}"></label>
        <label>Unit (e.g. pcs, box, 12x750ml)<input name="unit" value="${esc(p.unit)}"></label>
        <label>Re-order level<input name="reorder_level" type="number" step="any" value="${esc(p.reorder_level ?? 0)}"></label>
        ${isNew ? '<label>Opening stock<input name="stock" type="number" step="any" value="0"></label>' : ''}
      </div>
      <label class="check"><input type="checkbox" name="track_stock" ${p.track_stock ? 'checked' : ''}> Track stock for this item</label>
      <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Active (shown at the till)</label>
      <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div>
    </form>`);
  $('#f', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const body = { ...f, price: toNgwee(f.price), cost: toNgwee(f.cost) || 0 };
    if (Number.isNaN(body.price)) return toast('Enter a valid price', true);
    const r = await guard(() => api(isNew ? '/api/products' : `/api/products/${p.id}`, { method: isNew ? 'POST' : 'PUT', body }));
    if (r) { m.close(); toast('Product saved'); router(); }
  });
}

function stockModal(p) {
  const m = modal(`
    <h2>Stock — ${esc(p.name)}</h2>
    <p class="muted">Current stock: <b>${qtyFmt(p.stock)}</b></p>
    <form id="f">
      <div class="grid2">
        <label>Reason<select name="reason">
          <option value="restock">Restock (goods received) +</option>
          <option value="return">Customer return +</option>
          <option value="damage">Damaged / expired −</option>
          <option value="adjustment">Adjustment (+/−)</option>
          <option value="count">Stock count — set exact quantity</option>
        </select></label>
        <label>Quantity<input name="qty" type="number" step="any" required></label>
      </div>
      <label>Note<input name="note" placeholder="Supplier, invoice no., reason…"></label>
      <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div>
    </form>`);
  $('#f', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    let qty = Number(f.qty);
    if (!Number.isFinite(qty)) return toast('Enter a quantity', true);
    if (f.reason === 'damage') qty = -Math.abs(qty);
    if (f.reason === 'restock' || f.reason === 'return') qty = Math.abs(qty);
    if (f.reason === 'count') qty -= p.stock;
    if (qty === 0) return toast('No change in stock');
    const r = await guard(() => api(`/api/products/${p.id}/adjust`, { method: 'POST', body: { qty_change: qty, reason: f.reason, note: f.note } }));
    if (r) { m.close(); toast(`Stock is now ${qtyFmt(r.stock)}`); router(); }
  });
}

async function historyModal(p) {
  const rows = await guard(() => api(`/api/products/${p.id}/movements`)) || [];
  modal(`
    <h2>Stock history — ${esc(p.name)}</h2>
    <table class="list">
      <tr><th>When</th><th>Reason</th><th class="num">Change</th><th>Document</th><th>By</th></tr>
      ${rows.map((r) => `<tr><td class="nowrap">${esc(r.created_at)}</td><td>${esc(r.reason)}${r.note ? ` <span class="muted">${esc(r.note)}</span>` : ''}</td>
        <td class="num" style="color:${r.qty_change < 0 ? 'var(--bad)' : 'var(--ok)'}">${r.qty_change > 0 ? '+' : ''}${qtyFmt(r.qty_change)}</td>
        <td>${r.document_id ? `<a href="#/doc/${r.document_id}">${DOC[r.document_type]} ${r.document_number}</a>` : ''}</td><td>${esc(r.user_name)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No movements yet.</td></tr>'}
    </table>
    <div class="actions"><button class="btn" data-close>Close</button></div>`, { wide: true });
}

// ---------------------------------------------------------------- customers
async function viewCustomers(el, _rest, query) {
  const list = await api(`/api/customers?q=${encodeURIComponent(query.q || '')}`);
  el.innerHTML = `
    <div class="topbar"><h1>Customers</h1><button class="btn primary" id="add">+ Add customer</button></div>
    <form class="row" id="cf" style="margin-bottom:12px"><input name="q" placeholder="Search name, phone or TPIN" value="${esc(query.q)}" style="max-width:280px"><button class="btn">Search</button></form>
    <table class="list">
      <tr><th>Name</th><th>Phone</th><th>TPIN</th><th class="num">Balance owed</th></tr>
      ${list.map((c) => `<tr class="click" data-id="${c.id}"><td><b>${esc(c.name)}</b><div class="muted">${esc(c.address)}</div></td><td>${esc(c.phone)}</td><td>${esc(c.tpin)}</td>
        <td class="num" style="color:${c.balance > 0 ? 'var(--bad)' : 'inherit'}">${money(c.balance)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No customers yet.</td></tr>'}
    </table>`;
  $('#cf').addEventListener('submit', (e) => { e.preventDefault(); location.hash = `#/customers?q=${encodeURIComponent(formData(e.target).q)}`; });
  $('#add').addEventListener('click', () => customerModal());
  $$('tr.click', el).forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/customer/${tr.dataset.id}`; }));
}

function customerModal(c) {
  const isNew = !c;
  c = c || {};
  const m = modal(`
    <h2>${isNew ? 'Add customer' : 'Edit customer'}</h2>
    <form id="f">
      <label>Name (M/S)<input name="name" value="${esc(c.name)}" required></label>
      <label>Address / second line<input name="address" value="${esc(c.address)}"></label>
      <div class="grid2">
        <label>Phone<input name="phone" value="${esc(c.phone)}"></label>
        <label>Email<input name="email" type="email" value="${esc(c.email)}"></label>
        <label>TPIN<input name="tpin" value="${esc(c.tpin)}"></label>
      </div>
      <label>Notes<textarea name="notes" rows="2">${esc(c.notes)}</textarea></label>
      <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div>
    </form>`);
  $('#f', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await guard(() => api(isNew ? '/api/customers' : `/api/customers/${c.id}`, { method: isNew ? 'POST' : 'PUT', body: formData(e.target) }));
    if (r) { m.close(); toast('Customer saved'); if (isNew) location.hash = `#/customer/${r.id}`; else router(); }
  });
}

async function viewCustomer(el, [id]) {
  const c = await api(`/api/customers/${id}`);
  el.innerHTML = `
    <div class="topbar"><h1>${esc(c.name)}</h1>
      <div class="row">
        <button class="btn" id="edit">Edit</button>
        <a class="btn" href="#/new/quotation?customer=${c.id}">+ Quotation</a>
        <a class="btn" href="#/new/invoice?customer=${c.id}">+ Invoice</a>
      </div></div>
    <div class="cards">
      <div class="card stat"><div class="k">Contact</div><div>${esc(c.address) || '—'}</div><div class="muted">${esc(c.phone)} ${esc(c.email)}</div>${c.tpin ? `<div class="muted">TPIN ${esc(c.tpin)}</div>` : ''}</div>
      <div class="card stat"><div class="k">Balance owed</div><div class="v" style="color:${c.balance > 0 ? 'var(--bad)' : 'var(--ok)'}">${K(c.balance)}</div></div>
      <div class="card stat"><div class="k">Documents</div><div class="v">${c.documents.length}</div></div>
    </div>
    <table class="list">
      <tr><th>Type</th><th>No.</th><th>Date</th><th>Status</th><th class="num">Total</th><th class="num">Balance</th></tr>
      ${c.documents.map((d) => `<tr class="click" data-id="${d.id}"><td>${DOC[d.type]}</td><td><b>${d.number}</b></td><td>${fmtDate(d.date)}</td><td>${badge(docStatus(d))}</td>
        <td class="num">${money(d.total)}</td><td class="num">${d.type === 'invoice' && !d.voided_at ? money(d.total - d.amount_paid) : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No documents yet.</td></tr>'}
    </table>`;
  $('#edit').addEventListener('click', () => customerModal(c));
  $$('tr.click', el).forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/doc/${tr.dataset.id}`; }));
}

// ------------------------------------------------------------------ reports
async function viewReports(el, _rest, query) {
  const from = query.from || todayIso();
  const to = query.to || from;
  const r = await api(`/api/reports/summary?from=${from}&to=${to}`);
  const maxDay = Math.max(1, ...r.daily.map((d) => d.total));
  const preset = (label, f, t) => `<a class="btn sm" href="#/reports?from=${f}&to=${t}">${label}</a>`;
  const d = new Date(`${todayIso()}T00:00:00`);
  const iso = (x) => new Date(x - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const weekStart = new Date(d); weekStart.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);

  el.innerHTML = `
    <div class="topbar"><h1>Reports</h1>
      <form class="row" id="rf">
        ${preset('Today', todayIso(), todayIso())}${preset('This week', iso(weekStart), todayIso())}${preset('This month', iso(monthStart), todayIso())}
        <input type="date" name="from" value="${from}" style="width:auto"> to <input type="date" name="to" value="${to}" style="width:auto">
        <button class="btn">Show</button>
        <a class="btn" href="/api/export/documents.csv?from=${from}&to=${to}">Export CSV</a>
      </form></div>
    <div class="cards">
      <div class="card stat"><div class="k">Total sales</div><div class="v">${K(r.sales.total)}</div><div class="muted">${r.sales.pos_sales.count} till sales · ${r.sales.invoices.count} invoices</div></div>
      <div class="card stat"><div class="k">Money collected</div><div class="v">${K(r.collected)}</div></div>
      <div class="card stat"><div class="k">Gross profit (top items)</div><div class="v">${K(r.sales.gross_profit_top_items)}</div><div class="muted">based on cost prices</div></div>
      <div class="card stat"><div class="k">Owed by customers</div><div class="v" style="color:var(--bad)">${K(r.outstanding_total)}</div><div class="muted">${r.outstanding.length} unpaid invoices</div></div>
      <div class="card stat"><div class="k">Open quotations</div><div class="v">${r.open_quotations.count}</div><div class="muted">${K(r.open_quotations.total)}</div></div>
    </div>
    <div class="grid2">
      <div class="card"><h2>Collections by payment method</h2>
        <table class="list">${r.payments.map((p) => `<tr><td>${METHODS[p.method] || esc(p.method)}</td><td class="num">${p.count}</td><td class="num">${money(p.total)}</td></tr>`).join('') || '<tr><td class="muted">No payments.</td></tr>'}</table>
        <h2 style="margin-top:16px">Sales by day</h2>
        <table class="list">${r.daily.map((x) => `<tr><td class="nowrap">${fmtDate(x.date)}</td><td style="width:50%"><div class="bar" style="width:${(x.total / maxDay) * 100}%"></div></td><td class="num">${money(x.total)}</td></tr>`).join('') || '<tr><td class="muted">No sales.</td></tr>'}</table>
      </div>
      <div class="card"><h2>Top selling items</h2>
        <table class="list"><tr><th>Item</th><th class="num">Qty</th><th class="num">Sales</th></tr>
          ${r.top_products.map((p) => `<tr><td>${esc(p.description)}</td><td class="num">${qtyFmt(p.qty)}</td><td class="num">${money(p.total)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No sales.</td></tr>'}</table>
      </div>
      <div class="card"><h2>Unpaid invoices (debtors)</h2>
        <table class="list"><tr><th>No.</th><th>Date</th><th>Customer</th><th class="num">Balance</th></tr>
          ${r.outstanding.map((o) => `<tr class="click" data-id="${o.id}"><td>${o.number}</td><td>${fmtDate(o.date)}</td><td>${esc(o.customer_name)}</td><td class="num">${money(o.balance)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nothing owed.</td></tr>'}</table>
      </div>
      <div class="card"><h2>Low stock</h2>
        <table class="list"><tr><th>Product</th><th class="num">Stock</th><th class="num">Re-order at</th></tr>
          ${r.low_stock.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${qtyFmt(p.stock)}</td><td class="num">${qtyFmt(p.reorder_level)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">All stocked.</td></tr>'}</table>
      </div>
    </div>`;
  $('#rf').addEventListener('submit', (e) => { e.preventDefault(); const f = formData(e.target); location.hash = `#/reports?from=${f.from}&to=${f.to || f.from}`; });
  $$('tr.click', el).forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/doc/${tr.dataset.id}`; }));
}

// ----------------------------------------------------------------- settings
async function viewSettings(el) {
  const s = state.settings = await api('/api/settings');
  const admin = isAdmin();
  const users = admin ? await api('/api/users') : [];
  const dis = admin ? '' : 'disabled';
  const field = (k, label, attrs = '') => `<label>${label}<input name="${k}" value="${esc(s[k])}" ${attrs} ${dis}></label>`;

  el.innerHTML = `
    <div class="topbar"><h1>Settings</h1>${admin ? '<a class="btn" href="/api/backup">Download backup</a>' : ''}</div>
    <form id="sf">
      <div class="grid2">
        <div class="card">
          <h2>Business (printed on every document)</h2>
          ${field('business_name', 'Business name')}
          <label>Tagline (one line per row)<textarea name="tagline" rows="3" ${dis}>${esc(s.tagline)}</textarea></label>
          <div class="grid2">${field('phone', 'Cell')}${field('tpin', 'TPIN')}</div>
          <div class="grid2">${field('brand_color', 'Brand colour', 'type="color"')}${field('currency', 'Currency symbol')}</div>
        </div>
        <div class="card">
          <h2>Bank details (Invoice, Quotation, Receipt)</h2>
          ${field('bank_account_name', 'Account name')}
          ${field('bank_account_number', 'Account number')}
          <div class="grid2">${field('bank_name', 'Bank')}${field('bank_branch', 'Branch')}</div>
        </div>
        <div class="card">
          <h2>Documents</h2>
          <div class="grid2">
            ${field('vat_rate', 'Default VAT %', 'type="number" min="0" max="100" step="any"')}
            ${field('quotation_validity_days', 'Quotation valid for (days)', 'type="number" min="1"')}
            <label>Paper size<select name="paper_size" ${dis}>${['A5', 'A4'].map((p) => `<option ${s.paper_size === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
            <label>When stock runs out<select name="allow_negative_stock" ${dis}><option value="1" ${s.allow_negative_stock !== '0' ? 'selected' : ''}>Allow sale (stock goes negative)</option><option value="0" ${s.allow_negative_stock === '0' ? 'selected' : ''}>Block the sale</option></select></label>
          </div>
          ${field('receipt_footer', 'Receipt footer message')}
        </div>
        <div class="card">
          <h2>Next document numbers</h2>
          <p class="muted" style="margin-top:0">Continue from your printed books, e.g. Invoice 254, Quotation 259.</p>
          <div class="grid2">${Object.entries(DOC).map(([k, v]) => `<label>${v}<input name="next_${k}" type="number" min="1" value="${s.next_numbers[k]}" ${dis}></label>`).join('')}</div>
        </div>
      </div>
      ${admin ? '<div class="row" style="margin:14px 0"><button class="btn primary big">Save settings</button></div>' : ''}
    </form>
    <div class="grid2" style="margin-top:14px">
      ${admin ? `<div class="card"><div class="row" style="justify-content:space-between"><h2>Users</h2><button class="btn sm" id="adduser">+ Add user</button></div>
        <table class="list">${users.map((u) => `<tr data-id="${u.id}"><td><b>${esc(u.full_name)}</b><div class="muted">${esc(u.username)}</div></td><td>${badge(u.role)} ${u.active ? '' : badge('inactive')}</td><td class="right"><button class="btn sm" data-edit>Edit</button></td></tr>`).join('')}</table></div>` : ''}
      <div class="card"><h2>Change my password</h2>
        <form id="pw">
          <label>Current password<input name="current_password" type="password" required></label>
          <label>New password (min 6)<input name="new_password" type="password" minlength="6" required></label>
          <button class="btn">Change password</button>
        </form></div>
    </div>`;

  $('#sf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const next_numbers = {};
    for (const k of Object.keys(DOC)) {
      const v = Number(f[`next_${k}`]);
      if (v !== s.next_numbers[k]) next_numbers[k] = v;
      delete f[`next_${k}`];
    }
    const r = await guard(() => api('/api/settings', { method: 'PUT', body: { ...f, next_numbers } }));
    if (r) { state.settings = r; toast('Settings saved'); router(); }
  });
  $('#pw').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await guard(() => api('/api/me/password', { method: 'PUT', body: formData(e.target) }));
    if (r) { toast('Password changed'); e.target.reset(); }
  });
  $('#adduser')?.addEventListener('click', () => userModal());
  $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => userModal(users.find((u) => u.id === Number(b.closest('tr').dataset.id)))));
}

function userModal(u) {
  const isNew = !u;
  u = u || { role: 'cashier', active: true };
  const m = modal(`
    <h2>${isNew ? 'Add user' : `Edit ${esc(u.username)}`}</h2>
    <form id="f">
      ${isNew ? '<label>Username<input name="username" required></label>' : ''}
      <label>Full name (printed as "Prepared by")<input name="full_name" value="${esc(u.full_name)}" required></label>
      <div class="grid2">
        <label>Role<select name="role"><option value="cashier" ${u.role === 'cashier' ? 'selected' : ''}>Cashier</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrator</option></select></label>
        <label>${isNew ? 'Password' : 'New password (leave blank to keep)'}<input name="password" type="password" ${isNew ? 'required minlength="6"' : ''}></label>
      </div>
      ${isNew ? '' : `<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Active</label>`}
      <p class="muted">Cashiers can sell, create documents and record payments. Administrators can also manage products, stock, users, settings and void documents.</p>
      <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div>
    </form>`);
  $('#f', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    if (!isNew && !f.password) delete f.password;
    const r = await guard(() => api(isNew ? '/api/users' : `/api/users/${u.id}`, { method: isNew ? 'POST' : 'PUT', body: f }));
    if (r) { m.close(); toast('User saved'); router(); }
  });
}

window.addEventListener('hashchange', router);
router();
