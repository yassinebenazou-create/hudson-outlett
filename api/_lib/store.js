const { Redis } = require('@upstash/redis');

const DEVICES_SET_KEY = 'hudson:devices';

function getRedisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    return null;
  }
  return new Redis({ url, token });
}

function getDeviceKey(deviceId) {
  return `hudson:device:${deviceId}`;
}

function getSentKey(deviceId, shiftId, type, offset) {
  return `hudson:sent:${deviceId}:${shiftId}:${type}:${offset}`;
}

async function saveDeviceRecord(redis, deviceId, patch) {
  const key = getDeviceKey(deviceId);
  const existing = (await redis.get(key)) || {};
  const merged = {
    ...existing,
    ...patch,
    deviceId,
    updatedAt: new Date().toISOString()
  };
  await redis.set(key, merged);
  await redis.sadd(DEVICES_SET_KEY, deviceId);
  return merged;
}

async function getDeviceRecord(redis, deviceId) {
  return (await redis.get(getDeviceKey(deviceId))) || null;
}

async function removeDeviceSubscription(redis, deviceId) {
  const existing = await getDeviceRecord(redis, deviceId);
  if (!existing) return;
  existing.subscription = null;
  existing.updatedAt = new Date().toISOString();
  await redis.set(getDeviceKey(deviceId), existing);
}

async function listDeviceIds(redis) {
  return (await redis.smembers(DEVICES_SET_KEY)) || [];
}

module.exports = {
  getRedisClient,
  getSentKey,
  saveDeviceRecord,
  getDeviceRecord,
  removeDeviceSubscription,
  listDeviceIds
};
