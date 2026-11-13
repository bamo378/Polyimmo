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


M = imaplib.IMAP4_SSL(HOST)
M.login(USER, PWD)
M.select("INBOX")
_, ids = M.search(None, "ALL")
recs, done, links = {}, [], []
for i in ids[0].split():
    _, d = M.fetch(i, "(RFC822)")
    msg = email.message_from_bytes(d[0][1])
    found = False
    for name, data in attachments(msg):
        txt = data.decode("utf-8-sig", errors="replace")
        r = parse_csv(txt); found = True
        print(f"Pièce jointe {name} : {len(r)} quarts d'heure")
        for u, v in r.items(): recs.setdefault(u, {}).update(v)
    if found: done.append(i)
    else:
        body = " ".join(p.get_payload(decode=True).decode(errors="replace") for p in msg.walk()
                        if p.get_content_type() in ("text/plain", "text/html") and p.get_payload(decode=True))
        links += re.findall(r"https?://[^\s\"'<>]*aurora[^\s\"'<>]*", body)[:3]
        print("E-mail sans fichier CSV :", msg.get("Subject"))

if not recs:
    if links: print("Le rapport ne contient qu'un lien (pas de fichier joint) :", links[:3])
    print("Aucune donnée nouvelle."); M.logout(); sys.exit(0)

# --- conversion vers le format du relevé Aurora attendu par aurora_apply.py
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

# --- e-mails traités : supprimés de la boîte du robot
for i in done: M.store(i, "+FLAGS", "\\Deleted")
M.expunge(); M.logout()
print("Boîte nettoyée :", len(done), "e-mail(s) traité(s).")
