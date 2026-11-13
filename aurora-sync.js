/* PolyImmo — bouton « Mettre à jour depuis Aurora » : ouvre Aurora Vision (script Tampermonkey polyimmo-aurora.user.js),
   reçoit les 10 derniers jours lus avec la connexion de l'utilisateur, met à jour data/production.json et data/power15.v64 via l'API GitHub. */
'use strict';
(function(){
const PI = window.PI = window.PI || {};
const $ = id => document.getElementById(id);
const CFG = () => { try { return JSON.parse(localStorage.getItem('pi-gh-v1') || '{}'); } catch(e){ return {}; } };
const TZ = 'Europe/Zurich';
let win = null, waitT = null, FROM = '', P15 = '';

function status(t, kind){ const b = $('auBox'); if (!b) return; b.className = 'aubox ' + (kind || ''); b.innerHTML = t; b.classList.remove('hidden'); }

/* ---------- date locale ---------- */
const fmt = new Intl.DateTimeFormat('sv-SE', {timeZone:TZ, year:'numeric', month:'2-digit', day:'2-digit'});
const lday = s => fmt.format(new Date(s + ':00Z'));
const midnightUTC = d => { for (const off of [1, 2]) { const ms = Date.parse(d + 'T00:00:00Z') - off * 36e5; if (fmt.format(new Date(ms)) === d && fmt.format(new Date(ms - 1)) !== d) return ms / 1000; } return Date.parse(d + 'T00:00:00Z') / 1000 - 3600; };
const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/* ---------- archive 15 min (varint / zigzag) ---------- */
function decode(b64){ const bin = atob(b64.trim()), b = Uint8Array.from(bin, c => c.charCodeAt(0)); let i = 0;
  const vi = () => { let x = 0, sh = 0, c; do { c = b[i++]; x += (c & 127) * Math.pow(2, sh); sh += 7; } while (c >= 128); return x; };
  const a = []; while (i < b.length) { const z = vi(), c = vi(); for (let k = 0; k < z; k++) a.push(0); let p = 0; for (let k = 0; k < c; k++) { const d = vi(); p += (d % 2) ? -(d + 1) / 2 : d / 2; a.push(p); } } return a; }
function encode(a){ const out = []; const w = x => { do { let c = x % 128; x = Math.floor(x / 128); out.push(x ? c | 128 : c); } while (x); };
  let j = 0; while (j < a.length) { let z = 0; while (j < a.length && a[j] === 0) { z++; j++; } const run = []; while (j < a.length && a[j] !== 0) run.push(a[j++]);
    w(z); w(run.length); let p = 0; for (const x of run) { const d = x - p; p = x; w(d >= 0 ? 2 * d : -2 * d - 1); } }
  let s = ''; for (let k = 0; k < out.length; k += 8192) s += String.fromCharCode.apply(null, out.slice(k, k + 8192)); return btoa(s); }

/* ---------- application du relevé ---------- */
function apply(o, D, v64){
  const today = fmt.format(new Date()), daily = Object.fromEntries(D.daily);
  o.daily.forEach(([s, v]) => { if (v != null) daily[lday(s)] = Math.round(v); });
  D.daily = Object.keys(daily).sort().map(k => [k, daily[k]]);
  D.inverters.forEach(inv => { const s0 = Date.parse(inv.start + 'T12:00:00Z');
    (o.inv[inv.id] || []).forEach(([s, v]) => { if (v == null) return; const i = Math.round((Date.parse(lday(s) + 'T12:00:00Z') - s0) / 864e5); if (i < 0) return; while (inv.daily.length <= i) inv.daily.push(null); inv.daily[i] = Math.round(v); }); });
  const P = new Map(o.p15.map(([s, v]) => [Date.parse(s + ':00Z') / 1000, v]));
  const T0 = 1761082200, arr = decode(v64), end = T0 + 900 * (arr.length - 1), lastP = P.size ? Math.max(...P.keys()) : end;
  for (let u = end + 900; u <= lastP; u += 900) arr.push(0);
  for (const [u, v] of P) { const k = (u - T0) / 900; if (k >= 0 && k < arr.length && Number.isInteger(k)) arr[k] = Math.round(v * 10); }
  const kwAt = u => { if (P.has(u)) return P.get(u); const k = (u - T0) / 900; return k >= 0 && k < arr.length ? arr[k] / 10 : 0; };
  const p0 = addDays(today, -6), u0 = midnightUTC(p0), vals = [];
  for (let k = 0; k < 96 * 7; k++) vals.push(Math.round(kwAt(u0 + 900 * k) * 10) / 10);
  D.power15 = {start:p0, stepMin:15, unit:'kW', values:vals};
  D.hourly = {start:p0, values:Array.from({length:24 * 7}, (_, h) => Math.round((vals[4*h] + vals[4*h+1] + vals[4*h+2] + vals[4*h+3]) / 4 * 10) / 10)};
  if (o.wx) D.weather = {at:o.at.slice(0, 16), ...o.wx};
  if (o.active != null || o.events) {
    const E = D.events = D.events || {since:today, total:0, byCode:[], byMonth:{}, recent:[]}, SEV = {LOW:'faible', MEDIUM:'moyenne', HIGH:'élevée', CRITICAL:'critique'};
    if (o.active != null) { E.active = o.active; E.activeList = (o.activeList || []).map(([id, st, en, dev, code, name, sev, desc]) => ({id, start:st, dev, code, name, sev:SEV[sev] || sev, desc})); E.activeAt = o.at.slice(0, 16); }
    const seen = new Set(E.seen || []);
    (o.events || []).forEach(([id, st, en, dev, code, name, sev, desc]) => {
      if (seen.has(id)) return; seen.add(id); E.total = (E.total || 0) + 1;
      const m = st.slice(0, 7); E.byMonth[m] = (E.byMonth[m] || 0) + 1;
      const row = E.byCode.find(r => r[0] === code && r[1] === dev); if (row) row[4]++; else E.byCode.push([code, dev, name, SEV[sev] || sev, 1]);
      const mins = en ? Math.max(0, Math.round((Date.parse(en) - Date.parse(st)) / 6e4)) : 0;
      E.recent.push([st, mins, dev, code, SEV[sev] || sev]);
    });
    E.byCode.sort((a, b) => b[4] - a[4]);
    E.recent.sort((a, b) => b[0] < a[0] ? -1 : 1); E.recent = E.recent.slice(0, 40);
    E.seen = [...seen].slice(-600);
  }
  D.updated = today;
  return {D, v64:encode(arr), last:D.daily[D.daily.length - 1]};
}

/* ---------- GitHub ---------- */
async function gh(path, opt){ const c = CFG(); const r = await fetch('https://api.github.com/repos/' + (c.repo || 'bamo378/Polyimmo') + path, {...(opt || {}), headers:{'Accept':'application/vnd.github+json', 'Authorization':'Bearer ' + c.token, ...((opt || {}).headers || {})}});
  if (!r.ok) { const e = new Error('GitHub ' + r.status); e.status = r.status; throw e; } return r; }
async function readFile(p){ const br = CFG().branch || 'main'; const j = await (await gh('/contents/' + p + '?ref=' + br)).json();
  const raw = await (await gh('/contents/' + p + '?ref=' + br, {headers:{'Accept':'application/vnd.github.raw'}})).text(); return {sha:j.sha, raw}; }
const b64u = s => { const u = new TextEncoder().encode(s); let b = ''; for (let k = 0; k < u.length; k += 8192) b += String.fromCharCode.apply(null, u.subarray(k, k + 8192)); return btoa(b); };
async function writeFile(p, content, sha, msg){ return gh('/contents/' + p, {method:'PUT', body:JSON.stringify({message:msg, content:b64u(content), sha, branch:CFG().branch || 'main'})}); }

async function receive(o){
  clearTimeout(waitT);
  status('Données reçues d\'Aurora · enregistrement sur GitHub…');
  try {
    const [P, A] = await Promise.all([readFile('data/production.json'), readFile('data/power15.v64')]);
    const r = apply(o, JSON.parse(P.raw), A.raw);
    const day = new Date().toLocaleDateString('fr-CH');
    await writeFile('data/power15.v64', r.v64, A.sha, 'PolyImmo : quarts d\'heure Aurora (bouton du site, ' + day + ')');
    await writeFile('data/production.json', JSON.stringify(r.D), P.sha, 'PolyImmo : production Aurora (bouton du site, ' + day + ')');
    status(`✅ Mise à jour enregistrée : production jusqu'au <b>${r.last[0].split('-').reverse().join('.')}</b> (${r.last[1]} kWh ce jour-là)${o.active ? ` · <b>${o.active} alarme(s) active(s)</b>` : ''}. Le site affichera les nouveaux chiffres dans 1 à 2 minutes : rechargez alors la page.`, 'ok');
  } catch(e) {
    console.error(e);
    status(e.status === 401 || e.status === 403 ? 'La clé GitHub enregistrée dans ce navigateur est refusée. Vérifiez-la dans <b>Saisie → Connexion GitHub</b> (droit « Contents : Read and write » sur le dépôt Polyimmo).' : 'Échec de l\'enregistrement (' + e.message + '). Réessayez dans un instant.', 'bad');
  }
}
window.addEventListener('message', e => { if (e.origin === 'https://www.auroravision.net' && e.data && e.data.type === 'polyimmo-aurora') receive(e.data.data); });
// repli : données reçues dans l'adresse (#aurora=…)
function fromHash(){ const m = location.hash.match(/aurora=([^&]+)/); if (!m) return; history.replaceState(null, '', location.pathname + '#v=prod');
  try { receive(JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1])))))); } catch(e) { status('Données Aurora illisibles.', 'bad'); } }

PI.auroraSync = function(){
  if (!CFG().token) { status('Pour enregistrer la mise à jour, ce navigateur doit d\'abord avoir une clé GitHub : ouvrez <b>Saisie → Connexion GitHub</b> (une seule fois). <a href="#" id="auGh">Ouvrir la connexion GitHub</a>', 'bad');
    const a = $('auGh'); if (a) a.onclick = ev => { ev.preventDefault(); const b = $('ghBtn'); if (b) b.click(); }; return; }
  win = window.open('https://www.auroravision.net/dashboard/#polyimmo-sync&from=' + FROM + '&p15=' + P15, 'polyimmo-sync');
  if (!win) { status('Votre navigateur a bloqué l\'ouverture d\'Aurora : autorisez les fenêtres pop-up pour ce site, puis recliquez.', 'bad'); return; }
  status('Aurora Vision s\'ouvre dans un nouvel onglet… Connectez-vous si nécessaire : la suite se fait toute seule.');
  clearTimeout(waitT); waitT = setTimeout(() => status('Pas de réponse d\'Aurora. Le petit script Tampermonkey est-il installé ? <a href="aurora-installation.html" target="_blank" rel="noopener">Guide d\'installation</a>', 'bad'), 90000);
};
async function lastKnown(){ // dernier jour connu et fin de l'archive au quart d'heure, pour ne lire que ce qui manque
  try { const d = await (await fetch('data/production.json', {cache:'no-store'})).json(); FROM = d.daily[d.daily.length - 1][0];
    const a = decode(await (await fetch('data/power15.v64', {cache:'no-store'})).text()); P15 = new Date((1761082200 + 900 * (a.length - 1)) * 1000).toISOString().slice(0, 10); } catch(e) {} }
function wire(){ lastKnown(); document.querySelectorAll('[data-aurora-sync]').forEach(b => b.addEventListener('click', PI.auroraSync)); fromHash(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
