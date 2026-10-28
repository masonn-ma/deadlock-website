/**
 * Number / duration / date formatters. All figures rendered by the site go
 * through these so formatting stays consistent (fixed decimals per metric,
 * thousands separators, signed deltas, tabular-friendly output).
 */

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** Roman numeral for rank subranks (1–6), or the plain number above that. */
export function roman(n) {
  if (n == null) return '';
  return ROMAN[n] ?? String(n);
}

/** 1,142 — thousands separators, no decimals. */
export function int(n) {
  if (n == null) return '\u2014';
  return Number(n).toLocaleString('en-US');
}

/** 31.8k / 1.2M — compact form for tight spaces. */
export function compact(n) {
  if (n == null) return '\u2014';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (abs >= 10_000) return `${trim(n / 1_000)}k`;
  return int(n);
}

function trim(n) {
  const s = n.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** 54.2% — percentages with one decimal, null-safe. */
export function pct(n) {
  if (n == null || !Number.isFinite(n)) return '\u2014';
  return `${n.toFixed(1)}%`;
}

/** 27:54 · 1:05:12 — match duration. */
export function duration(seconds) {
  if (seconds == null) return '\u2014';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m); // taste-skill-ignore: clock duration
  const ss = String(sec).padStart(2, '0'); // taste-skill-ignore: clock duration
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Signed delta: +430 / −85, always with a sign. */
export function signed(n) {
  if (n == null) return '\u2014';
  return n > 0 ? `+${int(n)}` : `−${int(Math.abs(n))}`;
}

/** 3 / 3 / 12 — kills / deaths / assists. */
export function kda(kills, deaths, assists) {
  if (kills == null || deaths == null || assists == null) return '\u2014';
  return `${kills} / ${deaths} / ${assists}`;
}

/** 3.7 — a per-game average with one decimal; null-safe. */
export function avg1(numerator, games) {
  if (!games || numerator == null) return '\u2014';
  return (numerator / games).toFixed(1);
}

/** "just now" → "3 h ago" → "2 d ago" → "12 Oct" → "12 Oct 2025". */
export function timeAgo(unixSeconds, now = Date.now()) {
  if (!unixSeconds) return '\u2014';
  const then = unixSeconds * 1000;
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d ago`;
  const d = new Date(then);
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date(now).getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

/** Hours from a seconds total: "12.4 h". */
export function hours(seconds) {
  if (seconds == null) return '\u2014';
  return `${(seconds / 3600).toFixed(1)} h`;
}

/** "Oct 19, 2026, 19:04" - full local timestamp for the match detail card. */
export function dateTime(unixSeconds) {
  if (!unixSeconds) return '\u2014';
  const d = new Date(unixSeconds * 1000);
  const day = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });
  return `${day}, ${time}`;
}

/** 731 - souls earned per minute across a match; null-safe. */
export function perMin(total, seconds) {
  if (total == null || !seconds) return '\u2014';
  return int(Math.round(total / (seconds / 60)));
}
