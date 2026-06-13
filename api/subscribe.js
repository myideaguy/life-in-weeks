// Vercel serverless function: receive Reclaim Guide opt-in,
// create a contact on Membership.io (api.member.dev).
//
// Env vars required (set in Vercel → Settings → Environment Variables):
//   MEMBERSHIP_TEAM_ID  = team UUID
//   MEMBERSHIP_API_KEY  = mio_sk_live_… server-to-server key
//
// Verified contact-create schema (2026-06-09):
//   POST /api/v1/teams/{team_id}/contacts/
//   { data: { type: "team_contacts", attributes: { email, first_name?, last_name?, source? } } }

export default async function handler(req, res) {
  // CORS / simple safety
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse body — Vercel auto-parses JSON when Content-Type is application/json,
  // but defend against alternates.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  const { email, country, sex, birthday, le, health, habits, sharedUrl } = body;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const TEAM_ID = process.env.MEMBERSHIP_TEAM_ID;
  const API_KEY = process.env.MEMBERSHIP_API_KEY;
  if (!TEAM_ID || !API_KEY) {
    console.error('[subscribe] missing env vars MEMBERSHIP_TEAM_ID / MEMBERSHIP_API_KEY');
    return res.status(500).json({ error: 'Server not configured' });
  }

  // Log the full state — useful while we don't yet store it on the contact.
  console.log('[Reclaim Guide signup]', JSON.stringify({
    email, country, sex, birthday, le, health, habits, sharedUrl,
    receivedAt: new Date().toISOString(),
  }));

  const payload = {
    data: {
      type: 'team_contacts',
      attributes: {
        email,
        source: 'life-in-weeks',
      },
    },
  };

  try {
    const resp = await fetch(
      `https://api.member.dev/api/v1/teams/${TEAM_ID}/contacts/`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/vnd.api+json',
          Accept: 'application/vnd.api+json',
        },
        body: JSON.stringify(payload),
        redirect: 'follow',
      }
    );

    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }

    // Treat duplicate-email as success (they're already on the list)
    if (!resp.ok) {
      const errs = Array.isArray(data?.errors) ? data.errors : [];
      const dup = resp.status === 409
        || errs.some(e => /(duplicate|exists|already)/i.test(String(e?.detail || e?.title || '')));
      if (dup) {
        return res.status(200).json({ success: true, duplicate: true });
      }
      console.error('[subscribe] member.dev error', resp.status, data);
      return res.status(502).json({ error: 'Upstream signup failed', status: resp.status });
    }

    const id = data?.data?.id || null;
    return res.status(200).json({ success: true, contactId: id });
  } catch (err) {
    console.error('[subscribe] exception', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
