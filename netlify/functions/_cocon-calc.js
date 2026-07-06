/**
 * _cocon-calc.js — shared rollup helper for the Co-Contribution module.
 *
 * Files prefixed with "_" are NOT deployed as standalone endpoints by Netlify,
 * but can be imported by the other functions (esbuild inlines them).
 *
 * Single source of truth for every derived total, so the admin dashboard, the
 * print/PDF view and the CSV export never diverge. Mirrors the server-side
 * totals pattern in contrib-list.js.
 *
 * Bucket logic is LOCKED against the real workbook figures
 * ("260430 WIK Co Contribution Schedule & Project Budget PPCA.xlsx"):
 * subtotals $24,410 (PAID) / $10,000 (Cash anticipated) / $90,000 (WIK) /
 * $124,410 (community total). Buckets are driven by Confirmed status first,
 * then Type — which is why a "WIK — Community Labour / Yes — completed" row
 * lands in the PAID subtotal, not the WIK one.
 */

// Confirmed states that count as already delivered (cash paid or work completed).
const PAID_STATES = ['Yes — actual cost PAID', 'Yes — completed'];

function isPaid(confirmed) {
  return PAID_STATES.includes(confirmed);
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * @param {Array} schedule  Table A line items: { party, type, value, confirmed, archived }
 * @param {Array} budget    Table B line items: { amount, archived }
 * @param {Object} project  { grantRequestAmount }
 * @returns fully-computed rollups object (client only formats).
 */
export function computeRollups(schedule = [], budget = [], project = {}) {
  let paid = 0;              // any Type, Confirmed ∈ PAID_STATES  (community)
  let cashAnticipated = 0;   // Type starts "Cash", not paid        (community)
  let wikPledged = 0;        // Type starts "WIK", not completed     (community)
  let externalTotal = 0;     // Party = External (e.g. Council)

  for (const it of schedule) {
    if (it.archived) continue;
    const value = Number(it.value) || 0;
    const type = String(it.type || '');

    if (it.party === 'External') {
      externalTotal += value;
      continue;
    }

    // Community rows.
    if (isPaid(it.confirmed)) {
      paid += value;
    } else if (type.startsWith('Cash')) {
      cashAnticipated += value;
    } else if (type.startsWith('WIK')) {
      wikPledged += value;
    } else {
      // Unclassified community row — count toward anticipated so it isn't lost.
      cashAnticipated += value;
    }
  }

  const totalCommunity = paid + cashAnticipated + wikPledged;
  const grantRequest = Number(project.grantRequestAmount) || 0;
  const totalCoContribution = totalCommunity + externalTotal;
  const totalProjectValue = totalCoContribution + grantRequest;
  const coContributionPct = totalProjectValue > 0
    ? totalCoContribution / totalProjectValue
    : 0;

  const budgetTotal = budget.reduce(
    (sum, b) => sum + (b.archived ? 0 : (Number(b.amount) || 0)), 0);

  return {
    // Table A subtotals
    paid: round2(paid),
    cashAnticipated: round2(cashAnticipated),
    wikPledged: round2(wikPledged),
    totalCommunity: round2(totalCommunity),
    // Funding summary
    externalTotal: round2(externalTotal),
    grantRequest: round2(grantRequest),
    totalCoContribution: round2(totalCoContribution),
    coContributionPct: Math.round(coContributionPct * 1000) / 1000, // 0.174
    totalProjectValue: round2(totalProjectValue),
    // Table B
    budgetTotal: round2(budgetTotal),
    estimatedTotalProjectCost: round2(budgetTotal),
  };
}
