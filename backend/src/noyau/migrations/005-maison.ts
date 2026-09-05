// Migration 005 : la maison.
//
// Carnet d'entretien, fiche complète du bien, carnet d'adresses et coffre-fort.
//
// Deux choix de modélisation méritent d'être expliqués ici, parce qu'ils se
// paieraient cher plus tard :
//
// **Une tâche naît d'une récurrence, elle ne s'y confond pas.** La récurrence
// dit « tous les ans avant le 15 octobre » ; la tâche est l'occurrence de cette
// année, avec sa date limite, son état et sa facture. Fusionner les deux
// interdirait de garder l'historique : on ne saurait plus si le ramonage de
// 2025 a été fait, seulement quand le prochain est dû.
//
// **Un code d'accès est chiffré, un document ne l'est pas.** Le code tient en
// quelques caractères et se lit d'un coup d'oeil dans un fichier de base
// volé ; le document est un fichier du disque, servi derrière autorisation et
// portant un nom non devinable. Chiffrer les documents demanderait de garder la
// clé à côté d'eux pour les servir, ce qui ne protégerait de rien, et
// empêcherait l'export en archive que la maquette demande explicitement.
import type { Migration } from './index';

export const migration005: Migration = {
  version: 5,
  libelle: 'La maison : entretien, fiche, carnet d\'adresses et coffre-fort',
  up(db) {
    db.exec(`
      -- ---------- Carnet d'entretien ----------

      -- La règle : « tous les ans », « tous les mois d'avril à octobre »,
      -- « à chaque séjour ». Elle engendre des tâches, elle n'en est pas une.
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

      -- Une occurrence par récurrence et par échéance, jamais deux.
      CREATE UNIQUE INDEX idx_tache_occurrence ON tache(recurrence_id, echeance)
        WHERE recurrence_id IS NOT NULL AND archive_le IS NULL;
      CREATE INDEX idx_tache_bien ON tache(bien_id, statut) WHERE archive_le IS NULL;

      -- ---------- Inventaire et fiche ----------

      CREATE TABLE inventaire (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        bien_id    INTEGER NOT NULL REFERENCES bien(id),
        libelle    TEXT NOT NULL,
        etat       TEXT NOT NULL DEFAULT '',
        ordre      INTEGER NOT NULL DEFAULT 0,
        cree_le    TEXT NOT NULL,
        archive_le TEXT
      );
      CREATE INDEX idx_inventaire_bien ON inventaire(bien_id) WHERE archive_le IS NULL;

      -- Caractéristiques et guide d'arrivée : même forme (une clé, une valeur,
      -- un ordre), deux sections. Deux tables n'auraient rien apporté.
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
      CREATE INDEX idx_fiche_bien ON fiche_ligne(bien_id, section) WHERE archive_le IS NULL;

      -- ---------- Carnet d'adresses ----------

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
      CREATE INDEX idx_contact_bien ON contact(bien_id) WHERE archive_le IS NULL;

      -- ---------- Coffre-fort ----------

      -- La portée est portée par l'élément, pas par le rôle de qui le dépose :
      -- c'est ce qui permet de répondre « qui voit ce document » sans parcourir
      -- les personnes.
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
      CREATE INDEX idx_document_bien ON document(bien_id) WHERE archive_le IS NULL;

      -- Versionné : déposer à nouveau n'écrase pas, il ajoute. Une attestation
      -- d'assurance périmée reste consultable, ce qui est exactement ce qu'on
      -- veut le jour d'un sinistre survenu l'an dernier.
      CREATE TABLE document_version (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id   INTEGER NOT NULL REFERENCES document(id),
        fichier_id    INTEGER NOT NULL REFERENCES fichier(id),
        version       INTEGER NOT NULL,
        note          TEXT NOT NULL DEFAULT '',
        depose_le     TEXT NOT NULL,
        depose_par_id INTEGER REFERENCES personne(id)
      );
      CREATE UNIQUE INDEX idx_version_unique ON document_version(document_id, version);

      -- valeur_chiffree porte le nonce, l'étiquette d'authentification et le
      -- texte chiffré. La clé ne vit jamais dans le répertoire de données : une
      -- sauvegarde de la base seule ne rend donc aucun code.
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
      CREATE INDEX idx_code_bien ON code_acces(bien_id) WHERE archive_le IS NULL;

      -- « L'affichage d'un code est journalisé avec l'auteur et l'horodatage »
      -- (note de comportement du coffre-fort). Table dédiée plutôt que journal
      -- général : on veut pouvoir répondre « qui a vu CE code » sans filtrer
      -- tout l'audit de l'instance.
      CREATE TABLE code_affichage (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        code_id     INTEGER NOT NULL REFERENCES code_acces(id),
        personne_id INTEGER NOT NULL REFERENCES personne(id),
        affiche_le  TEXT NOT NULL,
        adresse_ip  TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX idx_affichage_code ON code_affichage(code_id, affiche_le);

      -- ---------- Checklist de départ ----------

      CREATE TABLE checklist_ligne (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        bien_id    INTEGER NOT NULL REFERENCES bien(id),
        libelle    TEXT NOT NULL,
        ordre      INTEGER NOT NULL DEFAULT 0,
        cree_le    TEXT NOT NULL,
        archive_le TEXT
      );
      CREATE INDEX idx_checklist_bien ON checklist_ligne(bien_id) WHERE archive_le IS NULL;

      -- L'envoi de la checklist est marqué sur le séjour : une notification
      -- envoyée deux fois est pire que pas envoyée du tout.
      ALTER TABLE sejour ADD COLUMN checklist_envoyee_le TEXT;
    `);
  },
};
