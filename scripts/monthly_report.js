// Génère les rapports PDF PolyImmo (mois précédent + année en cours) avec le moteur PDF du site.
// Usage : node scripts/monthly_report.js http://localhost:8000/ out/
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const url = process.argv[2] || 'http://localhost:8000/', out = process.argv[3] || 'out';
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch(), page = await browser.newPage();
  if (process.env.LIBS) {                                // tests hors ligne : bibliothèques locales
    const L = { 'chart.umd.min.js': 'chart.js/dist/chart.umd.js', 'jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js', 'jspdf.plugin.autotable.min.js': 'jspdf-autotable/dist/jspdf.plugin.autotable.min.js' };
    await page.route(/cdnjs|googleapis|gstatic/, r => { const f = L[r.request().url().split('/').pop()]; f ? r.fulfill({ path: path.join(process.env.LIBS, f), contentType: 'application/javascript' }) : r.abort(); });
  }
  page.on('pageerror', e => console.error('page:', e.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.PI && PI.LAST && PI.reportPDF && window.jspdf && window.Chart && PI.runChecks, null, { timeout: 60000 });
  await page.waitForTimeout(1500);                       // logo, finances
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Zurich' }));
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear(), m = now.getMonth() === 0 ? 12 : now.getMonth();
  const specs = [{ kind: 'month', year: y, m }, { kind: 'year', year: y }];
  const info = await page.evaluate(() => ({ last: PI.LAST }));
  for (const s of specs) {
    const r = await page.evaluate(sp => PI.reportPDF(sp), s);
    fs.writeFileSync(path.join(out, r.name), Buffer.from(r.b64, 'base64'));
    console.log('PDF :', r.name, Math.round(r.b64.length * 0.75 / 1024), 'Ko');
  }
  fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify({ year: y, month: m, last: info.last }));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
