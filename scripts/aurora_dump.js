// À exécuter dans un onglet https://www.auroravision.net/ déjà connecté (session de l'utilisateur, lecture seule).
// Résultat : texte compact AURORA_DUMP{...}END placé dans la page, à lire avec get_page_text.
(async () => {
  const g = async u => { const r = await fetch(u); if (!r.ok) throw new Error(r.status + ' ' + u); return r.json(); };
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
  document.body.innerHTML = '<main><article><pre id="dump"></pre></article></main>';
  document.getElementById('dump').textContent = 'AURORA_DUMP' + JSON.stringify(o) + 'END';
  return JSON.stringify(o).length;
})();
