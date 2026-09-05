# Modèle de données

Ce document est la référence du schéma relationnel. Il est écrit pour être relu dans six mois
sans avoir à ouvrir le code : chaque table dit ce qu'elle porte et **pourquoi** elle est faite
ainsi. Le SQL exact vit dans `backend/src/*/schema.ts`, la vérité de ce document est vérifiée
en CI (le schéma engendré par les migrations est comparé à `docs/schema.sql`).

## Conventions générales

| Sujet | Règle | Raison |
| --- | --- | --- |
| Argent | Entiers de **centimes** (`montant_cents INTEGER`) | Aucun flottant. `0,1 + 0,2` ne vaut pas `0,3` et une répartition à quatre entre frères et soeurs se contesterait sur le centime. |
| Dates | Texte ISO `AAAA-MM-JJ` | Comparable par `<` en SQL, lisible dans un dump, indexable. |
| Horodatages | Texte ISO 8601 UTC (`2026-08-12T14:30:00Z`) | Affichage converti en `Europe/Paris` côté client. Le stockage ne dépend pas de l'heure d'été. |
| Identifiants internes | `INTEGER PRIMARY KEY` | Rapide, compact, jamais exposé tel quel hors du dossier auquel on a accès. |
| Identifiants publics de fichiers | `TEXT` de 32 hexadécimaux (`randomblob(16)`) | Un nom de fichier ne doit pas être devinable, même derrière une autorisation. |
| Suppression | Jamais. Colonne `archive_le TEXT NULL` | Rien ne s'efface, tout se date. Un bien retiré, une personne sortie de l'indivision, une réservation annulée restent consultables. |
| Traçabilité | `cree_le`, `cree_par`, et `maj_le`, `maj_par` sur tout ce qui se modifie | Le premier réflexe devant un chiffre contesté est « qui a saisi ça, et quand ». |
| Clés étrangères | `PRAGMA foreign_keys = ON`, `ON DELETE RESTRICT` par défaut | Aucune cascade silencieuse. Une suppression qui casserait une référence doit échouer bruyamment. |

**Convention des nuits.** Partout dans le schéma, une occupation est un intervalle
`[arrivee, depart)` : nuit d'arrivée incluse, nuit de départ exclue. Le nombre de nuits vaut
`depart - arrivee`. Deux séjours se chevauchent si et seulement si
`a.arrivee < b.depart AND b.arrivee < a.depart`. Cette formule autorise la rotation le même
jour (les Berger partent le 8, Julien arrive le 8) et c'est exactement le comportement voulu
par la maquette. Elle est la seule utilisée : conflits, quotas, occupation, règle de répartition
« nuits occupées ».

---

## 1. Personnes, foyers, accès

### `personne`

```sql
CREATE TABLE personne (
  id                INTEGER PRIMARY KEY,
  nom               TEXT NOT NULL,
  email             TEXT UNIQUE,              -- NULL : personne sans compte (enfant, conjoint non connecté)
  mot_de_passe_hash TEXT,                     -- NULL : ne peut pas se connecter
  token_version     INTEGER NOT NULL DEFAULT 0,
  foyer_id          INTEGER REFERENCES foyer(id),
  totp_secret       TEXT, totp_pending TEXT, totp_recovery TEXT,
  totp_last_step    INTEGER NOT NULL DEFAULT 0, totp_active_le TEXT,
  cree_le           TEXT NOT NULL, archive_le TEXT
);
```

Une personne existe indépendamment d'un compte. Le conjoint d'un indivisaire ou un enfant
compte dans les occupants d'un séjour sans jamais se connecter. `mot_de_passe_hash` à NULL est
l'état normal de ces personnes, pas une anomalie.

`token_version` révoque toutes les sessions ouvertes quand elle est incrémentée (changement de
mot de passe, sortie d'indivision, second facteur activé). C'est repris de Foyer-App, ça marche.

### `foyer`

```sql
CREATE TABLE foyer (id INTEGER PRIMARY KEY, nom TEXT NOT NULL, archive_le TEXT);
```

Le foyer est l'unité de quota de nuits et l'unité de solde lisible pour la famille
(« Claire et Marc doivent 310 euros »). Il ne porte aucune quote-part : les parts appartiennent
aux personnes, parce que c'est la personne qui hérite, pas le ménage.

### `role_attribue`

```sql
CREATE TABLE role_attribue (
  id           INTEGER PRIMARY KEY,
  personne_id  INTEGER NOT NULL REFERENCES personne(id),
  structure_id INTEGER REFERENCES structure(id),   -- exactement un des deux est renseigné
  bien_id      INTEGER REFERENCES bien(id),
  role         TEXT NOT NULL CHECK (role IN ('gerant','detenteur','membre_foyer','invite')),
  debut        TEXT NOT NULL, fin TEXT,
  cree_le TEXT NOT NULL, cree_par INTEGER, archive_le TEXT
);
CREATE INDEX idx_role_personne ON role_attribue(personne_id, archive_le);
```

**Écart assumé avec la maquette.** Le modèle suggéré porte `Personne(role_app)`, un rôle unique
et global. Les données de démonstration de la maquette le contredisent elles-mêmes : Hélène est
gérante de l'indivision de Kerloc'h, Thomas est gérant de la SCI. Un rôle global rendrait l'un
des deux gérant de tout. Le rôle est donc **porté par le rattachement**, pas par la personne.
L'affichage reste celui de la maquette (une pastille de rôle sur la ligne du détenteur), il
prend simplement le rôle du contexte ouvert.

### `lien_invite`

```sql
CREATE TABLE lien_invite (
  id            INTEGER PRIMARY KEY,
  jeton_hash    TEXT NOT NULL UNIQUE,       -- SHA-256 du jeton. Le jeton en clair n'existe qu'une fois, à la création.
  bien_id       INTEGER NOT NULL REFERENCES bien(id),
  sejour_id     INTEGER REFERENCES sejour(id),
  nom           TEXT NOT NULL,
  portee_json   TEXT NOT NULL,              -- ce que ce lien ouvre : guide, codes, dates
  valide_du     TEXT NOT NULL, valide_au TEXT NOT NULL,
  cree_le TEXT NOT NULL, cree_par INTEGER NOT NULL,
  revoque_le    TEXT, derniere_visite TEXT, visites INTEGER NOT NULL DEFAULT 0
);
```

Le jeton est stocké haché, comme un mot de passe : une fuite de la base ne donne aucun accès.
`valide_au` est vérifié **à chaque requête**, pas à la première. Un lien dont le séjour est
terminé ne rend plus aucun code, c'est un test dédié.

---

## 2. Structures et biens

### `structure`

```sql
CREATE TABLE structure (
  id      INTEGER PRIMARY KEY,
  mode    TEXT NOT NULL CHECK (mode IN ('indivision','sci','nom_propre')),
  nom     TEXT NOT NULL,
  notes   TEXT,
  cree_le TEXT NOT NULL, archive_le TEXT
);
```

### `regle_decision`

```sql
CREATE TABLE regle_decision (
  id            INTEGER PRIMARY KEY,
  structure_id  INTEGER NOT NULL REFERENCES structure(id),
  acte          TEXT NOT NULL,        -- 'gestion_courante' | 'disposition' | 'statutaire' | libre
  libelle       TEXT NOT NULL,        -- « Deux tiers pour la gestion courante »
  base          TEXT NOT NULL CHECK (base IN ('parts','tetes')),
  seuil_num     INTEGER NOT NULL, seuil_den INTEGER NOT NULL,   -- 2/3, 1/1, 1/2
  quorum_num    INTEGER, quorum_den INTEGER,
  vote_requis   INTEGER NOT NULL DEFAULT 1,                     -- 0 en nom propre
  UNIQUE (structure_id, acte)
);
```

**Point important.** Les seuils de majorité sont des **données**, pas du code. Un troisième bien
en SCI avec des statuts qui exigent l'unanimité pour un emprunt s'ajoute en insérant une ligne,
sans recompiler. Le mode de détention ne sert qu'à **semer** ces lignes à la création de la
structure (indivision : 2/3 courante, 1/1 disposition ; SCI : selon statuts saisis ; nom propre :
`vote_requis = 0`). Ensuite, seule la table fait foi. C'est ce qui répond à « sans que ce soit
codé en dur pour deux biens précis ».

### `bien`

```sql
CREATE TABLE bien (
  id                INTEGER PRIMARY KEY,
  structure_id      INTEGER NOT NULL REFERENCES structure(id),
  nom               TEXT NOT NULL,
  commune           TEXT NOT NULL, code_postal TEXT, adresse TEXT,
  type              TEXT NOT NULL,      -- 'mer' | 'montagne' | 'campagne' | 'ville'
  couchages         INTEGER NOT NULL,
  location_activee  INTEGER NOT NULL DEFAULT 0,
  photo_fichier_id  TEXT REFERENCES fichier(id),
  cree_le TEXT NOT NULL, archive_le TEXT
);
```

Une structure porte plusieurs biens, un bien appartient à une structure. Les deux notions ne
sont pas fusionnées : **les soldes et les appels de fonds se calculent au niveau de la
structure**, les séjours et l'entretien au niveau du bien.

`bien_caracteristique(bien_id, ordre, cle, valeur)`, `bien_guide(bien_id, ordre, cle, texte)` et
`inventaire_item(id, bien_id, libelle, etat, archive_le)` alimentent les trois cartes de l'écran
« Fiche du bien ». Ce sont des lignes, pas un blob JSON : le guide d'arrivée est modifié à
plusieurs mains et doit se modifier ligne par ligne.

---

## 3. Détentions historisées

C'est le point de modélisation le plus important du projet.

```sql
CREATE TABLE detention (
  id           INTEGER PRIMARY KEY,
  structure_id INTEGER NOT NULL REFERENCES structure(id),
  personne_id  INTEGER NOT NULL REFERENCES personne(id),
  parts        INTEGER NOT NULL CHECK (parts > 0),
  effet_du     TEXT NOT NULL,
  effet_au     TEXT,                       -- NULL = en vigueur
  motif        TEXT NOT NULL,              -- « Succession Robert Prudhomme », « Rachat des parts de Julien »
  cree_le TEXT NOT NULL, cree_par INTEGER NOT NULL
);
CREATE INDEX idx_detention_periode ON detention(structure_id, effet_du, effet_au);
```

**Une quote-part n'est jamais une valeur courante, c'est un intervalle.** Une ligne dit
« Thomas détenait 120 parts sur 300 du 1er janvier 2021 au 14 mars 2026 ». Une succession ferme
les lignes en cours à la date d'effet et en ouvre de nouvelles. Rien n'est écrasé.

**Les parts sont des entiers, la quote-part est dérivée.** La quote-part de Thomas au 12 mars
2026 vaut `ses parts à cette date / somme des parts en vigueur à cette date`. Stocker `0,4` ou
`40 %` obligerait à choisir un arrondi au moment de la saisie ; stocker `120` et `300` permet
une répartition exacte au centime près par la méthode du plus fort reste. Une indivision à parts
égales entre quatre s'écrit `1, 1, 1, 1`.

**Invariants vérifiés en code et testés en CI** (SQLite ne sait pas exprimer une contrainte
d'exclusion) :

1. Pour un couple (structure, personne), les intervalles ne se chevauchent pas et ne laissent
   pas de trou non intentionnel.
2. À toute date où la structure est active, la somme des parts en vigueur est strictement
   positive.
3. Toute écriture passe par `detention.repo.ts`, jamais par un `UPDATE` direct. Une modification
   de répartition est une transaction : fermeture des lignes courantes + ouverture des nouvelles,
   tout ou rien.

**La fonction pivot** est `partsALaDate(structure_id, date)`. Elle rend la table des parts en
vigueur ce jour-là. Toute répartition, tout poids de vote et tout appel de fonds passe par elle.
Aucun code ne lit `detention` autrement.

---

## 4. Séjours (priorité 1)

```sql
CREATE TABLE sejour (
  id             INTEGER PRIMARY KEY,
  bien_id        INTEGER NOT NULL REFERENCES bien(id),
  demandeur_id   INTEGER REFERENCES personne(id),     -- NULL pour une location
  foyer_id       INTEGER REFERENCES foyer(id),
  arrivee        TEXT NOT NULL, depart TEXT NOT NULL CHECK (depart > arrivee),
  occupants      INTEGER NOT NULL CHECK (occupants > 0),
  nature         TEXT NOT NULL CHECK (nature IN ('famille','location','entretien')),
  statut         TEXT NOT NULL CHECK (statut IN ('demande','valide','a_revoir','annule')),
  note           TEXT,
  origine        TEXT NOT NULL CHECK (origine IN ('app','gerante','import')),
  cree_le TEXT NOT NULL, cree_par INTEGER NOT NULL,
  decide_le TEXT, decide_par INTEGER, decision_note TEXT,
  import_run_id  INTEGER REFERENCES import_run(id), import_ligne INTEGER,
  archive_le     TEXT
);
CREATE INDEX idx_sejour_plage ON sejour(bien_id, arrivee, depart) WHERE archive_le IS NULL;
```

Une seule table pour tout ce qui occupe le bien : famille, location, entretien. Le calendrier a
une source de vérité unique, et un artisan bloque les dates aussi sûrement qu'un cousin. C'est
ce qui évite le bug classique de la maison louée pendant les travaux.

**Détection de conflit** (serveur, jamais seulement à l'écran) :

- Chevauchement de plages avec un séjour `valide` du même bien : conflit **bloquant**, la
  demande part quand même mais s'affiche en conflit dans la file de la gérante.
- Chevauchement avec un séjour `demande` : conflit **signalé**, les deux restent en attente et
  la gérante arbitre.
- Somme des occupants sur une nuit supérieure aux couchages du bien : conflit de **capacité**.
- La gérante peut valider malgré le conflit. C'est délibéré : elle arbitre, l'outil ne décide
  pas. Le passage en force est journalisé dans `journal_audit`.

`origine = 'gerante'` couvre le cas réel « les demandes qui n'arrivent pas par l'application » :
la gérante saisit un séjour directement, il naît `valide`, sans passer par le circuit de demande.

### Tour de choix et quotas

```sql
CREATE TABLE saison (id INTEGER PRIMARY KEY, bien_id INTEGER NOT NULL, libelle TEXT NOT NULL,
                     debut TEXT NOT NULL, fin TEXT NOT NULL, statut TEXT NOT NULL, ordre_json TEXT);
CREATE TABLE voeu   (id INTEGER PRIMARY KEY, saison_id INTEGER NOT NULL, foyer_id INTEGER NOT NULL,
                     rang INTEGER NOT NULL, du TEXT NOT NULL, au TEXT NOT NULL, cree_le TEXT NOT NULL,
                     UNIQUE (saison_id, foyer_id, rang));
CREATE TABLE quota  (id INTEGER PRIMARY KEY, saison_id INTEGER NOT NULL, foyer_id INTEGER NOT NULL,
                     nuits_max INTEGER NOT NULL, UNIQUE (saison_id, foyer_id));
```

`saison.ordre_json` porte l'ordre de priorité de l'année (rotatif). L'arbitrage attribue les
premiers choix par ordre de priorité, puis les seconds sur ce qui reste, et **propose** un
résultat sous forme de séjours à l'état `demande`. La gérante valide ou modifie ligne par ligne.
Le quota est indicatif : le dépasser est possible et journalisé. Aucun algorithme ne réglera la
première quinzaine d'août, il documente l'équité.

---

## 5. Argent (priorité 2)

### `depense` et son rattachement

```sql
CREATE TABLE depense (
  id             INTEGER PRIMARY KEY,
  structure_id   INTEGER NOT NULL REFERENCES structure(id),
  date_depense   TEXT NOT NULL,
  libelle        TEXT NOT NULL,
  categorie_id   INTEGER NOT NULL REFERENCES categorie_depense(id),
  montant_cents  INTEGER NOT NULL CHECK (montant_cents > 0),
  paye_par       TEXT NOT NULL CHECK (paye_par IN ('personne','compte_commun','structure')),
  avance_par_id  INTEGER REFERENCES personne(id),      -- renseigné si paye_par = 'personne'
  justificatif_id TEXT REFERENCES fichier(id),
  statut         TEXT NOT NULL CHECK (statut IN ('saisie','validee','annulee')),
  cree_le TEXT NOT NULL, cree_par INTEGER NOT NULL, archive_le TEXT
);

CREATE TABLE depense_bien (
  depense_id INTEGER NOT NULL REFERENCES depense(id),
  bien_id    INTEGER NOT NULL REFERENCES bien(id),
  poids_num  INTEGER NOT NULL, poids_den INTEGER NOT NULL,
  PRIMARY KEY (depense_id, bien_id)
);
```

**Écart assumé avec la maquette.** Le modèle suggéré écrit `Depense(bien_id | 'both')`. Une
valeur magique `'both'` marche pour deux biens et casse au troisième, qui viendra. La table de
jonction porte un poids par bien : une assurance multirisque sur deux biens s'écrit deux lignes
à `1/2`, sur trois biens trois lignes à `1/3`, ou au prorata des surfaces si c'est plus juste.
Le comportement affiché reste exactement celui de la maquette : moitié dans chaque dossier, la
totalité en vue consolidée.

### `regle_repartition`, datée

```sql
CREATE TABLE regle_repartition (
  id            INTEGER PRIMARY KEY,
  bien_id       INTEGER NOT NULL REFERENCES bien(id),
  categorie_id  INTEGER NOT NULL REFERENCES categorie_depense(id),
  regle         TEXT NOT NULL CHECK (regle IN ('quotes_parts','nuits','parts_egales_foyer')),
  applicable_du TEXT NOT NULL, applicable_au TEXT,
  cree_le TEXT NOT NULL, cree_par INTEGER NOT NULL
);
```

Une règle porte une date d'application, comme une détention. Changer la règle de la catégorie
« Énergie » aujourd'hui ouvre une nouvelle ligne et ferme l'ancienne ; les dépenses de l'an
dernier gardent la règle qui s'appliquait alors. La pastille cyclable de la maquette écrit une
nouvelle ligne, elle ne fait jamais un `UPDATE`.

### `ventilation` : la dépense figée

```sql
CREATE TABLE ventilation (
  id             INTEGER PRIMARY KEY,
  depense_id     INTEGER NOT NULL REFERENCES depense(id),
  personne_id    INTEGER NOT NULL REFERENCES personne(id),
  montant_cents  INTEGER NOT NULL,
  calcul_json    TEXT NOT NULL,       -- la justification complète, voir plus bas
  calcule_le     TEXT NOT NULL, calcule_par INTEGER NOT NULL,
  UNIQUE (depense_id, personne_id)
);

CREATE TABLE ventilation_recalcul (
  id INTEGER PRIMARY KEY, depense_id INTEGER NOT NULL REFERENCES depense(id),
  avant_json TEXT NOT NULL, apres_json TEXT NOT NULL, motif TEXT NOT NULL,
  fait_le TEXT NOT NULL, fait_par INTEGER NOT NULL
);
```

**La ventilation est calculée une fois, à la saisie, et gelée.** C'est la deuxième exigence
difficile du brief. Changer une quote-part avec effet rétroactif, ou changer une règle de
répartition, ne touche à aucune ventilation existante. Le passé reste juste.

Un recalcul est possible mais **explicite** : la gérante le demande sur une dépense précise ou
sur une sélection, l'ancien et le nouveau sont conservés dans `ventilation_recalcul` avec un
motif obligatoire. C'est ce qui permet de dire « pourquoi ce chiffre a changé » quand quelqu'un
le remarque.

`calcul_json` porte la justification affichée en un clic, et c'est ce qui rend un montant
défendable devant un frère qui conteste :

```json
{
  "regle": "quotes_parts",
  "regle_source": { "table": "regle_repartition", "id": 7, "applicable_du": "2026-01-01" },
  "date_reference": "2026-09-02",
  "montant_total_cents": 234000,
  "poids_bien": "1/1",
  "parts": [
    { "personne": "Hélène", "parts": 1, "total": 4, "quote_part": "25 %", "brut_cents": 58500, "arrondi_cents": 0, "du_cents": 58500 },
    { "personne": "Claire", "parts": 1, "total": 4, "quote_part": "25 %", "brut_cents": 58500, "arrondi_cents": 0, "du_cents": 58500 }
  ],
  "methode_arrondi": "plus fort reste",
  "controle": "somme des dus = montant total"
}
```

**Contrainte non négociable, testée** : la somme des `ventilation.montant_cents` d'une dépense
égale exactement `depense.montant_cents`. L'arrondi se fait au plus fort reste, les centimes
résiduels vont aux plus grosses quotes-parts, de façon déterministe.

### Soldes, virements, appels de fonds

```sql
CREATE TABLE reglement (
  id INTEGER PRIMARY KEY, structure_id INTEGER NOT NULL REFERENCES structure(id),
  de_personne_id INTEGER REFERENCES personne(id), vers_personne_id INTEGER REFERENCES personne(id),
  vers_structure INTEGER NOT NULL DEFAULT 0,          -- 1 : versement à la structure elle-même
  montant_cents INTEGER NOT NULL, date_reglement TEXT NOT NULL,
  statut TEXT NOT NULL CHECK (statut IN ('propose','annonce','confirme')),
  confirme_le TEXT, confirme_par INTEGER, note TEXT, cree_le TEXT NOT NULL, cree_par INTEGER NOT NULL
);
CREATE TABLE appel_de_fonds (id INTEGER PRIMARY KEY, structure_id INTEGER NOT NULL, libelle TEXT NOT NULL,
                             date_appel TEXT NOT NULL, echeance TEXT NOT NULL, statut TEXT NOT NULL,
                             cree_le TEXT NOT NULL, cree_par INTEGER NOT NULL);
CREATE TABLE appel_ligne (appel_id INTEGER NOT NULL, personne_id INTEGER NOT NULL,
                          montant_cents INTEGER NOT NULL, calcul_json TEXT NOT NULL,
                          PRIMARY KEY (appel_id, personne_id));
```

**Il n'y a pas de table `solde`.** Le modèle de la maquette en suggère une, marquée « dérivé ».
Un solde stocké se désynchronise le jour où une dépense est annulée, c'est la panne financière
classique. Le solde d'une personne dans une structure vaut :

```
solde = (ce qu'elle a avancé) - (ce qu'elle doit, somme de ses ventilations) + (règlements confirmés reçus) - (règlements confirmés versés)
```

Calculé à la demande, par une requête agrégée indexée. Sur une famille de quinze personnes et
quelques milliers de dépenses, c'est instantané, et c'est toujours juste.

Un règlement `propose` par l'algorithme de minimisation ne bouge aucun solde. Il faut le passer
à `annonce` (l'émetteur dit qu'il a viré) puis `confirme` (le bénéficiaire confirme la
réception) pour qu'il compte, exactement comme le prévoit la note de comportement de la maquette.

---

## 6. Maison (priorité 3)

```sql
CREATE TABLE tache (id INTEGER PRIMARY KEY, bien_id INTEGER NOT NULL REFERENCES bien(id),
  libelle TEXT NOT NULL, nature TEXT NOT NULL CHECK (nature IN ('obligatoire','saison','courant','inventaire')),
  echeance TEXT, recurrence_id INTEGER REFERENCES recurrence(id),
  faite_le TEXT, faite_par INTEGER, facture_id TEXT REFERENCES fichier(id), depense_id INTEGER REFERENCES depense(id),
  cree_le TEXT NOT NULL, cree_par INTEGER NOT NULL, archive_le TEXT);

CREATE TABLE recurrence (id INTEGER PRIMARY KEY, bien_id INTEGER NOT NULL, libelle TEXT NOT NULL,
  nature TEXT NOT NULL, periodicite TEXT NOT NULL, mois INTEGER, jour INTEGER,
  prochaine_echeance TEXT NOT NULL, actif INTEGER NOT NULL DEFAULT 1);

CREATE TABLE checklist_depart (id INTEGER PRIMARY KEY, bien_id INTEGER NOT NULL,
  ordre INTEGER NOT NULL, libelle TEXT NOT NULL, actif INTEGER NOT NULL DEFAULT 1);
```

Une récurrence engendre une tâche à sa date, une seule fois, à l'échéance moins le délai déclaré
en paramètre. Cocher une tâche demande la date de réalisation et accepte une facture, qui peut
créer la dépense correspondante (`tache.depense_id`).

```sql
CREATE TABLE contact (id INTEGER PRIMARY KEY, bien_id INTEGER NOT NULL REFERENCES bien(id),
  nom TEXT NOT NULL, role TEXT NOT NULL, telephone TEXT, email TEXT, note TEXT,
  urgence INTEGER NOT NULL DEFAULT 0, cree_le TEXT NOT NULL, cree_par INTEGER, archive_le TEXT);
```

Le carnet d'adresses : artisans, voisins, mairie, contacts d'urgence. Portée
« membres », parce que celui qui occupe la maison est justement celui qui aura
besoin du plombier. `urgence` remonte une ligne en tête de liste.

### Coffre-fort

```sql
CREATE TABLE document (id INTEGER PRIMARY KEY, structure_id INTEGER REFERENCES structure(id),
  nom TEXT NOT NULL, categorie TEXT NOT NULL, fichier_id TEXT NOT NULL REFERENCES fichier(id),
  portee TEXT NOT NULL CHECK (portee IN ('gerant','detenteurs','membres','locataire')),
  version INTEGER NOT NULL DEFAULT 1, remplace_id INTEGER REFERENCES document(id),
  depose_le TEXT NOT NULL, depose_par INTEGER NOT NULL, archive_le TEXT);
CREATE TABLE document_bien (document_id INTEGER NOT NULL, bien_id INTEGER NOT NULL,
  PRIMARY KEY (document_id, bien_id));

CREATE TABLE code_acces (id INTEGER PRIMARY KEY, bien_id INTEGER NOT NULL REFERENCES bien(id),
  libelle TEXT NOT NULL,
  valeur_chiffree BLOB NOT NULL, nonce BLOB NOT NULL, tag BLOB NOT NULL,   -- AES-256-GCM
  portee TEXT NOT NULL CHECK (portee IN ('gerant','detenteurs','membres','sejour')),
  valide_du TEXT, valide_au TEXT,
  maj_le TEXT NOT NULL, maj_par INTEGER NOT NULL, archive_le TEXT);

CREATE TABLE code_lecture (id INTEGER PRIMARY KEY, code_id INTEGER NOT NULL REFERENCES code_acces(id),
  personne_id INTEGER REFERENCES personne(id), lien_invite_id INTEGER REFERENCES lien_invite(id),
  lu_le TEXT NOT NULL, adresse_ip TEXT, agent TEXT);
```

Les codes sont chiffrés au repos en AES-256-GCM, avec une clé dérivée d'un secret
d'environnement obligatoire (`MDF_CODES_KEY`) distinct du secret JWT. Le déchiffrement n'a lieu
que dans le gestionnaire de la route « Afficher », **après** contrôle d'autorisation, et écrit
systématiquement une ligne dans `code_lecture`. Aucun code ne transite dans une liste : la route
de liste rend le libellé et la portée, jamais la valeur.

**La portée `sejour`** est la règle qui rend un code sûr : le code n'est rendu que si le
demandeur a un séjour validé sur ce bien et que la date du jour est dans
`[arrivee - marge_avant, depart + marge_apres]`. Les deux marges sont des paramètres déclarés,
par défaut 2 jours et 1 jour. Un code affiché à quelqu'un dont le séjour est terminé est une
faille, et c'est un test.

---

## 7. Décisions (priorité 4)

```sql
CREATE TABLE decision (id INTEGER PRIMARY KEY, structure_id INTEGER NOT NULL REFERENCES structure(id),
  objet TEXT NOT NULL, description TEXT, acte TEXT NOT NULL, regle_id INTEGER NOT NULL REFERENCES regle_decision(id),
  ouverture TEXT NOT NULL, cloture TEXT NOT NULL,
  statut TEXT NOT NULL CHECK (statut IN ('ouverte','adoptee','rejetee','annulee')),
  resultat_json TEXT, tache_id INTEGER, depense_id INTEGER,
  cree_le TEXT NOT NULL, cree_par INTEGER NOT NULL);

CREATE TABLE voix (id INTEGER PRIMARY KEY, decision_id INTEGER NOT NULL REFERENCES decision(id),
  personne_id INTEGER NOT NULL REFERENCES personne(id),
  valeur TEXT NOT NULL CHECK (valeur IN ('pour','contre','abstention')),
  poids_parts INTEGER NOT NULL, poids_total INTEGER NOT NULL,
  emise_le TEXT NOT NULL, modifiee_le TEXT, UNIQUE (decision_id, personne_id));
```

Le poids d'une voix est **figé à l'ouverture du scrutin** (`partsALaDate(structure, ouverture)`),
copié dans `voix.poids_parts` / `poids_total`. Une succession pendant un vote ouvert ne
redistribue pas les voix déjà exprimées : c'est le même principe que la ventilation gelée, pour
la même raison.

Le dépouillement compare `somme(poids des pour) / poids_total` au seuil de `regle_decision`. Une
structure `vote_requis = 0` (nom propre) n'ouvre aucun scrutin : l'écran affiche la carte
« décision du propriétaire » de la maquette.

---

## 8. Location saisonnière et souvenirs (priorité 5)

```sql
CREATE TABLE reservation (id INTEGER PRIMARY KEY, sejour_id INTEGER NOT NULL UNIQUE REFERENCES sejour(id),
  locataire_nom TEXT NOT NULL, contact TEXT, prix_cents INTEGER NOT NULL, arrhes_cents INTEGER NOT NULL DEFAULT 0,
  statut TEXT NOT NULL CHECK (statut IN ('a_confirmer','acompte','solde','annulee')),
  cree_le TEXT NOT NULL, cree_par INTEGER NOT NULL);
CREATE TABLE encaissement (id INTEGER PRIMARY KEY, reservation_id INTEGER NOT NULL,
  date_encaissement TEXT NOT NULL, montant_cents INTEGER NOT NULL, moyen TEXT);

CREATE TABLE album (id INTEGER PRIMARY KEY, bien_id INTEGER NOT NULL, annee INTEGER NOT NULL,
  sejour_id INTEGER, titre TEXT NOT NULL, cree_le TEXT NOT NULL, archive_le TEXT);
CREATE TABLE photo (id INTEGER PRIMARY KEY, album_id INTEGER NOT NULL REFERENCES album(id),
  fichier_id TEXT NOT NULL REFERENCES fichier(id), vignette_id TEXT REFERENCES fichier(id),
  auteur_id INTEGER NOT NULL, legende TEXT, depose_le TEXT NOT NULL, archive_le TEXT);
```

Une réservation locative **est** un séjour de nature `location` (relation 1 pour 1). Le
calendrier n'a donc rien à savoir de la location, et une semaine louée bloque les dates comme
n'importe quel séjour. `reservation` porte uniquement le commercial.

---

## 9. Transverse

```sql
CREATE TABLE fichier (
  id        TEXT PRIMARY KEY,              -- 32 hexadécimaux, non devinable
  sha256    TEXT NOT NULL, chemin_rel TEXT NOT NULL,
  mime      TEXT NOT NULL, taille INTEGER NOT NULL, nom_original TEXT NOT NULL,
  cree_le   TEXT NOT NULL, cree_par INTEGER NOT NULL);
CREATE INDEX idx_fichier_sha ON fichier(sha256);

CREATE TABLE parametre (cle TEXT NOT NULL, portee TEXT NOT NULL, portee_id INTEGER,
  valeur TEXT NOT NULL, maj_le TEXT NOT NULL, maj_par INTEGER,
  PRIMARY KEY (cle, portee, portee_id));

CREATE TABLE notification (id INTEGER PRIMARY KEY, personne_id INTEGER NOT NULL, type TEXT NOT NULL,
  sujet TEXT NOT NULL, corps TEXT NOT NULL, lien TEXT NOT NULL,
  cree_le TEXT NOT NULL, envoye_le TEXT, tentatives INTEGER NOT NULL DEFAULT 0,
  prochaine_tentative TEXT, derniere_erreur TEXT);
CREATE TABLE notification_pref (personne_id INTEGER NOT NULL, type TEXT NOT NULL,
  actif INTEGER NOT NULL, PRIMARY KEY (personne_id, type));

CREATE TABLE journal_audit (id INTEGER PRIMARY KEY, acteur_id INTEGER, action TEXT NOT NULL,
  objet_kind TEXT NOT NULL, objet_id INTEGER, detail_json TEXT, fait_le TEXT NOT NULL, adresse_ip TEXT);

CREATE TABLE import_run (id INTEGER PRIMARY KEY, source_nom TEXT NOT NULL, fichier_sha TEXT NOT NULL,
  importe_le TEXT NOT NULL, importe_par INTEGER NOT NULL,
  lues INTEGER NOT NULL, creees INTEGER NOT NULL, ignorees INTEGER NOT NULL, rapport_json TEXT NOT NULL);

CREATE TABLE schema_migration (version INTEGER PRIMARY KEY, libelle TEXT NOT NULL,
  applique_le TEXT NOT NULL, duree_ms INTEGER NOT NULL);
```

**Le service de fichiers est partagé dès le premier jour.** Les octets vivent sur le disque, sous
`MDF_DATA_DIR/fichiers/aa/bb/<sha256>.<ext>`, adressés par leur empreinte (deux dépôts du même
PDF ne coûtent qu'une copie). La base ne porte que le chemin. Aucun base64 dans un
enregistrement, jamais. Le téléchargement passe **toujours** par `GET /api/fichiers/:id`, qui
vérifie l'autorisation avant d'ouvrir le fichier : le chemin sur disque n'est jamais servi
directement, et NGINX ne sert pas le répertoire de données.

**La table `notification` est une file d'attente durable**, pas un envoi direct. Un serveur SMTP
injoignable à minuit ne perd pas la notification : `tentatives`, `prochaine_tentative` et
`derniere_erreur` permettent une reprise avec recul exponentiel, et l'écran d'état système montre
la file en souffrance avec le message d'erreur SMTP exact. C'est ce que vous voudrez lire quand
un courriel n'arrivera pas.
