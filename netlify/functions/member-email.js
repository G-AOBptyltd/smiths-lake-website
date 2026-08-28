/**
 * member-email.js — POST /api/member-email
 *
 * Sends a templated membership email to ONE member via the VillageFirst Resend
 * account, then stamps "Last Email" on their register row. Body:
 *   { village?, pageId, template }   template ∈ welcome | renewal
 *
 * Templates:
 *   welcome — "your membership is approved" (+ how to pay if not yet Paid)
 *   renewal — "time to renew for <next year>"
 *
 * Auth: village admin / super-admin. Uses the same env vars as the other VF
 * mailers: VF_RESEND_API_KEY (required), VF_PLEDGE_FROM (sender), and
 * VF_PLEDGE_NOTIFY_TO (first address becomes the reply-to so members answer
 * the committee, not a noreply box). Optional extras:
 *   VF_MEMBER_ORG_NAME         — association name for the sign-off
 *                                 (default "Pacific Palms Community Association (PPCA)")
 *   VF_MEMBER_PAY_INSTRUCTIONS — plain-text payment instructions (e.g. bank
 *                                 details) shown to unpaid members
 */

import { requireRole } from './_auth.js';
import { notionHeaders, ensureMemberSchema, getMemberPage, MEMBERSHIP_FEES, nextMembershipYear } from './_members.js';

function corsHeaders() {
  return { 'Content-Type': 'application/json' };
}

function esc(s) {
  return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function wrap(title, bodyHtml, orgName) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;font-size:15px;line-height:1.65;max-width:560px;">
    <h2 style="color:#15795f;">${esc(title)}</h2>
    ${bodyHtml}
    <p style="margin-top:24px;">Warm regards,<br><b>${esc(orgName)}</b></p>
    <p style="font-size:12px;color:#9ca3af;margin-top:18px;">Sent via VillageFirst on behalf of ${esc(orgName)}. Just reply to this email if anything looks wrong.</p>
  </div>`;
}

function payBlock(member, payInstructions) {
  const fee = member.fee ?? MEMBERSHIP_FEES[member.membershipType] ?? '';
  const feeLine = fee !== '' ? `$${fee}` : 'your membership fee';
  const how = payInstructions
    ? `<p style="background:#f0fdf6;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px;">${esc(payInstructions).replace(/\n/g, '<br>')}</p>`
    : `<p>You nominated <b>${esc(member.paymentMethod || 'a payment method')}</b> on your application — the committee will be in touch if anything more is needed.</p>`;
  return `<p>To finalise your membership, the fee is <b>${esc(String(feeLine))}</b> (${esc(member.membershipType || 'membership')}, ${esc(member.year || 'this year')}).</p>${how}`;
}

function buildEmail(template, member, orgName, payInstructions) {
  const first = member.firstName || member.name;

  if (template === 'welcome') {
    const paid = member.status === 'Paid';
    return {
      subject: `Welcome to ${orgName} — your membership is approved`,
      html: wrap(`Welcome, ${first}!`, `
        <p>Great news — your <b>${esc(member.membershipType || '')}</b> membership application for <b>${esc(member.year || 'this year')}</b> has been approved. Thank you for being part of the community.</p>
        ${paid
          ? '<p>Your membership fee has been received — you’re all set. We’ll keep you posted on meetings, projects and community news.</p>'
          : payBlock(member, payInstructions)}
      `, orgName),
    };
  }

  // renewal
  const renewYear = member.year ? nextMembershipYear(member.year) : 'the new membership year';
  const fee = member.fee ?? MEMBERSHIP_FEES[member.membershipType] ?? '';
  return {
    subject: `Time to renew your ${orgName} membership (${renewYear})`,
    html: wrap(`Time to renew, ${first}`, `
      <p>The membership year runs 1 July – 30 June, and renewals for <b>${esc(String(renewYear))}</b> are now open. Your <b>${esc(member.membershipType || '')}</b> membership is ${fee !== '' ? `<b>$${esc(String(fee))}</b>` : 'unchanged'} for the year.</p>
      ${payInstructions
        ? `<p style="background:#f0fdf6;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px;">${esc(payInstructions).replace(/\n/g, '<br>')}</p>`
        : '<p>Reply to this email or catch a committee member at the next meeting to arrange payment.</p>'}
      <p>Thank you for sticking with us — memberships are what keep the association's voice strong.</p>
    `, orgName),
  };
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'POST only' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const village = body.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin'] });
  if (!auth.ok) {
    return { statusCode: auth.status, headers: corsHeaders(), body: JSON.stringify({ error: auth.error }) };
  }

  const { pageId, template } = body;
  if (!pageId || !['welcome', 'renewal'].includes(template)) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'pageId and a valid template are required' }) };
  }

  const key = process.env.VF_RESEND_API_KEY;
  if (!key) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Email is not configured yet (VF_RESEND_API_KEY missing)' }) };
  }

  try {
    const target = await getMemberPage(pageId);
    if (!target.ok) {
      return { statusCode: target.status, headers: corsHeaders(), body: JSON.stringify({ error: target.error }) };
    }
    const member = target.member;
    if (!member.email) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'This member has no email address on file' }) };
    }

    const orgName = process.env.VF_MEMBER_ORG_NAME || 'Pacific Palms Community Association (PPCA)';
    const payInstructions = process.env.VF_MEMBER_PAY_INSTRUCTIONS || '';
    const from = process.env.VF_PLEDGE_FROM || 'VillageFirst <noreply@villagefirst.org.au>';
    const replyTo = (process.env.VF_PLEDGE_NOTIFY_TO || '').split(',').map((s) => s.trim()).filter(Boolean)[0];

    const { subject, html } = buildEmail(template, member, orgName, payInstructions);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [member.email],
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Resend responded ${res.status}: ${detail.slice(0, 200)}`);
    }

    // Stamp the register so the committee can see what was last sent and when.
    await ensureMemberSchema();
    const stampText = `${template} sent ${new Date().toISOString().slice(0, 10)} by ${auth.user.email || 'admin'}`;
    await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: notionHeaders(),
      body: JSON.stringify({ properties: { 'Last Email': { rich_text: [{ text: { content: stampText.slice(0, 200) } }] } } }),
    }).catch(() => { /* the email went — a failed stamp must not report failure */ });

    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true, sent: template, to: member.email }) };
  } catch (err) {
    return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};
