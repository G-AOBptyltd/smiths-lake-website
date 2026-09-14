/**
 * contrib-supporters.js — GET /api/contrib-supporters?village=Smiths Lake  (PUBLIC)
 *
 * Powers the public supporters board, the front-page card, and the ticker.
 * PRIVACY IS THE WHOLE POINT OF THIS FILE:
 *   - Only contributors who ticked "Show Publicly" are ever NAMED.
 *   - We NEVER return amounts, contact details, notes, or "Logged by". The
 *     query itself selects only the columns below — `contact` never even
 *     leaves the database for this endpoint.
 *   - Names are display-safe: the opt-in "Display Name" if given, else the
 *     contributor's first name + last initial ("Jane S.").
 *   - Anonymous aggregate totals count everyone (opted-in or not) — that's the
 *     "community thermometer", and it exposes no individual.
 *   - Tiers are computed server-side from a blended score so the board can rank
 *     playfully WITHOUT publishing exact dollar figures.
 *
 * Storage: Supabase (Phase 3 of the PII plan) — see _contrib.js. Archived
 * entries are excluded (the Notion version counted them; a small fix).
 */

import { listContributions } from './_contrib.js';

// The ONLY columns this endpoint reads. Adding `contact` or `note` here would
// be a privacy bug even though neither is returned.
const PUBLIC_SELECT = 'id,type,status,amount,hours,date,show_publicly,display_name,contributor';

// Blended "support score" → playful tier. Hours are valued at $25 for ranking
// only; no dollar figure is ever shown publicly.
const HOUR_VALUE = 25;
function tierFor(score) {
  if (score >= 500) return 'Lake Legend';
  if (score >= 200) return 'Champion';
  if (score >= 50) return 'Mate';
  return 'Supporter';
}

function safeName(displayName, contributor) {
  const dn = (displayName || '').trim();
  if (dn) return dn.slice(0, 60);
  const raw = (contributor || '').trim();
  if (!raw) return 'A generous local';
  const parts = raw.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 40);
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`.slice(0, 60);
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=120', // light cache; board is near-live
  };
}

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'GET only' }) };
  }

  const village = event.queryStringParameters?.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const monthPrefix = new Date().toISOString().slice(0, 7); // YYYY-MM
  const monthLabel = new Date().toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

  try {
    const items = await listContributions(village, { select: PUBLIC_SELECT });

    const totals = {
      monthRaised: 0, monthHours: 0, monthSupporters: 0,
      allRaised: 0, allHours: 0, allSupporters: 0,
    };
    const monthList = [];
    const allList = [];

    for (const it of items) {
      const { type, status, amount, hours } = it;
      const date = it.date || '';
      const isPledge = status === 'Pledged';
      const inMonth = date.startsWith(monthPrefix);

      // Anonymous cash total — actual money only (Money/Payment), received not pledged.
      if (!isPledge && (type === 'Money' || type === 'Payment') && Number.isFinite(amount) && amount > 0) {
        totals.allRaised += amount;
        if (inMonth) totals.monthRaised += amount;
      }
      // Anonymous hours total — received time in kind.
      if (!isPledge && type === 'Time in kind' && Number.isFinite(hours) && hours > 0) {
        totals.allHours += hours;
        if (inMonth) totals.monthHours += hours;
      }

      // Named supporters — opt-in only.
      if (it.showPublicly === true) {
        const score = (Number.isFinite(amount) ? amount : 0) + (Number.isFinite(hours) ? hours : 0) * HOUR_VALUE;
        const supporter = {
          name: safeName(it.displayName, it.contributor === '(no name)' ? '' : it.contributor),
          tier: tierFor(score),
          type,
          score,
        };
        allList.push(supporter);
        totals.allSupporters += 1;
        if (inMonth) { monthList.push(supporter); totals.monthSupporters += 1; }
      }
    }

    const byScore = (a, b) => b.score - a.score || a.name.localeCompare(b.name);
    // Strip the raw score from the public payload — keep ordering, hide the number.
    const clean = (arr) => arr.sort(byScore).map(({ name, tier, type }) => ({ name, tier, type }));

    totals.monthRaised = Math.round(totals.monthRaised);
    totals.allRaised = Math.round(totals.allRaised);
    totals.monthHours = Math.round(totals.monthHours * 100) / 100;
    totals.allHours = Math.round(totals.allHours * 100) / 100;

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        month: monthLabel,
        thisMonth: clean(monthList),
        allTime: clean(allList).slice(0, 100),
        totals,
      }),
    };
  } catch (err) {
    // Fail soft — the board just shows its friendly empty state.
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ month: monthLabel, thisMonth: [], allTime: [], totals: null, warning: err.message }) };
  }
};
