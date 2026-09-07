# Réengendrer les captures des guides

Les images de `docs/guides/images/` viennent toutes de l'application réelle,
prises sur une instance de démonstration montée pour l'occasion. Aucune n'est
retouchée ni maquettée. Quand un écran change, il faut les refaire, sinon la
documentation ment plus vite que le code ne vieillit.

Deux scripts font le travail, dans `scripts/captures/` :

| Script | Rôle |
| --- | --- |
| `instance-demo.js` | Amorce une instance vide et la remplit, **uniquement par l'API publique** |
| `captures.js` | Se connecte tour à tour comme chaque rôle et prend les images |

`instance-demo.js` n'écrit jamais directement en base : tout passe par les mêmes
routes que l'interface. C'est ce qui garantit que ce que montrent les captures
est bien ce que l'application produit, y compris les mots de passe, posés par le
vrai parcours d'invitation.

## Marche à suivre

**1. Compiler le frontend et servir l'ensemble.**

```bash
cd frontend && npm run build
cd ../backend && MDF_JWT_SECRET=$(openssl rand -hex 32) \
  MDF_CLE_COFFRE=$(openssl rand -hex 32) \
  MDF_DATA_DIR=/tmp/mdf-demo \
  MDF_STATIC_DIR=../frontend/dist/frontend/browser \
  MDF_PUBLIC_URL=http://127.0.0.1:8099 npx tsx src/server.ts
```

`MDF_CLE_COFFRE` est indispensable : sans elle, le coffre-fort refuse
d'enregistrer un code, et les captures du coffre seraient vides.

`MDF_DATA_DIR` doit pointer sur un répertoire **vide**. Une instance déjà
amorcée refuse un second amorçage, et le script s'arrête en le disant.

**2. Remplir l'instance.**

```bash
node scripts/captures/instance-demo.js
```

Le script affiche en dernière ligne les identifiants engendrés, et surtout les
**deux liens d'accès temporaire** dont les captures de l'invité ont besoin :

```json
{"lienLointain":"http://127.0.0.1:8099/sejour?jeton=...","lienProche":"..."}
```

Les deux ne sont pas interchangeables. Le « proche » ouvre un séjour qui commence
demain, donc un coffre où les codes sont visibles ; le « lointain » ouvre un
séjour dans deux mois, donc un coffre encore fermé. Les guides montrent les deux
états, parce que c'est exactement la question que pose un locataire.

**3. Prendre les images.**

```bash
node scripts/captures/captures.js docs/guides/images "<lienProche>" "<lienLointain>" chemin/vers/calendrier-scolaire.csv
```

Le dernier argument est facultatif : c'est un export du calendrier scolaire, qui
sert à montrer l'import des vacances en action. Sans lui, les trois captures
correspondantes ne sont pas refaites.

Le script termine en listant les images produites, avec leur taille, puis les
**soucis** rencontrés (un bouton introuvable, un écran qui ne s'est pas ouvert).
Lisez cette liste : c'est elle qui signale qu'un écran a bougé.

## Playwright

Playwright n'est pas une dépendance du projet, il ne sert qu'ici. Deux variables
permettent de le trouver là où il est installé :

```bash
MDF_PLAYWRIGHT=/chemin/vers/playwright MDF_CHROMIUM=/chemin/vers/chromium \
  node scripts/captures/captures.js ...
```

Sans elles, le script fait un `require('playwright')` ordinaire et laisse
Chromium se trouver tout seul.

## Deux pièges déjà rencontrés

**Le serveur lit l'index une seule fois au démarrage.** Après une recompilation
du frontend, redémarrez-le, sinon il sert un index qui référence des fichiers
disparus et toutes les captures montrent une page blanche.

**Les adresses `/bien/...` exigent qu'un bien soit ouvert.** Sans clic préalable
sur la maison dans la barre du haut, elles renvoient toutes au tableau de bord,
et l'on se retrouve avec douze fois la même image sans s'en apercevoir. Le script
ouvre le bien et vérifie que le menu s'est bien rempli ; si ce n'est pas le cas,
il le signale dans les soucis.

Un moyen simple de repérer ce genre d'accident : comparer les tailles des
fichiers dans la liste finale. Plusieurs images qui pèsent exactement pareil sont
la même image.

## Deux images faites avec une réponse simulée

`gerant-maj-disponible.png` et `gerant-maj-en-cours.png` sont la seule exception
à la règle « tout vient de l'application réelle », et il faut le savoir.

Montrer une version disponible suppose qu'il en existe une plus récente que
celle qui tourne, ce qui n'arrive pas sur une instance de démonstration fraîche.
La réponse de GitHub a donc été simulée **au niveau du navigateur**, avec
`page.route()`, pendant que tout le reste restait réel : le composant, la route
du serveur, la vérification du mot de passe et le dépôt du fichier déclencheur.

Ce qui est visible sur ces deux images est donc bien ce que l'application
affiche ; seul le numéro de version annoncé est inventé.

## Ce qu'il ne faut pas mettre dans les captures

L'instance de démonstration n'existe que pour ces images. Elle porte des noms
inventés (Prudhomme, Kerloc'h, Crozon), des adresses en `@exemple.fr` et des
codes sans valeur. **Ne prenez jamais de captures sur l'instance de la famille** :
elles contiendraient des adresses réelles, des montants réels et des codes de
portail réels, et elles seraient publiées dans le dépôt.
