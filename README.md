# PolyImmo — site de l'installation solaire

Page web qui affiche en direct la production de l'installation photovoltaïque PolyImmo (Bulle),
à partir du partage public Aurora Vision (FIMER).

Site en ligne : https://bamo378.github.io/polyimmo/

## Brancher Aurora Vision (une seule fois)

1. Sur Aurora Vision : **Plantes > Gestion** → installation PolyImmo → **Actions > Plant Viewer**
   → **Sharing Options : Share** (nécessite les droits administrateur).
2. Copier l'**URL publique** (section *Published View*).
3. Dans `index.html`, coller l'URL entre les guillemets de la ligne :
   `const AURORA_PUBLIC_URL = "";`
4. Enregistrer (commit). Le site se met à jour en 1–2 minutes.

## Données de production

`data/production.json` contient la production journalière issue d'Aurora Vision (depuis le 22.09.2025)
et les relevés de compteur trimestriels (depuis 2023). Le site lit ce fichier et calcule tout le reste.
Pour mettre à jour : demander à Claude de récupérer les nouvelles données Aurora Vision (via Chrome),
ou remplacer le fichier.

## Structure

- `index.html` : mise en page et styles
- `app.js` : tableau de bord (filtres, graphiques, onduleurs, calendrier, puissance, météo, événements)
- `finance.js` : module financier (prix de reprise par trimestre, projection, amortissement, TRI)
- `data/production.json` : données de production (Aurora Vision + relevés de compteur)
- `data/finance.json` : valeurs financières par défaut (investissement, factures). Les réglages faits
  dans le site sont enregistrés dans le navigateur (exportables / importables en JSON).

## Onglets

- **Tableau de bord** : production, onduleurs, calendrier, puissance, météo, événements, historique.
- **Finances** : revenus, amortissement, projection, prix de reprise par trimestre (calculés à partir des saisies).
- **Saisie** : factures GRD, versements banque, autres revenus, charges → `data/entries.json`.
  Pour enregistrer depuis le site : *Connexion GitHub* avec une clé « fine-grained » limitée au dépôt Polyimmo
  (permission *Contents : Read and write*). Sans clé, les saisies restent dans le navigateur.
- **Contrôles** : analyse automatique des incohérences.
- **Rapports PDF** : rapport mensuel, trimestriel, annuel ou personnalisé.
