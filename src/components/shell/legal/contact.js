// The one place that reads the operator's contact address. Nothing is ever hard-coded: set VITE_CONTACT_EMAIL at
// build time (docs/DEPLOY.md). When it is unset or malformed the contact line is simply not rendered.

// local part / domain labels: anything except whitespace, brackets, quotes, separators and backslashes
const PART = '[^\\s@<>"\',;:()\\[\\]\\\\]+';
const EMAIL = new RegExp(`^${PART}@${PART}\\.${PART}$`);

/** Validate a raw value (exported for tests). Returns the trimmed address or ''. */
export function cleanContactEmail(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  return s.length <= 254 && EMAIL.test(s) ? s : '';
}

/** The configured contact address, or '' when none is set. */
export function contactEmail() {
  let raw;
  try {
    raw = import.meta.env && import.meta.env.VITE_CONTACT_EMAIL;
  } catch {
    raw = '';
  }
  return cleanContactEmail(raw);
}

/** Date shown as "Last updated" on Privacy and Terms (update it together with the text). */
export const LEGAL_UPDATED = { iso: '2026-11-15', label: '15 November 2026' };
