"""Villa (SolarEdge, site 3273587) : récupère production, consommation, achat et vente réseau.
API SolarEdge ONE v2, accès « Site Access » (OAuth). Le jeton de renouvellement change à chaque appel :
il est gardé chiffré dans data/villa_token.enc (clé dérivée du Client Secret, stocké en secret GitHub).
Première fois : lancer le workflow « Villa » avec le code d'autorisation reçu sur le site."""
import os, json, time, base64, hashlib, datetime as dt, urllib.request, urllib.error, urllib.parse
from zoneinfo import ZoneInfo
from cryptography.fernet import Fernet

API = "https://monitoringapi.solaredge.com/v2"
SITE = os.environ.get("SOLAREDGE_SITE_ID", "3273587")
CID, CSEC = os.environ["SOLAREDGE_CLIENT_ID"].strip(), os.environ["SOLAREDGE_CLIENT_SECRET"].strip()
CODE = (os.environ.get("AUTH_CODE") or "").strip()
TZ = ZoneInfo("Europe/Zurich")
TOK, OUT = "data/villa_token.enc", "data/villa.json"
FERNET = Fernet(base64.urlsafe_b64encode(hashlib.sha256(("polyimmo-villa|" + CSEC).encode()).digest()))
CALLS = 0

def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Erreur jeton SolarEdge {e.code}: {e.read().decode()[:300]}")

def token():
    if CODE:
        print("Échange du code d'autorisation…")
        t = post(API + "/oauth2/token", {"grant_type": "authorization_code", "code": CODE, "client_id": CID, "client_secret": CSEC})
    else:
        if not os.path.exists(TOK): raise SystemExit("Pas encore connecté : lancez le workflow Villa avec le code d'autorisation.")
        rt = FERNET.decrypt(open(TOK, "rb").read()).decode()
        t = post(API + "/oauth2/token", {"grant_type": "refresh_token", "refresh_token": rt, "client_id": CID, "client_secret": CSEC})
    open(TOK, "wb").write(FERNET.encrypt(t["refresh_token"].encode()))
    print("Jeton OK (renouvellement enregistré, chiffré)")
    return t["access_token"]

def get(path, **q):
    global CALLS
    url = API + path + ("?" + urllib.parse.urlencode(q) if q else "")
    for attempt in range(4):
        CALLS += 1; time.sleep(6.5)  # offre gratuite : 10 appels / minute
        req = urllib.request.Request(url, headers={"Authorization": "Bearer " + ACC, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:300]
            if e.code == 429 and e.headers.get("retry-after"): time.sleep(int(e.headers["retry-after"]) + 2); continue
            print(f"  {e.code} {path} {q.get('resolution','')} {body}"); return None
    return None

def iso(d): return d.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def vals(j):
    if not j: return []
    if isinstance(j, dict):
        for k in ("values", "measurements", "data"):
            if isinstance(j.get(k), list): return j[k] if k == "values" else vals(j[k][0]) if j[k] and isinstance(j[k][0], dict) and "values" in j[k][0] else j[k]
    return j if isinstance(j, list) else []
def kwh(j):
    u = (j or {}).get("unit", "WH") if isinstance(j, dict) else "WH"; f = {"WH": 1/1000, "KWH": 1, "MWH": 1000}.get(u, 1/1000)
    return {v["timestamp"]: (v["value"] * f if v.get("value") is not None else None) for v in vals(j) if isinstance(v, dict) and "timestamp" in v}
def kw(j):
    u = (j or {}).get("unit", "W") if isinstance(j, dict) else "W"; f = {"W": 1/1000, "KW": 1, "MW": 1000}.get(u, 1/1000)
    return {v["timestamp"]: (v["value"] * f if v.get("value") is not None else None) for v in vals(j) if isinstance(v, dict) and "timestamp" in v}
def utc(ts): return dt.datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
def lday(ts): return dt.datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(TZ).date().isoformat()

ACC = token()
D = json.load(open(OUT)) if os.path.exists(OUT) else {}
D.setdefault("site", {"name": "Villa", "kwp": 30.16, "commissioned": "2022-11-17"})
D.setdefault("daily", {})
D.setdefault("p15", {})

def telem(f, t, res):
    """Compteurs du site : achat, vente, consommation (une seule requête pour tous)."""
    j = get(f"/sites/{SITE}/meters/telemetry", **{"from": iso(f), "to": iso(t), "resolution": res})
    out = {}
    for sn, mets in ((j or {}).get("meters") or {}).items():
        for m, v in mets.items():
            if not isinstance(v, dict): continue
            key = {"importEnergy": "imp", "exportEnergy": "exp", "consumptionEnergy": "cons", "consumptionPower": "consW", "importPower": "impW", "exportPower": "expW"}.get(m)
            if not key: continue
            u = v.get("unit", "WH"); fac = {"WH": 1/1000, "KWH": 1, "MWH": 1000, "W": 1/1000, "KW": 1, "MW": 1000}.get(u, 1/1000)
            for x in v.get("values") or []:
                if x.get("value") is None: continue
                out.setdefault(x["timestamp"], {})[key] = out.get(x["timestamp"], {}).get(key, 0) + x["value"] * fac
    return out

if os.environ.get("DIAG"):
    print("DIAG", json.dumps(telem(dt.datetime.now(TZ) - dt.timedelta(hours=3), dt.datetime.now(TZ), "QUARTER_HOUR"))[:800]); raise SystemExit(0)

today = dt.datetime.now(TZ).date()
first = dt.date.fromisoformat(D["site"]["commissioned"])
D.pop("meters", None)
# 1) Énergie par jour : production (site) + achat / vente / consommation (compteurs), fenêtres d'un mois
full = not D["daily"] or not D.get("dailyMeters")
start = first if full else max(first, today - dt.timedelta(days=4))
a = start
while a <= today:
    b = min(today, (a.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1))
    f, t = dt.datetime.combine(a, dt.time(), TZ), dt.datetime.combine(b + dt.timedelta(days=1), dt.time(), TZ)
    if full and D["daily"] and all(D["daily"].get((a + dt.timedelta(days=i)).isoformat(), {}).get("prod") is not None for i in range((b - a).days + 1)) and b < today - dt.timedelta(days=4):
        pass   # production déjà connue : seulement les compteurs
    else:
        for ts, v in kwh(get(f"/sites/{SITE}/energy", **{"from": iso(f), "to": iso(t), "resolution": "DAY", "unit": "WH"})).items():
            D["daily"].setdefault(lday(ts), {})["prod"] = None if v is None else round(v, 2)
    for ts, x in telem(f, t, "DAY").items():
        dd = D["daily"].setdefault(lday(ts), {})
        for k in ("imp", "exp", "cons"):
            if k in x: dd[k] = round(x[k], 2)
    a = b + dt.timedelta(days=1)
D["dailyMeters"] = True

# 2) Quarts d'heure (12 h par requête) : production, consommation, achat, vente — 3 derniers jours (30 au début)
days = 30 if not D["p15"] or not D.get("p15Meters") else 2
for n in range(days, -1, -1):
    d = today - dt.timedelta(days=n)
    for half in (0, 12):
        f = dt.datetime.combine(d, dt.time(half), TZ); t = f + dt.timedelta(hours=12)
        if f > dt.datetime.now(TZ): continue
        for ts, v in kw(get(f"/sites/{SITE}/power", **{"from": iso(f), "to": iso(t), "resolution": "QUARTER_HOUR", "unit": "W"})).items():
            D["p15"].setdefault(utc(ts), [None, None])[0] = None if v is None else round(v, 2)
        for ts, x in telem(f, t, "QUARTER_HOUR").items():
            row = D["p15"].setdefault(utc(ts), [None, None])
            if "consW" in x: row[1] = round(x["consW"], 2)
            elif "cons" in x: row[1] = round(x["cons"] * 4, 2)
D["p15Meters"] = True
lim = (today - dt.timedelta(days=400)).isoformat()
D["p15"] = {k: v for k, v in sorted(D["p15"].items()) if k >= lim}

# 3) Énergie à l'heure sur 1 an : [production, consommation, achat, vente] (24 h par requête)
#    rattrapage progressif vers le passé (BACK appels max par passage) pour rester dans l'offre gratuite
if not D.get("hMeters"): D["h"] = {}; D.pop("hFrom", None)
D.setdefault("h", {})
BACK = int(os.environ.get("HOURLY_BACKFILL", "240"))
def hourly(d):
    f = dt.datetime.combine(d, dt.time(), TZ); t = f + dt.timedelta(days=1)
    for ts, v in kwh(get(f"/sites/{SITE}/energy", **{"from": iso(f), "to": iso(t), "resolution": "HOUR", "unit": "WH"})).items():
        D["h"].setdefault(utc(ts), [None, None, None, None])[0] = None if v is None else round(v, 3)
    for ts, x in telem(f, t, "HOUR").items():
        row = D["h"].setdefault(utc(ts), [None, None, None, None])
        for i, k in ((1, "cons"), (2, "imp"), (3, "exp")):
            if k in x: row[i] = round(x[k], 3)
for n in range(2, -1, -1): hourly(today - dt.timedelta(days=n))
oldest = dt.date.fromisoformat(D.get("hFrom", (today - dt.timedelta(days=2)).isoformat()))
limit = today - dt.timedelta(days=364)
used = 0
while oldest > limit and used + 2 <= BACK:
    oldest -= dt.timedelta(days=1); hourly(oldest); used += 2
D["hFrom"] = oldest.isoformat(); D["hMeters"] = True
D["h"] = {k: v for k, v in sorted(D["h"].items()) if k >= limit.isoformat()}

D["daily"] = dict(sorted(D["daily"].items()))
# garder 400 jours de quarts d'heure
lim = (today - dt.timedelta(days=400)).isoformat()
D["p15"] = {k: v for k, v in sorted(D["p15"].items()) if k >= lim}
D["updated"] = dt.datetime.now(TZ).strftime("%Y-%m-%dT%H:%M")
D["source"] = "SolarEdge Monitoring API v2"
json.dump(D, open(OUT, "w"), separators=(",", ":"))
print(f"OK : {len(D['daily'])} jours, {len(D['p15'])} quarts d'heure, {CALLS} appels API")
