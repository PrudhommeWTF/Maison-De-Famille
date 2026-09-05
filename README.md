# Maison de Famille

Application auto-hébergée de gestion de biens familiaux : plusieurs biens, détenus en
indivision, par une SCI ou en nom propre, avec ou sans location saisonnière. Elle remplace le
calendrier Excel tenu par une seule personne, sans lui retirer son rôle d'arbitre.

Instance unique, une seule famille, données chez vous.

## État

**Proposition d'architecture, en attente de validation. Aucun code applicatif n'est encore
écrit.** Ce dépôt contient pour l'instant le paquet de transmission du design et les trois
documents de conception.

## Ce que fait l'application

| Domaine | Contenu |
| --- | --- |
| Séjours | Calendrier d'occupation, demandes, arbitrage par la gérante, détection de conflits, tour de choix saisonnier et quotas |
| Argent | Dépenses avec justificatif, règles de répartition datées, ventilation figée et justifiable, soldes, virements en nombre minimal, appels de fonds |
| Maison | Carnet d'entretien, récurrences, checklist de départ, fiche du bien, inventaire, coffre-fort de documents et de codes |
| Famille | Décisions et votes selon la structure, voix pondérées par les parts, membres et quotes-parts, accès temporaires |
| Location | Réservations, loyers, net à répartir, accès locataire par lien limité. Activable bien par bien |
| Souvenirs | Albums photo par bien |

## Pile technique

Angular 21 (composants standalone, signals), Node/Express en TypeScript, SQLite via
`better-sqlite3`, authentification JWT. Une seule image Docker, ou une installation LXC native
sous systemd. Aucun service supplémentaire, aucune base externe, aucun appel réseau sortant en
dehors du SMTP que vous configurez.

## Documentation

| Document | Contenu |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | Découpage en modules, sécurité, portée d'accès par rôle, notifications, contradictions arbitrées |
| [`docs/modele-de-donnees.md`](docs/modele-de-donnees.md) | Le schéma relationnel complet, table par table, avec les raisons |
| [`docs/plan-des-tranches.md`](docs/plan-des-tranches.md) | Ce qui est livré quand, la stratégie de migration, ce que couvrent les tests |
| [`docs/design/handoff/`](docs/design/handoff/) | Le paquet de transmission du design. Contractuel pour l'apparence et les libellés |

Installation, sauvegarde, restauration et exploitation seront documentées ici au fil de l'eau,
en commandes shell, systemd et docker.

## Le prototype de design

`docs/design/handoff/Maison de Famille.dc.html` s'ouvre dans un navigateur et montre les
quatorze écrans bureau et les trois écrans mobiles, avec un panneau « Notes de comportement »
qui donne les règles écran par écran.

`support.js` et `image-slot.js` sont le moteur de ce prototype. Ils servent uniquement à
l'ouvrir : **aucun de leurs octets n'entre dans le produit**.

## Licence

MIT.
