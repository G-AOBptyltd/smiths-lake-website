/**
 * _entitlements.js — Village1st plan entitlements (server-side module gate).
 *
 * The /admin/ portal already HIDES tiles a village's plan doesn't include
 * (village-list.js + portal JS). This adds the matching ACCESS gate so a priced
 * module's endpoints actually REFUSE when the plan doesn't cover it — turning
 * the pricing tiers from "presented" into "enforced". Mirrors the site's
 * src/config/plans.js (village1st-website): same tier ids + module ids.
 *
 * Plans (Village1st tiers, cheapest → dearest): starter · growth · complete.
 * Legacy Package values (foundation/interactive/complete) normalise onto these.
 *
 * FAIL-OPEN by design: if the plan can't be read (Notion error) or is absent,
 * default to the highest plan ('complete') so existing villages — and the live
 * flagship — are never blocked. Enforcement only bites once a plan is set in
 * the registry. Call requireEntitlement() AFTER requireRole() in an endpoint.
 */

const NOTION_VERSION = '2022-06-28';
const VILLAGES_DB_ID = process.env.NOTION_VF_VILLAGES_DB_ID || '2c6272ccd9174103a077087c5de250d0';

// Ordered plans. A plan includes every module of the plans at/below its index.
export const PLAN_ORDER = ['starter', 'growth', 'complete'];
const LEGACY_PLAN = { foundation: 'starter', interactive: 'growth', complete: 'complete' };

// Lowest plan that includes each PRICED module. Modules NOT listed here are in
// every plan (the Starter base: website/pages, news, services, members, profile,
// grants, admin, publish, playbook) and are never gated.
export const MODULE_MIN_PLAN = {
  // Growth tier
  surveys: 'growth', volunteers: 'growth', events: 'growth', bookings: 'growth', ads: 'growth',
  // Complete tier
  projects: 'complete', contrib: 'complete', cocon: 'complete',
};

export function normalisePlan(name) {
  const n = String(name || '').toLowerCase().trim();
  if (PLAN_ORDER.includes(n)) return n;
  if (LEGACY_PLAN[n]) return LEGACY_PLAN[n];
  return 'complete'; // fail-open default (absent / unknown)
}

// Pure predicate — does `plan` include `module`? (testable without Notion)
export function planIncludes(plan, module) {
  const min = MODULE_MIN_PLAN[module];
  if (!min) return true; // base module, in every plan
  return PLAN_ORDER.indexOf(normalisePlan(plan)) >= PLAN_ORDER.indexOf(min);
}

// Reads the village's Package from the registry. Fail-open to 'complete'.
async function getVillagePlan(village) {
  if (!process.env.NOTION_API_KEY) return 'complete';
  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${VILLAGES_DB_ID}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filter: { property: 'Village Name', title: { equals: village } }, page_size: 1 }),
    });
    if (!res.ok) return 'complete';
    const p = ((await res.json()).results || [])[0];
    return normalisePlan(p?.properties?.['Package']?.select?.name);
  } catch (_) {
    return 'complete'; // fail-open — never block on a registry hiccup
  }
}

/**
 * requireEntitlement(village, module) → { ok:true } | { ok:false, status, error }
 * Put it right after the endpoint's requireRole() check:
 *   const ent = await requireEntitlement(village, 'cocon');
 *   if (!ent.ok) return jsonResp(ent.status, { error: ent.error });
 */
export async function requireEntitlement(village, module) {
  if (!MODULE_MIN_PLAN[module]) return { ok: true }; // base module — always allowed
  const plan = await getVillagePlan(village);
  if (planIncludes(plan, module)) return { ok: true };
  const needed = MODULE_MIN_PLAN[module];
  return {
    ok: false,
    status: 403,
    error: `The "${module}" module isn't included in this village's ${plan} plan — it needs the ${needed} plan. Upgrade at village1st.com.au/plan.`,
  };
}
