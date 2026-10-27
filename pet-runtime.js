function isQuietHours(date = new Date()) {
  const hour = date.getHours();
  return hour >= 1 && hour < 8;
}

function isFailureStatus(status) {
  return ['blocked', 'failed', 'error'].includes(String(status || '').toLowerCase());
}

function shouldAnnounce({ date = new Date(), taskResult = false, userInitiated = false } = {}) {
  return !isQuietHours(date) || taskResult || userInitiated;
}

module.exports = { isQuietHours, isFailureStatus, shouldAnnounce };
