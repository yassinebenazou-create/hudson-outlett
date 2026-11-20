const { getRedisClient, getDeviceRecord, saveDeviceRecord } = require('../_lib/store');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const redis = getRedisClient();
  if (!redis) {
    return res.status(503).json({ configured: false, error: 'Database is not configured.' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { deviceId, shiftId, action } = body;

  if (!deviceId || !shiftId || !action) {
    return res.status(400).json({ error: 'Missing deviceId, shiftId, or action' });
  }

  const record = await getDeviceRecord(redis, deviceId);
  if (!record) {
    return res.status(404).json({ error: 'Device not found' });
  }

  const confirmations = record.confirmations || {};
  const existing = confirmations[shiftId] || {};
  const snoozedUntil = record.snoozedUntil || {};
  const now = new Date();
  const nowIso = now.toISOString();

  if (action === 'confirm_start') {
    existing.startedAt = existing.startedAt || nowIso;
    confirmations[shiftId] = existing;
  } else if (action === 'confirm_end') {
    if (!existing.startedAt) {
      return res.status(409).json({ error: 'Cannot end a shift that was never started.' });
    }
    existing.finishedAt = existing.finishedAt || nowIso;
    const diffMs = Math.max(0, now.getTime() - new Date(existing.startedAt).getTime());
    existing.actualDurationMinutes = Math.round(diffMs / 60000);
    confirmations[shiftId] = existing;
  } else if (action === 'continue_shift') {
    snoozedUntil[`${shiftId}_end`] = now.getTime() + 15 * 60 * 1000;
  } else {
    return res.status(400).json({ error: 'Unsupported action' });
  }

  await saveDeviceRecord(redis, deviceId, { confirmations, snoozedUntil });
  return res.status(200).json({ ok: true, confirmation: confirmations[shiftId] || null });
};
