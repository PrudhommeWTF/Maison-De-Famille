-- Schéma de la base, engendré par les migrations. Ne pas modifier à la main.
-- Version du schéma : 9
-- Régénérer : cd backend && npm run docs:schema

CREATE TABLE acces_temporaire (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        bien_id       INTEGER NOT NULL REFERENCES bien(id),
        personne_id   INTEGER NOT NULL REFERENCES personne(id),
        role_id       INTEGER NOT NULL REFERENCES role_attribue(id),
        sejour_id     INTEGER REFERENCES sejour(id),
        jeton_hash    TEXT NOT NULL UNIQUE,
        libelle       TEXT NOT NULL,
        -- Le jour inclus jusqu'auquel le lien vaut. La date de fin du rôle porte
        -- la même valeur : le jeton empêche d'ouvrir une session, le rôle coupe
        -- celles déjà ouvertes. Il faut les deux.
        expire_le     TEXT NOT NULL,
        revoque_le    TEXT,
        derniere_utilisation TEXT,
        utilisations  INTEGER NOT NULL DEFAULT 0,
        cree_le       TEXT NOT NULL,
        cree_par      INTEGER REFERENCES personne(id)
      );
CREATE TABLE album (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        bien_id    INTEGER NOT NULL REFERENCES bien(id),
        sejour_id  INTEGER REFERENCES sejour(id),
        titre      TEXT NOT NULL,
        annee      INTEGER NOT NULL,
        cree_le    TEXT NOT NULL,
        cree_par   INTEGER REFERENCES personne(id),
        archive_le TEXT
      );
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
CREATE TABLE checklist_ligne (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        bien_id    INTEGER NOT NULL REFERENCES bien(id),
        libelle    TEXT NOT NULL,
        ordre      INTEGER NOT NULL DEFAULT 0,
        cree_le    TEXT NOT NULL,
        archive_le TEXT
      );
CREATE TABLE code_acces (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        bien_id         INTEGER NOT NULL REFERENCES bien(id),
        libelle         TEXT NOT NULL,
        valeur_chiffree BLOB NOT NULL,
        portee          TEXT NOT NULL CHECK (portee IN ('gerant','detenteur','membres','sejour')),
        note            TEXT NOT NULL DEFAULT '',
        cree_le         TEXT NOT NULL,
        cree_par        INTEGER REFERENCES personne(id),
        maj_le          TEXT,
        archive_le      TEXT
      );
CREATE TABLE code_affichage (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        code_id     INTEGER NOT NULL REFERENCES code_acces(id),
        personne_id INTEGER NOT NULL REFERENCES personne(id),
        affiche_le  TEXT NOT NULL,
        adresse_ip  TEXT NOT NULL DEFAULT ''
      );
CREATE TABLE contact (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        bien_id    INTEGER NOT NULL REFERENCES bien(id),
        nom        TEXT NOT NULL,
        role       TEXT NOT NULL CHECK (role IN ('artisan','voisin','mairie','urgence','autre')),
        telephone  TEXT NOT NULL DEFAULT '',
        email      TEXT NOT NULL DEFAULT '',
        notes      TEXT NOT NULL DEFAULT '',
        cree_le    TEXT NOT NULL,
        cree_par   INTEGER REFERENCES personne(id),
        archive_le TEXT
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
        archive_le      TEXT, charge_location INTEGER NOT NULL DEFAULT 0
        CHECK (charge_location IN (0,1)),
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
CREATE TABLE document (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        bien_id    INTEGER NOT NULL REFERENCES bien(id),
        nom        TEXT NOT NULL,
        portee     TEXT NOT NULL CHECK (portee IN ('gerant','detenteur','membres','sejour')),
        note       TEXT NOT NULL DEFAULT '',
        cree_le    TEXT NOT NULL,
        cree_par   INTEGER REFERENCES personne(id),
        archive_le TEXT
      );
CREATE TABLE document_version (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id   INTEGER NOT NULL REFERENCES document(id),
        fichier_id    INTEGER NOT NULL REFERENCES fichier(id),
        version       INTEGER NOT NULL,
        note          TEXT NOT NULL DEFAULT '',
        depose_le     TEXT NOT NULL,
        depose_par_id INTEGER REFERENCES personne(id)
      );
CREATE TABLE fiche_ligne (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        bien_id    INTEGER NOT NULL REFERENCES bien(id),
        section    TEXT NOT NULL CHECK (section IN ('caracteristique','guide')),
        cle        TEXT NOT NULL,
        valeur     TEXT NOT NULL DEFAULT '',
        ordre      INTEGER NOT NULL DEFAULT 0,
        cree_le    TEXT NOT NULL,
        archive_le TEXT
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
CREATE TABLE inventaire (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        bien_id    INTEGER NOT NULL REFERENCES bien(id),
        libelle    TEXT NOT NULL,
        etat       TEXT NOT NULL DEFAULT '',
        ordre      INTEGER NOT NULL DEFAULT 0,
        cree_le    TEXT NOT NULL,
        archive_le TEXT
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
CREATE TABLE location (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        sejour_id      INTEGER NOT NULL UNIQUE REFERENCES sejour(id),
        bien_id        INTEGER NOT NULL REFERENCES bien(id),
        locataire      TEXT NOT NULL,
        email          TEXT NOT NULL DEFAULT '',
        telephone      TEXT NOT NULL DEFAULT '',
        loyer_cents    INTEGER NOT NULL CHECK (loyer_cents >= 0),
        acompte_cents  INTEGER NOT NULL DEFAULT 0 CHECK (acompte_cents >= 0),
        statut         TEXT NOT NULL CHECK (statut IN ('a_confirmer','acompte','solde','annule')),
        note           TEXT NOT NULL DEFAULT '',
        acces_id       INTEGER REFERENCES acces_temporaire(id),
        cree_le        TEXT NOT NULL,
        cree_par       INTEGER REFERENCES personne(id),
        archive_le     TEXT,
        CHECK (acompte_cents <= loyer_cents)
      );
CREATE TABLE mot_livre_or (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        bien_id    INTEGER NOT NULL REFERENCES bien(id),
        sejour_id  INTEGER REFERENCES sejour(id),
        annee      INTEGER NOT NULL,
        texte      TEXT NOT NULL,
        signature  TEXT NOT NULL DEFAULT '',
        ecrit_le   TEXT NOT NULL,
        ecrit_par  INTEGER REFERENCES personne(id),
        archive_le TEXT
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
      , totp_secret TEXT, totp_pending TEXT, totp_recovery TEXT NOT NULL DEFAULT '[]', totp_last_step INTEGER NOT NULL DEFAULT 0, totp_active_le TEXT, acces_lien_seul INTEGER NOT NULL DEFAULT 0);
CREATE TABLE photo (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        album_id     INTEGER NOT NULL REFERENCES album(id),
        bien_id      INTEGER NOT NULL REFERENCES bien(id),
        fichier_id   TEXT NOT NULL REFERENCES fichier(id),
        vignette_id  TEXT REFERENCES fichier(id),
        legende      TEXT NOT NULL DEFAULT '',
        prise_le     TEXT,
        depose_le    TEXT NOT NULL,
        depose_par   INTEGER REFERENCES personne(id),
        archive_le   TEXT
      );
CREATE TABLE quota (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        saison_id INTEGER NOT NULL REFERENCES saison(id),
        foyer_id  INTEGER NOT NULL REFERENCES foyer(id),
        nuits_max INTEGER NOT NULL CHECK (nuits_max >= 0),
        UNIQUE (saison_id, foyer_id)
      );
CREATE TABLE recurrence (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        bien_id      INTEGER NOT NULL REFERENCES bien(id),
        libelle      TEXT NOT NULL,
        categorie    TEXT NOT NULL CHECK (categorie IN ('obligatoire','saison','courant','inventaire')),
        periodicite  TEXT NOT NULL CHECK (periodicite IN ('annuelle','mensuelle','sejour')),
        -- Pour une récurrence annuelle : la date limite, en 'MM-JJ'.
        limite_mmjj  TEXT,
        -- Pour une récurrence mensuelle : la saison, bornes comprises (1 à 12).
        mois_debut   INTEGER CHECK (mois_debut BETWEEN 1 AND 12),
        mois_fin     INTEGER CHECK (mois_fin BETWEEN 1 AND 12),
        actif        INTEGER NOT NULL DEFAULT 1,
        cree_le      TEXT NOT NULL,
        cree_par     INTEGER REFERENCES personne(id),
        archive_le   TEXT
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
CREATE TABLE scrutin (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        structure_id  INTEGER NOT NULL REFERENCES structure(id),
        bien_id       INTEGER REFERENCES bien(id),
        regle_id      INTEGER NOT NULL REFERENCES regle_decision(id),
        titre         TEXT NOT NULL,
        expose        TEXT NOT NULL DEFAULT '',
        -- Le montant en jeu, quand la décision porte sur une dépense.
        montant_cents INTEGER,
        ouvert_le     TEXT NOT NULL,
        cloture_le    TEXT NOT NULL,
        statut        TEXT NOT NULL CHECK (statut IN ('ouvert','adopte','rejete','annule')),
        -- Le dépouillement, figé lui aussi : recalculer un résultat des années
        -- plus tard, avec un code qui a changé, donnerait une autre réponse.
        depouille_le  TEXT,
        resultat_json TEXT,
        -- La convocation d'assemblée, pour une SCI dont les statuts l'exigent.
        convoque_le   TEXT,
        -- Ce que la décision a engendré, le cas échéant.
        depense_id    INTEGER REFERENCES depense(id),
        tache_id      INTEGER REFERENCES tache(id),
        cree_par      INTEGER REFERENCES personne(id),
        cree_le       TEXT NOT NULL,
        archive_le    TEXT,
        CHECK (cloture_le > ouvert_le)
      );
CREATE TABLE scrutin_voix (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        scrutin_id   INTEGER NOT NULL REFERENCES scrutin(id),
        personne_id  INTEGER NOT NULL REFERENCES personne(id),
        poids        INTEGER NOT NULL CHECK (poids > 0),
        sens         TEXT CHECK (sens IN ('pour','contre','abstention')),
        vote_le      TEXT,
        UNIQUE (scrutin_id, personne_id)
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
        archive_le    TEXT, checklist_envoyee_le TEXT,
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
CREATE TABLE tache (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        bien_id       INTEGER NOT NULL REFERENCES bien(id),
        recurrence_id INTEGER REFERENCES recurrence(id),
        libelle       TEXT NOT NULL,
        detail        TEXT NOT NULL DEFAULT '',
        categorie     TEXT NOT NULL CHECK (categorie IN ('obligatoire','saison','courant','inventaire')),
        echeance      TEXT,
        statut        TEXT NOT NULL CHECK (statut IN ('ouverte','faite','annulee')),
        -- Cocher une tâche demande la date de réalisation : « fait le 12 juin
        -- par Thomas » n'a pas le même sens que « coché aujourd'hui ».
        fait_le       TEXT,
        fait_par_id   INTEGER REFERENCES personne(id),
        cout_cents    INTEGER,
        -- La facture, et la dépense qu'elle a éventuellement créée.
        fichier_id    INTEGER REFERENCES fichier(id),
        depense_id    INTEGER REFERENCES depense(id),
        -- Une tâche née d'un signalement de casse pointe la ligne d'inventaire.
        inventaire_id INTEGER REFERENCES inventaire(id),
        signale_par_id INTEGER REFERENCES personne(id),
        cree_le       TEXT NOT NULL,
        cree_par      INTEGER REFERENCES personne(id),
        archive_le    TEXT,
        -- Une tâche faite porte forcément sa date : sans elle, l'historique ment.
        CHECK ((statut = 'faite') = (fait_le IS NOT NULL))
      );
CREATE TABLE vacance_scolaire (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        annee_scolaire TEXT NOT NULL,
        nom            TEXT NOT NULL,
        zone           TEXT NOT NULL CHECK (zone IN ('A','B','C')),
        debut          TEXT NOT NULL,
        fin            TEXT NOT NULL,
        source         TEXT NOT NULL DEFAULT '',
        importe_le     TEXT NOT NULL,
        importe_par    INTEGER REFERENCES personne(id),
        CHECK (fin >= debut),
        UNIQUE (annee_scolaire, zone, nom, debut)
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
CREATE INDEX idx_acces_bien ON acces_temporaire(bien_id) WHERE revoque_le IS NULL;
CREATE INDEX idx_affichage_code ON code_affichage(code_id, affiche_le);
CREATE INDEX idx_album_bien ON album(bien_id, annee) WHERE archive_le IS NULL;
CREATE UNIQUE INDEX idx_album_sejour ON album(sejour_id) WHERE sejour_id IS NOT NULL;
CREATE INDEX idx_audit_date ON journal_audit(fait_le);
CREATE INDEX idx_audit_objet ON journal_audit(objet_kind, objet_id);
CREATE INDEX idx_bien_structure ON bien(structure_id);
CREATE INDEX idx_checklist_bien ON checklist_ligne(bien_id) WHERE archive_le IS NULL;
CREATE INDEX idx_code_bien ON code_acces(bien_id) WHERE archive_le IS NULL;
CREATE INDEX idx_contact_bien ON contact(bien_id) WHERE archive_le IS NULL;
CREATE INDEX idx_depense_bien_bien ON depense_bien(bien_id);
CREATE INDEX idx_depense_groupe ON depense(groupe_id) WHERE groupe_id IS NOT NULL;
CREATE INDEX idx_depense_structure ON depense(structure_id, date_depense) WHERE archive_le IS NULL;
CREATE INDEX idx_detention_periode ON detention(structure_id, effet_du, effet_au);
CREATE INDEX idx_detention_personne ON detention(personne_id);
CREATE INDEX idx_document_bien ON document(bien_id) WHERE archive_le IS NULL;
CREATE INDEX idx_fiche_bien ON fiche_ligne(bien_id, section) WHERE archive_le IS NULL;
CREATE INDEX idx_fichier_sha ON fichier(sha256);
CREATE INDEX idx_inventaire_bien ON inventaire(bien_id) WHERE archive_le IS NULL;
CREATE INDEX idx_location_bien ON location(bien_id) WHERE archive_le IS NULL;
CREATE INDEX idx_mot_bien ON mot_livre_or(bien_id, annee) WHERE archive_le IS NULL;
CREATE INDEX idx_notification_a_envoyer ON notification(prochaine_tentative)
        WHERE envoye_le IS NULL AND abandonne_le IS NULL;
CREATE INDEX idx_personne_active ON personne(archive_le);
CREATE INDEX idx_photo_album ON photo(album_id) WHERE archive_le IS NULL;
CREATE INDEX idx_regle_periode ON regle_repartition(bien_id, categorie_id, applicable_du, applicable_au);
CREATE INDEX idx_reglement_structure ON reglement(structure_id, statut);
CREATE INDEX idx_reinit_personne ON reinit_mot_de_passe(personne_id, motif)
        WHERE utilise_le IS NULL;
CREATE INDEX idx_role_personne ON role_attribue(personne_id) WHERE archive_le IS NULL;
CREATE INDEX idx_role_structure ON role_attribue(structure_id) WHERE archive_le IS NULL;
CREATE INDEX idx_saison_bien ON saison(bien_id);
CREATE INDEX idx_scrutin_structure ON scrutin(structure_id, statut) WHERE archive_le IS NULL;
CREATE INDEX idx_sejour_demandeur ON sejour(demandeur_id) WHERE archive_le IS NULL;
CREATE UNIQUE INDEX idx_sejour_import ON sejour(import_run_id, import_ligne)
        WHERE import_run_id IS NOT NULL;
CREATE INDEX idx_sejour_plage ON sejour(bien_id, arrivee, depart) WHERE archive_le IS NULL;
CREATE INDEX idx_sejour_statut ON sejour(bien_id, statut) WHERE archive_le IS NULL;
CREATE INDEX idx_session_personne ON session(personne_id) WHERE revoque_le IS NULL;
CREATE INDEX idx_tache_bien ON tache(bien_id, statut) WHERE archive_le IS NULL;
CREATE UNIQUE INDEX idx_tache_occurrence ON tache(recurrence_id, echeance)
        WHERE recurrence_id IS NOT NULL AND archive_le IS NULL;
CREATE INDEX idx_vacance_annee ON vacance_scolaire (annee_scolaire);
CREATE INDEX idx_vacance_periode ON vacance_scolaire (debut, fin);
CREATE INDEX idx_ventilation_personne ON ventilation(personne_id);
CREATE UNIQUE INDEX idx_version_unique ON document_version(document_id, version);
