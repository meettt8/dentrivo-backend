import { getDb } from '../config/db.js';

/** Escape a term for RegExp search. */
export function likeTerm(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Start of the current day — Laravel's `today()`. */
export function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Format a date as 'YYYY-MM-DD' for a DATE field, with no timezone shift. */
export function toDateString(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `whereDate('col', $date)` against a DATE field. */
export function whereDate(date) {
  return toDateString(date);
}

/** An inclusive DATETIME range covering one calendar day. */
export function whereDateTime(date) {
  return { between: [startOfDay(date), endOfDay(date)] };
}

/** `whereMonth`/`whereYear` → a half-open range over DATETIME fields. */
export function whereMonth(year, month) {
  return { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) };
}

export function whereYear(year) {
  return { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) };
}

/** The same two ranges expressed for DATE fields. */
export function whereMonthDate(year, month) {
  return { gte: toDateString(new Date(year, month - 1, 1)), lt: toDateString(new Date(year, month, 1)) };
}

export function whereYearDate(year) {
  return { gte: `${year}-01-01`, lt: `${year + 1}-01-01` };
}

/** Monday-to-Sunday range, matching Carbon's `startOfWeek`/`endOfWeek`. */
export function currentWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return { between: [toDateString(start), toDateString(end)] };
}

/** Carbon's `dayOfYear`. */
export function dayOfYear(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

/** `Str::slug()` */
export function slug(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `Str::random()` */
export function randomString(length = 16) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

/** `str_pad($n, $len, '0', STR_PAD_LEFT)` */
export function padLeft(value, length, char = '0') {
  return String(value).padStart(length, char);
}

/** True when a request field was submitted and non-empty — Laravel's `filled()`. */
export function filled(value) {
  return value !== undefined && value !== null && value !== '';
}

/**
 * Returns a `{ [month]: value }` map so the charts keep their existing shape.
 */
export async function groupByMonth(table, {
  dateField, valueField = null, filter = {},
}) {
  const col = getDb().collection(table);
  const match = { deleted_at: null, ...filter };

  const monthExpr = {
    $cond: [
      { $eq: [{ $type: `$${dateField}` }, 'date'] },
      { $month: `$${dateField}` },
      {
        $cond: [
          { $eq: [{ $type: `$${dateField}` }, 'string'] },
          { $toInt: { $substr: [`$${dateField}`, 5, 2] } },
          null,
        ],
      },
    ],
  };

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: monthExpr,
        value: valueField ? { $sum: `$${valueField}` } : { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ];

  const results = await col.aggregate(pipeline).toArray();
  const out = {};
  for (let m = 1; m <= 12; m += 1) out[m] = 0;
  for (const r of results) {
    if (r._id !== null && r._id !== undefined) {
      out[Number(r._id)] = Number(r.value || 0);
    }
  }
  return out;
}

/** Group by field counts. */
export async function groupByField(table, { field, filter = {} }) {
  const col = getDb().collection(table);
  const match = { deleted_at: null, ...filter };

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: `$${field}`,
        count: { $sum: 1 },
      },
    },
  ];

  const results = await col.aggregate(pipeline).toArray();
  return Object.fromEntries(results.map((r) => [String(r._id), Number(r.count)]));
}

/** Build a `{ id: row }` lookup from a list of rows. */
export function keyBy(rows, key = 'id') {
  return Object.fromEntries(rows.map((row) => [String(row[key]), row]));
}
