/* VillageFirst — shared results engine.
   window.VFResults.render(container, data, status, opts) renders a survey's
   aggregated results (the survey-results.js payload) as a themed, tabbed,
   charted view into ANY container. Used by the public results page AND the
   admin Results panel so they are visually identical. Requires Chart.js
   (optional — degrades to no charts) and vf-results.css. */
(function () {
  const THEMES = {
    default:{primary:'#0f4c3a',p2:'#15795f',accent:'#0f8f80',grad:'linear-gradient(135deg,#0f4c3a 0%,#15795f 60%,#0f8f80 100%)',tint:['#ecfdf5','#eff6ff','#fffbeb','#f5f3ff'],kn:['#059669','#2563eb','#e08a1e','#7c3aed'],pie:['#0f8f80','#2563eb','#5c8a1b','#e08a1e','#7c3aed','#e11d63','#64748b'],ramp:['#0f4c3a','#15795f','#0f8f80','#2db597','#34d399','#86efac','#bbf7d0'],dist:['#e11d63','#e08a1e','#cbd5e1','#2db597','#0f8f80']},
    grey:{primary:'#111827',p2:'#374151',accent:'#4b5563',grad:'linear-gradient(135deg,#0b0f17 0%,#1f2937 55%,#374151 100%)',tint:['#f3f4f6','#f3f4f6','#f3f4f6','#f3f4f6'],kn:['#111827','#374151','#4b5563','#6b7280'],pie:['#111827','#374151','#4b5563','#6b7280','#9ca3af','#cbd5e1','#e5e7eb'],ramp:['#0b0f17','#1f2937','#374151','#4b5563','#6b7280','#9ca3af','#cbd5e1'],dist:['#111827','#4b5563','#9ca3af','#6b7280','#374151']}
  };
  const VILLAGE_THEMES = {
    'smiths lake':{primary:'#0b6b6b',p2:'#0e8a8a',accent:'#14b8a6',grad:'linear-gradient(135deg,#063f3f 0%,#0b6b6b 55%,#14b8a6 100%)',tint:['#ecfeff','#eff6ff','#f0fdf4','#fffbeb'],kn:['#0d9488','#2563eb','#16a34a','#d97706'],pie:['#0b6b6b','#14b8a6','#2563eb','#16a34a','#d97706','#7c3aed','#64748b'],ramp:['#063f3f','#0b6b6b','#0e8a8a','#14b8a6','#5eead4','#99f6e4','#cffafe'],dist:['#dc2626','#d97706','#cbd5e1','#2dd4bf','#0d9488']},
    'blueys beach':{primary:'#0c4a8a',p2:'#1769aa',accent:'#2596d4',grad:'linear-gradient(135deg,#0c3a6e 0%,#1769aa 55%,#2596d4 100%)',tint:['#eff6ff','#fffbeb','#ecfeff','#fef2f2'],kn:['#1769aa','#d97706','#0891b2','#e11d63'],pie:['#1769aa','#2596d4','#e0a04e','#0891b2','#16a34a','#7c3aed','#64748b'],ramp:['#0c3a6e','#0c4a8a','#1769aa','#2596d4','#7cc4ec','#bfe1f6','#e3f2fc'],dist:['#dc2626','#e0a04e','#cbd5e1','#5cb3e0','#1769aa']},
    'coomba park':{primary:'#2f6d3b',p2:'#3f8a4e',accent:'#5fae5f',grad:'linear-gradient(135deg,#1f4a28 0%,#2f6d3b 55%,#5fae5f 100%)',tint:['#f0fdf4','#eff6ff','#fffbeb','#f5f3ff'],kn:['#3f8a4e','#2563eb','#d97706','#7c3aed'],pie:['#2f6d3b','#5fae5f','#2563eb','#d97706','#0891b2','#7c3aed','#64748b'],ramp:['#1f4a28','#2f6d3b','#3f8a4e','#5fae5f','#9ed99e','#c9efc9','#e6f8e6'],dist:['#dc2626','#d97706','#cbd5e1','#86c186','#3f8a4e']}
  };
  let TH = THEMES.default;
  function themeForVillage(v){return VILLAGE_THEMES[(v||'').trim().toLowerCase()]||THEMES.default}
  function setTheme(rootEl,t){TH=t;if(!rootEl)return;const r=rootEl.style;r.setProperty('--primary',t.primary);r.setProperty('--primary-2',t.p2);r.setProperty('--accent',t.accent);r.setProperty('--grad',t.grad);t.tint.forEach((c,i)=>r.setProperty('--tint'+(i+1),c));t.kn.forEach((c,i)=>r.setProperty('--kn'+(i+1),c));r.setProperty('--pos',t.dist[4]);r.setProperty('--neg',t.dist[0])}

  let charts=[];const clearCharts=()=>{charts.forEach(c=>{try{c.destroy()}catch(e){}});charts=[]};
  const hasChart=()=>typeof Chart!=='undefined';
  const pct=(v,t)=>t?Math.round(v/t*100):0;
  const num=v=>(v==null||isNaN(v))?0:v;
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
  const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e};
  const ramp=i=>TH.ramp[Math.min(i,6)];
  function topOf(o){const e=Object.entries(o||{}).sort((a,b)=>b[1]-a[1]);if(!e.length)return null;const t=e.reduce((s,[,v])=>s+v,0);return{label:e[0][0],n:e[0][1],pct:pct(e[0][1],t),total:t,entries:e}}
  function countUp(node,to,suffix){if(!isFinite(to)){node.textContent=to+(suffix||'');return}let s=0,steps=26,i=0;const inc=to/steps;const id=setInterval(()=>{i++;s+=inc;if(i>=steps){s=to;clearInterval(id)}node.textContent=(Number.isInteger(to)?Math.round(s):s.toFixed(1))+(suffix||'')},18)}
  const TPL_ICON={'conjoint-design-options':'⚖️','priority-ranking':'🎯','annual-satisfaction':'📊','star-rating':'⭐','quick-poll':'✅','likert-agreement':'📋','open-feedback':'💬','ranked-choice':'🔢','budget-allocation':'💰','importance-performance':'📈','demographic':'👥','respondent-profile':'👥','multi-section':'🗂️'};

  function kpiRow(items){const g=el('div','grid g4');items.forEach((it,i)=>{const k=el('div','kpi k'+((i%4)+1),`<div class="n">0</div><div class="l">${esc(it.l)}</div>`);g.appendChild(k);setTimeout(()=>{if(typeof it.n==='number')countUp(k.querySelector('.n'),it.n,it.suf||'');else k.querySelector('.n').textContent=it.n},30)});return g}
  function rankedBars(rows,opts){opts=opts||{};const box=el('div','bars');rows.forEach((r,i)=>{const w=Math.max(num(r.val),2.5);const row=el('div','bar-row');row.innerHTML=`<div class="bar-lab">${opts.rankNum?`<span class="rank">${i+1}</span>`:''}${esc(r.label)}${r.sub?`<small>${esc(r.sub)}</small>`:''}</div><div class="track"><div class="fill" style="background:${ramp(i)}">${esc(r.txt)}</div></div><div class="bar-n">${r.n!=null?'n='+r.n:''}</div>`;box.appendChild(row);requestAnimationFrame(()=>setTimeout(()=>{const f=row.querySelector('.fill');if(f)f.style.width=Math.min(w,100)+'%'},60+i*70))});return box}
  function donut(obj,title){const wrap=el('div','donut-wrap');if(title)wrap.appendChild(el('div','ctitle',title));const cb=el('div','canvas-box');const cv=document.createElement('canvas');cb.appendChild(cv);wrap.appendChild(cb);if(hasChart())setTimeout(()=>charts.push(new Chart(cv,{type:'doughnut',data:{labels:Object.keys(obj),datasets:[{data:Object.values(obj),backgroundColor:TH.pie,borderColor:'#fff',borderWidth:2}]},options:{cutout:'62%',plugins:{legend:{position:'bottom',labels:{boxWidth:11,font:{size:11},padding:9}}}}})),20);return wrap}
  function donutCard(title,obj){const c=el('div','card');c.appendChild(donut(obj,title));return c}
  function distMini(items){const grid=el('div','dist-grid');items.forEach(it=>{const c=el('div','dist');c.innerHTML=`<h4>${esc(it.label)}</h4><div class="avg">avg ${num(it.avg).toFixed(2)} / 5 · n=${it.n||''}</div>`;const cb=el('div');cb.style.height='130px';const cv=document.createElement('canvas');cb.appendChild(cv);c.appendChild(cb);grid.appendChild(c);if(hasChart())setTimeout(()=>charts.push(new Chart(cv,{type:'bar',data:{labels:['1','2','3','4','5'],datasets:[{data:it.dist,backgroundColor:TH.dist,borderRadius:5}]},options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0,font:{size:10}}},x:{ticks:{font:{size:10}}}}}})),20)});return grid}
  function gauge(value,label,min,max){const wrap=el('div','gauge-wrap');const box=el('div','gauge-box');const cv=document.createElement('canvas');box.appendChild(cv);const v=el('div','gauge-val',`<div class="gv" style="color:${TH.accent}">${value}</div><div class="gl">${esc(label)}</div>`);box.appendChild(v);wrap.appendChild(box);const frac=Math.max(0,Math.min(1,(value-min)/(max-min)));if(hasChart())setTimeout(()=>charts.push(new Chart(cv,{type:'doughnut',data:{datasets:[{data:[frac,1-frac],backgroundColor:[TH.accent,'#eef2f0'],borderWidth:0}]},options:{rotation:-90,circumference:180,cutout:'72%',plugins:{legend:{display:false},tooltip:{enabled:false}}}})),20);return wrap}
  function divergingLikert(items){const box=el('div','lik');const cols=TH.dist;items.forEach(s=>{const t=s.dist.reduce((a,b)=>a+b,0);const p=s.dist.map(d=>pct(d,t));const agree=p[3]+p[4];const row=el('div');row.innerHTML=`<div class="lik-top"><span>${esc(s.label)}</span><span class="agree">${agree}% agree</span></div>`;const bar=el('div','lik-bar');p.forEach((pp,i)=>{if(pp>0){const seg=el('div','lik-seg',pp>=8?pp+'%':'');seg.style.width=pp+'%';seg.style.background=cols[i];bar.appendChild(seg)}});row.appendChild(bar);box.appendChild(row)});const lg=el('div','lik-legend');['Strongly disagree','Disagree','Neutral','Agree','Strongly agree'].forEach((t,i)=>lg.appendChild(el('span',null,`<i style="background:${cols[i]}"></i>${t}`)));box.appendChild(lg);return box}
  function quadrant(pts){const W=460,H=380,pad=46,pw=W-pad*2,ph=H-pad*2;const x=v=>pad+((v-1)/4)*pw,y=v=>pad+((5-v)/4)*ph;const mx=x(3),my=y(3);let svg=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:520px;height:auto;font-family:inherit"><rect x="${pad}" y="${pad}" width="${pw/2}" height="${ph/2}" fill="#fef2f2"/><rect x="${mx}" y="${pad}" width="${pw/2}" height="${ph/2}" fill="${TH.tint[0]}"/><rect x="${pad}" y="${my}" width="${pw/2}" height="${ph/2}" fill="#f8fafc"/><rect x="${mx}" y="${my}" width="${pw/2}" height="${ph/2}" fill="#f8fafc"/><line x1="${mx}" y1="${pad}" x2="${mx}" y2="${pad+ph}" stroke="#cbd5e1" stroke-dasharray="4"/><line x1="${pad}" y1="${my}" x2="${pad+pw}" y2="${my}" stroke="#cbd5e1" stroke-dasharray="4"/><text x="${pad+8}" y="${pad+16}" font-size="11" font-weight="700" fill="#dc2626">Focus here</text><text x="${mx+8}" y="${pad+16}" font-size="11" font-weight="700" fill="${TH.accent}">Keep it up</text><text x="${pad+8}" y="${pad+ph-8}" font-size="11" fill="#9ca3af">Lower priority</text><text x="${mx+8}" y="${pad+ph-8}" font-size="11" fill="#9ca3af">Possible overkill</text><text x="${pad+pw/2}" y="${H-10}" font-size="11" fill="#475569" text-anchor="middle">Performance →</text><text x="14" y="${pad+ph/2}" font-size="11" fill="#475569" text-anchor="middle" transform="rotate(-90 14 ${pad+ph/2})">Importance →</text>`;pts.forEach((p,i)=>{const cx=x(num(p.performance)||1),cy=y(num(p.importance)||1);svg+=`<circle cx="${cx}" cy="${cy}" r="7" fill="${ramp(i)}" opacity=".9"/><text x="${cx+10}" y="${cy+4}" font-size="10" fill="#16261f">${esc(p.label)}</text>`});return el('div','card',svg)}
  function commentList(list){const c=el('div');list.slice(0,200).forEach(o=>{const main=o.comments||o.text||'';const extra=o.additionalComments?`<div class="tx" style="margin-top:6px">${esc(o.additionalComments)}</div>`:'';c.appendChild(el('div','cmt',`<div class="who">${esc(o.person||'Community member')}</div><div class="tx">${esc(main)}</div>${extra}`))});return c}
  function responsesPanel(list){const p=el('div');p.appendChild(el('div','callout','Comments are shown as submitted, lightly moderated for readability. Names and identifying details are removed.'));const c=el('div','card mt');c.appendChild(el('div','ctitle',`Open responses (${list.length})`));c.appendChild(commentList(list));p.appendChild(c);return p}
  function whoDonut(rb){return donutCard('Who responded?',rb)}
  function headline(text){return el('div','headline',`<span class="ht">Headline</span>${text}`)}
  function hasDist(arr){return arr&&arr.length&&arr.every(x=>Array.isArray(x.dist)&&x.dist.length===5)}
  function ratingBar(x){if(x.avg!=null&&x.bestPct==null)return{label:x.label,val:pct(x.avg,5),txt:num(x.avg).toFixed(1),n:x.n};return{label:x.label,val:num(x.bestPct),txt:num(x.bestPct)+'%',n:x.n!=null?x.n:x.bestCount}}
  function findingsList(items){const wrap=el('div');wrap.appendChild(el('div','ctitle','Key findings'));wrap.appendChild(el('div','callout',`<span class="auto-tag">Auto</span>Generated from the live response data; refreshes as new responses arrive.`));items.forEach(([h,b])=>wrap.appendChild(el('div','find',`<h4>${esc(h)}</h4><p>${esc(b)}</p>`)));return wrap}

  /* ===== layouts (each returns [{title,build}]) ===== */
  function L_conjoint(d){const ov=topOf(d.overall);const tabs=[];
    tabs.push({title:'Overview',build:()=>{const p=el('div');if(ov)p.appendChild(headline(`<b>${esc(ov.label)}</b> is the leading design preference at <b>${ov.pct}%</b> of ${d.count} responses.`));p.appendChild(kpiRow([{n:d.count,l:'Total Responses'},{n:Object.keys(d.respondentBreakdown||{}).length,l:'Respondent Groups'},{n:ov?ov.pct:0,l:ov?'Leading: '+ov.label:'Leading',suf:'%'},{n:(d.openText||[]).length,l:'Written Comments'}]));const g=el('div','grid g2 mt');if(d.respondentBreakdown)g.appendChild(whoDonut(d.respondentBreakdown));if(ov)g.appendChild(donutCard('Overall preference',d.overall));p.appendChild(g);if(ov){const pb=el('div','card mt');pb.appendChild(el('div','ctitle','Preference breakdown'));pb.appendChild(rankedBars(ov.entries.map(([k,v])=>({label:k,val:pct(v,ov.total),txt:pct(v,ov.total)+'%',n:v}))));p.appendChild(pb)}return p}});
    if(d.partA&&d.partA.length)tabs.push({title:'Shared Features',build:()=>{const p=el('div');p.appendChild(el('div','callout','<b>Shared features</b> rated 1–5 (appear in both designs).'));const c=el('div','card mt');c.appendChild(el('div','ctitle','Ranked by agreement'));c.appendChild(rankedBars([...d.partA].sort((a,b)=>b.avg-a.avg).map(f=>({label:f.label,val:pct(f.avg,5),txt:num(f.avg).toFixed(2),n:f.n})),{rankNum:true}));p.appendChild(c);if(hasDist(d.partA)){const cd=el('div','card mt');cd.appendChild(el('div','ctitle','Rating distributions (1–5)'));cd.appendChild(distMini(d.partA));p.appendChild(cd)}return p}});
    if(d.partB&&d.partB.length)tabs.push({title:'Key Differences',build:()=>{const p=el('div');p.appendChild(el('div','callout blue','<b>Importance of the key differences</b> rated 1–5.'));const c=el('div','card mt');c.appendChild(el('div','ctitle','Importance'));if(hasDist(d.partB)){c.appendChild(distMini(d.partB.map(b=>({label:b.label,avg:b.avg,n:b.n,dist:b.dist}))))}else{c.appendChild(rankedBars(d.partB.map(b=>({label:b.label,val:pct(b.avg,5),txt:num(b.avg).toFixed(2),n:b.n})),{rankNum:true}))}p.appendChild(c);return p}});
    if(d.conjoint&&d.conjoint.length)tabs.push({title:'Conjoint',build:()=>{const p=el('div');p.appendChild(el('div','callout amber','<b>Conjoint tasks</b> — package choices that isolate what drives preference.'));const cg=el('div','grid g2 mt');d.conjoint.forEach(t=>{const c=el('div','card');c.innerHTML=`<div class="ctitle" style="color:var(--ink)">${esc(t.task)}</div>`;c.appendChild(rankedBars([{label:t.option1,val:t.option1Pct,txt:t.option1Pct+'%',n:t.option1Count},{label:t.option2,val:t.option2Pct,txt:t.option2Pct+'%',n:t.option2Count}]));cg.appendChild(c)});p.appendChild(cg);return p}});
    if(d.partD&&d.partD.length)tabs.push({title:'Priorities',build:()=>{const p=el('div');p.appendChild(el('div','callout','<b>Relative importance</b> — average of 100 points across the differences.'));const obj={};d.partD.forEach(x=>obj[x.label]=x.avg);const g=el('div','grid g2 mt');g.appendChild(donutCard('Average allocation',obj));const c=el('div','card');c.appendChild(el('div','ctitle','Allocation breakdown'));c.appendChild(rankedBars(d.partD.map(x=>({label:x.label,val:x.avg,txt:x.avg+'%'}))));g.appendChild(c);p.appendChild(g);return p}});
    if(d.openText&&d.openText.length)tabs.push({title:'Responses',build:()=>responsesPanel(d.openText)});
    tabs.push({title:'Analysis',build:()=>{const f=[];if(ov)f.push(['Leading preference',`${ov.label} leads at ${ov.pct}% of ${d.count} responses.`]);if(d.partA&&d.partA.length){const s=[...d.partA].sort((a,b)=>b.avg-a.avg);f.push(['Highest-rated shared feature',`${s[0].label} scored ${num(s[0].avg).toFixed(2)}/5.`])}if(d.partD&&d.partD.length){const s=[...d.partD].sort((a,b)=>b.avg-a.avg);f.push(['Top priority',`${s[0].label} attracts the most points (${s[0].avg}).`])}return findingsList(f)}});
    return tabs;}
  function L_maxdiff(d){const top=(d.utilityScores||[])[0];const tabs=[];
    tabs.push({title:'Overview',build:()=>{const p=el('div');if(top)p.appendChild(headline(`<b>${esc(top.label)}</b> is the clear community priority — best-rated by <b>${top.bestPct}%</b> of ${d.count} respondents.`));p.appendChild(kpiRow([{n:d.count,l:'Total Responses'},{n:(d.utilityScores||[]).length,l:'Options Ranked'},{n:top?top.bestPct:0,l:top?'Top: '+top.label:'Top',suf:'%'},{n:(d.openText||[]).length,l:'Comments'}]));const g=el('div','grid g2 mt');if(d.respondentBreakdown)g.appendChild(whoDonut(d.respondentBreakdown));const c=el('div','card');c.appendChild(el('div','ctitle','Community priority score'));c.appendChild(rankedBars((d.utilityScores||[]).map(u=>({label:u.label,val:u.bestPct,txt:u.bestPct+'%',n:u.bestCount})),{rankNum:true}));g.appendChild(c);p.appendChild(g);return p}});
    if(d.utilityScores&&d.utilityScores.length)tabs.push({title:'Priority Scores',build:()=>{const p=el('div');p.appendChild(el('div','callout blue','<b>Best–Worst scoring:</b> net utility = chosen best minus worst. Higher = stronger priority.'));const c=el('div','card mt');c.appendChild(el('div','ctitle','Net utility'));c.appendChild(rankedBars(d.utilityScores.map(u=>({label:u.label,val:Math.max(3,num(u.utilityScore)+15),txt:(u.utilityScore>0?'+':'')+u.utilityScore,sub:`${u.bestCount} best · ${u.worstCount} worst`})),{rankNum:true}));p.appendChild(c);return p}});
    if(d.openText&&d.openText.length)tabs.push({title:'Responses',build:()=>responsesPanel(d.openText)});
    return tabs;}
  function L_satisfaction(d){const s=[...(d.serviceRatings||[])].sort((a,b)=>b.avg-a.avg);const top=s[0],low=s[s.length-1];const tabs=[];
    tabs.push({title:'Overview',build:()=>{const p=el('div');if(top)p.appendChild(headline(`${d.nps!=null?'Overall NPS <b>'+d.nps+'</b>. ':''}<b>${esc(top.label)}</b> rates highest; <b>${esc(low.label)}</b> is the clearest area to improve.`));const k=el('div','grid g2 mt');if(d.nps!=null){const kl=el('div','card');kl.appendChild(gauge(d.nps,'Net Promoter Score (n='+(d.npsCount||0)+')',-100,100));k.appendChild(kl)}const kr=el('div');kr.appendChild(kpiRow([{n:d.count,l:'Responses'},{n:top?top.avg:0,l:'Highest rated'},{n:low?low.avg:0,l:'Lowest rated'},{n:Object.keys(d.respondentBreakdown||{}).length,l:'Groups'}]));k.appendChild(kr);p.appendChild(k);const g=el('div','grid g2 mt');if(d.respondentBreakdown)g.appendChild(whoDonut(d.respondentBreakdown));const c=el('div','card');c.appendChild(el('div','ctitle','Average satisfaction (1–5)'));c.appendChild(rankedBars(s.map(x=>({label:x.label,val:pct(x.avg,5),txt:num(x.avg).toFixed(1),n:x.n})),{rankNum:true}));g.appendChild(c);p.appendChild(g);return p}});
    if(hasDist(s))tabs.push({title:'Ratings',build:()=>{const p=el('div');p.appendChild(el('div','callout blue','Distribution of 1–5 ratings per service.'));const c=el('div','card mt');c.appendChild(el('div','ctitle','Rating distributions'));c.appendChild(distMini(s));p.appendChild(c);return p}});
    if(d.openText&&d.openText.length)tabs.push({title:'Responses',build:()=>responsesPanel(d.openText)});
    return tabs;}
  function L_ratings(d,labelN){const s=[...(d.serviceRatings||[])];const isAvg=s.length&&s[0].avg!=null;if(isAvg)s.sort((a,b)=>b.avg-a.avg);const tabs=[];
    tabs.push({title:'Overview',build:()=>{const p=el('div');if(s.length){const t=s[0];p.appendChild(headline(`<b>${esc(t.label)}</b> ${isAvg?'is rated highest at <b>'+num(t.avg).toFixed(1)+'/5</b>':'leads with <b>'+num(t.bestPct)+'%</b>'} of ${d.count} responses.`))}p.appendChild(kpiRow([{n:d.count,l:'Responses'},{n:s.length,l:'Items'},{n:Object.keys(d.respondentBreakdown||{}).length,l:'Groups'},{n:(d.openText||[]).length,l:'Comments'}]));const g=el('div','grid g2 mt');if(d.respondentBreakdown)g.appendChild(whoDonut(d.respondentBreakdown));const c=el('div','card');c.appendChild(el('div','ctitle',labelN||'Results'));c.appendChild(rankedBars(s.map(ratingBar),{rankNum:true}));g.appendChild(c);p.appendChild(g);if(hasDist(s)){const cd=el('div','card mt');cd.appendChild(el('div','ctitle','Rating distributions'));cd.appendChild(distMini(s));p.appendChild(cd)}return p}});
    if(d.openText&&d.openText.length)tabs.push({title:'Responses',build:()=>responsesPanel(d.openText)});
    return tabs;}
  function L_likert(d){const s=(d.serviceRatings||[]);const tabs=[];const useDiv=hasDist(s);
    tabs.push({title:'Overview',build:()=>{const p=el('div');p.appendChild(kpiRow([{n:d.count,l:'Responses'},{n:s.length,l:'Statements'},{n:Object.keys(d.respondentBreakdown||{}).length,l:'Groups'},{n:(d.openText||[]).length,l:'Comments'}]));const c=el('div','card mt');c.appendChild(el('div','ctitle',useDiv?'Agreement (diverging) — % per level':'Average agreement (1–5)'));c.appendChild(useDiv?divergingLikert(s):rankedBars([...s].sort((a,b)=>b.avg-a.avg).map(ratingBar),{rankNum:true}));p.appendChild(c);return p}});
    if(d.openText&&d.openText.length)tabs.push({title:'Responses',build:()=>responsesPanel(d.openText)});
    return tabs;}
  function L_poll(d){const s=(d.serviceRatings||[]);const obj={};s.forEach(x=>obj[x.label]=x.n!=null?x.n:x.bestPct);const ov=topOf(obj);const tabs=[];
    tabs.push({title:'Overview',build:()=>{const p=el('div');if(ov)p.appendChild(headline(`<b>${esc(ov.label)}</b> leads with <b>${ov.pct}%</b> of ${d.count} responses.`));p.appendChild(kpiRow([{n:d.count,l:'Total Responses'},{n:ov?ov.pct:0,l:ov?ov.label:'Top',suf:'%'},{n:s.length,l:'Options'},{n:Object.keys(d.respondentBreakdown||{}).length,l:'Groups'}]));const g=el('div','grid g2 mt');g.appendChild(donutCard('Result',obj));const c=el('div','card');c.appendChild(el('div','ctitle','Vote share'));c.appendChild(rankedBars(s.map(ratingBar),{rankNum:true}));g.appendChild(c);p.appendChild(g);return p}});
    if(d.openText&&d.openText.length)tabs.push({title:'Responses',build:()=>responsesPanel(d.openText)});
    return tabs;}
  function L_budget(d){const s=(d.serviceRatings||[]);const tabs=[];
    tabs.push({title:'Overview',build:()=>{const p=el('div');if(s.length)p.appendChild(headline(`The community puts the most weight on <b>${esc(s[0].label)}</b>.`));p.appendChild(kpiRow([{n:d.count,l:'Responses'},{n:s.length,l:'Options'},{n:Object.keys(d.respondentBreakdown||{}).length,l:'Groups'},{n:(d.openText||[]).length,l:'Comments'}]));const c=el('div','card mt');c.appendChild(el('div','ctitle','Average allocation'));c.appendChild(rankedBars(s.map(ratingBar),{rankNum:true}));p.appendChild(c);return p}});
    if(d.openText&&d.openText.length)tabs.push({title:'Responses',build:()=>responsesPanel(d.openText)});
    return tabs;}
  function L_ipa(d){const ipa=d.ipa||[];const tabs=[];
    tabs.push({title:'Overview',build:()=>{const p=el('div');const focus=ipa.filter(x=>x.importance>=3&&x.performance<3).sort((a,b)=>b.gap-a.gap);if(focus.length)p.appendChild(headline(`<b>${esc(focus.map(f=>f.label).join(' & '))}</b> are high-importance but low-performance — the clearest priorities to fix.`));p.appendChild(kpiRow([{n:d.count,l:'Responses'},{n:focus.length,l:'In "Focus here"'},{n:ipa.length,l:'Services'},{n:Object.keys(d.respondentBreakdown||{}).length,l:'Groups'}]));const g=el('div','grid g2 mt');if(ipa.length)g.appendChild(quadrant(ipa));const c=el('div','card');c.appendChild(el('div','ctitle','Importance − performance gap'));c.appendChild(rankedBars([...ipa].sort((a,b)=>b.gap-a.gap).map(x=>({label:x.label,val:Math.max(3,Math.abs(num(x.gap))/2*100),txt:(x.gap>0?'+':'')+num(x.gap).toFixed(1)})),{rankNum:true}));g.appendChild(c);p.appendChild(g);return p}});
    if(d.openText&&d.openText.length)tabs.push({title:'Responses',build:()=>responsesPanel(d.openText)});
    return tabs;}
  function L_demographic(d){const s=(d.serviceRatings||[]);const tabs=[];
    tabs.push({title:'Overview',build:()=>{const p=el('div');p.appendChild(kpiRow([{n:d.count,l:'Total Registered'},{n:Object.keys(d.respondentBreakdown||{}).length,l:'Types'},{n:s.length,l:'Profile Values'},{n:(d.openText||[]).length,l:'Open Fields'}]));if(d.respondentBreakdown){const g=el('div','grid g3 mt');g.appendChild(whoDonut(d.respondentBreakdown));p.appendChild(g)}if(s.length){const c=el('div','card mt');c.appendChild(el('div','ctitle','Profile breakdown'));c.appendChild(rankedBars(s.map(ratingBar)));p.appendChild(c)}return p}});
    if(d.openText&&d.openText.length)tabs.push({title:'Responses',build:()=>responsesPanel(d.openText)});
    return tabs;}
  function L_open(d){return [{title:'Responses',build:()=>{const p=el('div');p.appendChild(headline(`<b>${(d.openText||[]).length}</b> ideas and comments submitted by the community.`));p.appendChild(responsesPanel(d.openText||[]));return p}}]}
  function L_multisection(d){const tabs=[{title:'Overview',build:()=>{const p=el('div');p.appendChild(headline(`<b>${d.count}</b> responses across <b>${(d.sections||[]).length}</b> sections.`));p.appendChild(kpiRow([{n:d.count,l:'Responses'},{n:(d.sections||[]).length,l:'Sections'},{n:Object.keys(d.respondentBreakdown||{}).length,l:'Groups'},{n:(d.sections||[]).reduce((s,x)=>s+((x.openText||[]).length),0),l:'Comments'}]));if(d.respondentBreakdown){const g=el('div','grid g2 mt');g.appendChild(whoDonut(d.respondentBreakdown));p.appendChild(g)}return p}}];
    (d.sections||[]).forEach((sec,i)=>{tabs.push({title:sec.title||('Section '+(i+1)),build:()=>{const p=el('div');if(sec.serviceRatings&&sec.serviceRatings.length){const c=el('div','card');c.appendChild(el('div','ctitle',esc(sec.title||sec.template)));c.appendChild(rankedBars(sec.serviceRatings.map(ratingBar),{rankNum:true}));p.appendChild(c);if(hasDist(sec.serviceRatings)){const cd=el('div','card mt');cd.appendChild(el('div','ctitle','Distributions'));cd.appendChild(distMini(sec.serviceRatings));p.appendChild(cd)}}if(sec.openText&&sec.openText.length)p.appendChild((()=>{const c=el('div','card mt');c.appendChild(el('div','ctitle','Responses'));c.appendChild(commentList(sec.openText));return c})());if(!(sec.serviceRatings&&sec.serviceRatings.length)&&!(sec.openText&&sec.openText.length))p.appendChild(el('div','vf-state','<p>No responses in this section yet.</p>'));return p}})});
    return tabs;}
  const LAYOUTS={'conjoint-design-options':L_conjoint,'priority-ranking':L_maxdiff,'annual-satisfaction':L_satisfaction,'likert-agreement':L_likert,'star-rating':d=>L_ratings(d,'Average rating (1–5)'),'quick-poll':L_poll,'open-feedback':L_open,'ranked-choice':d=>L_ratings(d,'Overall ranking'),'budget-allocation':L_budget,'importance-performance':L_ipa,'demographic':L_demographic,'respondent-profile':L_demographic,'multi-section':L_multisection};

  function mountTabs(container,tabs){
    const tabsWrap=el('div','vfr-tabs');const tabbar=el('div','vfr-tabbar');tabsWrap.appendChild(tabbar);
    const panels=el('div','vfr-panels');
    if(tabs.length<=1)tabsWrap.style.display='none';
    container.appendChild(tabsWrap);container.appendChild(panels);
    tabs.forEach((t,i)=>{
      const b=el('button','vfr-tab'+(i===0?' on':''),esc(t.title));
      const pan=el('div','vfr-panel'+(i===0?' on':''));pan.appendChild(t.build());panels.appendChild(pan);
      b.onclick=()=>{[...tabbar.children].forEach(x=>x.classList.remove('on'));b.classList.add('on');[...panels.children].forEach(x=>x.classList.remove('on'));panels.children[i].classList.add('on')};
      tabbar.appendChild(b);
    });
  }

  // Render a survey-results payload into `container`. status: 'active'|'closed'|...
  function render(container,data,status,opts){
    opts=opts||{};
    container.classList.add('vfr-root');
    const theme=opts.theme||themeForVillage(data&&data.survey&&data.survey.village);
    setTheme(container,theme);
    clearCharts();
    container.innerHTML='';
    const count=(data&&data.count)||0;
    if(count===0){container.appendChild(el('div','vf-state','<h2>No responses yet</h2><p>Results will appear here as the community responds.</p>'));return}
    const tpl=data.template||(data.survey&&data.survey.template);
    const layout=LAYOUTS[tpl];
    if(!layout){container.appendChild(el('div','vf-state','<h2>Results received</h2><p>'+count+' responses recorded.</p>'));return}
    mountTabs(container,layout(data));
  }

  // Hub helpers (shared so public hub + admin overview match)
  function effStatus(s){const st=(s.status||'').toLowerCase();if(st==='draft')return'draft';if(st==='paused')return'paused';if(st==='closed')return'closed';if(st==='scheduled')return'scheduled';const now=new Date();const open=st==='live'?true:!!s.active;if(!open)return'closed';if(s.openDate&&new Date(s.openDate)>now)return'scheduled';if(s.closeDate&&new Date(s.closeDate)<now)return'closed';return'live'}
  function publicViewable(s){const vis=(s.resultsVisibility||'public').toLowerCase();const st=effStatus(s);if(st==='draft')return false;if(vis==='public')return true;if(vis==='after-close')return st==='closed';return false}
  function hubCard(s,opts){
    opts=opts||{};const st=effStatus(s);const a=el('a','scard');
    if(opts.onSelect){a.href='javascript:void(0)';a.addEventListener('click',e=>{e.preventDefault();opts.onSelect(s.slug,s)})}
    else a.href=(opts.hrefBuilder?opts.hrefBuilder(s):('/results/?slug='+encodeURIComponent(s.slug)));
    const cnt=s.responseCount!=null?s.responseCount:'—';
    const close=s.closeDate?('closes '+new Date(s.closeDate).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})):'';
    a.innerHTML=`<div class="top"><span class="ico">${TPL_ICON[s.template]||'📋'}</span><div style="flex:1"><div class="nm">${esc(s.surveyName)}</div><div class="tpl">${esc((s.template||'').replace(/-/g,' '))}</div></div><span class="pill ${st}">${st[0].toUpperCase()+st.slice(1)}</span></div><div class="meta"><span><b>${cnt}</b> responses</span>${close?`<span>${esc(close)}</span>`:''}<span class="view">View results →</span></div>`;
    if(opts.cardActions){const act=opts.cardActions(s);if(act){if(typeof act==='string'){a.appendChild(el('div','scard-actions',act))}else{a.appendChild(act)}}}
    return a;
  }
  function renderHub(container,surveys,opts){
    opts=opts||{};container.classList.add('vfr-root');
    setTheme(container,opts.theme||themeForVillage(opts.village));
    container.innerHTML='';
    const list=surveys.filter(s=>s.slug).filter(opts.includeAll?(()=>true):publicViewable);
    if(!list.length){container.appendChild(el('div','vf-state','<h2>No results yet</h2><p>Survey results will appear here once published.</p>'));return}
    const grid=el('div','hub-grid');list.forEach(s=>grid.appendChild(hubCard(s,opts)));container.appendChild(grid);
  }

  window.VFResults={render,renderHub,hubCard,setTheme,themeForVillage,clearCharts,THEMES,VILLAGE_THEMES,
    util:{el,esc,pct,num,effStatus,publicViewable,TPL_ICON}};
})();
