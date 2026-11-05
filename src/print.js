'use strict';
// Printable documents. The layouts reproduce the business's pre-printed
// stationery (Quotation, Invoice, Delivery Note) and add a Receipt in the same
// style, plus a narrow 80mm slip for thermal receipt printers.
//
// All sizes are in rem, and 1rem is set to 1mm on A5 paper, so the same
// template scales up cleanly for A4.

const { formatMoney, formatQty, amountInWords } = require('./money');
const { PAYMENT_METHODS } = require('./services');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const METHOD_LABELS = {
  cash: 'Cash',
  mobile_money: 'Mobile Money',
  bank_transfer: 'Bank Transfer',
  card: 'Card',
  cheque: 'Cheque',
};
if (PAYMENT_METHODS.some((m) => !METHOD_LABELS[m])) throw new Error('Missing payment method label');

function fmtDate(iso, sep = '/') {
  const [y, m, d] = String(iso).split('-');
  return [d, m, y].join(sep);
}

const money = (n) => formatMoney(n);

const CSS = `
:root { --brand: #1f6fd1; --ink: #1b2f86; --red: #e3141b; --line: #2140a0; }
* { box-sizing: border-box; }
html { font-size: 1mm; }
html.a4 { font-size: 1.44mm; }
body { margin: 0; background: #dfe4ea; color: #111; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.toolbar { position: sticky; top: 0; z-index: 5; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; padding: 10px; background: #26324a; font: 14px system-ui, sans-serif; }
.toolbar a, .toolbar button { font: inherit; padding: 7px 14px; border-radius: 6px; border: 0; background: #fff; color: #222; text-decoration: none; cursor: pointer; }
.toolbar .primary { background: #1f6fd1; color: #fff; }
.toolbar a.active { outline: 2px solid #8fb8ff; }
.sheet { position: relative; width: 140rem; min-height: 200rem; margin: 6mm auto; padding: 5rem 4rem; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.25); overflow: hidden; }
@media print {
  body { background: #fff; }
  .toolbar { display: none; }
  .sheet { margin: 0; box-shadow: none; padding: 0; width: auto; min-height: 0; }
}
.brand { text-align: center; color: var(--brand); font-family: 'Arial Black', 'Helvetica Neue', Arial, sans-serif; font-weight: 900; font-size: 9.6rem; line-height: 1; letter-spacing: .1rem; white-space: nowrap; }
.tagline { text-align: center; font-style: italic; font-size: 3.1rem; line-height: 1.35; color: #333; margin-top: 1.5rem; }
.hdr-foot { position: relative; }
.tpin { font-size: 3.3rem; font-weight: bold; color: #222; letter-spacing: .1rem; }
.hdr-foot .tpin { position: absolute; left: 0; bottom: 0; }
.rule { border-top: .55rem solid var(--ink); margin: 1.6rem 0 1.2rem; }
.title { font-family: 'Times New Roman', Times, serif; font-weight: bold; color: var(--ink); font-size: 6.6rem; letter-spacing: .25rem; text-align: center; }
.title.condensed { font-family: Impact, 'Arial Narrow', 'Haettenschweiler', sans-serif; font-weight: 700; letter-spacing: 0; font-size: 7.6rem; transform: scaleY(1.05); }
.fill { color: #0e1530; font-size: 4.1rem; font-family: 'Segoe UI', Arial, sans-serif; }
.dots { border-bottom: .3rem dotted #444; min-height: 6.6rem; padding: 1rem 0 .3rem; line-height: 1.2; }
.lbl { font-size: 3.6rem; color: #222; white-space: nowrap; }
.ms { display: grid; grid-template-columns: 1fr 44rem; column-gap: 6rem; margin-top: 2rem; }
.ms .lines .dots:first-child { display: flex; gap: 1rem; align-items: baseline; }
.no { font-size: 5rem; font-weight: bold; color: var(--ink); display: flex; gap: 5rem; align-items: baseline; padding-top: 3rem; }
.no .num { color: var(--red); font-size: 7rem; letter-spacing: .3rem; font-family: Arial, sans-serif; }
.date { display: flex; align-items: flex-end; gap: 1rem; margin-top: auto; }
.date .dots { flex: 1; }
.right-col { display: flex; flex-direction: column; }
.ref { font-size: 3rem; color: #444; text-align: right; margin-top: 1rem; }
table.items { width: 100%; border-collapse: collapse; margin-top: 2rem; border: .45rem solid var(--line); }
table.items th { font-family: 'Times New Roman', Times, serif; font-weight: normal; font-size: 4.3rem; color: #111; padding: 1.6rem 1rem; border: .3rem solid var(--line); }
table.items td { border: .3rem solid var(--line); padding: 0 1.6rem; height: 6.6rem; font-size: 3.9rem; color: #0e1530; vertical-align: middle; }
table.items td.c { text-align: center; }
table.items td.r { text-align: right; white-space: nowrap; }
table.items tr.empty td { height: 6.6rem; }
.foot { display: grid; grid-template-columns: 1fr auto; gap: 2rem; margin-top: 2rem; align-items: start; }
.bank { font-family: 'Times New Roman', Times, serif; font-size: 3.2rem; line-height: 1.55; }
.bank td { padding: 0 2rem 0 0; white-space: nowrap; }
.bank td:first-child { font-weight: bold; }
.totals { border-collapse: collapse; }
.totals th { text-align: right; padding: 0 2rem; color: var(--ink); font-size: 4.5rem; font-family: 'Times New Roman', Times, serif; white-space: nowrap; }
.totals td { border: .45rem solid var(--line); min-width: 33rem; height: 8.4rem; text-align: right; padding: 0 2rem; font-size: 4.6rem; color: #0e1530; }
.totals tr.grand td { border-bottom-width: 1rem; border-bottom-style: double; }
.sig { display: flex; gap: 2rem; align-items: flex-end; margin-top: 5rem; font-family: 'Times New Roman', Times, serif; font-size: 4.3rem; }
.sig .dots { flex: 1; font-family: 'Segoe UI', Arial, sans-serif; }
.sig .dots.short { flex: 0 0 38rem; }
.notes { font-size: 3.3rem; margin-top: 2rem; color: #333; }
.void { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }
.void span { transform: rotate(-30deg); font-size: 36rem; font-weight: 900; color: rgba(227,20,27,.18); border: 3rem solid rgba(227,20,27,.18); padding: 0 8rem; border-radius: 6rem; }
.void-reason { color: var(--red); font-size: 3.3rem; text-align: center; margin-top: 1rem; }

/* Quotation specifics */
.q-boxes { display: grid; grid-template-columns: 1fr 62rem; gap: 7rem; margin-top: 2rem; }
.q-client { border: .4rem solid #333; border-radius: 1.5rem; padding: 2rem 2.5rem 2rem; }
.q-no { display: flex; align-items: center; gap: 3rem; }
.q-no .n { font-family: 'Times New Roman', Times, serif; font-size: 7rem; color: #222; }
.q-no .box { flex: 1; border: .4rem solid #333; height: 17rem; display: flex; align-items: center; justify-content: center; color: var(--red); font-size: 7rem; letter-spacing: .3rem; }
.q-date { border: .4rem solid #333; margin-top: 7rem; padding: 2rem 2.5rem; display: flex; align-items: flex-end; gap: 1rem; }
.q-date .dots { flex: 1; }
table.q th { font-weight: bold; color: var(--ink); border-bottom: 1.4rem solid var(--line); }
.validity { white-space: nowrap; font-size: 3.3rem; margin-top: 4rem; display: flex; align-items: flex-end; gap: 1rem; }
.validity .dots { min-width: 16rem; text-align: center; }
table.prep { width: 100%; border-collapse: collapse; margin-top: 4rem; }
table.prep td { border: .4rem solid #333; padding: 1.5rem 2.5rem; height: 9rem; font-size: 4.3rem; }
table.prep td:first-child { width: 30%; color: #333; }

/* Receipt specifics */
.amount-box { display: inline-block; border: .45rem solid var(--line); padding: 1.8rem 4rem; font-size: 6rem; font-weight: bold; color: #0e1530; }
.pay-grid { display: grid; grid-template-columns: auto 1fr; column-gap: 2.5rem; align-items: end; margin-top: 2rem; }
.pay-grid .lbl { padding-bottom: .5rem; white-space: nowrap; }

/* 80mm thermal slip */
.slip { width: 72mm; margin: 6mm auto; background: #fff; padding: 4mm; font: 12px/1.35 'Courier New', ui-monospace, monospace; color: #000; box-shadow: 0 2px 12px rgba(0,0,0,.25); }
.slip .c { text-align: center; }
.slip .b { font-weight: bold; }
.slip hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
.slip table { width: 100%; border-collapse: collapse; }
.slip td { vertical-align: top; padding: 1px 0; }
.slip td.r { text-align: right; white-space: nowrap; }
.slip .big { font-size: 16px; font-weight: bold; }
@media print { .slip { margin: 0; box-shadow: none; padding: 0; width: auto; } }
`;

function brandHeader(s, { tpinOnHeader = false } = {}) {
  const tagLines = String(s.tagline || '').split('\n').filter(Boolean).map(esc);
  if (s.phone) tagLines.push(`Cell: ${esc(s.phone)}`);
  return `
    <div class="brand">${esc(s.business_name)}</div>
    <div class="hdr-foot">
      <div class="tagline">${tagLines.join('<br>')}</div>
      ${tpinOnHeader && s.tpin ? `<div class="tpin">Tpin: ${esc(s.tpin)}</div>` : ''}
    </div>`;
}

function customerLines(doc, prefix = 'M/S') {
  const lines = [doc.customer_name, ...String(doc.customer_address || '').split('\n')].filter((l) => l && l.trim());
  while (lines.length < 3) lines.push('');
  return lines.map((l, i) => `<div class="dots">${i === 0 ? `<span class="lbl">${prefix}</span>` : ''}<span class="fill">${esc(l)}</span></div>`).join('');
}

function numberBlock(doc, { dateSep = '/' } = {}) {
  return `
    <div class="right-col">
      <div class="no">No. <span class="num">${doc.number}</span></div>
      <div class="date"><span class="lbl">Date:</span><div class="dots fill">${fmtDate(doc.date, dateSep)}</div></div>
      ${doc.source ? `<div class="ref">Ref: ${esc(labelOf(doc.source.type))} No. ${doc.source.number}</div>` : ''}
    </div>`;
}

function labelOf(type) {
  return { quotation: 'Quotation', invoice: 'Invoice', delivery_note: 'Delivery Note', receipt: 'Receipt' }[type];
}

function itemRows(items, { priced, minRows }) {
  const cols = priced ? 4 : 2;
  const rows = items.map((it) => priced
    ? `<tr><td class="c">${formatQty(it.qty)}</td><td>${esc(it.description)}</td><td class="r">${money(it.unit_price)}</td><td class="r">${money(it.amount)}</td></tr>`
    : `<tr><td class="c">${formatQty(it.qty)}</td><td>${esc(it.description)}</td></tr>`);
  for (let i = items.length; i < minRows; i++) rows.push(`<tr class="empty">${'<td></td>'.repeat(cols)}</tr>`);
  return rows.join('');
}

function bankDetails(s) {
  return `
    <table class="bank">
      <tr><td>Account Name</td><td>: ${esc(s.bank_account_name)}</td></tr>
      <tr><td>Account Number</td><td>: ${esc(s.bank_account_number)}</td></tr>
      <tr><td>Bank</td><td>: ${esc(s.bank_name)}</td></tr>
      <tr><td>Branch</td><td>: ${esc(s.bank_branch)}</td></tr>
    </table>`;
}

function totalsTable(doc, s, { alwaysSubtotal = false } = {}) {
  const cur = esc(s.currency || 'K');
  const rows = [];
  const showBreakdown = alwaysSubtotal || doc.discount > 0 || doc.vat_amount > 0;
  if (showBreakdown) rows.push(`<tr><th>SUB TOTAL ${cur}</th><td>${money(doc.subtotal)}</td></tr>`);
  if (doc.discount > 0) rows.push(`<tr><th>DISCOUNT ${cur}</th><td>${money(doc.discount)}</td></tr>`);
  if (alwaysSubtotal || doc.vat_amount > 0) {
    rows.push(`<tr><th>VAT @ ${doc.vat_rate ? `${doc.vat_rate}%` : ''}</th><td>${doc.vat_amount ? money(doc.vat_amount) : '-'}</td></tr>`);
  }
  rows.push(`<tr class="grand"><th>TOTAL ${cur}</th><td><b>${money(doc.total)}</b></td></tr>`);
  return `<table class="totals">${rows.join('')}</table>`;
}

function voidMark(doc) {
  return doc.voided_at ? `<div class="void"><span>VOID</span></div>` : '';
}
function voidReason(doc) {
  return doc.voided_at ? `<div class="void-reason">VOIDED: ${esc(doc.void_reason)}</div>` : '';
}
function notes(doc) {
  return doc.notes ? `<div class="notes"><b>Notes:</b> ${esc(doc.notes)}</div>` : '';
}

// ------------------------------------------------------------------ layouts
function invoiceHtml(doc, s) {
  return `
    ${brandHeader(s, { tpinOnHeader: true })}
    <div class="rule"></div>
    <div class="title">INVOICE</div>
    ${voidReason(doc)}
    <div class="ms"><div class="lines">${customerLines(doc)}</div>${numberBlock(doc)}</div>
    <table class="items">
      <colgroup><col style="width:11%"><col><col style="width:20%"><col style="width:23%"></colgroup>
      <tr><th>Qty</th><th>Description</th><th>Unit Price</th><th>Amount</th></tr>
      ${itemRows(doc.items, { priced: true, minRows: 14 })}
    </table>
    <div class="foot">${bankDetails(s)}${totalsTable(doc, s)}</div>
    ${notes(doc)}
    <div class="sig"><span>Prepared by:</span><div class="dots">${esc(doc.prepared_by_name)}</div><span>Sign:</span><div class="dots short"></div></div>
    <div class="sig"><span>Received by:</span><div class="dots"></div><span>Sign:</span><div class="dots short"></div></div>`;
}

function deliveryNoteHtml(doc, s) {
  return `
    ${brandHeader(s)}
    <div class="rule"></div>
    <div style="position:relative">
      ${s.tpin ? `<div class="tpin" style="position:absolute;left:0;top:1.5rem">Tpin: ${esc(s.tpin)}</div>` : ''}
      <div class="title">DELIVERY NOTE</div>
    </div>
    ${voidReason(doc)}
    <div class="ms"><div class="lines">${customerLines(doc)}</div>${numberBlock(doc)}</div>
    <table class="items">
      <colgroup><col style="width:14%"><col></colgroup>
      <tr><th>Qty</th><th>Description</th></tr>
      ${itemRows(doc.items, { priced: false, minRows: 17 })}
    </table>
    ${notes(doc)}
    <div class="sig"><span>Delivered by:</span><div class="dots">${esc(doc.delivered_by)}</div></div>
    <div class="sig"><span>Signature:</span><div class="dots"></div></div>`;
}

function quotationHtml(doc, s) {
  return `
    ${brandHeader(s)}
    <div class="rule"></div>
    <div class="title condensed">QUOTATION</div>
    ${voidReason(doc)}
    ${s.tpin ? `<div class="tpin" style="margin-top:1rem">Tpin: ${esc(s.tpin)}</div>` : ''}
    <div class="q-boxes">
      <div class="q-client">${customerLines(doc, 'Client:')}</div>
      <div>
        <div class="q-no"><span class="n">N<sup style="font-size:.5em">o.</sup></span><div class="box">${doc.number}</div></div>
        <div class="q-date"><span class="lbl">Date:</span><div class="dots fill">${fmtDate(doc.date, '-')}</div></div>
      </div>
    </div>
    <table class="items q">
      <colgroup><col style="width:11%"><col><col style="width:19%"><col style="width:22%"></colgroup>
      <tr><th>Qty</th><th>Description</th><th>Unit Price</th><th>Amount</th></tr>
      ${itemRows(doc.items, { priced: true, minRows: 14 })}
    </table>
    <div class="foot">
      <div>${bankDetails(s)}
        <div class="validity">This quotation is valid for <div class="dots fill">${esc(doc.validity_days)}</div> days</div>
      </div>
      ${totalsTable(doc, s, { alwaysSubtotal: true })}
    </div>
    ${notes(doc)}
    <table class="prep">
      <tr><td>Prepared by</td><td class="fill">${esc(doc.prepared_by_name)}</td></tr>
      <tr><td>Signature</td><td></td></tr>
    </table>`;
}

function receiptHtml(doc, s) {
  const isPayment = !!doc.source && doc.source.type === 'invoice';
  const method = METHOD_LABELS[doc.payment_method] || doc.payment_method || '';
  const methodText = method + (doc.payment_reference ? ` (Ref: ${doc.payment_reference})` : '');
  const cur = esc(s.currency || 'K');

  const body = isPayment
    ? `
      <div class="pay-grid" style="margin-top:6rem">
        <span class="lbl">The sum of</span><div class="dots fill">${esc(amountInWords(doc.amount_paid))}</div>
        <span class="lbl">Being payment for</span><div class="dots fill">Invoice No. ${doc.source.number} dated ${fmtDate(doc.source.date)}</div>
        <span class="lbl">Paid by</span><div class="dots fill">${esc(methodText)}</div>
        <span class="lbl">Balance due</span><div class="dots fill">${cur} ${money(doc.invoice_balance ?? 0)}</div>
      </div>
      <div style="margin-top:7rem; display:flex; justify-content:space-between; align-items:center">
        <div class="amount-box">${cur} ${money(doc.amount_paid)}</div>
      </div>`
    : `
      <table class="items">
        <colgroup><col style="width:11%"><col><col style="width:20%"><col style="width:23%"></colgroup>
        <tr><th>Qty</th><th>Description</th><th>Unit Price</th><th>Amount</th></tr>
        ${itemRows(doc.items, { priced: true, minRows: 9 })}
      </table>
      <div class="foot" style="grid-template-columns: 1fr auto">
        <div class="pay-grid" style="margin-top:0">
          <span class="lbl">Paid by</span><div class="dots fill">${esc(methodText)}</div>
          <span class="lbl">Tendered</span><div class="dots fill">${cur} ${money(doc.amount_tendered ?? doc.total)}</div>
          <span class="lbl">Change</span><div class="dots fill">${cur} ${money(doc.change_given ?? 0)}</div>
        </div>
        ${totalsTable(doc, s)}
      </div>
      <div class="pay-grid" style="margin-top:3rem">
        <span class="lbl">Amount in words</span><div class="dots fill">${esc(amountInWords(doc.total))}</div>
      </div>`;

  return `
    ${brandHeader(s, { tpinOnHeader: true })}
    <div class="rule"></div>
    <div class="title">RECEIPT</div>
    ${voidReason(doc)}
    <div class="ms"><div class="lines">${customerLines(doc, 'Received from')}</div>${numberBlock(doc)}</div>
    ${body}
    ${notes(doc)}
    <div style="margin-top:5rem">${bankDetails(s)}</div>
    <div class="sig"><span>Received by:</span><div class="dots">${esc(doc.prepared_by_name)}</div><span>Sign:</span><div class="dots short"></div></div>
    ${s.receipt_footer ? `<div class="tagline" style="margin-top:4rem">${esc(s.receipt_footer)}</div>` : ''}`;
}

function thermalHtml(doc, s) {
  const isPayment = !!doc.source && doc.source.type === 'invoice';
  const cur = esc(s.currency || 'K');
  const rows = doc.items.map((it) => `
    <tr><td colspan="2">${esc(it.description)}</td></tr>
    <tr><td>&nbsp;&nbsp;${formatQty(it.qty)} x ${money(it.unit_price)}</td><td class="r">${money(it.amount)}</td></tr>`).join('');
  const t = (label, v, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="r">${v}</td></tr>`;
  return `
  <div class="slip">
    <div class="c b" style="font-size:15px">${esc(s.business_name)}</div>
    ${s.phone ? `<div class="c">Cell: ${esc(s.phone)}</div>` : ''}
    ${s.tpin ? `<div class="c">TPIN: ${esc(s.tpin)}</div>` : ''}
    <hr>
    <div class="c b">${doc.voided_at ? '*** VOID *** ' : ''}${labelOf(doc.type).toUpperCase()} No. ${doc.number}</div>
    <div>Date: ${fmtDate(doc.date)} ${esc(String(doc.created_at || '').slice(11, 16))}</div>
    ${doc.customer_name ? `<div>Customer: ${esc(doc.customer_name)}</div>` : ''}
    <div>Served by: ${esc(doc.prepared_by_name)}</div>
    <hr>
    <table>${rows}</table>
    <hr>
    <table>
      ${!isPayment && (doc.discount || doc.vat_amount) ? t('Sub total', money(doc.subtotal)) : ''}
      ${doc.discount ? t('Discount', `-${money(doc.discount)}`) : ''}
      ${doc.vat_amount ? t(`VAT ${doc.vat_rate}%`, money(doc.vat_amount)) : ''}
      ${t(`<span class="big">TOTAL ${cur}</span>`, `<span class="big">${money(doc.total)}</span>`)}
      ${t(`Paid (${esc(METHOD_LABELS[doc.payment_method] || doc.payment_method || '')})`, money(doc.amount_tendered ?? doc.total))}
      ${doc.change_given ? t('Change', money(doc.change_given)) : ''}
      ${isPayment ? t('Balance due', money(doc.invoice_balance ?? 0)) : ''}
    </table>
    ${doc.payment_reference ? `<div>Ref: ${esc(doc.payment_reference)}</div>` : ''}
    <hr>
    <div class="c">${esc(amountInWords(doc.total))}</div>
    ${s.receipt_footer ? `<hr><div class="c">${esc(s.receipt_footer)}</div>` : ''}
  </div>`;
}

const RENDERERS = {
  quotation: quotationHtml,
  invoice: invoiceHtml,
  delivery_note: deliveryNoteHtml,
  receipt: receiptHtml,
};

function renderDocument(doc, settings, { format, autoprint } = {}) {
  const paper = format === 'a4' || format === 'A4' ? 'A4' : format === 'thermal' ? 'thermal' : (settings.paper_size || 'A5');
  const thermal = paper === 'thermal';
  const title = `${labelOf(doc.type)} No. ${doc.number}`;
  const pageCss = thermal
    ? '@page { size: 80mm auto; margin: 3mm; }'
    : `@page { size: ${paper} portrait; margin: 4mm; }`;
  const link = (fmt, label) => `<a href="?format=${fmt}" class="${paper.toLowerCase() === fmt ? 'active' : ''}">${label}</a>`;
  const content = thermal ? thermalHtml(doc, settings) : `<div class="sheet">${voidMark(doc)}${RENDERERS[doc.type](doc, settings)}</div>`;

  return `<!doctype html>
<html lang="en" class="${paper === 'A4' ? 'a4' : ''}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - ${esc(settings.business_name)}</title>
<style>${CSS}${pageCss}:root{--brand:${esc(settings.brand_color || '#1f6fd1')}}</style>
</head>
<body>
<div class="toolbar">
  <button class="primary" onclick="window.print()">Print</button>
  ${link('a5', 'A5')}${link('a4', 'A4')}${doc.type === 'receipt' ? link('thermal', '80mm slip') : ''}
  <button onclick="window.close(); history.length > 1 && history.back()">Close</button>
</div>
${content}
${autoprint ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),300))</script>' : ''}
</body>
</html>`;
}

module.exports = { renderDocument, fmtDate, METHOD_LABELS };
