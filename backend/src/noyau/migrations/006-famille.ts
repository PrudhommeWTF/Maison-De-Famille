// Migration 006 : la famille.
//
// Décisions et scrutins, et accès temporaires par lien.
//
// **Les voix sont figées à l'ouverture.** C'est le choix structurant de cette
// migration : `scrutin_voix` porte le poids de chaque votant tel qu'il était au
// moment où le scrutin s'est ouvert, recopié depuis les détentions en vigueur à
// cette date. Recalculer les poids au dépouillement rendrait le résultat
// dépendant d'un événement postérieur au vote, et un indivisaire qui cède ses
// parts au milieu d'un scrutin changerait le sens des voix déjà exprimées, y
// compris la sienne. Un scrutin est une photographie, pas une vue.
//
// **Un accès temporaire crée une personne.** Plutôt qu'un second mécanisme
// d'authentification parallèle, un lien d'invité ouvre une personne sans mot de
// passe et un `role_attribue` daté, avec sa `fin`. Tout le reste de
// l'application (portées, journal d'affichage des codes, notifications)
// fonctionne alors sans savoir que ce visiteur est arrivé par un lien, et la
// règle de portée du coffre-fort s'applique sans une ligne de plus. La date de
// fin du rôle est ce qui coupe l'accès aux sessions déjà ouvertes : le jeton,
// lui, empêche seulement d'en ouvrir de nouvelles.
//
// `acces_lien_seul` marque ces personnes. Sans ce drapeau, quelqu'un ayant reçu
// un lien de locataire pourrait passer par « mot de passe oublié » et se
// transformer en compte permanent, puisque cette route sert désormais les
// comptes jamais activés.
import type { Migration } from './index';

export const migration006: Migration = {
  version: 6,
  libelle: 'La famille : décisions, scrutins et accès temporaires',
  up(db) {
    db.exec(`
      -- ---------- Décisions et scrutins ----------

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
      CREATE INDEX idx_scrutin_structure ON scrutin(structure_id, statut) WHERE archive_le IS NULL;

      -- Une ligne par électeur, posée à l'ouverture. Le poids ne bouge plus.
      -- sens à NULL est une abstention, et elle reste visible jusqu'au
      -- dépouillement : c'est la note de comportement de la maquette.
      CREATE TABLE scrutin_voix (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        scrutin_id   INTEGER NOT NULL REFERENCES scrutin(id),
        personne_id  INTEGER NOT NULL REFERENCES personne(id),
        poids        INTEGER NOT NULL CHECK (poids > 0),
        sens         TEXT CHECK (sens IN ('pour','contre','abstention')),
        vote_le      TEXT,
        UNIQUE (scrutin_id, personne_id)
      );

      -- ---------- Accès temporaires ----------

      -- Une personne ouverte par un lien : pas de mot de passe, jamais.
      ALTER TABLE personne ADD COLUMN acces_lien_seul INTEGER NOT NULL DEFAULT 0;

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
      CREATE INDEX idx_acces_bien ON acces_temporaire(bien_id) WHERE revoque_le IS NULL;
    `);
  },
};
