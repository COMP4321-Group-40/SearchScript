/**
 * Utility helper functions
 */

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Format date for display
 * @param {string|Date} date
 * @returns {string}
 */
export function formatDate(date) {
  if (!date) return 'N/A';
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toISOString().replace('T', ' ').slice(0, 19);
  } catch (e) {
    return 'N/A';
  }
}

export default {
  sleep,
  formatDate
};
