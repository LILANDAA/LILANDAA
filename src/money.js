'use strict';
// Money helpers. Amounts are integer ngwee internally (K1 = 100 ngwee).

function toNgwee(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[,\sK]/gi, ''));
  if (!Number.isFinite(n)) throw new HttpError(400, `Invalid amount: ${value}`);
  return Math.round(n * 100);
}

function formatMoney(ngwee, { decimals = true } = {}) {
  const neg = ngwee < 0;
  const abs = Math.abs(Math.round(ngwee));
  const kwacha = Math.floor(abs / 100);
  const cents = abs % 100;
  const whole = kwacha.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const out = decimals ? `${whole}.${String(cents).padStart(2, '0')}` : whole;
  return neg ? `-${out}` : out;
}

// Quantities are printed like the hand-written books: 02, 01, 10 ...
function formatQty(qty) {
  const n = Number(qty);
  if (Number.isInteger(n)) return n >= 0 && n < 10 ? `0${n}` : String(n);
  return String(Math.round(n * 1000) / 1000);
}

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function below1000(n) {
  const parts = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
    if (n) parts.push('and');
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ''));
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(' ');
}

function integerToWords(n) {
  if (n === 0) return 'zero';
  const scales = ['', 'thousand', 'million', 'billion', 'trillion'];
  const chunks = [];
  let i = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) chunks.unshift(below1000(chunk) + (scales[i] ? ` ${scales[i]}` : ''));
    n = Math.floor(n / 1000);
    i++;
  }
  // "one thousand and five" style for a trailing chunk below 100
  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1];
    if (!last.includes('hundred') && !/thousand|million|billion|trillion/.test(last)) {
      chunks[chunks.length - 1] = `and ${last}`;
    }
  }
  return chunks.join(' ');
}

// e.g. 742000 -> "Seven thousand four hundred and twenty Kwacha only"
function amountInWords(ngwee) {
  const abs = Math.abs(Math.round(ngwee));
  const kwacha = Math.floor(abs / 100);
  const cents = abs % 100;
  let words = `${integerToWords(kwacha)} Kwacha`;
  if (cents) words += ` and ${integerToWords(cents)} Ngwee`;
  words += ' only';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { toNgwee, formatMoney, formatQty, amountInWords, integerToWords, HttpError };
