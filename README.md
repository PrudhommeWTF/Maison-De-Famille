# Maison de Famille

Application auto-hébergée de gestion de biens familiaux : plusieurs biens,
détenus en indivision, par une SCI ou en nom propre, avec ou sans location
saisonnière. Elle remplace le calendrier Excel tenu par une seule personne, sans
lui retirer son rôle d'arbitre.

Instance unique, une seule famille, données chez vous.

## État

**Tranches 1 à 4 livrées : le planning, les comptes, l'argent, la maison et la
famille.** La location saisonnière et les albums suivront (voir
[`docs/plan-des-tranches.md`](docs/plan-des-tranches.md)).

Ce qui fonctionne aujourd'hui :

- comptes, **invitation par courriel ou par lien transmis à la main**, mot de
  passe oublié, second facteur ;
- personnes, foyers et rôles par structure, avec **deux gérants obligatoires**
  par structure ;
- structures (indivision, SCI, nom propre) avec leurs règles de décision ;
- biens, fiche, photo, archivage réversible ;
- **quotes-parts historisées** avec date d'effet et motif ;
- calendrier d'occupation, demandes, détection de conflits avant l'envoi,
  arbitrage par la gérante, saisie directe pour un tiers ;
- tour de choix saisonnier avec voeux, quotas indicatifs et ordre rotatif ;
- import du planning existant (.xlsx, CSV, tableau HTML), simulé puis annulable ;
- **dépenses avec justificatif**, règles de répartition datées, ventilation
  figée à la saisie et explicable en un clic, recalcul explicite et motivé ;
- soldes calculés (jamais stockés), virements proposés en nombre minimal,
  appels de fonds ;
- notifications par courriel, en file durable avec reprise ;
- **carnet d'entretien** : récurrences engendrant leurs échéances, tâches
  datées à la réalisation avec facture, checklist de départ envoyée la veille ;
- **fiche complète** du bien : caractéristiques, guide d'arrivée, inventaire et
  signalement de casse ;
- **carnet d'adresses** du bien : artisans, voisins, mairie, urgences ;
- **coffre-fort** : documents versionnés avec portée, **codes chiffrés au
  repos**, journal de chaque affichage, et la portée « pendant le séjour » qui
  se ferme le lendemain du départ ;
- **décisions et votes** : voix pondérées par les parts et figées à l'ouverture,
  seuils lus dans la table des règles, quorum de SCI, aucun vote en nom propre,
  historique dont chaque résultat s'explique en un clic ;
- **accès temporaires** : un invité ou un locataire entre par un lien limité
  dans le temps, sans compte, et l'accès se coupe à la révocation comme à
  l'expiration ;
- **location saisonnière**, activable par bien : réservations qui bloquent le
  calendrier comme n'importe quel séjour, loyers encaissés (jamais les loyers
  seulement signés), charges déduites, net à répartir, et une alerte quand une
  semaine est ouverte avant que la famille ait choisi ses dates ;
- **souvenirs** : un album par bien, créé tout seul à la fin d'un séjour,
  vignettes engendrées côté serveur, et un livre d'or par année ;
- export CSV des séjours et export complet de l'instance ;
- interface responsive, utilisable au doigt.

## Installer

```bash
git clone https://github.com/PrudhommeWTF/Maison-De-Famille.git
cd Maison-De-Famille
cp .env.exemple .env && openssl rand -hex 32   # à coller dans MDF_JWT_SECRET
docker compose up -d --build
```

Ou en LXC natif sous Proxmox, ce qui est le mode recommandé ici. Une seule
commande, sur l'hôte : le conteneur est créé, puis l'application y est installée.

```bash
bash deploy/lxc/proxmox-create.sh
```

Le détail, le reverse-proxy et la mise à jour sont dans
[`docs/installation.md`](docs/installation.md).

## Développer

```bash
npm run install:all
cd backend  && npm run dev      # API sur 8099
cd frontend && npm start        # application sur 4200, proxy vers 8099
```

```bash
cd backend  && npm test && npm run lint:mort
cd frontend && npm test && npm run lint:mort
```

## Pile technique

Angular 21 (composants standalone, signals, zoneless), Node/Express en
TypeScript, SQLite via `better-sqlite3`, authentification JWT et argon2id. Une
seule image Docker, ou une installation LXC native sous systemd.

Aucun service supplémentaire, aucune base externe. Les polices et les icônes
sont dans le dépôt : la **page** ne charge rien de l'extérieur, et l'application
s'ouvre sur un réseau coupé.

Le serveur, lui, joint trois adresses, et seulement celles-là :

- votre **relais SMTP**, pour les notifications ;
- **data.education.gouv.fr**, pour compléter le calendrier scolaire quand
  l'année en cours manque ;
- **api.github.com**, pour savoir s'il existe une version plus récente.

Chacune est écrite en dur dans le code, revérifiée après redirection, plafonnée
en taille et en temps. **Aucune donnée de la famille ne part** : ces appels
demandent, ils ne racontent rien. Aucune télémétrie, aucun compteur d'usage.
Rien ne s'installe tout seul : une mise à jour se confirme par mot de passe.

## Documentation

### Pour la famille qui s'en sert

| Document | Contenu |
| --- | --- |
| [`docs/guides/`](docs/guides/README.md) | **Les guides d'utilisation, un par rôle, avec des captures d'écran** |
| [`docs/guides/premiers-pas.md`](docs/guides/premiers-pas.md) | Recevoir son invitation, se connecter, se repérer. À lire en premier |
| [`docs/guides/gerant.md`](docs/guides/gerant.md) | Arbitrer, saisir les dépenses, tenir les papiers et les réglages |
| [`docs/guides/detenteur.md`](docs/guides/detenteur.md) | Demander un séjour, suivre l'argent, voter |
| [`docs/guides/membre-de-foyer.md`](docs/guides/membre-de-foyer.md) | Le conjoint d'un détenteur : calendrier, entretien, codes |
| [`docs/guides/invite.md`](docs/guides/invite.md) | Entrer par un lien, trouver les codes de son séjour |

### Pour qui héberge et fait évoluer le service

| Document | Contenu |
| --- | --- |
| [`docs/installation.md`](docs/installation.md) | Docker, LXC, reverse-proxy, mise à jour |
| [`docs/sauvegarde-restauration.md`](docs/sauvegarde-restauration.md) | Sauvegarder, restaurer, vérifier, repartir sur une machine neuve |
| [`docs/securite.md`](docs/securite.md) | Ce qui est fait, ce qui ne l'est pas, ce qui vous incombe |
| [`docs/architecture.md`](docs/architecture.md) | Découpage en modules, portée d'accès par rôle, notifications |
| [`docs/modele-de-donnees.md`](docs/modele-de-donnees.md) | Le schéma relationnel, table par table, avec les raisons |
| [`docs/schema.sql`](docs/schema.sql) | Le schéma engendré par les migrations |
| [`docs/parametres.md`](docs/parametres.md) | Tous les réglages, engendrés depuis le registre |
| [`docs/plan-des-tranches.md`](docs/plan-des-tranches.md) | Ce qui est livré quand |
| [`docs/recette-t1.md`](docs/recette-t1.md) | **Ce que vous vérifiez vous-même** pour le planning |
| [`docs/recette-t15.md`](docs/recette-t15.md) | **Ce que vous vérifiez vous-même** pour les comptes et les rôles |
| [`docs/recette-t2.md`](docs/recette-t2.md) | **Ce que vous vérifiez vous-même** pour l'argent |
| [`docs/recette-t3.md`](docs/recette-t3.md) | **Ce que vous vérifiez vous-même** pour la maison et le coffre-fort |
| [`docs/recette-t4.md`](docs/recette-t4.md) | **Ce que vous vérifiez vous-même** pour les votes et les accès temporaires |
| [`docs/design/handoff/`](docs/design/handoff/) | Le paquet de design. Contractuel pour l'apparence et les libellés |
| [`docs/guides/CAPTURES.md`](docs/guides/CAPTURES.md) | Comment réengendrer les captures des guides après un changement d'interface |
| [`CLAUDE.md`](CLAUDE.md) | Conventions du dépôt |

## Le prototype de design

`docs/design/handoff/Maison de Famille.dc.html` s'ouvre dans un navigateur et
montre les quatorze écrans bureau et les trois écrans mobiles, avec un panneau
« Notes de comportement » qui donne les règles écran par écran.

`support.js` et `image-slot.js` sont le moteur de ce prototype. Ils servent
uniquement à l'ouvrir : **aucun de leurs octets n'entre dans le produit**.

## Licence

MIT.
