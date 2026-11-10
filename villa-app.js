/* Villa BAMO — page dédiée : tableau de bord, énergie, tarifs (GESA vs dynamique), simulateur de batterie.
   Données : data/villa.json (SolarEdge, robot quotidien), data/prices_CH.json + history_CH.json (prix spot), fx (BCE). */
'use strict';
(function(){
const $ = id => document.getElementById(id);
const MOIS = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
const MOISL = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const JOURS = ['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'];
const nf0 = new Intl.NumberFormat('fr-CH',{maximumFractionDigits:0}), nf1 = new Intl.NumberFormat('fr-CH',{minimumFractionDigits:1,maximumFractionDigits:1}), nf2 = new Intl.NumberFormat('fr-CH',{minimumFractionDigits:2,maximumFractionDigits:2});
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const Dd = s => new Date(s + 'T12:00:00'), isoD = d => d.toLocaleDateString('sv-SE');
const addDays = (s,n) => { const d = Dd(s); d.setDate(d.getDate()+n); return isoD(d); };
const fmtDate = s => { const d = Dd(s); return d.getDate() + ' ' + MOIS[d.getMonth()] + ' ' + d.getFullYear(); };
const help = t => `<span class="help" tabindex="0" data-tip="${t}">?</span>`;
const kpi = ([k,v,d]) => `<div class="kpi"><div class="k">${k}</div><div class="v num" style="font-size:1.5rem">${v}</div><div class="d">${d}</div></div>`;
const sgn = v => (v >= 0 ? '+' : '−') + nf0.format(Math.abs(v));
const charts = {};
const chart = (id, cfg) => { if (charts[id]) charts[id].destroy(); charts[id] = new Chart($(id), cfg); return charts[id]; };
function opts(unit, extra){
  const o = {responsive:true, maintainAspectRatio:false, animation:{duration:450}, interaction:{mode:'index', intersect:false},
    plugins:{legend:{display:true, position:'top', align:'end', labels:{boxWidth:10, boxHeight:10, color:css('--ink-2'), font:{size:11, weight:'600'}}},
      tooltip:{backgroundColor:css('--ink'), titleColor:css('--bg'), bodyColor:css('--bg'), padding:11, cornerRadius:10, boxWidth:12, boxHeight:3,
        callbacks:{label:c => ' ' + c.dataset.label + ' : ' + (c.parsed.y == null ? '–' : (unit === 'ct' ? nf2 : unit === 'kW' ? nf1 : nf0).format(Math.abs(c.parsed.y)) + ' ' + (unit === 'ct' ? 'ct/kWh' : unit))}}},
    scales:{x:{grid:{display:false}, border:{display:false}, ticks:{color:css('--muted'), maxRotation:0, autoSkip:true, autoSkipPadding:14, font:{size:11}}},
      y:{grid:{color:c => c.tick.value === 0 ? css('--muted') : css('--grid')}, border:{display:false}, beginAtZero:true, ticks:{color:css('--muted'), font:{size:11}, maxTicksLimit:6, callback:v => nf0.format(Math.abs(v))}}}};
  return extra ? (extra(o) || o) : o;
}
const barDs = (label, data, color, stack, extra) => Object.assign({label, data, backgroundColor:color, stack, borderRadius:3, borderSkipped:false, maxBarThickness:30, categoryPercentage:.82, barPercentage:.9, order:2}, extra || {});
const lineDs = (label, data, color, extra) => Object.assign({type:'line', label, data, borderColor:color, backgroundColor:color, borderWidth:2.2, pointRadius:data.length > 40 ? 0 : 3, tension:.3, order:1}, extra || {});
function chips(id, val){ document.querySelectorAll('#' + id + ' button').forEach(b => b.setAttribute('aria-pressed', b.dataset.r === val)); }
function onChips(id, fn){ $(id).addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.disabled) fn(b.dataset.r); }); }

/* ---------- fuseau horaire ---------- */
const fmtP = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Zurich', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', hour12:false, weekday:'short'});
const lcache = new Map();
function loc(ms){ // → {d:'YYYY-MM-DD', h:0-23, wd:0-6}
  const k = Math.floor(ms / 36e5); if (lcache.has(k)) return lcache.get(k);
  const p = Object.fromEntries(fmtP.formatToParts(new Date(k*36e5)).map(x => [x.type, x.value]));
  const r = {d:`${p.year}-${p.month}-${p.day}`, h:+p.hour % 24, wd:{Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}[p.weekday]}; lcache.set(k, r); return r;
}
const keyMs = k => Date.parse(k.length === 17 ? k.replace('Z', ':00Z') : k);

/* ---------- réglages (enregistrés dans le navigateur) ---------- */
const KEY = 'vb-settings-v3';
const DEF = {
  tariff:{ht:26.16, bt:20.25, sell:9.00, hkn:0, vat:8.1, wdStart:7, wdEnd:20, satHT:false},   // GESA « Double interruptible » (facture T1 2025, HT) — reprise 2026
  dyn:{gridHT:12.23, gridBT:8.24, sellFee:0, floor:false, zone:'CH'},   // dynamique : spot + acheminement + services système + taxes (facture GESA)
  bat:{costKwh:350, costFix:1500, life:15, deg:2, eff:90, cRate:0.5, maxKw:25, rate:2, mode:'smart', gridCharge:false, sizes:'0,5,10,15,20,25,30,35,40,45,50,55'},
};
let SET = load();
function load(){ let s = null; try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch(e){}
  const o = JSON.parse(JSON.stringify(DEF)); if (s) for (const g of Object.keys(DEF)) o[g] = {...DEF[g], ...(s[g] || {})}; return o; }
function save(){ try { localStorage.setItem(KEY, JSON.stringify(SET)); } catch(e){} }

/* ---------- données ---------- */
let V = null, PRICE = null;
async function loadAll(){
  V = await fetch('data/villa.json', {cache:'no-store'}).then(r => r.ok ? r.json() : null).catch(() => null);
}
async function loadPrices(){
  if (PRICE) return PRICE;
  const z = SET.dyn.zone;
  const [P, H, fx, fxh] = await Promise.all([fetch(`data/prices_${z}.json`).then(r => r.json()), fetch(`data/history_${z}.json`).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('data/fx_eurchf.json').then(r => r.json()), fetch('data/fx_hist.json').then(r => r.ok ? r.json() : {rates:{}}).catch(() => ({rates:{}}))]);
  const rates = Object.assign({}, fxh.rates, fx.rates), rk = Object.keys(rates).sort();
  const fxAt = d => { let lo = 0, hi = rk.length - 1; if (d <= rk[0]) return rates[rk[0]]; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (rk[m] <= d) lo = m; else hi = m - 1; } return rates[rk[lo]]; };
  const hour = new Map(), q15 = new Map();   // ms UTC → ct CHF/kWh
  if (H) H.values.forEach((v, i) => { if (v != null) { const ms = (H.start + 3600*i) * 1000; hour.set(ms, v * fxAt(loc(ms).d) / 10); } });
  const acc = new Map();
  P.values.forEach((v, i) => { if (v == null) return; const ms = (P.start + 900*i) * 1000, ct = v * fxAt(loc(ms).d) / 10; q15.set(ms, ct);
    const h = ms - ms % 36e5, a = acc.get(h) || [0, 0]; a[0] += ct; a[1]++; acc.set(h, a); });
  for (const [h, a] of acc) hour.set(h, a[0] / a[1]);
  PRICE = {hour, q15, zone:z}; return PRICE;
}

/* ---------- séries horaires : production / consommation / achat / vente ---------- */
function hourlySeries(){
  const src = V.h && Object.keys(V.h).length ? V.h : null, out = [];
  if (src) for (const [k, row] of Object.entries(src)) { const [p, c, im, ex] = row; if (p == null || c == null) continue; out.push({ms:keyMs(k), p:+p || 0, c:+c || 0, im, ex}); }
  else if (V.p15) { const m = new Map(); for (const [k, [p, c]] of Object.entries(V.p15)) { const ms = keyMs(k), h = ms - ms % 36e5, x = m.get(h) || {ms:h, p:0, c:0}; x.p += (+p || 0)/4; x.c += (+c || 0)/4; m.set(h, x); } out.push(...m.values()); }
  out.sort((a,b) => a.ms - b.ms);
  out.forEach(x => { const n = x.c - x.p; x.imp = x.im != null ? +x.im : Math.max(0, n); x.exp = x.ex != null ? +x.ex : Math.max(0, -n); const L = loc(x.ms); x.d = L.d; x.h = L.h; x.wd = L.wd; });
  return out;
}
function localMs(d, h){ const [y,m,dd] = d.split('-').map(Number); for (const off of [1, 2]) { const ms = Date.UTC(y, m-1, dd, h) - off*36e5; const L = loc(ms); if (L.d === d && L.h === h) return ms; } return null; }
let FULL = null;
function fullSeries(){ // toutes les heures depuis la mise en service : mesurées (dernière année) ou reconstruites
  if (FULL) return FULL;
  const H = hourlySeries(), byDay = new Map();
  H.forEach(x => { (byDay.get(x.d) || byDay.set(x.d, []).get(x.d)).push(x); });
  const ref = [...byDay.entries()].filter(([d, hs]) => hs.length >= 23);
  const refBy = new Map(); ref.forEach(([d, hs]) => refBy.set(d.slice(5), hs));
  const byMonth = new Map(); ref.forEach(([d, hs]) => (byMonth.get(d.slice(5,7)) || byMonth.set(d.slice(5,7), []).get(d.slice(5,7))).push([+d.slice(8), hs]));
  const out = [], t0 = isoD(new Date());
  if (!ref.length) return (FULL = H);
  for (const [d, x] of Object.entries(V.daily).sort()) {
    if (d >= t0) continue;
    if (byDay.has(d) && byDay.get(d).length >= 23) { out.push(...byDay.get(d)); continue; }
    if (x.cons == null || x.prod == null) continue;
    let hs = refBy.get(d.slice(5)) || refBy.get(d.slice(5) === '02-29' ? '02-28' : '');
    if (!hs) { const c = byMonth.get(d.slice(5,7)); if (!c) continue; hs = c.reduce((a, b) => Math.abs(b[0] - +d.slice(8)) < Math.abs(a[0] - +d.slice(8)) ? b : a)[1]; }
    const sp = hs.reduce((a, h) => a + h.p, 0), sc = hs.reduce((a, h) => a + h.c, 0);
    hs.forEach(r => { const ms = localMs(d, r.h); if (ms == null) return;
      const p = sp ? r.p * x.prod / sp : 0, c = sc ? r.c * x.cons / sc : x.cons / 24, n = c - p, L = loc(ms);
      out.push({ms, p, c, imp:Math.max(0, n), exp:Math.max(0, -n), d:L.d, h:L.h, wd:L.wd, synth:true}); });
  }
  out.sort((a, b) => a.ms - b.ms); return (FULL = out);
}
const PERIODS = () => { const ys = [...new Set(Object.keys(V.daily).map(k => k.slice(0,4)))].sort().reverse(), cy = String(new Date().getFullYear());
  return [['12m','12 derniers mois'], ['3m','Dernier trimestre'], ...ys.filter(y => y !== cy && Object.keys(V.daily).filter(k => k.startsWith(y)).length > 300).map(y => ['y' + y, y]), ['all','Depuis le début']]; };
function period(H, per){
  if (!H.length) return {H, label:''};
  const last = H[H.length-1].ms;
  if (per === '3m') return {H:H.filter(x => x.ms > last - 92*864e5), label:'du dernier trimestre'};
  if (per === 'all') return {H, label:'depuis la mise en service (' + fmtDate(H[0].d) + ')'};
  if (per && per[0] === 'y') return {H:H.filter(x => x.d.startsWith(per.slice(1))), label:'de l\'année ' + per.slice(1)};
  return {H:H.filter(x => x.ms > last - 365*864e5), label:'des 12 derniers mois'};
}
function perChips(id){ const box = $(id); const html = PERIODS().map(([k, l]) => `<button data-r="${k}" aria-pressed="${k === S.per}">${l}</button>`).join(''); if (box.innerHTML !== html) box.innerHTML = html; }
const isHT = x => { const T = SET.tariff; if (x.wd === 0) return false; if (x.wd === 6 && !T.satHT) return false; return x.h >= T.wdStart && x.h < T.wdEnd; };

/* =================== VUES =================== */
const S = {view:'dash', range:'30', day:null, per:'12m', bsize:null};
const VIEWS = ['dash','energie','tarifs','batterie'];
function setView(v){ if (!VIEWS.includes(v)) v = 'dash'; S.view = v;
  document.querySelectorAll('#vtabs button').forEach(b => b.setAttribute('aria-current', b.dataset.v === v ? 'page' : 'false'));
  document.querySelectorAll('main [data-view]').forEach(s => s.classList.toggle('hidden', s.dataset.view !== v));
  history.replaceState(null, '', '#' + v); render(); }
async function render(){
  if (!V || !V.daily || !Object.keys(V.daily).length) { $('vbEmpty').classList.remove('hidden'); document.querySelectorAll('main [data-view]').forEach(s => s.classList.add('hidden')); return; }
  $('vbEmpty').classList.add('hidden');
  ({dash:renderDash, energie:renderEnergy, tarifs:renderTariffs, batterie:renderBattery})[S.view]();
}
const derive = x => { const prod = +x.prod || 0, cons = +x.cons || 0, imp = +x.imp || 0, exp = +x.exp || 0, self = Math.max(0, prod - exp);
  return {prod, cons, imp, exp, self, selfPct:prod ? self/prod*100 : null, autPct:cons ? Math.max(0, cons - imp)/cons*100 : null}; };
const days = () => { const t = isoD(new Date()); return Object.keys(V.daily).filter(k => k < t).sort(); };

/* ---------- 1. Tableau de bord ---------- */
function renderDash(){
  const ds = days(), last = ds[ds.length-1];
  $('vbUpd').textContent = 'Données au ' + fmtDate(last) + ' · mise à jour automatique chaque matin';
  chips('dRange', S.range);
  let keys, gran;
  if (S.range === '7' || S.range === '30') { keys = ds.slice(-+S.range); gran = 'd'; }
  else if (S.range === '12m') { const f = addDays(last, -364); keys = ds.filter(k => k >= f); gran = 'm'; }
  else if (S.range === 'ytd') { keys = ds.filter(k => k.slice(0,4) === last.slice(0,4)); gran = 'm'; }
  else { keys = ds; gran = 'y'; }
  const rows = keys.map(k => ({k, ...derive(V.daily[k])})), sumf = f => rows.reduce((s,r) => s + r[f], 0);
  const T = derive({prod:sumf('prod'), cons:sumf('cons'), imp:sumf('imp'), exp:sumf('exp')});
  // comparaison avec la même période l'an passé
  const prevKeys = keys.map(k => { const d = Dd(k); d.setFullYear(d.getFullYear()-1); return isoD(d); }).filter(k => V.daily[k]);
  const Pp = prevKeys.length === keys.length ? prevKeys.reduce((s,k) => s + (+V.daily[k].prod || 0), 0) : null;
  const best = rows.reduce((a,r) => r.prod > (a ? a.prod : -1) ? r : a, null);
  const kwp = V.site.kwp, nd = rows.length, spec = T.prod / kwp / (nd > 400 ? nd / 365.25 : 1);
  $('dKpis').innerHTML = [
    ['Production', nf0.format(T.prod) + '<small>kWh</small>', Pp ? `<span class="trend ${T.prod >= Pp ? 'up' : 'down'}">${T.prod >= Pp ? '▲' : '▼'} ${nf1.format(Math.abs(T.prod/Pp - 1)*100)} %</span> vs l'an passé` : fmtDate(keys[0]) + ' → ' + fmtDate(last)],
    ['Consommation', nf0.format(T.cons) + '<small>kWh</small>', nf1.format(T.cons/nd) + ' kWh par jour en moyenne'],
    ['Autoconsommation ' + help('Part de la production utilisée directement à la maison.'), T.selfPct == null ? '–' : nf0.format(T.selfPct) + '<small>%</small>', nf0.format(T.self) + ' kWh utilisés sur place'],
    ['Autonomie ' + help('Part de la consommation couverte par vos panneaux.'), T.autPct == null ? '–' : nf0.format(T.autPct) + '<small>%</small>', nf0.format(T.imp) + ' kWh achetés au réseau'],
    ['Vendu au réseau', nf0.format(T.exp) + '<small>kWh</small>', nf0.format(T.prod ? T.exp/T.prod*100 : 0) + ' % de la production'],
    ['Rendement ' + help('kWh produits par kWc installé : permet de comparer avec d\'autres installations (environ 1 000 kWh/kWc par an en Suisse).'), nf0.format(spec) + '<small>kWh/kWc' + (nd > 400 ? ' par an' : '') + '</small>', best ? 'meilleur jour : ' + nf0.format(best.prod) + ' kWh le ' + fmtDate(best.k) : ''],
  ].map(kpi).join('');
  const G = new Map(); rows.forEach(r => { const g = gran === 'd' ? r.k : gran === 'm' ? r.k.slice(0,7) : r.k.slice(0,4); const x = G.get(g) || {prod:0, cons:0, imp:0, exp:0}; ['prod','cons','imp','exp'].forEach(f => x[f] += r[f]); G.set(g, x); });
  const gk = [...G.keys()], gv = gk.map(g => derive(G.get(g)));
  const labels = gk.map(g => gran === 'd' ? Dd(g).getDate() + ' ' + MOIS[Dd(g).getMonth()] : gran === 'm' ? MOIS[+g.slice(5)-1] + ' ' + g.slice(2,4) : g);
  chart('cDash', {type:'bar', data:{labels, datasets:[
    barDs('Utilisée à la maison', gv.map(x => +x.self.toFixed(1)), css('--sun'), 'p'), barDs('Vendue au réseau', gv.map(x => +x.exp.toFixed(1)), css('--sun') + '70', 'p'),
    barDs('Achetée au réseau', gv.map(x => -x.imp.toFixed(1)), css('--s1') + '90', 'p'), lineDs('Consommation', gv.map(x => +x.cons.toFixed(1)), css('--s1'))]},
    options:opts('kWh', o => { o.scales.x.stacked = true; o.scales.y.stacked = true;
      o.plugins.tooltip.callbacks.afterBody = it => { const x = gv[it[0].dataIndex]; return x.selfPct == null ? '' : 'Autoconsommation ' + nf0.format(x.selfPct) + ' % · autonomie ' + nf0.format(x.autPct) + ' %'; }; })});
  renderDayCurve();
}
function renderDayCurve(){
  const P = V.p15 || {}, keys = Object.keys(P).sort(); if (!keys.length) { $('dDayCard').classList.add('hidden'); return; }
  $('dDayCard').classList.remove('hidden');
  const byDay = new Map(); keys.forEach(k => { const ms = keyMs(k), d = loc(ms).d; (byDay.get(d) || byDay.set(d, []).get(d)).push([ms, P[k]]); });
  const ds = [...byDay.keys()].slice(-21); if (!S.day || !byDay.has(S.day)) S.day = ds[ds.length - 1];
  $('dDays').innerHTML = ds.map(d => `<button data-r="${d}" aria-pressed="${d === S.day}">${JOURS[Dd(d).getDay()]} ${Dd(d).getDate()}</button>`).join('');
  const pts = byDay.get(S.day), lab = pts.map(([ms]) => new Date(ms).toLocaleTimeString('fr-CH', {hour:'2-digit', minute:'2-digit', timeZone:'Europe/Zurich'}));
  const p = pts.map(x => x[1][0]), c = pts.map(x => x[1][1]), e = a => a.reduce((s,v) => s + (+v || 0)/4, 0);
  const net = pts.map(x => (x[1][1] || 0) - (x[1][0] || 0));
  $('dDaySum').textContent = `${fmtDate(S.day)} · production ${nf1.format(e(p))} kWh · consommation ${nf1.format(e(c))} kWh · pic ${nf1.format(Math.max(...p.map(v => +v || 0)))} kW`;
  chart('cDay', {type:'line', data:{labels:lab, datasets:[
    lineDs('Production', p, css('--sun'), {fill:true, backgroundColor:css('--sun') + '35', pointRadius:0, borderWidth:1.8}),
    lineDs('Consommation', c, css('--s1'), {pointRadius:0}),
    lineDs('Achat (+) / vente (−) réseau', net, css('--ink-2'), {pointRadius:0, borderDash:[4,3], borderWidth:1.4})]},
    options:opts('kW', o => { o.scales.x.ticks.maxTicksLimit = 9; o.scales.y.beginAtZero = false;
      o.plugins.tooltip.callbacks.label = c => ' ' + c.dataset.label + ' : ' + nf1.format(c.parsed.y) + ' kW'; o.scales.y.ticks.callback = v => nf0.format(v); })});
}

/* ---------- 2. Énergie : profils et records ---------- */
function renderEnergy(){
  const H = hourlySeries();
  $('eNote').textContent = H.length ? `Basé sur ${nf0.format(H.length / 24)} jours de données heure par heure` + (H.length < 24*330 ? ' (l\'historique d\'un an se complète automatiquement en quelques jours)' : '') + '.' : 'Données horaires en cours de récupération.';
  // profil journalier moyen (été / hiver / tout)
  const prof = (filter) => { const p = Array(24).fill(0), c = Array(24).fill(0), n = Array(24).fill(0); H.filter(filter).forEach(x => { p[x.h] += x.p; c[x.h] += x.c; n[x.h]++; }); return {p:p.map((v,i) => n[i] ? v/n[i] : null), c:c.map((v,i) => n[i] ? v/n[i] : null)}; };
  const season = S.season || 'all'; chips('eSeason', season);
  const f = season === 'ete' ? x => [4,5,6,7,8].includes(+x.d.slice(5,7)) : season === 'hiver' ? x => [11,12,1,2].includes(+x.d.slice(5,7)) : () => true;
  const pr = prof(f), lab = Array.from({length:24}, (_,h) => h + 'h');
  chart('cProf', {type:'bar', data:{labels:lab, datasets:[barDs('Production moyenne', pr.p.map(v => v == null ? null : +v.toFixed(2)), css('--sun'), 'a', {stack:undefined}), lineDs('Consommation moyenne', pr.c.map(v => v == null ? null : +v.toFixed(2)), css('--s1'))]},
    options:opts('kWh', o => { o.plugins.tooltip.callbacks.label = c => ' ' + c.dataset.label + ' : ' + nf2.format(c.parsed.y) + ' kWh'; o.scales.y.ticks.callback = v => nf1.format(v); })});
  // mois : autoconsommation / autonomie
  const M = new Map(); Object.entries(V.daily).forEach(([d, x]) => { const m = d.slice(0,7), a = M.get(m) || {prod:0, cons:0, imp:0, exp:0}; ['prod','cons','imp','exp'].forEach(k => a[k] += +x[k] || 0); M.set(m, a); });
  const mk = [...M.keys()].sort().slice(-24), mv = mk.map(m => derive(M.get(m)));
  chart('cMonths', {type:'line', data:{labels:mk.map(m => MOIS[+m.slice(5)-1] + ' ' + m.slice(2,4)), datasets:[lineDs('Autoconsommation', mv.map(x => x.selfPct == null ? null : +x.selfPct.toFixed(1)), css('--sun')), lineDs('Autonomie', mv.map(x => x.autPct == null ? null : +x.autPct.toFixed(1)), css('--s1'))]},
    options:opts('%', o => { o.scales.y.max = 100; o.plugins.tooltip.callbacks.label = c => ' ' + c.dataset.label + ' : ' + nf0.format(c.parsed.y) + ' %'; })});
  // carte de chaleur consommation (heure × jour de semaine)
  const hm = Array.from({length:7}, () => Array(24).fill(0)), hn = Array.from({length:7}, () => Array(24).fill(0));
  H.forEach(x => { hm[x.wd][x.h] += x.c; hn[x.wd][x.h]++; });
  const vals = hm.flatMap((r,i) => r.map((v,j) => hn[i][j] ? v/hn[i][j] : 0)), mx = Math.max(...vals, 0.01);
  const order = [1,2,3,4,5,6,0];
  $('eHeat').innerHTML = '<div class="hm-row hm-h"><span></span>' + lab.map((l,i) => `<span>${i % 3 ? '' : l}</span>`).join('') + '</div>' +
    order.map(w => `<div class="hm-row"><span>${JOURS[w]}</span>${hm[w].map((v,h) => { const a = hn[w][h] ? v/hn[w][h] : 0; return `<i style="background:color-mix(in srgb,var(--s1) ${Math.round(a/mx*100)}%,var(--surface-2))" title="${JOURS[w]} ${h}h : ${nf2.format(a)} kWh"></i>`; }).join('')}</div>`).join('');
  // records
  const D = Object.entries(V.daily).map(([k,x]) => ({k, ...derive(x)}));
  const top = (f, lbl, u) => { const b = D.reduce((a,r) => (r[f] || 0) > (a ? a[f] || 0 : -1) ? r : a, null); return [lbl, b ? nf0.format(b[f]) + `<small>${u}</small>` : '–', b ? fmtDate(b.k) : '']; };
  const yr = new Map(); D.forEach(r => { const y = r.k.slice(0,4), a = yr.get(y) || {prod:0, cons:0}; a.prod += r.prod; a.cons += r.cons; yr.set(y, a); });
  const fy = [...yr.keys()].filter(y => D.filter(r => r.k.startsWith(y)).length > 360);
  $('eRec').innerHTML = [top('prod', 'Meilleur jour de production', 'kWh'), top('cons', 'Plus forte consommation', 'kWh'), top('exp', 'Plus grosse vente au réseau', 'kWh'),
    ['Production totale', nf1.format(D.reduce((s,r) => s + r.prod, 0)/1000) + '<small>MWh</small>', 'depuis ' + fmtDate(V.site.commissioned)],
    ['CO₂ évité ' + help('Estimation : 0,1 kg CO₂ par kWh solaire (mix suisse/européen moyen remplacé).'), nf1.format(D.reduce((s,r) => s + r.prod, 0) * 0.1 / 1000) + '<small>t</small>', 'depuis la mise en service'],
    ...(fy.length ? [['Production par année complète', fy.map(y => y + ' : ' + nf1.format(yr.get(y).prod/1000) + ' MWh').join('<br>'), '']] : [])].map(kpi).join('');
}

/* ---------- 3. Tarifs : GESA vs dynamique ---------- */
function costs(H, P, sizeOverride){
  const T = SET.tariff, Y = SET.dyn, vat = 1 + T.vat/100;
  const r = {imp:0, exp:0, gesaBuy:0, gesaSell:0, dynBuy:0, dynSell:0, impHT:0, impBT:0, n:0, missing:0, M:new Map()};
  H.forEach(x => {
    const spot = P.hour.get(x.ms); if (spot == null) { r.missing++; return; }
    const ht = isHT(x), gb = x.imp * (ht ? T.ht : T.bt) * vat / 100, gs = x.exp * (T.sell + T.hkn) / 100;
    const sellP = Y.floor ? Math.max(0, spot - Y.sellFee) : spot - Y.sellFee;
    const db = x.imp * (spot + (ht ? Y.gridHT : Y.gridBT)) * vat / 100, dsl = x.exp * sellP / 100;
    r.imp += x.imp; r.exp += x.exp; r.gesaBuy += gb; r.gesaSell += gs; r.dynBuy += db; r.dynSell += dsl; r.n++; if (ht) r.impHT += x.imp; else r.impBT += x.imp;
    const m = x.d.slice(0,7), a = r.M.get(m) || {imp:0, exp:0, gb:0, gs:0, db:0, ds:0, cons:0, prod:0}; a.imp += x.imp; a.exp += x.exp; a.gb += gb; a.gs += gs; a.db += db; a.ds += dsl; a.cons += x.c; a.prod += x.p; r.M.set(m, a);
  });
  r.gesaNet = r.gesaBuy - r.gesaSell; r.dynNet = r.dynBuy - r.dynSell; return r;
}
async function renderTariffs(){
  formTariff();
  const H0 = fullSeries(); if (!H0.length) { $('tLead').textContent = 'Données horaires en cours de récupération par le robot.'; return; }
  const P = await loadPrices();
  perChips('tRange');
  const pr = period(H0, S.per), sub = pr.H, r = costs(sub, P), synth = sub.filter(x => x.synth).length;
  const nd = r.n / 24, diff = r.dynNet - r.gesaNet;
  $('tLead').innerHTML = `Sur la période <b>${pr.label}</b> (${nf0.format(nd)} jours), votre électricité vous a coûté <b>${nf0.format(r.gesaNet)} CHF</b> net avec le tarif GESA (achats ${nf0.format(r.gesaBuy)} CHF − ventes ${nf0.format(r.gesaSell)} CHF). ` +
    `Avec un tarif <b>dynamique</b> (prix du marché ${P.zone === 'CH' ? 'suisse' : P.zone} heure par heure + réseau et taxes), ce serait <b>${nf0.format(r.dynNet)} CHF</b> : <b class="${diff <= 0 ? 'pos' : 'neg'}">${diff <= 0 ? 'économie de ' : 'surcoût de '}${nf0.format(Math.abs(diff))} CHF</b>.` + (synth ? ` <span class="muted">${nf0.format(synth/r.n*100)} % des heures sont reconstruites à partir des totaux journaliers et de vos profils horaires mesurés (SolarEdge ne fournit le détail horaire que sur 12 mois).</span>` : '');
  $('tKpis').innerHTML = [
    ['Acheté au réseau', nf0.format(r.imp) + '<small>kWh</small>', nf0.format(r.imp ? r.impHT/r.imp*100 : 0) + ' % en haut tarif'],
    ['Vendu au réseau', nf0.format(r.exp) + '<small>kWh</small>', 'repris à ' + nf2.format(SET.tariff.sell + SET.tariff.hkn) + ' ct par GESA'],
    ['Prix moyen payé · GESA', nf2.format(r.imp ? r.gesaBuy/r.imp*100 : 0) + '<small>ct/kWh</small>', 'TTC, énergie + réseau + taxes'],
    ['Prix moyen payé · dynamique', nf2.format(r.imp ? r.dynBuy/r.imp*100 : 0) + '<small>ct/kWh</small>', 'TTC, spot + réseau + taxes'],
    ['Prix moyen de vente · dynamique', nf2.format(r.exp ? r.dynSell/r.exp*100 : 0) + '<small>ct/kWh</small>', 'contre ' + nf2.format(SET.tariff.sell + SET.tariff.hkn) + ' ct avec GESA'],
    ['Tarif dynamique vs GESA', `<span class="${diff <= 0 ? 'pos' : 'neg'}">${sgn(diff)}</span><small>CHF</small>`, diff <= 0 ? 'moins cher avec le dynamique' : 'plus cher avec le dynamique : GESA reste avantageux'],
  ].map(kpi).join('');
  const mk = [...r.M.keys()].sort(), mv = mk.map(m => r.M.get(m));
  chart('cTar', {type:'bar', data:{labels:mk.map(m => MOIS[+m.slice(5)-1] + ' ' + m.slice(2,4)), datasets:[
    barDs('Coût net · GESA', mv.map(a => Math.round(a.gb - a.gs)), css('--sun'), 'a', {stack:undefined}), barDs('Coût net · dynamique', mv.map(a => Math.round(a.db - a.ds)), css('--s1'), 'b', {stack:undefined})]},
    options:opts('CHF', o => { o.scales.y.beginAtZero = true; o.scales.y.ticks.callback = v => nf0.format(v);
      o.plugins.tooltip.callbacks.label = c => ' ' + c.dataset.label + ' : ' + nf0.format(c.parsed.y) + ' CHF';
      o.plugins.tooltip.callbacks.afterBody = it => { const a = mv[it[0].dataIndex]; return ['Acheté ' + nf0.format(a.imp) + ' kWh · vendu ' + nf0.format(a.exp) + ' kWh']; }; })});
  // profil prix moyen par heure vs achat / vente
  const ph = Array(24).fill(0), pn = Array(24).fill(0), ih = Array(24).fill(0), eh = Array(24).fill(0);
  sub.forEach(x => { const s = P.hour.get(x.ms); if (s == null) return; ph[x.h] += s; pn[x.h]++; ih[x.h] += x.imp; eh[x.h] += x.exp; });
  chart('cTarH', {type:'bar', data:{labels:ph.map((_,h) => h + 'h'), datasets:[
    barDs('Achat moyen', ih.map((v,h) => pn[h] ? +(v/pn[h]).toFixed(2) : 0), css('--s1') + '99', 'x', {yAxisID:'y'}), barDs('Vente moyenne', eh.map((v,h) => pn[h] ? -(v/pn[h]).toFixed(2) : 0), css('--sun') + 'aa', 'x', {yAxisID:'y'}),
    lineDs('Prix du marché moyen', ph.map((v,h) => pn[h] ? +(v/pn[h]).toFixed(2) : null), css('--bad'), {yAxisID:'y1'})]},
    options:opts('kWh', o => { o.scales.x.stacked = true; o.scales.y.stacked = true; o.scales.y.ticks.callback = v => nf1.format(Math.abs(v));
      o.scales.y1 = {position:'right', grid:{display:false}, border:{display:false}, ticks:{color:css('--bad'), font:{size:11}, callback:v => nf0.format(v) + ' ct'}};
      o.plugins.tooltip.callbacks.label = c => c.dataset.yAxisID === 'y1' ? ' Prix moyen : ' + nf2.format(c.parsed.y) + ' ct/kWh' : ' ' + c.dataset.label + ' : ' + nf2.format(Math.abs(c.parsed.y)) + ' kWh/h'; })});
  $('tTable').innerHTML = '<thead><tr><th class="l">Mois</th><th>Achat kWh</th><th>Vente kWh</th><th>GESA achat</th><th>GESA vente</th><th>GESA net</th><th>Dyn. achat</th><th>Dyn. vente</th><th>Dyn. net</th><th>Écart</th></tr></thead><tbody>' +
    mk.map((m,i) => { const a = mv[i], g = a.gb - a.gs, d = a.db - a.ds; return `<tr><td class="l">${MOISL[+m.slice(5)-1]} ${m.slice(0,4)}</td><td>${nf0.format(a.imp)}</td><td>${nf0.format(a.exp)}</td><td>${nf0.format(a.gb)}</td><td>−${nf0.format(a.gs)}</td><td><b>${nf0.format(g)}</b></td><td>${nf0.format(a.db)}</td><td>−${nf0.format(a.ds)}</td><td><b>${nf0.format(d)}</b></td><td class="${d <= g ? 'pos' : 'neg'}">${sgn(d - g)}</td></tr>`; }).join('') +
    `<tr style="font-weight:800"><td class="l">Total</td><td>${nf0.format(r.imp)}</td><td>${nf0.format(r.exp)}</td><td>${nf0.format(r.gesaBuy)}</td><td>−${nf0.format(r.gesaSell)}</td><td>${nf0.format(r.gesaNet)}</td><td>${nf0.format(r.dynBuy)}</td><td>−${nf0.format(r.dynSell)}</td><td>${nf0.format(r.dynNet)}</td><td class="${diff <= 0 ? 'pos' : 'neg'}">${sgn(diff)}</td></tr></tbody>`;
}
function formTariff(){
  const T = SET.tariff, Y = SET.dyn;
  const field = (g, k, label, step, suf) => `<label>${label}<span class="inp"><input type="number" step="${step}" data-g="${g}" data-k="${k}" value="${SET[g][k]}">${suf ? `<em>${suf}</em>` : ''}</span></label>`;
  if (!$('tForm').dataset.ok) {
    $('tForm').innerHTML = `<div class="capanel"><h3>Tarif GESA « Double » (actuel)</h3><div class="form">
      ${field('tariff','ht','Haut tarif (tout compris, HT)', '0.01', 'ct/kWh')}${field('tariff','bt','Bas tarif (tout compris, HT)', '0.01', 'ct/kWh')}
      ${field('tariff','wdStart','Haut tarif dès', '1', 'h')}${field('tariff','wdEnd','Haut tarif jusqu\'à', '1', 'h')}
      <label class="toggle"><input type="checkbox" data-g="tariff" data-k="satHT" ${T.satHT ? 'checked' : ''}> Haut tarif aussi le samedi</label>
      ${field('tariff','sell','Reprise du solaire injecté', '0.01', 'ct/kWh')}${field('tariff','hkn','Garanties d\'origine (en plus)', '0.01', 'ct/kWh')}${field('tariff','vat','TVA sur l\'achat', '0.1', '%')}
      </div><p class="note">Par défaut : votre facture GESA du 1er trimestre 2025, tarif « Double interruptible », hors TVA. Tarif normal 26,16 ct = énergie 13,93 + acheminement 9,15 + services système 0,55 + taxes 2,53. Tarif réduit 20,25 ct = 12,01 + 5,16 + 0,55 + 2,53. Reprise 2026 : 9,00 ct (10,38 ct en 2025). Les montants fixes (7,50 + 11,08 CHF/mois) ne changent pas avec une batterie ou un tarif dynamique. Vérifiez les heures du tarif normal sur votre contrat.</p></div>
      <div class="capanel"><h3>Tarif dynamique (simulation)</h3><div class="form">
      ${field('dyn','gridHT','Réseau + taxes en heures pleines', '0.01', 'ct/kWh')}${field('dyn','gridBT','Réseau + taxes en heures creuses', '0.01', 'ct/kWh')}${field('dyn','sellFee','Frais retenus sur la vente', '0.01', 'ct/kWh')}
      <label>Marché de référence<select data-g="dyn" data-k="zone"><option value="CH">Suisse (horaire)</option><option value="DE-LU">Allemagne (15 min)</option><option value="FR">France (15 min)</option></select></label>
      <label class="toggle"><input type="checkbox" data-g="dyn" data-k="floor" ${Y.floor ? 'checked' : ''}> Vente jamais en dessous de 0</label>
      </div><p class="note">Achat = prix du marché de l'heure + acheminement, services système et taxes (selon heures pleines ou creuses, comme sur votre facture), puis TVA. Vente = prix du marché de l'heure (moins les frais). C'est le principe des offres dynamiques qui arrivent en Suisse.</p></div>`;
    $('tForm').dataset.ok = 1;
    $('tForm').querySelector('select').value = Y.zone;
    $('tForm').addEventListener('input', e => { const i = e.target; if (!i.dataset.g) return; SET[i.dataset.g][i.dataset.k] = i.type === 'checkbox' ? i.checked : i.tagName === 'SELECT' ? i.value : +i.value; if (i.dataset.k === 'zone') PRICE = null; save(); clearTimeout(S._t); S._t = setTimeout(() => S.view === 'tarifs' ? renderTariffs() : renderBattery(), 200); });
  }
}

/* ---------- 4. Batterie ---------- */
function prices(x, P, tariff){ // prix d'achat / de vente (CHF/kWh) de l'heure pour le tarif choisi
  const T = SET.tariff, Y = SET.dyn, vat = 1 + T.vat/100, ht = isHT(x), spot = P.hour.get(x.ms);
  if (spot == null) return null;
  if (tariff === 'gesa') return [(ht ? T.ht : T.bt) * vat / 100, (T.sell + T.hkn) / 100];
  return [(spot + (ht ? Y.gridHT : Y.gridBT)) * vat / 100, (Y.floor ? Math.max(0, spot - Y.sellFee) : spot - Y.sellFee) / 100];
}
function run(H, P, cap, tariff, mode){
  const B = SET.bat, eta = Math.sqrt(B.eff/100), pm = Math.min(+B.maxKw || 99, Math.max(0.5, cap * B.cRate)), us = cap * 0.9;
  const r = {cost:0, imp:0, exp:0, cyc:0, n:0, Y:new Map()};
  const add = (x, grid, bs) => { const c = grid > 0 ? grid * bs[0] : grid * bs[1]; r.cost += c; if (grid > 0) r.imp += grid; else r.exp -= grid; r.n++;
    const k = x.d.slice(0,4), y = r.Y.get(k) || {cost:0, n:0, imp:0, cons:0}; y.cost += c; y.n++; if (grid > 0) y.imp += grid; y.cons += x.c; r.Y.set(k, y); };
  if (!cap || mode !== 'smart') { // autoconsommation simple
    let soc = us * 0.3;
    for (const x of H) { const bs = prices(x, P, tariff); if (!bs) continue; let net = x.c - x.p;
      if (cap) { if (net < 0) { const ch = Math.min(-net, pm, (us - soc) / eta); soc += ch * eta; net += ch; r.cyc += ch; }
        else if (net > 0) { const dc = Math.min(net, pm, soc * eta); soc -= dc / eta; net -= dc; } }
      add(x, net, bs); }
    r.cycles = cap ? r.cyc / us : 0; return r;
  }
  // gestion intelligente : chaque jour, avec les prix du lendemain connus (marché day-ahead) et la production /
  // consommation de la journée, on choisit les seuils qui minimisent le coût : la batterie ne se décharge que
  // quand l'électricité est assez chère, et peut (option) se recharger depuis le réseau aux heures les moins chères.
  // Le cas « décharge toujours, jamais de recharge réseau » (= gestion simple) fait partie des choix : jamais pire.
  const gridOK = !!B.gridCharge, days = []; let cur = null;
  for (const x of H) { const bs = prices(x, P, tariff); if (!bs) continue; if (!cur || cur.d !== x.d) { cur = {d:x.d, hs:[]}; days.push(cur); } cur.hs.push([x, bs]); }
  let soc = us * 0.3;
  const sim = (hs, soc0, thrD, thrC, commit) => { let so = soc0, cost = 0, cyc = 0;
    for (const [x, bs] of hs) { let net = x.c - x.p;
      if (net < 0) { const ch = Math.min(-net, pm, (us - so) / eta); so += ch * eta; net += ch; cyc += ch; }
      else if (net > 0 && bs[0] >= thrD) { const dc = Math.min(net, pm, so * eta); so -= dc / eta; net -= dc; }
      if (gridOK && bs[0] <= thrC && so < us) { const room = Math.max(0, pm - Math.max(0, x.p - x.c)), ch = Math.min(room, (us - so) / eta); so += ch * eta; net += ch; cyc += ch; }
      cost += net > 0 ? net * bs[0] : net * bs[1]; if (commit) add(x, net, bs); }
    if (commit) r.cyc += cyc; return {cost, so}; };
  for (let k = 0; k < days.length; k++) {
    const hs = days[k].hs, nxt = days[k + 1] ? days[k + 1].hs : hs;
    const surplusN = nxt.reduce((a, h) => a + Math.max(0, h[0].p - h[0].c), 0);   // demain, le soleil suffira-t-il à remplir la batterie ?
    const val = surplusN >= us ? 0 : eta * nxt.reduce((a, h) => a + h[1][0], 0) / nxt.length * 0.85 * (1 - surplusN / us);   // valeur d'un kWh gardé pour demain
    const buys = [...new Set(hs.map(h => h[1][0]))].sort((a, b) => a - b);
    const thD = [-1e9, ...buys], thC = gridOK ? [-1e9, ...buys.slice(0, Math.max(1, Math.ceil(buys.length / 3)))] : [-1e9];
    let best = null;
    for (const d of thD) for (const c of thC) { if (c >= d && c > -1e9) continue; const o = sim(hs, soc, d, c, false), tot = o.cost - o.so * val; if (!best || tot < best.tot - 1e-9) best = {tot, d, c}; }
    soc = sim(hs, soc, best.d, best.c, true).so;
  }
  r.cycles = r.cyc / us; return r;
}
function finance(saving1, cap){
  const B = SET.bat, inv = cap ? cap * B.costKwh + B.costFix : 0, r = B.rate/100, cf = [-inv]; let npv = -inv, cum = -inv, pay = null, total = 0;
  for (let y = 1; y <= B.life; y++) { const sv = saving1 * Math.pow(1 - B.deg/100, y - 1); total += sv; npv += sv / Math.pow(1 + r, y); const prev = cum; cum += sv; cf.push(cum); if (pay == null && cum >= 0 && sv > 0) pay = y - 1 + (-prev) / sv; }
  return {inv, npv, pay, total, net:total - inv, cf};
}
async function renderBattery(){
  formBattery(); formTariff();
  const H0 = fullSeries(); if (!H0.length) { $('bLead').textContent = 'Données horaires en cours de récupération par le robot.'; return; }
  const P = await loadPrices();
  perChips('bPer');
  const pr = period(H0, S.per), H = pr.H, nd = H.length / 24, scale = 365 / nd;
  const sizes = SET.bat.sizes.split(/[,; ]+/).map(Number).filter(v => v >= 0 && isFinite(v)); if (!sizes.includes(0)) sizes.unshift(0); sizes.sort((a,b) => a - b);
  const mode = SET.bat.mode || 'smart', cons = H.reduce((a,x) => a + x.c, 0);
  chips('bMode', mode); $('bGrid').checked = !!SET.bat.gridCharge;
  const bG = run(H, P, 0, 'gesa', 'simple'), bD = run(H, P, 0, 'dyn', 'simple'), base = {imp:bG.imp, Y:bG.Y};
  const res = sizes.map(c => { const g = run(H, P, c, 'gesa', mode), d = run(H, P, c, 'dyn', mode);
    const sg = (bG.cost - g.cost) * scale, sd = (bD.cost - d.cost) * scale;
    return {c, s:g, sm:d, sg, sd, fg:finance(sg, c), fd:finance(sd, c), aut:cons ? (1 - g.imp / cons) * 100 : 0}; });
  const cand = res.filter(x => x.c > 0), best = k => cand.reduce((a,x) => x[k].npv > a[k].npv ? x : a, cand[0]);
  const bestG = best('fg'), bestD = best('fd');
  if (S.bsize == null || !sizes.includes(S.bsize)) S.bsize = bestG.c;
  const sel = res.find(x => x.c === S.bsize) || cand[0], L = SET.bat.life;
  const verdict = f => f.npv > 0 ? `<b class="pos">rentable</b> : remboursée en <b>${nf1.format(f.pay)} ans</b>, puis ${nf0.format(f.net)} CHF gagnés sur ${L} ans` : `<b class="neg">pas rentable</b> sur ${L} ans${f.pay ? ' (remboursée en ' + nf1.format(f.pay) + ' ans, mais le gain actualisé reste négatif)' : ''}`;
  const synth = H.filter(x => x.synth).length;
  $('bLead').innerHTML = `Gestion <b>${mode === 'smart' ? 'intelligente' + (SET.bat.gridCharge ? ' avec recharge depuis le réseau' : '') : 'simple (autoconsommation)'}</b>. Calcul sur la période <b>${pr.label}</b> (${nf0.format(nd)} jours, ramené à une année). Avec le <b>tarif GESA actuel</b>, la taille la plus rentable est <b>${nf0.format(bestG.c)} kWh</b> : ${verdict(bestG.fg)}. ` +
    `Avec un <b>tarif dynamique</b>, c'est <b>${nf0.format(bestD.c)} kWh</b> : ${verdict(bestD.fd)}.` +
    (synth ? ` <span class="muted">${nf0.format(synth/H.length*100)} % des heures sont reconstruites à partir de vos totaux journaliers et profils horaires mesurés.</span>` : '');
  $('bSizes').innerHTML = cand.map(x => `<button data-r="${x.c}" aria-pressed="${x.c === S.bsize}">${nf0.format(x.c)} kWh${x === bestG ? ' ★' : ''}</button>`).join('');
  $('bKpis').innerHTML = [
    ['Prix de la batterie', nf0.format(sel.fg.inv) + '<small>CHF</small>', nf0.format(sel.c) + ' kWh × ' + nf0.format(SET.bat.costKwh) + ' CHF + ' + nf0.format(SET.bat.costFix) + ' CHF de pose'],
    ['Économie la 1re année', nf0.format(sel.sg) + '<small>CHF</small>', 'GESA · ' + nf0.format(sel.sd) + ' CHF avec un tarif dynamique'],
    ['Retour sur investissement', sel.fg.pay ? nf1.format(sel.fg.pay) + '<small>ans</small>' : '<span class="neg">jamais</span>', 'GESA · ' + (sel.fd.pay ? nf1.format(sel.fd.pay) + ' ans en dynamique' : 'jamais en dynamique')],
    [`Économies totales sur ${L} ans`, nf0.format(sel.fg.total) + '<small>CHF</small>', `gain net <b class="${sel.fg.net >= 0 ? 'pos' : 'neg'}">${sgn(sel.fg.net)} CHF</b> (GESA)`],
    ['Autonomie', nf0.format(sel.aut) + '<small>%</small>', 'contre ' + nf0.format(res[0].aut) + ' % sans batterie'],
    ['Cycles par an ' + help('Charges complètes équivalentes par an. Une batterie lithium (LFP) supporte en général 6 000 cycles ou plus.'), nf0.format(sel.s.cycles * scale) + '<small>cycles</small>', 'achat réseau évité : ' + nf0.format((bG.imp - sel.s.imp) * scale) + ' kWh/an (GESA)'],
  ].map(kpi).join('');
  const lab = res.map(x => nf0.format(x.c) + ' kWh');
  chart('cBatNpv', {type:'bar', data:{labels:lab, datasets:[
    barDs('Gain net actualisé · GESA', res.map(x => Math.round(x.fg.npv)), css('--sun'), 'a', {stack:undefined}),
    barDs('Gain net actualisé · dynamique', res.map(x => Math.round(x.fd.npv)), css('--s1'), 'b', {stack:undefined})]},
    options:opts('CHF', o => { o.scales.y.beginAtZero = false; o.scales.y.ticks.callback = v => nf0.format(v);
      o.plugins.tooltip.callbacks.label = c => ' ' + c.dataset.label + ' : ' + sgn(c.parsed.y) + ' CHF';
      o.plugins.tooltip.callbacks.afterBody = it => { const x = res[it[0].dataIndex]; return ['Économie/an : ' + nf0.format(x.sg) + ' CHF (GESA) · ' + nf0.format(x.sd) + ' CHF (dynamique)', 'Retour : ' + (x.fg.pay ? nf1.format(x.fg.pay) + ' ans' : 'jamais') + ' · autonomie ' + nf0.format(x.aut) + ' %']; }; })});
  // flux cumulés sur la durée de vie (taille choisie)
  const yrs = Array.from({length:L + 1}, (_, i) => i === 0 ? 'Achat' : 'An ' + i);
  chart('cBatCum', {type:'line', data:{labels:yrs, datasets:[
    lineDs('Tarif GESA', sel.fg.cf.map(Math.round), css('--sun'), {fill:{target:{value:0}, above:css('--good') + '22', below:css('--bad') + '18'}, pointRadius:3}),
    lineDs('Tarif dynamique', sel.fd.cf.map(Math.round), css('--s1'), {pointRadius:3})]},
    options:opts('CHF', o => { o.scales.y.beginAtZero = false; o.scales.y.ticks.callback = v => nf0.format(v);
      o.plugins.tooltip.callbacks.label = c => ' ' + c.dataset.label + ' : ' + sgn(c.parsed.y) + ' CHF'; })});
  $('bCumSub').textContent = `Batterie de ${nf0.format(sel.c)} kWh : on part du prix d'achat (${nf0.format(sel.fg.inv)} CHF) et on ajoute les économies de chaque année. La courbe passe au-dessus de zéro quand la batterie est remboursée.`;
  // économies par année réelle de la période (taille choisie)
  const yk = [...bG.Y.keys()].sort(), yv = yk.map(y => { const g0 = bG.Y.get(y), d0 = bD.Y.get(y) || g0, g1 = sel.s.Y.get(y) || g0, d1 = sel.sm.Y.get(y) || d0; return {y, days:g0.n / 24, g:g0.cost - g1.cost, d:d0.cost - d1.cost}; });
  chart('cBatYear', {type:'bar', data:{labels:yv.map(x => x.y + (x.days < 360 ? '*' : '')), datasets:[
    barDs('Économies · GESA', yv.map(x => Math.round(x.g)), css('--sun'), 'a', {stack:undefined}), barDs('Économies · dynamique', yv.map(x => Math.round(x.d)), css('--s1'), 'b', {stack:undefined})]},
    options:opts('CHF', o => { o.plugins.tooltip.callbacks.afterBody = it => { const x = yv[it[0].dataIndex]; return x.days < 360 ? nf0.format(x.days) + ' jours seulement dans la période' : ''; }; })});
  $('bTable').innerHTML = '<thead><tr><th class="l">Taille</th><th>Prix</th><th>Autonomie</th><th>Économie/an GESA</th><th>Retour GESA</th><th>Total ' + L + ' ans GESA</th><th>Gain net GESA</th><th>Économie/an dyn.</th><th>Retour dyn.</th><th>Gain net dyn.</th></tr></thead><tbody>' +
    cand.map(x => `<tr${x === bestG ? ' style="background:var(--sun-soft)"' : ''}><td class="l">${nf0.format(x.c)} kWh${x === bestG ? ' ★' : ''}</td><td>${nf0.format(x.fg.inv)}</td><td>${nf0.format(x.aut)} %</td><td>${nf0.format(x.sg)}</td><td>${x.fg.pay ? nf1.format(x.fg.pay) + ' ans' : 'jamais'}</td><td>${nf0.format(x.fg.total)}</td><td class="${x.fg.net >= 0 ? 'pos' : 'neg'}">${sgn(x.fg.net)}</td><td>${nf0.format(x.sd)}</td><td>${x.fd.pay ? nf1.format(x.fd.pay) + ' ans' : 'jamais'}</td><td class="${x.fd.net >= 0 ? 'pos' : 'neg'}">${sgn(x.fd.net)}</td></tr>`).join('') + '</tbody>';
}
function formBattery(){
  if ($('bForm').dataset.ok) return;
  const B = SET.bat, f = (k, label, step, suf) => `<label>${label}<span class="inp"><input type="number" step="${step}" data-k="${k}" value="${B[k]}">${suf ? `<em>${suf}</em>` : ''}</span></label>`;
  $('bForm').innerHTML = `<div class="form">${f('costKwh','Prix par kWh de batterie','10','CHF')}${f('costFix','Pose, onduleur, frais fixes','100','CHF')}${f('life','Durée de vie','1','ans')}${f('deg','Perte de capacité','0.5','%/an')}
    ${f('eff','Rendement charge + décharge','1','%')}${f('cRate','Puissance (kW par kWh)','0.1','')}${f('maxKw','Puissance maximale','1','kW')}${f('rate','Taux d\'actualisation','0.5','%')}<label>Tailles à comparer<span class="inp"><input type="text" data-k="sizes" value="${B.sizes}"><em>kWh</em></span></label></div>`;
  $('bForm').dataset.ok = 1;
  $('bForm').addEventListener('input', e => { const i = e.target; if (!i.dataset.k) return; SET.bat[i.dataset.k] = i.dataset.k === 'sizes' ? i.value : +i.value; save(); clearTimeout(S._b); S._b = setTimeout(renderBattery, 300); });
}

/* ---------- démarrage ---------- */
try { const t = localStorage.getItem('pi-theme'); if (t) document.documentElement.dataset.theme = t; } catch(e){}
$('themeBtn').onclick = () => { const r = document.documentElement, cur = r.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), n = cur === 'dark' ? 'light' : 'dark'; r.dataset.theme = n; try { localStorage.setItem('pi-theme', n); } catch(e){} render(); };
$('vtabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setView(b.dataset.v); });
onChips('dRange', r => { S.range = r; renderDash(); });
$('dDays').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { S.day = b.dataset.r; renderDayCurve(); } });
onChips('eSeason', r => { S.season = r; renderEnergy(); });
onChips('tRange', r => { S.per = r; renderTariffs(); });
onChips('bSizes', r => { S.bsize = +r; renderBattery(); });
onChips('bPer', r => { S.per = r; renderBattery(); });
onChips('bMode', r => { SET.bat.mode = r; save(); renderBattery(); });
$('bGrid').addEventListener('change', e => { SET.bat.gridCharge = e.target.checked; save(); renderBattery(); });
loadAll().then(() => { setView(location.hash.slice(1) || 'dash'); window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v && v !== S.view) setView(v); }); });
window.VB = {run, costs, fullSeries, hourlySeries, get V(){ return V; }, loadPrices};
})();
