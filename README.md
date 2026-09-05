# Maison de Famille

Application auto-hébergée de gestion de biens familiaux : plusieurs biens,
détenus en indivision, par une SCI ou en nom propre, avec ou sans location
saisonnière. Elle remplace le calendrier Excel tenu par une seule personne, sans
lui retirer son rôle d'arbitre.

Instance unique, une seule famille, données chez vous.

## État

**Tranche 1 livrée : le calendrier, les demandes, l'arbitrage et la reprise du
planning existant.** C'est ce qui remplace le fichier Excel. Les dépenses, le
coffre-fort, les votes et la location saisonnière suivront, tranche par tranche
(voir [`docs/plan-des-tranches.md`](docs/plan-des-tranches.md)).

Ce qui fonctionne aujourd'hui :

- comptes, rôles par structure, mot de passe oublié, second facteur ;
- structures (indivision, SCI, nom propre) avec leurs règles de décision ;
- biens, fiche, photo, archivage réversible ;
- **quotes-parts historisées** avec date d'effet et motif ;
- calendrier d'occupation, demandes, détection de conflits avant l'envoi,
  arbitrage par la gérante, saisie directe pour un tiers ;
- tour de choix saisonnier avec voeux, quotas indicatifs et ordre rotatif ;
- import du planning existant (.xlsx, CSV, tableau HTML), simulé puis annulable ;
- notifications par courriel, en file durable avec reprise ;
- export CSV des séjours et export complet de l'instance ;
- interface responsive, utilisable au doigt.

## Installer

```bash
git clone https://github.com/PrudhommeWTF/Maison-De-Famille.git
cd Maison-De-Famille
cp .env.exemple .env && openssl rand -hex 32   # à coller dans MDF_JWT_SECRET
docker compose up -d --build
```

Ou en LXC natif sous Proxmox, ce qui est le mode recommandé ici :

```bash
bash deploy/lxc/proxmox-create.sh    # sur l'hôte Proxmox
pct enter <ID>
bash <(curl -fsSL https://raw.githubusercontent.com/PrudhommeWTF/Maison-De-Famille/main/deploy/lxc/install.sh)
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

Aucun service supplémentaire, aucune base externe, et **aucun appel réseau
sortant** en dehors du relais SMTP que vous configurez : les polices et les
icônes sont dans le dépôt.

## Documentation

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
| [`docs/recette-t1.md`](docs/recette-t1.md) | **Ce que vous vérifiez vous-même**, par l'usage |
| [`docs/design/handoff/`](docs/design/handoff/) | Le paquet de design. Contractuel pour l'apparence et les libellés |
| [`CLAUDE.md`](CLAUDE.md) | Conventions du dépôt |

## Le prototype de design

`docs/design/handoff/Maison de Famille.dc.html` s'ouvre dans un navigateur et
montre les quatorze écrans bureau et les trois écrans mobiles, avec un panneau
« Notes de comportement » qui donne les règles écran par écran.

`support.js` et `image-slot.js` sont le moteur de ce prototype. Ils servent
uniquement à l'ouvrir : **aucun de leurs octets n'entre dans le produit**.

## Licence

MIT.
