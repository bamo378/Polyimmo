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
