const {
  getRedisClient,
  getSentKey,
  getDeviceRecord,
  removeDeviceSubscription,
  listDeviceIds
} = require('../_lib/store');
const { webpush, configureWebPush } = require('../_lib/webpush');

const DAY_MAP = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

/**
 * Returns local wall-clock parts in the target IANA timezone (e.g. Africa/Casablanca).
 */
function getZonedNow(now, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = {};
  for (const p of fmt.formatToParts(now)) {
    parts[p.type] = p.value;
  }
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    dayOfWeek: DAY_MAP[parts.weekday] ?? 0,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutesOfDay: hour * 60 + minute
  };
}

function parseHHMM(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function shiftDateKey(zoned, offsetDays) {
  const dt = new Date(Date.UTC(zoned.year, zoned.month - 1, zoned.day + offsetDays));
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return {
    dateKey: `${y}-${m}-${d}`,
    dayOfWeek: dt.getUTCDay()
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(503).json({
      configured: false,
      error: 'CRON_SECRET is not configured in environment variables.'
    });
  }

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const redis = getRedisClient();
  if (!redis) {
    return res.status(503).json({ configured: false, error: 'Database is not configured.' });
  }

  const pushConfig = configureWebPush();
  if (!pushConfig.configured) {
    return res.status(503).json({ configured: false, error: 'VAPID keys are not configured.' });
  }

  const now = new Date();
  const nowMs = now.getTime();
  const deviceIds = await listDeviceIds(redis);

  let checked = 0;
  let sent = 0;
  let expired = 0;

  for (const deviceId of deviceIds) {
    const record = await getDeviceRecord(redis, deviceId);
    if (!record || !record.subscription || !record.schedule) continue;

    checked++;
    const timeZone = record.timezone || 'Africa/Casablanca';
    const zoned = getZonedNow(now, timeZone);
    const confirmations = record.confirmations || {};
    const snoozedUntil = record.snoozedUntil || {};
    const reminders = record.reminders || {};

    // Evaluate yesterday (overnight), today, and tomorrow (near midnight)
    for (const dayOffset of [-1, 0, 1]) {
      const target = shiftDateKey(zoned, dayOffset);
      const cfg = record.schedule[target.dayOfWeek];
      if (!cfg || !cfg.enabled) continue;

      const startMin = parseHHMM(cfg.start);
      const endMin = parseHHMM(cfg.end);
      const crossesMidnight = endMin <= startMin;
      const absStartMin = dayOffset * 1440 + startMin;
      const absEndMin = dayOffset * 1440 + (crossesMidnight ? endMin + 1440 : endMin);
      const curMin = zoned.minutesOfDay;
      const conf = confirmations[target.dateKey] || {};

      // --- SHIFT START REMINDER (default 5 min before, plus configured offsets) ---
      if (reminders.startEnabled !== false && !conf.startedAt) {
        const snoozeEnd = snoozedUntil[`${target.dateKey}_start`] || 0;
        if (nowMs >= snoozeEnd) {
          const offsets = [30, 15, 5, 0];
          for (const minBefore of offsets) {
            if (reminders.startOffsets && reminders.startOffsets[minBefore] === false) continue;
            const triggerMin = absStartMin - minBefore;
            // Fire within a 10-minute window if not already sent
            if (curMin >= triggerMin && curMin <= triggerMin + 10) {
              const sentKey = getSentKey(deviceId, target.dateKey, 'start', minBefore);
              const acquired = await redis.set(sentKey, nowMs, { nx: true, ex: 172800 });
              if (acquired) {
                const payload = JSON.stringify({
                  type: 'start',
                  deviceId,
                  shiftId: target.dateKey,
                  title:
                    minBefore === 0
                      ? 'Il est temps de commencer votre shift !'
                      : `Votre shift commence dans ${minBefore} min`,
                  body:
                    minBefore > 0
                      ? 'Votre shift est bientôt prévu. Êtes-vous prêt à démarrer ?'
                      : "Il est temps de commencer votre shift ! N'oubliez pas de démarrer votre shift dans le système Hudson.",
                  tag: `hudson-${target.dateKey}-start`,
                  actions: [{ action: 'confirm_start', title: 'Démarrer' }]
                });
                try {
                  await webpush.sendNotification(record.subscription, payload);
                  sent++;
                } catch (err) {
                  if (err && (err.statusCode === 404 || err.statusCode === 410)) {
                    await removeDeviceSubscription(redis, deviceId);
                    expired++;
                  }
                }
                break;
              }
            }
          }
        }
      }

      // --- SHIFT END REMINDER (only if started and not finished) ---
      if (reminders.endEnabled !== false && conf.startedAt && !conf.finishedAt) {
        const snoozeEnd = snoozedUntil[`${target.dateKey}_end`] || 0;
        if (nowMs >= snoozeEnd) {
          const offsets = [15, 5, 0];
          for (const minBefore of offsets) {
            if (reminders.endOffsets && reminders.endOffsets[minBefore] === false) continue;
            const triggerMin = absEndMin - minBefore;
            if (curMin >= triggerMin && curMin <= triggerMin + 10) {
              const sentKey = getSentKey(deviceId, target.dateKey, 'end', minBefore);
              const acquired = await redis.set(sentKey, nowMs, { nx: true, ex: 172800 });
              if (acquired) {
                const payload = JSON.stringify({
                  type: 'end',
                  deviceId,
                  shiftId: target.dateKey,
                  title:
                    minBefore === 0
                      ? 'Votre shift est terminé !'
                      : `Votre shift se termine dans ${minBefore} min`,
                  body:
                    minBefore > 0
                      ? 'Votre shift approche de sa fin. Souhaitez-vous terminer votre shift ?'
                      : "Votre shift est terminé ! N'oubliez pas de terminer votre shift dans le système Hudson.",
                  tag: `hudson-${target.dateKey}-end`,
                  actions: [
                    { action: 'confirm_end', title: 'Terminer mon shift' },
                    { action: 'continue_shift', title: 'Continuer mon shift' }
                  ]
                });
                try {
                  await webpush.sendNotification(record.subscription, payload);
                  sent++;
                } catch (err) {
                  if (err && (err.statusCode === 404 || err.statusCode === 410)) {
                    await removeDeviceSubscription(redis, deviceId);
                    expired++;
                  }
                }
                break;
              }
            }
          }
        }
      }
    }
  }

  return res.status(200).json({ ok: true, checked, sent, expired, timestamp: now.toISOString() });
};
