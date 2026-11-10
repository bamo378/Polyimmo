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

if os.environ.get("DIAG"):
    now = dt.datetime.now(TZ); f0 = iso(now - dt.timedelta(hours=6)); t0 = iso(now)
    for path, q in [(f"/sites/{SITE}/devices", {"types": "METER"}), (f"/sites/{SITE}/devices", {"types": "ALL"}),
                    (f"/sites/{SITE}", {}), (f"/sites/{SITE}/overview", {}),
                    (f"/sites/{SITE}/meters/telemetry", {"from": f0, "to": t0}),
                    (f"/sites/{SITE}/meters/lifetime-energy", {}),
                    (f"/sites/{SITE}/consumption-energy", {"from": f0, "to": t0, "resolution": "HOUR"})]:
        print("DIAG", path, q, "=>", json.dumps(get(path, **q))[:1500])
    raise SystemExit(0)
if D.get("meters") == []: D.pop("meters")   # nouvelle détection
# Compteurs (meters)
if "meters" not in D:
    inv = get(f"/sites/{SITE}/devices")
    print("Inventaire :", json.dumps(inv)[:800])
    found = []
    def walk(o):
        if isinstance(o, dict):
            sn = o.get("serialNumber") or o.get("sn")
            t = " ".join(str(o.get(k) or "") for k in ("type", "deviceType", "category")).upper()
            if sn and "METER" in t: found.append(sn)
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(inv); D["meters"] = list(dict.fromkeys(found)); print("Compteurs :", D["meters"])

today = dt.datetime.now(TZ).date()
first = dt.date.fromisoformat(D["site"]["commissioned"])
start = first if not D["daily"] else max(first, today - dt.timedelta(days=4))
METRICS = {"cons": "consumption-energy", "imp": "import-energy", "exp": "export-energy"}
# Énergie par jour : production du site + compteurs (fenêtres d'un mois max)
a = start
while a <= today:
    b = min(today, (a.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1))
    f, t = dt.datetime.combine(a, dt.time(), TZ), dt.datetime.combine(b + dt.timedelta(days=1), dt.time(), TZ)
    for ts, v in kwh(get(f"/sites/{SITE}/energy", **{"from": iso(f), "to": iso(t), "resolution": "DAY", "unit": "WH"})).items():
        D["daily"].setdefault(lday(ts), {})["prod"] = None if v is None else round(v, 2)
    for key, ep in METRICS.items():
        for sn in D["meters"]:
            got = kwh(get(f"/sites/{SITE}/meters/{sn}/{ep}", **{"from": iso(f), "to": iso(t), "resolution": "DAY", "unit": "WH"}))
            if any(v for v in got.values()):
                for ts, v in got.items(): D["daily"].setdefault(lday(ts), {})[key] = None if v is None else round(v, 2)
                break
    a = b + dt.timedelta(days=1)

# Puissance au quart d'heure : production + consommation (fenêtres de 12 h)
days = 30 if not D["p15"] else 3
for n in range(days, -1, -1):
    d = today - dt.timedelta(days=n)
    for half in (0, 12):
        f = dt.datetime.combine(d, dt.time(half), TZ); t = f + dt.timedelta(hours=12)
        if f > dt.datetime.now(TZ): continue
        q = {"from": iso(f), "to": iso(t), "resolution": "QUARTER_HOUR", "unit": "W"}
        for ts, v in kw(get(f"/sites/{SITE}/power", **q)).items():
            D["p15"].setdefault(utc(ts), [None, None])[0] = None if v is None else round(v, 2)
        for sn in D["meters"]:
            got = kw(get(f"/sites/{SITE}/meters/{sn}/consumption-power", **q))
            if any(v for v in got.values()):
                for ts, v in got.items(): D["p15"].setdefault(utc(ts), [None, None])[1] = None if v is None else round(v, 2)
                break

# Énergie à l'heure (1 an) : production + consommation, fenêtres de 24 h.
# Rattrapage progressif vers le passé (max BACK appels par passage) pour rester dans l'offre gratuite.
D.setdefault("h", {})
BACK = int(os.environ.get("HOURLY_BACKFILL", "260"))
def hourly(d):
    f = dt.datetime.combine(d, dt.time(), TZ); t = f + dt.timedelta(days=1)
    q = {"from": iso(f), "to": iso(t), "resolution": "HOUR", "unit": "WH"}
    ok = False
    for ts, v in kwh(get(f"/sites/{SITE}/energy", **q)).items():
        D["h"].setdefault(utc(ts), [None, None])[0] = None if v is None else round(v, 3); ok = True
    for sn in D["meters"]:
        got = kwh(get(f"/sites/{SITE}/meters/{sn}/consumption-energy", **q))
        if any(v for v in got.values()):
            for ts, v in got.items(): D["h"].setdefault(utc(ts), [None, None])[1] = None if v is None else round(v, 3)
            break
    return ok
for n in range(3, -1, -1): hourly(today - dt.timedelta(days=n))      # jours récents
oldest = dt.date.fromisoformat(D.get("hFrom", today.isoformat()))
limit = today - dt.timedelta(days=364)
used = 0
while oldest > limit and used + 2 <= BACK:
    oldest -= dt.timedelta(days=1); hourly(oldest); used += 1 + max(1, len(D["meters"]))
D["hFrom"] = oldest.isoformat()
D["h"] = {k: v for k, v in sorted(D["h"].items()) if k >= limit.isoformat()}

D["daily"] = dict(sorted(D["daily"].items()))
# garder 400 jours de quarts d'heure
lim = (today - dt.timedelta(days=400)).isoformat()
D["p15"] = {k: v for k, v in sorted(D["p15"].items()) if k >= lim}
D["updated"] = dt.datetime.now(TZ).strftime("%Y-%m-%dT%H:%M")
D["source"] = "SolarEdge Monitoring API v2"
json.dump(D, open(OUT, "w"), separators=(",", ":"))
print(f"OK : {len(D['daily'])} jours, {len(D['p15'])} quarts d'heure, {CALLS} appels API")
