"""PolyImmo (Aurora Vision, plant 35546755) : production journalière, onduleurs et puissance 15 min via l'API officielle.
Secrets GitHub requis (saisis par le propriétaire, jamais dans le code) :
  AURORA_APIKEY   clé X-AuroraVision-ApiKey fournie par le service client FIMER
  AURORA_USER     identifiant du compte Aurora Vision
  AURORA_PASSWORD mot de passe du compte Aurora Vision
Sans ces secrets, le script ne fait rien (pas d'erreur)."""
import os, json, base64, datetime as dt, urllib.request, urllib.error, urllib.parse, time
from zoneinfo import ZoneInfo

KEY, USER, PWD = (os.environ.get(k, "").strip() for k in ("AURORA_APIKEY", "AURORA_USER", "AURORA_PASSWORD"))
if not (KEY and USER and PWD):
    print("Aurora : secrets non renseignés, rien à faire."); raise SystemExit(0)
API = "https://api.auroravision.net/api/rest"
PLANT, INV = "35546755", {"PVS-100": "35633330", "PVS-30": "35634342"}
TZ = ZoneInfo("Europe/Zurich")

def req(url, headers):
    r = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp: return resp
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Aurora {e.code} sur {url.split('?')[0].replace(API, '')}")

auth = base64.b64encode(f"{USER}:{PWD}".encode()).decode()
r = urllib.request.Request(API + "/authenticate", headers={"X-AuroraVision-ApiKey": KEY, "Authorization": "Basic " + auth})
try:
    with urllib.request.urlopen(r, timeout=60) as resp:
        TOKEN = resp.headers.get("X-AuroraVision-Token") or json.loads(resp.read() or b"{}").get("result")
except urllib.error.HTTPError as e:
    raise SystemExit(f"Aurora : authentification refusée ({e.code}). Vérifiez la clé API, l'identifiant et le mot de passe.")
if not TOKEN: raise SystemExit("Aurora : pas de jeton reçu.")
print("Aurora : connecté")

def series(cat, eid, dtype, vtype, sample, d0, d1):
    q = urllib.parse.urlencode({"sampleSize": sample, "startDate": d0.strftime("%Y%m%d"), "endDate": d1.strftime("%Y%m%d"), "timeZone": "Europe/Zurich"})
    url = f"{API}/v1/stats/{cat}/timeseries/{eid}/{dtype}/{vtype}?{q}"
    for attempt in range(3):
        rq = urllib.request.Request(url, headers={"X-AuroraVision-Token": TOKEN, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(rq, timeout=90) as resp: j = json.loads(resp.read())
            break
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and attempt < 2: time.sleep(10); continue
            print(f"  {e.code} {cat}/{eid}/{dtype}/{sample}"); return []
    rows = j.get("result", j) if isinstance(j, dict) else j
    return [(x["start"], x.get("value"), x.get("units") or x.get("unit")) for x in rows if isinstance(x, dict) and "start" in x]

today = dt.datetime.now(TZ).date()
D = json.load(open("data/production.json"))
daily = dict(D["daily"])
last = max(daily) if daily else "2025-09-22"
d0 = min(dt.date.fromisoformat(last) - dt.timedelta(days=3), today - dt.timedelta(days=10))
loc = lambda s: dt.datetime.fromtimestamp(s, TZ).date().isoformat()
kwh = lambda v, u: None if v is None else (v / 1000 if (u or "").lower().startswith("w") else v)   # Wh → kWh si besoin

# 1) énergie journalière de l'installation
got = series("energy", PLANT, "GenerationEnergy", "delta", "Day", d0, today + dt.timedelta(days=1))
print("Exemple réponse énergie :", got[:2])
for s, v, u in got:
    k = loc(s)
    if k <= today.isoformat() and v is not None: daily[k] = round(kwh(v, u))
D["daily"] = [[k, daily[k]] for k in sorted(daily)]
# 2) onduleurs
for inv in D["inverters"]:
    eid = INV.get(inv["id"]); s0 = dt.date.fromisoformat(inv["start"])
    if not eid: continue
    for s, v, u in series("energy", eid, "GenerationEnergy", "delta", "Day", d0, today + dt.timedelta(days=1)):
        k = dt.date.fromisoformat(loc(s)); i = (k - s0).days
        if v is None or i < 0 or k > today: continue
        while len(inv["daily"]) <= i: inv["daily"].append(None)
        inv["daily"][i] = round(kwh(v, u))
# 3) puissance au quart d'heure (8 derniers jours)
p0 = today - dt.timedelta(days=7)
P = {}
for s, v, u in series("power", PLANT, "GenerationPower", "average", "Min15", p0, today + dt.timedelta(days=1)):
    if v is not None: P[s] = v / 1000 if (u or "W").upper() == "W" else v
start = dt.datetime.combine(p0, dt.time(), TZ); u0 = int(start.timestamp())
vals = [round(P.get(u0 + 900 * k, 0.0), 1) for k in range(96 * 7)]
D["power15"] = {"start": p0.isoformat(), "stepMin": 15, "unit": "kW", "values": vals}
D["hourly"] = {"start": p0.isoformat(), "values": [round(sum(vals[4*h:4*h+4]) / 4, 1) for h in range(24 * 7)]}
D["updated"] = today.isoformat()
json.dump(D, open("data/production.json", "w"), ensure_ascii=False, separators=(",", ":"))

# 4) archive 15 min (power15.v64) pour la simulation au prix du marché
raw = base64.b64decode(open("data/power15.v64").read().strip()); i = 0
def vi():
    global i; x = sh = 0
    while True:
        c = raw[i]; i += 1; x |= (c & 127) << sh; sh += 7
        if c < 128: return x
arr = []
while i < len(raw):
    z = vi(); c = vi(); arr += [0] * z; p = 0
    for _ in range(c):
        d = vi(); p += -(d + 1) // 2 if d & 1 else d // 2; arr.append(p)
T0 = 1761082200; end = T0 + 900 * (len(arr) - 1); lastP = max(P) if P else end
for u in range(end + 900, lastP + 900, 900): arr.append(round(P.get(u, 0.0) * 10))
out = bytearray()
def w(x):
    while True:
        c = x & 127; x >>= 7
        if x: out.append(c | 128)
        else: out.append(c); break
j = 0
while j < len(arr):
    z = 0
    while j < len(arr) and arr[j] == 0: z += 1; j += 1
    run = []
    while j < len(arr) and arr[j] != 0: run.append(arr[j]); j += 1
    w(z); w(len(run)); p = 0
    for x in run:
        d = x - p; p = x; w(2 * d if d >= 0 else -2 * d - 1)
open("data/power15.v64", "w").write(base64.b64encode(out).decode())
print(f"OK : production jusqu'au {max(daily)}, {len(P)} quarts d'heure, archive 15 min jusqu'au {dt.datetime.fromtimestamp(T0 + 900*(len(arr)-1), TZ):%Y-%m-%d %H:%M}")
