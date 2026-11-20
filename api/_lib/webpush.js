const webpush = require('web-push');

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:support@hudson-shift.local';

  if (!publicKey || !privateKey) {
    return { configured: false, publicKey: null };
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  return { configured: true, publicKey };
}

module.exports = {
  webpush,
  configureWebPush
};
