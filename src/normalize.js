/**
 * normalizeText(value)
 * Canonical form for free-text values that identify something (student names,
 * subjects, notes). Trims the ends, collapses runs of whitespace to one space,
 * and uppercases the result.
 *
 * Why: Google Sheets contains the same student in different casings
 * ("AMAYRA", "Amayra"), which made dashboards, dropdowns, and pivot groups
 * split one person into several. Normalizing on retrieval gives every view the
 * same value, so grouping and de-duplication are case-insensitive by design.
 *
 * @param {*} value - Raw cell/input value (string, number, null, undefined).
 * @returns {string} Trimmed, space-collapsed, uppercase text ('' when empty).
 *
 * Examples:
 *   normalizeText('  Sara   Ahmed ') → "SARA AHMED"
 *   normalizeText('miraya t4')       → "MIRAYA T4"
 *   normalizeText(null)              → ""
 */
export function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
}
