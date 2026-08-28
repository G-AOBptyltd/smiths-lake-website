/**
 * contrib-supporters.js — GET /api/contrib-supporters?village=Smiths Lake  (PUBLIC)
 *
 * Powers the public supporters board, the front-page card, and the ticker.
 * PRIVACY IS THE WHOLE POINT OF THIS FILE:
 *   - Only contributors who ticked "Show Publicly" are ever NAMED.
 *   - We NEVER return amounts, contact details, notes, or "Logged by".
 *   - Names are display-safe: the opt-in "Display Name" if given, else the
 *     contributor's first name + last initial ("Jane S.").
 *   - Anonymous aggregate totals count everyone (opted-in or not) — that's the
 *     "community thermometer", and it exposes no individual.
 *   - Tiers are computed server-side from a blended score so the board can rank
 *     playfully WITHOUT publishing exact dollar figures.
 */

const NOTION_VERSION = '2022-06-28';
const CONTRIB_DB_ID = process.env.NOTION_CONTRIB_DB_ID || '6d182a0d4f0c42c2879f13753e355861';

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
    const results = [];
    let cursor = undefined;
    do {
      const res = await fetch(`https://api.notion.com/v1/databases/${CONTRIB_DB_ID}/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: { property: 'Village', rich_text: { equals: village } },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      const data = await res.json();
      results.push(...data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    const totals = {
      monthRaised: 0, monthHours: 0, monthSupporters: 0,
      allRaised: 0, allHours: 0, allSupporters: 0,
    };
    const monthList = [];
    const allList = [];

    for (const page of results) {
      const p = page.properties || {};
      const type = p.Type?.select?.name || '';
      const status = p.Status?.select?.name || '';
      const amount = p.Amount?.number;
      const hours = p.Hours?.number;
      const date = p.Date?.date?.start || '';
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
      if (p['Show Publicly']?.checkbox === true) {
        const score = (Number.isFinite(amount) ? amount : 0) + (Number.isFinite(hours) ? hours : 0) * HOUR_VALUE;
        const supporter = {
          name: safeName(
            (p['Display Name']?.rich_text || []).map((t) => t.plain_text).join(''),
            p.Contributor?.title?.[0]?.plain_text
          ),
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
