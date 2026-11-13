"""Envoie les rapports PDF mensuels PolyImmo par e-mail depuis la boîte du robot (SMTP Infomaniak).
Secrets : MAIL_USER, MAIL_PASSWORD, MAIL_IMAP (serveur), REPORT_TO (adresses séparées par des virgules)."""
import os, sys, json, glob, smtplib, ssl, datetime as dt
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

USER, PWD, HOST = (os.environ.get(k, "").strip() for k in ("MAIL_USER", "MAIL_PASSWORD", "MAIL_IMAP"))
TO = [a.strip() for a in os.environ.get("REPORT_TO", "").replace(";", ",").split(",") if a.strip()]
out = sys.argv[1] if len(sys.argv) > 1 else "out"
if not (USER and PWD and HOST and TO):
    print("Secrets MAIL_* ou REPORT_TO manquants : rapport non envoyé."); sys.exit(0)
pdfs = sorted(glob.glob(os.path.join(out, "*.pdf")))
if not pdfs: sys.exit("Aucun PDF généré")
meta = json.load(open(os.path.join(out, "meta.json")))
DE = lambda m: ("d'" if MOIS[m-1][0] in "aeiou" else "de ") + MOIS[m-1]
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
y, m = meta["year"], meta["month"]
D = json.load(open("data/production.json"))
day = dict(D["daily"])
mk = f"{y}-{m:02d}"
pm = sum(v for k, v in day.items() if k.startswith(mk))
py = sum(v for k, v in day.items() if k.startswith(str(y)) and k[:7] <= mk)
pm1 = sum(v for k, v in day.items() if k.startswith(f"{y-1}-{m:02d}"))
E = D.get("events", {})
f = lambda v: f"{v:,.0f}".replace(",", "'")
cmp = f" ({'+' if pm >= pm1 else ''}{(pm / pm1 - 1) * 100:.0f} % par rapport à {MOIS[m-1]} {y-1})" if pm1 else ""
body = f"""Bonjour,

Voici le rapport de l'installation solaire PolyImmo (Bulle, 185,9 kWc) pour le mois {DE(m)} {y}.

Production {DE(m)} {y} : {f(pm)} kWh{cmp}
Production depuis le 1er janvier {y} : {f(py)} kWh
Alarmes en cours : {E.get('active', 0)}
Données Aurora Vision jusqu'au : {meta['last']}

En pièce jointe, le rapport PDF :
- pages 1 et 2 : l'essentiel du mois et de l'année {y},
- pages suivantes : le détail (graphiques, onduleurs, finances, saisies, contrôles, alarmes).

Le site : https://bamo378.github.io/Polyimmo/

Rapport envoyé automatiquement par le robot PolyImmo.
"""
def build(to):
    msg = EmailMessage()
    msg["Subject"] = f"PolyImmo – rapport solaire {DE(m)} {y}" + (" (à ce jour, essai)" if os.environ.get("REPORT_PERIOD") == "current" else "")
    msg["From"] = formataddr(("Robot PolyImmo", USER))
    msg["To"] = to
    msg["Message-ID"] = make_msgid(domain=USER.split("@")[-1])
    msg.set_content(body)
    for p in pdfs:
        msg.add_attachment(open(p, "rb").read(), maintype="application", subtype="pdf", filename=os.path.basename(p))
    return msg
with smtplib.SMTP_SSL(HOST, 465, context=ssl.create_default_context()) as s:
    s.login(USER, PWD)
    for to in TO:                      # un e-mail par destinataire : un refus n'affecte pas les autres
        try: s.send_message(build(to)); print("Envoyé à …@" + to.split("@")[-1])
        except smtplib.SMTPException as e: print("Refusé pour …@" + to.split("@")[-1], ":", str(e)[:200])
