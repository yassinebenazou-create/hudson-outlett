const { getRedisClient, saveDeviceRecord, removeDeviceSubscription } = require('../_lib/store');

module.exports = async function handler(req, res) {
  const redis = getRedisClient();
  if (!redis) {
    return res.status(503).json({
      configured: false,
      error: 'Database (UPSTASH_REDIS_REST_URL / KV_REST_API_URL) is not configured.'
    });
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { deviceId, subscription, schedule, reminders, confirmations, timezone } = body;

    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({ error: 'Missing valid deviceId' });
    }
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: 'Missing valid Web Push subscription' });
    }

    const record = await saveDeviceRecord(redis, deviceId, {
      subscription,
      schedule: schedule || {},
      reminders: reminders || {},
      confirmations: confirmations || {},
      timezone: timezone || 'Africa/Casablanca'
    });

    return res.status(200).json({ ok: true, updatedAt: record.updatedAt });
  }

  if (req.method === 'DELETE') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { deviceId } = body;
    if (!deviceId) {
      return res.status(400).json({ error: 'Missing deviceId' });
    }
    await removeDeviceSubscription(redis, deviceId);
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
};
