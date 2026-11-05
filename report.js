/* PolyImmo Solaire — rapports PDF (jsPDF + AutoTable) */
'use strict';
(function(){
const PI = window.PI = window.PI || {};
const el = id => document.getElementById(id);
const C = {ink:[26,23,27], red:[227,24,24], sun:[232,154,0], sun2:[247,197,72], blue:[42,120,214], orange:[235,104,52], green:[27,175,122], grey:[110,116,126], line:[226,229,224], soft:[246,247,244]};
const S = t => String(t == null ? '' : t).replace(/[  ]/g,' ').replace(/≥/g,'>=').replace(/≤/g,'<=').replace(/−/g,'-').replace(/[▲▼✓✕⚠]/g,'').replace(/’/g,"'");
const rep = {kind:'quarter', year:null, q:null, m:null, from:null, to:null,
  sec:{kpi:true, prod:true, inv:true, fin:true, entries:true, checks:true}};
let logo = null;
fetch('assets/logo.png').then(r => r.blob()).then(b => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); })).then(d => { logo = d; }).catch(()=>{});

/* ---------- période ---------- */
function period(){
  const LAST = PI.LAST; const y = rep.year || +LAST.slice(0,4);
  if (rep.kind === 'month') { const m = rep.m || +LAST.slice(5,7); const f = `${y}-${String(m).padStart(2,'0')}-01`, t = new Date(y, m, 0, 12).toLocaleDateString('sv-SE'); return {from:f, to:t, label:PI.MOIS[m-1] + ' ' + y, file:`${y}-${String(m).padStart(2,'0')}`}; }
  if (rep.kind === 'quarter') { const q = rep.q || 1; const f = `${y}-${String(3*q-2).padStart(2,'0')}-01`, t = new Date(y, 3*q, 0, 12).toLocaleDateString('sv-SE'); return {from:f, to:t, label:'T' + q + ' ' + y, file:`${y}-T${q}`}; }
  if (rep.kind === 'year') return {from:`${y}-01-01`, to:`${y}-12-31`, label:'Année ' + y, file:String(y)};
  const f = rep.from || PI.FIRST, t = rep.to || LAST; return {from:f, to:t, label:PI.fmtDate(f) + ' – ' + PI.fmtDate(t), file:f + '_' + t};
}
function prodFor(p){
  const f = p.from, t = p.to > PI.LAST ? PI.LAST : p.to;
  if (f >= PI.FIRST && f <= t) { let s = 0, e = 0, n = 0, best = null; for (let k = f; k <= t; k = PI.addDays(k,1)) { if (!(k in PI.PLANT)) continue; s += PI.PLANT[k]; e += PI.expectedDay(k,'all'); n++; if (!best || PI.PLANT[k] > PI.PLANT[best]) best = k; }
    return {kwh:s, exp:e, n, best, src:'Aurora Vision (journalier)', partial: p.to > PI.LAST}; }
  const mq = PI.DATA.meterQuarters; let s = 0, used = [];
  Object.keys(mq).forEach(q => { const y = +q.slice(0,4), tq = +q.slice(-1), qs = `${y}-${String(3*tq-2).padStart(2,'0')}-01`, qe = new Date(y, 3*tq, 0, 12).toLocaleDateString('sv-SE');
    if (qs >= p.from && qe <= p.to) { s += mq[q]; used.push(q); } });
  // compléter avec Aurora pour la partie couverte
  let a = 0; if (p.to >= PI.FIRST) for (let k = (p.from > PI.FIRST ? p.from : PI.FIRST); k <= (p.to < PI.LAST ? p.to : PI.LAST); k = PI.addDays(k,1)) { const q = PI.qOf(k); if (!used.includes(q)) a += PI.PLANT[k] || 0; }
  return {kwh:s + a, exp:null, n:null, best:null, src:'relevés de compteur' + (a ? ' + Aurora Vision' : ''), partial: p.to > PI.LAST};
}

/* ---------- graphiques hors écran ---------- */
async function chartImg(cfg, w = 1400, h = 540){
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.style.cssText = 'position:fixed;left:-9999px;top:0;width:' + w + 'px;height:' + h + 'px';
  document.body.appendChild(c);
  cfg.options = cfg.options || {}; Object.assign(cfg.options, {responsive:false, animation:false, devicePixelRatio:1});
  cfg.options.plugins = Object.assign({legend:{display:false}}, cfg.options.plugins || {});
  const tick = {color:'#6e747e', font:{size:22, family:'Helvetica, Arial'}};
  cfg.options.scales = cfg.options.scales || {x:{}, y:{}};
  ['x','y'].forEach(a => { cfg.options.scales[a] = Object.assign({grid:{color: a === 'y' ? '#e6e8e3' : 'transparent'}, border:{display:false}, ticks:tick}, cfg.options.scales[a]); });
  cfg.plugins = (cfg.plugins || []).concat([{id:'bg', beforeDraw: ch => { const x = ch.ctx; x.save(); x.fillStyle = '#ffffff'; x.fillRect(0, 0, ch.width, ch.height); x.restore(); }}]);
  const ch = new Chart(c, cfg); await new Promise(r => setTimeout(r, 30));
  const url = c.toDataURL('image/jpeg', 0.88); ch.destroy(); c.remove(); return url;
}
const hex = a => '#' + a.map(v => v.toString(16).padStart(2,'0')).join('');

/* ---------- génération ---------- */
async function generate(preview){
  if (!window.jspdf) { PI.toast('Module PDF en cours de chargement, réessayez dans un instant'); return; }
  const btn = el(preview ? 'repPreview' : 'repGo'); const old = btn.textContent; btn.textContent = 'Génération…'; btn.disabled = true;
  try {
    const p = period(), {jsPDF} = window.jspdf, doc = new jsPDF({unit:'mm', format:'a4', compress:true});
    const W = 210, M = 14; let y = 0;
    const nf0 = PI.nf0, nf1 = PI.nf1, nf2 = PI.nf2;
    // en-tête
    doc.setFillColor(...C.ink); doc.rect(0, 0, W, 38, 'F');
    doc.setFillColor(...C.red); doc.rect(0, 38, W, 1.2, 'F');
    if (logo) { doc.setFillColor(255,255,255); doc.roundedRect(M, 8, 44, 22, 3, 3, 'F'); doc.addImage(logo, 'PNG', M + 3, 10, 38, 18, 'logo', 'FAST'); }
    doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(17); doc.text(S('Rapport de production solaire'), M + 52, 17);
    doc.setFont('helvetica','normal'); doc.setFontSize(10.5); doc.setTextColor(215,210,214);
    doc.text(S('Installation PolyImmo · Ch. des Prairies 12, Bulle · ' + nf1.format(PI.DATA.plant.kwp) + ' kWc'), M + 52, 24);
    doc.setTextColor(255,138,138); doc.setFont('helvetica','bold'); doc.text(S('Période : ' + p.label), M + 52, 31);
    y = 48;
    const ensure = h => { if (y + h > 280) { doc.addPage(); y = 18; } };
    const h2 = t => { y += 3; if (y > 232) { doc.addPage(); y = 18; } doc.setTextColor(...C.ink); doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.text(S(t), M, y); doc.setFillColor(...C.red); doc.rect(M, y + 2, 12, 0.8, 'F'); y += 8; };
    const note = t => { doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...C.grey); const lines = doc.splitTextToSize(S(t), W - 2*M); ensure(lines.length * 3.8 + 2); doc.text(lines, M, y); y += lines.length * 3.8 + 2; };
    const cards = list => { ensure(Math.ceil(list.length/3) * 24); const n = list.length, gap = 3, cw = (W - 2*M - gap*(Math.min(n,3)-1)) / Math.min(n,3);
      list.forEach(([k,v,s], i) => { const col = i % 3, row = Math.floor(i/3), x = M + col*(cw+gap), yy = y + row*24;
        doc.setFillColor(...C.soft); doc.setDrawColor(...C.line); doc.roundedRect(x, yy, cw, 21, 2, 2, 'FD');
        doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...C.grey); doc.text(S(k), x + 4, yy + 6);
        doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(...C.ink); doc.text(S(v), x + 4, yy + 13.5);
        doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...C.grey); doc.text(doc.splitTextToSize(S(s||''), cw - 8)[0] || '', x + 4, yy + 18.5); });
      y += Math.ceil(n/3) * 24 + 2; };
    const img = (url, h) => { if (y + h > 282) { doc.addPage(); y = 18; } doc.addImage(url, 'JPEG', M, y, W - 2*M, h, undefined, 'FAST'); y += h + 4; };
    const table = (head, body, opts = {}) => { doc.autoTable(Object.assign({head:[head.map(S)], body:body.map(r => r.map(S)), startY:y, margin:{left:M, right:M}, theme:'grid',
      rowPageBreak:'avoid', styles:{font:'helvetica', fontSize:8.5, cellPadding:2, lineColor:C.line, lineWidth:0.2, textColor:C.ink},
      headStyles:{fillColor:C.ink, textColor:255, fontStyle:'bold'}, alternateRowStyles:{fillColor:[250,250,248]}}, opts)); y = doc.lastAutoTable.finalY + 6; };

    const pr = prodFor(p);
    const ents = PI.store.entries.filter(e => e.from <= p.to && (e.to || e.from) >= p.from);
    const grd = ents.filter(e => e.type === 'grd'); const invK = grd.reduce((a,e)=>a+(+e.kwhHT||0)+(+e.kwhBT||0),0), invA = grd.reduce((a,e)=>a+(+e.amount||0),0);
    if (rep.sec.kpi) {
      h2('Synthèse');
      const list = [
        ['Production', PI.fmtE(pr.kwh), pr.src + (pr.partial ? ' · période en cours' : '')],
        ['Performance vs attendu', pr.exp ? nf0.format(pr.kwh/pr.exp*100) + ' %' : '-', pr.exp ? 'attendu ' + PI.fmtE(pr.exp) : 'non calculable sur cette période'],
        ['Productible', nf0.format(pr.kwh / PI.DATA.plant.kwp) + ' kWh/kWc', 'sur la période'],
        ['Meilleur jour', pr.best ? nf0.format(PI.PLANT[pr.best]) + ' kWh' : '-', pr.best ? PI.fmtDate(pr.best) : ''],
        ['Revenus facturés (GRD)', nf0.format(invA) + ' CHF', grd.length + ' facture(s) · ' + nf0.format(invK) + ' kWh'],
        ['Prix moyen de reprise', invK ? nf2.format(invA/invK*100) + ' ct/kWh' : '-', 'TTC, selon les factures saisies'],
      ];
      cards(list);
    }
    if (rep.sec.prod) {
      h2('Production');
      const days = (new Date(p.to) - new Date(p.from)) / 864e5 + 1;
      if (p.from >= PI.FIRST) {
        const g = days <= 62 ? 'day' : days <= 200 ? 'week' : 'month';
        const bk = k => g === 'day' ? k : g === 'month' ? k.slice(0,7) : (() => { const d = new Date(k + 'T12:00:00'); d.setDate(d.getDate() - (d.getDay()+6)%7); return d.toLocaleDateString('sv-SE'); })();
        const m = new Map(), ex = new Map(); for (let k = p.from; k <= (p.to < PI.LAST ? p.to : PI.LAST); k = PI.addDays(k,1)) { if (!(k in PI.PLANT)) continue; const b = bk(k); m.set(b,(m.get(b)||0)+PI.PLANT[k]); ex.set(b,(ex.get(b)||0)+PI.expectedDay(k,'all')); }
        const labels = [...m.keys()].map(b => g === 'month' ? PI.MOIS[+b.slice(5,7)-1] + ' ' + b.slice(2,4) : (() => { const d = new Date(b + 'T12:00:00'); return d.getDate() + ' ' + PI.MOIS[d.getMonth()]; })());
        const url = await chartImg({type:'bar', data:{labels, datasets:[
          {data:[...m.values()].map(Math.round), backgroundColor:hex(C.sun), borderRadius:6, order:2},
          {type:'line', data:[...ex.values()].map(Math.round), borderColor:hex(C.green), borderWidth:4, borderDash:[8,6], pointRadius:0, order:1}]},
          options:{scales:{x:{ticks:{color:'#6e747e', font:{size:20}, maxRotation:0, autoSkipPadding:20}}, y:{beginAtZero:true}}}});
        ensure(76); note('Production ' + {day:'journalière', week:'hebdomadaire', month:'mensuelle'}[g] + ' en kWh (barres) et production attendue (pointillés verts).');
        img(url, 68);
      } else {
        const {q} = PI.quarterMap(); const ks = Object.keys(q).sort().filter(k => { const y2 = +k.slice(0,4), t = +k.slice(-1); const qs = `${y2}-${String(3*t-2).padStart(2,'0')}-01`; return qs >= p.from.slice(0,8) + '01' && qs <= p.to; });
        if (ks.length) { const url = await chartImg({type:'bar', data:{labels:ks.map(k => k.replace('-',' ')), datasets:[{data:ks.map(k => Math.round(q[k])), backgroundColor:hex(C.sun), borderRadius:6}]}, options:{scales:{y:{beginAtZero:true}}}});
          note('Production par trimestre en kWh (relevés de compteur ; Aurora Vision pour le trimestre en cours).'); img(url, 62); }
      }
    }
    if (rep.sec.inv && PI.INV['PVS-100'] && p.to >= PI.FIRST) {
      h2('Onduleurs');
      const f = p.from > PI.FIRST ? p.from : PI.FIRST, t = p.to < PI.LAST ? p.to : PI.LAST;
      const tot = {}; ['PVS-100','PVS-30'].forEach(id => { tot[id] = 0; for (let k = f; k <= t; k = PI.addDays(k,1)) tot[id] += PI.INV[id][k] || 0; });
      const s = tot['PVS-100'] + tot['PVS-30'], meta = Object.fromEntries(PI.DATA.inverters.map(x => [x.id, x]));
      table(['Onduleur','Modèle','N° de série','Production (kWh)','Part','kWh par kW'], ['PVS-100','PVS-30'].map(id => [id, meta[id].model, meta[id].sn, nf0.format(tot[id]), nf1.format(s ? tot[id]/s*100 : 0) + ' %', nf0.format(tot[id]/meta[id].kw)]),
        {columnStyles:{3:{halign:'right'},4:{halign:'right'},5:{halign:'right'}}});
      note('Données Aurora Vision du ' + PI.fmtDate(f) + ' au ' + PI.fmtDate(t) + '. Alarmes actives : ' + ((PI.DATA.events && PI.DATA.events.active) || 0) + '.');
    }
    if (rep.sec.fin && PI.finModel) {
      h2('Finances & amortissement');
      const F = PI.finModel(), last = F.ys[F.ys.length-1];
      cards([
        ['Coût net de l\'installation', nf0.format(F.cost) + ' CHF', 'TTC moins subvention'],
        ['Revenus encaissés à ce jour', nf0.format(F.revToDate) + ' CHF', 'factures jusqu\'au ' + F.lastInv.replace('-',' ')],
        ['Reste à amortir', nf0.format(Math.max(0, F.cost - F.revToDate)) + ' CHF', nf0.format(Math.min(100, F.revToDate/F.cost*100)) + ' % couvert'],
        ['Amortissement complet', F.payback ? 'T' + F.payback.t + ' ' + F.payback.y : 'non atteint', 'selon les hypothèses du site'],
        ['Bénéfice net ' + F.endY, nf0.format(last.pos) + ' CHF', 'cash-flow cumulé - coût net'],
        ['TRI', F.irr == null ? '-' : nf1.format(F.irr*100) + ' %', 'prix futur moyen ' + nf2.format(F.futPrice) + ' ct/kWh'],
      ]);
      const url = await chartImg({type:'line', data:{labels:F.ys.map(Y => String(Y.y)), datasets:[{data:F.ys.map(Y => Math.round(Y.pos)), borderColor:hex(C.ink), borderWidth:4, pointRadius:0,
        fill:{target:'origin', above:'rgba(22,163,74,.22)', below:'rgba(220,38,38,.18)'}, segment:{borderDash: c => F.ys[c.p1DataIndex] && F.ys[c.p1DataIndex].status === 'projeté' ? [10,8] : []}}]},
        options:{scales:{y:{beginAtZero:false}, x:{ticks:{color:'#6e747e', font:{size:20}, maxRotation:0, autoSkipPadding:24}}}}}, 1400, 490);
      ensure(66); note('Bénéfice cumulé en CHF (cash-flow cumulé moins coût net). Pointillés : projection.'); img(url, 58);
      const yrs = F.ys.filter(Y => Y.y <= F.cy + 4);
      table(['Année','Statut','Production (kWh)','Prix moyen (ct)','Revenus (CHF)','Charges','Cash-flow','Bénéfice cumulé'],
        yrs.map(Y => [Y.y, Y.status, nf0.format(Y.kwh), nf2.format(Y.price), nf0.format(Y.rev + Y.other), Y.charges ? '-' + nf0.format(Y.charges) : '-', nf0.format(Y.cf), nf0.format(Y.pos)]),
        {columnStyles:{2:{halign:'right'},3:{halign:'right'},4:{halign:'right'},5:{halign:'right'},6:{halign:'right'},7:{halign:'right'}}});
    }
    if (rep.sec.entries) {
      h2('Saisies de la période');
      if (!ents.length) note('Aucune saisie (facture, versement, charge) sur cette période.');
      else table(['Période','Type','Émetteur','Référence','kWh','Montant (CHF)','ct/kWh'], ents.sort((a,b) => a.from < b.from ? -1 : 1).map(e => { const k = (+e.kwhHT||0)+(+e.kwhBT||0);
        return [PI.periodLabel(e), PI.TYPES[e.type].label, e.issuer || '', e.ref || '', e.type === 'grd' ? nf0.format(k) : '-', (e.type === 'charge' ? '-' : '') + nf2.format(+e.amount||0), e.type === 'grd' && k ? nf2.format(e.amount/k*100) : '-']; }),
        {columnStyles:{4:{halign:'right'},5:{halign:'right'},6:{halign:'right'}}});
    }
    if (rep.sec.checks) {
      h2('Contrôles & incohérences');
      const all = PI.runChecks(), imp = all.filter(x => x.sev !== 'info');
      note(all.length ? imp.length + ' point(s) à vérifier et ' + (all.length - imp.length) + ' information(s) à la date du rapport.' : 'Aucune incohérence détectée.');
      if (all.length) table(['Gravité','Catégorie','Constat','Détail'], all.map(x => [x.sev, x.cat, x.title + (x.period ? ' (' + x.period + ')' : ''), x.detail || '']),
        {columnStyles:{0:{cellWidth:20}, 1:{cellWidth:24}, 2:{cellWidth:52}},
         didParseCell: d => { if (d.section === 'body' && d.column.index === 0) d.cell.styles.textColor = d.cell.raw === 'erreur' ? [220,38,38] : d.cell.raw === 'attention' ? [194,111,0] : C.grey; }});
    }
    // pied de page
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...C.grey);
      doc.text(S('PolyImmo · Rapport généré le ' + new Date().toLocaleDateString('fr-CH',{day:'numeric',month:'long',year:'numeric'}) + ' · données Aurora Vision au ' + PI.fmtDate(PI.LAST)), M, 290);
      doc.text(S('Page ' + i + ' / ' + n), W - M, 290, {align:'right'}); }
    const name = 'PolyImmo_rapport_' + p.file + '.pdf';
    if (preview) { const url = doc.output('bloburl'); window.open(url, '_blank') || PI.toast('Autorisez les fenêtres pop-up pour l\'aperçu'); }
    else doc.save(name);
    PI.toast(preview ? 'Aperçu ouvert dans un nouvel onglet' : 'Rapport téléchargé : ' + name);
  } catch(e){ console.error(e); PI.toast('Erreur pendant la génération du rapport'); }
  finally { btn.textContent = old; btn.disabled = false; }
}

/* ---------- UI ---------- */
PI.renderReportUI = function(){
  if (!PI.LAST) return;
  const L = PI.LAST, y = +L.slice(0,4), m = +L.slice(5,7), q = Math.floor((m-1)/3)+1;
  if (rep.year == null) { // par défaut : dernier trimestre terminé
    rep.year = q === 1 ? y - 1 : y; rep.q = q === 1 ? 4 : q - 1; rep.m = m === 1 ? 12 : m - 1;
  }
  document.querySelectorAll('#repKind button').forEach(b => b.setAttribute('aria-pressed', b.dataset.k === rep.kind));
  const years = []; for (let i = 2023; i <= y; i++) years.push(i);
  const ys = el('repYear'); ys.replaceChildren(...years.map(v => new Option(v, v))); ys.value = rep.year;
  el('repQWrap').classList.toggle('hidden', rep.kind !== 'quarter'); el('repMWrap').classList.toggle('hidden', rep.kind !== 'month');
  el('repYWrap').classList.toggle('hidden', rep.kind === 'custom'); el('repDWrap').classList.toggle('hidden', rep.kind !== 'custom');
  document.querySelectorAll('#repQ button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.q === rep.q));
  el('repM').value = rep.m; el('repFrom').value = rep.from || PI.FIRST; el('repTo').value = rep.to || L;
  document.querySelectorAll('#repSec input').forEach(i => i.checked = !!rep.sec[i.value]);
  const p = period(), pr = prodFor(p);
  el('repSummary').textContent = 'Période : ' + p.label + ' (' + PI.fmtDate(p.from) + ' – ' + PI.fmtDate(p.to) + ') · production ' + PI.fmtE(pr.kwh) + ' · ' + pr.src;
};
function wire(){
  el('repKind').onclick = e => { const b = e.target.closest('button'); if (!b) return; rep.kind = b.dataset.k; PI.renderReportUI(); };
  el('repYear').onchange = e => { rep.year = +e.target.value; PI.renderReportUI(); };
  el('repQ').onclick = e => { const b = e.target.closest('button'); if (!b) return; rep.q = +b.dataset.q; PI.renderReportUI(); };
  el('repM').onchange = e => { rep.m = +e.target.value; PI.renderReportUI(); };
  ['repFrom','repTo'].forEach(id => el(id).onchange = () => { rep.from = el('repFrom').value; rep.to = el('repTo').value; if (rep.from > rep.to) [rep.from, rep.to] = [rep.to, rep.from]; PI.renderReportUI(); });
  el('repSec').onchange = e => { if (e.target.value) rep.sec[e.target.value] = e.target.checked; };
  el('repGo').onclick = () => generate(false); el('repPreview').onclick = () => generate(true);
  document.querySelectorAll('[data-quick]').forEach(b => b.onclick = () => { const L = PI.LAST, y = +L.slice(0,4), m = +L.slice(5,7), q = Math.floor((m-1)/3)+1;
    const k = b.dataset.quick;
    if (k === 'lastMonth') Object.assign(rep, {kind:'month', year: m === 1 ? y-1 : y, m: m === 1 ? 12 : m-1});
    if (k === 'lastQuarter') Object.assign(rep, {kind:'quarter', year: q === 1 ? y-1 : y, q: q === 1 ? 4 : q-1});
    if (k === 'thisYear') Object.assign(rep, {kind:'year', year:y});
    if (k === 'lastYear') Object.assign(rep, {kind:'year', year:y-1});
    if (k === 'checks') { rep.sec = {kpi:false, prod:false, inv:false, fin:false, entries:false, checks:true}; Object.assign(rep, {kind:'year', year:y}); }
    else rep.sec = {kpi:true, prod:true, inv:true, fin:true, entries:true, checks:true};
    PI.renderReportUI(); generate(false); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
