/**
 * VillageFirst Survey Engine v1.0
 * Generic survey renderer — reads config from /api/survey-config and renders
 * the correct template. Handles submission to /api/survey-submit.
 *
 * Templates supported:
 *   - conjoint-design-options  (design choice surveys — Blueys Beach model)
 *   - priority-ranking         (MaxDiff best/worst for project prioritisation)
 *   - annual-satisfaction      (recurring community pulse check)
 *
 * Usage: Include this script in a survey shell page.
 * The shell page must have a <div id="survey-root"></div> and pass the slug:
 *   <script>window.VF_SURVEY_SLUG = 'rec-reserve-priorities';</script>
 *   <script src="/js/survey-engine.js"></script>
 */

(function () {
  'use strict';

  const API_BASE = '/api';
  let surveyConfig = null;
  let surveyStatus = null;
  let responses = {};
  let currentPart = 0;
  let maxDiffState = { round: 0, totalRounds: 4, best: null, worst: null, allSelections: [] };

  // ─── Bootstrap ─────────────────────────────────────────────────────────────

  async function init() {
    const slug = getSlug();
    if (!slug) {
      renderError('No survey specified.');
      return;
    }

    renderLoading();

    try {
      const res = await fetch(`${API_BASE}/survey-config?slug=${encodeURIComponent(slug)}`);
      const data = await res.json();

      if (!res.ok || data.status === 'not-found') {
        renderNotFound();
        return;
      }

      surveyConfig = data.survey;
      surveyStatus = data.status;

      if (surveyStatus === 'closed') {
        renderClosed();
        return;
      }

      if (surveyStatus === 'scheduled') {
        renderScheduled();
        return;
      }

      renderSurvey();
    } catch (err) {
      console.error('Survey engine error:', err);
      renderError('Could not load the survey. Please try again.');
    }
  }

  function getSlug() {
    if (window.VF_SURVEY_SLUG) return window.VF_SURVEY_SLUG;
    const params = new URLSearchParams(window.location.search);
    return params.get('slug') || '';
  }

  function root() {
    return document.getElementById('survey-root');
  }

  // ─── State screens ─────────────────────────────────────────────────────────

  function renderLoading() {
    root().innerHTML = `
      <div class="vf-state vf-loading">
        <div class="vf-spinner"></div>
        <p>Loading survey…</p>
      </div>`;
  }

  function renderNotFound() {
    root().innerHTML = `
      <div class="vf-state vf-closed">
        <div class="vf-state-icon">🔍</div>
        <h2>Survey not found</h2>
        <p>This survey link may have changed or the survey has been removed.</p>
        <a href="/" class="vf-btn">Return to website</a>
      </div>`;
  }

  function renderClosed() {
    root().innerHTML = `
      <div class="vf-state vf-closed">
        <div class="vf-state-icon">✅</div>
        <h2>This survey is now closed</h2>
        <p>Thank you to everyone who responded. The survey has closed and results are being reviewed.</p>
        ${surveyConfig?.resultsUrl ? `<a href="${surveyConfig.resultsUrl}" class="vf-btn">View the results</a>` : ''}
        <a href="/" class="vf-btn vf-btn-secondary">Return to website</a>
      </div>`;
  }

  function renderScheduled() {
    const openDate = surveyConfig?.openDate ? new Date(surveyConfig.openDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : 'soon';
    root().innerHTML = `
      <div class="vf-state vf-scheduled">
        <div class="vf-state-icon">📅</div>
        <h2>Survey opens ${openDate}</h2>
        <p>This survey is not yet open. Check back on ${openDate} to have your say.</p>
        <a href="/" class="vf-btn vf-btn-secondary">Return to website</a>
      </div>`;
  }

  function renderError(msg) {
    root().innerHTML = `
      <div class="vf-state vf-error">
        <div class="vf-state-icon">⚠️</div>
        <h2>Something went wrong</h2>
        <p>${msg}</p>
        <button onclick="location.reload()" class="vf-btn">Try again</button>
      </div>`;
  }

  function renderThankYou() {
    // For 'respondent-after-completion' visibility, link results with a completion flag
    // so the person who just submitted can see them even though they're not public.
    let resultsHref = surveyConfig.resultsUrl || '';
    if (resultsHref && surveyConfig.resultsVisibility === 'respondent-after-completion') {
      resultsHref += (resultsHref.includes('?') ? '&' : '?') + 'completed=1';
    }
    const showResults = resultsHref && (surveyConfig.resultsVisibility === 'public' || surveyConfig.resultsVisibility === 'respondent-after-completion');
    root().innerHTML = `
      <div class="vf-state vf-thankyou">
        <div class="vf-state-icon">🙏</div>
        <h2>Thank you for your response!</h2>
        <p>Your submission has been recorded. The ${surveyConfig.village} PPCA committee will review all responses.</p>
        ${showResults ? `<a href="${resultsHref}" class="vf-btn">View results</a>` : ''}
        <a href="/" class="vf-btn vf-btn-secondary">Return to website</a>
      </div>`;
  }

  // ─── Main survey render ────────────────────────────────────────────────────

  function renderSurvey() {
    const t = surveyConfig.template;
    if (t === 'conjoint-design-options') renderConjoint();
    else if (t === 'priority-ranking') renderMaxDiff();
    else if (t === 'annual-satisfaction') renderSatisfaction();
    else if (t === 'likert-agreement') renderRatingTemplate({ prefix: 'l', items: surveyConfig.config.statements || surveyConfig.config.items || [], scaleNote: '1 = Strongly disagree, 5 = Strongly agree', heading: 'Your views', introDefault: 'Tell us how much you agree with each statement.' });
    else if (t === 'star-rating') renderRatingTemplate({ prefix: 'r', items: surveyConfig.config.items || surveyConfig.config.serviceRatings || [], scaleNote: '1 = Poor, 5 = Excellent', heading: 'Your ratings', introDefault: 'Please rate each of the following.' });
    else if (t === 'quick-poll') renderQuickPoll();
    else if (t === 'open-feedback') renderOpenFeedback();
    else if (t === 'multi-section') renderMultiSection();
    else if (t === 'ranked-choice') renderRankedChoice();
    else if (t === 'budget-allocation') renderBudgetAllocation();
    else if (t === 'importance-performance') renderIPA();
    else if (t === 'demographic') renderDemographic();
    else renderError(`Unknown template: ${t}`);
  }

  function renderIntroCard(introDefault) {
    const cfg = surveyConfig.config;
    return `
      <div class="vf-intro-card">
        <p>${cfg.description || cfg.purposeStatement || introDefault}</p>
        <div class="vf-field" style="margin-top:12px;">
          <div class="vf-field-label">I am a:</div>
          <div class="vf-pills" id="respondent-pills">
            ${surveyConfig.respondentTypes.map(t => `<button class="vf-pill" data-value="${t}">${t}</button>`).join('')}
          </div>
        </div>
      </div>`;
  }

  // ─── RANKED-CHOICE (order a short list, 1 = highest) ─────────────────────────
  function renderRankedChoice() {
    const cfg = surveyConfig.config;
    const items = (cfg.items || []).map(x => (x && x.label) ? x.label : x);
    const N = items.length;
    root().innerHTML = `
      <div class="vf-survey">${renderSurveyHeader()}
        ${renderIntroCard('Rank these in order of priority (1 = highest).')}
        <div class="vf-part-label" style="margin-top:20px;">Rank these — 1 = highest priority</div>
        <div class="vf-rating-list">
          ${items.map((s, i) => `<div class="vf-rating-row"><span class="vf-rating-label">${s}</span>
            <select class="vf-textarea" style="max-width:90px;padding:6px;" id="rk${i + 1}">
              ${['', ...Array.from({ length: N }, (_, k) => k + 1)].map(v => `<option value="${v}" ${responses['rk' + (i + 1)] == v ? 'selected' : ''}>${v || '—'}</option>`).join('')}
            </select></div>`).join('')}
        </div>
        <div class="vf-nav"><span></span><button class="vf-btn" id="submit-btn">Submit →</button></div>
      </div>`;
    attachPillHandlers('respondent-pills', 'respondentType', responses);
    document.getElementById('submit-btn').onclick = async () => {
      if (!responses.respondentType) { alert('Please select who you are.'); return; }
      for (let i = 0; i < N; i++) { const v = document.getElementById('rk' + (i + 1)).value; if (!v) { alert('Please rank every item.'); return; } responses['rk' + (i + 1)] = v; }
      await submitSurvey();
    };
  }

  // ─── BUDGET-ALLOCATION (distribute N points) ─────────────────────────────────
  function renderBudgetAllocation() {
    const cfg = surveyConfig.config;
    const items = (cfg.items || []).map(x => (x && x.label) ? x.label : x);
    const total = cfg.total || 100;
    root().innerHTML = `
      <div class="vf-survey">${renderSurveyHeader()}
        ${renderIntroCard(`Distribute exactly ${total} points across the options below.`)}
        <div class="vf-part-label" style="margin-top:20px;">Allocate ${total} points</div>
        <div class="vf-rating-list">
          ${items.map((s, i) => `<div class="vf-rating-row"><span class="vf-rating-label">${s}</span>
            <input type="number" min="0" max="${total}" class="vf-textarea bg-alloc" style="max-width:90px;padding:6px;" id="al${i + 1}" value="${responses['al' + (i + 1)] || 0}"></div>`).join('')}
        </div>
        <div id="budget-total" style="font-weight:700;margin-top:8px;">Total: 0 / ${total}</div>
        <div class="vf-nav"><span></span><button class="vf-btn" id="submit-btn">Submit →</button></div>
      </div>`;
    attachPillHandlers('respondent-pills', 'respondentType', responses);
    const recalc = () => {
      let sum = 0; items.forEach((_, i) => sum += Number(document.getElementById('al' + (i + 1)).value) || 0);
      const el = document.getElementById('budget-total');
      el.textContent = `Total: ${sum} / ${total}`;
      el.style.color = sum === total ? '#059669' : '#dc2626';
      return sum;
    };
    document.querySelectorAll('.bg-alloc').forEach(inp => inp.addEventListener('input', recalc));
    recalc();
    document.getElementById('submit-btn').onclick = async () => {
      if (!responses.respondentType) { alert('Please select who you are.'); return; }
      let sum = 0; items.forEach((_, i) => { const v = Number(document.getElementById('al' + (i + 1)).value) || 0; responses['al' + (i + 1)] = v; sum += v; });
      if (sum !== total) { alert(`Please allocate exactly ${total} points (currently ${sum}).`); return; }
      await submitSurvey();
    };
  }

  // ─── IMPORTANCE vs PERFORMANCE (rate each on two scales) ─────────────────────
  function renderIPA() {
    const cfg = surveyConfig.config;
    const items = (cfg.items || []).map(x => (x && x.label) ? x.label : x);
    root().innerHTML = `
      <div class="vf-survey">${renderSurveyHeader()}
        ${renderIntroCard('For each item, rate how important it is and how well it performs today (1–5).')}
        <div class="vf-part-label" style="margin-top:20px;">Importance &amp; performance (1–5)</div>
        ${items.map((s, i) => `
          <div style="margin-bottom:14px;">
            <div style="font-size:13px;font-weight:600;margin-bottom:4px;">${s}</div>
            <div class="vf-rating-list">
              ${renderRatingRow(`imp${i + 1}`, 'Importance', responses[`imp${i + 1}`])}
              ${renderRatingRow(`perf${i + 1}`, 'Performance now', responses[`perf${i + 1}`])}
            </div>
          </div>`).join('')}
        <div class="vf-nav"><span></span><button class="vf-btn" id="submit-btn">Submit →</button></div>
      </div>`;
    attachPillHandlers('respondent-pills', 'respondentType', responses);
    attachRatingHandlers(responses);
    document.getElementById('submit-btn').onclick = async () => {
      if (!responses.respondentType) { alert('Please select who you are.'); return; }
      if (items.some((_, i) => !responses[`imp${i + 1}`] || !responses[`perf${i + 1}`])) { alert('Please rate importance and performance for every item.'); return; }
      await submitSurvey();
    };
  }

  // ─── DEMOGRAPHIC (profile questions: choice or text) ─────────────────────────
  function renderDemographic() {
    const cfg = surveyConfig.config;
    const fields = (cfg.fields || []).map(f => (typeof f === 'string') ? { label: f, options: [] } : f);
    root().innerHTML = `
      <div class="vf-survey">${renderSurveyHeader()}
        ${renderIntroCard('A few quick questions about you. This helps us understand who responded.')}
        ${fields.map((f, i) => {
          const opts = f.options || [];
          if (opts.length) {
            return `<div class="vf-field" style="margin-top:16px;"><div class="vf-field-label">${f.label}</div>
              <div class="vf-pills" id="demo-${i + 1}">${opts.map(o => `<button class="vf-pill" data-value="${(o && o.label) ? o.label : o}">${(o && o.label) ? o.label : o}</button>`).join('')}</div></div>`;
          }
          return `<div class="vf-field" style="margin-top:16px;"><label class="vf-field-label">${f.label}</label>
            <input class="vf-textarea" id="demo-${i + 1}-text" placeholder="Your answer…" value="${responses[`d${i + 1}`] || ''}"></div>`;
        }).join('')}
        <div class="vf-nav"><span></span><button class="vf-btn" id="submit-btn">Submit →</button></div>
      </div>`;
    attachPillHandlers('respondent-pills', 'respondentType', responses);
    fields.forEach((f, i) => { if ((f.options || []).length) attachPillHandlers(`demo-${i + 1}`, `d${i + 1}`, responses); });
    document.getElementById('submit-btn').onclick = async () => {
      if (!responses.respondentType) { alert('Please select who you are.'); return; }
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        if ((f.options || []).length) { if (!responses[`d${i + 1}`]) { alert(`Please answer: ${f.label}`); return; } }
        else { responses[`d${i + 1}`] = document.getElementById(`demo-${i + 1}-text`)?.value || ''; }
      }
      await submitSurvey();
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEMPLATE: CONJOINT-DESIGN-OPTIONS
  // Parts: A (shared feature ratings) → B (importance of differences) →
  //        C (conjoint tasks) → D (priority allocation) → E (overall + text)
  // ═══════════════════════════════════════════════════════════════════════════

  function renderConjoint() {
    const cfg = surveyConfig.config;
    const parts = buildConjointParts(cfg);

    function showPart(idx) {
      currentPart = idx;
      const part = parts[idx];
      const isLast = idx === parts.length - 1;
      const progress = Math.round(((idx) / parts.length) * 100);

      root().innerHTML = `
        <div class="vf-survey">
          ${renderSurveyHeader()}
          <div class="vf-progress-bar"><div class="vf-progress-fill" style="width:${progress}%"></div></div>
          <div class="vf-part-label">${part.label || `Part ${part.id}`}</div>
          <div class="vf-part-content" id="part-content"></div>
          <div class="vf-nav">
            ${idx > 0 ? `<button class="vf-btn vf-btn-secondary" id="prev-btn">← Back</button>` : '<span></span>'}
            <button class="vf-btn" id="next-btn">${isLast ? 'Submit →' : 'Next →'}</button>
          </div>
        </div>`;

      part.render(document.getElementById('part-content'), responses);

      if (idx > 0) {
        document.getElementById('prev-btn').onclick = () => showPart(idx - 1);
      }
      document.getElementById('next-btn').onclick = async () => {
        const valid = part.collect(responses);
        if (!valid) return;
        if (isLast) {
          await submitSurvey();
        } else {
          showPart(idx + 1);
        }
      };
    }

    showPart(0);
  }

  function buildConjointParts(cfg) {
    const parts = [];

    // Part 0 — Who are you? (respondent type)
    parts.push({
      id: 'intro',
      label: 'About this survey',
      render: (el) => {
        el.innerHTML = `
          <div class="vf-intro-card">
            <p>${cfg.description || 'Your feedback will inform the PPCA committee submission.'}</p>
            ${cfg.attributeTable ? renderAttributeTable(cfg) : ''}
            <div class="vf-field">
              <div class="vf-field-label">I am a:</div>
              <div class="vf-pills" id="respondent-pills">
                ${surveyConfig.respondentTypes.map(t => `<button class="vf-pill" data-value="${t}">${t}</button>`).join('')}
              </div>
            </div>
          </div>`;
        attachPillHandlers('respondent-pills', 'respondentType', responses);
        if (cfg.planRequired) {
          el.insertAdjacentHTML('beforeend', `
            <div class="vf-field" style="margin-top:12px;">
              <label class="vf-checkbox-label">
                <input type="checkbox" id="plan-reviewed" ${responses.planReviewed ? 'checked' : ''}>
                I have reviewed the design plans
              </label>
            </div>`);
        }
      },
      collect: (r) => {
        if (!r.respondentType) { alert('Please select who you are.'); return false; }
        if (cfg.planRequired) r.planReviewed = document.getElementById('plan-reviewed')?.checked ? 'Yes' : 'No';
        return true;
      },
    });

    // Part A — Shared features (rate 1–5)
    if (cfg.sharedFeatures?.length) {
      parts.push({
        id: 'A',
        label: `Part A — Shared Features (${cfg.sharedFeatures.length} items)`,
        render: (el) => {
          el.innerHTML = `
            <p class="vf-part-desc">${cfg.partADescription || 'Rate your support for each shared feature (1 = Strongly Disagree, 5 = Strongly Agree).'}</p>
            <div class="vf-rating-list">
              ${cfg.sharedFeatures.map((f, i) => renderRatingRow(`a${i + 1}`, f, responses[`a${i + 1}`])).join('')}
            </div>`;
          attachRatingHandlers(responses);
        },
        collect: (r) => {
          const missing = cfg.sharedFeatures.some((_, i) => !r[`a${i + 1}`]);
          if (missing) { alert('Please rate all features before continuing.'); return false; }
          return true;
        },
      });
    }

    // Part B — Key differences (rate importance 1–5)
    if (cfg.attributes?.length) {
      parts.push({
        id: 'B',
        label: 'Part B — Key Differences',
        render: (el) => {
          el.innerHTML = `
            <p class="vf-part-desc">${cfg.partBDescription || 'Rate how important each difference is to you (1 = Not Important, 5 = Critically Important).'}</p>
            <div class="vf-rating-list">
              ${cfg.attributes.map((a, i) => renderRatingRow(`b${i + 1}`, a.label, responses[`b${i + 1}`])).join('')}
            </div>`;
          attachRatingHandlers(responses);
        },
        collect: (r) => {
          const missing = cfg.attributes.some((_, i) => !r[`b${i + 1}`]);
          if (missing) { alert('Please rate all items before continuing.'); return false; }
          return true;
        },
      });
    }

    // Part C — Conjoint tasks (X vs Y package choices)
    if (cfg.conjointTasks?.length) {
      parts.push({
        id: 'C',
        label: 'Part C — Conjoint Analysis',
        render: (el) => {
          el.innerHTML = `
            <p class="vf-part-desc">${cfg.partCDescription || 'For each scenario, choose which package you prefer.'}</p>
            ${cfg.conjointTasks.map((task, i) => `
              <div class="vf-conjoint-task">
                <div class="vf-conjoint-label">${task.label || `Scenario ${i + 1}`}</div>
                <div class="vf-conjoint-choices">
                  <button class="vf-choice-btn ${responses[`c${i+1}`]==='x'?'selected':''}" data-field="c${i+1}" data-value="x">
                    <strong>${task.option1Label || 'Option X'}</strong>
                    ${(task.option1Features||[]).map(f=>`<span class="vf-feature-tag">${f}</span>`).join('')}
                  </button>
                  <button class="vf-choice-btn ${responses[`c${i+1}`]==='y'?'selected':''}" data-field="c${i+1}" data-value="y">
                    <strong>${task.option2Label || 'Option Y'}</strong>
                    ${(task.option2Features||[]).map(f=>`<span class="vf-feature-tag">${f}</span>`).join('')}
                  </button>
                </div>
              </div>`).join('')}`;
          el.querySelectorAll('.vf-choice-btn').forEach(btn => {
            btn.onclick = () => {
              const field = btn.dataset.field;
              responses[field] = btn.dataset.value;
              el.querySelectorAll(`[data-field="${field}"]`).forEach(b => b.classList.remove('selected'));
              btn.classList.add('selected');
            };
          });
        },
        collect: (r) => {
          const missing = cfg.conjointTasks.some((_, i) => !r[`c${i + 1}`]);
          if (missing) { alert('Please choose an option for each scenario.'); return false; }
          return true;
        },
      });
    }

    // Part D — Priority allocation (percentage sliders)
    if (cfg.priorityLabels?.length) {
      parts.push({
        id: 'D',
        label: 'Part D — Priorities',
        render: (el) => {
          const keys = ['d1_a', 'd1_b', 'd1_c'];
          const vals = cfg.priorityLabels.map((_, i) => responses[keys[i]] || Math.floor(100 / cfg.priorityLabels.length));
          el.innerHTML = `
            <p class="vf-part-desc">${cfg.partDDescription || 'Distribute 100 points across the options to show your priorities.'}</p>
            <div class="vf-allocation">
              ${cfg.priorityLabels.map((label, i) => `
                <div class="vf-alloc-row">
                  <span class="vf-alloc-label">${label}</span>
                  <input type="range" class="vf-alloc-slider" min="0" max="100" value="${vals[i]}" data-idx="${i}">
                  <span class="vf-alloc-val" id="alloc-val-${i}">${vals[i]}%</span>
                </div>`).join('')}
              <div class="vf-alloc-total">Total: <span id="alloc-total">${vals.reduce((s,v)=>s+v,0)}</span>/100</div>
            </div>`;
          el.querySelectorAll('.vf-alloc-slider').forEach(slider => {
            slider.oninput = () => {
              const idx = Number(slider.dataset.idx);
              vals[idx] = Number(slider.value);
              document.getElementById(`alloc-val-${idx}`).textContent = `${vals[idx]}%`;
              document.getElementById('alloc-total').textContent = vals.reduce((s,v)=>s+v,0);
            };
          });
          // Store vals reference
          el._vals = vals;
        },
        collect: (r) => {
          const el = document.querySelector('.vf-allocation');
          const vals = Array.from(el?.querySelectorAll('.vf-alloc-slider')||[]).map(s=>Number(s.value));
          const keys = ['d1_a','d1_b','d1_c'];
          vals.forEach((v,i) => { r[keys[i]] = v; });
          return true;
        },
      });
    }

    // Part E — Overall preference + open text
    parts.push({
      id: 'E',
      label: 'Part E — Overall',
      render: (el) => {
        const opts = cfg.overallOptions || [
          { value: 'a', label: cfg.option1Name || 'Option 1' },
          { value: 'b', label: cfg.option2Name || 'Option 2' },
          { value: 'hybrid', label: 'Hybrid' },
          { value: 'neither', label: 'Neither — needs rework' },
        ];
        el.innerHTML = `
          <p class="vf-part-desc">Overall, which option do you prefer?</p>
          <div class="vf-pills" id="overall-pills">
            ${opts.map(o => `<button class="vf-pill ${responses.e1===o.value?'selected':''}" data-value="${o.value}">${o.label}</button>`).join('')}
          </div>
          <div class="vf-field" style="margin-top:20px;">
            <label class="vf-field-label">${cfg.openQuestion1 || 'Any comments on parking or safety?'}</label>
            <textarea class="vf-textarea" id="open1" rows="3" placeholder="Optional…">${responses.e2||''}</textarea>
          </div>
          <div class="vf-field" style="margin-top:12px;">
            <label class="vf-field-label">${cfg.openQuestion2 || 'Any other comments?'}</label>
            <textarea class="vf-textarea" id="open2" rows="3" placeholder="Optional…">${responses.e3||''}</textarea>
          </div>`;
        attachPillHandlers('overall-pills', 'e1', responses);
      },
      collect: (r) => {
        if (!r.e1) { alert('Please select your overall preference.'); return false; }
        r.e2 = document.getElementById('open1')?.value || '';
        r.e3 = document.getElementById('open2')?.value || '';
        return true;
      },
    });

    return parts;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEMPLATE: PRIORITY-RANKING (MaxDiff)
  // ═══════════════════════════════════════════════════════════════════════════

  function renderMaxDiff() {
    const cfg = surveyConfig.config;
    const items = cfg.items || [];
    const totalRounds = cfg.rounds || 4;
    const setSize = cfg.setSize || Math.min(5, items.length);

    maxDiffState = { round: 0, totalRounds, best: null, worst: null, allSelections: [] };

    // Build round sets (randomly sampled without full replacement)
    const roundSets = buildMaxDiffRounds(items, totalRounds, setSize);

    function showIntro() {
      root().innerHTML = `
        <div class="vf-survey">
          ${renderSurveyHeader()}
          <div class="vf-intro-card">
            <p>${cfg.description || 'This survey asks you to compare features. There are no right or wrong answers — just your honest priorities.'}</p>
            <p class="vf-part-desc" style="margin-top:8px;">${cfg.purposeStatement || ''}</p>
            <div class="vf-field" style="margin-top:16px;">
              <div class="vf-field-label">I am a:</div>
              <div class="vf-pills" id="respondent-pills">
                ${surveyConfig.respondentTypes.map(t => `<button class="vf-pill" data-value="${t}">${t}</button>`).join('')}
              </div>
            </div>
          </div>
          <div class="vf-nav"><span></span><button class="vf-btn" id="start-btn">Start →</button></div>
        </div>`;
      attachPillHandlers('respondent-pills', 'respondentType', responses);
      document.getElementById('start-btn').onclick = () => {
        if (!responses.respondentType) { alert('Please select who you are.'); return; }
        showRound(0);
      };
    }

    function showRound(roundIdx) {
      if (roundIdx >= totalRounds) { showOpenText(); return; }
      const set = roundSets[roundIdx];
      const progress = Math.round((roundIdx / (totalRounds + 1)) * 100);
      let best = null, worst = null;

      root().innerHTML = `
        <div class="vf-survey">
          ${renderSurveyHeader()}
          <div class="vf-progress-bar"><div class="vf-progress-fill" style="width:${progress}%"></div></div>
          <div class="vf-round-label">Round ${roundIdx + 1} of ${totalRounds}</div>
          <div class="vf-maxdiff">
            <div class="vf-maxdiff-instruction">
              Select the ONE feature that matters <strong class="vf-best-color">most</strong> and the ONE that matters <strong class="vf-worst-color">least</strong>.
            </div>
            <table class="vf-maxdiff-table">
              <thead>
                <tr>
                  <th></th>
                  <th class="vf-best-color">Most Important</th>
                  <th class="vf-worst-color">Least Important</th>
                </tr>
              </thead>
              <tbody>
                ${set.map((item, i) => `
                  <tr>
                    <td class="vf-item-label">${item.label || item}</td>
                    <td class="vf-radio-cell">
                      <div class="vf-radio vf-radio-best" data-idx="${i}" id="best-${roundIdx}-${i}"></div>
                    </td>
                    <td class="vf-radio-cell">
                      <div class="vf-radio vf-radio-worst" data-idx="${i}" id="worst-${roundIdx}-${i}"></div>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="vf-nav">
            ${roundIdx > 0 ? `<button class="vf-btn vf-btn-secondary" id="prev-btn">← Back</button>` : '<span></span>'}
            <button class="vf-btn" id="next-btn">Next Round →</button>
          </div>
        </div>`;

      function updateRadios() {
        root().querySelectorAll('.vf-radio-best').forEach(el => {
          el.classList.toggle('active', Number(el.dataset.idx) === best);
        });
        root().querySelectorAll('.vf-radio-worst').forEach(el => {
          el.classList.toggle('active', Number(el.dataset.idx) === worst);
        });
      }

      root().querySelectorAll('.vf-radio-best').forEach(el => {
        el.onclick = () => { best = Number(el.dataset.idx); if (worst === best) worst = null; updateRadios(); };
      });
      root().querySelectorAll('.vf-radio-worst').forEach(el => {
        el.onclick = () => { worst = Number(el.dataset.idx); if (best === worst) best = null; updateRadios(); };
      });

      if (roundIdx > 0) {
        document.getElementById('prev-btn').onclick = () => showRound(roundIdx - 1);
      }
      document.getElementById('next-btn').onclick = () => {
        if (best === null || worst === null) { alert('Please select both Most Important and Least Important.'); return; }
        // Record selections
        maxDiffState.allSelections[roundIdx] = { set, best, worst };
        showRound(roundIdx + 1);
      };
    }

    function showOpenText() {
      root().innerHTML = `
        <div class="vf-survey">
          ${renderSurveyHeader()}
          <div class="vf-progress-bar"><div class="vf-progress-fill" style="width:90%"></div></div>
          <div class="vf-field" style="margin-top:20px;">
            <label class="vf-field-label">${cfg.openQuestion || 'Is there anything else you\'d like the committee to consider?'}</label>
            <textarea class="vf-textarea" id="open1" rows="4" placeholder="Optional…"></textarea>
          </div>
          <div class="vf-nav">
            <button class="vf-btn vf-btn-secondary" id="prev-btn">← Back</button>
            <button class="vf-btn" id="submit-btn">Submit →</button>
          </div>
        </div>`;
      document.getElementById('prev-btn').onclick = () => showRound(totalRounds - 1);
      document.getElementById('submit-btn').onclick = async () => {
        responses.priorityText = document.getElementById('open1').value || '';
        // Flatten MaxDiff selections into item scores
        flattenMaxDiffSelections(items, maxDiffState.allSelections, responses);
        await submitSurvey();
      };
    }

    showIntro();
  }

  function buildMaxDiffRounds(items, totalRounds, setSize) {
    const rounds = [];
    for (let r = 0; r < totalRounds; r++) {
      // Simple rotation through items
      const start = (r * Math.ceil(items.length / totalRounds)) % items.length;
      const set = [];
      for (let i = 0; i < setSize; i++) {
        set.push(items[(start + i) % items.length]);
      }
      rounds.push(set);
    }
    return rounds;
  }

  function flattenMaxDiffSelections(items, selections, r) {
    // Build item key → best/worst tracking
    const itemMap = {};
    items.forEach((item, i) => {
      const key = `item${i + 1}`;
      itemMap[item.label || item] = key;
    });

    // For each round, record best/worst
    const counts = {};
    items.forEach((item, i) => {
      counts[`item${i + 1}`] = { best: 0, worst: 0 };
    });

    selections.forEach(({ set, best, worst }) => {
      if (best !== null && set[best]) {
        const key = itemMap[set[best].label || set[best]];
        if (key) counts[key].best++;
      }
      if (worst !== null && set[worst]) {
        const key = itemMap[set[worst].label || set[worst]];
        if (key) counts[key].worst++;
      }
    });

    // Write as 'best', 'worst', or '' per item slot
    items.forEach((item, i) => {
      const key = `item${i + 1}`;
      const c = counts[key];
      if (c.best > c.worst) r[key] = 'best';
      else if (c.worst > c.best) r[key] = 'worst';
      else r[key] = '';
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEMPLATE: ANNUAL-SATISFACTION
  // ═══════════════════════════════════════════════════════════════════════════

  function renderSatisfaction() {
    const cfg = surveyConfig.config;
    const services = cfg.serviceRatings || [];

    root().innerHTML = `
      <div class="vf-survey">
        ${renderSurveyHeader()}
        <div class="vf-intro-card">
          <p>${cfg.description || 'This annual survey helps the committee understand your priorities for the year ahead.'}</p>
          <div class="vf-field" style="margin-top:16px;">
            <div class="vf-field-label">I am a:</div>
            <div class="vf-pills" id="respondent-pills">
              ${surveyConfig.respondentTypes.map(t => `<button class="vf-pill" data-value="${t}">${t}</button>`).join('')}
            </div>
          </div>
        </div>

        <div class="vf-part-label" style="margin-top:20px;">Service & Facility Ratings</div>
        <p class="vf-part-desc">Rate your satisfaction with each of the following (1 = Very Dissatisfied, 5 = Very Satisfied).</p>
        <div class="vf-rating-list">
          ${services.map((s, i) => renderRatingRow(`s${i + 1}`, s, responses[`s${i + 1}`])).join('')}
        </div>

        ${cfg.npsQuestion ? `
        <div class="vf-field" style="margin-top:24px;">
          <div class="vf-field-label">${cfg.npsQuestion}</div>
          <div class="vf-nps-scale" id="nps-scale">
            ${Array.from({length:11},(_,i)=>`<button class="vf-nps-btn ${responses.nps==i?'selected':''}" data-value="${i}">${i}</button>`).join('')}
          </div>
          <div class="vf-nps-labels"><span>Not likely</span><span>Very likely</span></div>
        </div>` : ''}

        <div class="vf-field" style="margin-top:20px;">
          <label class="vf-field-label">${cfg.priorityQuestion || 'What one thing should the PPCA focus on in the year ahead?'}</label>
          <textarea class="vf-textarea" id="priority-text" rows="3" placeholder="Your thoughts…"></textarea>
        </div>

        <div class="vf-field" style="margin-top:12px;">
          <label class="vf-field-label">Any other comments?</label>
          <textarea class="vf-textarea" id="additional-comments" rows="3" placeholder="Optional…"></textarea>
        </div>

        <div class="vf-nav"><span></span><button class="vf-btn" id="submit-btn">Submit →</button></div>
      </div>`;

    attachPillHandlers('respondent-pills', 'respondentType', responses);
    attachRatingHandlers(responses);

    if (cfg.npsQuestion) {
      document.getElementById('nps-scale')?.querySelectorAll('.vf-nps-btn').forEach(btn => {
        btn.onclick = () => {
          responses.nps = btn.dataset.value;
          document.querySelectorAll('.vf-nps-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
        };
      });
    }

    document.getElementById('submit-btn').onclick = async () => {
      if (!responses.respondentType) { alert('Please select who you are.'); return; }
      const missing = services.some((_, i) => !responses[`s${i + 1}`]);
      if (missing) { alert('Please rate all services before submitting.'); return; }
      responses.priorityText = document.getElementById('priority-text')?.value || '';
      responses.additionalComments = document.getElementById('additional-comments')?.value || '';
      await submitSurvey();
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEMPLATES: LIKERT-AGREEMENT / STAR-RATING (shared rating-list renderer)
  // ═══════════════════════════════════════════════════════════════════════════

  function renderRatingTemplate({ prefix, items, scaleNote, heading, introDefault }) {
    const cfg = surveyConfig.config;
    const labels = items.map(x => (x && x.label) ? x.label : x);
    root().innerHTML = `
      <div class="vf-survey">
        ${renderSurveyHeader()}
        <div class="vf-intro-card">
          <p>${cfg.description || cfg.purposeStatement || introDefault}</p>
          <div class="vf-field" style="margin-top:16px;">
            <div class="vf-field-label">I am a:</div>
            <div class="vf-pills" id="respondent-pills">
              ${surveyConfig.respondentTypes.map(t => `<button class="vf-pill" data-value="${t}">${t}</button>`).join('')}
            </div>
          </div>
        </div>
        <div class="vf-part-label" style="margin-top:20px;">${heading}</div>
        <p class="vf-part-desc">${scaleNote}.</p>
        <div class="vf-rating-list">
          ${labels.map((s, i) => renderRatingRow(`${prefix}${i + 1}`, s, responses[`${prefix}${i + 1}`])).join('')}
        </div>
        <div class="vf-field" style="margin-top:20px;">
          <label class="vf-field-label">Any comments?</label>
          <textarea class="vf-textarea" id="rt-comment" rows="3" placeholder="Optional…"></textarea>
        </div>
        <div class="vf-nav"><span></span><button class="vf-btn" id="submit-btn">Submit →</button></div>
      </div>`;
    attachPillHandlers('respondent-pills', 'respondentType', responses);
    attachRatingHandlers(responses);
    document.getElementById('submit-btn').onclick = async () => {
      if (!responses.respondentType) { alert('Please select who you are.'); return; }
      if (labels.some((_, i) => !responses[`${prefix}${i + 1}`])) { alert('Please rate every item before submitting.'); return; }
      responses.comment = document.getElementById('rt-comment')?.value || '';
      await submitSurvey();
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEMPLATE: QUICK-POLL (single question, single choice)
  // ═══════════════════════════════════════════════════════════════════════════

  function renderQuickPoll() {
    const cfg = surveyConfig.config;
    const question = cfg.question || cfg.description || 'Your view';
    const options = (cfg.options || []).map(o => (o && o.label) ? o.label : o);
    root().innerHTML = `
      <div class="vf-survey">
        ${renderSurveyHeader()}
        <div class="vf-intro-card">
          ${(cfg.purposeStatement || cfg.description) ? `<p>${cfg.purposeStatement || cfg.description}</p>` : ''}
          <div class="vf-field" style="margin-top:12px;">
            <div class="vf-field-label">I am a:</div>
            <div class="vf-pills" id="respondent-pills">
              ${surveyConfig.respondentTypes.map(t => `<button class="vf-pill" data-value="${t}">${t}</button>`).join('')}
            </div>
          </div>
        </div>
        <div class="vf-field" style="margin-top:20px;">
          <div class="vf-field-label">${question}</div>
          <div class="vf-pills" id="poll-options">
            ${options.map(o => `<button class="vf-pill" data-value="${o}">${o}</button>`).join('')}
          </div>
        </div>
        <div class="vf-nav"><span></span><button class="vf-btn" id="submit-btn">Submit →</button></div>
      </div>`;
    attachPillHandlers('respondent-pills', 'respondentType', responses);
    attachPillHandlers('poll-options', 'choice', responses);
    document.getElementById('submit-btn').onclick = async () => {
      if (!responses.respondentType) { alert('Please select who you are.'); return; }
      if (!responses.choice) { alert('Please choose an option.'); return; }
      await submitSurvey();
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEMPLATE: OPEN-FEEDBACK (one or more open-text prompts)
  // ═══════════════════════════════════════════════════════════════════════════

  function renderOpenFeedback() {
    const cfg = surveyConfig.config;
    const prompts = (cfg.prompts || cfg.items || [cfg.question || 'Share your feedback']).map(p => (p && p.label) ? p.label : p);
    root().innerHTML = `
      <div class="vf-survey">
        ${renderSurveyHeader()}
        <div class="vf-intro-card">
          ${(cfg.purposeStatement || cfg.description) ? `<p>${cfg.purposeStatement || cfg.description}</p>` : ''}
          <div class="vf-field" style="margin-top:12px;">
            <div class="vf-field-label">I am a:</div>
            <div class="vf-pills" id="respondent-pills">
              ${surveyConfig.respondentTypes.map(t => `<button class="vf-pill" data-value="${t}">${t}</button>`).join('')}
            </div>
          </div>
        </div>
        ${prompts.map((p, i) => `
          <div class="vf-field" style="margin-top:18px;">
            <label class="vf-field-label">${p}</label>
            <textarea class="vf-textarea" id="q${i + 1}" rows="3" placeholder="Your response…"></textarea>
          </div>`).join('')}
        <div class="vf-nav"><span></span><button class="vf-btn" id="submit-btn">Submit →</button></div>
      </div>`;
    attachPillHandlers('respondent-pills', 'respondentType', responses);
    document.getElementById('submit-btn').onclick = async () => {
      if (!responses.respondentType) { alert('Please select who you are.'); return; }
      prompts.forEach((_, i) => { responses[`q${i + 1}`] = document.getElementById(`q${i + 1}`)?.value || ''; });
      await submitSurvey();
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEMPLATE: MULTI-SECTION (combine simple templates into one survey)
  // Supported section types: likert-agreement, star-rating, quick-poll, open-feedback
  // Fields are namespaced per section: s1_l1, s1_comment, s2_choice, s3_q1 …
  // ═══════════════════════════════════════════════════════════════════════════

  function sectionTitle(t) {
    return ({ 'likert-agreement': 'Your views', 'star-rating': 'Your ratings', 'quick-poll': 'Quick question', 'open-feedback': 'Your feedback' })[t] || 'Section';
  }

  function renderSectionBlock(el, idx, section) {
    const c = section.config || {};
    const t = section.template;
    if (t === 'likert-agreement' || t === 'star-rating') {
      const items = (t === 'likert-agreement' ? (c.statements || c.items) : (c.items || c.serviceRatings)) || [];
      const labels = items.map(x => (x && x.label) ? x.label : x);
      const pfx = t === 'likert-agreement' ? 'l' : 'r';
      const note = t === 'likert-agreement' ? '1 = Strongly disagree, 5 = Strongly agree' : '1 = Poor, 5 = Excellent';
      el.innerHTML = `
        <p class="vf-part-desc">${note}.</p>
        <div class="vf-rating-list">
          ${labels.map((s, i) => renderRatingRow(`s${idx}_${pfx}${i + 1}`, s, responses[`s${idx}_${pfx}${i + 1}`])).join('')}
        </div>
        <div class="vf-field" style="margin-top:16px;"><label class="vf-field-label">Any comments?</label>
          <textarea class="vf-textarea" id="sec${idx}-comment" rows="2" placeholder="Optional…">${responses[`s${idx}_comment`] || ''}</textarea></div>`;
      attachRatingHandlers(responses);
    } else if (t === 'quick-poll') {
      const q = c.question || 'Your view';
      const options = (c.options || []).map(o => (o && o.label) ? o.label : o);
      el.innerHTML = `<div class="vf-field"><div class="vf-field-label">${q}</div>
        <div class="vf-pills" id="sec${idx}-poll">${options.map(o => `<button class="vf-pill" data-value="${o}">${o}</button>`).join('')}</div></div>`;
      attachPillHandlers(`sec${idx}-poll`, `s${idx}_choice`, responses);
    } else if (t === 'open-feedback') {
      const prompts = (c.prompts || c.items || [c.question || 'Share your feedback']).map(p => (p && p.label) ? p.label : p);
      el.innerHTML = prompts.map((p, i) => `
        <div class="vf-field" style="margin-top:14px;"><label class="vf-field-label">${p}</label>
          <textarea class="vf-textarea" id="sec${idx}-q${i + 1}" rows="3" placeholder="Your response…">${responses[`s${idx}_q${i + 1}`] || ''}</textarea></div>`).join('');
    } else if (t === 'ranked-choice') {
      const items = (c.items || []).map(x => (x && x.label) ? x.label : x);
      const N = items.length;
      el.innerHTML = `<p class="vf-part-desc">Rank these — 1 = highest priority.</p><div class="vf-rating-list">${items.map((s, i) => `<div class="vf-rating-row"><span class="vf-rating-label">${s}</span><select class="vf-textarea" style="max-width:90px;padding:6px;" id="sec${idx}-rk${i + 1}">${['', ...Array.from({ length: N }, (_, k) => k + 1)].map(v => `<option value="${v}" ${responses[`s${idx}_rk${i + 1}`] == v ? 'selected' : ''}>${v || '—'}</option>`).join('')}</select></div>`).join('')}</div>`;
    } else if (t === 'budget-allocation') {
      const items = (c.items || []).map(x => (x && x.label) ? x.label : x);
      const total = c.total || 100;
      el.innerHTML = `<p class="vf-part-desc">Distribute exactly ${total} points.</p><div class="vf-rating-list">${items.map((s, i) => `<div class="vf-rating-row"><span class="vf-rating-label">${s}</span><input type="number" min="0" max="${total}" class="vf-textarea sec${idx}-alloc" style="max-width:90px;padding:6px;" id="sec${idx}-al${i + 1}" value="${responses[`s${idx}_al${i + 1}`] || 0}"></div>`).join('')}</div><div id="sec${idx}-total" style="font-weight:700;margin-top:8px;">Total: 0 / ${total}</div>`;
      const recalc = () => { let sum = 0; items.forEach((_, i) => sum += Number(document.getElementById(`sec${idx}-al${i + 1}`).value) || 0); const e = document.getElementById(`sec${idx}-total`); e.textContent = `Total: ${sum} / ${total}`; e.style.color = sum === total ? '#059669' : '#dc2626'; };
      document.querySelectorAll(`.sec${idx}-alloc`).forEach(inp => inp.addEventListener('input', recalc)); recalc();
    } else if (t === 'importance-performance') {
      const items = (c.items || []).map(x => (x && x.label) ? x.label : x);
      el.innerHTML = items.map((s, i) => `<div style="margin-bottom:14px;"><div style="font-size:13px;font-weight:600;margin-bottom:4px;">${s}</div><div class="vf-rating-list">${renderRatingRow(`s${idx}_imp${i + 1}`, 'Importance', responses[`s${idx}_imp${i + 1}`])}${renderRatingRow(`s${idx}_perf${i + 1}`, 'Performance now', responses[`s${idx}_perf${i + 1}`])}</div></div>`).join('');
      attachRatingHandlers(responses);
    } else if (t === 'demographic') {
      const fields = (c.fields || []).map(f => (typeof f === 'string') ? { label: f, options: [] } : f);
      el.innerHTML = fields.map((f, i) => {
        const opts = f.options || [];
        if (opts.length) return `<div class="vf-field" style="margin-top:14px;"><div class="vf-field-label">${f.label}</div><div class="vf-pills" id="sec${idx}-demo${i + 1}">${opts.map(o => `<button class="vf-pill" data-value="${(o && o.label) ? o.label : o}">${(o && o.label) ? o.label : o}</button>`).join('')}</div></div>`;
        return `<div class="vf-field" style="margin-top:14px;"><label class="vf-field-label">${f.label}</label><input class="vf-textarea" id="sec${idx}-demo${i + 1}-text" value="${responses[`s${idx}_d${i + 1}`] || ''}" placeholder="Your answer…"></div>`;
      }).join('');
      fields.forEach((f, i) => { if ((f.options || []).length) attachPillHandlers(`sec${idx}-demo${i + 1}`, `s${idx}_d${i + 1}`, responses); });
    } else {
      el.innerHTML = `<p class="vf-part-desc">This section type isn't supported in combined surveys.</p>`;
    }
  }

  function collectSectionBlock(idx, section) {
    const c = section.config || {};
    const t = section.template;
    if (t === 'likert-agreement' || t === 'star-rating') {
      const items = (t === 'likert-agreement' ? (c.statements || c.items) : (c.items || c.serviceRatings)) || [];
      const pfx = t === 'likert-agreement' ? 'l' : 'r';
      if (items.some((_, i) => !responses[`s${idx}_${pfx}${i + 1}`])) { alert('Please rate every item in this section.'); return false; }
      responses[`s${idx}_comment`] = document.getElementById(`sec${idx}-comment`)?.value || '';
    } else if (t === 'quick-poll') {
      if (!responses[`s${idx}_choice`]) { alert('Please choose an option.'); return false; }
    } else if (t === 'open-feedback') {
      const prompts = c.prompts || c.items || [c.question || 'x'];
      prompts.forEach((_, i) => { responses[`s${idx}_q${i + 1}`] = document.getElementById(`sec${idx}-q${i + 1}`)?.value || ''; });
    } else if (t === 'ranked-choice') {
      const items = c.items || [];
      for (let i = 0; i < items.length; i++) { const v = document.getElementById(`sec${idx}-rk${i + 1}`)?.value; if (!v) { alert('Please rank every item in this section.'); return false; } responses[`s${idx}_rk${i + 1}`] = v; }
    } else if (t === 'budget-allocation') {
      const items = c.items || []; const total = c.total || 100; let sum = 0;
      items.forEach((_, i) => { const v = Number(document.getElementById(`sec${idx}-al${i + 1}`)?.value) || 0; responses[`s${idx}_al${i + 1}`] = v; sum += v; });
      if (sum !== total) { alert(`Please allocate exactly ${total} points in this section (currently ${sum}).`); return false; }
    } else if (t === 'importance-performance') {
      const items = c.items || [];
      if (items.some((_, i) => !responses[`s${idx}_imp${i + 1}`] || !responses[`s${idx}_perf${i + 1}`])) { alert('Please rate importance and performance for every item.'); return false; }
    } else if (t === 'demographic') {
      const fields = (c.fields || []).map(f => (typeof f === 'string') ? { label: f, options: [] } : f);
      for (let i = 0; i < fields.length; i++) {
        if ((fields[i].options || []).length) { if (!responses[`s${idx}_d${i + 1}`]) { alert(`Please answer: ${fields[i].label}`); return false; } }
        else { responses[`s${idx}_d${i + 1}`] = document.getElementById(`sec${idx}-demo${i + 1}-text`)?.value || ''; }
      }
    }
    return true;
  }

  function renderMultiSection() {
    const cfg = surveyConfig.config;
    const sections = cfg.sections || [];
    const parts = [];

    parts.push({
      label: 'About this survey',
      render: (el) => {
        el.innerHTML = `
          <div class="vf-intro-card">
            <p>${cfg.description || 'Your feedback will inform the committee.'}</p>
            <div class="vf-field" style="margin-top:12px;">
              <div class="vf-field-label">I am a:</div>
              <div class="vf-pills" id="respondent-pills">
                ${surveyConfig.respondentTypes.map(t => `<button class="vf-pill" data-value="${t}">${t}</button>`).join('')}
              </div>
            </div>
          </div>`;
        attachPillHandlers('respondent-pills', 'respondentType', responses);
      },
      collect: () => { if (!responses.respondentType) { alert('Please select who you are.'); return false; } return true; },
    });

    sections.forEach((section, si) => {
      const idx = si + 1;
      parts.push({
        label: section.title || sectionTitle(section.template),
        render: (el) => renderSectionBlock(el, idx, section),
        collect: () => collectSectionBlock(idx, section),
      });
    });

    function showPart(i) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const progress = Math.round((i / parts.length) * 100);
      root().innerHTML = `
        <div class="vf-survey">
          ${renderSurveyHeader()}
          <div class="vf-progress-bar"><div class="vf-progress-fill" style="width:${progress}%"></div></div>
          <div class="vf-part-label">${part.label}</div>
          <div class="vf-part-content" id="part-content"></div>
          <div class="vf-nav">
            ${i > 0 ? `<button class="vf-btn vf-btn-secondary" id="prev-btn">← Back</button>` : '<span></span>'}
            <button class="vf-btn" id="next-btn">${isLast ? 'Submit →' : 'Next →'}</button>
          </div>
        </div>`;
      part.render(document.getElementById('part-content'));
      if (i > 0) document.getElementById('prev-btn').onclick = () => showPart(i - 1);
      document.getElementById('next-btn').onclick = async () => {
        if (!part.collect()) return;
        if (isLast) await submitSurvey();
        else showPart(i + 1);
      };
    }
    showPart(0);
  }

  // ─── Shared render helpers ─────────────────────────────────────────────────

  function renderSurveyHeader() {
    const cfg = surveyConfig;
    const closeDate = cfg.closeDate ? new Date(cfg.closeDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
    return `
      <div class="vf-survey-header">
        <div class="vf-survey-title">${cfg.surveyName}</div>
        <div class="vf-survey-meta">
          ${cfg.village ? `${cfg.village} PPCA` : ''}
          ${cfg.projectName ? ` · ${cfg.projectName}` : ''}
          · Anonymous
          ${closeDate ? ` · Closes ${closeDate}` : ''}
        </div>
      </div>`;
  }

  function renderRatingRow(field, label, currentVal) {
    return `
      <div class="vf-rating-row" data-field="${field}">
        <span class="vf-rating-label">${label}</span>
        <div class="vf-rating-stars">
          ${[1,2,3,4,5].map(v => `
            <button class="vf-star ${currentVal == v ? 'selected' : ''}" data-value="${v}" data-field="${field}">${v}</button>
          `).join('')}
        </div>
      </div>`;
  }

  function renderAttributeTable(cfg) {
    if (!cfg.attributes?.length) return '';
    return `
      <table class="vf-attr-table">
        <thead>
          <tr>
            <th>Feature</th>
            <th>${cfg.option1Name || 'Option 1'}</th>
            <th>${cfg.option2Name || 'Option 2'}</th>
          </tr>
        </thead>
        <tbody>
          ${cfg.attributes.map(a => `
            <tr>
              <td>${a.label}</td>
              <td>${a.option1Value}</td>
              <td class="vf-attr-diff">${a.option2Value}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function attachPillHandlers(containerId, field, r) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.vf-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.vf-pill').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        r[field] = btn.dataset.value;
      });
      if (r[field] === btn.dataset.value) btn.classList.add('selected');
    });
  }

  function attachRatingHandlers(r) {
    document.querySelectorAll('.vf-star').forEach(star => {
      star.addEventListener('click', () => {
        const field = star.dataset.field;
        const val = star.dataset.value;
        r[field] = val;
        document.querySelectorAll(`.vf-star[data-field="${field}"]`).forEach(s => {
          s.classList.toggle('selected', s.dataset.value === val);
        });
      });
    });
  }

  // ─── Submission ─────────────────────────────────────────────────────────────

  async function submitSurvey() {
    const btn = document.getElementById('next-btn') || document.getElementById('submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

    try {
      const payload = {
        sheetId: surveyConfig.sheetId,
        slug: getSlug(),
        template: surveyConfig.template,
        ...responses,
      };

      const res = await fetch(`${API_BASE}/survey-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        renderThankYou();
      } else {
        const err = await res.json().catch(() => ({}));
        renderError(err.error || 'Submission failed. Please try again.');
      }
    } catch (_) {
      renderError('Could not submit. Please check your connection and try again.');
    }
  }

  // ─── Start ──────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
