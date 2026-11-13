// ==UserScript==
// @name         PolyImmo – mise à jour depuis Aurora Vision
// @namespace    https://bamo378.github.io/Polyimmo/
// @version      1.3
// @description  Quand le site PolyImmo ouvre Aurora Vision avec le bouton « Mettre à jour », lit toutes les données manquantes avec VOTRE connexion (lecture seule) et les renvoie au site. Aucun mot de passe n'est lu ni enregistré.
// @match        https://www.auroravision.net/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
(function () {
  'use strict';
  const SITE = 'https://bamo378.github.io';
  // Repère posé par le bouton du site (#polyimmo-sync&from=AAAA-MM-JJ&p15=AAAA-MM-JJ), lu tout de suite avant qu'Aurora ne réécrive l'adresse
  const ss = { get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} }, del: k => { try { sessionStorage.removeItem(k); } catch (e) {} } };
  const h = location.hash;
  if (h.includes('polyimmo-sync') || window.name === 'polyimmo-sync') {
    const p = new URLSearchParams(h.replace(/^#/, '').replace('polyimmo-sync', ''));
    ss.set('pi-sync', JSON.stringify({from: p.get('from') || '', p15: p.get('p15') || '', t: Date.now()}));
  }
  let job = null; try { job = JSON.parse(ss.get('pi-sync') || 'null'); } catch (e) {}
  if (!job || Date.now() - job.t > 30 * 60e3) return;                 // ne fait rien hors du bouton PolyImmo
  const done = () => ss.del('pi-sync');

  const banner = (t, ok) => { let b = document.getElementById('pi-sync'); if (!b) { b = document.createElement('div'); b.id = 'pi-sync';
      b.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:12px 18px;border-radius:12px;font:600 15px system-ui;box-shadow:0 8px 30px rgba(0,0,0,.25);max-width:92vw;text-align:center'; (document.body || document.documentElement).appendChild(b); }
    b.style.background = ok === false ? '#b42318' : '#e31818'; b.style.color = '#fff'; b.textContent = 'PolyImmo · ' + t; };
  const g = async u => { const r = await fetch(u, {credentials: 'include'}); if (!r.ok) { const e = new Error(r.status); e.status = r.status; throw e; } try { return await r.json(); } catch (x) { const e = new Error('login'); e.status = 401; throw e; } };
  const iso = d => d.toISOString().slice(0, 10) + 'T00:00:00.000Z';
  async function collect() {
    const now = new Date(), E = now.toISOString(), DAY = 864e5;
    const from = job.from ? new Date(Date.parse(job.from) - 3 * DAY) : new Date(now - 10 * DAY);            // depuis le dernier jour connu (3 jours de marge)
    let f15 = job.p15 ? new Date(Date.parse(job.p15) - DAY) : new Date(now - 8 * DAY);
    if (f15 < new Date(now - 360 * DAY)) f15 = new Date(now - 360 * DAY);                                    // Aurora garde ~1 an au quart d'heure
    const day = async base => (await g(base + '/energy/GenerationEnergy?agp=Day&afx=Delta&sdt=' + iso(from) + '&edt=' + E)).map(x => [x.start.slice(0, 16), x.value == null ? null : Math.round(x.value * 10) / 10]);
    const o = {at: E};
    banner('lecture de la production depuis le ' + from.toLocaleDateString('fr-CH') + '…');
    o.daily = await day('/telemetry/v1/plants/35546755');
    o.inv = {'PVS-100': await day('/telemetry/v1/devices/35633330'), 'PVS-30': await day('/telemetry/v1/devices/35634342')};
    o.p15 = [];
    for (let a = new Date(Date.parse(iso(f15))); a < now; a = new Date(+a + 7 * DAY)) {                       // quarts d'heure par tranches de 7 jours
      banner('lecture des quarts d\'heure : ' + a.toLocaleDateString('fr-CH') + '…');
      const b = new Date(Math.min(+a + 7 * DAY, +now));
      const r = await g('/telemetry/v1/plants/35546755/power/GenerationPower?agp=Min15&afx=Avg&sdt=' + a.toISOString() + '&edt=' + b.toISOString());
      r.forEach(x => { if (x.value != null && x.value > 40) o.p15.push([x.start.slice(0, 16), Math.round(x.value / 100) / 10]); });
    }
    const wx = await g('/weather/v1/plants/35546755/status?includeForecasts=true').catch(() => null);
    if (wx) o.wx = {now: {code: wx.condition && wx.condition.code, temp: wx.condition && wx.condition.temperature && wx.condition.temperature.value}, forecast: (wx.forecasts || []).map(f => [f.date.slice(0, 10), f.code, f.minTemperature.value, f.maxTemperature.value])};
    const ev = x => [x.eventID, (x.startDate || '').slice(0, 16) + 'Z', x.endDate ? x.endDate.slice(0, 16) + 'Z' : null, /PVS-30/.test(x.entityName || '') ? 'PVS-30' : /PVS-100/.test(x.entityName || '') ? 'PVS-100' : (x.entityName || 'installation'),
      x.eventType && x.eventType.code ? x.eventType.code.id : '', x.eventType && x.eventType.code ? x.eventType.code.name : '', x.severity || '', x.eventType && x.eventType.code ? (x.eventType.code.description || '').slice(0, 220) : ''];
    const act = await g('/event/v1/plants/35546755/events/PROFILE?eventState=ACTIVE&sdt=1970-01-01T00:00:00.000Z&edt=' + E).catch(() => null);
    if (act) { o.active = act.length; o.activeList = act.map(ev); }
    banner('lecture des événements…');
    const all = await g('/event/v1/plants/35546755/events/PROFILE?eventState=ALL&sdt=' + iso(from) + '&edt=' + E).catch(() => null);
    if (all) o.events = all.map(ev);
    return o;
  }
  let tries = 0;
  async function go() {
    banner('lecture des données Aurora…');
    try {
      const o = await collect();
      banner('données envoyées au site PolyImmo ✓ (' + o.daily.length + ' jours, ' + o.p15.length + ' quarts d\'heure)'); done();
      if (window.opener && !window.opener.closed) { window.opener.postMessage({type: 'polyimmo-aurora', data: o}, SITE); setTimeout(() => window.close(), 2000); }
      else { window.name = ''; location.href = SITE + '/Polyimmo/#aurora=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(o))))); }
    } catch (e) {
      if ((e.status === 401 || e.status === 403) && tries++ < 120) { banner('connectez-vous à Aurora Vision : la mise à jour continuera toute seule'); setTimeout(go, 5000); }
      else { done(); banner('échec de la lecture (' + (e.status || e.message) + '). Réessayez depuis le site.', false); }
    }
  }
  const start = () => setTimeout(go, 1500);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
