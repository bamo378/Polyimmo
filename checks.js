/* PolyImmo Solaire — analyse des incohérences */
'use strict';
(function(){
const PI = window.PI = window.PI || {};
const el = id => document.getElementById(id);
const SEV = {erreur:0, attention:1, info:2};
const today = () => new Date().toLocaleDateString('sv-SE');
const kwhOf = e => (+e.kwhHT||0) + (+e.kwhBT||0);
const pct = v => (v >= 0 ? '+' : '') + PI.nf1.format(v*100) + ' %';
const addD = (s,n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate()+n); return d.toLocaleDateString('sv-SE'); };

PI.auroraFor = function(from, to){
  if (!from || !PI.PLANT || !PI.FIRST) return null; to = to || from;
  if (from < PI.FIRST || to > PI.LAST) return null;
  let s = 0; for (let k = from; k <= to; k = addD(k,1)) s += PI.PLANT[k] || 0; return s;
};
function quarterPrice(q, excludeId){
  const g = PI.store.entries.filter(e => e.type === 'grd' && e.id !== excludeId && PI.qOfDate(e.from) === q);
  const k = g.reduce((a,e)=>a+kwhOf(e),0), m = g.reduce((a,e)=>a+(+e.amount||0),0); return k ? m/k*100 : null;
}
const prevQ = q => { let y = +q.slice(0,4), t = +q.slice(-1) - 1; if (!t) { t = 4; y--; } return y + '-T' + t; };

/* contrôles d'une saisie (aussi utilisée en direct dans le formulaire) */
PI.checkEntry = function(e){
  const out = []; if (!e || !e.from) return out;
  const add = (sev, cat, title, detail) => out.push({sev, cat, title, detail, id:e.id, period:PI.periodLabel(e)});
  const amt = +e.amount || 0, kwh = kwhOf(e);
  if ((e.date && e.date > today()) || e.from > today()) add('attention','Saisie','Date dans le futur', 'vérifiez la date ou la période');
  else if (e.type === 'grd' && (e.to || e.from) > today()) add('attention','Facture GRD','Période pas encore terminée', 'la période se termine le ' + PI.fmtDate(e.to) + ' : vérifiez les dates de la facture');
  const dup = PI.store.entries.filter(x => x.id !== e.id && x.type === e.type && x.from === e.from && (x.to||x.from) === (e.to||e.from) && Math.abs((+x.amount||0) - amt) < 0.01);
  if (dup.length) add('erreur','Doublon','Saisie en double', 'même type, même période et même montant qu\'une autre saisie');
  if (e.type === 'grd') {
    if (amt > 0 && !kwh) add('attention','Facture GRD','Montant sans kWh', 'la facture devrait indiquer l\'énergie reprise');
    if (kwh && !amt) add('attention','Facture GRD','kWh sans montant', 'montant manquant');
    const over = PI.store.entries.filter(x => x.id !== e.id && x.type === 'grd' && x.from <= (e.to||e.from) && (x.to||x.from) >= e.from && !dup.includes(x));
    if (over.length) add('erreur','Facture GRD','Périodes qui se chevauchent', 'chevauche ' + over.map(PI.periodLabel).join(', '));
    const au = PI.auroraFor(e.from, e.to);
    if (au && kwh) { const d = kwh/au - 1;
      if (Math.abs(d) > 0.10) add('erreur','Production','Écart important avec Aurora Vision', 'facture ' + PI.nf0.format(kwh) + ' kWh, Aurora ' + PI.nf0.format(au) + ' kWh (' + pct(d) + ')');
      else if (Math.abs(d) > 0.03) add('attention','Production','Écart avec Aurora Vision', 'facture ' + PI.nf0.format(kwh) + ' kWh, Aurora ' + PI.nf0.format(au) + ' kWh (' + pct(d) + ')'); }
    if (kwh) { const ht = (+e.kwhHT||0)/kwh; if (ht < 0.5 || ht > 0.9) add('info','Facture GRD','Répartition haut/bas tarif inhabituelle', 'haut tarif ' + PI.nf0.format(ht*100) + ' % (habituellement 65–80 %)'); }
    if (kwh && amt) {
      const p = amt/kwh*100, q = PI.qOfDate(e.from), ly = (+q.slice(0,4)-1) + q.slice(4);
      const pLy = quarterPrice(ly, e.id), pPq = quarterPrice(prevQ(q), e.id);
      if (pLy && Math.abs(p/pLy-1) > 0.35) add('attention','Prix','Prix de reprise très différent de l\'an dernier', PI.nf2.format(p) + ' ct/kWh contre ' + PI.nf2.format(pLy) + ' ct au ' + ly.replace('-',' ') + ' (' + pct(p/pLy-1) + ')');
      else if (pPq && Math.abs(p/pPq-1) > 0.35) add('info','Prix','Prix très différent du trimestre précédent', PI.nf2.format(p) + ' ct/kWh contre ' + PI.nf2.format(pPq) + ' ct (' + pct(p/pPq-1) + ')');
      if (p < 2 || p > 30) add('erreur','Prix','Prix de reprise invraisemblable', PI.nf2.format(p) + ' ct/kWh : vérifiez les kWh et le montant');
    }
  }
  if (e.type === 'banque' && amt > 0) {
    const inv = PI.store.entries.filter(x => x.type === 'grd' || x.type === 'autre');
    const ref = e.date || e.from;
    const m = inv.find(x => Math.abs((+x.amount||0) - amt) <= 1 && (x.date || x.to || x.from) <= addD(ref, 15) && (x.date || x.to || x.from) >= addD(ref, -120));
    if (!m) add('info','Banque','Versement sans facture correspondante', PI.nf2.format(amt) + ' CHF : aucune facture GRD ou autre revenu du même montant dans les 4 mois précédents');
  }
  if (amt < 0) add('attention','Saisie','Montant négatif', 'saisissez les charges avec le type « Charge » et un montant positif');
  return out;
};

PI.runChecks = function(){
  const out = [], E = PI.store.entries, add = (sev, cat, title, detail, extra) => out.push({sev, cat, title, detail, ...extra});
  E.forEach(e => PI.checkEntry(e).forEach(x => out.push(x)));
  // dédoublonner les paires (doublons / chevauchements signalés deux fois)
  const seen = new Set(); const uniq = out.filter(x => { if (x.cat === 'Doublon' || x.title === 'Périodes qui se chevauchent') { const k = x.title + '|' + [x.period, x.detail].sort().join('|'); if (seen.has(k)) return false; seen.add(k); } return true; });
  out.length = 0; out.push(...uniq);
  // factures manquantes / incomplètes
  const g = E.filter(e => e.type === 'grd');
  if (g.length) {
    const firstQ = g.map(e => PI.qOfDate(e.from)).sort()[0];
    const now = today();
    for (let q = firstQ; ; ) {
      const y = +q.slice(0,4), t = +q.slice(-1), qs = `${y}-${String(3*t-2).padStart(2,'0')}-01`, qe = new Date(y, 3*t, 0, 12).toLocaleDateString('sv-SE');
      if (qs > now) break;
      if (qe < now) {
        let cov = 0; const total = (new Date(qe) - new Date(qs)) / 864e5 + 1;
        g.forEach(e => { const a = e.from > qs ? e.from : qs, b = (e.to||e.from) < qe ? (e.to||e.from) : qe; if (a <= b) cov += (new Date(b) - new Date(a)) / 864e5 + 1; });
        const late = addD(qe, 60) < now;
        if (!cov) add(late ? 'attention' : 'info', 'Factures', 'Facture GRD ' + (late ? 'manquante' : 'attendue'), 'aucune facture saisie pour le ' + q.replace('-',' ') + (late ? ' (trimestre terminé depuis plus de 60 jours)' : ' (trimestre terminé le ' + PI.fmtDate(qe) + ')'), {period:q.replace('-',' ')});
        else if (cov < total * 0.95) add('attention', 'Factures', 'Trimestre incomplet', 'les factures saisies couvrent ' + Math.round(cov) + ' jours sur ' + total + ' au ' + q.replace('-',' '), {period:q.replace('-',' ')});
      }
      q = t === 4 ? (y+1) + '-T1' : y + '-T' + (t+1);
    }
  }
  // rapprochement banque
  const banks = E.filter(e => e.type === 'banque');
  if (!banks.length) add('info','Banque','Rapprochement bancaire pas encore possible', 'saisissez les versements reçus sur le compte (type « Versement banque ») pour vérifier que chaque facture a bien été payée');
  else {
    const since = banks.map(b => b.date || b.from).sort()[0];
    g.filter(e => (e.date || e.to) >= addD(since, -90)).forEach(e => {
      const ref = e.date || e.to || e.from;
      const m = banks.find(b => Math.abs((+b.amount||0) - (+e.amount||0)) <= 1 && (b.date||b.from) >= addD(ref, -15) && (b.date||b.from) <= addD(ref, 120));
      if (!m && addD(ref, 45) < today()) add('attention','Banque','Facture non retrouvée sur le compte', PI.periodLabel(e) + ' : ' + PI.nf2.format(+e.amount) + ' CHF sans versement correspondant', {id:e.id, period:PI.periodLabel(e)});
    });
  }
  // production : performance mensuelle, jours à zéro, onduleurs
  if (PI.PLANT && PI.expectedDay) {
    const mon = {}; Object.entries(PI.PLANT).forEach(([k,v]) => { const m = k.slice(0,7); (mon[m] = mon[m] || {a:0, e:0, n:0, z:0}); mon[m].a += v; mon[m].e += PI.expectedDay(k,'all'); mon[m].n++;
      const mo = +k.slice(5,7); if (v < 1 && mo >= 4 && mo <= 9) mon[m].z++; });
    Object.entries(mon).forEach(([m, x]) => {
      const days = new Date(+m.slice(0,4), +m.slice(5,7), 0).getDate(); if (x.n < days - 1) return;
      const r = x.a / x.e, lab = PI.MOIS[+m.slice(5,7)-1] + ' ' + m.slice(0,4);
      if (r < 0.6) add('attention','Production','Mois nettement sous l\'attendu', lab + ' : ' + PI.nf0.format(x.a) + ' kWh, soit ' + PI.nf0.format(r*100) + ' % de l\'attendu', {period:lab});
      else if (r < 0.75) add('info','Production','Mois sous l\'attendu', lab + ' : ' + PI.nf0.format(r*100) + ' % de l\'attendu (météo probable)', {period:lab});
      if (x.z) add('attention','Production','Jour(s) sans production en saison', lab + ' : ' + x.z + ' jour(s) à 0 kWh entre avril et septembre', {period:lab});
    });
    const inv = PI.INV || {};
    if (inv['PVS-100'] && inv['PVS-30']) {
      let A = 0, B = 0; Object.keys(inv['PVS-100']).forEach(k => { A += inv['PVS-100'][k]; B += inv['PVS-30'][k] || 0; }); const ref = A/(A+B);
      const mm = {}; Object.keys(inv['PVS-100']).forEach(k => { const m = k.slice(0,7); (mm[m] = mm[m] || [0,0]); mm[m][0] += inv['PVS-100'][k]; mm[m][1] += inv['PVS-30'][k] || 0; });
      Object.entries(mm).forEach(([m,[a,b]]) => { if (a + b < 500) return; const s = a/(a+b); if (Math.abs(s - ref) > 0.06)
        add('attention','Onduleurs','Répartition inhabituelle entre onduleurs', PI.MOIS[+m.slice(5,7)-1] + ' ' + m.slice(0,4) + ' : PVS-100 = ' + PI.nf0.format(s*100) + ' % (habituellement ' + PI.nf0.format(ref*100) + ' %)', {period:m}); });
    }
  }
  const ev = PI.DATA && PI.DATA.events;
  if (ev && ev.active) out.push({sev:'erreur', cat:'Onduleurs', title:ev.active + ' alarme(s) active(s) sur Aurora Vision', detail:(ev.activeList && ev.activeList.length ? ev.activeList.map(a => a.name + ' (' + a.dev + ')').join(' · ') : 'détail dans Production → Événements des onduleurs'), go:'alarms'});
  return out.sort((a,b) => SEV[a.sev] - SEV[b.sev]);
};
PI.checksByEntry = function(){ const m = {}; PI.runChecks().forEach(x => { if (x.id) (m[x.id] = m[x.id] || []).push(x); }); return m; };

/* ---------------- UI ---------------- */
let filter = 'all';
PI.renderChecks = function(){
  if (!PI.store || !PI.nf0) return;
  const all = PI.runChecks();
  const n = s => all.filter(x => x.sev === s).length;
  const badge = el('tabBadge'); if (badge) { const c = n('erreur') + n('attention'); badge.textContent = c; badge.classList.toggle('hidden', !c); badge.className = 'tbadge-n' + (n('erreur') ? ' err' : '') + (c ? '' : ' hidden'); }
  const sum = el('checksSum'); if (!sum) return;
  const cards = [['all','Tous', all.length,''],['erreur','Erreurs', n('erreur'),'err'],['attention','À vérifier', n('attention'),'warn'],['info','Informations', n('info'),'info']];
  sum.replaceChildren(...cards.map(([k,l,v,c]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'csum ' + c; b.setAttribute('aria-pressed', filter === k);
    const s = document.createElement('span'); s.textContent = l; const st = document.createElement('strong'); st.textContent = v; b.append(st, s); b.onclick = () => { filter = k; PI.renderChecks(); }; return b; }));
  const list = el('checksList'); list.replaceChildren();
  const rows = all.filter(x => filter === 'all' || x.sev === filter);
  if (!rows.length) { const d = document.createElement('div'); d.className = 'allgood'; d.textContent = filter === 'all' ? '✓ Aucune incohérence détectée' : 'Rien dans cette catégorie'; list.appendChild(d); }
  const cats = [...new Set(rows.map(x => x.cat))];
  cats.forEach(cat => {
    const h = document.createElement('h3'); h.className = 'ccat'; h.textContent = cat + ' (' + rows.filter(x => x.cat === cat).length + ')'; list.appendChild(h);
    rows.filter(x => x.cat === cat).forEach(x => {
      const d = document.createElement('div'); d.className = 'citem ' + x.sev;
      const ic = document.createElement('span'); ic.className = 'cic'; ic.textContent = x.sev === 'erreur' ? '✕' : x.sev === 'attention' ? '!' : 'i';
      const body = document.createElement('div'); const t = document.createElement('strong'); t.textContent = x.title + (x.period ? ' · ' + x.period : ''); const p = document.createElement('p'); p.textContent = x.detail || ''; body.append(t, p);
      d.append(ic, body);
      if (x.go === 'alarms') { const b = document.createElement('button'); b.className = 'chip'; b.type = 'button'; b.textContent = 'Voir les alarmes'; b.onclick = () => PI.showAlarms && PI.showAlarms(); d.appendChild(b); }
      if (x.id) { const b = document.createElement('button'); b.className = 'chip'; b.type = 'button'; b.textContent = 'Ouvrir la saisie'; b.onclick = () => { const e = PI.store.entries.find(y => y.id === x.id); if (e) PI.openForm(e); }; d.appendChild(b); }
      list.appendChild(d);
    });
  });
  const tm = el('checksTime'); if (tm) tm.textContent = 'Analyse du ' + new Date().toLocaleString('fr-CH',{dateStyle:'long',timeStyle:'short'}) + ' · ' + PI.store.entries.length + ' saisies, ' + Object.keys(PI.PLANT||{}).length + ' jours de production analysés';
};
})();
