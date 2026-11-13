// ==UserScript==
// @name         PolyImmo – mise à jour depuis Aurora Vision
// @namespace    https://bamo378.github.io/Polyimmo/
// @version      1.0
// @description  Quand le site PolyImmo ouvre Aurora Vision avec le bouton « Mettre à jour », lit les 10 derniers jours avec VOTRE connexion (lecture seule) et les renvoie au site. Aucun mot de passe n'est lu ni enregistré.
// @match        https://www.auroravision.net/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function () {
  'use strict';
  const SITE = 'https://bamo378.github.io';
  if (window.name !== 'polyimmo-sync') return;          // ne fait rien hors du bouton PolyImmo
  const banner = (t, ok) => { let b = document.getElementById('pi-sync'); if (!b) { b = document.createElement('div'); b.id = 'pi-sync';
      b.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:12px 18px;border-radius:12px;font:600 15px system-ui;box-shadow:0 8px 30px rgba(0,0,0,.25)'; document.body.appendChild(b); }
    b.style.background = ok === false ? '#b42318' : '#e31818'; b.style.color = '#fff'; b.textContent = 'PolyImmo · ' + t; };
  const g = async u => { const r = await fetch(u, {credentials: 'include'}); if (!r.ok) { const e = new Error(r.status); e.status = r.status; throw e; } return r.json(); };
  async function collect() {
    const now = new Date(), E = now.toISOString(), S = new Date(now - 10 * 864e5).toISOString().slice(0, 10) + 'T00:00:00.000Z', S15 = new Date(now - 8 * 864e5).toISOString().slice(0, 10) + 'T00:00:00.000Z';
    const day = async base => (await g(base + '/energy/GenerationEnergy?agp=Day&afx=Delta&sdt=' + S + '&edt=' + E)).map(x => [x.start.slice(0, 16), x.value == null ? null : Math.round(x.value * 10) / 10]);
    const o = {at: E};
    o.daily = await day('/telemetry/v1/plants/35546755');
    o.inv = {'PVS-100': await day('/telemetry/v1/devices/35633330'), 'PVS-30': await day('/telemetry/v1/devices/35634342')};
    o.p15 = (await g('/telemetry/v1/plants/35546755/power/GenerationPower?agp=Min15&afx=Avg&sdt=' + S15 + '&edt=' + E)).filter(x => x.value != null && x.value > 40).map(x => [x.start.slice(0, 16), Math.round(x.value / 100) / 10]);
    const wx = await g('/weather/v1/plants/35546755/status?includeForecasts=true').catch(() => null);
    if (wx) o.wx = {now: {code: wx.condition && wx.condition.code, temp: wx.condition && wx.condition.temperature && wx.condition.temperature.value}, forecast: (wx.forecasts || []).map(f => [f.date.slice(0, 10), f.code, f.minTemperature.value, f.maxTemperature.value])};
    const act = await g('/event/v1/plants/35546755/events/PROFILE?eventState=ACTIVE&sdt=1970-01-01T00:00:00.000Z&edt=' + E).catch(() => null);
    if (act) o.active = act.length;
    return o;
  }
  let tries = 0;
  async function go() {
    banner('lecture des données Aurora…');
    try {
      const o = await collect();
      banner('données envoyées au site PolyImmo ✓');
      if (window.opener && !window.opener.closed) { window.opener.postMessage({type: 'polyimmo-aurora', data: o}, SITE); setTimeout(() => window.close(), 1500); }
      else { window.name = ''; location.href = SITE + '/Polyimmo/#aurora=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(o))))); }
    } catch (e) {
      if ((e.status === 401 || e.status === 403) && tries++ < 120) { banner('connectez-vous à Aurora Vision : la mise à jour continuera toute seule'); setTimeout(go, 5000); }
      else banner('échec de la lecture (' + (e.status || e.message) + '). Réessayez depuis le site.', false);
    }
  }
  setTimeout(go, 1500);
})();
