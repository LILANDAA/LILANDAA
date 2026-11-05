# Point of Sale — Sanka General Dealers

A point of sale and stock system that prints **Quotations**, **Invoices**,
**Delivery Notes** and **Receipts** laid out like the shop's own stationery:
blue letterhead, TPIN, red document number, M/S lines, ruled item table, bank
details and signature lines.

It runs on one computer in the shop (or a small server) and the other
devices on the network use it through a web browser. It works offline and
needs **no extra software** besides Node.js 22.5 or newer. It uses Node's
built-in SQLite, so there is nothing to `npm install`.

## Quick start

```bash
npm start            # http://localhost:3000
npm run demo         # optional: load sample products and documents
npm test             # run the automated tests
```

Log in with **admin / admin123**, then change the password straight away in
*Settings → Change my password*. Other tills/phones on the same network can
open `http://<this-computer's-IP>:3000`.

Environment variables: `PORT` (default 3000), `HOST` (default 0.0.0.0) and
`DB_FILE` (default `data/pos.db`).

## Features

| Area | What it does |
| --- | --- |
| **Till (POS)** | Product tiles and search, barcode/SKU scan + Enter, custom (non-catalogue) items, editable qty/price, discount, VAT, cash / mobile money / bank transfer / card / cheque, amount tendered and change. Sales can also be saved as a Quotation or an Invoice. |
| **Quotation** | Client box, No., Date, Sub total / VAT / Total, "valid for N days", bank details, Prepared by and Signature. One click **Convert to Invoice**. |
| **Invoice** | M/S, No., Date, Qty / Description / Unit Price / Amount, TOTAL K, bank details, Prepared by and Received by. Tracks paid, part paid and unpaid, and shows the balance due. |
| **Delivery Note** | Created from an invoice. Supports **part deliveries** (e.g. everything except the drinks) and won't let you deliver more than was invoiced. Qty / Description, Delivered by, Signature. |
| **Receipt** | For till sales (items, tendered, change) or for **payments against an invoice** (sum in words, invoice reference, balance remaining). Prints on A5/A4 like the other forms, or on an **80mm thermal slip**. |
| **Stock** | Stock goes down on an invoice, a till sale or a stand-alone delivery note, and back up when that document is voided. Restock, returns, damage and stock counts each have their own entry, with a full history. Low-stock alerts at a re-order level you set. Choose whether a sale is allowed when stock runs out. |
| **Customers** | Customer details and TPIN, all their documents, and what they owe. |
| **Reports** | Sales for today, this week, this month or any dates you pick; money collected by payment method; sales by day; best-selling items with gross profit; unpaid invoices; low stock; open quotations. Export to CSV. |
| **Settings** | Business name, tagline, cell numbers, TPIN, bank details, brand colour, default VAT %, quotation validity, paper size (A5/A4), receipt footer. **Next number for each document type**, so you can carry on from the paper books (e.g. Invoice 254). |
| **Users** | Admin and Cashier roles. A cashier's name is printed as "Prepared by". Only an admin can void documents (a reason is required, and nothing is deleted). |
| **Backup** | *Settings → Download backup* saves all the data as a JSON file. Or copy the `data/` folder. |

### How the documents connect

```
Quotation ──convert──▶ Invoice ──▶ Delivery Note(s)   (part deliveries allowed)
                          └──────▶ Receipt(s)          (part payments allowed)
Till sale ──────────────▶ Receipt (paid in full)
```

## Project layout

```
src/db.js        schema, default settings, first admin user
src/services.js  business rules (documents, stock, payments, reports)
src/print.js     printable layouts (A5/A4 forms + 80mm slip)
src/money.js     ngwee arithmetic, number formatting, amount in words
src/server.js    HTTP server + JSON API + /print/:id
public/          the browser app (plain JavaScript, no build step)
scripts/demo.js  sample data from the paper documents
test/            API tests (node --test)
```

The API keeps every money value in **ngwee**, as whole numbers
(K7,420.00 = `742000`), so there are never any rounding errors.
