"""Robot PolyImmo : lit le rapport quotidien Aurora (CSV au pas de 15 min) reçu dans la boîte e-mail
dédiée au robot, puis met à jour data/production.json et data/power15.v64 via scripts/aurora_apply.py.

Secrets GitHub : MAIL_USER, MAIL_PASSWORD, MAIL_IMAP (ex. mail.infomaniak.com).
Aucun identifiant Aurora n'est utilisé : le robot ne fait que lire ses propres e-mails."""
import os, sys, io, re, csv, json, zipfile, imaplib, email, subprocess, datetime as dt
from email.header import decode_header
from zoneinfo import ZoneInfo

TZ, UTC = ZoneInfo("Europe/Zurich"), dt.timezone.utc
USER, PWD, HOST = (os.environ.get(k, "").strip() for k in ("MAIL_USER", "MAIL_PASSWORD", "MAIL_IMAP"))
if not (USER and PWD and HOST):
    print("Secrets MAIL_USER / MAIL_PASSWORD / MAIL_IMAP non renseignés : rien à faire."); sys.exit(0)

DATE_FMTS = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%d/%m/%Y %H:%M:%S",
             "%d/%m/%Y %H:%M", "%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M", "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M",
             "%Y%m%d %H:%M:%S", "%Y%m%d%H%M%S", "%Y%m%d%H%M")


def parse_date(s):
    s = s.strip().strip('"').replace("Z", "").split("+")[0].split(".")[0]
    for f in DATE_FMTS:
        try: return dt.datetime.strptime(s, f)
        except ValueError: pass
    return None


def num(s):
    s = (s or "").strip().replace(" ", "").replace("'", "")
    if not s or s in ("-", "N/A", "null"): return None
    if s.count(",") == 1 and "." not in s: s = s.replace(",", ".")
    try: return float(s.replace(",", ""))
    except ValueError: return None


def parse_csv(text):
    """Renvoie {epoch_utc: {'e': kWh sur 15 min, 'p': kW}} en détectant colonnes, unités et fuseau."""
    text = text.lstrip("﻿")
    delim = max(";,\t", key=lambda d: text[:4000].count(d))
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    out, head, tcol, utc = {}, None, None, "utc" in text[:3000].lower()
    for r in rows:
        if not r or not any(c.strip() for c in r): continue
        if tcol is None:
            for j, c in enumerate(r):
                if parse_date(c): tcol = j; break
            if tcol is None: head = r; continue
        t = parse_date(r[tcol]) if tcol < len(r) else None
        if not t: continue
        t = t.replace(tzinfo=UTC if utc else TZ)
        u = int(t.timestamp())
        rec = out.setdefault(u, {})
        for j, c in enumerate(r):
            if j == tcol: continue
            v = num(c)
            if v is None: continue
            h = (head[j] if head and j < len(head) else "").lower()
            if re.search(r"énerg|energ", h) and not re.search(r"pr[ée]di|predict|perf|rapport|\bratio\b", h):
                if "mwh" in h: v *= 1000
                elif re.search(r"\(wh\)|\bwh\b", h) and "kwh" not in h: v /= 1000
                rec["e"] = rec.get("e", 0) + v
            elif re.search(r"puiss|power", h) and not re.search(r"pr[ée]di|predict|perf|rapport|\bratio\b|dc", h):
                if re.search(r"\(w\)|\bw\b", h) and "kw" not in h: v /= 1000
                rec["p"] = rec.get("p", 0) + v
    return {u: r for u, r in out.items() if r}


def attachments(msg):
    for part in msg.walk():
        name = part.get_filename()
        if not name: continue
        name = "".join((b.decode(c or "utf-8") if isinstance(b, bytes) else b) for b, c in decode_header(name))
        data = part.get_payload(decode=True) or b""
        if name.lower().endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                for n in z.namelist():
                    if n.lower().endswith(".csv"): yield n, z.read(n)
        elif name.lower().endswith(".csv"):
            yield name, data


def subj(msg):
    return "".join((b.decode(c or "utf-8", errors="replace") if isinstance(b, bytes) else b)
                   for b, c in decode_header(msg.get("Subject", "")))


def text_of(msg):
    parts = []
    for p in msg.walk():
        if p.get_content_type() in ("text/plain", "text/html") and p.get_payload(decode=True):
            t = p.get_payload(decode=True).decode(p.get_content_charset() or "utf-8", errors="replace")
            if p.get_content_type() == "text/html":
                t = re.sub(r"(?is)<(script|style).*?</\1>", " ", t); t = re.sub(r"<[^>]+>", " ", t)
                t = re.sub(r"&nbsp;", " ", t)
            parts.append(t)
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


SEV = {"high": "élevée", "haut": "élevée", "medium": "moyenne", "mid": "moyenne", "low": "faible", "basse": "faible", "info": "info"}


def parse_alarm(msg, body):
    """Alarme Aurora reçue par e-mail -> dict ou None."""
    s = subj(msg); txt = s + " " + body
    if not re.search(r"aurora|fimer", (msg.get("From", "") + txt), re.I): return None
    if not re.search(r"event|alarm|alert|événement|evenement|fault|error|warning|erreur|panne", txt, re.I): return None
    code = re.search(r"\b([EWD]\d{3})\b", txt)
    dev = re.search(r"PVS-?(100|30)", txt, re.I)
    sev = re.search(r"severity\W{0,3}(high|medium|low|info)|gravit[ée]\W{0,3}(haut|mid|basse|info)", txt, re.I)
    closed = bool(re.search(r"\b(closed|cleared|resolved|ended|inactive|fermé|terminé|résolu)\b", txt, re.I))
    try: when = email.utils.parsedate_to_datetime(msg.get("Date")).astimezone(UTC)
    except Exception: when = dt.datetime.now(UTC)
    name = re.sub(r"^(\s*(re|fw|tr)\s*:)+", "", s, flags=re.I).strip()[:120]
    return {"ts": when.strftime("%Y-%m-%dT%H:%MZ"), "code": code.group(1) if code else "?",
            "dev": ("PVS-" + dev.group(1)) if dev else "Installation",
            "sev": SEV.get(next((g for g in sev.groups() if g), "").lower(), "moyenne") if sev else "moyenne",
            "name": name, "desc": body[:220], "closed": closed}


M = imaplib.IMAP4_SSL(HOST)
M.login(USER, PWD)
M.select("INBOX")
_, ids = M.search(None, "ALL")
recs, done, links, alarms = {}, [], [], []
for i in ids[0].split():
    _, d = M.fetch(i, "(RFC822)")
    msg = email.message_from_bytes(d[0][1])
    found = False
    for name, data in attachments(msg):
        txt = data.decode("utf-8-sig", errors="replace")
        r = parse_csv(txt); found = True
        print(f"Rapport {name} : {len(r)} quarts d'heure")
        for u, v in r.items(): recs.setdefault(u, {}).update(v)
    if found: done.append(i); continue
    body = text_of(msg)
    a = parse_alarm(msg, body)
    if a:
        alarms.append(a); done.append(i)
        print(f"Alarme : {a['ts']} {a['dev']} {a['code']} {a['sev']} {'(fin)' if a['closed'] else '(début)'} — {a['name']}")
        print("   texte :", body[:500])
    elif re.search(r"aurora|fimer", msg.get("From", "") + subj(msg), re.I):
        links += re.findall(r"https?://[^\s\"'<>]*aurora[^\s\"'<>]*", body)[:3]
        print("E-mail Aurora non reconnu :", subj(msg), "|", body[:500])
    else:
        print("E-mail ignoré :", subj(msg))

if links: print("Liens trouvés (rapport sans pièce jointe ?) :", links[:3])
if not recs and not alarms:
    print("Aucune donnée nouvelle."); M.logout(); sys.exit(0)

if recs:
    now = dt.datetime.now(TZ)
    p15, days = [], {}
    for u in sorted(recs):
        r = recs[u]
        kw = r.get("p") if r.get("p") is not None else (r["e"] * 4 if r.get("e") is not None else None)
        kwh = r.get("e") if r.get("e") is not None else (r["p"] / 4 if r.get("p") is not None else None)
        s = dt.datetime.fromtimestamp(u, UTC).strftime("%Y-%m-%dT%H:%M")
        if kw is not None and kw > 0.04: p15.append([s, round(kw, 1)])
        loc = dt.datetime.fromtimestamp(u, TZ).date()
        if kwh is not None: days.setdefault(loc, []).append(kwh)
    daily = []
    for d, v in sorted(days.items()):
        if d < now.date() or len(v) >= 90:          # jour complet seulement
            midnight = dt.datetime.combine(d, dt.time(), TZ).astimezone(UTC).strftime("%Y-%m-%dT%H:%M")
            daily.append([midnight, round(sum(v), 1)])
    o = {"at": now.astimezone(UTC).isoformat()[:16], "daily": daily, "inv": {}, "p15": p15}
    open("/tmp/aurora_mail_dump.txt", "w").write("AURORA_DUMP" + json.dumps(o) + "END")
    print(f"{len(p15)} quarts d'heure produisant, jours complets : {[(str(d), round(sum(v), 1)) for d, v in sorted(days.items()) if d < now.date() or len(v) >= 90]}")
    subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "aurora_apply.py"), "/tmp/aurora_mail_dump.txt"], check=True)

# --- alarmes : historique, alarmes en cours, compteurs
if alarms:
    D = json.load(open("data/production.json"))
    E = D.setdefault("events", {})
    rec, act = E.setdefault("recent", []), E.setdefault("activeList", [])
    seen = {(r[0], r[3], r[2]) for r in rec}
    for a in sorted(alarms, key=lambda a: a["ts"]):
        key = (a["dev"], a["code"])
        if a["closed"]:
            for x in [x for x in act if (x.get("dev"), x.get("code")) == key]:
                act.remove(x)
                mins = int((dt.datetime.strptime(a["ts"], "%Y-%m-%dT%H:%MZ") - dt.datetime.strptime(x["start"], "%Y-%m-%dT%H:%MZ")).total_seconds() // 60)
                for r in rec:
                    if (r[0], r[3], r[2]) == (x["start"], a["code"], a["dev"]): r[1] = max(mins, 0)
            continue
        if (a["ts"], a["code"], a["dev"]) in seen: continue
        seen.add((a["ts"], a["code"], a["dev"]))
        rec.insert(0, [a["ts"], None, a["dev"], a["code"], a["sev"]])
        if not any((x.get("dev"), x.get("code")) == key for x in act):
            act.append({"id": a["ts"] + a["code"], "start": a["ts"], "dev": a["dev"], "code": a["code"],
                        "name": a["name"], "sev": a["sev"], "desc": a["desc"]})
        E["total"] = E.get("total", 0) + 1
        m = a["ts"][:7]; bm = E.setdefault("byMonth", {}); bm[m] = bm.get(m, 0) + 1
    rec.sort(key=lambda r: r[0], reverse=True); del rec[40:]
    E["active"] = len(act); E["activeAt"] = dt.datetime.now(UTC).strftime("%Y-%m-%dT%H:%MZ")
    json.dump(D, open("data/production.json", "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"Alarmes enregistrées : {len(alarms)} | en cours : {len(act)}")

# --- e-mails traités : supprimés de la boîte du robot
for i in done: M.store(i, "+FLAGS", "\\Deleted")
M.expunge(); M.logout()
print("Boîte nettoyée :", len(done), "e-mail(s) traité(s).")
