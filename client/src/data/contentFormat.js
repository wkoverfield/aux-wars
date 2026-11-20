/**
 * Number and date text for the content pages (charts, song, artist).
 *
 * Every function is locale-fixed and timezone-free: the build renders these
 * strings in Node and the app renders them again in the visitor's browser,
 * and both must produce the same text.
 */
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** 12345 -> "12,345" */
export function formatCount(n) {
  return WHOLE.format(n);
}

/** An average rating, two decimals: 3.4 -> "3.40". Null stays null. */
export function formatAverage(n) {
  return typeof n === "number" ? n.toFixed(2) : null;
}

/** "pick" or "picks", with the count: 1 -> "1 pick". */
export function plural(n, word) {
  return `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;
}

function parts(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error(`content: bad date "${isoDate}"`);
  const [year, month, day] = match.slice(1).map(Number);
  if (month < 1 || month > 12) throw new Error(`content: bad date "${isoDate}"`);
  return { year, month: MONTHS[month - 1], day };
}

/** "2026-11-16" -> "November 16, 2026" */
export function formatDate(isoDate) {
  const { year, month, day } = parts(isoDate);
  return `${month} ${day}, ${year}`;
}

/** "2026-11-16", "2026-11-22" -> "November 16 to 22, 2026" */
export function formatDateRange(startIso, endIso) {
  const start = parts(startIso);
  const end = parts(endIso);
  if (start.year !== end.year) return `${formatDate(startIso)} to ${formatDate(endIso)}`;
  if (start.month !== end.month) return `${start.month} ${start.day} to ${end.month} ${end.day}, ${end.year}`;
  return `${start.month} ${start.day} to ${end.day}, ${end.year}`;
}
