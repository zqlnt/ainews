/**
 * Time utilities for news age formatting
 */

/**
 * Returns current time as ISO 8601 string
 * @returns {string} ISO 8601 timestamp
 */
export function getCurrentTimeISO() {
  return new Date().toISOString();
}

/**
 * Converts an ISO timestamp to a compact age string
 * @param {string} isoTimestamp - ISO 8601 timestamp
 * @returns {string} Compact age string: "5m", "2h", "3d"
 */
export function getAgeString(isoTimestamp) {
  const now = Date.now();
  const timestamp = new Date(isoTimestamp).getTime();
  
  if (isNaN(timestamp)) {
    return '0m';
  }
  
  const diffMs = now - timestamp;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffDays > 0) {
    return `${diffDays}d`;
  } else if (diffHours > 0) {
    return `${diffHours}h`;
  } else if (diffMinutes > 0) {
    return `${diffMinutes}m`;
  } else {
    return '0m';
  }
}
