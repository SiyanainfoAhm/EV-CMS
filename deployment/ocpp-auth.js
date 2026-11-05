import { timingSafeEqual } from 'node:crypto';
// Install this middleware on the gateway BEFORE its remote-start/remote-stop routes.
// OCPP_GATEWAY_API_KEY is shared only between EV-CMS backend and gateway, never mobile.
export function requireEVCmsBackend(req, res, next) {
  const key = process.env.OCPP_GATEWAY_API_KEY || '';
  if (Buffer.byteLength(key) < 32) return res.status(503).json({ error: 'Gateway authentication is not configured' });
  const expected = Buffer.from(`Bearer ${key}`);
  const supplied = Buffer.from(typeof req.headers.authorization === 'string' ? req.headers.authorization : '');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return res.status(401).json({ error: 'Backend authentication required' });
  next();
}
