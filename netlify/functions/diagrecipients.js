// TEMP diagnostic — delete after use. Returns role+matrix-derived recipients
// per module for a village (sends nothing). Token-gated so it isn't open.
import { getModuleRecipients } from './_villages.js';
export const handler = async (event, context) => {
  if ((event.queryStringParameters?.k || '') !== 'vf-diag-8842') {
    return { statusCode: 403, body: 'no' };
  }
  const village = event.queryStringParameters?.village || 'Smiths Lake';
  const out = {};
  for (const module of ['members', 'contrib', 'bookings', 'events', 'volunteers']) {
    try { out[module] = await getModuleRecipients({ village, module, context }); }
    catch (e) { out[module] = 'ERR ' + e.message; }
  }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ village, recipients: out }, null, 2) };
};
