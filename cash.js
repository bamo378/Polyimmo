/* PolyImmo Solaire — Trésorerie : produits − charges − banque = ce qu'il reste
   Produits : modèle financier (factures réelles puis projection). Charges et prêt : réglages enregistrés dans ce navigateur. */
'use strict';
(function(){
const PI = window.PI = window.PI || {};
const el = id => document.getElementById(id);
const KEY = 'pi-cash-v1';
const DEF = {loan:{amount:0, rate:2.5, years:15, first:'2023-T4', type:'annuite', freq:4},
  charges:{assurance:0, entretien:0, grd:0, admin:0, autres:0}, growth:1, gran:'y', range:'5', cum:true};
const CH = [['assurance','Assurance'], ['entretien','Entretien, nettoyage'], ['grd','Frais compteur / GRD'], ['admin','Administration, comptabilité'], ['autres','Autres charges']];
let S = load();
function load(){ let s = null; try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch(e){}
  const o = JSON.parse(JSON.stringify(DEF)); if (s) { Object.assign(o, s); o.loan = {...DEF.loan, ...s.loan}; o.charges = {...DEF.charges, ...s.charges}; }
  return o; }
function save(){ try { localStorage.setItem(KEY, JSON.stringify(S)); } catch(e){} }
const qIdx = k => +k.slice(0,4)*4 + (+k.slice(-1) - 1);
const qKey = i => Math.floor(i/4) + '-T' + (i%4 + 1);
const qLab = k => 'T' + k.slice(-1) + ' ' + k.slice(0,4);

/* ---------- échéancier du prêt, ramené au trimestre ---------- */
function schedule(){
  const L = S.loan, P = +L.amount || 0, out = {};
  if (P <= 0 || !(+L.years > 0)) return {byQ:out, end:null, pay:0};
  const f = +L.freq, n = Math.round(L.years * f), r = (+L.rate || 0) / 100 / f;
  const A = r ? P * r / (1 - Math.pow(1 + r, -n)) : P / n;
  let rest = P; const s = qIdx(L.first); let endQ = null;
  for (let p = 0; p < n; p++) {
    const it = rest * r, am = L.type === 'annuite' ? A - it : P / n; rest = Math.max(0, rest - am);
    const qi = f === 12 ? s + Math.floor(p / 3) : s + p * (4 / f); const k = qKey(qi);
    const x = out[k] || (out[k] = {int:0, am:0, rest:0}); x.int += it; x.am += am; x.rest = rest; endQ = k;
  }
  return {byQ:out, end:endQ, pay:L.type === 'annuite' ? A : null, f};
}
const chargesYear = (y, cy) => { const real = PI.ENTRY && PI.ENTRY.chargesActual && PI.ENTRY.chargesActual[y];
  if (real) return {v:real, real:true};
  const base = Object.values(S.charges).reduce((a,b) => a + (+b || 0), 0);
  return {v: base * Math.pow(1 + (+S.growth || 0)/100, Math.max(0, y - cy)), real:false}; };

/* ---------- calcul ---------- */
function compute(){
  const M = PI.finModel && PI.finModel(); if (!M) return null;
  const sch = schedule(), cy = M.cy, rows = [];
  M.qs.forEach(q => { const c = chargesYear(q.y, cy), b = sch.byQ[q.k] || {int:0, am:0, rest:null};
    rows.push({k:q.k, y:q.y, status:q.status, prod:q.rev + q.other, ch:c.v/4, chReal:c.real, int:b.int, am:b.am, rest:b.rest}); });
  // capital restant dû au fil du temps
  let rest = +S.loan.amount || 0; const s = sch.end ? qIdx(S.loan.first) : Infinity;
  rows.forEach(r => { if (qIdx(r.k) < s) r.debt = rest; else { if (r.rest != null) rest = r.rest; r.debt = rest; } r.bank = r.int + r.am; r.net = r.prod - r.ch - r.bank; });
  return {M, sch, rows, cy};
}
function group(rows){
  if (S.gran === 'q') return rows.map(r => ({...r, lab:qLab(r.k), key:r.k}));
  const Y = new Map(); rows.forEach(r => { const x = Y.get(r.y) || {key:r.y, lab:String(r.y), y:r.y, prod:0, ch:0, int:0, am:0, bank:0, net:0, st:new Set(), chReal:true, debt:0};
    x.prod += r.prod; x.ch += r.ch; x.int += r.int; x.am += r.am; x.bank += r.bank; x.net += r.net; x.st.add(r.status); x.debt = r.debt; x.chReal = x.chReal && r.chReal; Y.set(r.y, x); });
  return [...Y.values()].map(x => ({...x, status: x.st.has('réel') && x.st.size === 1 ? 'réel' : x.st.has('projeté') && x.st.size === 1 ? 'projeté' : 'en cours'}));
}
function cut(list, C){
  const cy = C.cy, endLoan = C.sch.end ? +C.sch.end.slice(0,4) : null;
  const lastY = S.range === 'past' ? cy : S.range === '5' ? cy + 5 : S.range === 'loan' ? (endLoan || cy + 5) : Infinity;
  return list.filter(x => x.y <= lastY);
}

/* ---------- rendu ---------- */
function render(){
  const box = el('cash'); if (!box) return;
  const C = compute(); if (!C) return;
  const nf0 = PI.nf0, nf1 = PI.nf1, css = PI.css, sgn = v => (v >= 0 ? '+' : '−') + nf0.format(Math.abs(v));
  const hasLoan = (+S.loan.amount || 0) > 0, chTot = Object.values(S.charges).reduce((a,b) => a + (+b || 0), 0);
  document.querySelectorAll('#caGran button').forEach(b => b.setAttribute('aria-pressed', b.dataset.r === S.gran));
  document.querySelectorAll('#caRange button').forEach(b => { b.setAttribute('aria-pressed', b.dataset.r === S.range); if (b.dataset.r === 'loan') b.disabled = !hasLoan; });
  el('caCum').checked = S.cum;
  el('caSetup').classList.toggle('hidden', hasLoan && chTot > 0);
  el('caSetup').innerHTML = !hasLoan && !chTot ? '<b>À compléter :</b> indiquez votre prêt bancaire et vos charges annuelles ci-dessous pour voir ce qu\'il vous reste vraiment.'
    : !hasLoan ? '<b>À compléter :</b> indiquez votre prêt bancaire ci-dessous (montant, taux, durée).' : '<b>À compléter :</b> indiquez vos charges annuelles ci-dessous (assurance, entretien…).';
  // phrase clé : année en cours
  const Ycur = group(C.rows.filter(r => r.y === C.cy)).find(x => true) || null;
  const yr = S.gran === 'y' ? Ycur : (() => { const rs = C.rows.filter(r => r.y === C.cy); return rs.reduce((a,r) => ({prod:a.prod + r.prod, ch:a.ch + r.ch, bank:a.bank + r.bank, net:a.net + r.net}), {prod:0, ch:0, bank:0, net:0}); })();
  el('caLead').innerHTML = `En <b>${C.cy}</b>, l'installation rapporte <b>${nf0.format(yr.prod)} CHF</b>. Après <b>${nf0.format(yr.ch)} CHF</b> de charges et <b>${nf0.format(yr.bank)} CHF</b> versés à la banque, il reste <b class="${yr.net >= 0 ? 'pos' : 'neg'}">${sgn(yr.net)} CHF</b>` +
    (yr.net >= 0 ? ' : l\'installation se finance seule.' : ' : il faut compléter de votre poche.');
  // KPIs sur la période choisie
  const list = cut(group(C.rows), C), real = list.filter(x => x.status !== 'projeté');
  const T = list.reduce((a,x) => ({prod:a.prod + x.prod, ch:a.ch + x.ch, int:a.int + x.int, am:a.am + x.am, bank:a.bank + x.bank, net:a.net + x.net}), {prod:0, ch:0, int:0, am:0, bank:0, net:0});
  const neg = list.filter(x => x.net < 0), unit = S.gran === 'y' ? 'année' : 'trimestre';
  const debtNow = (C.rows.filter(r => r.status !== 'projeté').pop() || {}).debt || 0;
  const per = list.length ? list[0].lab + ' → ' + list[list.length-1].lab : '';
  const help = t => `<span class="help" tabindex="0" data-tip="${t}">?</span>`;
  el('caKpis').innerHTML = [
    ['Produits', nf0.format(T.prod) + '<small>CHF</small>', per],
    ['Charges', nf0.format(T.ch) + '<small>CHF</small>', chTot || list.some(x => x.chReal && x.ch) ? 'assurance, entretien, frais…' : 'aucune charge saisie'],
    ['Banque ' + help('Intérêts + amortissement du prêt sur la période.'), nf0.format(T.bank) + '<small>CHF</small>', hasLoan ? 'dont intérêts ' + nf0.format(T.int) + ' CHF' : 'aucun prêt saisi'],
    ['Il reste', `<span class="${T.net >= 0 ? 'pos' : 'neg'}">${sgn(T.net)}</span><small>CHF</small>`, neg.length ? `<span class="trend down">${neg.length} ${unit}${neg.length > 1 ? 's' : ''} en négatif</span> sur ${list.length}` : `<span class="trend up">toujours positif</span>`],
  ].map(([k,v,d]) => `<div class="kpi"><div class="k">${k}</div><div class="v num" style="font-size:1.55rem">${v}</div><div class="d">${d}</div></div>`).join('');
  el('caLoanInfo').innerHTML = hasLoan ? `Paiement ${C.sch.pay != null ? 'fixe de <b>' + nf0.format(C.sch.pay) + ' CHF</b> ' : ''}par ${({4:'trimestre', 2:'semestre', 1:'année', 12:'mois'})[S.loan.freq]} · dernier paiement <b>${qLab(C.sch.end)}</b> · reste dû aujourd'hui <b>${nf0.format(debtNow)} CHF</b>` : 'Sans prêt, la banque n\'apparaît pas dans le calcul.';
  // graphique
  const labels = list.map(x => x.lab + (x.status === 'projeté' ? '' : ''));
  const alpha = x => x.status === 'projeté' ? '88' : '';
  const bar = (label, data, col, extra) => Object.assign({label, data, backgroundColor:list.map(x => col + alpha(x)), stack:'s', borderRadius:3, borderSkipped:false, maxBarThickness:S.gran === 'y' ? 34 : 16, categoryPercentage:.8, barPercentage:.92, order:2}, extra);
  let cum = 0; const cumData = list.map(x => (cum += x.net, Math.round(cum)));
  const ds = [bar('Produits', list.map(x => Math.round(x.prod)), css('--sun')), bar('Charges', list.map(x => -Math.round(x.ch)), css('--s3')),
    bar('Intérêts', list.map(x => -Math.round(x.int)), css('--bad') ), bar('Amortissement', list.map(x => -Math.round(x.am)), css('--muted')),
    {type:'line', label:'Il reste', data:list.map(x => Math.round(x.net)), borderColor:css('--ink'), backgroundColor:list.map(x => x.net >= 0 ? css('--good') : css('--bad')), pointBackgroundColor:list.map(x => x.net >= 0 ? css('--good') : css('--bad')), pointBorderColor:css('--surface'), pointBorderWidth:1.5, pointRadius:S.gran === 'y' ? 5 : 3.5, borderWidth:2, tension:.25, order:1}];
  if (S.cum) ds.push({type:'line', label:'Trésorerie cumulée', data:cumData, yAxisID:'y1', borderColor:css('--s1'), borderDash:[5,4], borderWidth:2, pointRadius:0, tension:.25, order:0});
  PI.makeChart('cCash', {type:'bar', data:{labels, datasets:ds}, options:PI.baseOpts('CHF', o => {
    o.scales.x.stacked = true; o.scales.y.stacked = true; o.scales.y.beginAtZero = true;
    o.scales.y.grid.color = c => c.tick.value === 0 ? css('--muted') : css('--grid');
    o.scales.y.ticks.callback = v => nf0.format(v);
    if (S.cum) o.scales.y1 = {position:'right', grid:{display:false}, border:{display:false}, ticks:{color:css('--s1'), font:{size:11}, maxTicksLimit:6, callback:v => nf0.format(v)}};
    o.plugins.legend = {display:true, position:'top', align:'end', labels:{boxWidth:10, boxHeight:10, color:css('--ink-2'), font:{size:11, weight:'600'}}};
    o.plugins.tooltip.callbacks.label = c => ' ' + c.dataset.label + ' : ' + (c.parsed.y >= 0 ? '' : '−') + nf0.format(Math.abs(c.parsed.y)) + ' CHF';
    o.plugins.tooltip.callbacks.afterBody = it => { const x = list[it[0].dataIndex]; return [x.status === 'projeté' ? 'Projection' : x.status === 'en cours' ? 'En cours (réel + estimation)' : 'Réel (factures)', hasLoan ? 'Reste dû à la banque : ' + nf0.format(x.debt) + ' CHF' : '']; };
  })});
  // tableau
  el('caTable').innerHTML = `<thead><tr><th class="l">${S.gran === 'y' ? 'Année' : 'Trimestre'}</th><th>Produits</th><th>Charges</th><th>Intérêts</th><th>Amortissement</th><th>Il reste</th><th>Cumul</th>${hasLoan ? '<th>Reste dû banque</th>' : ''}</tr></thead><tbody>` +
    list.map((x,i) => `<tr class="${x.status === 'projeté' ? 'proj' : ''}"><td class="l">${x.lab} <span class="muted">${x.status === 'projeté' ? 'projeté' : x.status === 'en cours' ? 'en cours' : 'réel'}</span></td><td>${nf0.format(x.prod)}</td><td>${x.ch ? '−' + nf0.format(x.ch) : '0'}</td><td>${x.int ? '−' + nf0.format(x.int) : '0'}</td><td>${x.am ? '−' + nf0.format(x.am) : '0'}</td><td class="${x.net >= 0 ? 'pos' : 'neg'}" style="font-weight:800">${sgn(x.net)}</td><td class="${cumData[i] >= 0 ? 'pos' : 'neg'}">${sgn(cumData[i])}</td>${hasLoan ? `<td>${nf0.format(x.debt)}</td>` : ''}</tr>`).join('') +
    `<tr style="font-weight:800"><td class="l">Total</td><td>${nf0.format(T.prod)}</td><td>−${nf0.format(T.ch)}</td><td>−${nf0.format(T.int)}</td><td>−${nf0.format(T.am)}</td><td class="${T.net >= 0 ? 'pos' : 'neg'}">${sgn(T.net)}</td><td></td>${hasLoan ? '<td></td>' : ''}</tr></tbody>`;
}

/* ---------- formulaires ---------- */
function buildForms(){
  const lf = el('caLoan'); lf.innerHTML = `
    <label>Montant emprunté (CHF)<input type="number" step="1000" min="0" data-l="amount"></label>
    <label>Taux d'intérêt (% / an)<input type="number" step="0.05" min="0" data-l="rate"></label>
    <label>Durée (années)<input type="number" step="1" min="1" data-l="years"></label>
    <label>Premier remboursement<select data-l="first"></select></label>
    <label>Type de remboursement<select data-l="type"><option value="annuite">Annuités constantes (même montant)</option><option value="lineaire">Amortissement linéaire (dégressif)</option></select></label>
    <label>Paiement<select data-l="freq"><option value="12">Mensuel</option><option value="4">Trimestriel</option><option value="2">Semestriel</option><option value="1">Annuel</option></select></label>`;
  const sel = lf.querySelector('[data-l="first"]'); for (let y = 2023; y <= 2030; y++) for (let t = 1; t <= 4; t++) { const k = y + '-T' + t; sel.insertAdjacentHTML('beforeend', `<option value="${k}">${qLab(k)}</option>`); }
  lf.querySelectorAll('[data-l]').forEach(i => { i.value = S.loan[i.dataset.l];
    i.addEventListener('input', () => { const k = i.dataset.l; S.loan[k] = ['amount','rate','years','freq'].includes(k) ? (+i.value || 0) : i.value; save(); render(); }); });
  const cf = el('caCharges'); cf.innerHTML = CH.map(([k,l]) => `<label>${l} (CHF / an)<input type="number" step="50" min="0" data-c="${k}"></label>`).join('') + `<label>Hausse des charges (% / an)<input type="number" step="0.5" data-g="1"></label>`;
  cf.querySelectorAll('[data-c]').forEach(i => { i.value = S.charges[i.dataset.c] || ''; i.placeholder = '0';
    i.addEventListener('input', () => { S.charges[i.dataset.c] = +i.value || 0; save(); render(); }); });
  const g = cf.querySelector('[data-g]'); g.value = S.growth; g.addEventListener('input', () => { S.growth = +g.value || 0; save(); render(); });
}
function wire(){
  if (!el('cash')) return;
  buildForms();
  const on = (id, fn) => el(id).addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.disabled) { fn(b.dataset.r); save(); render(); } });
  on('caGran', r => S.gran = r); on('caRange', r => S.range = r);
  el('caCum').addEventListener('change', e => { S.cum = e.target.checked; save(); render(); });
  el('caReset').addEventListener('click', () => { S = JSON.parse(JSON.stringify(DEF)); save(); buildForms(); render(); PI.toast && PI.toast('Réglages de trésorerie réinitialisés'); });
  document.addEventListener('pi:fin', render);
  render();
}
PI.cashRender = render;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
