"""Historique des prix day-ahead au pas horaire (2019 → août 2025), téléchargé une seule fois.
Écrit data/history_<zone>.json (EUR/MWh, moyenne horaire) et data/fx_hist.json (EUR/CHF journalier, BCE).
La période récente (dès sept. 2025) est dans data/prices_<zone>.json, mise à jour chaque jour."""
import json, time, urllib.request, datetime as dt, os
from fetch_prices import get, month_chunks

START, END = "2019-01-01", "2025-09-01"
os.makedirs("data", exist_ok=True)
for z in ["CH", "DE-LU", "FR"]:
    path = f"data/history_{z}.json"
    if os.path.exists(path) and not os.environ.get("FORCE"): print("déjà présent", path); continue
    hours = {}
    for a, b in month_chunks(START, END):
        j = get(f"https://api.energy-charts.info/price?bzn={z}&start={a}&end={b}")
        for t, p in zip(j.get("unix_seconds") or [], j.get("price") or []):
            if p is None: continue
            h = t - t % 3600; s = hours.setdefault(h, [0.0, 0]); s[0] += p; s[1] += 1
        time.sleep(2)
    t0, t1 = min(hours), max(hours)
    vals = [round(hours[h][0] / hours[h][1], 2) if h in hours else None for h in range(t0, t1 + 3600, 3600)]
    with open(path, "w") as f:
        json.dump({"zone": z, "unit": "EUR/MWh", "step": 3600, "start": t0, "values": vals,
                   "source": "energy-charts.info (Fraunhofer ISE) - CC BY 4.0"}, f, separators=(",", ":"))
    print(z, len(vals), "heures", sum(v is None for v in vals), "manquantes")
if not os.path.exists("data/fx_hist.json") or os.environ.get("FORCE"):
    fx = get(f"https://api.frankfurter.dev/v1/{START}..{END}?base=EUR&symbols=CHF")
    with open("data/fx_hist.json", "w") as f:
        json.dump({"source": "BCE via frankfurter.dev", "rates": {d: r["CHF"] for d, r in fx["rates"].items()}}, f, separators=(",", ":"))
