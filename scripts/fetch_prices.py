"""Récupère les prix day-ahead (energy-charts.info, CC BY 4.0) et le taux EUR/CHF (BCE via frankfurter.dev).
Écrit data/prices_<zone>.json au pas de 15 minutes (les prix horaires sont répétés sur 4 quarts d'heure)."""
import json, time, urllib.request, datetime as dt, os

ZONES = ["CH", "DE-LU", "FR"]
START = os.environ.get("PRICE_START", "2025-09-01")
END = (dt.date.today() + dt.timedelta(days=2)).isoformat()
UA = {"User-Agent": "PolyImmo-site/1.0 (github.com/bamo378/Polyimmo)"}

def get(url, tries=5):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            print("retry", i, url, e); time.sleep(10 * (i + 1))
    raise SystemExit("échec " + url)

def month_chunks(a, b):
    d = dt.date.fromisoformat(a); e = dt.date.fromisoformat(b)
    while d < e:
        n = (d.replace(day=1) + dt.timedelta(days=32)).replace(day=1)
        yield d.isoformat(), min(n, e).isoformat(); d = n

def main():
  os.makedirs("data", exist_ok=True)
  for z in ZONES:
      pts = {}
      for a, b in month_chunks(START, END):
          j = get(f"https://api.energy-charts.info/price?bzn={z}&start={a}&end={b}")
          u, p = j.get("unix_seconds") or [], j.get("price") or []
          for i, t in enumerate(u):
              if p[i] is None: continue
              step = (u[i + 1] - t) if i + 1 < len(u) else (t - u[i - 1] if i else 900)
              step = 3600 if step >= 3600 else 900
              for k in range(step // 900):
                  pts.setdefault(t + 900 * k, round(p[i], 2))
          time.sleep(3)
      if not pts: print("aucune donnée", z); continue
      t0, t1 = min(pts), max(pts)
      vals = [pts.get(t) for t in range(t0, t1 + 900, 900)]
      out = {"zone": z, "unit": "EUR/MWh", "step": 900, "start": t0, "values": vals,
             "source": "energy-charts.info (Fraunhofer ISE) - CC BY 4.0", "updated": dt.datetime.utcnow().isoformat(timespec="minutes") + "Z"}
      with open(f"data/prices_{z}.json", "w") as f: json.dump(out, f, separators=(",", ":"))
      print(z, len(vals), "points", dt.datetime.utcfromtimestamp(t0), "->", dt.datetime.utcfromtimestamp(t1))

  fx = get(f"https://api.frankfurter.dev/v1/{START}..{END}?base=EUR&symbols=CHF")
  rates = {d: r["CHF"] for d, r in fx.get("rates", {}).items()}
  with open("data/fx_eurchf.json", "w") as f:
      json.dump({"source": "BCE via frankfurter.dev", "rates": rates}, f, separators=(",", ":"))
  print("fx", len(rates))

if __name__ == "__main__":
  main()
