/* PolyImmo Solaire — saisies (factures GRD, versements banque, autres revenus, charges)
   Stockage : data/entries.json dans le dépôt GitHub (lecture publique, écriture avec une clé GitHub gardée dans ce navigateur). */
'use strict';
(function(){
const PI = window.PI = window.PI || {};
const el = id => document.getElementById(id);
const CFG_KEY = 'pi-gh-v1', CACHE_KEY = 'pi-entries-cache-v1';
const TYPES = {
  grd:    {label:'Facture GRD',      short:'GRD',    icon:'⚡', hint:'Décompte de reprise du gestionnaire de réseau (kWh + montant)'},
  banque: {label:'Versement banque', short:'Banque', icon:'🏦', hint:'Montant reçu sur le compte bancaire'},
  autre:  {label:'Autre revenu',     short:'Autre',  icon:'➕', hint:'Indemnité, subvention, rétribution unique…'},
  charge: {label:'Charge',           short:'Charge', icon:'🧾', hint:'Entretien, assurance, réparation, nettoyage…'},
};
PI.TYPES = TYPES;

/* ---------------- store ---------------- */
const store = PI.store = {entries:[], sha:null, pending:false, status:'…', source:''};
const cfg = () => { try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch(e){ return {}; } };
const setCfg = c => { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch(e){} };
const hasToken = () => !!cfg().token;
const repo = () => cfg().repo || 'bamo378/Polyimmo';
const branch = () => cfg().branch || 'main';
const b64e = s => btoa(unescape(encodeURIComponent(s)));
const b64d = s => decodeURIComponent(escape(atob(s.replace(/\n/g,''))));
const api = (path, opt = {}) => fetch('https://api.github.com/repos/' + repo() + path, {...opt, headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer ' + cfg().token, ...(opt.headers||{})}});

store.load = async function(){
  let remote = null;
  try {
    if (hasToken()) {
      const r = await api('/contents/data/entries.json?ref=' + branch());
      if (r.ok) { const j = await r.json(); store.sha = j.sha; remote = JSON.parse(b64d(j.content)); store.source = 'github'; }
      else if (r.status === 404) { remote = {version:1, entries:[]}; store.source = 'github'; }
      else throw new Error('HTTP ' + r.status);
    }
  } catch(e){ console.warn('GitHub indisponible', e); }
  if (!remote) { try { remote = await (await fetch('data/entries.json', {cache:'no-store'})).json(); store.source = 'site'; } catch(e){ remote = {version:1, entries:[]}; } }
  let local = null; try { local = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch(e){}
  if (local && local.pending) { store.entries = merge(remote.entries, local.entries); store.pending = true; }
  else store.entries = remote.entries || [];
  setStatus();
  if (store.pending && hasToken()) store.push('Synchronisation des saisies en attente');
  return store.entries;
};
function merge(a, b){ const m = new Map(); (a||[]).forEach(e => m.set(e.id, e)); (b||[]).forEach(e => { const x = m.get(e.id); if (!x || (e.updated||'') >= (x.updated||'')) m.set(e.id, e); });
  return [...m.values()].filter(e => !e.deleted); }
function cache(){ try { localStorage.setItem(CACHE_KEY, JSON.stringify({pending:store.pending, entries:store.entries})); } catch(e){} }
store.push = async function(msg){
  store.pending = true; cache(); setStatus('sync');
  if (!hasToken()) { setStatus(); return false; }
  const body = JSON.stringify({version:1, updated:new Date().toISOString().slice(0,10), entries:store.entries.slice().sort((a,b)=>a.from<b.from?-1:1)}, null, 1);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await api('/contents/data/entries.json', {method:'PUT', body:JSON.stringify({message:'Saisie : ' + msg, content:b64e(body), sha:store.sha || undefined, branch:branch()})});
      if (r.ok) { const j = await r.json(); store.sha = j.content.sha; store.pending = false; cache(); setStatus(); return true; }
      if (r.status === 409 || r.status === 422) { // conflit : recharger et fusionner
        const g = await api('/contents/data/entries.json?ref=' + branch()); if (g.ok) { const j = await g.json(); store.sha = j.sha; store.entries = merge(JSON.parse(b64d(j.content)).entries, store.entries); continue; }
      }
      throw new Error('HTTP ' + r.status);
    } catch(e){ console.warn(e); setStatus('error'); return false; }
  }
  setStatus('error'); return false;
};
store.upsert = function(e){ const now = new Date().toISOString(); e.updated = now; if (!e.id) { e.id = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); e.created = now.slice(0,10); }
  const i = store.entries.findIndex(x => x.id === e.id); if (i >= 0) store.entries[i] = e; else store.entries.push(e);
  changed(); store.push((i >= 0 ? 'modification ' : 'ajout ') + TYPES[e.type].short + ' ' + periodLabel(e)); return e; };
store.remove = function(id){ const i = store.entries.findIndex(x => x.id === id); if (i < 0) return null; const [e] = store.entries.splice(i,1);
  changed(); store.push('suppression ' + TYPES[e.type].short + ' ' + periodLabel(e)); return e; };
function setStatus(s){
  const pill = el('syncPill'); if (!pill) return;
  let txt, cls;
  if (s === 'sync') { txt = 'Enregistrement…'; cls = 'busy'; }
  else if (s === 'error') { txt = 'Échec GitHub — gardé dans ce navigateur'; cls = 'err'; }
  else if (store.pending) { txt = hasToken() ? 'Modifications à synchroniser' : 'Gardé dans ce navigateur — connectez GitHub'; cls = 'warn'; }
  else if (hasToken()) { txt = 'Synchronisé avec GitHub'; cls = 'ok'; }
  else { txt = 'Lecture seule — connectez GitHub pour enregistrer'; cls = ''; }
  pill.textContent = txt; pill.className = 'sync ' + cls;
}
PI.setSyncStatus = setStatus;

/* ---------------- dérivés ---------------- */
const qOfDate = k => k.slice(0,4) + '-T' + (Math.floor((+k.slice(5,7)-1)/3)+1);
PI.qOfDate = qOfDate;
function periodLabel(e){
  if (!e.from) return '';
  const f = e.from, t = e.to || e.from, M = (PI.MOIS || []);
  const lastDay = d => new Date(+d.slice(0,4), +d.slice(5,7), 0).getDate();
  if (f.slice(8) === '01' && +t.slice(8) === lastDay(t)) {
    const fm = +f.slice(5,7), tm = +t.slice(5,7);
    if (f.slice(0,7) === t.slice(0,7)) return (M[fm-1] || fm) + ' ' + f.slice(0,4);
    if (f.slice(0,4) === t.slice(0,4) && fm % 3 === 1 && tm === fm + 2) return 'T' + ((fm+2)/3) + ' ' + f.slice(0,4);
  }
  return PI.fmtDate ? PI.fmtDate(f) + ' – ' + PI.fmtDate(t) : f + ' – ' + t;
}
PI.periodLabel = periodLabel;
PI.derive = function(){
  const mq = {}, rev = {}, other = {}, charges = {}, cover = {};
  store.entries.forEach(e => {
    const q = qOfDate(e.from || e.date);
    if (e.type === 'grd') { mq[q] = (mq[q]||0) + (+e.kwhHT||0) + (+e.kwhBT||0); rev[q] = (rev[q]||0) + (+e.amount||0); }
    else if (e.type === 'autre') other[q] = (other[q]||0) + (+e.amount||0);
    else if (e.type === 'charge') { const y = (e.date || e.from).slice(0,4); charges[y] = (charges[y]||0) + (+e.amount||0); }
  });
  const prices = {}; Object.keys(rev).forEach(k => { if (mq[k]) prices[k] = rev[k] / mq[k] * 100; });
  return {meterQuarters:mq, revenueActual:rev, otherRevenue:other, chargesActual:charges, pricesActual:prices};
};
function changed(){ cache(); if (PI.onEntriesChanged) PI.onEntriesChanged(); renderList(); renderStats(); }

/* ---------------- UI : liste ---------------- */
const ui = {type:'all', year:'all', q:'', sort:'from', dir:-1};
PI.renderSaisie = function(){ renderStats(); renderList(); setStatus(); };
function fmtCHF(v){ return PI.nf2 ? PI.nf2.format(v) : v.toFixed(2); }
function renderStats(){
  const box = el('saisieStats'); if (!box || !PI.nf0) return;
  const g = store.entries.filter(e => e.type === 'grd').sort((a,b) => a.from < b.from ? 1 : -1);
  const last = g[0]; const yy = new Date().getFullYear().toString();
  const yRev = store.entries.filter(e => (e.type === 'grd' || e.type === 'autre') && (e.from||'').startsWith(yy)).reduce((a,e)=>a+(+e.amount||0),0);
  const next = nextExpected();
  const nb = store.entries.length, banks = store.entries.filter(e => e.type === 'banque').length;
  const items = [
    ['Saisies', PI.nf0.format(nb), banks + ' versement(s) bancaire(s)'],
    ['Dernière facture GRD', last ? periodLabel(last) : '–', last ? PI.nf0.format((+last.kwhHT||0)+(+last.kwhBT||0)) + ' kWh · ' + fmtCHF(+last.amount) + ' CHF' : ''],
    ['Encaissé en ' + yy, PI.nf0.format(yRev) + ' CHF', 'factures GRD + autres revenus'],
    ['Prochaine facture attendue', next.label, next.sub],
  ];
  box.replaceChildren(...items.map(([a,b,c]) => { const d = document.createElement('div'); d.className = 'kpi';
    const k = document.createElement('div'); k.className = 'k'; k.textContent = a; const v = document.createElement('div'); v.className = 'v num'; v.textContent = b;
    const s = document.createElement('div'); s.className = 'd'; s.textContent = c; d.append(k,v,s); return d; }));
}
function nextExpected(){
  const g = store.entries.filter(e => e.type === 'grd'); if (!g.length) return {label:'–', sub:''};
  const lastTo = g.map(e => e.to || e.from).sort().pop(); const d = new Date(lastTo + 'T12:00:00'); d.setDate(d.getDate()+1);
  const from = d.toLocaleDateString('sv-SE'); const quarterly = g.filter(e => (e.from||'').startsWith(lastTo.slice(0,4))).length <= 4 && lastTo.slice(5,7) % 3 === 0;
  const to = quarterly ? new Date(d.getFullYear(), d.getMonth()+3, 0, 12) : new Date(d.getFullYear(), d.getMonth()+1, 0, 12);
  const pe = {from, to:to.toLocaleDateString('sv-SE')};
  const due = new Date(to); due.setDate(due.getDate() + 30);
  return {label: periodLabel(pe), sub: 'période ' + (pe.to < new Date().toLocaleDateString('sv-SE') ? 'terminée' : 'se termine') + ' le ' + PI.fmtDate(pe.to) + ' · facture vers ' + due.toLocaleDateString('fr-CH',{month:'long',year:'numeric'}), period: pe, quarterly};
}
PI.nextExpected = nextExpected;
function renderList(){
  const t = el('entriesTable'); if (!t || !PI.nf0) return;
  const years = [...new Set(store.entries.map(e => (e.from||e.date||'').slice(0,4)))].sort().reverse();
  const ys = el('entYear'); if (ys && ys.options.length !== years.length + 1) { ys.replaceChildren(new Option('Toutes les années','all'), ...years.map(y => new Option(y,y))); ys.value = ui.year; }
  const checks = PI.checksByEntry ? PI.checksByEntry() : {};
  let rows = store.entries.filter(e => (ui.type === 'all' || e.type === ui.type) && (ui.year === 'all' || (e.from||e.date||'').startsWith(ui.year)));
  if (ui.q) { const q = ui.q.toLowerCase(); rows = rows.filter(e => [periodLabel(e), e.issuer, e.ref, e.note, TYPES[e.type].label].join(' ').toLowerCase().includes(q)); }
  const val = e => ui.sort === 'amount' ? +e.amount || 0 : ui.sort === 'kwh' ? (+e.kwhHT||0)+(+e.kwhBT||0) : ui.sort === 'type' ? e.type : (e.from || e.date || '');
  rows.sort((a,b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * ui.dir);
  const head = [['from','Période'],['type','Type'],['','Émetteur / libellé'],['kwh','kWh'],['amount','Montant CHF'],['','ct/kWh'],['','Contrôle'],['','']];
  const thead = document.createElement('thead'); const tr0 = document.createElement('tr');
  head.forEach(([k,l],i) => { const th = document.createElement('th'); th.textContent = l + (k && ui.sort === k ? (ui.dir > 0 ? ' ▲' : ' ▼') : ''); if (i < 3) th.className = 'l';
    if (k) { th.style.cursor = 'pointer'; th.onclick = () => { if (ui.sort === k) ui.dir *= -1; else { ui.sort = k; ui.dir = -1; } renderList(); }; } tr0.appendChild(th); });
  thead.appendChild(tr0);
  const tb = document.createElement('tbody');
  if (!rows.length) { const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 8; td.className = 'empty-row'; td.textContent = 'Aucune saisie ne correspond aux filtres.'; tr.appendChild(td); tb.appendChild(tr); }
  let sumA = 0, sumK = 0;
  rows.forEach(e => {
    const tr = document.createElement('tr'); tr.dataset.id = e.id;
    const kwh = (+e.kwhHT||0) + (+e.kwhBT||0); const sign = e.type === 'charge' ? -1 : 1;
    if (e.type !== 'banque') sumA += sign * (+e.amount||0); sumK += e.type === 'grd' ? kwh : 0;
    const c = checks[e.id] || [];
    const cells = [
      [periodLabel(e) + (e.date ? '' : ''), 'l'],
      [null, 'l', () => { const s = document.createElement('span'); s.className = 'tbadge t-' + e.type; s.textContent = TYPES[e.type].icon + ' ' + TYPES[e.type].short; return s; }],
      [(e.issuer || '') + (e.ref ? ' · ' + e.ref : ''), 'l muted'],
      [e.type === 'grd' ? PI.nf0.format(kwh) : '–', 'num'],
      [(sign < 0 ? '−' : '') + fmtCHF(+e.amount||0), 'num'],
      [e.type === 'grd' && kwh ? PI.nf2.format((+e.amount)/kwh*100) : '–', 'num'],
      [null, '', () => { const s = document.createElement('span');
        if (!c.length) { s.className = 'chk ok'; s.textContent = '✓'; s.title = 'Aucune incohérence détectée'; }
        else { const worst = c.some(x => x.sev === 'erreur') ? 'err' : c.some(x => x.sev === 'attention') ? 'warn' : 'info'; s.className = 'chk ' + worst; s.textContent = c.length; s.title = c.map(x => x.title).join('\n'); }
        return s; }],
      [null, 'act', () => { const w = document.createElement('div'); w.className = 'rowact';
        [['Modifier','✎',() => openForm(e)],['Dupliquer','⧉',() => openForm({...e, id:null, from:null, to:null, date:null, ref:''}, true)],['Supprimer','🗑',() => del(e.id)]].forEach(([t,i,f]) => {
          const b = document.createElement('button'); b.type = 'button'; b.title = t; b.setAttribute('aria-label', t); b.textContent = i; b.onclick = ev => { ev.stopPropagation(); f(); }; w.appendChild(b); });
        return w; }],
    ];
    cells.forEach(([v, cl, fn]) => { const td = document.createElement('td'); td.className = cl; if (fn) td.appendChild(fn()); else td.textContent = v; tr.appendChild(td); });
    tr.onclick = () => openForm(e);
    tb.appendChild(tr);
  });
  const tf = document.createElement('tfoot'); const trf = document.createElement('tr');
  [['Total (' + rows.length + ')','l'],['',''],['',''],[PI.nf0.format(sumK),'num'],[fmtCHF(sumA),'num'],['',''],['',''],['','']].forEach(([v,c]) => { const td = document.createElement('td'); td.textContent = v; td.className = c; trf.appendChild(td); });
  tf.appendChild(trf);
  t.replaceChildren(thead, tb, tf);
}
function del(id){
  const e = store.remove(id); if (!e) return;
  const t = el('toast'); t.replaceChildren(document.createTextNode('Saisie supprimée '));
  const b = document.createElement('button'); b.className = 'undo'; b.textContent = 'Annuler'; b.onclick = () => { delete e.updated; store.upsert(e); t.classList.remove('on'); };
  t.appendChild(b); t.classList.add('on', 'interactive'); clearTimeout(PI._tt); PI._tt = setTimeout(() => t.classList.remove('on','interactive'), 6000);
}

/* ---------------- UI : formulaire (panneau latéral) ---------------- */
let cur = null, mode = 'quarter';
function openForm(e, isDup){
  cur = e && e.id ? JSON.parse(JSON.stringify(e)) : Object.assign({type:'grd', issuer:'', kwhHT:'', kwhBT:'', amount:'', ref:'', note:''}, e || {});
  if (!cur.from) { const n = nextExpected(); if (cur.type === 'grd' && n.period) { cur.from = n.period.from; cur.to = n.period.to; } }
  if (!cur.issuer) cur.issuer = cur.type === 'grd' ? lastIssuer('grd') || 'Romande Energie' : lastIssuer(cur.type) || '';
  mode = detectMode(cur);
  el('dTitle').textContent = cur.id ? 'Modifier la saisie' : isDup ? 'Nouvelle saisie (copie)' : 'Nouvelle saisie';
  el('dDelete').classList.toggle('hidden', !cur.id);
  fillForm(); el('drawer').classList.add('open'); el('drawerBg').classList.add('open'); document.body.classList.add('noscroll');
  setTimeout(() => { const f = el('drawer').querySelector('[data-f="amount"]'); if (cur.type === 'grd') el('drawer').querySelector('[data-f="kwhHT"]').focus(); else f.focus(); }, 250);
}
PI.openForm = openForm;
function closeForm(){ el('drawer').classList.remove('open'); el('drawerBg').classList.remove('open'); document.body.classList.remove('noscroll'); cur = null; }
function lastIssuer(type){ const x = store.entries.filter(e => e.type === type && e.issuer).sort((a,b) => (a.from||'') < (b.from||'') ? 1 : -1)[0]; return x ? x.issuer : ''; }
function detectMode(e){
  if (!e.from) return e.type === 'grd' ? 'quarter' : 'date';
  const f = e.from, t = e.to || f, ld = new Date(+t.slice(0,4), +t.slice(5,7), 0).getDate();
  if (f.slice(8) === '01' && +t.slice(8) === ld) { if (f.slice(0,7) === t.slice(0,7)) return 'month'; const fm = +f.slice(5,7), tm = +t.slice(5,7); if (fm % 3 === 1 && tm === fm + 2 && f.slice(0,4) === t.slice(0,4)) return 'quarter'; }
  return f === t ? 'date' : 'range';
}
function fillForm(){
  document.querySelectorAll('#dType button').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === cur.type));
  el('dTypeHint').textContent = TYPES[cur.type].hint;
  document.querySelectorAll('#dMode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === mode));
  const y = (cur.from || new Date().toISOString()).slice(0,4);
  el('dYear').value = y;
  const m = +(cur.from || new Date().toISOString()).slice(5,7);
  document.querySelectorAll('#dQ button').forEach(b => b.setAttribute('aria-pressed', mode === 'quarter' && +b.dataset.q === Math.floor((m-1)/3)+1));
  el('dMonth').value = m;
  el('dpFrom').value = cur.from || ''; el('dpTo').value = cur.to || '';
  ['qRow','mRow','rRow'].forEach(id => el(id).classList.add('hidden'));
  el(mode === 'quarter' ? 'qRow' : mode === 'month' ? 'mRow' : 'rRow').classList.remove('hidden');
  el('dToWrap').classList.toggle('hidden', mode === 'date');
  el('dDateLbl').classList.toggle('hidden', mode === 'date');
  document.querySelector('#rRow > span').textContent = mode === 'date' ? (cur.type === 'banque' ? 'Date du versement' : 'Date') : 'Du … au …';
  el('kwhRow').classList.toggle('hidden', cur.type !== 'grd');
  el('dAmountLbl').firstChild.textContent = cur.type === 'charge' ? 'Montant de la charge (CHF TTC)' : cur.type === 'banque' ? 'Montant reçu (CHF)' : 'Montant encaissé (CHF TTC)';
  el('dDateLbl').firstChild.textContent = cur.type === 'banque' ? 'Date du versement' : cur.type === 'charge' ? 'Date de la facture' : 'Date du document';
  el('drawer').querySelectorAll('[data-f]').forEach(i => { const k = i.dataset.f; i.value = cur[k] == null ? '' : cur[k]; });
  const dl = el('issuerList'); const iss = [...new Set(store.entries.filter(e => e.type === cur.type).map(e => e.issuer).filter(Boolean).concat(cur.type === 'grd' ? ['Romande Energie','Groupe E'] : cur.type === 'banque' ? ['Banque cantonale','UBS','PostFinance','Raiffeisen'] : []))];
  dl.replaceChildren(...iss.map(v => new Option(v)));
  preview();
}
function setPeriodFromControls(){
  const y = +el('dYear').value || new Date().getFullYear();
  if (mode === 'quarter') { const b = document.querySelector('#dQ button[aria-pressed="true"]'); const q = b ? +b.dataset.q : 1;
    cur.from = `${y}-${String(3*q-2).padStart(2,'0')}-01`; cur.to = new Date(y, 3*q, 0, 12).toLocaleDateString('sv-SE'); }
  else if (mode === 'month') { const m = +el('dMonth').value; cur.from = `${y}-${String(m).padStart(2,'0')}-01`; cur.to = new Date(y, m, 0, 12).toLocaleDateString('sv-SE'); }
  else if (mode === 'date') { cur.from = el('dpFrom').value || null; cur.to = cur.from; }
  else { cur.from = el('dpFrom').value || null; cur.to = el('dpTo').value || cur.from; }
}
function readFields(){ el('drawer').querySelectorAll('[data-f]').forEach(i => { const k = i.dataset.f; cur[k] = i.type === 'number' ? (i.value === '' ? '' : +i.value) : i.value.trim(); }); }
function preview(){
  const box = el('dPreview'); if (!cur) return;
  readFields(); if (mode === 'range' || mode === 'date') setPeriodFromControls();
  const parts = [];
  const kwh = (+cur.kwhHT||0) + (+cur.kwhBT||0);
  if (cur.type === 'grd') {
    parts.push(['Total', kwh ? PI.nf0.format(kwh) + ' kWh' : '–']);
    parts.push(['Prix moyen', kwh && cur.amount ? PI.nf2.format(cur.amount/kwh*100) + ' ct/kWh' : '–']);
    if (kwh) parts.push(['Part haut tarif', PI.nf0.format((+cur.kwhHT||0)/kwh*100) + ' %']);
    const au = PI.auroraFor ? PI.auroraFor(cur.from, cur.to) : null;
    if (au) parts.push(['Aurora Vision', PI.nf0.format(au) + ' kWh' + (kwh ? ' (' + (kwh/au-1 >= 0 ? '+' : '') + PI.nf1.format((kwh/au-1)*100) + ' %)' : '')]);
  }
  if (cur.from) parts.push(['Période', periodLabel(cur) + ' (' + PI.fmtDate(cur.from) + ' → ' + PI.fmtDate(cur.to || cur.from) + ')']);
  const issues = PI.checkEntry ? PI.checkEntry(cur) : [];
  box.replaceChildren();
  const grid = document.createElement('div'); grid.className = 'pv-grid';
  parts.forEach(([a,b]) => { const d = document.createElement('div'); const s = document.createElement('span'); s.textContent = a; const st = document.createElement('strong'); st.textContent = b; d.append(s, st); grid.appendChild(d); });
  box.appendChild(grid);
  if (issues.length) issues.forEach(x => { const d = document.createElement('div'); d.className = 'pv-issue ' + x.sev; d.textContent = (x.sev === 'erreur' ? '✕ ' : x.sev === 'attention' ? '! ' : 'i ') + x.title + (x.detail ? ' — ' + x.detail : ''); box.appendChild(d); });
  else if (cur.from && cur.amount !== '') { const d = document.createElement('div'); d.className = 'pv-issue ok'; d.textContent = '✓ Aucune incohérence détectée'; box.appendChild(d); }
}
function validate(){
  readFields(); if (mode === 'range' || mode === 'date') setPeriodFromControls();
  const err = [];
  if (!cur.from) err.push('Indiquez la période ou la date.');
  if (cur.to && cur.from && cur.to < cur.from) err.push('La date de fin précède la date de début.');
  if (cur.amount === '' || isNaN(+cur.amount)) err.push('Indiquez le montant.');
  if (cur.type === 'grd' && !((+cur.kwhHT||0) + (+cur.kwhBT||0))) err.push('Indiquez les kWh (haut et/ou bas tarif).');
  el('dErr').textContent = err.join(' '); el('dErr').classList.toggle('hidden', !err.length);
  return !err.length;
}
function save(andNew){
  if (!validate()) return;
  const e = {...cur}; ['kwhHT','kwhBT','amount'].forEach(k => e[k] = e[k] === '' ? 0 : +e[k]); if (mode === 'date') e.date = e.from; if (!e.date) e.date = null;
  if (e.type !== 'grd') { e.kwhHT = 0; e.kwhBT = 0; }
  store.upsert(e); PI.toast('Saisie enregistrée' + (hasToken() ? '' : ' (dans ce navigateur)'));
  if (andNew) { const t = e.type; closeForm(); setTimeout(() => openForm({type:t}), 200); } else closeForm();
}
function wireForm(){
  el('dType').onclick = ev => { const b = ev.target.closest('button'); if (!b) return; readFields(); cur.type = b.dataset.t;
    if (!cur.issuer || Object.values(TYPES).some(()=>true)) cur.issuer = lastIssuer(cur.type) || (cur.type === 'grd' ? 'Romande Energie' : '');
    if (cur.type !== 'grd' && mode === 'quarter') mode = 'date'; fillForm(); };
  el('dMode').onclick = ev => { const b = ev.target.closest('button'); if (!b) return; readFields(); mode = b.dataset.m; if (mode === 'quarter' || mode === 'month') setPeriodFromControls(); fillForm(); };
  el('dQ').onclick = ev => { const b = ev.target.closest('button'); if (!b) return; document.querySelectorAll('#dQ button').forEach(x => x.setAttribute('aria-pressed', x === b)); setPeriodFromControls(); preview(); };
  ['dYear','dMonth'].forEach(id => el(id).oninput = () => { setPeriodFromControls(); preview(); });
  ['dpFrom','dpTo'].forEach(id => el(id).oninput = () => { setPeriodFromControls(); preview(); });
  el('drawer').querySelectorAll('[data-f]').forEach(i => i.oninput = preview);
  el('dSave').onclick = () => save(false); el('dSaveNew').onclick = () => save(true);
  el('dCancel').onclick = closeForm; el('drawerBg').onclick = closeForm; el('dClose').onclick = closeForm;
  el('dDelete').onclick = () => { const id = cur.id; closeForm(); del(id); };
  el('drawer').addEventListener('keydown', ev => { if (ev.key === 'Escape') closeForm(); if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') { ev.preventDefault(); save(ev.shiftKey); } });
  document.querySelectorAll('[data-new]').forEach(b => b.onclick = () => openForm({type:b.dataset.new}));
  el('entType').onclick = ev => { const b = ev.target.closest('button'); if (!b) return; ui.type = b.dataset.t; document.querySelectorAll('#entType button').forEach(x => x.setAttribute('aria-pressed', x === b)); renderList(); };
  el('entYear').onchange = ev => { ui.year = ev.target.value; renderList(); };
  el('entSearch').oninput = ev => { ui.q = ev.target.value; renderList(); };
  el('entCsv').onclick = exportCsv; el('entJson').onclick = exportJson; el('entTpl').onclick = template;
  el('entImport').onchange = importCsv;
  // GitHub
  el('ghBtn').onclick = openGh; el('ghClose').onclick = closeGh; el('ghBg').onclick = closeGh;
  el('ghSave').onclick = async () => { const c = {token:el('ghToken').value.trim(), repo:el('ghRepo').value.trim() || 'bamo378/Polyimmo', branch:el('ghBranch').value.trim() || 'main'}; setCfg(c); await testGh(); };
  el('ghOut').onclick = () => { setCfg({}); el('ghToken').value = ''; el('ghState').textContent = 'Déconnecté. La clé a été effacée de ce navigateur.'; el('ghState').className = 'ghstate'; setStatus(); };
}
async function testGh(){
  const s = el('ghState'); s.textContent = 'Test de la connexion…'; s.className = 'ghstate';
  try {
    const r = await api(''); if (!r.ok) throw new Error(r.status === 401 ? 'clé invalide ou expirée' : r.status === 404 ? 'dépôt introuvable ou clé sans accès à ce dépôt' : 'erreur ' + r.status);
    const j = await r.json(); if (j.permissions && !j.permissions.push) throw new Error('la clé n\'a pas le droit d\'écriture (Contents : Read and write)');
    s.textContent = '✓ Connecté à ' + j.full_name + (j.private ? ' (dépôt privé)' : ' (dépôt public)') + '. Les saisies seront enregistrées dans data/entries.json.'; s.className = 'ghstate ok';
    await store.load(); changed();
  } catch(e){ s.textContent = '✕ Échec : ' + e.message; s.className = 'ghstate err'; }
  setStatus();
}
function openGh(){ const c = cfg(); el('ghToken').value = c.token || ''; el('ghRepo').value = c.repo || 'bamo378/Polyimmo'; el('ghBranch').value = c.branch || 'main';
  el('ghState').textContent = c.token ? 'Une clé est enregistrée dans ce navigateur.' : 'Aucune clé enregistrée.'; el('ghState').className = 'ghstate';
  el('ghModal').classList.add('open'); el('ghBg').classList.add('open'); }
function closeGh(){ el('ghModal').classList.remove('open'); el('ghBg').classList.remove('open'); }

/* ---------------- export / import ---------------- */
const COLS = ['type','from','to','date','kwhHT','kwhBT','amount','issuer','ref','note'];
function download(name, text, type){ const a = Object.assign(document.createElement('a'), {href:URL.createObjectURL(new Blob([text], {type})), download:name}); document.body.appendChild(a); a.click(); a.remove(); }
const csvCell = v => { v = v == null ? '' : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v; };
function exportCsv(){ download('polyimmo_saisies.csv', '﻿' + [COLS.join(';')].concat(store.entries.map(e => COLS.map(c => csvCell(e[c])).join(';'))).join('\n'), 'text/csv'); }
function exportJson(){ download('polyimmo_saisies.json', JSON.stringify({version:1, entries:store.entries}, null, 1), 'application/json'); }
function template(){ download('modele_saisies.csv', '﻿' + COLS.join(';') + '\ngrd;2026-10-01;2026-12-31;2027-01-20;12000;5000;1450.50;Romande Energie;F-123;Relevé T4\nbanque;2027-01-28;2027-01-28;2027-01-28;0;0;1450.50;Banque;;Versement GRD\n', 'text/csv'); }
function parseCsv(text){
  const rows = []; let row = [], v = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i+1] === '"') { v += '"'; i++; } else q = false; } else v += c; }
    else if (c === '"') q = true; else if (c === ';' || c === ',') { row.push(v); v = ''; } else if (c === '\n') { row.push(v); rows.push(row); row = []; v = ''; } else if (c !== '\r') v += c; }
  if (v || row.length) { row.push(v); rows.push(row); } return rows;
}
async function importCsv(ev){
  const f = ev.target.files[0]; if (!f) return; ev.target.value = '';
  try {
    const text = (await f.text()).replace(/^﻿/, '');
    let list;
    if (f.name.endsWith('.json')) list = JSON.parse(text).entries;
    else { const rows = parseCsv(text); const h = rows.shift().map(x => x.trim()); list = rows.filter(r => r.some(Boolean)).map(r => Object.fromEntries(h.map((k,i) => [k, r[i]]))); }
    let n = 0;
    list.forEach(x => { if (!TYPES[x.type] || !x.from) return;
      const e = {type:x.type, from:x.from, to:x.to || x.from, date:x.date || null, kwhHT:+String(x.kwhHT||0).replace(',','.')||0, kwhBT:+String(x.kwhBT||0).replace(',','.')||0,
        amount:+String(x.amount||0).replace(',','.')||0, issuer:x.issuer||'', ref:x.ref||'', note:x.note||''};
      const dup = store.entries.some(y => y.type === e.type && y.from === e.from && y.to === e.to && Math.abs((+y.amount) - e.amount) < 0.01);
      if (!dup) { e.id = 'e' + Date.now().toString(36) + (n++) + Math.random().toString(36).slice(2,5); e.created = new Date().toISOString().slice(0,10); e.updated = new Date().toISOString(); store.entries.push(e); } });
    changed(); if (n) store.push('import de ' + n + ' saisie(s)'); PI.toast(n + ' saisie(s) importée(s)' + (list.length - n ? ' · ' + (list.length - n) + ' ignorée(s) (doublons ou invalides)' : ''));
  } catch(e){ PI.toast('Fichier illisible'); console.error(e); }
}

document.addEventListener('DOMContentLoaded', wireForm);
if (document.readyState !== 'loading') wireForm();
})();
