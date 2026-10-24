/**
 * formatMinutes(mins)
 * Converts a number of minutes into a compact, human-readable duration string
 * such as "45m", "2h", or "2h 30m" (units are omitted when zero).
 *
 * @param {number} mins - Duration in minutes.
 * @returns {string} Formatted duration label.
 *
 * Examples:
 *   formatMinutes(45)  → "45m"
 *   formatMinutes(120) → "2h"
 *   formatMinutes(150) → "2h 30m"
 * Used everywhere a human-readable duration is shown (stat cards, the All
 * Records table, the live form preview, the breakdown bars, and the matrix).
 */
export function formatMinutes(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
