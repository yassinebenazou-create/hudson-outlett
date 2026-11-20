const { getRedisClient, saveDeviceRecord } = require('../_lib/store');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const redis = getRedisClient();
  if (!redis) {
    return res.status(503).json({
      configured: false,
      error: 'Database is not configured.'
    });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { deviceId, schedule, reminders, confirmations, snoozedUntil, timezone } = body;

  if (!deviceId || typeof deviceId !== 'string') {
    return res.status(400).json({ error: 'Missing valid deviceId' });
  }

  const patch = {
    timezone: timezone || 'Africa/Casablanca'
  };
  if (schedule) patch.schedule = schedule;
  if (reminders) patch.reminders = reminders;
  if (confirmations) patch.confirmations = confirmations;
  if (snoozedUntil) patch.snoozedUntil = snoozedUntil;

  const record = await saveDeviceRecord(redis, deviceId, patch);
  return res.status(200).json({ ok: true, updatedAt: record.updatedAt });
};
