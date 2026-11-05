/* PolyImmo Solaire — module financier : revenus, amortissement, projection, prix de reprise par trimestre */
'use strict';
(function(){
const PI = window.PI, el = id => document.getElementById(id);
const KEY = 'pi-fin-v1';
const SCEN = {
  prudent:   {futureMultiplier:0.85, degradation:0.007, priceGrowth:-0.01},
  base:      {futureMultiplier:1,    degradation:0.005, priceGrowth:0},
  optimiste: {futureMultiplier:1.15, degradation:0.004, priceGrowth:0.01},
};
let DEF, fin, showAll = false;

const start = () => fetch('data/finance.json',{cache:'no-store'}).then(r=>r.json()).then(d => { DEF = d; load(); buildForm(); render(); });
if (PI.DATA) start(); else document.addEventListener('pi:data', start, {once:true});

const R = () => { const d = PI.ENTRY || (PI.derive ? PI.derive() : null); return d && Object.keys(d.revenueActual).length ? d : {revenueActual:DEF.revenueActual, pricesActual:DEF.pricesActual, otherRevenue:DEF.otherRevenue||{}, chargesActual:{}}; };
function defaults(){
  const lastPrice = {};
  Object.keys(R().pricesActual).sort().forEach(k => { lastPrice[k.slice(-1)] = R().pricesActual[k]; });
  return {invest:{...DEF.invest}, a:{...DEF.assumptions}, defaults:{1:lastPrice[1],2:lastPrice[2],3:lastPrice[3],4:lastPrice[4]}, overrides:{}, scenario:'base'};
}
function load(){
  fin = defaults();
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) fin = {...fin, ...s, invest:{...fin.invest,...s.invest}, a:{...fin.a,...s.a}, defaults:{...fin.defaults,...s.defaults}, overrides:{...s.overrides}}; } catch(e){}
}
function save(){ try { localStorage.setItem(KEY, JSON.stringify(fin)); } catch(e){} }
PI.finAssump = () => fin ? fin.a : null;

/* ---------- model ---------- */
const netCost = () => fin.invest.ht * (1 + fin.invest.tva) - fin.invest.subsidy;
function model(){
  const D = PI.DATA, mq = D.meterQuarters, upd = D.updated, RR = R();
  const invoiced = Object.keys(RR.revenueActual).sort();
  const lastInv = invoiced[invoiced.length-1];
  const cy = +upd.slice(0,4);
  const refs = PI.refYears(), lastRef = +refs[refs.length-1];
  const refAvg = t => refs.reduce((a,y) => a + (mq[y+'-T'+t]||0), 0) / refs.length;
  const startY = +invoiced[0].slice(0,4), endY = Math.max(cy+1, +fin.a.endYear || 2052);
  const qs = [];
  for (let y = startY; y <= endY; y++) for (let t = 1; t <= 4; t++) {
    const k = y + '-T' + t; if (k < invoiced[0]) continue;
    const qStart = y + '-' + String(3*t-2).padStart(2,'0') + '-01';
    const qEnd = PI.iso(new Date(y, 3*t, 0, 12));
    let status, kwh, price, rev, def;
    def = fin.defaults[t] * Math.pow(1 + fin.a.priceGrowth, Math.max(0, y - cy)) * fin.a.futureMultiplier;
    if (k <= lastInv) {
      status = 'réel'; kwh = mq[k] != null ? mq[k] : 0;
      const ov = fin.overrides[k];
      price = ov != null ? ov : RR.pricesActual[k];
      rev = ov != null ? kwh * ov / 100 : RR.revenueActual[k];
      def = RR.pricesActual[k];
    } else {
      const ov = fin.overrides[k];
      price = ov != null ? ov : def;
      if (qStart <= upd) {
        status = 'en cours'; kwh = 0;
        for (let d = qStart; d <= qEnd; d = PI.addDays(d,1)) kwh += (d < upd && PI.DATA.daily.length) ? (dayVal(d) ?? PI.expectedDay(d,'all')) : PI.expectedDay(d,'all');
      } else {
        status = 'projeté'; kwh = refAvg(t) * Math.pow(1 - fin.a.degradation, Math.max(0, y - lastRef));
      }
      rev = kwh * price / 100;
    }
    const other = (RR.otherRevenue || {})[k] || 0;
    qs.push({k, y, t, status, kwh, price, def, rev, other, ov: fin.overrides[k] != null});
  }
  // années
  const years = {};
  qs.forEach(q => { const Y = years[q.y] || (years[q.y] = {y:q.y, kwh:0, rev:0, other:0, charges:0, st:new Set()}); Y.kwh += q.kwh; Y.rev += q.rev; Y.other += q.other; Y.st.add(q.status); });
  const cost = netCost(); let cum = 0, payback = null, cumQ = 0;
  const ys = Object.values(years).sort((a,b)=>a.y-b.y);
  ys.forEach(Y => {
    Y.status = Y.st.has('projeté') && !Y.st.has('réel') && !Y.st.has('en cours') ? 'projeté' : Y.st.has('en cours') || (Y.st.has('réel') && Y.st.has('projeté')) ? 'en cours' : 'réel';
    const act = (RR.chargesActual || {})[Y.y] || 0;
    if (Y.y > cy) Y.charges = fin.a.charges * Math.pow(1 + fin.a.chargesGrowth, Y.y - cy) + (+fin.a.inverterYear === Y.y ? (+fin.a.inverterCost||0) : 0);
    else if (Y.y === cy) Y.charges = Math.max(act, fin.a.charges) + (+fin.a.inverterYear === Y.y ? (+fin.a.inverterCost||0) : 0);
    else Y.charges = act;
    Y.cf = Y.rev + Y.other - Y.charges; cum += Y.cf; Y.cum = cum; Y.pos = cum - cost;
    Y.price = Y.kwh ? Y.rev / Y.kwh * 100 : 0;
  });
  // amortissement au trimestre près
  qs.forEach(q => { const Y = years[q.y]; const chQ = Y.charges / 4; cumQ += q.rev + q.other - chQ; if (payback == null && cumQ >= cost) payback = q; });
  const flows = ys.map((Y,i) => Y.cf - (i === 0 ? cost : 0));
  const revToDate = qs.filter(q => q.status === 'réel').reduce((a,q) => a + q.rev + q.other, 0);
  const fut = qs.filter(q => q.status !== 'réel');
  const futPrice = fut.reduce((a,q)=>a+q.kwh,0) ? fut.reduce((a,q)=>a+q.rev,0) / fut.reduce((a,q)=>a+q.kwh,0) * 100 : 0;
  const projYears = ys.filter(Y => Y.y >= cy);
  const avgCF = projYears.length ? projYears.reduce((a,Y)=>a+Y.cf,0) / projYears.length : 0;
  return {qs, ys, cost, payback, irr: irr(flows), revToDate, futPrice, avgCF, endY, cy, lastInv};
}
function dayVal(d){ const m = PI._dayMap || (PI._dayMap = Object.fromEntries(PI.DATA.daily)); return m[d]; }
function irr(f){
  const npv = r => f.reduce((a,v,i) => a + v / Math.pow(1+r, i), 0);
  let lo = -0.99, hi = 1.5; if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 100; i++) { const m = (lo+hi)/2; if (npv(lo) * npv(m) <= 0) hi = m; else lo = m; }
  return (lo+hi)/2;
}

/* ---------- form ---------- */
const FIELDS = [
  ['invest','ht','Investissement HT (CHF)','chf'],
  ['invest','tva','TVA','pct'],
  ['invest','subsidy','Subvention reçue (CHF)','chf'],
  ['calc'],
  ['a','degradation','Baisse de production / an','pct',true],
  ['a','priceGrowth','Évolution des prix futurs / an','pct',true],
  ['a','futureMultiplier','Ajustement global des prix futurs','pct',true],
  ['a','endYear','Horizon (dernière année)','int'],
  ['a','charges','Charges annuelles (CHF)','chf'],
  ['a','chargesGrowth','Évolution des charges / an','pct'],
  ['a','inverterYear','Remplacement onduleurs : année','int'],
  ['a','inverterCost','Remplacement onduleurs : coût (CHF)','chf'],
  ['hint','Les charges (entretien, assurance, nettoyage) s\'appliquent à partir de l\'année en cours. « Ajustement global » multiplie tous les prix futurs par défaut (100 % = inchangé).'],
];
function buildForm(){
  const f = el('finForm'); f.replaceChildren();
  FIELDS.forEach(([grp, key, label, kind, scen]) => {
    if (grp === 'calc') { const d = document.createElement('div'); d.className = 'calc'; d.id = 'finCost'; f.appendChild(d); return; }
    if (grp === 'hint') { const p = document.createElement('p'); p.className = 'hint'; p.textContent = key; f.appendChild(p); return; }
    const l = document.createElement('label'); l.textContent = label;
    const i = document.createElement('input'); i.type = 'number'; i.inputMode = 'decimal';
    i.step = kind === 'pct' ? '0.1' : kind === 'int' ? '1' : '100';
    const v = fin[grp][key]; i.value = v == null || v === '' ? '' : kind === 'pct' ? +(v*100).toFixed(2) : v;
    if (kind === 'pct') i.setAttribute('aria-label', label + ' en %');
    i.oninput = () => {
      const raw = i.value === '' ? null : +i.value;
      fin[grp][key] = raw == null ? (kind === 'int' || kind === 'chf' ? (key === 'inverterYear' ? null : 0) : 0) : kind === 'pct' ? raw/100 : raw;
      if (scen) fin.scenario = 'perso';
      save(); render(false);
    };
    l.appendChild(i); f.appendChild(l);
  });
  const dp = el('defPrices'); dp.replaceChildren();
  [1,2,3,4].forEach(t => { const l = document.createElement('label'); l.textContent = 'T' + t;
    const i = document.createElement('input'); i.type = 'number'; i.step = '0.1'; i.value = fin.defaults[t]; i.setAttribute('aria-label','Prix par défaut T' + t + ' en ct/kWh');
    i.oninput = () => { fin.defaults[t] = +i.value || 0; save(); render(false); };
    l.appendChild(i); l.append(' ct'); dp.appendChild(l); });
}
el('scen').onclick = e => { const b = e.target.closest('button'); if (!b || b.disabled) return;
  Object.assign(fin.a, SCEN[b.dataset.s]); fin.scenario = b.dataset.s; save(); buildForm(); render(); PI.toast('Scénario ' + b.textContent.toLowerCase() + ' appliqué'); };
el('finReset').onclick = () => { if (!confirmReset()) return; try { localStorage.removeItem(KEY); } catch(e){} fin = defaults(); buildForm(); render(); PI.toast('Hypothèses réinitialisées'); };
function confirmReset(){ const b = el('finReset'); if (b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Réinitialiser'; return true; }
  b.dataset.armed = 1; b.textContent = 'Confirmer ?'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Réinitialiser'; }, 3000); return false; }
el('finExport').onclick = () => {
  const blob = new Blob([JSON.stringify(fin, null, 1)], {type:'application/json'});
  const a = Object.assign(document.createElement('a'), {href:URL.createObjectURL(blob), download:'polyimmo_hypotheses.json'}); document.body.appendChild(a); a.click(); a.remove(); };
el('finImport').onchange = e => { const f = e.target.files[0]; if (!f) return;
  f.text().then(t => { const s = JSON.parse(t); const d = defaults();
    fin = {...d, ...s, invest:{...d.invest,...s.invest}, a:{...d.a,...s.a}, defaults:{...d.defaults,...s.defaults}, overrides:{...s.overrides}}; save(); buildForm(); render(); PI.toast('Hypothèses importées'); })
   .catch(() => PI.toast('Fichier invalide')); e.target.value = ''; };
el('clearOverrides').onclick = () => { const M = model(); Object.keys(fin.overrides).forEach(k => { if (k > M.lastInv) delete fin.overrides[k]; }); save(); render(); PI.toast('Prix futurs saisis effacés'); };
el('showAllYears').onclick = () => { showAll = !showAll; el('showAllYears').textContent = showAll ? 'Masquer les années lointaines' : 'Afficher toutes les années'; renderTable(model()); };

/* ---------- render ---------- */
const RANGE = {fp:'10', fr:'10'};
document.getElementById('fpRange').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { RANGE.fp = b.dataset.r; render(false); } });
document.getElementById('frRange').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { RANGE.fr = b.dataset.r; render(false); } });
const cut = (ys, r, cy) => ys.filter(Y => r === 'all' ? true : r === 'now' || r === 'real' ? Y.y <= cy : Y.y <= ys[0].y + 9);
function sliders(M){
  const box = el('finSliders'), nf0 = PI.nf0, nf1 = PI.nf1, nf2 = PI.nf2;
  const defs = [
    ['futureMultiplier', 'Prix de reprise futur', 0.5, 1.5, 0.05, v => nf0.format(v*100) + ' %', () => '≈ ' + nf2.format(model().futPrice) + ' ct/kWh en moyenne (100 % = derniers prix connus de chaque trimestre)'],
    ['degradation', 'Baisse de production par an', 0, 0.015, 0.001, v => nf1.format(v*100) + ' %', () => 'Vieillissement des panneaux, souvent 0,3 à 0,7 % par an'],
    ['charges', 'Charges par an', 0, 6000, 100, v => nf0.format(v) + ' CHF', () => 'Entretien, assurance, nettoyage… ' + (fin.a.charges ? '' : '— à renseigner pour un résultat réaliste')],
  ];
  if (!box.dataset.built) {
    box.innerHTML = defs.map(([k,l,mn,mx,st]) => `<div class="sl"><label for="sl_${k}">${l}<b id="slv_${k}"></b></label><input type="range" id="sl_${k}" min="${mn}" max="${mx}" step="${st}"><div class="hint" id="slh_${k}"></div></div>`).join('');
    defs.forEach(([k]) => el('sl_' + k).addEventListener('input', e => { fin.a[k] = +e.target.value; if (k !== 'charges') fin.scenario = 'perso'; save(); render(false); }));
    box.dataset.built = 1;
  }
  defs.forEach(([k,,,,,fmt,hint]) => { const i = el('sl_' + k); if (document.activeElement !== i) i.value = fin.a[k]; el('slv_' + k).textContent = fmt(+fin.a[k]); el('slh_' + k).textContent = hint(); });
}
function render(withTable = true){
  if (!fin || !PI.DATA) return;
  const M = model(), nf0 = PI.nf0, nf1 = PI.nf1, nf2 = PI.nf2, css = PI.css;
  document.querySelectorAll('#scen button').forEach(b => b.setAttribute('aria-pressed', b.dataset.s === fin.scenario));
  document.querySelectorAll('#fpRange button').forEach(b => b.setAttribute('aria-pressed', b.dataset.r === RANGE.fp));
  document.querySelectorAll('#frRange button').forEach(b => b.setAttribute('aria-pressed', b.dataset.r === RANGE.fr));
  el('finEnd').textContent = M.endY;
  if (el('finCost')) { el('finCost').innerHTML = '<span>Coût net de l\'installation (TTC − subvention)</span><span class="num"></span>'; el('finCost').lastChild.textContent = nf0.format(M.cost) + ' CHF'; }
  const last = M.ys[M.ys.length-1], pct = Math.min(1, M.revToDate / M.cost), rest = Math.max(0, M.cost - M.revToDate);
  const pb = M.payback ? 'T' + M.payback.t + ' ' + M.payback.y : 'après ' + M.endY;
  // réponse principale
  el('finHero').innerHTML = `<div><span class="flabel">Remboursement de l'installation</span><h2>Votre installation est remboursée à ${nf0.format(pct*100)} %</h2>
    <p class="sub" style="font-size:.95rem;margin-top:6px">Vous avez encaissé <b>${nf0.format(M.revToDate)} CHF</b> sur un coût net de <b>${nf0.format(M.cost)} CHF</b> (factures jusqu'au ${M.lastInv.replace('-T',' T').replace(/^(\d+) (T\d)$/,'$2 $1')}, indemnité comprise).</p>
    <div class="bar"><i style="width:${pct*100}%"></i></div></div>
    <div class="facts"><div class="fact"><span>Reste à rembourser</span><strong class="num">${nf0.format(rest)} CHF</strong></div>
    <div class="fact"><span>Remboursé vers</span><strong>${pb}</strong></div>
    <div class="fact"><span>Gain estimé en ${M.endY}</span><strong class="num">${nf0.format(last.pos)} CHF</strong></div></div>`;
  // indicateurs
  const cyQ = M.qs.filter(q => q.y === M.cy && q.status === 'réel'), cyRev = cyQ.reduce((a,q)=>a+q.rev+q.other,0), cyK = cyQ.reduce((a,q)=>a+q.kwh,0);
  const allR = M.qs.filter(q => q.status === 'réel'), avgAll = allR.reduce((a,q)=>a+q.rev,0) / allR.reduce((a,q)=>a+q.kwh,0) * 100;
  const help = t => `<span class="help" tabindex="0" data-tip="${t}">?</span>`;
  const items = [
    ['Revenus ' + M.cy + ' encaissés', cyRev, v => nf0.format(v) + '<small>CHF</small>', cyQ.length ? cyQ.length + ' trimestre(s) facturé(s)' : 'aucune facture saisie'],
    ['Prix moyen ' + M.cy, cyK ? cyRev/cyK*100 : 0, v => nf2.format(v) + '<small>ct/kWh</small>', 'contre ' + nf2.format(avgAll) + ' ct/kWh en moyenne depuis 2023'],
    ['Prix futur estimé ' + help('Prix moyen de reprise utilisé pour la projection, selon vos hypothèses.'), M.futPrice, v => nf2.format(v) + '<small>ct/kWh</small>', 'scénario « ' + fin.scenario + ' »'],
    ['Rentabilité ' + help('Taux de rentabilité interne (TRI) : rendement annuel moyen de l’investissement sur toute la durée, comme un taux d’intérêt.'), M.irr == null ? 0 : M.irr*100, v => M.irr == null ? '–' : nf1.format(v) + '<small>% / an</small>', 'sur ' + (M.endY - M.ys[0].y + 1) + ' ans'],
  ];
  el('finKpis').innerHTML = items.map((it,i) => `<div class="kpi"><div class="k">${it[0]}</div><div class="v num" id="fk${i}">–</div><div class="d">${it[3]}</div></div>`).join('');
  items.forEach((it,i) => PI.countUp(el('fk'+i), it[1], it[2], true));
  sliders(M);
  // gain cumulé
  const yp = cut(M.ys, RANGE.fp, M.cy), good = css('--good'), bad = css('--bad');
  PI.makeChart('cFinPos', {type:'line', data:{labels:yp.map(Y => String(Y.y)), datasets:[{label:'Gain cumulé', data:yp.map(Y => Math.round(Y.pos)),
    borderColor: css('--ink'), borderWidth:2.4, pointRadius: yp.length > 15 ? 0 : 3, pointHoverRadius:5, tension:.25,
    fill:{target:'origin', above: good + '30', below: bad + '26'},
    segment:{borderDash: ctx => yp[ctx.p1DataIndex] && yp[ctx.p1DataIndex].status === 'projeté' ? [5,4] : []}}]},
    options: PI.baseOpts('CHF', o => { o.scales.y.beginAtZero = false; o.scales.y.grid.color = c => c.tick.value === 0 ? css('--muted') : css('--grid');
      o.plugins.tooltip.callbacks.afterBody = it => { const Y = yp[it[0].dataIndex]; return [Y.status === 'projeté' ? 'Estimation' : Y.status === 'en cours' ? 'Année en cours (en partie estimée)' : 'Réel', 'Revenus de l\'année : ' + nf0.format(Y.rev + Y.other) + ' CHF']; }; })});
  const yr = cut(M.ys, RANGE.fr, M.cy);
  PI.makeChart('cFinRev', {type:'bar', data:{labels:yr.map(Y => String(Y.y)), datasets:[{label:'Revenus', data:yr.map(Y => Math.round(Y.rev + Y.other)),
    backgroundColor: yr.map(Y => Y.status === 'réel' ? css('--sun') : Y.status === 'en cours' ? css('--sun-2') : css('--s1')),
    borderRadius:{topLeft:5,topRight:5}, borderSkipped:'bottom', maxBarThickness:40}]},
    options: PI.baseOpts('CHF', o => { o.plugins.tooltip.callbacks.afterBody = it => { const Y = yr[it[0].dataIndex]; return [nf0.format(Y.kwh) + ' kWh · ' + nf2.format(Y.price) + ' ct/kWh', Y.status === 'réel' ? 'Réel (factures)' : Y.status === 'en cours' ? 'En cours : factures + estimation' : 'Estimation']; }; })});
  // prix par trimestre (réglages avancés)
  const real = M.qs.map(q => q.status === 'réel' ? +q.price.toFixed(3) : null);
  const iLast = M.qs.findIndex(q => q.status !== 'réel');
  const proj = M.qs.map((q,i) => (q.status !== 'réel' || i === iLast - 1) ? +q.price.toFixed(3) : null);
  PI.makeChart('cFinPrice', {type:'line', data:{labels: M.qs.map(q => 'T' + q.t + ' ' + q.y), datasets:[
    {label:'Réel', data:real, borderColor:css('--s1'), backgroundColor:css('--s1'), borderWidth:2, pointRadius:3, tension:.2},
    {label:'Estimé', data:proj, borderColor:css('--s2'), backgroundColor:css('--s2'), borderWidth:2, borderDash:[5,4], pointRadius: M.qs.length > 60 ? 0 : 2, pointHoverRadius:4, tension:.2}]},
    options: PI.baseOpts('ct', o => { o.scales.y.ticks.callback = v => nf1.format(v); o.scales.x.ticks.callback = function(v){ const l = this.getLabelForValue(v); if (!l.startsWith('T1')) return ''; const y = +l.slice(3), step = this.chart.width < 500 ? 5 : this.chart.width < 900 ? 2 : 1; return y % step === 0 ? String(y) : ''; }; o.scales.x.ticks.autoSkip = false; })});
  if (withTable) renderTable(M); else updateTablePlaceholders(M);
  renderYearTable(M);
  document.dispatchEvent(new CustomEvent('pi:fin'));
}
PI.finRender = () => render();
PI.finModel = () => (fin && DEF && PI.DATA) ? model() : null;

function renderTable(M){
  const t = el('priceTable'); t.replaceChildren();
  const thead = document.createElement('thead'); thead.innerHTML = '<tr><th class="l">Année</th><th>T1</th><th>T2</th><th>T3</th><th>T4</th><th>Prix moyen</th><th>Revenus</th></tr>'; t.appendChild(thead);
  const tb = document.createElement('tbody');
  const byY = {}; M.qs.forEach(q => (byY[q.y] = byY[q.y] || []).push(q));
  Object.keys(byY).forEach(y => {
    const tr = document.createElement('tr'); tr.dataset.y = y;
    if (!showAll && +y > M.cy + 4) tr.classList.add('yr-hidden');
    const th = document.createElement('td'); th.className = 'l'; th.textContent = y; tr.appendChild(th);
    for (let t2 = 1; t2 <= 4; t2++) {
      const q = byY[y].find(x => x.t === t2); const td = document.createElement('td');
      if (q) {
        td.className = q.status === 'réel' ? 'past' : q.status === 'en cours' ? 'cur' : '';
        const i = document.createElement('input'); i.type = 'number'; i.step = '0.1'; i.dataset.k = q.k;
        i.title = q.status === 'réel' ? 'Prix réel (facture). Modifiez pour simuler un autre prix.' : q.status === 'en cours' ? 'Trimestre en cours' : 'Vide = prix par défaut du T' + t2;
        if (q.status === 'réel') i.value = +q.price.toFixed(2); else { i.placeholder = PI.nf2.format(q.def); if (q.ov) i.value = fin.overrides[q.k]; }
        if (q.ov) i.classList.add('ov');
        i.setAttribute('aria-label', 'Prix ' + q.k + ' en ct/kWh');
        i.onchange = () => { if (i.value === '') delete fin.overrides[q.k]; else fin.overrides[q.k] = +i.value; save(); render(); };
        td.appendChild(i);
      }
      tr.appendChild(td);
    }
    const kwh = byY[y].reduce((a,q)=>a+q.kwh,0), rev = byY[y].reduce((a,q)=>a+q.rev,0);
    const a = document.createElement('td'); a.className = 'num'; a.textContent = kwh ? PI.nf2.format(rev/kwh*100) : '–';
    const r = document.createElement('td'); r.className = 'num'; r.textContent = PI.nf0.format(rev); tr.append(a, r);
    tb.appendChild(tr);
  });
  t.appendChild(tb);
}
function updateTablePlaceholders(M){
  M.qs.forEach(q => { const i = document.querySelector(`#priceTable input[data-k="${q.k}"]`); if (i && q.status !== 'réel') i.placeholder = PI.nf2.format(q.def); });
  document.querySelectorAll('#priceTable tbody tr').forEach(tr => { const y = +tr.dataset.y; const qs = M.qs.filter(q => q.y === y);
    const kwh = qs.reduce((a,q)=>a+q.kwh,0), rev = qs.reduce((a,q)=>a+q.rev,0);
    tr.children[5].textContent = kwh ? PI.nf2.format(rev/kwh*100) : '–'; tr.children[6].textContent = PI.nf0.format(rev); });
}
function renderYearTable(M){
  const t = el('finTable'); t.replaceChildren();
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th class="l">Année</th><th class="l">Statut</th><th>Production (kWh)</th><th>Prix moyen (ct)</th><th>Revenus</th><th>Autres</th><th>Charges</th><th>Cash-flow</th><th>Cumul</th><th>Bénéfice cumulé</th></tr>';
  t.appendChild(thead);
  const tb = document.createElement('tbody');
  M.ys.forEach(Y => { const tr = document.createElement('tr'); tr.className = Y.status === 'projeté' ? 'proj' : Y.status === 'en cours' ? 'cur' : '';
    const cells = [[Y.y,'l'],[Y.status,'l'],[PI.nf0.format(Y.kwh),'num'],[PI.nf2.format(Y.price),'num'],[PI.nf0.format(Y.rev),'num'],[Y.other?PI.nf0.format(Y.other):'–','num'],
      [Y.charges?'−'+PI.nf0.format(Y.charges):'–','num'],[PI.nf0.format(Y.cf),'num'],[PI.nf0.format(Y.cum),'num'],[PI.nf0.format(Y.pos),'num ' + (Y.pos < 0 ? 'neg' : 'pos')]];
    cells.forEach(([v,c]) => { const td = document.createElement('td'); td.textContent = v; td.className = c; tr.appendChild(td); }); tb.appendChild(tr); });
  t.appendChild(tb);
}
})();
