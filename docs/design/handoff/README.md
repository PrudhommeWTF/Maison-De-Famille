# Handoff : Maison de Famille — version Bootstrap 5.3

## Vue d'ensemble

Application auto-hébergeable de gestion d'un ou plusieurs biens familiaux (résidences secondaires),
détenus en **indivision**, via une **SCI**, ou **en nom propre**, avec ou sans **location saisonnière**.
Elle remplace le calendrier Excel centralisé par une personne (la gérante) : demandes de séjour,
arbitrage, dépenses et répartition, entretien, documents et codes, décisions collectives, souvenirs.

Le principe structurant : **le bien est le pivot de toute l'expérience**. Une barre de contexte
permanente sélectionne le bien (ou la vue consolidée « Tous les biens ») et l'intégralité de la
navigation et des contenus suit ce choix.

Périmètre fonctionnel de référence : équivalent au service SaaS mamaisondefamille.com,
étendu au multi-structure (indivision / SCI / nom propre) et à l'ajout-retrait de biens.

## Choix technique : Bootstrap 5.3, thémé par variables

La maquette est construite **à 100 % sur Bootstrap 5.3.8**. Aucune règle de mise en page maison :
pas de flexbox custom, pas de media query, pas de grille écrite à la main. Tout vient des
composants et des utilitaires Bootstrap. Le seul CSS propre au projet est un bloc de **surcharges
de variables `--bs-*`** qui donne à Bootstrap la palette et la typographie du projet.

### Le piège de spécificité à connaître

Bootstrap 5.3 déclare une partie de ses variables **en valeur littérale à l'intérieur des règles de
composants**, pas en `var(--bs-primary)`. Exemple réel dans `bootstrap.min.css` :

```css
.btn-primary { --bs-btn-bg: #0d6efd; --bs-btn-border-color: #0d6efd; … }
.nav-pills   { --bs-nav-pills-link-active-bg: #0d6efd; … }
```

Une propriété personnalisée définie **sur l'élément** l'emporte toujours sur la valeur héritée de
`:root`. Conséquence : surcharger `--bs-primary` dans `:root` ne change **ni** la couleur des
boutons **ni** celle des pills actives. Il faut surcharger au niveau du composant :

```css
.btn-primary { --bs-btn-bg: #b0603f; --bs-btn-border-color: #b0603f; … }
.nav-pills   { --bs-nav-pills-link-active-bg: #24201b; … }
```

C'est la raison d'être de la moitié du bloc de thème de la maquette. **En production, ne reproduisez
pas ce contournement** : compilez Bootstrap depuis Sass avec vos variables (voir plus bas).

### Recommandation pour le vrai projet : compiler depuis Sass

```scss
// theme.scss
$primary:   #b0603f;
$success:   #7a8b5c;
$info:      #4a6572;
$warning:   #a5813f;
$body-bg:   #f2ede5;
$body-color:#24201b;
$border-color: #e4dcd1;
$border-radius:    .625rem;
$border-radius-sm: .5rem;
$border-radius-lg: 1rem;
$font-family-sans-serif: 'Instrument Sans', system-ui, sans-serif;
$headings-font-family:   'Bricolage Grotesque', system-ui, sans-serif;
$font-size-base: .9375rem;

@import "bootstrap/scss/bootstrap";
```

Avantages sur la surcharge de variables par-dessus le CSS compilé : plus aucun problème de
spécificité, les variantes dérivées (`-subtle`, `-emphasis`, états hover/active, focus ring) sont
recalculées automatiquement et cohérentes, et vous ne livrez que les composants importés.

Installation : `npm i bootstrap@5.3 bootstrap-icons`. Le JS de Bootstrap n'est requis que pour
l'accordéon des rôles — le reste des interactions est piloté par l'état applicatif (voir plus bas).

## À propos des fichiers de design

Les fichiers de ce dossier sont des **références de design réalisées en HTML** : un prototype qui
montre l'apparence et le comportement attendus, **pas du code de production à copier tel quel**.

Le travail consiste à **recréer ces écrans dans l'environnement du projet cible** avec ses
conventions et son routage. Si aucun environnement n'existe encore, choisir une pile adaptée à une
application auto-hébergeable (Next.js ou SvelteKit + Postgres, ou Laravel/Rails pour un monolithe
simple à héberger) puis y implémenter les écrans **avec Bootstrap 5.3 compilé depuis Sass**.

Le prototype utilise un moteur de composants maison (`.dc.html` + `support.js`) qui n'a pas à être
reproduit. En revanche **le balisage Bootstrap du prototype est directement réutilisable** : classes,
structure des composants, ordre des éléments. C'est le principal intérêt de cette version.

## Fidélité

**Haute fidélité (hifi).** Palette, typographies, rayons, densité et états sont définitifs. Les
libellés en français sont ceux à utiliser. Deux réserves :

- Les données affichées sont des données de démonstration (famille Prudhomme, deux biens).
- Les photos sont des emplacements vides (`<image-slot>`) à remplacer par un vrai téléversement.

## Architecture de l'expérience

```
navbar  (marque, bascule Bureau/Mobile, bouton de notes, dropdown utilisateur)   z-index 1040
└─ barre de contexte du bien  ← PIVOT : nav-pills « Tous les biens | Kerloc'h | Les Arcs »  z 1020
   └─ container-fluid > row : col-sm-auto (latérale 230 px, sticky) | col (contenu)
      ├─ Portefeuille (toujours visible)
      │   ├─ Tableau de bord
      │   └─ Biens gérés
      └─ Bloc au nom du bien (visible seulement si un bien est sélectionné)
          ├─ Séjours : Calendrier, Demandes (badge)
          ├─ Argent : Dépenses, Soldes, Location saisonnière (si activée sur ce bien)
          ├─ Maison : Carnet d'entretien, Fiche du bien, Coffre-fort
          └─ Famille : Décisions & votes, Souvenirs, Membres & quotes-parts
```

Règles de portée :

- En vue « Tous les biens », seuls le **Tableau de bord consolidé** et **Biens gérés** sont
  accessibles ; toute autre route redirige vers le tableau de bord.
- En vue d'un bien, tous les contenus sont filtrés sur ce bien : calendrier, demandes (et le badge),
  dépenses et total, soldes, tâches, documents, codes, détenteurs, séjours à venir, album.
- La **location saisonnière** n'apparaît que sur un bien dont le module est activé (ici Kerloc'h).
- Les **règles de décision** dépendent de la structure : indivision → majorité des deux tiers
  (unanimité pour vendre) ; SCI → assemblée générale selon les statuts ; nom propre → décision du
  propriétaire, aucun vote.

## Inventaire des composants Bootstrap utilisés

| Zone | Composants et utilitaires |
| --- | --- |
| En-tête | `navbar`, `navbar-brand`, `btn-group` (bascule d'aperçu), `dropdown` + `dropdown-menu-end` + `dropdown-header` + `dropdown-divider` |
| Barre de contexte | `nav nav-pills`, `bg-body-tertiary`, `position-sticky` |
| Navigation latérale | `nav nav-pills flex-column`, `badge rounded-pill`, `position-sticky` |
| Structure | `container-fluid`, `row`/`col`, `row-cols-*`, `g-3`, `d-flex`, `gap-*`, `flex-wrap` |
| Cartes | `card`, `card-body`, `card-title`, `h-100`, `ratio` (bandeaux photo) |
| Listes | `list-group list-group-flush`, `list-group-item`, `list-group-item-action` |
| Tableaux | `table table-hover align-middle`, `table-responsive`, `thead` |
| Statuts | `badge rounded-pill`, `text-bg-light`, `border-*-subtle`, `text-*-emphasis` |
| Alertes | `alert alert-primary`, `alert alert-success` |
| Votes | `progress-stacked` + `progress` + `progress-bar` |
| Formulaires | `form-control`, `form-select`, `form-label`, `form-text`, `form-check-input`, `input type=date` |
| Onglets | `nav nav-tabs` (demandes), `nav nav-justified` (barre mobile) |
| Divulgation | `accordion accordion-flush` + `collapse` (rôles), `offcanvas offcanvas-end` + `offcanvas-backdrop` (notes) |
| Typo et espacement | `h1`–`h6`, `display-6`, `fs-*`, `small`, `fw-medium`, `text-body-secondary`, `text-secondary-emphasis`, `lh-lg`, `m*`/`p*` |

Trois classes utilitaires maison seulement, toutes justifiées :
`.eyebrow` (libellé de section capitales, répété une trentaine de fois), `.tnum`
(`font-variant-numeric: tabular-nums`, absent des utilitaires Bootstrap) et `.cal-cell` /
`.cal-dashed` (hauteur minimale de cellule de calendrier et bordure tiretée, absente aussi).

## Écrans

Chaque écran est identifié dans le prototype par `data-screen-label`.

### 1. Tableau de bord — portefeuille (vue « Tous les biens »)

`h1` + sous-titre, puis `row row-cols-1 row-cols-md-2 g-3` de deux cartes de biens cliquables
(`card` + `ratio` 38 % pour la photo, `card-body` avec titre, type de bien en `text-*-emphasis`,
puce de structure en `badge rounded-pill text-bg-light border`, puis trois statistiques séparées par
`border-top mt-3 pt-3`). Ensuite `row row-cols-1 row-cols-md-2 row-cols-xl-3 g-3` de trois cartes :

- **Ce qui vous attend** — `list-group-item-action` par ligne, icône + titre + sous-ligne.
- **Trésorerie** — titre de structure, montant en `display-6 tnum`, lignes clé/valeur en `list-group`.
- **Prochains séjours** — plage de dates `tnum` de largeur fixe + nom + lieu.

### 2. Tableau de bord — dossier d'un bien

Remplace les cartes de portefeuille par une **carte de résumé** : quatre statistiques
(Prochain séjour, Occupation, À traiter, Dépenses 2026) en `d-flex flex-wrap gap-4` et trois boutons
`btn-sm btn-outline-secondary` (Calendrier, Demandes, Fiche). Les trois mêmes cartes suivent,
filtrées sur le bien.

### 3. Biens gérés

- En-tête + `btn btn-primary` « Ajouter un bien » / « Fermer le formulaire ».
- **Formulaire d'ajout** : `row row-cols-1 row-cols-md-3 g-2` de trois cartes de choix du mode de
  détention ; la carte choisie prend `border-primary border-2 text-primary`. Puis quatre champs
  (`form-control`, `form-select`) et les actions.
- **Liste des biens** : une `card` par bien, trois `badge rounded-pill` (structure, détenteurs,
  majorité), note de contexte, et `btn-outline-secondary` « Ouvrir le dossier » + `btn-link`
  « Retirer ce bien ».
- **Retrait en deux temps** : le lien affiche un `alert alert-primary` expliquant que le retrait
  **archive** et n'efface rien, avec « Retirer » / « Garder » ; l'état archivé affiche un badge
  « Archivé » et « Réactiver ».

### 4. Calendrier d'occupation

- `alert alert-primary` de conflit, **conditionnel** : seulement si le bien affiché a un
  chevauchement réel et non arbitré.
- Carte du mois : `btn-sm btn-outline-secondary` + chevrons `bi-chevron-left/right`, libellé du mois,
  légende à quatre entrées (carrés `bg-*-subtle border border-*-subtle`).
- Grille : `row row-cols-7 g-1` par semaine, cellules `.cal-cell rounded-2 p-2` avec la classe de
  nature. Couleurs par nature : famille `bg-primary-subtle`, location `bg-success-subtle`,
  demande `border border-primary .cal-dashed`, entretien `bg-info-subtle`, libre `bg-body border`.
  Le libellé du séjour n'apparaît **que le premier jour** de la plage (`text-truncate`).
  Convention : nuit d'arrivée incluse, nuit de départ exclue (rotation possible le même jour).
- **Séjours du mois** : `table table-hover` — dates, qui, détail, badge de nature.

### 5. Demandes de séjour

`nav nav-tabs` à deux onglets :

- **File d'attente** : une `card` par demande (nom, bien, dates + nuits + personnes, note libre,
  `alert alert-primary` si conflit) ; à droite `btn-primary` « Valider le séjour » et
  `btn-outline-secondary` « Proposer d'autres dates ». Après décision : badge d'état + `btn-link`
  « Annuler la décision ».
- **Tour de choix — Été 2026** : `table` des vœux (indivisaire, 1ᵉʳ choix, 2ᵉ choix, quota),
  bouton « Lancer l'arbitrage », puis carte « Règles de la saison » en liste à puces.

### 6. Dépenses & répartition

- **Règles de répartition** : `list-group` d'une ligne par catégorie, avec un
  `btn-sm btn-outline-secondary rounded-pill` qui cycle entre « Quotes-parts », « Nuits occupées »,
  « Parts égales par foyer ».
- **Liste des dépenses** : `table table-hover` — date, libellé, bien, avancé par, badge de règle,
  montant `text-end tnum`. En-tête « Dépenses 2026 · <total calculé> » + `btn-sm btn-primary`.
- Le total de l'en-tête, la statistique « Dépenses 2026 » du tableau de bord et la ligne de
  trésorerie sont **dérivés de la même liste filtrée**. Une dépense « les deux biens » compte pour
  moitié dans chaque dossier et en totalité en vue consolidée.

### 7. Soldes & remboursements

`row row-cols-1 row-cols-sm-2 row-cols-xl-4 g-3` de cartes par personne (avatar initiales, nom,
solde en `fs-3 tnum` avec `text-success-emphasis` ou `text-primary`, motif). Puis `table` des
virements proposés (A → B, motif, montant, statut) et `btn-sm btn-primary` « Générer l'appel de
fonds ». Le vocabulaire suit la structure : régularisation d'indivision d'un côté, comptes courants
d'associés et appels de fonds de la SCI de l'autre.

### 8. Location saisonnière (bien concerné uniquement)

Quatre cartes d'indicateurs (dont une `progress` pour les semaines louées), `table` des réservations
avec badge de statut, et deux cartes explicatives (répartition des loyers, accès locataire).

### 9. Carnet d'entretien

`list-group` de tâches avec `form-check-input` ; une tâche cochée passe en
`text-decoration-line-through text-body-secondary` et garde son badge de nature. Puis deux cartes :
**Récurrences** (`list-group`) et **Checklist de départ** (liste à puces).

### 10. Fiche du bien

`ratio` 26 % pour la photo principale (emplacement dédié par bien), titre + adresse,
`btn-outline-secondary` « Modifier la fiche », puis trois cartes : **Caractéristiques**
(`list-group` clé/valeur), **Guide d'arrivée** (clé en gras + texte), **Inventaire** + bouton
« Signaler une casse ». Tout le contenu dépend du bien sélectionné.

### 11. Coffre-fort

Deux colonnes : **Documents** (`list-group`, vignette d'extension, nom, méta, badge de portée) avec
bouton « Déposer » ; **Codes & accès** (`list-group`, valeur en `font-monospace`) avec bouton
« Afficher » / « Masquer ». Sous-titre et note de bas de carte dépendent de la structure. Chaque
document porte un rattachement explicite : `mer`, `mont` ou `both`.

### 12. Décisions & votes

- **Indivision** : carte de vote ouvert — date de clôture, objet, badge de structure et de majorité,
  `progress-stacked` (pour en `bg-success`, contre en `bg-primary`), `list-group` du dépouillement,
  seuil, puis `btn-success` / `btn-primary` selon la voix exprimée et un texte d'aide.
- **SCI** : pas de vote — carte « Aucun vote ouvert sur ce bien », rappel des statuts, prochaine
  assemblée, boutons « Convoquer l'assemblée » et « Voir les statuts ».
- **Historique** : `table` — date, objet, majorité requise, badge de résultat.

### 13. Souvenirs

En-tête d'album propre au bien, puis `row row-cols-2 row-cols-md-3 row-cols-xl-4 g-3` de vignettes
`ratio ratio-4x3`, avec des **identifiants d'emplacement distincts par bien** (une photo déposée sur
un bien ne doit pas apparaître dans l'album de l'autre). Carte de pied : albums archivés et livre d'or.

### 14. Membres & quotes-parts

Une `card` **par structure** (seule celle du bien ouvert, les deux en vue consolidée) : titre,
sous-titre, badge de majorité, puis `table table-hover` — détenteur (avatar + foyer), badge de rôle,
quote-part ou parts, nuits consommées. Puis deux cartes : **rôles** en `accordion accordion-flush`
(gérant, détenteur, membre de foyer, invité) et **Accès temporaires** (`list-group` + bouton
« Inviter »).

### 15. Écrans mobiles

Cadre 390 px (`border border-4 border-dark rounded-5 shadow-lg`), `nav nav-justified` en bas :

1. **Accueil** : salutation, carte du séjour à venir (`ratio` + deux boutons), carte de solde
   personnel, carte de vote en cours.
2. **Calendrier** : liste des séjours du mois, barre de couleur de nature à gauche.
3. **Demander** : `btn-group` de choix du bien, deux `input type="date"`, occupants avec
   `form-text` de capacité, `alert alert-success` de disponibilité, bouton pleine largeur.

### Panneau de notes de comportement

`offcanvas offcanvas-end` déclenché depuis la navbar, listant les règles fonctionnelles de l'écran
courant : règles de conflit, majorités, portées d'accès, quotas. **À lire avant d'implémenter chaque
écran** ; ce panneau n'a pas à être reproduit dans le produit final.

## Interactions & comportement

| Interaction | Effet attendu |
| --- | --- |
| Barre de contexte | Change le bien courant ; réinitialise sur le tableau de bord ; à mémoriser par utilisateur |
| Carte de bien / « Ouvrir le dossier » | Entre dans le dossier du bien |
| Navigation latérale | Route interne ; l'entrée active reçoit `.active` |
| Badge de demandes | Nombre de demandes en attente **du bien courant** |
| Valider / Proposer d'autres dates | Crée le séjour et notifie, ou renvoie la demande avec un message ; décision horodatée et réversible |
| Pastille de règle de répartition | Cycle entre les trois règles ; n'affecte pas les dépenses passées |
| Case de tâche | Demande une date de réalisation et accepte une facture |
| Afficher / Masquer les codes | L'affichage d'un code est journalisé (auteur, horodatage) |
| Pour / Contre | Voix pondérée par la quote-part, modifiable jusqu'à la clôture |
| Navigation de mois | Change le mois affiché ; les données du bien suivent |
| Retirer un bien | Confirmation puis archivage réversible, aucune donnée supprimée |
| Bascule Bureau / Mobile | Dispositif de présentation du prototype uniquement |

### Composants interactifs : état applicatif plutôt que data-api

Dans le prototype, **le dropdown utilisateur et l'offcanvas des notes sont pilotés par l'état** (la
classe `show` est posée par le rendu), pas par les attributs `data-bs-toggle`. Raison : le data-api
de Bootstrap manipule le DOM directement, ce que le re-render du composant écrase.

Cela vous concerne dans toute pile à rendu déclaratif (React, Vue, Svelte) : préférez un wrapper
(react-bootstrap, bootstrap-vue-next, sveltestrap) ou l'API JS (`bootstrap.Dropdown`) instanciée
au montage, plutôt que les attributs `data-bs-*`. Dans une pile à rendu serveur (Rails, Laravel,
Django), les `data-bs-*` fonctionnent normalement.

Deux détails hérités de ce choix, à ne pas reproduire ailleurs : `data-bs-popper="static"` sur le
`dropdown-menu` (aligne le menu à droite sans Popper), et la navbar en `z-index: 1040` pour passer
au-dessus de la barre de contexte (`1020`).

## État applicatif

- `bien` : `'all' | <id de bien>` — **contexte global**, mémorisé par utilisateur.
- `screen` : route courante ; contrainte à `dash | biens` quand `bien === 'all'`.
- `month` : mois affiché du calendrier.
- `reqTab` : `'valider' | 'tour'`.
- `decisions` : état par demande (`pending | approved | refused`).
- `rules` : règle de répartition par catégorie de dépense.
- `tasks` : achèvement par tâche.
- `codes` : codes révélés ou masqués.
- `vote` : voix de l'utilisateur sur le scrutin ouvert.
- `addBien`, `newStructure`, `bienState` : formulaire d'ajout et cycle retrait/archivage.
- `notes`, `userMenu` : ouverture de l'offcanvas et du dropdown.
- Valeurs **dérivées** (ne jamais dupliquer) : nombre de demandes en attente, total des dépenses,
  existence d'un conflit de dates, liste des structures et des détenteurs du bien.

### Modèle de données suggéré

```
Bien(id, nom, commune, couchages, type, structure_id, location_activee, archive_le)
Structure(id, mode: indivision|sci|nom_propre, nom, regle_majorite, notes)
Detenteur(structure_id, personne_id, role: gerant|detenteur, quote_part | parts)
Personne(id, nom, foyer_id, role_app: gerant|detenteur|membre_foyer|invite)
Foyer(id, nom, membres[])
Sejour(bien_id, demandeur_id, du, au, occupants, nature: famille|location|entretien, statut)
Voeu(bien_id, personne_id, saison, choix_1, choix_2)          -- tour de choix
Depense(bien_id | 'both', date, libelle, categorie, montant, avancee_par, justificatif)
RegleRepartition(bien_id, categorie, regle: quotes_parts|nuits|parts_egales)
Solde(structure_id, personne_id, montant)  -- dérivé
Reservation(bien_id, locataire, du, au, prix, statut)
Tache(bien_id, libelle, echeance, recurrence, faite_le, facture)
Document(bien_id | 'both', nom, type, portee: detenteurs|membres|locataire, version)
Code(bien_id, libelle, valeur_chiffree, portee)
Decision(structure_id, objet, majorite_requise, ouverture, cloture, resultat)
Voix(decision_id, personne_id, valeur, poids)
Photo(bien_id, album, auteur_id, fichier)
```

Contraintes métier à implémenter côté serveur : chevauchement de plages et capacité du bien,
seuils de majorité selon la structure, portée des documents et des codes selon le rôle et la
période du séjour, quota de nuits par foyer et saison, archivage non destructif d'un bien.

## Thème : le bloc de variables à reprendre

Palette source, à passer en variables Sass (voir plus haut) ou, à défaut, en surcharges de
variables de composants comme dans le prototype :

| Rôle | Valeur | Variable Bootstrap |
| --- | --- | --- |
| Accent principal | `#b0603f` (survol `#98502f`, actif `#8d4a2e`) | `$primary` |
| Positif / location | `#7a8b5c` | `$success` |
| Information / entretien | `#4a6572` | `$info` |
| Attention | `#a5813f` | `$warning` |
| Fond d'application | `#f2ede5` | `$body-bg` |
| Encre principale | `#24201b` | `$body-color` |
| Encre secondaire | `#6b6157` | `--bs-secondary-color` |
| Encre tertiaire | `#4a443c` | `--bs-secondary-text-emphasis` |
| Surface de carte | `#fffdf9` | `--bs-card-bg` |
| Bordure | `#e4dcd1` | `$border-color` |
| Séparateur de liste et de tableau | `#efe8de` | `--bs-list-group-border-color`, `--bs-table-border-color` |
| Bordure de contrôle | `#d9cfc2` | `.form-control`, `.btn-outline-secondary` |
| Fond actif de navigation | `#e6ded1` | `$secondary-bg` |
| Fond de barre de contexte | `#eae3d8` | `$tertiary-bg` |
| Survol de liste | `#f5efe6` | `--bs-list-group-action-hover-bg`, `--bs-table-hover-bg` |
| Libellés de section | `#5f564c` | `.eyebrow` |

Variantes subtiles (badges, cellules de calendrier, alertes) : `-bg-subtle`, `-border-subtle`,
`-text-emphasis` de chaque couleur — recalculées automatiquement si vous compilez depuis Sass.

**Typographie** — deux familles Google Fonts :

- Titres : **Bricolage Grotesque** 500, `letter-spacing: -.015em` (`$headings-font-family`).
- Interface et texte : **Instrument Sans** 400/500/600 (`$font-family-sans-serif`),
  base `.9375rem` (`$font-size-base`).
- Montants et dates : `.tnum` (`font-variant-numeric: tabular-nums`).

**Rayons** : `$border-radius: .625rem`, `-sm: .5rem`, `-lg: 1rem`. Cartes en `rounded-3`/`rounded-4`,
badges en `rounded-pill`, avatars en `rounded-circle`.

Tous les textes respectent un contraste ≥ 4,5:1 sur `#fffdf9` ; ne pas éclaircir les encres.
Attention en particulier à `.btn-outline-secondary` : le gris Bootstrap par défaut (`#6c757d`)
tombe sous le seuil sur ce fond, d'où la surcharge à `#4a443c`.

## Assets

- **Polices** : Bricolage Grotesque et Instrument Sans (Google Fonts).
- **Icônes** : **Bootstrap Icons 1.11.3** (`npm i bootstrap-icons`). Icônes utilisées : `houses`,
  `house-heart`, `house-door`, `calendar3`, `calendar-plus`, `chevron-left`, `chevron-right`,
  `envelope-paper`, `receipt`, `arrow-left-right`, `arrow-right`, `key`, `tools`,
  `journal-bookmark`, `journal-text`, `shield-lock`, `hand-thumbs-up`, `hand-thumbs-down`,
  `images`, `people`, `person`, `person-plus`, `building`, `diagram-3`, `geo-alt`, `wallet2`,
  `suitcase-lg`, `bell`, `water`, `triangle`, `snow`, `file-earmark-text`, `signpost-split`,
  `list-check`, `box-arrow-in-right`, `display`, `phone`, `plus-circle`, `pencil`, `check2`,
  `exclamation-circle`, `exclamation-triangle`, `dot`.
- **Photos** : aucune. Les emplacements `<image-slot>` matérialisent les zones à alimenter (cartes de
  biens, photo principale de fiche, album de souvenirs, en-tête mobile). Prévoir un téléversement
  avec vignettes générées côté serveur, stockées sur l'instance.

## Fichiers

| Fichier | Contenu |
| --- | --- |
| `Maison de Famille Bootstrap.dc.html` | **La référence.** 14 écrans bureau, 3 écrans mobiles, notes de comportement, 100 % Bootstrap 5.3.8 |
| `Maison de Famille.dc.html` | Version précédente, CSS maison — utile seulement pour comparer les intentions visuelles |
| `support.js` | Moteur du prototype — **ne pas porter** |
| `image-slot.js` | Emplacement photo du prototype — **ne pas porter** |
| `github.md` | Association au dépôt `PrudhommeWTF/Maison-De-Famille` |

Pour lire le prototype : ouvrir `Maison de Famille Bootstrap.dc.html` dans un navigateur, parcourir
chaque bien via la barre de contexte, et ouvrir le panneau « Notes de comportement » sur chaque écran.
