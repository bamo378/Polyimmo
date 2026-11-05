/* PolyImmo Solaire — tableau de bord de production
   Données : data/production.json (Aurora Vision + relevés de compteur) */
'use strict';

/* URL publique Aurora Vision (Plant Viewer / KIOSK) — à coller quand le partage est actif */
const AURORA_PUBLIC_URL = "";

const PI = window.PI = window.PI || {};
const MOIS = PI.MOIS = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
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
const el = id => document.getElementById(id);

let DATA, PLANT = {}, INV = {}, DAY = {}, FIRST, LAST;
const state = PI.state = {view:'dash',from:null,to:null,preset:'30',gran:'day',cmp:false,exp:false,ma:false,mode:'bars',inv:'all',hourDay:null,pwDay:null,invView:'month'};
const charts = PI.charts = {};

/* ---------- utils ---------- */
PI.makeChart = (id, cfg) => { if (charts[id]) charts[id].destroy(); charts[id] = new Chart(el(id), cfg); return charts[id]; };
PI.toast = msg => { const t = el('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(PI._tt); PI._tt = setTimeout(()=>t.classList.remove('on'), 2200); };
function countUp(node, target, fmt, html){
  const set = v => html ? node.innerHTML = fmt(v) : node.textContent = fmt(v);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { set(target); return; }
  const t0 = performance.now(), dur = 900;
  const step = t => { const p = Math.min(1,(t-t0)/dur), e = 1-Math.pow(1-p,3); set(target*e); if (p<1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
PI.countUp = countUp;
PI.baseOpts = function(unit, extra){
  const grid = css('--grid'), muted = css('--muted');
  const o = {
    responsive:true, maintainAspectRatio:false, animation:{duration:600,easing:'easeOutCubic'},
    interaction:{mode:'index',intersect:false},
    plugins:{legend:{display:false},
      tooltip:{backgroundColor:css('--ink'),titleColor:css('--bg'),bodyColor:css('--bg'),padding:10,cornerRadius:10,displayColors:true,boxWidth:12,boxHeight:3,
        titleFont:{weight:'700'},bodyFont:{weight:'600'},
        callbacks:{label:c => ' ' + (c.parsed.y==null?'–':(unit==='ct'?nf2:nf0).format(c.parsed.y)) + ' ' + (unit==='ct'?'ct/kWh':unit) + '  ' + (c.dataset.label||'')}}},
    scales:{
      x:{grid:{display:false},border:{display:false},ticks:{color:muted,maxRotation:0,autoSkip:true,autoSkipPadding:14,font:{size:11}}},
      y:{grid:{color:grid},border:{display:false},beginAtZero:true,ticks:{color:muted,font:{size:11},callback:v=>nf0.format(v)}}
    }
  };
  return extra ? extra(o) || o : o;
};

/* ---------- theme ---------- */
try { const t = localStorage.getItem('pi-theme'); if (t) document.documentElement.dataset.theme = t; } catch(e){}
el('themeBtn').onclick = () => {
  const cur = document.documentElement.dataset.theme;
  const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('pi-theme', document.documentElement.dataset.theme); } catch(e){}
  renderAll(true); if (PI.finRender) PI.finRender();
};

/* ---------- load ---------- */
Promise.all([fetch('data/production.json',{cache:'no-store'}).then(r=>r.json()), PI.store ? PI.store.load().catch(e => { console.warn(e); return []; }) : []]).then(([d])=>{
  DATA = PI.DATA = d;
  applyEntries();
  d.daily.forEach(([k,v]) => { if (k < d.updated) PLANT[k] = v; });             // jour partiel exclu
  (d.inverters||[]).forEach(inv => { const m = {}; inv.daily.forEach((v,i) => { const k = addDays(inv.start,i); if (k < d.updated && v != null) m[k] = v; }); INV[inv.id] = m; });
  PI.PLANT = PLANT; PI.INV = INV;
  const keys = Object.keys(PLANT).sort(); FIRST = PI.FIRST = keys[0]; LAST = PI.LAST = keys[keys.length-1];
  ['dFrom','dTo'].forEach(id => { el(id).min = FIRST; el(id).max = LAST; });
  readHash();
  setSeries();
  if (!state.from) applyPreset(state.preset || '30', true);
  syncControls(); renderAll();
  hero(); heatmap(); hourly(); power(); weather(); events(); years(); quarters(); aurora();
  el('updatedTxt').textContent = 'Mis à jour le ' + fmtDate(d.updated) + ' · Aurora Vision';
  el('foot').textContent = 'Sources : Aurora Vision / FIMER (production journalière et par onduleur depuis le ' + fmtDate(FIRST) +
    ', horaire et quart d\'heure sur 7 jours, météo, événements) et relevés de compteur trimestriels depuis 2023. ' +
    'Équivalence ménage : 4 500 kWh/an (hypothèse). « Attendu » : moyenne des 2 dernières années complètes, répartie selon le profil mensuel observé.';
  observe();
  document.dispatchEvent(new CustomEvent('pi:data'));
  setView(state.view, true);
}).catch(err => { el('kpis').textContent = 'Données indisponibles.'; console.error(err); });

/* ---------- saisies → données de compteur ---------- */
function applyEntries(){
  if (!PI.derive || !PI.store || !PI.store.entries.length) return;
  const r = PI.derive(); DATA.meterQuarters = r.meterQuarters; PI.ENTRY = r;
}
PI.onEntriesChanged = function(){
  if (!DATA) return; applyEntries(); EXP = null; PI._dayMap = null;
  hero(); years(); quarters();
  if (state.view === 'dash') renderAll();
  if (PI.finRender) PI.finRender();
  if (PI.renderChecks) PI.renderChecks();
};

/* ---------- onglets ---------- */
function setView(v, initial){
  if (!['dash','fin','saisie','controles','rapports'].includes(v)) v = 'dash';
  state.view = v;
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('hidden', !x.dataset.view.split(' ').includes(v)));
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.v === v ? 'page' : 'false'));
  document.body.dataset.page = v;
  if (v === 'dash') { if (!initial) renderAll(); requestAnimationFrame(() => Object.values(charts).forEach(c => c.resize())); }
  if (v === 'fin' && PI.finRender) PI.finRender();
  if (v === 'saisie' && PI.renderSaisie) PI.renderSaisie();
  if (v === 'controles' && PI.renderChecks) PI.renderChecks();
  if (v === 'rapports' && PI.renderReportUI) PI.renderReportUI();
  if (PI.renderChecks && v !== 'controles') PI.renderChecks();
  document.querySelectorAll('.reveal').forEach(e => e.classList.add('in'));
  if (!initial) { writeHash(); window.scrollTo({top:0, behavior:'smooth'}); }
}
PI.setView = setView;
document.getElementById('tabs').onclick = e => { const b = e.target.closest('button'); if (b) setView(b.dataset.v); };

function setSeries(){ DAY = state.inv === 'all' ? PLANT : (INV[state.inv] || PLANT); }

/* ---------- quarters (meter + aurora) ---------- */
PI.quarterMap = function(){
  const q = {...DATA.meterQuarters}, live = new Set(), aq = {};
  DATA.daily.forEach(([k,v]) => { const key = qOf(k); aq[key]=(aq[key]||0)+v; });
  Object.keys(aq).forEach(k => { if (!(k in q)) { q[k] = aq[k]; live.add(k); } });
  return {q, live};
};

/* ---------- expected model ---------- */
// Moyenne par trimestre des 2 dernières années complètes (relevés), répartie par mois selon le profil Aurora observé
PI.refYears = function(){
  const mq = DATA.meterQuarters, ys = {};
  Object.keys(mq).forEach(k => { const y = k.slice(0,4); ys[y] = (ys[y]||0) + 1; });
  const full = Object.keys(ys).filter(y => ys[y] === 4).sort();
  return full.slice(-2);
};
let EXP = null;
function buildExpected(){
  const refs = PI.refYears(), mq = DATA.meterQuarters;
  const qAvg = {}; [1,2,3,4].forEach(t => qAvg[t] = refs.reduce((a,y) => a + (mq[y+'-T'+t]||0), 0) / refs.length);
  // profil mensuel : moyenne des mois complets Aurora
  const mon = {}, cnt = {};
  const msum = {}; Object.entries(PLANT).forEach(([k,v]) => { const m = k.slice(0,7); msum[m] = (msum[m]||0) + v; });
  Object.keys(msum).forEach(m => {
    const y = +m.slice(0,4), mo = +m.slice(5,7), days = new Date(y, mo, 0).getDate();
    const n = Object.keys(PLANT).filter(k => k.startsWith(m)).length;
    if (n >= days - 1) { mon[mo] = (mon[mo]||0) + msum[m]; cnt[mo] = (cnt[mo]||0) + 1; }
  });
  const share = {};
  [1,2,3,4].forEach(t => {
    const ms = [3*t-2, 3*t-1, 3*t]; const vals = ms.map(m => cnt[m] ? mon[m]/cnt[m] : null);
    const known = vals.filter(v => v != null); const tot = known.reduce((a,b)=>a+b,0);
    ms.forEach((m,i) => share[m] = (vals[i] != null && known.length === 3) ? vals[i]/tot : 1/3);
  });
  const invShare = {}; Object.keys(INV).forEach(id => {
    let a = 0, b = 0; Object.keys(INV[id]).forEach(k => { a += INV[id][k]; b += PLANT[k] || 0; }); invShare[id] = b ? a/b : 0; });
  const fa = PI.finAssump && PI.finAssump(); const deg = fa && fa.degradation != null ? fa.degradation : 0.005, lastRef = +refs[refs.length-1];
  EXP = {qAvg, share, invShare, refs, deg, lastRef};
}
PI.expectedDay = function(k, inv){
  if (!EXP) buildExpected();
  const y = +k.slice(0,4), m = +k.slice(5,7), t = Math.floor((m-1)/3)+1, days = new Date(y, m, 0).getDate();
  let v = EXP.qAvg[t] * EXP.share[m] / days * Math.pow(1 - EXP.deg, Math.max(0, y - EXP.lastRef));
  const id = inv || state.inv; if (id && id !== 'all') v *= EXP.invShare[id] || 0;
  return v;
};

/* ---------- hero ---------- */
function hero(){
  const {q} = PI.quarterMap();
  const total = Object.values(q).reduce((a,b)=>a+b,0);
  const yy = LAST.slice(0,4);
  const year = Object.entries(q).filter(([k])=>k.startsWith(yy)).reduce((a,[,v])=>a+v,0);
  countUp(el('hTotal'), total/1000, v => nf1.format(v) + ' MWh');
  countUp(el('hYear'), year/1000, v => nf1.format(v) + ' MWh');
  countUp(el('hYday'), PLANT[LAST], v => nf0.format(v) + ' kWh');
  el('hYearSub').textContent = yy + ' à ce jour';
  el('hYdaySub').textContent = fmtDate(LAST);
}

/* ---------- URL state (lien partageable) ---------- */
function writeHash(){
  const p = new URLSearchParams();
  if (state.view && state.view !== 'dash') p.set('v', state.view);
  if (state.preset) p.set('p', state.preset); else { p.set('f', state.from); p.set('t', state.to); }
  p.set('g', state.gran); if (state.inv !== 'all') p.set('i', state.inv);
  ['cmp','exp','ma'].forEach(k => { if (state[k]) p.set(k, 1); });
  if (state.mode !== 'bars') p.set('m', state.mode);
  history.replaceState(null, '', '#' + p.toString());
}
function readHash(){
  const h = location.hash.slice(1); if (!h || h.indexOf('=') < 0) return;
  const p = new URLSearchParams(h);
  if (p.get('v')) state.view = p.get('v');
  if (p.get('g')) state.gran = p.get('g');
  if (p.get('i') && INV[p.get('i')]) state.inv = p.get('i');
  ['cmp','exp','ma'].forEach(k => state[k] = p.get(k) === '1');
  if (p.get('m')) state.mode = p.get('m');
  if (p.get('p')) applyPreset(p.get('p'), true, true);
  else if (p.get('f') && p.get('t')) { state.from = p.get('f') < FIRST ? FIRST : p.get('f'); state.to = p.get('t') > LAST ? LAST : p.get('t'); state.preset = null; }
}
el('linkBtn').onclick = async () => {
  writeHash();
  try { await navigator.clipboard.writeText(location.href); PI.toast('Lien copié : il ouvre cette vue avec les mêmes filtres'); }
  catch(e){ PI.toast('Copiez l\'adresse de la page : elle contient vos filtres'); }
};
el('pdfBtn').onclick = () => { document.querySelectorAll('.reveal').forEach(e=>e.classList.add('in')); setTimeout(() => window.print(), 300); };

/* ---------- filters ---------- */
function applyPreset(p, silent, keepGran){
  state.preset = p;
  let from;
  if (p === 'all') from = FIRST;
  else if (p === 'ytd') from = LAST.slice(0,4) + '-01-01';
  else from = addDays(LAST, -(+p) + 1);
  if (from < FIRST) from = FIRST;
  state.from = from; state.to = LAST;
  if (!keepGran) {
    if (p === '7' || p === '30') state.gran = 'day';
    else if (p === '90' && state.gran === 'month') state.gran = 'week';
    else if ((p === '365' || p === 'all' || p === 'ytd') && state.gran === 'day') state.gran = 'week';
  }
  if (!silent) { syncControls(); renderAll(); }
}
function syncControls(){
  document.querySelectorAll('#presets button').forEach(b => b.setAttribute('aria-pressed', b.dataset.p === state.preset));
  document.querySelectorAll('#gran button').forEach(b => b.setAttribute('aria-pressed', b.dataset.g === state.gran));
  document.querySelectorAll('#invSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.i === state.inv));
  document.querySelectorAll('#mainMode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === state.mode));
  document.querySelectorAll('#invMode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === state.invView));
  el('dFrom').value = state.from; el('dTo').value = state.to;
  el('cmp').checked = state.cmp; el('exp').checked = state.exp; el('ma').checked = state.ma;
}
el('presets').onclick = e => { const b = e.target.closest('button'); if (b) applyPreset(b.dataset.p); };
el('gran').onclick = e => { const b = e.target.closest('button'); if (b) { state.gran = b.dataset.g; syncControls(); renderAll(); } };
el('invSeg').onclick = e => { const b = e.target.closest('button'); if (b) { state.inv = b.dataset.i; setSeries(); syncControls(); renderAll(); heatmap(); } };
el('mainMode').onclick = e => { const b = e.target.closest('button'); if (b) { state.mode = b.dataset.m; syncControls(); renderMain(); writeHash(); } };
el('invMode').onclick = e => { const b = e.target.closest('button'); if (b) { state.invView = b.dataset.v; syncControls(); renderInverters(); } };
['cmp','exp','ma'].forEach(id => el(id).onchange = e => { state[id] = e.target.checked; renderAll(); });
['dFrom','dTo'].forEach(id => el(id).onchange = () => {
  let f = el('dFrom').value || FIRST, t = el('dTo').value || LAST;
  if (f > t) [f,t] = [t,f];
  state.from = f < FIRST ? FIRST : f; state.to = t > LAST ? LAST : t; state.preset = null; syncControls(); renderAll();
});
el('csvBtn').onclick = () => {
  const head = ['date','production_kwh','pvs100_kwh','pvs30_kwh','attendu_kwh'];
  const rows = [head].concat(daysIn(state.from,state.to).map(k => [k, PLANT[k], INV['PVS-100']?.[k] ?? '', INV['PVS-30']?.[k] ?? '', Math.round(PI.expectedDay(k,'all'))]));
  const blob = new Blob(['﻿' + rows.map(r=>r.join(';')).join('\n')], {type:'text/csv'});
  const a = Object.assign(document.createElement('a'), {href:URL.createObjectURL(blob), download:`polyimmo_production_${state.from}_${state.to}.csv`});
  document.body.appendChild(a); a.click(); a.remove();
};

/* ---------- aggregation ---------- */
function daysIn(f,t){ const out=[]; for (let k=f; k<=t; k=addDays(k,1)) if (k in DAY) out.push(k); return out; }
PI.daysIn = daysIn;
function bucketKey(k,g){
  if (g === 'day') return k;
  if (g === 'month') return k.slice(0,7);
  const d = D(k); const wd = (d.getDay()+6)%7; d.setDate(d.getDate()-wd); return iso(d);
}
function bucketLabel(b,g){
  if (g === 'day') { const d = D(b); return d.getDate()+' '+MOIS[d.getMonth()]; }
  if (g === 'month') return MOIS[+b.slice(5,7)-1]+' '+b.slice(2,4);
  const d = D(b); return 'sem. '+d.getDate()+' '+MOIS[d.getMonth()];
}
function aggregate(f,t,g,src){
  const S = src || DAY, m = new Map();
  for (let k=f; k<=t; k=addDays(k,1)) if (k in S) { const b = bucketKey(k,g); m.set(b,(m.get(b)||0)+S[k]); }
  return [...m.entries()];
}
const prevYear = k => { const d = D(k); d.setFullYear(d.getFullYear()-1); return iso(d); };

/* ---------- render ---------- */
function renderAll(themeChange){
  document.querySelectorAll('#production .card').forEach(c=>c.classList.add('loading'));
  requestAnimationFrame(()=>{
    buildExpected();
    renderKpis(); renderMain(); renderRecords(); renderInverters(); renderAlert();
    if (themeChange) { heatmap(); hourly(); power(); years(); quarters(); }
    document.querySelectorAll('#production .card').forEach(c=>c.classList.remove('loading'));
    writeHash();
  });
}
PI.renderAll = renderAll;

function stats(f,t){
  const ks = daysIn(f,t), vals = ks.map(k=>DAY[k]);
  const total = vals.reduce((a,b)=>a+b,0);
  let best = ks[0]; ks.forEach(k => { if (DAY[k] > DAY[best]) best = k; });
  const exp = ks.reduce((a,k) => a + PI.expectedDay(k), 0);
  return {ks, total, n:ks.length, avg: ks.length ? total/ks.length : 0, best, exp};
}

function yearEndForecast(){
  const {q} = PI.quarterMap(), yy = LAST.slice(0,4);
  let actual = 0; [1,2,3,4].forEach(t => { const k = yy+'-T'+t; if (DATA.meterQuarters[k] != null) actual += DATA.meterQuarters[k]; });
  Object.keys(PLANT).forEach(k => { if (k.startsWith(yy) && DATA.meterQuarters[qOf(k)] == null) actual += PLANT[k]; });
  let rest = 0; for (let k = addDays(LAST,1); k <= yy + '-12-31'; k = addDays(k,1)) rest += PI.expectedDay(k,'all');
  return {yy, actual, rest, total: actual + rest};
}
PI.yearEndForecast = yearEndForecast;

function renderKpis(){
  const s = stats(state.from, state.to), kwp = DATA.plant.kwp;
  const len = s.n, pf = addDays(state.from,-len), pt = addDays(state.from,-1);
  const p = stats(pf < FIRST ? FIRST : pf, pt);
  const comparable = pf >= FIRST && p.n === len;
  const delta = comparable && p.total ? (s.total/p.total - 1) : null;
  const homes = s.n ? s.total / (4500 * s.n / 365) : 0;
  const perf = s.exp ? s.total / s.exp : null;
  const ye = yearEndForecast();
  const ic = {
    bolt:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
    avg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 17l6-6 4 4 8-8"/></svg>',
    star:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 7 7 .6-5.3 4.6 1.6 7.1L12 17.8 5.7 21.3l1.6-7.1L2 9.6 9 9z"/></svg>',
    panel:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="5" width="18" height="12" rx="1"/><path d="M3 11h18M9 5v12M15 5v12M12 17v3"/></svg>',
    home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 11l9-7 9 7v9H3z"/></svg>',
    target:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
    cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>'
  };
  const items = [
    ['bolt','Production', s.total, v => fmtE(v), delta === null ? 'du ' + fmtDate(state.from) + ' au ' + fmtDate(state.to)
       : `<span class="delta ${delta>=0?'up':'down'}">${delta>=0?'▲':'▼'} ${nf1.format(Math.abs(delta*100))} %</span> vs période précédente`],
    ['target','Performance vs attendu', perf == null ? 0 : perf*100, v => nf0.format(v) + '<small>%</small>',
       perf == null ? '–' : (perf >= 0.9 ? 'conforme' : perf >= 0.75 ? 'un peu en dessous' : 'nettement en dessous') + ' · attendu ' + fmtE(s.exp), perf != null && perf < 0.75],
    ['avg','Moyenne par jour', s.avg, v => nf0.format(v) + '<small>kWh</small>', s.n + ' jours'],
    ['star','Meilleur jour', s.n ? DAY[s.best] : 0, v => nf0.format(v) + '<small>kWh</small>', s.n ? fmtDate(s.best) : '–'],
    ['panel','Productible', s.total/kwp, v => nf1.format(v) + '<small>kWh/kWc</small>', 'sur la période · ' + nf1.format(kwp) + ' kWc'],
    ['cal','Prévision fin ' + ye.yy, ye.total/1000, v => nf1.format(v) + '<small>MWh</small>', nf1.format(ye.actual/1000) + ' MWh réalisés + ' + nf1.format(ye.rest/1000) + ' attendus'],
    ['home','Équivalent ménages', homes, v => nf0.format(v), 'consommation couverte sur la période'],
  ];
  const box = el('kpis');
  box.innerHTML = items.map((it,i) => `<div class="kpi${it[5]?' warn':''}"><div class="k"><i>${ic[it[0]]}</i>${it[1]}</div><div class="v num" id="kv${i}">–</div><div class="d">${it[4]}</div></div>`).join('');
  items.forEach((it,i) => countUp(el('kv'+i), it[2], v => it[3](v), true));
}

function renderAlert(){
  const box = el('alert'); const t = LAST, f = addDays(LAST, -13);
  let a = 0, e = 0; daysIn(f,t).forEach(k => { a += PLANT[k]; e += PI.expectedDay(k,'all'); });
  const r = e ? a/e : 1;
  // ratio entre onduleurs : alerte si un onduleur dévie fortement de sa part habituelle
  let invMsg = '';
  if (INV['PVS-100'] && INV['PVS-30']) {
    let x = 0, y = 0; daysIn(f,t).forEach(k => { x += INV['PVS-100'][k]||0; y += INV['PVS-30'][k]||0; });
    const sh = x+y ? x/(x+y) : 0, ref = EXP.invShare['PVS-100'];
    if (ref && Math.abs(sh - ref) > 0.08) invMsg = ` Répartition inhabituelle entre onduleurs (PVS-100 : ${nf0.format(sh*100)} % contre ${nf0.format(ref*100)} % habituellement).`;
  }
  if (r < 0.7 || invMsg) {
    box.innerHTML = `<b>⚠ Attention</b><span>Sur les 14 derniers jours, la production atteint ${nf0.format(r*100)} % de l'attendu.${invMsg} ` +
      `Une météo défavorable peut l'expliquer ; si cela persiste, vérifiez les événements des onduleurs.</span>`;
    box.classList.remove('hidden');
  } else box.classList.add('hidden');
}

function movingAvg(arr, w){ return arr.map((_,i) => { if (i < w-1) return null; let s = 0; for (let j=i-w+1;j<=i;j++) s += arr[j]; return Math.round(s/w); }); }

function renderMain(){
  const g = state.gran, agg = aggregate(state.from, state.to, g);
  const labels = agg.map(([b]) => bucketLabel(b,g));
  const vals = agg.map(([,v]) => Math.round(v));
  let prev = null, exp = null, ma = null;
  const bucketDays = b => daysIn(state.from,state.to).filter(k => bucketKey(k,g) === b);
  if (state.cmp) prev = agg.map(([b]) => { let s = 0, ok = false; bucketDays(b).forEach(k => { const pk = prevYear(k); if (pk in DAY) { s += DAY[pk]; ok = true; } }); return ok ? Math.round(s) : null; });
  if (state.exp) exp = agg.map(([b]) => Math.round(bucketDays(b).reduce((a,k)=>a+PI.expectedDay(k),0)));
  if (state.ma) ma = movingAvg(vals, g === 'day' ? 7 : g === 'week' ? 4 : 3);
  const gLabel = {day:'par jour',week:'par semaine',month:'par mois'}[g];
  const invTxt = state.inv === 'all' ? '' : ' · ' + state.inv;
  el('mainTitle').textContent = (state.mode === 'cumul' ? 'Production cumulée' : 'Production ' + gLabel) + invTxt;
  el('mainSub').textContent = fmtDate(state.from) + ' – ' + fmtDate(state.to) + ' · kWh';
  const lg = el('mainLegend'); const parts = [];
  if (prev || exp || ma) parts.push('<span><i style="background:var(--sun)"></i>Période</span>');
  if (prev) parts.push('<span><i class="ln" style="background:var(--s1)"></i>Année précédente</span>');
  if (exp) parts.push('<span><i class="ln" style="background:var(--s3)"></i>Attendu</span>');
  if (ma) parts.push('<span><i class="ln" style="background:var(--s2)"></i>Moyenne glissante</span>');
  if (prev && prev.every(v => v == null)) parts.push('<span style="color:var(--muted)">pas de données N-1 sur cette période</span>');
  lg.innerHTML = parts.join('');

  const tableEl = el('mainTable'), box = el('mainChartBox');
  if (state.mode === 'table') {
    box.classList.add('hidden'); tableEl.classList.remove('hidden');
    const t = document.createElement('table');
    const hd = ['Période','Production (kWh)'].concat(state.exp?['Attendu (kWh)','Écart']:[]).concat(state.cmp?['N-1 (kWh)','Écart N-1']:[]);
    const thead = document.createElement('thead'), tr0 = document.createElement('tr');
    hd.forEach(h => { const th = document.createElement('th'); th.textContent = h; tr0.appendChild(th); }); thead.appendChild(tr0); t.appendChild(thead);
    const tb = document.createElement('tbody');
    const pct = (a,b) => b ? ((a/b-1)>=0?'+':'') + nf1.format((a/b-1)*100) + ' %' : '–';
    agg.forEach(([b,v],i) => { const tr = document.createElement('tr');
      const cells = [bucketLabel(b,g), nf0.format(v)];
      if (state.exp) cells.push(nf0.format(exp[i]), pct(v, exp[i]));
      if (state.cmp) { const p = prev[i]; cells.push(p==null?'–':nf0.format(p), p ? pct(v,p) : '–'); }
      cells.forEach(c => { const td = document.createElement('td'); td.textContent = c; td.className='num'; tr.appendChild(td); }); tb.appendChild(tr); });
    t.appendChild(tb); tableEl.replaceChildren(t); return;
  }
  box.classList.remove('hidden'); tableEl.classList.add('hidden');

  const sun = css('--sun'), s1 = css('--s1'), s2 = css('--s2'), s3 = css('--s3');
  const line = (label, data, color, dash) => ({label, type:'line', data, borderColor:color, backgroundColor:color, borderWidth:2,
    pointRadius: data.length > 45 ? 0 : 2.5, pointHoverRadius:5, tension:.3, order:1, spanGaps:false, borderDash: dash || []});
  if (state.mode === 'cumul') {
    const cumF = arr => { let c = 0; return arr.map(v => v == null ? null : (c += v)); };
    const ctx = el('cMain').getContext('2d');
    const grad = ctx.createLinearGradient(0,0,0,320); grad.addColorStop(0, sun + '55'); grad.addColorStop(1, sun + '00');
    const ds = [{label:'Période',data:cumF(vals),borderColor:sun,backgroundColor:grad,fill:true,tension:.3,borderWidth:2.5,pointRadius:0,pointHoverRadius:5}];
    if (prev) ds.push(line('Année précédente', cumF(prev), s1, [5,4]));
    if (exp) ds.push(line('Attendu', cumF(exp), s3, [2,3]));
    PI.makeChart('cMain',{type:'line',data:{labels,datasets:ds},options:PI.baseOpts('kWh')});
    return;
  }
  const ds = [{label:'Période',type:'bar',data:vals,backgroundColor:sun,hoverBackgroundColor:css('--sun-2'),borderRadius:{topLeft:4,topRight:4},borderSkipped:'bottom',
    maxBarThickness:42,categoryPercentage:.86,barPercentage:.92,order:2}];
  if (prev) ds.push(line('Année précédente', prev, s1));
  if (exp) ds.push(line('Attendu', exp, s3, [2,3]));
  if (ma) ds.push(line('Moyenne glissante', ma, s2));
  PI.makeChart('cMain',{type:'bar',data:{labels,datasets:ds},options:PI.baseOpts('kWh')});
}

function renderRecords(){
  const ks = daysIn(state.from,state.to);
  const byMonth = aggregate(state.from,state.to,'month'), byWeek = aggregate(state.from,state.to,'week');
  const top = arr => arr.reduce((a,b) => b[1] > a[1] ? b : a, arr[0] || ['',0]);
  const bm = top(byMonth), bw = top(byWeek);
  let worst = ks[0]; ks.forEach(k => { if (DAY[k] < DAY[worst]) worst = k; });
  const mx = Math.max(...ks.map(x=>DAY[x]));
  const sunny = ks.filter(k => DAY[k] >= 0.6 * mx).length;
  const recs = [
    ['Meilleure semaine', fmtE(bw[1]), bw[0] ? 'semaine du ' + fmtDate(bw[0]) : '–'],
    ['Meilleur mois', fmtE(bm[1]), bm[0] ? MOIS[+bm[0].slice(5,7)-1] + ' ' + bm[0].slice(0,4) : '–'],
    ['Jour le plus faible', ks.length ? nf0.format(DAY[worst]) + ' kWh' : '–', ks.length ? fmtDate(worst) : ''],
    ['Jours très productifs', sunny + ' / ' + ks.length, '≥ 60 % du meilleur jour'],
  ];
  const box = el('records'); box.replaceChildren();
  recs.forEach(([a,b,c]) => { const d = document.createElement('div'); d.className='rec';
    const s=document.createElement('span'); s.textContent=a; const st=document.createElement('strong'); st.className='num'; st.textContent=b; const e=document.createElement('em'); e.textContent=c;
    d.append(s,st,e); box.appendChild(d); });
  const s = stats(state.from,state.to), ann = s.n ? s.total/DATA.plant.kwp*365/s.n : 0;
  el('gaugeTxt').textContent = nf0.format(ann) + ' kWh/kWc·an';
  requestAnimationFrame(() => el('gaugeBar').style.width = Math.min(100, ann/1100*100) + '%');
}

/* ---------- inverters ---------- */
function renderInverters(){
  const ids = ['PVS-100','PVS-30'].filter(id => INV[id]); if (!ids.length) return;
  const cols = {'PVS-100':css('--s1'),'PVS-30':css('--s2')};
  const tot = {}; ids.forEach(id => { tot[id] = 0; for (let k=state.from;k<=state.to;k=addDays(k,1)) tot[id] += INV[id][k] || 0; });
  const sum = ids.reduce((a,id)=>a+tot[id],0);
  const meta = Object.fromEntries((DATA.inverters||[]).map(x => [x.id, x]));
  const box = el('invCards'); box.replaceChildren();
  ids.forEach(id => {
    const d = document.createElement('div'); d.className = 'inv'; d.style.setProperty('--c', cols[id]);
    const sh = sum ? tot[id]/sum : 0;
    d.innerHTML = `<div class="t">${id} <span></span></div><strong class="num">${fmtE(tot[id])}</strong><em></em><div class="bar"><i style="width:0"></i></div>`;
    d.querySelector('.t span').textContent = meta[id].model.replace('FIMER ','') + ' · ' + meta[id].kw + ' kW';
    d.querySelector('em').textContent = nf1.format(sh*100) + ' % de la production · ' + nf1.format(tot[id]/meta[id].kw) + ' kWh par kW d\'onduleur · SN ' + meta[id].sn;
    box.appendChild(d); requestAnimationFrame(() => d.querySelector('.bar i').style.width = (sh*100) + '%');
  });
  const g = state.invView === 'share' ? (state.gran === 'day' && daysIn(state.from,state.to).length > 60 ? 'week' : state.gran) : (state.gran === 'day' && daysIn(state.from,state.to).length > 45 ? 'week' : state.gran === 'day' ? 'day' : state.gran);
  const a1 = aggregate(state.from,state.to,g,INV['PVS-100']), a2 = new Map(aggregate(state.from,state.to,g,INV['PVS-30']));
  const labels = a1.map(([b]) => bucketLabel(b,g));
  let v1 = a1.map(([,v]) => v), v2 = a1.map(([b]) => a2.get(b) || 0);
  el('invSub').textContent = 'Répartition ' + {day:'par jour',week:'par semaine',month:'par mois'}[g] + ' · ' + fmtDate(state.from) + ' – ' + fmtDate(state.to);
  if (state.invView === 'share') {
    const s = v1.map((v,i) => v + v2[i]); v1 = v1.map((v,i) => s[i] ? v/s[i]*100 : null); v2 = v2.map((v,i) => s[i] ? v/s[i]*100 : null);
    PI.makeChart('cInv',{type:'line',data:{labels,datasets:[
      {label:'PVS-100',data:v1,borderColor:cols['PVS-100'],backgroundColor:cols['PVS-100'],borderWidth:2,pointRadius:0,tension:.3},
      {label:'PVS-30',data:v2,borderColor:cols['PVS-30'],backgroundColor:cols['PVS-30'],borderWidth:2,pointRadius:0,tension:.3}]},
      options:PI.baseOpts('%', o => { o.scales.y.max = 100; o.plugins.tooltip.callbacks.label = c => ' ' + nf1.format(c.parsed.y) + ' %  ' + c.dataset.label; })});
  } else {
    const bar = (label, data, c) => ({label, data:data.map(Math.round), backgroundColor:c, borderRadius:{topLeft:4,topRight:4}, borderSkipped:'bottom', categoryPercentage:.8, barPercentage:.9, maxBarThickness:30});
    PI.makeChart('cInv',{type:'bar',data:{labels,datasets:[bar('PVS-100',v1,cols['PVS-100']), bar('PVS-30',v2,cols['PVS-30'])]},options:PI.baseOpts('kWh')});
  }
}

/* ---------- heatmap ---------- */
function heatmap(){
  const end = LAST, start0 = addDays(end, -364);
  const sd = D(start0); const wd = (sd.getDay()+6)%7; const start = addDays(start0, -wd);
  const vals = Object.values(DAY), max = Math.max(...vals);
  const level = v => v == null ? -1 : v <= 0.5 ? 0 : Math.min(5, 1 + Math.floor(v / max * 5 * 0.999));
  const heat = el('heat'), months = el('heatMonths');
  heat.replaceChildren(); months.replaceChildren();
  const tip = el('tip');
  let lastMonth = -1;
  for (let k = start; k <= end; k = addDays(k,1)) {
    const d = D(k), dow = (d.getDay()+6)%7;
    if (dow === 0) {
      const lab = document.createElement('span');
      if (d.getMonth() !== lastMonth) { lab.textContent = MOIS[d.getMonth()]; lastMonth = d.getMonth(); }
      months.appendChild(lab);
    }
    const c = document.createElement('div'); c.className = 'c';
    if (k < start0) c.classList.add('empty');
    else {
      const v = DAY[k]; const L = level(v);
      if (L < 0) c.classList.add('na'); else c.style.background = `var(--heat${L})`;
      c.tabIndex = 0;
      const show = () => { tip.replaceChildren(); const b = document.createElement('b'); b.textContent = v == null ? 'Pas de données' : nf0.format(v) + ' kWh';
        const ex = PI.expectedDay(k);
        tip.append(b, document.createElement('br'), document.createTextNode(JOURS[d.getDay()] + ' ' + fmtDate(k)));
        if (v != null) tip.append(document.createElement('br'), document.createTextNode(nf0.format(v/ex*100) + ' % de l\'attendu'));
        const r = c.getBoundingClientRect(); tip.style.left = Math.min(innerWidth - 180, Math.max(8, r.left - 60)) + 'px'; tip.style.top = (r.top - 70) + 'px'; tip.classList.add('on'); };
      c.addEventListener('pointerenter', show); c.addEventListener('focus', show);
      c.addEventListener('pointerleave', () => tip.classList.remove('on')); c.addEventListener('blur', () => tip.classList.remove('on'));
      c.addEventListener('click', () => {
        state.preset = null; state.gran = 'day';
        state.from = addDays(k,-6) < FIRST ? FIRST : addDays(k,-6); state.to = addDays(k,7) > LAST ? LAST : addDays(k,7);
        syncControls(); renderAll(); el('mainCard').scrollIntoView({behavior:'smooth',block:'center'}); });
    }
    heat.appendChild(c);
  }
  const sc = document.querySelector('.heat-scroll'); sc.scrollLeft = sc.scrollWidth;
}

/* ---------- hourly ---------- */
function hourly(){
  const h = DATA.hourly; if (!h) return;
  const days = []; for (let i=0;i<h.values.length/24;i++) days.push(addDays(h.start,i));
  if (!state.hourDay) state.hourDay = days[days.length-1];
  const box = el('hourDays'); box.replaceChildren();
  days.forEach(k => { const b = document.createElement('button'); const d = D(k); b.textContent = JOURS[d.getDay()] + ' ' + d.getDate();
    b.setAttribute('aria-pressed', k === state.hourDay); b.onclick = () => { state.hourDay = k; hourly(); }; box.appendChild(b); });
  const idx = days.indexOf(state.hourDay), sel = h.values.slice(idx*24, idx*24+24);
  const avg = [...Array(24)].map((_,i) => days.reduce((a,_,j) => a + h.values[j*24+i], 0) / days.length);
  const total = sel.reduce((a,b)=>a+b,0), peak = sel.indexOf(Math.max(...sel));
  el('hourSub').textContent = fmtDate(state.hourDay) + ' · ' + nf0.format(total) + ' kWh · pic vers ' + peak + 'h';
  const labels = [...Array(24)].map((_,i) => i + 'h');
  PI.makeChart('cHour',{type:'bar',data:{labels,datasets:[
    {label:'Jour',data:sel,backgroundColor:css('--sun'),borderRadius:{topLeft:4,topRight:4},borderSkipped:'bottom',order:2,categoryPercentage:.9,barPercentage:.9},
    {label:'Moyenne 7 j',type:'line',data:avg.map(v=>Math.round(v*10)/10),borderColor:css('--s1'),borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:.35,order:1}
  ]},options:PI.baseOpts('kWh')});
}

/* ---------- 15-min power ---------- */
function power(){
  const p = DATA.power15; if (!p) return;
  const per = 24*60/p.stepMin, nd = p.values.length/per, days = [];
  for (let i=0;i<nd;i++) days.push(addDays(p.start,i));
  if (!state.pwDay) state.pwDay = 'all';
  const box = el('pwDays'); box.replaceChildren();
  ['all'].concat(days).forEach(k => { const b = document.createElement('button');
    b.textContent = k === 'all' ? '7 jours' : JOURS[D(k).getDay()] + ' ' + D(k).getDate();
    b.setAttribute('aria-pressed', k === state.pwDay); b.onclick = () => { state.pwDay = k; power(); }; box.appendChild(b); });
  let labels, vals;
  if (state.pwDay === 'all') {
    labels = p.values.map((_,i) => { const d = D(days[Math.floor(i/per)]); const m = (i%per)*p.stepMin; return JOURS[d.getDay()] + ' ' + d.getDate() + ' · ' + String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0'); });
    vals = p.values;
  } else {
    const i = days.indexOf(state.pwDay); vals = p.values.slice(i*per, (i+1)*per);
    labels = vals.map((_,j) => { const m = j*p.stepMin; return String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0'); });
  }
  const mx = Math.max(...vals), mi = vals.indexOf(mx);
  el('pwSub').textContent = 'kW · ' + (state.pwDay === 'all' ? '7 derniers jours' : fmtDate(state.pwDay)) + ' · pointe ' + nf1.format(mx) + ' kW (' + labels[mi] + ') · ' + nf0.format(mx/DATA.plant.kwp*100) + ' % de la puissance installée';
  const sun = css('--sun'); const ctx = el('cPow').getContext('2d');
  const grad = ctx.createLinearGradient(0,0,0,260); grad.addColorStop(0, sun + '66'); grad.addColorStop(1, sun + '00');
  PI.makeChart('cPow',{type:'line',data:{labels,datasets:[{label:'Puissance',data:vals,borderColor:sun,backgroundColor:grad,fill:true,borderWidth:1.6,pointRadius:0,pointHoverRadius:4,tension:.25}]},
    options:PI.baseOpts('kW', o => { o.plugins.tooltip.callbacks.label = c => ' ' + nf1.format(c.parsed.y) + ' kW';
      o.scales.x.ticks.maxTicksLimit = state.pwDay === 'all' ? 7 : 9;
      if (state.pwDay === 'all') o.scales.x.ticks.callback = function(v){ const l = this.getLabelForValue(v); return l.split(' · ')[0]; }; })});
}

/* ---------- weather ---------- */
const WX = {'clear':'☀️','day-sunny':'☀️','day-cloudy':'⛅','day-cloudy-high':'🌤️','cloudy':'☁️','rain':'🌧️','showers':'🌦️','snow':'🌨️','fog':'🌫️','thunderstorm':'⛈️'};
const WXT = {'clear':'Ensoleillé','day-sunny':'Ensoleillé','day-cloudy':'Nuageux','day-cloudy-high':'Voile nuageux','cloudy':'Couvert','rain':'Pluie','showers':'Averses','snow':'Neige','fog':'Brouillard','thunderstorm':'Orage'};
function weather(){
  const w = DATA.weather, box = el('wx'); if (!w) return;
  const now = document.createElement('div'); now.className = 'wx-now';
  now.innerHTML = `<span class="ic">${WX[w.now.code]||'🌡️'}</span><div><strong class="num"></strong><div class="sub"></div></div>`;
  now.querySelector('strong').textContent = nf1.format(w.now.temp) + ' °C';
  now.querySelector('.sub').textContent = (WXT[w.now.code]||w.now.code) + ' · relevé du ' + fmtDate(w.at.slice(0,10)) + ' à ' + w.at.slice(11,16);
  const grid = document.createElement('div'); grid.className = 'wx-days';
  w.forecast.forEach(([d, code, mn, mx]) => { const c = document.createElement('div'); c.className = 'wx-d';
    c.innerHTML = `<b></b><span class="ic">${WX[code]||'🌡️'}</span><span class="t"></span>`;
    c.querySelector('b').textContent = JOURS[D(d).getDay()] + ' ' + D(d).getDate(); c.querySelector('.t').textContent = nf0.format(mn) + '° / ' + nf0.format(mx) + '°';
    c.title = WXT[code] || code; grid.appendChild(c); });
  box.replaceChildren(now, grid);
  el('wxSub').textContent = 'Prévisions à 6 jours · source Aurora Vision';
}

/* ---------- events ---------- */
function events(){
  const e = DATA.events; if (!e) return;
  el('evStatus').innerHTML = e.active ? `<span class="pill" style="background:#dc262622;color:#dc2626">${e.active} alarme(s) active(s)</span>` : '<span class="pill">● Aucune alarme active</span>';
  el('evSub').textContent = e.total + ' événements clôturés depuis le ' + fmtDate(e.since) + ' · la plupart surviennent au lever et au coucher du soleil (tension faible), ce qui est courant';
  const t1 = el('evCodes'); t1.innerHTML = '<thead><tr><th class="l">Type</th><th class="l">Onduleur</th><th>Gravité</th><th>Nombre</th></tr></thead>';
  const b1 = document.createElement('tbody');
  e.byCode.forEach(([code, dev, name, sev, n]) => { const tr = document.createElement('tr');
    [[name + ' (' + code + ')','l'],[dev,'l']].forEach(([v,c]) => { const td = document.createElement('td'); td.textContent = v; td.className = c; tr.appendChild(td); });
    const ts = document.createElement('td'); const sp = document.createElement('span'); sp.className = 'sev ' + sev; sp.textContent = sev; ts.appendChild(sp); tr.appendChild(ts);
    const tn = document.createElement('td'); tn.className = 'num'; tn.textContent = n; tr.appendChild(tn); b1.appendChild(tr); });
  t1.appendChild(b1);
  const names = Object.fromEntries(e.byCode.map(x => [x[0], x[2]]));
  const t2 = el('evRecent'); t2.innerHTML = '<thead><tr><th class="l">Date</th><th class="l">Événement</th><th class="l">Onduleur</th><th>Durée</th></tr></thead>';
  const b2 = document.createElement('tbody');
  e.recent.forEach(([ts, mins, dev, code]) => { const tr = document.createElement('tr'); const d = new Date(ts);
    const when = d.toLocaleDateString('fr-CH',{day:'numeric',month:'short'}) + ' ' + d.toLocaleTimeString('fr-CH',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Zurich'});
    const dur = mins < 1 ? '< 1 min' : mins < 60 ? mins + ' min' : nf1.format(mins/60) + ' h';
    [[when,'l'],[names[code] || code,'l'],[dev,'l'],[dur,'num']].forEach(([v,c]) => { const td = document.createElement('td'); td.textContent = v; td.className = c; tr.appendChild(td); });
    b2.appendChild(tr); });
  t2.appendChild(b2);
}

/* ---------- years & quarters (installation complète) ---------- */
function years(){
  const {q, live} = PI.quarterMap();
  const ys = [...new Set(Object.keys(q).map(k=>k.slice(0,4)))].sort();
  const cols = ['--s1','--s2','--s3','--s4'].map(css);
  const lg = el('yearLegend'); lg.replaceChildren();
  const ds = ys.map((y,i) => {
    const sp = document.createElement('span'); const ii = document.createElement('i'); ii.style.background = cols[i % 4];
    sp.append(ii, document.createTextNode(y + (Object.keys(q).some(k=>k.startsWith(y)&&live.has(k)) ? ' (en cours)' : ''))); lg.appendChild(sp);
    return {label:y, data:['T1','T2','T3','T4'].map(t => q[y+'-'+t] != null ? Math.round(q[y+'-'+t]) : null),
      backgroundColor:cols[i % 4], borderRadius:{topLeft:4,topRight:4}, borderSkipped:'bottom', categoryPercentage:.8, barPercentage:.9};
  });
  PI.makeChart('cYears',{type:'bar',data:{labels:['T1 · hiver','T2 · printemps','T3 · été','T4 · automne'],datasets:ds},options:PI.baseOpts('kWh')});
}
function quarters(){
  const {q, live} = PI.quarterMap(); const ks = Object.keys(q).sort();
  const sun = css('--sun'), soft = css('--sun-2');
  PI.makeChart('cQuarter',{type:'bar',data:{labels:ks.map(k=>k.replace('-',' ')),datasets:[{label:'',data:ks.map(k=>Math.round(q[k])),
    backgroundColor:ks.map(k => live.has(k) ? soft : sun), borderRadius:{topLeft:4,topRight:4}, borderSkipped:'bottom', maxBarThickness:48}]},options:PI.baseOpts('kWh')});
}

function aurora(){
  const box = el('aurora');
  if (AURORA_PUBLIC_URL) { const f = document.createElement('iframe'); f.src = AURORA_PUBLIC_URL; f.title = 'Aurora Vision PolyImmo'; f.loading = 'lazy'; box.replaceChildren(f); }
  else { const p = document.createElement('div'); p.className = 'placeholder'; p.textContent = 'Le partage public n\'est pas encore activé sur Aurora Vision. Les données ci-dessus proviennent de la plateforme et sont mises à jour sur demande.'; box.replaceChildren(p); }
}

function observe(){
  if (!('IntersectionObserver' in window)) { document.querySelectorAll('.reveal').forEach(e=>e.classList.add('in')); return; }
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), {threshold:.06});
  document.querySelectorAll('.reveal').forEach(x => io.observe(x));
}
PI.heatmap = heatmap;
