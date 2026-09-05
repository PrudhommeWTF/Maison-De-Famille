# Handoff : Maison de Famille — gestion de biens familiaux

## Vue d'ensemble

Application auto-hébergeable de gestion d'un ou plusieurs biens familiaux (résidences secondaires),
détenus en **indivision**, via une **SCI**, ou **en nom propre**, avec ou sans **location saisonnière**.
Elle remplace le calendrier Excel centralisé par une personne (la gérante) : demandes de séjour,
arbitrage, dépenses et répartition, entretien, documents et codes, décisions collectives, souvenirs.

Le principe structurant : **le bien est le pivot de toute l'expérience**. Une barre de contexte
permanente sélectionne le bien (ou la vue consolidée « Tous les biens ») et l'intégralité de la
navigation et des contenus suit ce choix.

Périmètre fonctionnel de référence : équivalent au service SaaS mamaisondefamille.com
(planning d'occupation avec détection de conflits, dépenses partagées et remboursements,
carnet d'entretien, coffre-fort de documents et codes, albums photo, rôles différenciés),
étendu au multi-structure (indivision / SCI / nom propre) et à l'ajout-retrait de biens.

## À propos des fichiers de design

Les fichiers de ce dossier sont des **références de design réalisées en HTML** : un prototype qui
montre l'apparence et le comportement attendus, **pas du code de production à copier tel quel**.

Le travail consiste à **recréer ces écrans dans l'environnement du projet cible** (React, Vue,
Svelte, Rails + Hotwire, etc.) avec ses conventions, sa bibliothèque de composants et son routage.
Si aucun environnement n'existe encore, choisir la pile la plus adaptée à une application
auto-hébergeable (par exemple Next.js ou SvelteKit + Postgres, ou Laravel/Rails si l'on préfère un
monolithe simple à héberger) puis y implémenter les écrans.

Le prototype utilise un moteur de composants maison (`Maison de Famille.dc.html` + `support.js`)
qui n'a pas à être reproduit : seuls comptent la mise en page, les valeurs de style, les états et
les comportements décrits ci-dessous.

## Fidélité

**Haute fidélité (hifi).** Couleurs, typographies, espacements, rayons et états sont définitifs et
doivent être reproduits fidèlement. Les libellés en français sont ceux à utiliser.
Deux réserves :

- Les données affichées sont des données de démonstration (famille Prudhomme, deux biens).
- Les photos sont des emplacements vides (`<image-slot>`) à remplacer par un vrai téléversement.

## Architecture de l'expérience

```
En-tête global (identité, bascule Bureau/Mobile, panneau de notes, utilisateur courant)
└─ Barre de contexte du bien  ← PIVOT : « Tous les biens » | Kerloc'h | Les Arcs
   └─ Grille : navigation latérale 236 px | contenu
      ├─ Portefeuille (toujours visible)
      │   ├─ Tableau de bord
      │   └─ Biens gérés
      └─ Bloc au nom du bien (visible seulement si un bien est sélectionné)
          ├─ Séjours : Tableau de bord du bien, Calendrier, Demandes (badge)
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

## Écrans

Chaque écran est identifié dans le prototype par `data-screen-label`.

### 1. Tableau de bord — portefeuille (vue « Tous les biens »)

**But** : voir l'ensemble des biens et entrer dans un dossier.

**Layout** : colonne, `gap: 22px`, `max-width: 1080px`, `padding: 26px 30px 70px`.

1. Titre `h1` « Bonjour Hélène » + sous-titre.
2. Grille de cartes de biens : `repeat(auto-fit, minmax(300px, 1fr))`, `gap: 16px`.
   Carte : fond `#fffdf9`, bordure `1px solid #e4dcd1`, rayon 16, `overflow: hidden`, cliquable
   (survol : bordure `#b0603f`) ; bandeau photo 132 px ; corps `padding: 16px 18px 18px` avec nom
   (18 px Bricolage Grotesque 500), type de bien coloré (mer `#7a8b5c`, montagne `#4a6572`),
   commune + couchages + location, puce de structure (`#f2ede5`, rayon 20, 11,5 px), puis trois
   statistiques séparées par une ligne `1px solid #efe8de`.
3. Grille de trois cartes : `repeat(auto-fit, minmax(280px, 1fr))`.
   - **Ce qui vous attend** : liste de lignes-boutons (icône + titre 13,5 px + sous-ligne 12 px),
     survol `#f5efe6`, `padding: 10px 8px`, `margin: 0 -8px`, rayon 9.
   - **Trésorerie** : titre de structure, montant 30 px, sous-ligne, puis lignes clé/valeur 13 px.
   - **Prochains séjours** : plage de dates (12 px, largeur 74 px, chiffres tabulaires) + nom + lieu.

### 2. Tableau de bord — dossier d'un bien

Remplace les cartes de portefeuille par :

1. `h1` = nom du bien, sous-titre = nombre de demandes en attente (dérivé, jamais codé en dur).
2. **Carte de résumé** : quatre statistiques (Prochain séjour, Occupation, À traiter, Dépenses 2026)
   en `display: flex; gap: 30px; flex-wrap: wrap`, et trois boutons d'accès rapide
   (Calendrier, Demandes, Fiche) à droite.
3. Les trois mêmes cartes (attentes, trésorerie, prochains séjours), filtrées sur le bien.

### 3. Biens gérés

**But** : ajouter, ouvrir, archiver un bien ; c'est l'écran qui porte la notion de structure.

- En-tête avec bouton primaire « Ajouter un bien » / « Fermer le formulaire ».
- **Formulaire d'ajout** (dépliant) : trois cartes de choix du mode de détention
  (Indivision / SCI / Nom propre) avec icône, titre et description ; la carte choisie prend une
  bordure `1.5px #b0603f` et un texte `#b0603f`, les autres `1px #d9cfc2`. Puis quatre champs
  (nom, commune, couchages, location saisonnière) et les actions « Créer le bien » / « Annuler ».
- **Liste des biens** : une carte par bien avec nom, type, commune/couchages/location, trois puces
  (structure, détenteurs, règle de majorité), une note de contexte, et à droite
  « Ouvrir le dossier » (entre dans le bien) + « Retirer ce bien ».
- **Retrait en deux temps** : le lien ouvre un encart d'avertissement
  (fond `#fbf1ea`, bordure `#e7c9b6`) expliquant que le retrait **archive** et n'efface rien,
  avec « Retirer » / « Garder » ; l'état archivé affiche une pastille « Archivé » et « Réactiver ».

### 4. Calendrier d'occupation

- En-tête : `h1`, sous-titre, pas de sélecteur de bien (il est global).
- **Bannière de conflit** conditionnelle : n'apparaît que si le bien affiché a un chevauchement
  réel et non arbitré. Fond `#fbf1ea`, bordure `#e7c9b6`, rayon 12, texte 13,5 px, lien « Arbitrer ».
- **Carte du mois** : navigation `‹ Mois AAAA ›` (boutons 30×30, rayon 8) et légende à quatre
  entrées (carré 11×11, rayon 3).
- **Grille** : `repeat(7, minmax(0,1fr))`, `gap: 5px` ; en-têtes de jours 10,5 px capitales
  `#5f564c` ; cellules `min-height: 74px`, rayon 9, `padding: 7px 8px`, numéro 12 px, libellé du
  séjour 11 px affiché **uniquement le premier jour** de la plage, `text-overflow: ellipsis`.
  Couleurs de cellule par nature : famille `#f0e0d5` / bordure `#ddc3b0` / encre `#8d4a2e` ;
  location `#e4e9dc` / `#c3cfb1` / `#556340` ; demande `#fffdf9` / bordure **tiretée** `#b0603f` ;
  entretien `#e5e8ea` / `#c3ccd1` / `#3f545f` ; libre `#fffdf9` / `#efe8de`.
  Convention : nuit d'arrivée incluse, nuit de départ exclue (rotation possible le même jour).
- **Séjours du mois** : lignes plage / nom / détail / pastille de nature.

### 5. Demandes de séjour

Deux onglets (`#e9e2d7`, pastille active `#fffdf9`) :

- **File d'attente** : une carte par demande — nom, bien, dates + nuits + personnes, note libre,
  encart d'alerte si conflit ; à droite « Valider le séjour » (primaire) et
  « Proposer d'autres dates ». Après décision : pastille d'état
  (validé `#e4e9dc`/`#556340`, à revoir `#f2ede5`/`#6b6157`) + lien « Annuler la décision ».
- **Tour de choix — Été 2026** : tableau des vœux
  (`minmax(140px,1.1fr) minmax(120px,1fr) minmax(120px,1fr) minmax(90px,.7fr)`) —
  indivisaire, 1ᵉʳ choix, 2ᵉ choix, quota de nuits — bouton « Lancer l'arbitrage », puis une carte
  « Règles de la saison » en liste à puces.

### 6. Dépenses & répartition

- **Règles de répartition** : une ligne par catégorie avec une pastille cliquable qui cycle entre
  « Quotes-parts », « Nuits occupées », « Parts égales par foyer ». Catégories : taxe foncière,
  assurance habitation, énergie/eau/internet, ménage et linge, travaux et gros entretien,
  courses et consommables.
- **Liste des dépenses** : en-tête « Dépenses 2026 · <total calculé> » + bouton « Saisir une
  dépense » ; lignes date (64 px) / libellé / bien / « Avancé par » / pastille de règle appliquée /
  montant aligné à droite (82 px, chiffres tabulaires).
- Le total de l'en-tête, la statistique « Dépenses 2026 » du tableau de bord et la ligne de
  trésorerie doivent tous être **dérivés de la même liste filtrée**. Une dépense marquée
  « les deux biens » compte pour moitié dans chaque dossier et en totalité en vue consolidée.

### 7. Soldes & remboursements

- Grille de cartes par personne : initiales en pastille 30 px `#e6ded1`, nom, solde 25 px
  (créditeur `#556340`, débiteur `#b0603f`), motif.
- **Virements proposés** : « A → B », motif, montant, statut ; bouton « Générer l'appel de fonds ».
  L'algorithme minimise le nombre de virements.
- Le vocabulaire suit la structure : régularisation d'indivision d'un côté, comptes courants
  d'associés et appels de fonds de la SCI de l'autre.

### 8. Location saisonnière (bien concerné uniquement)

- Quatre indicateurs : loyers encaissés, semaines louées, charges déduites, net à répartir (`#7a8b5c`).
- **Réservations** : plage, locataire, personnes, prix, pastille de statut
  (soldé `#e4e9dc`/`#556340`, acompte `#f0e0d5`/`#8d4a2e`, à confirmer `#f2ede5`/`#6b6157`).
- Deux cartes explicatives : répartition des loyers, accès locataire (lien limité, sans compte).

### 9. Carnet d'entretien

- **Tâches ouvertes** : lignes-boutons avec case 19×19 (rayon 6 ; cochée : fond et bordure `#7a8b5c`,
  glyphe `✓` blanc), libellé barré et grisé `#a29889`… (utiliser `#8c8377` minimum si contraste),
  méta 12 px, pastille de nature (Obligatoire `#f0e0d5`/`#8d4a2e`, Saison `#e5e8ea`/`#3f545f`,
  Courant et Inventaire `#f2ede5`/`#6b6157`).
- **Récurrences** : libellé + périodicité.
- **Checklist de départ** : liste à puces, envoyée la veille de la fin de séjour.

### 10. Fiche du bien

- Photo principale 250 px, rayon 18 (emplacement dédié par bien).
- Titre = nom du bien, sous-titre = adresse et historique de détention ; bouton « Modifier la fiche ».
- Trois cartes : **Caractéristiques** (lignes clé/valeur), **Guide d'arrivée** (clé en gras + texte),
  **Inventaire** (libellé + état) avec bouton « Signaler une casse » qui crée une tâche d'entretien.
- Tout le contenu dépend du bien sélectionné (Les Arcs a ses propres caractéristiques, guide et
  inventaire : local à skis, navette, charges de copropriété).

### 11. Coffre-fort

- Deux colonnes : **Documents** (vignette d'extension 30×34, nom, méta, pastille de portée) avec
  bouton « Déposer » ; **Codes & accès** (libellé, bien, valeur en 14 px `letter-spacing: .06em`)
  avec bouton « Afficher » / « Masquer ».
- Sous-titre et note de bas de carte dépendent de la structure (statuts de SCI et règlement de
  copropriété d'un côté, convention d'indivision et boîte à clés de l'autre).
- Chaque document porte un rattachement explicite au bien : `mer`, `mont` ou `both`
  (par exemple la déclaration de revenus fonciers vaut pour les deux).

### 12. Décisions & votes

- **Indivision** : carte de vote ouvert avec date de clôture, objet, puce de structure et règle de
  majorité, barre de dépouillement (pour `#7a8b5c`, contre `#b0603f`, reste `#efe8de`), trois lignes
  pour/contre/en attente, seuil affiché, boutons « Pour » / « Contre » (l'option choisie se remplit,
  texte `#fffdf9`) et un texte d'aide indiquant le poids de la voix.
- **SCI** : pas de vote — carte « Aucun vote ouvert sur ce bien », rappel des statuts, prochaine
  assemblée, boutons « Convoquer l'assemblée » et « Voir les statuts ».
- **Historique** : date, objet, majorité requise, pastille de résultat.

### 13. Souvenirs

- En-tête d'album (titre + volumétrie) propre au bien.
- Grille `repeat(auto-fill, minmax(190px, 1fr))`, `gap: 12px`, vignettes en ratio 4/3, rayon 12,
  **identifiants d'emplacement distincts par bien** (une photo déposée sur un bien ne doit pas
  apparaître dans l'album de l'autre).
- Carte de pied : albums archivés par année et livre d'or.

### 14. Membres & quotes-parts

- Un bloc **par structure** (seule celle du bien ouvert, les deux en vue consolidée) : titre,
  sous-titre, pastille de règle de majorité, puis une ligne par détenteur — avatar initiales 34 px,
  nom + foyer, pastille de rôle (gérant `#f0e0d5`/`#8d4a2e`, autres `#f2ede5`/`#4a443c`),
  quote-part ou nombre de parts, nuits consommées sur l'exercice.
- Carte **« Ce que chaque rôle peut faire »** : gérant, détenteur, membre de foyer, invité.
- Carte **Accès temporaires** : locataires et invités avec échéance, bouton « Inviter ».

### 15. Écrans mobiles

Cadre 390 px, bordure `10px solid #24201b`, rayon 38, barre d'onglets basse à trois entrées
(icône 17 px + libellé 11 px, actif `#b0603f`, inactif `#5f564c`) :

1. **Accueil** : salutation, carte du séjour à venir avec photo et deux boutons
   (Guide d'arrivée, Codes), carte de solde personnel, carte de vote en cours.
2. **Calendrier** : liste des séjours du mois, barre de couleur de nature à gauche.
3. **Demander** : choix du bien, dates d'arrivée et de départ, occupants avec capacité
   (`5 / 8 couchages`), encart de disponibilité vert `#f4f6f0`/`#d8e0cc`, bouton d'envoi pleine largeur.

### Panneau de notes de comportement

Tiroir latéral droit 352 px déclenché depuis l'en-tête, listant les règles fonctionnelles de
l'écran courant. Utile au développement : il contient, écran par écran, les règles de conflit,
de majorité, de portée d'accès et de quotas. **À lire avant d'implémenter chaque écran** ; ce
panneau n'a pas à être reproduit dans le produit final.

## Interactions & comportement

| Interaction | Effet attendu |
| --- | --- |
| Barre de contexte | Change le bien courant ; réinitialise sur le tableau de bord ; à mémoriser par utilisateur |
| Carte de bien / « Ouvrir le dossier » | Entre dans le dossier du bien |
| Navigation latérale | Route interne ; l'entrée active reçoit un fond `#e6ded1`, rayon 8 |
| Badge de demandes | Nombre de demandes en attente **du bien courant** |
| Valider / Proposer d'autres dates | Crée le séjour et notifie, ou renvoie la demande avec un message ; décision horodatée et réversible |
| Pastille de règle de répartition | Cycle entre les trois règles ; n'affecte pas les dépenses passées |
| Case de tâche | Demande une date de réalisation et accepte une facture |
| Afficher / Masquer les codes | L'affichage d'un code est journalisé (auteur, horodatage) |
| Pour / Contre | Voix pondérée par la quote-part, modifiable jusqu'à la clôture |
| Navigation de mois | Change le mois affiché ; les données du bien suivent |
| Retirer un bien | Confirmation puis archivage réversible, aucune donnée supprimée |
| Bascule Bureau / Mobile | Dispositif de présentation du prototype uniquement |

Survols : boutons fantômes → bordure et texte `#b0603f` ; bouton primaire `#b0603f` → `#98502f` ;
lignes de liste → fond `#f5efe6` ; cartes cliquables → bordure `#b0603f`.
Aucune animation n'est requise ; transitions courtes (120–160 ms) sur couleur et bordure si souhaité.

Responsive : toutes les grilles utilisent `auto-fit`/`minmax` et `flex-wrap`, aucune largeur fixe
hors cadre mobile. La navigation latérale et la barre de contexte sont `position: sticky`
(en-tête 59 px, barre de contexte à `top: 59px`, navigation à `top: 111px`).

## État applicatif

État du prototype, à transposer en état d'application ou en données serveur :

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

## Jetons de design

**Couleurs**

| Rôle | Valeur |
| --- | --- |
| Fond d'application | `#f2ede5` |
| Fond de barre de contexte | `#eae3d8` (bordure `#ddd3c5`) |
| Surface de carte | `#fffdf9` |
| Bordure de carte | `#e4dcd1` |
| Séparateur interne | `#efe8de` |
| Bordure de contrôle | `#d9cfc2` |
| Fond de pastille neutre | `#f2ede5` |
| Fond d'élément actif | `#e6ded1` |
| Survol de liste | `#f5efe6` |
| Encre principale | `#24201b` |
| Encre secondaire | `#4a443c` |
| Encre tertiaire | `#6b6157` |
| Libellés de section | `#5f564c` |
| Accent (primaire) | `#b0603f` — survol `#98502f` |
| Accent doux / famille | `#f0e0d5`, encre `#8d4a2e` |
| Positif / location | `#e4e9dc`, `#c3cfb1`, encre `#556340`, plein `#7a8b5c` |
| Information / entretien | `#e5e8ea`, `#c3ccd1`, encre `#3f545f` |
| Alerte (fond / bordure) | `#fbf1ea` / `#e7c9b6` |
| Type de bien : mer / montagne | `#7a8b5c` / `#4a6572` |

Tous les textes respectent un contraste ≥ 4,5:1 sur `#fffdf9` ; ne pas éclaircir les encres.

**Typographie** — deux familles Google Fonts :

- Titres : **Bricolage Grotesque**, graisse 500, `letter-spacing: -.01em` à `-.02em`.
  `h1` 29 px / 1,15 ; `h2` de carte 18–20 px ; titres de bloc 17 px ; montants 25–30 px.
- Interface et texte : **Instrument Sans** 400/500/600.
  Corps 13,5 px ; secondaire 12,5 px ; méta 11,5–12 px ;
  libellés de section 10,5 px 600 capitales `letter-spacing: .1em`.
- Montants et dates : `font-variant-numeric: tabular-nums`.
- Plancher : ne pas descendre sous 11 px, et jamais pour du texte porteur d'information seul.

**Espacement** : 4 / 5 / 8 / 10 / 14 / 16 / 20 / 22 / 26 / 30 px.
Rythme des écrans : colonne `gap: 20–22px`, cartes `padding: 19–22px`, listes `padding: 12–14px 0`.

**Rayons** : 6 (case à cocher) · 8–9 (boutons, éléments de navigation) · 10–12 (encarts, champs)
· 14–16 (cartes) · 18 (photo principale) · 20 (pastilles) · 38 (cadre mobile) · 50 % (avatars).

**Ombres** : quasi absentes. `0 1px 2px rgba(36,32,27,.08)` sur la pastille active d'une bascule,
`-14px 0 40px rgba(36,32,27,.1)` sur le tiroir de notes, `0 24px 60px rgba(36,32,27,.18)` sous le
cadre mobile.

**Largeurs** : contenu `max-width: 1080px` ; navigation latérale 236 px ; tiroir de notes 352 px ;
cadre mobile 390 px.

## Assets

- **Polices** : Bricolage Grotesque et Instrument Sans (Google Fonts).
- **Icônes** : **Bootstrap Icons 1.11.3** (CDN dans le prototype ; à installer en dépendance dans le
  projet). Icônes utilisées : `houses`, `house-heart`, `house-door`, `calendar3`, `calendar-plus`,
  `envelope-paper`, `receipt`, `arrow-left-right`, `key`, `tools`, `journal-bookmark`,
  `journal-text`, `shield-lock`, `hand-thumbs-up`, `images`, `people`, `person`, `building`,
  `diagram-3`, `geo-alt`, `wallet2`, `suitcase-lg`, `bell`, `water`, `triangle`, `snow`,
  `file-earmark-text`, `signpost-split`, `list-check`, `box-arrow-in-right`, `display`, `phone`,
  `plus-circle`.
- **Photos** : aucune. Les emplacements `<image-slot>` du prototype matérialisent les zones à
  alimenter (cartes de biens, photo principale de fiche, album de souvenirs, en-tête mobile).
  Prévoir un téléversement avec vignettes générées côté serveur, stockées sur l'instance.

## Fichiers

| Fichier | Contenu |
| --- | --- |
| `Maison de Famille.dc.html` | Le prototype complet : 14 écrans bureau, 3 écrans mobiles, notes de comportement |
| `support.js` | Moteur du prototype — **ne pas porter**, sert seulement à ouvrir le fichier |
| `image-slot.js` | Emplacement photo du prototype — **ne pas porter** |
| `github.md` | Association au dépôt `PrudhommeWTF/Maison-De-Famille` |

Pour lire le prototype : ouvrir `Maison de Famille.dc.html` dans un navigateur, puis parcourir
chaque bien via la barre de contexte et ouvrir le panneau « Notes de comportement » sur chaque écran.
