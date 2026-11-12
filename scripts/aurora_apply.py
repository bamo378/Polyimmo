"""Applique un relevé Aurora (texte AURORA_DUMP{...}END copié depuis Chrome) à data/production.json et data/power15.v64.
Usage : python scripts/aurora_apply.py dump.txt"""
import sys, json, re, base64, datetime as dt
from zoneinfo import ZoneInfo
TZ, UTC = ZoneInfo("Europe/Zurich"), dt.timezone.utc
txt = open(sys.argv[1]).read(); m = re.search(r"AURORA_DUMP(\{.*\})END", txt, re.S)
if not m: raise SystemExit("Relevé introuvable")
o = json.loads(m.group(1))
lday = lambda s: dt.datetime.strptime(s, "%Y-%m-%dT%H:%M").replace(tzinfo=UTC).astimezone(TZ).date().isoformat()
today = dt.datetime.now(TZ).date().isoformat()
D = json.load(open("data/production.json")); daily = dict(D["daily"])
for s, v in o["daily"]:
    if v is not None: daily[lday(s)] = round(v)
D["daily"] = [[k, daily[k]] for k in sorted(daily)]
for inv in D["inverters"]:
    s0 = dt.date.fromisoformat(inv["start"])
    for s, v in o["inv"].get(inv["id"], []):
        if v is None: continue
        i = (dt.date.fromisoformat(lday(s)) - s0).days
        while len(inv["daily"]) <= i: inv["daily"].append(None)
        inv["daily"][i] = round(v)
P = {int(dt.datetime.strptime(s, "%Y-%m-%dT%H:%M").replace(tzinfo=UTC).timestamp()): v for s, v in o["p15"]}
if o.get("wx"): D["weather"] = {"at": o["at"][:16], **o["wx"]}
if "active" in o: D.setdefault("events", {})["active"] = o["active"]
D["updated"] = today
json.dump(D, open("data/production.json", "w"), ensure_ascii=False, separators=(",", ":"))
# archive 15 min
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
T0 = 1761082200; end = T0 + 900 * (len(arr) - 1)
lastP = max(P) if P else end
for u in range(end + 900, lastP + 900, 900): arr.append(0)
for u, v in P.items():
    k = (u - T0) // 900
    if 0 <= k < len(arr): arr[k] = round(v * 10)
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
# fenêtre des 7 derniers jours (archive complète + relevé du jour)
kwAt = lambda u: P[u] if u in P else (arr[(u - T0) // 900] / 10 if 0 <= (u - T0) // 900 < len(arr) else 0.0)
p0 = dt.date.fromisoformat(today) - dt.timedelta(days=6); u0 = int(dt.datetime.combine(p0, dt.time(), TZ).timestamp())
vals = [round(kwAt(u0 + 900 * k), 1) for k in range(96 * 7)]
D["power15"] = {"start": p0.isoformat(), "stepMin": 15, "unit": "kW", "values": vals}
D["hourly"] = {"start": p0.isoformat(), "values": [round(sum(vals[4*h:4*h+4]) / 4, 1) for h in range(24 * 7)]}
json.dump(D, open("data/production.json", "w"), ensure_ascii=False, separators=(",", ":"))
print("OK : production jusqu'au", max(daily), "| derniers jours :", D["daily"][-4:])
