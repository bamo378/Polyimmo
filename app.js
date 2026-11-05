/* PolyImmo Solaire — interface principale (Accueil, Production)
   Sources : data/production.json (Aurora Vision) + saisies (factures GRD) via entries.js */
'use strict';
const AURORA_PUBLIC_URL = "";   // URL publique Aurora Vision (Plant Viewer), si le partage est activé un jour

const PI = window.PI = window.PI || {};
const MOIS = PI.MOIS = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
const MOISL = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const JOURS = ['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'];
const nf0 = PI.nf0 = new Intl.NumberFormat('fr-CH',{maximumFractionDigits:0});
const nf1 = PI.nf1 = new Intl.NumberFormat('fr-CH',{minimumFractionDigits:1,maximumFractionDigits:1});
const nf2 = PI.nf2 = new Intl.NumberFormat('fr-CH',{minimumFractionDigits:2,maximumFractionDigits:2});
const css = PI.css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const D = PI.D = s => new Date(s + 'T12:00:00');
const iso = PI.iso = d => d.toLocaleDateString('sv-SE');
const addDays = PI.addDays = (s,n) => { const d = D(s); d.setDate(d.getDate()+n); return iso(d); };
const fmtDate = PI.fmtDate = s => { const d = D(s); return d.getDate() + ' ' + MOIS[d.getMonth()] + ' ' + d.getFullYear(); };
const fmtE = PI.fmtE = kwh => Math.abs(kwh) >= 10000 ? nf1.format(kwh/1000) + ' MWh' : nf0.format(kwh) + ' kWh';
const qOf = PI.qOf = k => k.slice(0,4) + '-T' + (Math.floor((+k.slice(5,7)-1)/3)+1);
const qBounds = q => { const y = +q.slice(0,4), t = +q.slice(-1); return [`${y}-${String(3*t-2).padStart(2,'0')}-01`, iso(new Date(y, 3*t, 0, 12))]; };
const prevYearDate = k => { const d = D(k); d.setFullYear(d.getFullYear()-1); return iso(d); };
const el = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

let DATA, PLANT = {}, INV = {}, FIRST, LAST;
const charts = PI.charts = {};
const S = {view:'home', hc:'30', hcCmp:false, hr:'q', pc:'30', pcCmp:false, pcExp:false, pcMa:false, pcFrom:null, pcTo:null, iv:'30', day:null};

/* ---------- outils ---------- */
PI.makeChart = (id, cfg) => { if (charts[id]) charts[id].destroy(); charts[id] = new Chart(el(id), cfg); return charts[id]; };
PI.toast = msg => { const t = el('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(PI._tt); PI._tt = setTimeout(()=>t.classList.remove('on','interactive'), 2400); };
PI.countUp = function(node, target, fmt, html){
  const set = v => html ? node.innerHTML = fmt(v) : node.textContent = fmt(v);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { set(target); return; }
  const t0 = performance.now(), dur = 800;
  const step = t => { const p = Math.min(1,(t-t0)/dur), e = 1-Math.pow(1-p,3); set(target*e); if (p<1) requestAnimationFrame(step); else set(target); };
  requestAnimationFrame(step);
};
PI.baseOpts = function(unit, extra){
  const o = {
    responsive:true, maintainAspectRatio:false, animation:{duration:500,easing:'easeOutCubic'},
    interaction:{mode:'index',intersect:false},
    plugins:{legend:{display:false},
      tooltip:{backgroundColor:css('--ink'),titleColor:css('--bg'),bodyColor:css('--bg'),padding:11,cornerRadius:10,boxWidth:12,boxHeight:3,titleFont:{weight:'700'},bodyFont:{weight:'500'},
        callbacks:{label:c => ' ' + (c.dataset.label ? c.dataset.label + ' : ' : '') + (c.parsed.y==null ? '–' : (unit==='ct'?nf2:nf0).format(c.parsed.y) + ' ' + (unit==='ct'?'ct/kWh':unit))}}},
    scales:{
      x:{grid:{display:false},border:{display:false},ticks:{color:css('--muted'),maxRotation:0,autoSkip:true,autoSkipPadding:16,font:{size:11}}},
      y:{grid:{color:css('--grid')},border:{display:false},beginAtZero:true,ticks:{color:css('--muted'),font:{size:11},maxTicksLimit:6,callback:v=>nf0.format(v)}}
    }
  };
  return extra ? (extra(o) || o) : o;
};
const bars = (label, data, color, extra) => Object.assign({label, data, backgroundColor:color, borderRadius:{topLeft:5,topRight:5}, borderSkipped:'bottom', maxBarThickness:44, categoryPercentage:.85, barPercentage:.9, order:2}, extra||{});
const line = (label, data, color, dash) => ({label, type:'line', data, borderColor:color, backgroundColor:color, borderWidth:2.2, pointRadius: data.length > 40 ? 0 : 3, pointHoverRadius:5, tension:.3, order:1, spanGaps:false, borderDash:dash||[]});
function setChips(id, val){ document.querySelectorAll('#' + id + ' button').forEach(b => b.setAttribute('aria-pressed', (b.dataset.r || b.dataset.s) === val)); }
function onChips(id, fn){ el(id).addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.disabled) fn(b.dataset.r || b.dataset.s, b); }); }

/* ---------- thème ---------- */
try { const t = localStorage.getItem('pi-theme'); if (t) document.documentElement.dataset.theme = t; } catch(e){}
el('themeBtn').onclick = () => {
  const cur = document.documentElement.dataset.theme;
  const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('pi-theme', document.documentElement.dataset.theme); } catch(e){}
  renderView(); if (PI.finRender) PI.finRender();
};

/* ---------- chargement ---------- */
Promise.all([fetch('data/production.json',{cache:'no-store'}).then(r=>r.json()), PI.store ? PI.store.load().catch(e => { console.warn(e); return []; }) : []]).then(([d]) => {
  DATA = PI.DATA = d;
  d.daily.forEach(([k,v]) => { if (k < d.updated && v != null) PLANT[k] = v; });            // jours complets uniquement
  (d.inverters||[]).forEach(inv => { const m = {}; inv.daily.forEach((v,i) => { const k = addDays(inv.start,i); if (k < d.updated && v != null) m[k] = v; }); INV[inv.id] = m; });
  PI.PLANT = PLANT; PI.INV = INV;
  const keys = Object.keys(PLANT).sort(); FIRST = PI.FIRST = keys[0]; LAST = PI.LAST = keys[keys.length-1];
  applyEntries();
  el('updTop').textContent = 'Données au ' + fmtDate(LAST);
  el('foot').textContent = 'Sources : Aurora Vision / FIMER (production journalière et par onduleur depuis le ' + fmtDate(FIRST) + ') · relevés de compteur et montants des factures du GRD (onglet Saisie). Mise à jour Aurora : ' + fmtDate(d.updated) + '.';
  ['pcFrom','pcTo'].forEach(id => { el(id).min = '2023-01-01'; el(id).max = LAST; });
  readHash(); wire();
  document.dispatchEvent(new CustomEvent('pi:data'));
  setView(S.view, true);
}).catch(err => { console.error(err); el('homeKpis').textContent = 'Les données n\'ont pas pu être chargées.'; });

/* ---------- saisies → relevés de compteur ---------- */
function applyEntries(){ if (PI.derive && PI.store && PI.store.entries.length) { const r = PI.derive(); DATA.meterQuarters = r.meterQuarters; PI.ENTRY = r; } }
PI.onEntriesChanged = function(){ if (!DATA) return; applyEntries(); EXP = null; PI._dayMap = null; renderView(); if (PI.finRender) PI.finRender(); if (PI.renderChecks) PI.renderChecks(); };

/* ---------- calcul unique de la production sur une période ----------
   Trimestre entièrement inclus et relevé → relevé de compteur ; sinon jours Aurora ; sinon part du relevé au prorata (estimation). */
function prodBetween(from, to){
  // 1) factures GRD entièrement comprises dans la période (valeur officielle du compteur)
  // 2) jours Aurora pour le reste  3) sinon part au prorata d'une facture (estimation, signalée)
  let kwh = 0, est = false; const covered = new Set();
  const inv = (PI.store && PI.store.entries.length) ? PI.store.entries.filter(e => e.type === 'grd') :
    Object.keys(DATA.meterQuarters).map(q => { const [f,t] = qBounds(q); return {from:f, to:t, kwhHT:DATA.meterQuarters[q], kwhBT:0}; });
  inv.forEach(e => { const t = e.to || e.from; if (e.from >= from && t <= to) { kwh += (+e.kwhHT||0) + (+e.kwhBT||0); for (let k = e.from; k <= t; k = addDays(k,1)) covered.add(k); } });
  const missing = [];
  for (let k = from; k <= to; k = addDays(k,1)) { if (covered.has(k)) continue; if (k in PLANT) kwh += PLANT[k]; else if (k <= LAST) missing.push(k); }
  if (missing.length) inv.forEach(e => { const t = e.to || e.from, n = missing.filter(k => k >= e.from && k <= t).length;
    if (n) { const days = (D(t) - D(e.from))/864e5 + 1; kwh += ((+e.kwhHT||0) + (+e.kwhBT||0)) * n / days; est = true; } });
  return {kwh, est};
}
PI.prodBetween = prodBetween;
PI.quarterMap = function(){
  const q = {...DATA.meterQuarters}, live = new Set(), aq = {};
  Object.entries(PLANT).forEach(([k,v]) => { const key = qOf(k); aq[key] = (aq[key]||0) + v; });
  Object.keys(aq).forEach(k => { if (!(k in q)) { q[k] = aq[k]; live.add(k); } });
  return {q, live};
};

/* ---------- production attendue ---------- */
PI.refYears = function(){ const mq = DATA.meterQuarters, ys = {}; Object.keys(mq).forEach(k => { const y = k.slice(0,4); ys[y] = (ys[y]||0) + 1; }); return Object.keys(ys).filter(y => ys[y] === 4).sort().slice(-2); };
let EXP = null;
function buildExpected(){
  const refs = PI.refYears(), mq = DATA.meterQuarters, qAvg = {};
  [1,2,3,4].forEach(t => qAvg[t] = refs.reduce((a,y) => a + (mq[y+'-T'+t]||0), 0) / Math.max(1, refs.length));
  const msum = {}, mn = {}; Object.entries(PLANT).forEach(([k,v]) => { const m = k.slice(0,7); msum[m] = (msum[m]||0) + v; mn[m] = (mn[m]||0) + 1; });
  const mon = {}, cnt = {};
  Object.keys(msum).forEach(m => { const y = +m.slice(0,4), mo = +m.slice(5,7); if (mn[m] >= new Date(y, mo, 0).getDate() - 1) { mon[mo] = (mon[mo]||0) + msum[m]; cnt[mo] = (cnt[mo]||0) + 1; } });
  const share = {};
  [1,2,3,4].forEach(t => { const ms = [3*t-2,3*t-1,3*t], v = ms.map(m => cnt[m] ? mon[m]/cnt[m] : null); const ok = v.every(x => x != null), tot = ok ? v.reduce((a,b)=>a+b,0) : 0;
    ms.forEach((m,i) => share[m] = ok ? v[i]/tot : 1/3); });
  const invShare = {}; Object.keys(INV).forEach(id => { let a = 0, b = 0; Object.keys(INV[id]).forEach(k => { a += INV[id][k]; b += PLANT[k] || 0; }); invShare[id] = b ? a/b : 0; });
  const fa = PI.finAssump && PI.finAssump();
  EXP = {qAvg, share, invShare, deg: fa && fa.degradation != null ? fa.degradation : 0.005, lastRef: +refs[refs.length-1] || 2025};
}
PI.expectedDay = function(k, inv){
  if (!EXP) buildExpected();
  const y = +k.slice(0,4), m = +k.slice(5,7), t = Math.floor((m-1)/3)+1, days = new Date(y, m, 0).getDate();
  let v = EXP.qAvg[t] * EXP.share[m] / days * Math.pow(1 - EXP.deg, Math.max(0, y - EXP.lastRef));
  if (inv && inv !== 'all') v *= EXP.invShare[inv] || 0;
  return v;
};
PI.yearEndForecast = function(){
  const yy = LAST.slice(0,4), act = prodBetween(yy + '-01-01', LAST).kwh;
  let rest = 0; for (let k = addDays(LAST,1); k <= yy + '-12-31'; k = addDays(k,1)) rest += PI.expectedDay(k);
  return {yy, actual:act, rest, total:act + rest};
};

/* ---------- revenus (factures) ---------- */
function revenueByQuarter(){
  const r = PI.ENTRY || (PI.derive ? PI.derive() : null) || {revenueActual:{}, meterQuarters:{}, otherRevenue:{}};
  return Object.keys(r.revenueActual).sort().map(q => ({q, rev:r.revenueActual[q], kwh:r.meterQuarters[q] || 0, other:(r.otherRevenue||{})[q] || 0}));
}

/* ---------- séries pour les graphiques ---------- */
function series(range, from, to){
  // renvoie {labels, keys, vals, prev, exp, gran, title, from, to, partialLast}
  const mk = (gran, f, t) => {
    const keys = [], vals = [], prev = [], exp = [];
    if (gran === 'day') for (let k = f; k <= t; k = addDays(k,1)) { keys.push(k); vals.push(PLANT[k] ?? null); const p = prevYearDate(k); prev.push(PLANT[p] ?? null); exp.push(PI.expectedDay(k)); }
    else if (gran === 'week') { let k = f; const d0 = D(k); k = addDays(k, -((d0.getDay()+6)%7));
      for (; k <= t; k = addDays(k,7)) { const e = addDays(k,6); const a = k < f ? f : k, b = e > t ? t : e; keys.push(k);
        let s = 0, ps = 0, pn = 0, ex = 0, n = 0; for (let x = a; x <= b; x = addDays(x,1)) { if (x in PLANT) { s += PLANT[x]; n++; } const p = prevYearDate(x); if (p in PLANT) { ps += PLANT[p]; pn++; } ex += PI.expectedDay(x); }
        vals.push(n ? s : null); prev.push(pn === n && n ? ps : null); exp.push(ex); } }
    else if (gran === 'month') { let y = +f.slice(0,4), m = +f.slice(5,7);
      while (`${y}-${String(m).padStart(2,'0')}` <= t.slice(0,7)) { const ms = `${y}-${String(m).padStart(2,'0')}-01`, me = iso(new Date(y, m, 0, 12));
        const a = ms < f ? f : ms, b = me > t ? t : me; keys.push(ms.slice(0,7));
        vals.push(prodBetween(a, b).kwh); const pa = prevYearDate(a), pb = prevYearDate(b);
        const pp = pa >= '2023-01-01' ? prodBetween(pa, pb) : null; prev.push(pp && !pp.est && pp.kwh ? pp.kwh : null);
        let ex = 0; for (let x = a; x <= b; x = addDays(x,1)) ex += PI.expectedDay(x); exp.push(ex);
        if (++m > 12) { m = 1; y++; } } }
    return {keys, vals, prev, exp, gran, from:f, to:t};
  };
  let r;
  if (range === '7') r = mk('day', addDays(LAST,-6), LAST);
  else if (range === '30') r = mk('day', addDays(LAST,-29), LAST);
  else if (range === '90') r = mk('week', addDays(LAST,-89), LAST);
  else if (range === '12m') { const d = D(LAST); const f = iso(new Date(d.getFullYear(), d.getMonth()-11, 1, 12)); r = mk('month', f, LAST); }
  else if (range === 'ytd') r = mk('month', LAST.slice(0,4) + '-01-01', LAST);
  else if (range === 'custom') { const f = from || addDays(LAST,-29), t = to || LAST, n = (D(t)-D(f))/864e5 + 1; r = mk(n <= 62 ? 'day' : n <= 200 ? 'week' : 'month', f, t); }
  else if (range === 'q') { const {q} = PI.quarterMap(); const ks = Object.keys(q).sort(); r = {keys:ks, vals:ks.map(k => q[k]), prev:ks.map(k => { const p = (+k.slice(0,4)-1) + k.slice(4); return q[p] ?? null; }), exp:ks.map(()=>null), gran:'quarter'}; }
  else { const {q} = PI.quarterMap(), ys = {}; Object.keys(q).forEach(k => { const y = k.slice(0,4); ys[y] = (ys[y]||0) + q[k]; }); const ks = Object.keys(ys).sort(); r = {keys:ks, vals:ks.map(y => ys[y]), prev:ks.map(()=>null), exp:ks.map(()=>null), gran:'year'}; }
  if (!r.from) { if (r.gran === 'month') { r.from = r.keys[0] + '-01'; } else r.from = r.keys[0]; r.to = LAST; }
  r.labels = r.keys.map(k => r.gran === 'day' ? (D(k).getDate() + ' ' + MOIS[D(k).getMonth()]) : r.gran === 'week' ? 'sem. ' + D(k).getDate() + ' ' + MOIS[D(k).getMonth()]
    : r.gran === 'month' ? MOIS[+k.slice(5,7)-1] + ' ' + k.slice(2,4) : r.gran === 'quarter' ? k.replace('-T',' T') : k);
  const curY = LAST.slice(0,4), curM = LAST.slice(0,7);
  r.partial = r.keys.map(k => (r.gran === 'year' && k === curY) || (r.gran === 'month' && k === curM && LAST < iso(new Date(+curM.slice(0,4), +curM.slice(5,7), 0, 12))) || (r.gran === 'quarter' && k === qOf(LAST) && LAST < qBounds(k)[1]));
  if (r.gran === 'year') r.labels = r.labels.map((l,i) => r.partial[i] ? l + ' (à ce jour)' : l);
  r.vals = r.vals.map(v => v == null ? null : Math.round(v)); r.prev = r.prev.map(v => v == null ? null : Math.round(v)); r.exp = r.exp.map(v => v == null ? null : Math.round(v));
  return r;
}
function prodChart(canvasId, r, opts){
  const sun = css('--sun'), soft = css('--sun-2');
  const ds = [bars('Production', r.vals, r.partial.map(p => p ? soft : sun), {hoverBackgroundColor:css('--sun-2')})];
  if (opts.cmp && r.prev.some(v => v != null)) ds.push(line('Année précédente', r.prev, css('--s1')));
  if (opts.exp) ds.push(line('Attendu', r.exp, css('--s3'), [4,4]));
  if (opts.ma) { const w = r.gran === 'day' ? 7 : r.gran === 'week' ? 4 : 3; ds.push(line('Moyenne glissante', r.vals.map((_,i) => { if (i < w-1) return null; const sl = r.vals.slice(i-w+1, i+1); return sl.some(v => v == null) ? null : Math.round(sl.reduce((a,b)=>a+b,0)/w); }), css('--s2'))); }
  PI.makeChart(canvasId, {type:'bar', data:{labels:r.labels, datasets:ds}, options:PI.baseOpts('kWh', o => {
    o.plugins.tooltip.callbacks.afterBody = items => { const i = items[0].dataIndex, out = [];
      if (r.partial[i]) out.push('Période en cours');
      if (opts.exp && r.vals[i] != null && r.exp[i]) out.push(nf0.format(r.vals[i]/r.exp[i]*100) + ' % de l\'attendu');
      if (opts.cmp && r.vals[i] != null && r.prev[i]) out.push((r.vals[i] >= r.prev[i] ? '+' : '') + nf1.format((r.vals[i]/r.prev[i]-1)*100) + ' % vs année précédente');
      return out; };
  })});
}
function legendHtml(r, opts){
  const p = []; const hasPrev = r.prev.some(v => v != null);
  if (opts.cmp || opts.exp) p.push('<span><i style="background:var(--sun)"></i>Production</span>');
  if (opts.cmp && hasPrev) p.push('<span><i class="ln" style="background:var(--s1)"></i>Année précédente</span>');
  if (opts.cmp && !hasPrev) p.push('<span style="color:var(--muted)">Pas de données de l\'année précédente pour cette vue</span>');
  if (opts.exp) p.push('<span><i class="ln" style="background:var(--s3)"></i>Attendu</span>');
  if (opts.ma) p.push('<span><i class="ln" style="background:var(--s2)"></i>Moyenne glissante</span>');
  if (r.partial.some(Boolean)) p.push('<span><i style="background:var(--sun-2)"></i>En cours</span>');
  return p.join('');
}
function summaryHtml(r){
  const vals = r.vals.filter(v => v != null);
  if (r.gran === 'quarter' || r.gran === 'year') { const tot = vals.reduce((a,b)=>a+b,0); return `<span>Total depuis la mise en service <b>${fmtE(tot)}</b></span><span>Les relevés de compteur du GRD font foi ; le trimestre en cours vient d'Aurora Vision.</span>`; }
  const f = r.from, t = r.to, cur = prodBetween(f, t);
  const parts = [`Du ${fmtDate(f)} au ${fmtDate(t)} : <b>${fmtE(cur.kwh)}</b>`];
  if (r.gran === 'day') { const i = r.vals.indexOf(Math.max(...vals)); parts.push(`Moyenne <b>${nf0.format(cur.kwh/vals.length)} kWh/jour</b>`, `Meilleur jour <b>${nf0.format(r.vals[i])} kWh</b> (${fmtDate(r.keys[i])})`); }
  let ex = 0; for (let k = f; k <= t; k = addDays(k,1)) ex += PI.expectedDay(k);
  parts.push(`<b>${nf0.format(cur.kwh/ex*100)} %</b> de la production attendue`);
  const pf = prevYearDate(f), pt = prevYearDate(t);
  if (pf >= '2023-04-01') { const pv = prodBetween(pf, pt); if (pv.kwh) parts.push(`<b>${cur.kwh >= pv.kwh ? '+' : ''}${nf1.format((cur.kwh/pv.kwh-1)*100)} %</b> par rapport à la même période ${pf.slice(0,4) === pt.slice(0,4) ? pf.slice(0,4) : 'de l\'année précédente'} (${fmtE(pv.kwh)}${pv.est ? ', en partie estimé' : ''})`); }
  if (cur.est) parts.push('<span style="color:var(--muted)">valeur en partie estimée</span>');
  const sb = vals.reduce((x,y)=>x+y,0); if (r.gran === 'month' && Math.abs(sb - cur.kwh) / cur.kwh > 0.002) parts.push(`<span style="color:var(--muted)">Total selon les relevés du compteur ; les barres mensuelles viennent d'Aurora Vision (${fmtE(sb)}, écart ${nf1.format(Math.abs(sb/cur.kwh-1)*100)} %)</span>`);
  return parts.map(x => '<span>' + x + '</span>').join('');
}

/* ---------- ACCUEIL ---------- */
function renderHome(){
  const yy = LAST.slice(0,4), py = String(+yy - 1);
  const cur = prodBetween(yy + '-01-01', LAST), prv = prodBetween(py + '-01-01', prevYearDate(LAST));
  const dP = prv.kwh ? cur.kwh/prv.kwh - 1 : null;
  const rq = revenueByQuarter(), curQ = rq.filter(x => x.q.startsWith(yy)), prvQ = rq.filter(x => x.q.startsWith(py) && curQ.some(c => c.q.slice(4) === x.q.slice(4)));
  const rc = curQ.reduce((a,x)=>a+x.rev+x.other,0), rp = prvQ.reduce((a,x)=>a+x.rev+x.other,0), dR = rp ? rc/rp - 1 : null;
  const qTxt = curQ.length ? 'factures ' + (curQ.length === 1 ? curQ[0].q.slice(5) : curQ[0].q.slice(5) + '–' + curQ[curQ.length-1].q.slice(5)) + ' ' + yy : 'aucune facture saisie';
  const F = PI.finModel ? PI.finModel() : null;
  const trend = d => d == null ? '' : `<span class="trend ${Math.abs(d) < 0.02 ? 'flat' : d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${nf1.format(Math.abs(d*100))} %</span>`;
  const yday = PLANT[LAST], yexp = PI.expectedDay(LAST);
  const checks = PI.runChecks ? PI.runChecks() : [], nWarn = checks.filter(x => x.sev !== 'info').length, alarms = (DATA.events && DATA.events.active) || 0;
  const pct = F ? Math.min(1, F.revToDate / F.cost) : 0;
  const cards = [
    {k:'Électricité produite en ' + yy, v:nf1.format(cur.kwh/1000) + '<small>MWh</small>', d:`${trend(dP)} vs même date en ${py}`, accent:true},
    {k:'Revenus ' + yy + ' encaissés', v:nf0.format(rc) + '<small>CHF</small>', d:`${trend(dR)} ${qTxt}${prvQ.length ? ' vs mêmes trimestres ' + py : ''}`},
    {k:'Installation remboursée', v:nf0.format(pct*100) + '<small>%</small>', d: F ? `reste ${nf0.format(Math.max(0, F.cost - F.revToDate))} CHF · terminé vers ${F.payback ? 'T' + F.payback.t + ' ' + F.payback.y : '–'}` : '', bar:pct},
    {k:'État de l\'installation', v:`<span class="status"><span class="dot ${alarms ? 'bad' : ''}"></span>${alarms ? 'Alarme' : 'En service'}</span>`,
      d:`Hier : <b>${nf0.format(yday)} kWh</b> (${nf0.format(yday/yexp*100)} % de l'attendu) · ${alarms ? alarms + ' alarme(s) active(s)' : 'aucune alarme'}`},
  ];
  el('homeKpis').innerHTML = cards.map(c => `<div class="kpi${c.accent?' accent':''}"><div class="k">${c.k}</div><div class="v num">${c.v}</div><div class="d">${c.d}</div>${c.bar != null ? `<div class="bar"><i style="width:${c.bar*100}%"></i></div>` : ''}</div>`).join('');
  el('homeLead').textContent = nf2.format(DATA.plant.kwp) + ' kWc · Ch. des Prairies 12, Bulle · en service depuis juin 2023 · données au ' + fmtDate(LAST);
  // graphique production
  setChips('hcRange', S.hc); el('hcCmp').checked = S.hcCmp; el('hcCmp').closest('label').classList.toggle('hidden', S.hc === 'years');
  const r = series(S.hc); const o = {cmp:S.hcCmp && S.hc !== 'years', exp:false};
  prodChart('cHome', r, o); el('hcLegend').innerHTML = legendHtml(r, o); el('hcSum').innerHTML = summaryHtml(r);
  el('hcSub').textContent = {7:'7 derniers jours', 30:'30 derniers jours', '12m':'12 derniers mois', years:'Total par année'}[S.hc] + ' · kWh';
  // revenus
  setChips('hrRange', S.hr);
  let labels, vals, kw, oth;
  if (S.hr === 'q') { labels = rq.map(x => x.q.replace('-T',' T')); vals = rq.map(x => Math.round(x.rev)); kw = rq.map(x => x.kwh); oth = rq.map(x => x.other); }
  else { const ys = {}; rq.forEach(x => { const y = x.q.slice(0,4); (ys[y] = ys[y] || {rev:0, kwh:0, other:0, n:0}); ys[y].rev += x.rev; ys[y].kwh += x.kwh; ys[y].other += x.other; ys[y].n++; });
    const ks = Object.keys(ys).sort(); labels = ks.map(y => y + (ys[y].n < 4 ? ' (' + ys[y].n + ' trim.)' : '')); vals = ks.map(y => Math.round(ys[y].rev)); kw = ks.map(y => ys[y].kwh); oth = ks.map(y => ys[y].other); }
  const ds = [bars('Électricité', vals, css('--sun'))];
  if (oth.some(Boolean)) ds.push(bars('Indemnité / autre', oth.map(Math.round), css('--s3'), {stack:'r'})), ds[0].stack = 'r';
  PI.makeChart('cHomeRev', {type:'bar', data:{labels, datasets:ds}, options:PI.baseOpts('CHF', o => {
    o.scales.x.stacked = true; o.scales.y.stacked = true;
    if (ds.length > 1) o.plugins.legend = {display:true, position:'top', align:'end', labels:{boxWidth:10, boxHeight:10, color:css('--ink-2'), font:{size:11, weight:'600'}}};
    o.plugins.tooltip.callbacks.afterBody = it => { const i = it[0].dataIndex; return kw[i] ? [nf0.format(kw[i]) + ' kWh vendus', 'Prix moyen : ' + nf2.format(vals[i]/kw[i]*100) + ' ct/kWh'] : []; }; })});
  const tot = rq.reduce((a,x)=>a+x.rev+x.other,0), tk = rq.reduce((a,x)=>a+x.kwh,0), trev = rq.reduce((a,x)=>a+x.rev,0);
  const last = rq[rq.length-1];
  el('hrSum').innerHTML = `<span>Total depuis 2023 <b>${nf0.format(tot)} CHF</b></span><span>Prix moyen <b>${nf2.format(trev/tk*100)} ct/kWh</b></span>` +
    (last ? `<span>Dernière facture <b>${last.q.replace('-T',' T')}</b> : ${nf0.format(last.rev)} CHF à ${nf2.format(last.rev/last.kwh*100)} ct/kWh</span>` : '');
  // à vérifier
  const todo = el('homeTodo'); todo.replaceChildren();
  const top = checks.filter(x => x.sev !== 'info').slice(0,4);
  if (!top.length) todo.innerHTML = '<div class="it"><span class="ic ok">✓</span><div><b>Rien à signaler</b><span>Les factures, la production et les onduleurs sont cohérents.</span></div></div>';
  top.forEach(x => { const d = document.createElement('div'); d.className = 'it';
    d.innerHTML = `<span class="ic ${x.sev === 'erreur' ? 'err' : ''}">${x.sev === 'erreur' ? '✕' : '!'}</span><div><b></b><span></span></div>`;
    d.querySelector('b').textContent = x.title + (x.period ? ' · ' + x.period : ''); d.querySelector('span:last-child').textContent = x.detail || ''; todo.appendChild(d); });
  const nInfo = checks.length - top.length; if (nWarn > top.length || nInfo) { const p = document.createElement('div'); p.className = 'note'; p.textContent = (nWarn > top.length ? (nWarn - top.length) + ' autre(s) point(s) à vérifier · ' : '') + (nInfo ? nInfo + ' information(s)' : ''); todo.appendChild(p); }
  const next = PI.nextExpected ? PI.nextExpected() : null;
  if (next && next.period) { const d = document.createElement('div'); d.className = 'it';
    d.innerHTML = '<span class="ic" style="background:var(--s1)">i</span><div><b></b><span></span></div>'; d.querySelector('b').textContent = 'Prochaine facture : ' + next.label; d.querySelector('span:last-child').textContent = next.sub;
    const btn = document.createElement('button'); btn.className = 'link'; btn.type = 'button'; btn.textContent = 'Saisir'; btn.style.marginLeft = 'auto'; btn.onclick = () => PI.openForm && PI.openForm({type:'grd'}); d.appendChild(btn);
    todo.appendChild(d); }
}

/* ---------- PRODUCTION ---------- */
function renderProd(){
  setChips('pcRange', S.pc);
  const noCmp = S.pc === 'years', noExp = S.pc === 'q' || S.pc === 'years';
  el('pcCmpWrap').classList.toggle('hidden', noCmp); el('pcExpWrap').classList.toggle('hidden', noExp); el('pcMaWrap').classList.toggle('hidden', noExp);
  el('pcCmp').checked = S.pcCmp; el('pcExp').checked = S.pcExp; el('pcMa').checked = S.pcMa;
  el('pcDates').classList.toggle('hidden', S.pc !== 'custom');
  if (S.pc === 'custom') { el('pcFrom').value = S.pcFrom || addDays(LAST,-29); el('pcTo').value = S.pcTo || LAST; }
  const r = series(S.pc, S.pcFrom, S.pcTo); const o = {cmp:S.pcCmp && !noCmp, exp:S.pcExp && !noExp, ma:S.pcMa && !noExp};
  if (S.pc === 'q') o.cmp = S.pcCmp;
  prodChart('cProd', r, o); el('pcLegend').innerHTML = legendHtml(r, o); el('pcSum').innerHTML = summaryHtml(r);
  const g = {day:'par jour', week:'par semaine', month:'par mois', quarter:'par trimestre', year:'par année'}[r.gran];
  el('pcTitle').textContent = 'Production ' + g;
  el('pcSub').textContent = (r.gran === 'day' || r.gran === 'week' || r.gran === 'month') ? fmtDate(r.gran === 'month' ? r.keys[0] + '-01' : r.keys[0]) + ' → ' + fmtDate(LAST < (r.keys[r.keys.length-1]+'-28') || r.gran !== 'month' ? (S.pc === 'custom' ? (S.pcTo || LAST) : LAST) : LAST) + ' · kWh'
    : 'Relevés de compteur, complétés par Aurora Vision pour la période en cours · kWh';
  renderProdKpis(); renderInverters(); renderDay(); heatmap(); renderYears(); renderWeather();
}
function renderProdKpis(){
  const ye = PI.yearEndForecast(), kwp = DATA.plant.kwp;
  const f12 = addDays(LAST,-364), p12 = prodBetween(f12, LAST).kwh;
  const ks = Object.keys(PLANT).sort(); let best = ks[0]; ks.forEach(k => { if (PLANT[k] > PLANT[best]) best = k; });
  const mon = {}; ks.forEach(k => { const m = k.slice(0,7); mon[m] = (mon[m]||0) + PLANT[k]; });
  const full = Object.keys(mon).filter(m => ks.filter(k => k.startsWith(m)).length >= new Date(+m.slice(0,4), +m.slice(5,7), 0).getDate() - 1);
  const bm = full.reduce((a,m) => mon[m] > (mon[a]||0) ? m : a, full[0]);
  let bw = null, bwv = 0; for (let i = 0; i + 6 < ks.length; i++) { let s = 0; for (let j = 0; j < 7; j++) s += PLANT[ks[i+j]]; if (s > bwv) { bwv = s; bw = ks[i]; } }
  const help = t => `<span class="help" tabindex="0" data-tip="${esc(t)}">?</span>`;
  const cards = [
    ['Prévision fin ' + ye.yy, nf1.format(ye.total/1000) + '<small>MWh</small>', nf1.format(ye.actual/1000) + ' MWh déjà produits + ' + nf1.format(ye.rest/1000) + ' MWh attendus d\'ici le 31 décembre'],
    ['Productible sur 365 jours ' + help('kWh produits par kWc installé sur les 365 derniers jours. En Suisse romande, une bonne installation fait environ 950 à 1 150 kWh/kWc par an.'), nf0.format(p12/kwp) + '<small>kWh/kWc</small>', nf1.format(p12/1000) + ' MWh du ' + fmtDate(f12) + ' au ' + fmtDate(LAST)],
    ['Équivalent ménages ' + help('Production des 365 derniers jours divisée par la consommation d\'un ménage moyen (hypothèse : 4 500 kWh par an).'), nf0.format(p12/4500) + '<small>ménages</small>', 'consommation annuelle couverte (4 500 kWh/ménage)'],
    ['Meilleur jour', nf0.format(PLANT[best]) + '<small>kWh</small>', fmtDate(best) + ' · depuis le début du suivi en ligne'],
    ['Meilleure semaine', nf1.format(bwv/1000) + '<small>MWh</small>', bw ? 'du ' + fmtDate(bw) + ' au ' + fmtDate(addDays(bw,6)) : ''],
    ['Meilleur mois', bm ? nf1.format(mon[bm]/1000) + '<small>MWh</small>' : '–', bm ? MOISL[+bm.slice(5,7)-1] + ' ' + bm.slice(0,4) : ''],
  ];
  el('prodKpis').innerHTML = cards.map(([k,v,d]) => `<div class="kpi"><div class="k">${k}</div><div class="v num">${v}</div><div class="d">${d}</div></div>`).join('');
}
function renderInverters(){
  setChips('ivRange', S.iv);
  const ids = ['PVS-100','PVS-30'].filter(id => INV[id]); if (!ids.length) return;
  const meta = Object.fromEntries((DATA.inverters||[]).map(x => [x.id, x])), col = {'PVS-100':css('--s1'),'PVS-30':css('--s2')};
  const f = S.iv === '30' ? addDays(LAST,-29) : S.iv === '12m' ? addDays(LAST,-364) : FIRST;
  const tot = {}; ids.forEach(id => { tot[id] = 0; for (let k = f; k <= LAST; k = addDays(k,1)) tot[id] += INV[id][k] || 0; });
  const sum = ids.reduce((a,id)=>a+tot[id],0);
  el('invTiles').innerHTML = ids.map(id => `<div class="inv" style="--c:${col[id]}"><div class="t">${esc(id)} · ${meta[id].kw} kW</div><strong class="num">${fmtE(tot[id])}</strong><em>${nf0.format(sum ? tot[id]/sum*100 : 0)} % de la production</em></div>`).join('');
  const gran = S.iv === '30' ? 'day' : 'month';
  const keys = [], a = [], b = [];
  if (gran === 'day') for (let k = f; k <= LAST; k = addDays(k,1)) { keys.push(D(k).getDate() + ' ' + MOIS[D(k).getMonth()]); a.push(INV['PVS-100'][k] ?? null); b.push(INV['PVS-30'][k] ?? null); }
  else { const m = {}; for (let k = f; k <= LAST; k = addDays(k,1)) { const mm = k.slice(0,7); (m[mm] = m[mm] || [0,0]); m[mm][0] += INV['PVS-100'][k] || 0; m[mm][1] += INV['PVS-30'][k] || 0; }
    Object.keys(m).sort().forEach(mm => { keys.push(MOIS[+mm.slice(5,7)-1] + ' ' + mm.slice(2,4)); a.push(Math.round(m[mm][0])); b.push(Math.round(m[mm][1])); }); }
  PI.makeChart('cInv', {type:'bar', data:{labels:keys, datasets:[bars('PVS-100', a, col['PVS-100'], {stack:'s', borderRadius:0}), bars('PVS-30', b, col['PVS-30'], {stack:'s', borderRadius:{topLeft:5,topRight:5}})]},
    options:PI.baseOpts('kWh', o => { o.scales.x.stacked = true; o.scales.y.stacked = true; o.plugins.legend = {display:true, position:'bottom', labels:{boxWidth:10, boxHeight:10, color:css('--ink-2'), font:{size:11, weight:'600'}}}; })});
}
function renderDay(){
  const p = DATA.power15, h = DATA.hourly; if (!p) return;
  const per = 24*60/p.stepMin, nd = p.values.length/per, days = []; for (let i=0;i<nd;i++) days.push(addDays(p.start,i));
  if (!S.day || !days.includes(S.day)) S.day = days[days.length-1];
  const box = el('dyDays'); box.replaceChildren();
  days.forEach(k => { const b = document.createElement('button'); b.type = 'button'; b.dataset.r = k; b.textContent = JOURS[D(k).getDay()] + ' ' + D(k).getDate(); b.setAttribute('aria-pressed', k === S.day); box.appendChild(b); });
  const i = days.indexOf(S.day), vals = p.values.slice(i*per, (i+1)*per);
  const labels = vals.map((_,j) => { const m = j*p.stepMin; return String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0'); });
  const mx = Math.max(...vals), mi = vals.indexOf(mx), energy = PLANT[S.day] ?? (h ? h.values.slice(i*24, i*24+24).reduce((a,b)=>a+b,0) : null);
  el('dySub').textContent = fmtDate(S.day) + ' · ' + (energy != null ? nf0.format(energy) + ' kWh produits · ' : '') + 'pointe ' + nf1.format(mx) + ' kW à ' + labels[mi];
  const sun = css('--sun'), ctx = el('cDay').getContext('2d'), grad = ctx.createLinearGradient(0,0,0,200); grad.addColorStop(0, sun + '66'); grad.addColorStop(1, sun + '05');
  PI.makeChart('cDay', {type:'line', data:{labels, datasets:[{label:'Puissance', data:vals, borderColor:sun, backgroundColor:grad, fill:true, borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:.3}]},
    options:PI.baseOpts('kW', o => { o.plugins.tooltip.callbacks.label = c => ' ' + nf1.format(c.parsed.y) + ' kW'; o.scales.x.ticks.maxTicksLimit = 7; o.scales.y.ticks.callback = v => nf0.format(v) + ' kW'; })});
}
function heatmap(){
  const end = LAST, start0 = addDays(end, -364), sd = D(start0), start = addDays(start0, -((sd.getDay()+6)%7));
  const max = Math.max(...Object.values(PLANT));
  const level = v => v == null ? -1 : Math.min(5, 1 + Math.floor(v / max * 5 * 0.999));
  const heat = el('heat'), months = el('heatMonths'), tip = el('tip'); heat.replaceChildren(); months.replaceChildren();
  let lastMonth = -1;
  for (let k = start; k <= end; k = addDays(k,1)) {
    const d = D(k);
    if ((d.getDay()+6)%7 === 0) { const lab = document.createElement('span'); if (d.getMonth() !== lastMonth) { lab.textContent = MOIS[d.getMonth()]; lastMonth = d.getMonth(); } months.appendChild(lab); }
    const c = document.createElement('div'); c.className = 'c';
    if (k < start0) c.classList.add('empty');
    else { const v = PLANT[k], L = level(v); if (L < 0) c.classList.add('na'); else c.style.background = `var(--heat${L})`; c.tabIndex = 0;
      const show = () => { tip.replaceChildren(); const b = document.createElement('b'); b.textContent = v == null ? 'Pas de données' : nf0.format(v) + ' kWh';
        tip.append(b, document.createElement('br'), document.createTextNode(JOURS[d.getDay()] + ' ' + fmtDate(k)));
        if (v != null) tip.append(document.createElement('br'), document.createTextNode(nf0.format(v/PI.expectedDay(k)*100) + ' % de l\'attendu'));
        const r = c.getBoundingClientRect(); tip.style.left = Math.min(innerWidth - 180, Math.max(8, r.left - 60)) + 'px'; tip.style.top = (r.top - 70) + 'px'; tip.classList.add('on'); };
      c.addEventListener('pointerenter', show); c.addEventListener('focus', show);
      c.addEventListener('pointerleave', () => tip.classList.remove('on')); c.addEventListener('blur', () => tip.classList.remove('on'));
      c.addEventListener('click', () => { S.pc = 'custom'; S.pcFrom = addDays(k,-6) < FIRST ? FIRST : addDays(k,-6); S.pcTo = addDays(k,7) > LAST ? LAST : addDays(k,7); renderProd(); writeHash(); window.scrollTo({top:0, behavior:'smooth'}); }); }
    heat.appendChild(c);
  }
  const sc = document.querySelector('.heat-scroll'); sc.scrollLeft = sc.scrollWidth;
}
function renderYears(){
  const {q, live} = PI.quarterMap(), ys = [...new Set(Object.keys(q).map(k => k.slice(0,4)))].sort(), cols = ['--s1','--s2','--s3','--s4'].map(css);
  el('yrLegend').innerHTML = ys.map((y,i) => `<span><i style="background:${cols[i%4]}"></i>${y}${Object.keys(q).some(k => k.startsWith(y) && live.has(k)) ? ' (en cours)' : ys.filter(()=>true) && Object.keys(q).filter(k=>k.startsWith(y)).length < 4 ? ' (partiel)' : ''}</span>`).join('');
  PI.makeChart('cYears', {type:'bar', data:{labels:['Hiver (T1)','Printemps (T2)','Été (T3)','Automne (T4)'], datasets:ys.map((y,i) => bars(y, ['T1','T2','T3','T4'].map(t => q[y+'-'+t] != null ? Math.round(q[y+'-'+t]) : null), cols[i%4], {maxBarThickness:26}))}, options:PI.baseOpts('kWh')});
}
const WX = {'clear':'☀️','day-sunny':'☀️','day-cloudy':'⛅','day-cloudy-high':'🌤️','cloudy':'☁️','rain':'🌧️','showers':'🌦️','snow':'🌨️','fog':'🌫️','thunderstorm':'⛈️'};
const WXT = {'clear':'Ensoleillé','day-sunny':'Ensoleillé','day-cloudy':'Nuageux','day-cloudy-high':'Voile nuageux','cloudy':'Couvert','rain':'Pluie','showers':'Averses','snow':'Neige','fog':'Brouillard','thunderstorm':'Orage'};
function renderWeather(){
  const w = DATA.weather, e = DATA.events;
  if (w) { el('wx').innerHTML = `<div class="wx-now"><span class="ic">${WX[w.now.code]||'🌡️'}</span><div><strong class="num">${nf1.format(w.now.temp)} °C</strong><div class="sub">${esc(WXT[w.now.code]||w.now.code)} · le ${fmtDate(w.at.slice(0,10))} à ${w.at.slice(11,16)}</div></div></div>` +
    '<div class="wx-days">' + w.forecast.map(([d,c,mn,mx]) => `<div class="wx-d" title="${esc(WXT[c]||c)}"><b>${JOURS[D(d).getDay()]} ${D(d).getDate()}</b><span class="ic">${WX[c]||'🌡️'}</span>${nf0.format(mn)}° / ${nf0.format(mx)}°</div>`).join('') + '</div>'; el('wxSub').textContent = 'Prévisions à 6 jours · source Aurora Vision'; }
  if (e) {
    el('evStatus').innerHTML = e.active ? `<span class="pill" style="background:#dc262622;color:var(--bad)">${e.active} alarme(s) active(s)</span>` : '<span class="pill">● Aucune alarme active</span>';
    el('evSub').textContent = e.total + ' événements depuis le ' + fmtDate(e.since) + '. La plupart surviennent au lever et au coucher du soleil (tension faible) : c\'est normal.';
    const names = Object.fromEntries(e.byCode.map(x => [x[0], x[2]]));
    el('evCodes').innerHTML = '<thead><tr><th class="l">Type d\'événement</th><th class="l">Onduleur</th><th>Gravité</th><th>Nombre</th></tr></thead><tbody>' + e.byCode.map(([c,dev,nm,sev,n]) => `<tr><td class="l">${esc(nm)} (${esc(c)})</td><td class="l">${esc(dev)}</td><td><span class="sev">${esc(sev)}</span></td><td>${n}</td></tr>`).join('') + '</tbody>';
    el('evRecent').innerHTML = '<thead><tr><th class="l">Date</th><th class="l">Événement</th><th class="l">Onduleur</th><th>Durée</th></tr></thead><tbody>' + e.recent.map(([ts, mins, dev, code]) => { const d = new Date(ts);
      return `<tr><td class="l">${d.toLocaleDateString('fr-CH',{day:'numeric',month:'short'})} ${d.toLocaleTimeString('fr-CH',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Zurich'})}</td><td class="l">${esc(names[code]||code)}</td><td class="l">${esc(dev)}</td><td>${mins < 1 ? '< 1 min' : mins < 60 ? mins + ' min' : nf1.format(mins/60) + ' h'}</td></tr>`; }).join('') + '</tbody>';
  }
}

/* ---------- navigation ---------- */
const VIEWS = ['home','prod','fin','prix','saisie','controles','rapports'];
function setView(v, initial){
  if (v === 'dash') v = 'home'; if (!VIEWS.includes(v)) v = 'home';
  S.view = v;
  document.querySelectorAll('main [data-view]').forEach(x => x.classList.toggle('hidden', x.dataset.view !== v));
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.v === v ? 'page' : 'false'));
  document.body.dataset.page = v;
  renderView();
  if (PI.renderChecks) PI.renderChecks();
  if (!initial) { writeHash(); window.scrollTo({top:0}); }
}
function renderView(){
  if (!DATA) return; EXP = null;
  const v = S.view;
  if (v === 'home') renderHome();
  if (v === 'prod') renderProd();
  if (v === 'fin' && PI.finRender) PI.finRender();
  if (v === 'saisie' && PI.renderSaisie) PI.renderSaisie();
  if (v === 'rapports' && PI.renderReportUI) PI.renderReportUI();
  if (v === 'prix' && PI.renderPrix) PI.renderPrix();
}
PI.setView = setView; PI.renderAll = renderView;
document.addEventListener('pi:fin', () => { if (S.view === 'home') renderHome(); });
function writeHash(){ const p = new URLSearchParams(); if (S.view !== 'home') p.set('v', S.view); if (S.view === 'prod') { p.set('r', S.pc); if (S.pc === 'custom') { p.set('f', S.pcFrom || ''); p.set('t', S.pcTo || ''); } }
  history.replaceState(null, '', p.toString() ? '#' + p.toString() : location.pathname); }
function readHash(){ const p = new URLSearchParams(location.hash.slice(1)); if (p.get('v')) S.view = p.get('v'); if (p.get('r')) S.pc = p.get('r'); if (p.get('f')) S.pcFrom = p.get('f'); if (p.get('t')) S.pcTo = p.get('t'); }
function wire(){
  el('tabs').onclick = e => { const b = e.target.closest('button'); if (b) setView(b.dataset.v); };
  document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => setView(b.dataset.go));
  document.querySelector('.logo').onclick = e => { e.preventDefault(); setView('home'); };
  onChips('hcRange', r => { S.hc = r; renderHome(); });
  el('hcCmp').onchange = e => { S.hcCmp = e.target.checked; renderHome(); };
  onChips('hrRange', r => { S.hr = r; renderHome(); });
  onChips('pcRange', r => { S.pc = r; renderProd(); writeHash(); });
  el('pcCmp').onchange = e => { S.pcCmp = e.target.checked; renderProd(); };
  el('pcExp').onchange = e => { S.pcExp = e.target.checked; renderProd(); };
  el('pcMa').onchange = e => { S.pcMa = e.target.checked; renderProd(); };
  ['pcFrom','pcTo'].forEach(id => el(id).onchange = () => { let f = el('pcFrom').value, t = el('pcTo').value; if (f && t && f > t) [f,t] = [t,f]; S.pcFrom = f; S.pcTo = t > LAST ? LAST : t; renderProd(); writeHash(); });
  onChips('ivRange', r => { S.iv = r; renderInverters(); });
  onChips('dyDays', r => { S.day = r; renderDay(); });
  el('csvBtn').onclick = () => {
    const rows = [['date','production_kwh','pvs100_kwh','pvs30_kwh','attendu_kwh']].concat(Object.keys(PLANT).sort().map(k => [k, PLANT[k], INV['PVS-100']?.[k] ?? '', INV['PVS-30']?.[k] ?? '', Math.round(PI.expectedDay(k))]));
    const a = Object.assign(document.createElement('a'), {href:URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.join(';')).join('\n')], {type:'text/csv'})), download:'polyimmo_production_journaliere.csv'});
    document.body.appendChild(a); a.click(); a.remove(); };
}
