/* PolyImmo Solaire — onglet « Prix du marché » et simulation de vente au prix spot (15 min)
   Prix : data/prices_<zone>.json (energy-charts.info, mis à jour chaque jour par GitHub Actions)
   Production 15 min : data/power15.v64 (Aurora Vision, kW ×10, compressé) · Taux : data/fx_eurchf.json (BCE) */
'use strict';
(function(){
const PI = window.PI = window.PI || {};
const el = id => document.getElementById(id);
const ZONES = {CH:'Suisse', 'DE-LU':'Allemagne-Luxembourg', FR:'France'};
const TZ = 'Europe/Zurich';
const S = {zone:'CH', unit:'ct', range:'today', sim:'12m', neg:false, fee:0, ht:true};
const cache = {prices:{}, power:null, fx:null};
let busy = false;

/* ---------- fuseau horaire (rapide) ---------- */
const fmtParts = new Intl.DateTimeFormat('en-GB', {timeZone:TZ, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false});
const offCache = new Map();
function offset(u){ const k = Math.floor(u / 3600); if (offCache.has(k)) return offCache.get(k);
  const p = Object.fromEntries(fmtParts.formatToParts(new Date(k*3600*1000)).map(x => [x.type, x.value]));
  const loc = Date.UTC(+p.year, +p.month-1, +p.day, +p.hour % 24, +p.minute) / 1000; const o = loc - k*3600; offCache.set(k, o); return o; }
const local = u => new Date((u + offset(u)) * 1000);           // Date dont les champs UTC = heure locale
const lday = u => local(u).toISOString().slice(0,10);
const lhm = u => local(u).toISOString().slice(11,16);

/* ---------- chargement ---------- */
async function loadPrices(z){ if (cache.prices[z]) return cache.prices[z];
  const d = await (await fetch('data/prices_' + z + '.json', {cache:'no-store'})).json(); cache.prices[z] = d; return d; }
async function loadFx(){ if (cache.fx) return cache.fx; const d = await (await fetch('data/fx_eurchf.json', {cache:'no-store'})).json(); cache.fx = d.rates; return cache.fx; }
async function loadPower(){
  if (cache.power) return cache.power;
  const s = (await (await fetch('data/power15.v64', {cache:'no-store'})).text()).trim(), bin = atob(s), b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  let i = 0; const vint = () => { let x = 0, sh = 0, c; do { c = b[i++]; x |= (c & 127) << sh; sh += 7; } while (c >= 128); return x; };
  const v = [];
  while (i < b.length) { const z = vint(), c = vint(); for (let k = 0; k < z; k++) v.push(0); let p = 0; for (let k = 0; k < c; k++) { const d = vint(); p += (d & 1) ? -(d + 1) / 2 : d / 2; v.push(p); } }
  cache.power = {start:1761082200, step:900, kw:Float32Array.from(v, x => x / 10)}; return cache.power;
}
function fxAt(rates, day){ if (rates[day]) return rates[day]; const ks = Object.keys(rates).sort(); let best = ks[0]; for (const k of ks) { if (k <= day) best = k; else break; } return rates[best]; }
const priceAt = (P, u) => { const i = Math.round((u - P.start) / 900); return i >= 0 && i < P.values.length ? P.values[i] : null; };
const powerAt = (W, u) => { const i = Math.round((u - W.start) / 900); return i >= 0 && i < W.kw.length ? W.kw[i] : null; };
const toCt = (eurMwh, fx) => eurMwh * fx / 10;          // EUR/MWh → ct CHF/kWh
const fmtP = v => S.unit === 'ct' ? PI.nf2.format(v) + ' ct/kWh' : PI.nf1.format(v) + ' €/MWh';

/* ---------- PRIX ---------- */
function rangeBounds(P){
  const lastU = P.start + 900 * (P.values.length - 1);
  const nowDay = lday(Math.floor(Date.now()/1000)), tom = PI.addDays(nowDay, 1);
  const dayBounds = d => { let a = null, b = null; for (let u = P.start; u <= lastU; u += 900) { const ld = lday(u); if (ld === d) { if (a == null) a = u; b = u; } else if (a != null) break; } return [a, b]; };
  if (S.range === 'today') return dayBounds(nowDay).concat(['Aujourd\'hui ' + PI.fmtDate(nowDay)]);
  if (S.range === 'tomorrow') return dayBounds(tom).concat(['Demain ' + PI.fmtDate(tom)]);
  const n = {'7':7, '30':30, '12m':365}[S.range]; const endDay = nowDay; const startDay = PI.addDays(endDay, -n + 1);
  const a = dayBounds(startDay)[0] || P.start, b = dayBounds(endDay)[1] || lastU;
  return [a, b, S.range === '12m' ? '12 derniers mois' : n + ' derniers jours'];
}
async function renderPrices(){
  const [P, fx] = await Promise.all([loadPrices(S.zone), loadFx()]);
  let W = null; try { W = await loadPower(); } catch(e) { console.warn(e); }
  const lastU = P.start + 900 * (P.values.length - 1), hasTom = lday(lastU) > lday(Math.floor(Date.now()/1000));
  el('pxTomorrow').disabled = !hasTom; el('pxTomorrow').title = hasTom ? '' : 'Les prix de demain sont publiés vers 13 h';
  if (S.range === 'tomorrow' && !hasTom) S.range = 'today';
  document.querySelectorAll('#pxZone button').forEach(b => b.setAttribute('aria-pressed', b.dataset.r === S.zone));
  document.querySelectorAll('#pxUnit button').forEach(b => b.setAttribute('aria-pressed', b.dataset.r === S.unit));
  document.querySelectorAll('#pxRange button').forEach(b => b.setAttribute('aria-pressed', b.dataset.r === S.range));
  const [a, b, label] = rangeBounds(P);
  if (a == null) { el('pxKpis').innerHTML = '<div class="kpi"><div class="k">Pas de prix pour cette période</div></div>'; return; }
  const conv = (v, u) => v == null ? null : (S.unit === 'ct' ? toCt(v, fxAt(fx, lday(u))) : v);
  const pts = []; for (let u = a; u <= b; u += 900) pts.push([u, conv(priceAt(P, u), u), W ? powerAt(W, u) : null]);
  const ok = pts.filter(p => p[1] != null);
  const avg = ok.reduce((s,p)=>s+p[1],0) / ok.length;
  const mn = ok.reduce((m,p) => p[1] < m[1] ? p : m, ok[0]), mx = ok.reduce((m,p) => p[1] > m[1] ? p : m, ok[0]);
  const neg = ok.filter(p => p[1] < 0).length;
  const wp = ok.filter(p => p[2] != null && p[2] > 0), wk = wp.reduce((s,p)=>s+p[2],0), cap = wk ? wp.reduce((s,p)=>s+p[1]*p[2],0) / wk : null;
  const rq = PI.ENTRY ? Object.keys(PI.ENTRY.pricesActual).sort() : [], lastQ = rq[rq.length-1], grd = lastQ ? PI.ENTRY.pricesActual[lastQ] : null;
  const when = u => (S.range === 'today' || S.range === 'tomorrow') ? 'à ' + lhm(u) : PI.fmtDate(lday(u)) + ' à ' + lhm(u);
  const help = t => `<span class="help" tabindex="0" data-tip="${t}">?</span>`;
  const kp = [
    ['Prix moyen · ' + ZONES[S.zone], fmtP(avg), label],
    ['Prix le plus bas', fmtP(mn[1]), when(mn[0])],
    ['Prix le plus haut', fmtP(mx[1]), when(mx[0])],
    ['Prix négatifs ' + help('Quarts d’heure où le prix de marché est sous zéro : le producteur paie pour injecter.'), PI.nf0.format(neg) + '<small>quarts d’heure</small>', neg ? PI.nf1.format(neg/ok.length*100) + ' % de la période' : 'aucun sur la période'],
    ['Prix « solaire » ' + help('Prix moyen pondéré par votre production : ce que vous auriez réellement touché au prix du marché.'), cap != null ? fmtP(cap) : '–', cap != null ? 'pondéré par votre production' : 'pas de production sur la période'],
    ['Votre prix GRD ' + help('Prix moyen de reprise de votre dernière facture du GRD (TTC).'), grd != null ? PI.nf2.format(grd) + '<small>ct/kWh</small>' : '–', lastQ ? 'facture ' + lastQ.replace('-T',' T') + ' (TTC)' : ''],
  ];
  el('pxKpis').innerHTML = kp.map(([k,v,d]) => `<div class="kpi"><div class="k">${k}</div><div class="v num" style="font-size:1.5rem">${v}</div><div class="d">${d}</div></div>`).join('');
  // graphique des prix
  const css = PI.css, unitLbl = S.unit === 'ct' ? 'ct/kWh' : '€/MWh';
  const short = S.range === 'today' || S.range === 'tomorrow' || S.range === '7';
  let labels, ds, opt;
  if (S.range === '12m' || S.range === '30') {
    const byD = new Map(); ok.forEach(p => { const d = lday(p[0]); const x = byD.get(d) || {s:0, n:0, mn:Infinity, mx:-Infinity}; x.s += p[1]; x.n++; x.mn = Math.min(x.mn, p[1]); x.mx = Math.max(x.mx, p[1]); byD.set(d, x); });
    const ks = [...byD.keys()]; labels = ks.map(d => { const t = PI.D(d); return t.getDate() + ' ' + PI.MOIS[t.getMonth()] + (S.range === '12m' ? ' ' + String(t.getFullYear()).slice(2) : ''); });
    ds = [{label:'Maximum du jour', data:ks.map(d => +byD.get(d).mx.toFixed(2)), borderColor:'transparent', backgroundColor:css('--s1') + '22', pointRadius:0, fill:'+1', tension:.2},
          {label:'Minimum du jour', data:ks.map(d => +byD.get(d).mn.toFixed(2)), borderColor:'transparent', backgroundColor:'transparent', pointRadius:0, fill:false, tension:.2},
          {label:'Prix moyen du jour', data:ks.map(d => +(byD.get(d).s/byD.get(d).n).toFixed(2)), borderColor:css('--s1'), borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:.25, fill:false}];
    el('pxNote').textContent = 'Ligne : prix moyen de chaque jour · zone claire : du prix le plus bas au plus haut de la journée.';
  } else {
    labels = pts.map(p => S.range === '7' ? PI.MOIS[local(p[0]).getUTCMonth()] && (['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'][local(p[0]).getUTCDay()] + ' ' + local(p[0]).getUTCDate() + ' · ' + lhm(p[0])) : lhm(p[0]));
    ds = [{label:'Prix', data:pts.map(p => p[1] == null ? null : +p[1].toFixed(3)), borderColor:css('--s1'), borderWidth:2, stepped:true, pointRadius:0, pointHoverRadius:4,
      fill:{target:{value:0}, above:css('--s1') + '1f', below:css('--bad') + '30'}, segment:{borderColor: c => c.p1.parsed.y < 0 ? css('--bad') : css('--s1')}}];
    el('pxNote').textContent = 'Prix au quart d\'heure (marché day-ahead' + (S.zone === 'CH' ? ', la Suisse est publiée à l\'heure : chaque prix horaire est appliqué à ses 4 quarts d\'heure' : '') + '). En rouge : prix négatif.';
  }
  PI.makeChart('cPx', {type:'line', data:{labels, datasets:ds}, options:PI.baseOpts(unitLbl, o => {
    o.scales.y.beginAtZero = false; o.scales.y.ticks.callback = v => S.unit === 'ct' ? PI.nf1.format(v) : PI.nf0.format(v);
    o.scales.y.grid.color = c => c.tick.value === 0 ? css('--muted') : css('--grid');
    o.plugins.tooltip.callbacks.label = c => ' ' + c.dataset.label + ' : ' + fmtP(c.parsed.y);
    if (S.range === '7') o.scales.x.ticks.callback = function(v){ const l = this.getLabelForValue(v); return l.endsWith('· 12:00') ? l.split(' · ')[0] : ''; }, o.scales.x.ticks.autoSkip = false;
    if (S.range === 'today' || S.range === 'tomorrow') o.scales.x.ticks.maxTicksLimit = 9;
  })});
  // production au même moment (jours) / profil horaire (périodes longues)
  const pw = el('pxPowWrap');
  if (short && W && pts.some(p => p[2] != null && p[2] > 0)) {
    pw.classList.remove('hidden'); el('pxPowTitle').textContent = 'Votre production au même moment (kW)';
    const sun = css('--sun');
    PI.makeChart('cPxPow', {type:'line', data:{labels, datasets:[{label:'Production', data:pts.map(p => p[2] == null ? null : +p[2].toFixed(1)), borderColor:sun, backgroundColor:sun + '33', fill:true, borderWidth:1.6, pointRadius:0, tension:.25}]},
      options:PI.baseOpts('kW', o => { o.plugins.tooltip.callbacks.label = c => ' ' + PI.nf1.format(c.parsed.y) + ' kW'; o.scales.x.ticks = Object.assign({}, charts('cPx').options.scales.x.ticks); })});
  } else if (!short) {
    pw.classList.remove('hidden'); el('pxPowTitle').textContent = 'Journée type : prix moyen par heure et votre production moyenne';
    const hp = Array(24).fill(0), hn = Array(24).fill(0), hw = Array(24).fill(0), hwn = Array(24).fill(0);
    ok.forEach(p => { const h = local(p[0]).getUTCHours(); hp[h] += p[1]; hn[h]++; if (p[2] != null) { hw[h] += p[2]; hwn[h]++; } });
    const lab = hp.map((_,h) => h + 'h');
    PI.makeChart('cPxPow', {type:'bar', data:{labels:lab, datasets:[
      {label:'Prix moyen', type:'line', data:hp.map((s,h) => hn[h] ? +(s/hn[h]).toFixed(2) : null), borderColor:css('--s1'), backgroundColor:css('--s1'), borderWidth:2, pointRadius:2, tension:.3, yAxisID:'y'}]},
      options:PI.baseOpts(unitLbl, o => { o.scales.y.beginAtZero = false; o.plugins.tooltip.callbacks.label = c => ' Prix moyen : ' + fmtP(c.parsed.y);
        o.plugins.tooltip.callbacks.afterLabel = c => { const h = c.dataIndex; return hwn[h] ? 'Votre production moyenne : ' + PI.nf1.format(hw[h]/hwn[h]) + ' kW' : ''; }; })});
    const peak = hw.map((s,h) => hwn[h] ? s/hwn[h] : 0); const tot = peak.reduce((a,b)=>a+b,0);
    el('pxPowNote').textContent = tot ? 'Votre production se concentre entre ' + peak.findIndex(x => x > tot*0.02) + 'h et ' + (23 - [...peak].reverse().findIndex(x => x > tot*0.02)) + 'h : c\'est là que le prix compte (survolez pour voir votre production moyenne à chaque heure).' : '';
  } else pw.classList.add('hidden');
  if (short) el('pxPowNote').textContent = '';
}
const charts = id => PI.charts[id];

/* ---------- SIMULATION ---------- */
function simBounds(W){
  const end = W.start + 900 * (W.kw.length - 1);
  const qb = q => { const y = +q.slice(0,4), t = +q.slice(-1); return [`${y}-${String(3*t-2).padStart(2,'0')}-01`, PI.iso(new Date(y, 3*t, 0, 12))]; };
  if (S.sim === '12m') { const d = local(end); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)); const f = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth()-11, 1));
    return [f.toISOString().slice(0,10), last.toISOString().slice(0,10), '12 derniers mois complets']; }
  const [f, t] = qb(S.sim); return [f, t, 'T' + S.sim.slice(-1) + ' ' + S.sim.slice(0,4)];
}
async function renderSim(){
  const [P, fx] = await Promise.all([loadPrices(S.zone), loadFx()]);
  let W; try { W = await loadPower(); } catch(e) { el('simKpis').textContent = 'Production au quart d\'heure indisponible.'; return; }
  // trimestres entièrement couverts par la production 15 min et facturés
  const firstDay = lday(W.start + 900*4*24), lastDay = lday(W.start + 900*(W.kw.length-1));
  const qs = PI.ENTRY ? Object.keys(PI.ENTRY.revenueActual).sort().filter(q => { const y = +q.slice(0,4), t = +q.slice(-1); return `${y}-${String(3*t-2).padStart(2,'0')}-01` >= firstDay && PI.iso(new Date(y, 3*t, 0, 12)) <= lastDay; }) : [];
  const box = el('simRange'); if (box.dataset.q !== qs.join()) { box.innerHTML = '<button data-r="12m">12 derniers mois</button>' + qs.map(q => `<button data-r="${q}">T${q.slice(-1)} ${q.slice(0,4)}</button>`).join(''); box.dataset.q = qs.join(); }
  document.querySelectorAll('#simRange button').forEach(b => b.setAttribute('aria-pressed', b.dataset.r === S.sim));
  document.querySelectorAll('#simZone button').forEach(b => b.setAttribute('aria-pressed', b.dataset.r === S.zone));
  el('simNeg').checked = S.neg; el('simHt').checked = S.ht; el('simFee').value = S.fee; el('simFeeV').textContent = PI.nf2.format(S.fee) + ' ct/kWh';
  const [f, t, lab] = simBounds(W);
  const vat = S.ht ? 1.081 : 1;
  const grdPrice = q => { const r = PI.ENTRY; if (r && r.pricesActual[q] != null) return {p:r.pricesActual[q] / vat, est:false};
    const same = r ? Object.keys(r.pricesActual).filter(k => k.endsWith(q.slice(4))).sort().pop() : null; return {p: same ? r.pricesActual[same] / vat : null, est:true, from:same}; };
  // agrégation par mois
  const M = new Map(); let negK = 0, negC = 0, lostK = 0, kTot = 0, mTot = 0, gTot = 0, sumP = 0, nP = 0, est = false;
  for (let i = 0; i < W.kw.length; i++) {
    const u = W.start + 900*i, d = lday(u); if (d < f || d > t) continue;
    const eur = priceAt(P, u); if (eur == null) continue;
    const ct = toCt(eur, fxAt(fx, d)); sumP += ct; nP++;
    const kwh = W.kw[i] * 0.25; if (!kwh) continue;
    const m = d.slice(0,7), x = M.get(m) || {kwh:0, mkt:0, grd:0, est:false}; const q = PI.qOf(d), g = grdPrice(q);
    let sold = kwh, rev;
    if (ct < 0) { negK += kwh; if (S.neg) { sold = 0; lostK += kwh; } else negC += kwh * ct / 100; }
    rev = sold * (ct - S.fee) / 100;
    x.kwh += kwh; x.mkt += rev; x.grd += kwh * (g.p || 0) / 100; if (g.est) { x.est = true; est = true; }
    M.set(m, x); kTot += kwh; mTot += rev; gTot += kwh * (g.p || 0) / 100;
  }
  const avgMkt = sumP / nP, capt = (mTot / (kTot - lostK)) * 100 + S.fee, diff = mTot - gTot;
  const css = PI.css, nf0 = PI.nf0, nf1 = PI.nf1, nf2 = PI.nf2;
  el('simLead').innerHTML = `Sur la période <b>${S.sim === '12m' ? lab.toLowerCase() : 'du trimestre ' + lab}</b> (${PI.fmtDate(f)} → ${PI.fmtDate(t)}), en vendant chaque quart d'heure de votre production au prix du marché <b>${ZONES[S.zone]}</b>, vous auriez touché <b>${nf0.format(mTot)} CHF</b>, contre <b>${nf0.format(gTot)} CHF</b> avec le GRD${S.ht ? ' (hors TVA)' : ''} : soit <b style="color:${diff >= 0 ? 'var(--good)' : 'var(--bad)'}">${diff >= 0 ? '+' : '−'}${nf0.format(Math.abs(diff))} CHF (${diff >= 0 ? '+' : '−'}${nf1.format(Math.abs(diff/gTot*100))} %)</b>.`;
  const help = s => `<span class="help" tabindex="0" data-tip="${s}">?</span>`;
  const kp = [
    ['Au prix du marché', nf0.format(mTot) + '<small>CHF</small>', nf0.format(kTot) + ' kWh produits' + (S.neg && lostK ? ' · ' + nf0.format(lostK) + ' kWh non vendus' : '')],
    ['Avec le GRD' + (S.ht ? ' (HT)' : ' (TTC)'), nf0.format(gTot) + '<small>CHF</small>', 'prix réels de vos factures' + (est ? ' · un trimestre estimé' : '')],
    ['Différence', (diff >= 0 ? '+' : '−') + nf0.format(Math.abs(diff)) + '<small>CHF</small>', `<span class="trend ${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '▲' : '▼'} ${nf1.format(Math.abs(diff/gTot*100))} %</span> marché vs GRD`],
    ['Prix capté ' + help('Prix moyen réellement obtenu sur votre production (pondéré par les kWh), avant frais.'), nf2.format(capt) + '<small>ct/kWh</small>', 'prix moyen du marché : ' + nf2.format(avgMkt) + ' ct'],
    ['Facteur de capture ' + help('Prix capté ÷ prix moyen du marché. Sous 100 % : le solaire produit surtout quand le prix est bas.'), nf0.format(capt/avgMkt*100) + '<small>%</small>', capt < avgMkt ? 'le solaire vend aux heures moins chères' : 'production bien valorisée'],
    ['Production à prix négatif', nf0.format(negK) + '<small>kWh</small>', S.neg ? 'injection coupée dans la simulation' : (negC ? 'coût : ' + nf0.format(-negC) + ' CHF' : 'aucun coût')],
  ];
  el('simKpis').innerHTML = kp.map(([k,v,d]) => `<div class="kpi"><div class="k">${k}</div><div class="v num" style="font-size:1.5rem">${v}</div><div class="d">${d}</div></div>`).join('');
  const ks = [...M.keys()].sort(), labels = ks.map(m => PI.MOIS[+m.slice(5,7)-1] + ' ' + m.slice(2,4) + (M.get(m).est ? '*' : ''));
  const bar = (label, data, c) => ({label, data, backgroundColor:c, borderRadius:{topLeft:5,topRight:5}, borderSkipped:'bottom', maxBarThickness:28, categoryPercentage:.8, barPercentage:.9});
  PI.makeChart('cSim', {type:'bar', data:{labels, datasets:[bar('Prix du marché', ks.map(m => Math.round(M.get(m).mkt)), css('--s1')), bar('GRD', ks.map(m => Math.round(M.get(m).grd)), css('--sun'))]},
    options:PI.baseOpts('CHF', o => { o.plugins.legend = {display:true, position:'top', align:'end', labels:{boxWidth:10, boxHeight:10, color:css('--ink-2'), font:{size:11, weight:'600'}}};
      o.plugins.tooltip.callbacks.afterBody = it => { const x = M.get(ks[it[0].dataIndex]); return [nf0.format(x.kwh) + ' kWh', 'Marché : ' + nf2.format(x.mkt/x.kwh*100) + ' ct/kWh · GRD : ' + nf2.format(x.grd/x.kwh*100) + ' ct/kWh', x.est ? '* prix GRD estimé (trimestre pas encore facturé)' : '']; }; })});
  PI.makeChart('cSimP', {type:'line', data:{labels, datasets:[
    {label:'Prix capté au marché', data:ks.map(m => +(M.get(m).mkt/M.get(m).kwh*100).toFixed(2)), borderColor:css('--s1'), backgroundColor:css('--s1'), borderWidth:2.2, pointRadius:3, tension:.3},
    {label:'Prix GRD', data:ks.map(m => +(M.get(m).grd/M.get(m).kwh*100).toFixed(2)), borderColor:css('--sun'), backgroundColor:css('--sun'), borderWidth:2.2, pointRadius:3, tension:.3, borderDash:[]}]},
    options:PI.baseOpts('ct', o => { o.scales.y.beginAtZero = false; o.scales.y.ticks.callback = v => nf1.format(v); o.plugins.legend = {display:true, position:'top', align:'end', labels:{boxWidth:10, boxHeight:3, color:css('--ink-2'), font:{size:11, weight:'600'}}}; })});
  el('simTable').innerHTML = '<thead><tr><th class="l">Mois</th><th>Production (kWh)</th><th>Marché (CHF)</th><th>GRD (CHF)</th><th>Écart (CHF)</th><th>Prix capté (ct)</th><th>Prix GRD (ct)</th></tr></thead><tbody>' +
    ks.map(m => { const x = M.get(m), dd = x.mkt - x.grd; return `<tr><td class="l">${MOISL(m)}${x.est ? ' *' : ''}</td><td>${nf0.format(x.kwh)}</td><td>${nf0.format(x.mkt)}</td><td>${nf0.format(x.grd)}</td><td class="${dd >= 0 ? 'pos' : 'neg'}">${dd >= 0 ? '+' : ''}${nf0.format(dd)}</td><td>${nf2.format(x.mkt/x.kwh*100)}</td><td>${nf2.format(x.grd/x.kwh*100)}</td></tr>`; }).join('') +
    `<tr style="font-weight:800"><td class="l">Total</td><td>${nf0.format(kTot)}</td><td>${nf0.format(mTot)}</td><td>${nf0.format(gTot)}</td><td class="${diff >= 0 ? 'pos' : 'neg'}">${diff >= 0 ? '+' : ''}${nf0.format(diff)}</td><td>${nf2.format(capt - S.fee)}</td><td>${nf2.format(gTot/kTot*100)}</td></tr></tbody>`;
  el('simMethod').textContent = 'Méthode : production Aurora Vision au quart d\'heure × prix day-ahead ' + ZONES[S.zone] + ' du même quart d\'heure (energy-charts.info), converti en CHF au taux BCE du jour. ' +
    'Comparaison GRD : mêmes kWh × prix moyen réel de la facture du trimestre' + (S.ht ? ', divisé par 1,081 pour retirer la TVA (les prix du marché sont hors TVA)' : ' (TTC)') + '. ' +
    (est ? '* Trimestre pas encore facturé : prix GRD estimé avec le même trimestre de l\'année précédente. ' : '') +
    'Ne tient pas compte des garanties d\'origine, des écarts de prévision ni des frais d\'un agrégateur (réglables ci-dessus).';
}
const MOISL = m => ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'][+m.slice(5,7)-1] + ' ' + m.slice(0,4);

/* ---------- branchement ---------- */
PI.renderPrix = async function(){
  if (busy) return; busy = true;
  document.querySelectorAll('#prix .card').forEach(c => c.style.opacity = .6);
  try { await renderPrices(); await renderSim(); const P = cache.prices[S.zone];
    el('pxUpd').textContent = 'Prix mis à jour automatiquement chaque jour · dernière mise à jour ' + new Date(P.updated).toLocaleString('fr-CH',{dateStyle:'long',timeStyle:'short'}) + ' · source energy-charts.info (CC BY 4.0)'; }
  catch(e) { console.error(e); el('pxKpis').innerHTML = '<div class="kpi"><div class="k">Les prix n\'ont pas pu être chargés</div><div class="d">Réessayez dans un instant.</div></div>'; }
  finally { busy = false; document.querySelectorAll('#prix .card').forEach(c => c.style.opacity = 1); }
};
function wire(){
  const on = (id, fn) => el(id).addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.disabled) fn(b.dataset.r); });
  on('pxZone', r => { S.zone = r; PI.renderPrix(); }); on('simZone', r => { S.zone = r; PI.renderPrix(); });
  on('pxUnit', r => { S.unit = r; renderPrices(); });
  on('pxRange', r => { S.range = r; renderPrices(); });
  on('simRange', r => { S.sim = r; renderSim(); });
  el('simNeg').onchange = e => { S.neg = e.target.checked; renderSim(); };
  el('simHt').onchange = e => { S.ht = e.target.checked; renderSim(); };
  el('simFee').oninput = e => { S.fee = +e.target.value; el('simFeeV').textContent = PI.nf2.format(S.fee) + ' ct/kWh'; clearTimeout(PI._sf); PI._sf = setTimeout(renderSim, 120); };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
