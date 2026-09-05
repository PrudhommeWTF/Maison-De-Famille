// Migration 001 : le socle de la tranche 1.
//
// Personnes et accès, structures et biens, détentions historisées, séjours et
// leur arbitrage, saison de choix, fichiers, paramètres, notifications, journal
// et traçabilité des imports.
//
// Rien de ce qui appartient aux tranches suivantes n'est créé ici. Une table que
// personne n'écrit encore est une promesse invérifiable : dépenses, coffre-fort,
// votes et albums arriveront avec leur code, dans leur propre migration.
import type { Migration } from './index';

export const migration001: Migration = {
  version: 1,
  libelle: 'Socle : personnes, structures, biens, détentions, séjours',
  up(db) {
    db.exec(`
      -- ============================================================
      -- Personnes, foyers, accès
      -- ============================================================

      -- Une personne existe indépendamment d'un compte. Le conjoint d'un
      -- indivisaire ou un enfant compte dans les occupants d'un séjour sans
      -- jamais se connecter : mot_de_passe_hash à NULL est un état normal.
      CREATE TABLE personne (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        nom               TEXT NOT NULL,
        email             TEXT UNIQUE COLLATE NOCASE,
        mot_de_passe_hash TEXT,
        -- Incrémentée pour révoquer d'un coup toutes les sessions ouvertes
        -- (changement de mot de passe, sortie d'indivision, compte désactivé).
        token_version     INTEGER NOT NULL DEFAULT 0,
        foyer_id          INTEGER REFERENCES foyer(id),
        derniere_connexion TEXT,
        cree_le           TEXT NOT NULL,
        cree_par          INTEGER REFERENCES personne(id),
        archive_le        TEXT
      );
      CREATE INDEX idx_personne_active ON personne(archive_le);

      CREATE TABLE foyer (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        nom        TEXT NOT NULL,
        cree_le    TEXT NOT NULL,
        archive_le TEXT
      );

      -- Le rôle est porté par le rattachement, jamais par la personne : Hélène
      -- est gérante de l'indivision pendant que Thomas est gérant de la SCI.
      -- Exactement une des deux portées est renseignée.
      CREATE TABLE role_attribue (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        personne_id  INTEGER NOT NULL REFERENCES personne(id),
        structure_id INTEGER REFERENCES structure(id),
        bien_id      INTEGER REFERENCES bien(id),
        role         TEXT NOT NULL CHECK (role IN ('gerant','detenteur','membre_foyer','invite')),
        debut        TEXT NOT NULL,
        fin          TEXT,
        cree_le      TEXT NOT NULL,
        cree_par     INTEGER REFERENCES personne(id),
        archive_le   TEXT,
        CHECK ((structure_id IS NULL) <> (bien_id IS NULL))
      );
      CREATE INDEX idx_role_personne ON role_attribue(personne_id) WHERE archive_le IS NULL;
      CREATE INDEX idx_role_structure ON role_attribue(structure_id) WHERE archive_le IS NULL;

      -- Les sessions de renouvellement. Le jeton d'accès est court (quinze
      -- minutes) et non stocké ; le jeton de renouvellement est long et stocké
      -- haché, ce qui permet de le révoquer un par un depuis un écran, plutôt
      -- que de déconnecter toute la famille en incrémentant token_version.
      CREATE TABLE session (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        personne_id         INTEGER NOT NULL REFERENCES personne(id),
        jeton_hash          TEXT NOT NULL UNIQUE,
        cree_le             TEXT NOT NULL,
        expire_le           TEXT NOT NULL,
        derniere_utilisation TEXT,
        agent               TEXT,
        adresse_ip          TEXT,
        revoque_le          TEXT
      );
      CREATE INDEX idx_session_personne ON session(personne_id) WHERE revoque_le IS NULL;

      -- La réinitialisation de mot de passe. Le jeton est stocké haché et à
      -- usage unique : « certains se connecteront trois fois par an et auront
      -- oublié leur mot de passe à chaque fois » est un cas nominal, pas un
      -- incident.
      CREATE TABLE reinit_mot_de_passe (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        personne_id INTEGER NOT NULL REFERENCES personne(id),
        jeton_hash  TEXT NOT NULL UNIQUE,
        cree_le     TEXT NOT NULL,
        expire_le   TEXT NOT NULL,
        utilise_le  TEXT,
        adresse_ip  TEXT
      );

      -- ============================================================
      -- Structures et biens
      -- ============================================================

      CREATE TABLE structure (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        mode       TEXT NOT NULL CHECK (mode IN ('indivision','sci','nom_propre')),
        nom        TEXT NOT NULL,
        notes      TEXT NOT NULL DEFAULT '',
        cree_le    TEXT NOT NULL,
        cree_par   INTEGER REFERENCES personne(id),
        archive_le TEXT
      );

      -- Les seuils de majorité sont des DONNÉES, pas du code. Un troisième bien
      -- dont les statuts exigent l'unanimité pour un emprunt s'ajoute en
      -- insérant une ligne. Le mode de détention ne sert qu'à semer ces lignes
      -- à la création ; ensuite, seule cette table fait foi.
      CREATE TABLE regle_decision (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        structure_id INTEGER NOT NULL REFERENCES structure(id),
        acte         TEXT NOT NULL,
        libelle      TEXT NOT NULL,
        base         TEXT NOT NULL CHECK (base IN ('parts','tetes')),
        seuil_num    INTEGER NOT NULL CHECK (seuil_num > 0),
        seuil_den    INTEGER NOT NULL CHECK (seuil_den > 0),
        quorum_num   INTEGER,
        quorum_den   INTEGER,
        vote_requis  INTEGER NOT NULL DEFAULT 1 CHECK (vote_requis IN (0,1)),
        UNIQUE (structure_id, acte)
      );

      CREATE TABLE bien (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        structure_id     INTEGER NOT NULL REFERENCES structure(id),
        nom              TEXT NOT NULL,
        commune          TEXT NOT NULL,
        code_postal      TEXT NOT NULL DEFAULT '',
        adresse          TEXT NOT NULL DEFAULT '',
        type             TEXT NOT NULL CHECK (type IN ('mer','montagne','campagne','ville')),
        couchages        INTEGER NOT NULL CHECK (couchages > 0),
        location_activee INTEGER NOT NULL DEFAULT 0 CHECK (location_activee IN (0,1)),
        photo_fichier_id TEXT REFERENCES fichier(id),
        notes            TEXT NOT NULL DEFAULT '',
        cree_le          TEXT NOT NULL,
        cree_par         INTEGER REFERENCES personne(id),
        archive_le       TEXT
      );
      CREATE INDEX idx_bien_structure ON bien(structure_id);

      -- ============================================================
      -- Détentions historisées
      -- ============================================================
      --
      -- Une quote-part n'est jamais une valeur courante, c'est un intervalle.
      -- Une succession ferme les lignes en cours à la date d'effet et en ouvre
      -- de nouvelles : rien n'est écrasé, et une dépense de l'an dernier se
      -- répartit encore avec les parts de l'an dernier.
      --
      -- Les parts sont des ENTIERS et la quote-part est dérivée
      -- (parts / somme des parts en vigueur à la date). Stocker « 25 % »
      -- obligerait à arrondir dès la saisie ; stocker 1 sur 4 permet une
      -- répartition exacte au centime par la méthode du plus fort reste.
      CREATE TABLE detention (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        structure_id INTEGER NOT NULL REFERENCES structure(id),
        personne_id  INTEGER NOT NULL REFERENCES personne(id),
        parts        INTEGER NOT NULL CHECK (parts > 0),
        effet_du     TEXT NOT NULL,
        effet_au     TEXT,
        motif        TEXT NOT NULL,
        cree_le      TEXT NOT NULL,
        cree_par     INTEGER REFERENCES personne(id),
        CHECK (effet_au IS NULL OR effet_au > effet_du)
      );
      CREATE INDEX idx_detention_periode ON detention(structure_id, effet_du, effet_au);
      CREATE INDEX idx_detention_personne ON detention(personne_id);

      -- ============================================================
      -- Séjours
      -- ============================================================
      --
      -- Une seule table pour tout ce qui occupe le bien : famille, location,
      -- entretien. Le calendrier a donc une source de vérité unique, et un
      -- artisan bloque les dates aussi sûrement qu'un cousin. C'est ce qui
      -- évite la maison louée pendant les travaux.
      --
      -- Convention : [arrivee, depart), nuit d'arrivée incluse, nuit de départ
      -- exclue, rotation possible le même jour.
      CREATE TABLE sejour (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        bien_id       INTEGER NOT NULL REFERENCES bien(id),
        demandeur_id  INTEGER REFERENCES personne(id),
        foyer_id      INTEGER REFERENCES foyer(id),
        titre         TEXT NOT NULL DEFAULT '',
        arrivee       TEXT NOT NULL,
        depart        TEXT NOT NULL,
        occupants     INTEGER NOT NULL CHECK (occupants > 0),
        nature        TEXT NOT NULL CHECK (nature IN ('famille','location','entretien')),
        statut        TEXT NOT NULL CHECK (statut IN ('demande','valide','a_revoir','annule')),
        note          TEXT NOT NULL DEFAULT '',
        origine       TEXT NOT NULL CHECK (origine IN ('app','gerante','import')),
        cree_le       TEXT NOT NULL,
        cree_par      INTEGER REFERENCES personne(id),
        decide_le     TEXT,
        decide_par    INTEGER REFERENCES personne(id),
        decision_note TEXT NOT NULL DEFAULT '',
        import_run_id INTEGER REFERENCES import_run(id),
        import_ligne  INTEGER,
        archive_le    TEXT,
        CHECK (depart > arrivee)
      );
      CREATE INDEX idx_sejour_plage ON sejour(bien_id, arrivee, depart) WHERE archive_le IS NULL;
      CREATE INDEX idx_sejour_statut ON sejour(bien_id, statut) WHERE archive_le IS NULL;
      CREATE INDEX idx_sejour_demandeur ON sejour(demandeur_id) WHERE archive_le IS NULL;
      -- La clé de déduplication d'un import : relancer le même fichier ne crée
      -- pas de doublon.
      CREATE UNIQUE INDEX idx_sejour_import ON sejour(import_run_id, import_ligne)
        WHERE import_run_id IS NOT NULL;

      -- ============================================================
      -- Tour de choix saisonnier
      -- ============================================================
      --
      -- Le tour de choix documente l'équité, il n'impose pas un résultat :
      -- l'arbitrage PROPOSE des séjours à l'état « demande » et la gérante
      -- valide ou modifie ligne par ligne. Aucun algorithme ne réglera la
      -- première quinzaine d'août.
      CREATE TABLE saison (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        bien_id    INTEGER NOT NULL REFERENCES bien(id),
        libelle    TEXT NOT NULL,
        debut      TEXT NOT NULL,
        fin        TEXT NOT NULL,
        statut     TEXT NOT NULL CHECK (statut IN ('ouverte','arbitree','close')),
        -- L'ordre de priorité de l'année, rotatif : liste d'identifiants de foyers.
        ordre_json TEXT NOT NULL DEFAULT '[]',
        cree_le    TEXT NOT NULL,
        cree_par   INTEGER REFERENCES personne(id),
        CHECK (fin > debut)
      );
      CREATE INDEX idx_saison_bien ON saison(bien_id);

      CREATE TABLE voeu (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        saison_id INTEGER NOT NULL REFERENCES saison(id),
        foyer_id  INTEGER NOT NULL REFERENCES foyer(id),
        rang      INTEGER NOT NULL CHECK (rang >= 1),
        du        TEXT NOT NULL,
        au        TEXT NOT NULL,
        occupants INTEGER NOT NULL CHECK (occupants > 0),
        cree_le   TEXT NOT NULL,
        cree_par  INTEGER REFERENCES personne(id),
        UNIQUE (saison_id, foyer_id, rang),
        CHECK (au > du)
      );

      -- Indicatif : la gérante peut le dépasser, l'écart est journalisé.
      CREATE TABLE quota (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        saison_id INTEGER NOT NULL REFERENCES saison(id),
        foyer_id  INTEGER NOT NULL REFERENCES foyer(id),
        nuits_max INTEGER NOT NULL CHECK (nuits_max >= 0),
        UNIQUE (saison_id, foyer_id)
      );

      -- ============================================================
      -- Transverse
      -- ============================================================

      -- Le service de fichiers partagé, dès le premier jour. Les octets vivent
      -- sur le disque, adressés par leur empreinte ; la base ne porte que le
      -- chemin. Aucun base64 dans un enregistrement, jamais.
      CREATE TABLE fichier (
        id           TEXT PRIMARY KEY,
        sha256       TEXT NOT NULL,
        chemin_rel   TEXT NOT NULL,
        mime         TEXT NOT NULL,
        taille       INTEGER NOT NULL,
        nom_original TEXT NOT NULL,
        cree_le      TEXT NOT NULL,
        cree_par     INTEGER REFERENCES personne(id)
      );
      CREATE INDEX idx_fichier_sha ON fichier(sha256);

      -- Le stockage du registre de paramètres. La déclaration vit dans le code
      -- (parametres/registre.ts) ; ici il n'y a que les valeurs effectivement
      -- modifiées. Un paramètre jamais touché n'a pas de ligne et rend son
      -- défaut : une installation existante ne casse pas quand un réglage
      -- apparaît.
      CREATE TABLE parametre (
        cle       TEXT NOT NULL,
        portee    TEXT NOT NULL,
        portee_id INTEGER NOT NULL DEFAULT 0,
        valeur    TEXT NOT NULL,
        maj_le    TEXT NOT NULL,
        maj_par   INTEGER REFERENCES personne(id),
        PRIMARY KEY (cle, portee, portee_id)
      );

      -- Une file d'attente durable, pas un envoi direct. Un relais SMTP
      -- injoignable à minuit ne perd rien : tentatives, prochaine_tentative et
      -- derniere_erreur permettent la reprise, et l'écran d'état montre la file
      -- en souffrance avec le message SMTP exact.
      CREATE TABLE notification (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        personne_id         INTEGER NOT NULL REFERENCES personne(id),
        type                TEXT NOT NULL,
        sujet               TEXT NOT NULL,
        corps_texte         TEXT NOT NULL,
        corps_html          TEXT NOT NULL,
        lien                TEXT NOT NULL DEFAULT '',
        cree_le             TEXT NOT NULL,
        envoye_le           TEXT,
        abandonne_le        TEXT,
        tentatives          INTEGER NOT NULL DEFAULT 0,
        prochaine_tentative TEXT,
        derniere_erreur     TEXT
      );
      CREATE INDEX idx_notification_a_envoyer ON notification(prochaine_tentative)
        WHERE envoye_le IS NULL AND abandonne_le IS NULL;

      CREATE TABLE notification_pref (
        personne_id INTEGER NOT NULL REFERENCES personne(id),
        type        TEXT NOT NULL,
        actif       INTEGER NOT NULL CHECK (actif IN (0,1)),
        PRIMARY KEY (personne_id, type)
      );

      -- Ce qui doit rester traçable même quand personne ne regardait : un
      -- passage en force sur un conflit, un quota dépassé, un changement de
      -- quotes-parts, une décision annulée.
      CREATE TABLE journal_audit (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        acteur_id   INTEGER REFERENCES personne(id),
        action      TEXT NOT NULL,
        objet_kind  TEXT NOT NULL,
        objet_id    INTEGER,
        detail_json TEXT NOT NULL DEFAULT '{}',
        fait_le     TEXT NOT NULL,
        adresse_ip  TEXT
      );
      CREATE INDEX idx_audit_objet ON journal_audit(objet_kind, objet_id);
      CREATE INDEX idx_audit_date ON journal_audit(fait_le);

      -- Un import est rejouable et annulable en bloc : chaque séjour importé
      -- porte son import_run_id, et une mauvaise correspondance de colonnes se
      -- défait en une action au lieu de laisser des centaines de lignes fausses.
      CREATE TABLE import_run (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        source_nom   TEXT NOT NULL,
        fichier_sha  TEXT NOT NULL,
        importe_le   TEXT NOT NULL,
        importe_par  INTEGER REFERENCES personne(id),
        lues         INTEGER NOT NULL,
        creees       INTEGER NOT NULL,
        ignorees     INTEGER NOT NULL,
        refusees     INTEGER NOT NULL,
        rapport_json TEXT NOT NULL,
        annule_le    TEXT
      );
    `);
  },
};
