// Migration 007 : location saisonnière et souvenirs.
//
// **Une réservation locative est un séjour.** Elle ne vit pas dans une table
// parallèle : elle porte `nature = 'location'` sur `sejour`, et elle bloque le
// calendrier comme n'importe quel séjour de famille. C'est la seule façon que
// la détection de conflit fonctionne sans la réécrire, et surtout que
// l'avertissement de la maquette soit possible : « les semaines famille sont
// posées avant l'ouverture à la location ; l'inverse déclenche une alerte ».
// Deux calendriers séparés auraient rendu ce contrôle impossible à faire
// autrement qu'en les recollant à la main.
//
// `location` porte ce que le séjour ne sait pas dire : le locataire, le loyer,
// l'acompte, l'état du règlement.
//
// **Les charges déductibles sont des dépenses ordinaires**, marquées d'un
// drapeau. Une table de charges locatives séparée aurait dupliqué la
// ventilation, les justificatifs et les soldes de la tranche 2, et fait
// diverger deux comptabilités qui doivent rester une seule.
import type { Migration } from './index';

export const migration007: Migration = {
  version: 7,
  libelle: 'Location saisonnière et albums de souvenirs',
  up(db) {
    db.exec(`
      -- ---------- Location saisonnière ----------

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
      CREATE INDEX idx_location_bien ON location(bien_id) WHERE archive_le IS NULL;

      -- Une dépense marquée « charge de location » se déduit des loyers au lieu
      -- d'être répartie comme une charge ordinaire. Le drapeau vit sur la
      -- dépense pour que rien ne se dédouble.
      ALTER TABLE depense ADD COLUMN charge_location INTEGER NOT NULL DEFAULT 0
        CHECK (charge_location IN (0,1));

      -- ---------- Souvenirs ----------

      -- Un album par séjour, plus un album libre par bien pour ce qui ne se
      -- rattache à aucun séjour précis.
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
      CREATE UNIQUE INDEX idx_album_sejour ON album(sejour_id) WHERE sejour_id IS NOT NULL;
      CREATE INDEX idx_album_bien ON album(bien_id, annee) WHERE archive_le IS NULL;

      -- bien_id est recopié depuis l'album : c'est ce qui permet de filtrer en
      -- SQL sans jointure, et donc de garantir qu'une photo d'un bien ne peut
      -- pas apparaître dans l'album de l'autre, même par erreur de requête.
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
      CREATE INDEX idx_photo_album ON photo(album_id) WHERE archive_le IS NULL;

      -- Le livre d'or : les mots laissés en fin de séjour, un fil par année.
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
      CREATE INDEX idx_mot_bien ON mot_livre_or(bien_id, annee) WHERE archive_le IS NULL;
    `);
  },
};
