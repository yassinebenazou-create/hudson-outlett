module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return res.status(503).json({
      configured: false,
      error: 'VAPID_PUBLIC_KEY is not configured in Vercel environment variables.'
    });
  }

  return res.status(200).json({ configured: true, publicKey });
};
