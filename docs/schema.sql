-- Schéma de la base, engendré par les migrations. Ne pas modifier à la main.
-- Version du schéma : 4
-- Régénérer : cd backend && npm run docs:schema

CREATE TABLE appel_de_fonds (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        structure_id INTEGER NOT NULL REFERENCES structure(id),
        libelle      TEXT NOT NULL,
        date_appel   TEXT NOT NULL,
        echeance     TEXT NOT NULL,
        statut       TEXT NOT NULL CHECK (statut IN ('ouvert','clos','annule')),
        note         TEXT NOT NULL DEFAULT '',
        cree_le      TEXT NOT NULL,
        cree_par     INTEGER REFERENCES personne(id)
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
CREATE TABLE categorie_depense (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        code    TEXT NOT NULL UNIQUE,
        libelle TEXT NOT NULL,
        ordre   INTEGER NOT NULL,
        actif   INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
      );
CREATE TABLE depense (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        groupe_id       INTEGER REFERENCES depense_groupe(id),
        structure_id    INTEGER NOT NULL REFERENCES structure(id),
        date_depense    TEXT NOT NULL,
        libelle         TEXT NOT NULL,
        categorie_id    INTEGER NOT NULL REFERENCES categorie_depense(id),
        montant_cents   INTEGER NOT NULL CHECK (montant_cents > 0),
        -- « structure » : le compte commun a payé. Personne n'a avancé, et c'est
        -- la structure qui devient créancière, ce qui fait tomber les comptes à
        -- zéro (voir argent/soldes.ts).
        paye_par        TEXT NOT NULL CHECK (paye_par IN ('personne','structure')),
        avance_par_id   INTEGER REFERENCES personne(id),
        justificatif_id TEXT REFERENCES fichier(id),
        statut          TEXT NOT NULL CHECK (statut IN ('saisie','validee','annulee')),
        note            TEXT NOT NULL DEFAULT '',
        cree_le         TEXT NOT NULL,
        cree_par        INTEGER REFERENCES personne(id),
        archive_le      TEXT,
        CHECK ((paye_par = 'personne') = (avance_par_id IS NOT NULL))
      );
CREATE TABLE depense_bien (
        depense_id INTEGER NOT NULL REFERENCES depense(id),
        bien_id    INTEGER NOT NULL REFERENCES bien(id),
        poids_num  INTEGER NOT NULL CHECK (poids_num > 0),
        poids_den  INTEGER NOT NULL CHECK (poids_den > 0),
        PRIMARY KEY (depense_id, bien_id)
      );
CREATE TABLE depense_groupe (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        libelle             TEXT NOT NULL,
        montant_total_cents INTEGER NOT NULL CHECK (montant_total_cents > 0),
        cree_le             TEXT NOT NULL,
        cree_par            INTEGER REFERENCES personne(id)
      );
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
CREATE TABLE foyer (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        nom        TEXT NOT NULL,
        cree_le    TEXT NOT NULL,
        archive_le TEXT
      );
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
CREATE TABLE notification_pref (
        personne_id INTEGER NOT NULL REFERENCES personne(id),
        type        TEXT NOT NULL,
        actif       INTEGER NOT NULL CHECK (actif IN (0,1)),
        PRIMARY KEY (personne_id, type)
      );
CREATE TABLE parametre (
        cle       TEXT NOT NULL,
        portee    TEXT NOT NULL,
        portee_id INTEGER NOT NULL DEFAULT 0,
        valeur    TEXT NOT NULL,
        maj_le    TEXT NOT NULL,
        maj_par   INTEGER REFERENCES personne(id),
        PRIMARY KEY (cle, portee, portee_id)
      );
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
      , totp_secret TEXT, totp_pending TEXT, totp_recovery TEXT NOT NULL DEFAULT '[]', totp_last_step INTEGER NOT NULL DEFAULT 0, totp_active_le TEXT);
CREATE TABLE quota (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        saison_id INTEGER NOT NULL REFERENCES saison(id),
        foyer_id  INTEGER NOT NULL REFERENCES foyer(id),
        nuits_max INTEGER NOT NULL CHECK (nuits_max >= 0),
        UNIQUE (saison_id, foyer_id)
      );
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
CREATE TABLE regle_repartition (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        bien_id       INTEGER NOT NULL REFERENCES bien(id),
        categorie_id  INTEGER NOT NULL REFERENCES categorie_depense(id),
        regle         TEXT NOT NULL CHECK (regle IN ('quotes_parts','nuits','parts_egales_foyer')),
        applicable_du TEXT NOT NULL,
        applicable_au TEXT,
        cree_le       TEXT NOT NULL,
        cree_par      INTEGER REFERENCES personne(id),
        CHECK (applicable_au IS NULL OR applicable_au > applicable_du)
      );
CREATE TABLE reglement (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        structure_id   INTEGER NOT NULL REFERENCES structure(id),
        de_id          INTEGER NOT NULL CHECK (de_id >= 0),
        vers_id        INTEGER NOT NULL CHECK (vers_id >= 0),
        montant_cents  INTEGER NOT NULL CHECK (montant_cents > 0),
        date_reglement TEXT NOT NULL,
        -- « propose » : suggéré par le calcul, ne bouge aucun solde.
        -- « annonce » : l'émetteur dit avoir viré.
        -- « confirme » : le bénéficiaire a vu l'argent. Seul cet état compte.
        statut         TEXT NOT NULL CHECK (statut IN ('propose','annonce','confirme','annule')),
        motif          TEXT NOT NULL DEFAULT '',
        appel_id       INTEGER REFERENCES appel_de_fonds(id),
        cree_le        TEXT NOT NULL,
        cree_par       INTEGER REFERENCES personne(id),
        annonce_le     TEXT,
        confirme_le    TEXT,
        confirme_par   INTEGER REFERENCES personne(id),
        CHECK (de_id <> vers_id)
      );
CREATE TABLE reinit_mot_de_passe (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        personne_id INTEGER NOT NULL REFERENCES personne(id),
        jeton_hash  TEXT NOT NULL UNIQUE,
        cree_le     TEXT NOT NULL,
        expire_le   TEXT NOT NULL,
        utilise_le  TEXT,
        adresse_ip  TEXT
      , motif TEXT NOT NULL DEFAULT 'oubli', cree_par INTEGER REFERENCES personne(id), vu_le TEXT);
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
CREATE TABLE schema_migration (
    version     INTEGER PRIMARY KEY,
    libelle     TEXT NOT NULL,
    applique_le TEXT NOT NULL,
    duree_ms    INTEGER NOT NULL
  );
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
CREATE TABLE structure (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        mode       TEXT NOT NULL CHECK (mode IN ('indivision','sci','nom_propre')),
        nom        TEXT NOT NULL,
        notes      TEXT NOT NULL DEFAULT '',
        cree_le    TEXT NOT NULL,
        cree_par   INTEGER REFERENCES personne(id),
        archive_le TEXT
      );
CREATE TABLE ventilation (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        depense_id    INTEGER NOT NULL REFERENCES depense(id),
        personne_id   INTEGER NOT NULL REFERENCES personne(id),
        montant_cents INTEGER NOT NULL,
        calcul_json   TEXT NOT NULL,
        calcule_le    TEXT NOT NULL,
        calcule_par   INTEGER REFERENCES personne(id),
        UNIQUE (depense_id, personne_id)
      );
CREATE TABLE ventilation_recalcul (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        depense_id INTEGER NOT NULL REFERENCES depense(id),
        avant_json TEXT NOT NULL,
        apres_json TEXT NOT NULL,
        motif      TEXT NOT NULL,
        fait_le    TEXT NOT NULL,
        fait_par   INTEGER REFERENCES personne(id)
      );
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
CREATE INDEX idx_audit_date ON journal_audit(fait_le);
CREATE INDEX idx_audit_objet ON journal_audit(objet_kind, objet_id);
CREATE INDEX idx_bien_structure ON bien(structure_id);
CREATE INDEX idx_depense_bien_bien ON depense_bien(bien_id);
CREATE INDEX idx_depense_groupe ON depense(groupe_id) WHERE groupe_id IS NOT NULL;
CREATE INDEX idx_depense_structure ON depense(structure_id, date_depense) WHERE archive_le IS NULL;
CREATE INDEX idx_detention_periode ON detention(structure_id, effet_du, effet_au);
CREATE INDEX idx_detention_personne ON detention(personne_id);
CREATE INDEX idx_fichier_sha ON fichier(sha256);
CREATE INDEX idx_notification_a_envoyer ON notification(prochaine_tentative)
        WHERE envoye_le IS NULL AND abandonne_le IS NULL;
CREATE INDEX idx_personne_active ON personne(archive_le);
CREATE INDEX idx_regle_periode ON regle_repartition(bien_id, categorie_id, applicable_du, applicable_au);
CREATE INDEX idx_reglement_structure ON reglement(structure_id, statut);
CREATE INDEX idx_reinit_personne ON reinit_mot_de_passe(personne_id, motif)
        WHERE utilise_le IS NULL;
CREATE INDEX idx_role_personne ON role_attribue(personne_id) WHERE archive_le IS NULL;
CREATE INDEX idx_role_structure ON role_attribue(structure_id) WHERE archive_le IS NULL;
CREATE INDEX idx_saison_bien ON saison(bien_id);
CREATE INDEX idx_sejour_demandeur ON sejour(demandeur_id) WHERE archive_le IS NULL;
CREATE UNIQUE INDEX idx_sejour_import ON sejour(import_run_id, import_ligne)
        WHERE import_run_id IS NOT NULL;
CREATE INDEX idx_sejour_plage ON sejour(bien_id, arrivee, depart) WHERE archive_le IS NULL;
CREATE INDEX idx_sejour_statut ON sejour(bien_id, statut) WHERE archive_le IS NULL;
CREATE INDEX idx_session_personne ON session(personne_id) WHERE revoque_le IS NULL;
CREATE INDEX idx_ventilation_personne ON ventilation(personne_id);
