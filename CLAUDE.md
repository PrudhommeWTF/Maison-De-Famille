# CLAUDE.md

Conventions durables de **Maison de Famille**, application auto-hébergée de
gestion de biens familiaux. À lire avant toute modification.

## Le projet en bref

- **Cible : une famille française, une instance.** La locale (`fr-FR`), le
  fuseau (`Europe/Paris`) et la devise (euro) sont **fixes**, pas configurables.
  Pas d'i18n : l'interface est en français uniquement.
- **Pile :** Angular 21 + Node/Express + TypeScript + SQLite via
  `better-sqlite3`. Un seul processus sert `/api` **et** l'application compilée.
- **Déploiement :** Docker (image unique) ou LXC natif Proxmox sous systemd.
  Voir `deploy/lxc/` et `docker-compose.yml`.
- **La maquette est contractuelle.** `docs/design/handoff/` fixe les couleurs,
  les typographies, les espacements, les rayons et les libellés. On les
  reproduit, on ne les réinvente pas. `support.js` et `image-slot.js` sont le
  moteur du prototype et **ne sont jamais portés**.

## Architecture

- **Relationnel dès le premier jour.** Une table par entité, des clés
  étrangères, des index, des migrations numérotées appliquées au démarrage.
  **Aucun document JSON global** : c'est la leçon de Foyer-App, dont l'état
  monolithique s'est effondré dès qu'il a fallu des transactions financières et
  deux utilisateurs simultanés.
- **Mutations granulaires.** On écrit la ligne qui change, jamais l'état du
  monde. Deux personnes qui saisissent en même temps ne s'écrasent pas.
- **Chaque module est autonome** : son schéma, ses règles pures, son repo, ses
  routes, sa tuile. Le noyau ne connaît aucun module, les modules ne se
  connaissent pas entre eux.
- **La logique métier vit dans des modules purs** (`regles.ts`, `parts.ts`,
  `conflits.ts`, `tour-de-choix.ts`) : ni base, ni HTTP. C'est ce qui la rend
  réellement testable. Une règle qui vit dans une route Express n'est jamais
  vraiment testée.

## Les trois règles non négociables

1. **Aucune route ne s'écrit sans déclarer son exigence d'accès.** On passe par
   `Routeur.get/post/...`, jamais par `router.get` nu. Une route qui porte
   `:bienId` exige une portée de bien, un séjour se désigne toujours dans le
   chemin de son bien. La CI le vérifie (`test/portee.test.ts`).
2. **Une quote-part est un intervalle daté, jamais une valeur courante.** Toute
   répartition passe par `partsALaDate()`. Une ventilation calculée est gelée.
   Changer une part ne recalcule jamais le passé.
3. **La convention des nuits est `[arrivee, depart)`.** Nuit d'arrivée incluse,
   nuit de départ exclue, rotation possible le même jour. Conflits, occupation,
   quotas et répartition « nuits occupées » en dépendent tous.

## Conventions de code

- **Angular moderne obligatoire** : composants `standalone`,
  `ChangeDetectionStrategy.OnPush`, **signals** (pas de RxJS pour l'état local),
  control flow intégré (`@if` / `@for` / `@switch`, jamais `*ngIf` / `*ngFor`).
  L'application est **zoneless**.
- **Sélecteurs** : `app-*` pour tout, un fichier par écran.
- **Langue** : commentaires et identifiants de domaine en **français**
  (`sejour`, `detention`, `ventilation`), verbes techniques génériques en
  anglais quand ils sont plus clairs. Les textes utilisateur, toujours en
  français.
- **Style dense.** Le code existant est terse : méthodes en une ligne, templates
  inline. Écrire du code qui **ressemble au code environnant**.
- **TypeScript strict.** `npm run lint:mort` doit passer des deux côtés :
  imports, variables et paramètres inutilisés sont des erreurs.
- **Pas de code mort ni d'UI coquille.** Chaque bouton, champ, réglage ou entrée
  de navigation affiché doit avoir un **effet réel**. Une entrée de navigation
  qui mène à un écran vide est un mensonge : on la retire jusqu'à ce que le
  module existe.
- **Les commentaires disent pourquoi, pas quoi.** Un commentaire qui paraphrase
  la ligne suivante est du bruit ; un commentaire qui explique le compromis
  retenu vaut une heure de relecture dans six mois.

## Ce qui ne se contourne pas

- **Le registre de paramètres.** Un réglage se déclare dans
  `parametres/registre.ts`, une seule fois, et se lit par `parametre('cle')`.
  Jamais de `SELECT` sur la table. Les deux copies du fichier (backend et
  frontend) sont **identiques octet pour octet**, et la CI le vérifie.
- **Le schéma engendré.** Après toute migration :
  `cd backend && npm run docs:schema && npm run docs:parametres`. La CI échoue
  si `docs/schema.sql` ou `docs/parametres.md` est périmé.
- **Les migrations sont numérotées, jamais modifiées après coup.** Une migration
  déjà appliquée quelque part est figée : on en ajoute une nouvelle.
- **Rien ne se supprime.** Archivage daté (`archive_le`) pour un bien retiré,
  une personne sortie de l'indivision, un séjour annulé, un import défait.

## Règles d'écriture

- **Pas de tirets longs (tirets cadratins).** Ni dans l'interface, ni dans la
  documentation, ni dans les réponses. Virgule, deux-points ou parenthèses.
- **Les messages d'erreur sont écrits pour la famille**, pas pour un
  développeur : ils disent ce qui s'est passé et si possible quoi faire. Le
  détail technique va dans le journal, jamais dans la réponse HTTP.
- **Honnêteté.** Signaler ce qui ne marche pas ou n'est que cosmétique. Sur un
  choix produit, présenter le compromis et **recommander**.

## Workflow Git

- **Toujours une branche dédiée partant de `main`**, jamais de commit direct.
- **Une PR = un sujet cohérent.** Plusieurs petites PR valent mieux qu'une
  grosse.
- **Avant de committer :** `npm test` et `npm run lint:mort` des deux côtés, et
  pour tout changement d'interface, une **vérification au navigateur**.
- **Messages de commit en français** : une ligne à l'impératif, puis un corps
  qui explique le **quoi et le pourquoi**.

## Vérification

```bash
cd backend  && npm test && npm run lint:mort && npm run typecheck
cd frontend && npm test && npm run lint:mort && npm run typecheck && npm run build
```

**Vérification au navigateur** (Chromium et Playwright préinstallés). Servir le
frontend compilé par le backend, puis piloter en headless :

```bash
cd frontend && npm run build
cd ../backend && MDF_JWT_SECRET=$(openssl rand -hex 32) \
  MDF_DATA_DIR=/tmp/mdf-demo \
  MDF_STATIC_DIR=../frontend/dist/frontend/browser \
  MDF_PUBLIC_URL=http://127.0.0.1:8099 npx tsx src/server.ts
```

Il n'y a **pas de jeu de démonstration** : l'amorçage crée une instance vierge,
et le premier compte est gérant.

Trois pièges déjà rencontrés, à ne pas réintroduire :

1. **Le serveur lit l'index une seule fois au démarrage.** Après une
   recompilation du frontend, redémarrer le service, sinon il sert un index qui
   référence des fichiers disparus (page blanche).
2. **La politique de sécurité de contenu interdit les gestionnaires inline.**
   L'optimisation `inlineCritical` d'Angular en pose un : elle est désactivée.
3. **La base de l'application est absolue** (`<base href="/">`, réécrite par le
   serveur si `MDF_BASE_HREF` change). Une base relative casse tout
   rechargement sur une route imbriquée.

## Déploiement (rappels)

- **Secret JWT obligatoire** : `MDF_JWT_SECRET`, 32 caractères minimum. Absent
  ou trop court, le service refuse de démarrer et dit où corriger.
- **`MDF_PUBLIC_URL` obligatoire dès qu'un relais SMTP est configuré** : les
  liens des courriels sont absolus.
- **Aucun appel réseau sortant**, en dehors du relais SMTP. Polices et icônes
  sont dans le dépôt, jamais sur un CDN.
- Sauvegarde et restauration : `deploy/lxc/sauvegarde.sh` et
  `restauration.sh`, documentées dans `docs/sauvegarde-restauration.md`.
