/* PolyImmo — onglet Villa (SolarEdge) : production, consommation, autoconsommation, achat et vente réseau.
   Données : data/villa.json, mises à jour chaque jour par le robot GitHub (.github/workflows/villa.yml). */
'use strict';
(function(){
const PI = window.PI = window.PI || {};
const el = id => document.getElementById(id);
const WF = 'https://github.com/bamo378/Polyimmo/actions/workflows/villa.yml';
const AUTH = 'https://connect.solaredge.com/authorize?client_id=4c7fdd53-6077-4c3b-8510-b0c648039216&scope=SITE_DATA%20DEVICE_DATA&redirect_uri=' + encodeURIComponent('https://bamo378.github.io/Polyimmo/');
const S = {range:'30', day:null};
let V = null, loading = null;

/* ---------- retour d'autorisation SolarEdge (?code=…&site_id=…) ---------- */
function oauthLanding(){
  const q = new URLSearchParams(location.search), code = q.get('code');
  if (!code) return;
  history.replaceState(null, '', location.pathname + '#v=villa');
  const box = document.createElement('div'); box.className = 'oauthbox';
  box.innerHTML = `<div class="oauthcard" role="dialog" aria-modal="true" aria-labelledby="oaT">
    <h2 id="oaT">✅ Autorisation SolarEdge reçue</h2>
    <p>Dernière étape, à faire <b>tout de suite</b> (le code expire en quelques minutes) :</p>
    <ol><li>Cliquez sur <b>Copier le code</b>.</li>
      <li>Cliquez sur <b>Ouvrir le robot</b>, puis sur le bouton gris <b>Run workflow</b> à droite.</li>
      <li>Collez le code dans le champ, puis cliquez sur le bouton vert <b>Run workflow</b>.</li></ol>
    <div class="oacode"><code>${code.replace(/[<>&"]/g,'')}</code></div>
    <div class="oabtns"><button class="btn-primary" id="oaCopy">Copier le code</button><a class="btn-primary" style="background:var(--ink);text-decoration:none" href="${WF}" target="_blank" rel="noopener">Ouvrir le robot ↗</a><button class="linkbtn" id="oaClose">Fermer</button></div>
    <p class="note">Site SolarEdge n° ${(q.get('site_id') || '').replace(/\D/g,'')}. Le code ne sert qu'une fois et ne fonctionne qu'avec la clé secrète enregistrée dans GitHub.</p></div>`;
  document.body.appendChild(box);
  el('oaCopy').onclick = async () => { try { await navigator.clipboard.writeText(code); el('oaCopy').textContent = 'Copié ✓'; } catch(e) { el('oaCopy').textContent = 'Sélectionnez le code ci-dessus'; } };
  el('oaClose').onclick = () => box.remove();
}

/* ---------- données ---------- */
async function load(){
  if (V) return V; if (loading) return loading;
  loading = fetch('data/villa.json', {cache:'no-store'}).then(r => r.ok ? r.json() : null).catch(() => null).then(d => (V = d, d));
  return loading;
}
const sum = (a, k) => a.reduce((s, x) => s + (+x[k] || 0), 0);
function derive(x){ // autoconsommation = production − vente ; autarcie = (consommation − achat) / consommation
  const prod = +x.prod || 0, cons = +x.cons || 0, imp = +x.imp || 0, exp = +x.exp || 0;
  const self = Math.max(0, Math.min(prod, prod - exp));
  return {prod, cons, imp, exp, self, selfPct: prod ? self / prod * 100 : null, autPct: cons ? Math.max(0, cons - imp) / cons * 100 : null};
}

/* ---------- rendu ---------- */
async function render(){
  const d = await load(), body = el('vlBody'), empty = el('vlEmpty');
  if (!d || !d.daily || !Object.keys(d.daily).length) { body.classList.add('hidden'); empty.classList.remove('hidden'); el('vlAuth').href = AUTH; return; }
  body.classList.remove('hidden'); empty.classList.add('hidden');
  const nf0 = PI.nf0, nf1 = PI.nf1, css = PI.css;
  const today = PI.iso(new Date()), days = Object.keys(d.daily).filter(k => k < today).sort();
  const last = days[days.length-1];
  el('vlSub').textContent = `${nf1.format(d.site.kwp)} kWc · en service depuis ${PI.fmtDate(d.site.commissioned)} · données au ${PI.fmtDate(last)} · mise à jour automatique chaque matin`;
  document.querySelectorAll('#vlRange button').forEach(b => b.setAttribute('aria-pressed', b.dataset.r === S.range));
  // période
  let keys, gran;
  if (S.range === '7' || S.range === '30') { keys = days.slice(-+S.range); gran = 'd'; }
  else if (S.range === '12m') { const from = PI.addDays(last, -364); keys = days.filter(k => k >= from); gran = 'm'; }
  else if (S.range === 'ytd') { keys = days.filter(k => k.slice(0,4) === last.slice(0,4)); gran = 'm'; }
  else { keys = days; gran = 'y'; }
  const rows = keys.map(k => Object.assign({k}, derive(d.daily[k])));
  const T = derive({prod:sum(rows,'prod'), cons:sum(rows,'cons'), imp:sum(rows,'imp'), exp:sum(rows,'exp')});
  const hasCons = rows.some(r => r.cons);
  const help = t => `<span class="help" tabindex="0" data-tip="${t}">?</span>`;
  el('vlKpis').innerHTML = [
    ['Production', nf0.format(T.prod) + '<small>kWh</small>', PI.fmtDate(keys[0]) + ' → ' + PI.fmtDate(keys[keys.length-1])],
    ['Consommation', hasCons ? nf0.format(T.cons) + '<small>kWh</small>' : '–', hasCons ? 'de la maison' : 'pas de compteur de consommation'],
    ['Autoconsommation ' + help('Part de votre production utilisée directement à la maison (le reste est vendu au réseau).'), T.selfPct == null ? '–' : nf0.format(T.selfPct) + '<small>%</small>', nf0.format(T.self) + ' kWh utilisés sur place'],
    ['Autonomie ' + help('Part de votre consommation couverte par vos panneaux (le reste est acheté au réseau).'), T.autPct == null ? '–' : nf0.format(T.autPct) + '<small>%</small>', 'de la consommation couverte par le solaire'],
    ['Acheté au réseau', nf0.format(T.imp) + '<small>kWh</small>', 'import'],
    ['Vendu au réseau', nf0.format(T.exp) + '<small>kWh</small>', 'export'],
  ].map(([k,v,s]) => `<div class="kpi"><div class="k">${k}</div><div class="v num" style="font-size:1.5rem">${v}</div><div class="d">${s}</div></div>`).join('');
  // regroupement
  const G = new Map(); rows.forEach(r => { const g = gran === 'd' ? r.k : gran === 'm' ? r.k.slice(0,7) : r.k.slice(0,4);
    const x = G.get(g) || {prod:0, cons:0, imp:0, exp:0}; ['prod','cons','imp','exp'].forEach(f => x[f] += r[f]); G.set(g, x); });
  const gk = [...G.keys()], gv = gk.map(g => derive(G.get(g)));
  const labels = gk.map(g => gran === 'd' ? (() => { const t = PI.D(g); return t.getDate() + ' ' + PI.MOIS[t.getMonth()]; })() : gran === 'm' ? PI.MOIS[+g.slice(5)-1] + ' ' + g.slice(2,4) : g);
  const bar = (label, data, c, stack) => ({label, data, backgroundColor:c, stack, borderRadius:3, borderSkipped:false, maxBarThickness:gran === 'd' ? 18 : 30, categoryPercentage:.8, barPercentage:.9});
  PI.makeChart('cVl', {type:'bar', data:{labels, datasets:[
      bar('Production utilisée à la maison', gv.map(x => +x.self.toFixed(1)), css('--sun'), 'p'),
      bar('Production vendue au réseau', gv.map(x => +x.exp.toFixed(1)), css('--sun') + '77', 'p'),
      ...(hasCons ? [{type:'line', label:'Consommation de la maison', data:gv.map(x => +x.cons.toFixed(1)), borderColor:css('--s1'), backgroundColor:css('--s1'), borderWidth:2.2, pointRadius:gran === 'd' ? 2 : 3, tension:.3},
        bar('Acheté au réseau', gv.map(x => -x.imp.toFixed(1)), css('--s1') + '88', 'i')] : [])]},
    options:PI.baseOpts('kWh', o => { o.scales.x.stacked = true; o.scales.y.stacked = true; o.scales.y.beginAtZero = true;
      o.scales.y.grid.color = c => c.tick.value === 0 ? css('--muted') : css('--grid'); o.scales.y.ticks.callback = v => nf0.format(Math.abs(v));
      o.plugins.legend = {display:true, position:'top', align:'end', labels:{boxWidth:10, boxHeight:10, color:css('--ink-2'), font:{size:11, weight:'600'}}};
      o.plugins.tooltip.callbacks.label = c => ' ' + c.dataset.label + ' : ' + nf1.format(Math.abs(c.parsed.y)) + ' kWh';
      o.plugins.tooltip.callbacks.afterBody = it => { const x = gv[it[0].dataIndex]; return [x.selfPct != null ? 'Autoconsommation : ' + nf0.format(x.selfPct) + ' %' : '', x.autPct != null ? 'Autonomie : ' + nf0.format(x.autPct) + ' %' : '']; }; })});
  el('vlNote').textContent = hasCons ? 'Au-dessus de zéro : votre production (foncé = utilisée à la maison, clair = vendue). Ligne bleue : consommation. Sous zéro : électricité achetée au réseau.' : '';
  renderDay(d);
}
function renderDay(d){
  const css = PI.css, nf1 = PI.nf1, keys = Object.keys(d.p15 || {}).sort();
  const loc = k => new Date(k.replace('Z', ':00Z'));
  const dayOf = k => { const t = loc(k); return t.getFullYear() + '-' + String(t.getMonth()+1).padStart(2,'0') + '-' + String(t.getDate()).padStart(2,'0'); };
  const ds = [...new Set(keys.map(dayOf))].slice(-14);
  if (!ds.length) { el('vlDayCard').classList.add('hidden'); return; }
  el('vlDayCard').classList.remove('hidden');
  if (!S.day || !ds.includes(S.day)) S.day = ds[ds.length - 1];
  el('vlDays').innerHTML = ds.map(x => { const t = PI.D(x); return `<button data-r="${x}" aria-pressed="${x === S.day}">${['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'][t.getDay()]} ${t.getDate()}</button>`; }).join('');
  const ks = keys.filter(k => dayOf(k) === S.day), lab = ks.map(k => { const t = loc(k); return String(t.getHours()).padStart(2,'0') + ':' + String(t.getMinutes()).padStart(2,'0'); });
  const P = ks.map(k => d.p15[k][0]), C = ks.map(k => d.p15[k][1]), hasC = C.some(v => v != null);
  const e = a => a.reduce((s, v) => s + (+v || 0) / 4, 0);
  el('vlDaySum').textContent = `Production ${nf1.format(e(P))} kWh` + (hasC ? ` · consommation ${nf1.format(e(C))} kWh · pic de production ${nf1.format(Math.max(...P.map(v => +v || 0)))} kW` : '');
  PI.makeChart('cVlDay', {type:'line', data:{labels:lab, datasets:[
    {label:'Production', data:P, borderColor:css('--sun'), backgroundColor:css('--sun') + '40', fill:true, borderWidth:1.8, pointRadius:0, tension:.3},
    ...(hasC ? [{label:'Consommation', data:C, borderColor:css('--s1'), backgroundColor:'transparent', borderWidth:2, pointRadius:0, tension:.3}] : [])]},
    options:PI.baseOpts('kW', o => { o.scales.x.ticks.maxTicksLimit = 9; o.plugins.legend = {display:true, position:'top', align:'end', labels:{boxWidth:10, boxHeight:3, color:css('--ink-2'), font:{size:11, weight:'600'}}};
      o.plugins.tooltip.callbacks.label = c => ' ' + c.dataset.label + ' : ' + nf1.format(c.parsed.y) + ' kW'; })});
}

PI.renderVilla = render;
function wire(){
  oauthLanding();
  if (!el('vlRange')) return;
  el('vlRange').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { S.range = b.dataset.r; render(); } });
  el('vlDays').addEventListener('click', e => { const b = e.target.closest('button'); if (b && V) { S.day = b.dataset.r; renderDay(V); } });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
