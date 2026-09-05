// Migration 003 : l'argent.
//
// Dépenses, règles de répartition datées, ventilations figées, règlements et
// appels de fonds.
//
// Deux choix de modélisation gouvernent cette migration, et ils répondent tous
// deux à la même exigence : **une répartition passée doit rester juste**.
//
//   1. Une **règle de répartition porte une date d'application**, comme une
//      détention. Changer la règle d'une catégorie ouvre une nouvelle période
//      et ferme l'ancienne : les dépenses de l'an dernier gardent la règle qui
//      s'appliquait alors.
//   2. Une **ventilation est calculée une fois et gelée**, avec sa
//      justification complète. Ni un changement de parts, ni un changement de
//      règle ne la recalcule. Un recalcul reste possible, mais explicite,
//      motivé, et l'ancienne version est conservée.
import type { Migration } from './index';

export const migration003: Migration = {
  version: 3,
  libelle: 'Argent : dépenses, règles datées, ventilations figées, règlements',
  up(db) {
    db.exec(`
      -- ============================================================
      -- Catégories et règles
      -- ============================================================

      CREATE TABLE categorie_depense (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        code    TEXT NOT NULL UNIQUE,
        libelle TEXT NOT NULL,
        ordre   INTEGER NOT NULL,
        actif   INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
      );

      -- La règle porte une date d'application. La pastille cyclable de l'écran
      -- des dépenses écrit une NOUVELLE ligne et ferme l'ancienne : elle ne fait
      -- jamais un UPDATE, sinon le passé changerait de sens en silence.
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
      CREATE INDEX idx_regle_periode ON regle_repartition(bien_id, categorie_id, applicable_du, applicable_au);

      -- ============================================================
      -- Dépenses
      -- ============================================================

      -- Une dépense qui sert à plusieurs STRUCTURES (l'assurance des deux biens,
      -- alors que l'un est en indivision et l'autre en SCI) ne peut pas être une
      -- seule écriture : l'argent est dû dans deux pots distincts, et une
      -- dépense de SCI n'entre jamais dans les comptes de l'indivision.
      --
      -- Elle devient donc une dépense par structure, réunies par ce groupe. La
      -- maquette l'affiche comme une seule ligne « les deux biens », les comptes
      -- restent séparés, et la vue consolidée en somme les morceaux.
      CREATE TABLE depense_groupe (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        libelle             TEXT NOT NULL,
        montant_total_cents INTEGER NOT NULL CHECK (montant_total_cents > 0),
        cree_le             TEXT NOT NULL,
        cree_par            INTEGER REFERENCES personne(id)
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
      CREATE INDEX idx_depense_structure ON depense(structure_id, date_depense) WHERE archive_le IS NULL;
      CREATE INDEX idx_depense_groupe ON depense(groupe_id) WHERE groupe_id IS NOT NULL;

      -- Le rattachement aux biens, avec un poids. Une assurance sur deux biens
      -- d'une même structure s'écrit deux lignes à 1/2, sur trois biens trois
      -- lignes à 1/3, ou au prorata des surfaces si c'est plus juste. La valeur
      -- magique « both » du modèle suggéré aurait cassé au troisième bien.
      CREATE TABLE depense_bien (
        depense_id INTEGER NOT NULL REFERENCES depense(id),
        bien_id    INTEGER NOT NULL REFERENCES bien(id),
        poids_num  INTEGER NOT NULL CHECK (poids_num > 0),
        poids_den  INTEGER NOT NULL CHECK (poids_den > 0),
        PRIMARY KEY (depense_id, bien_id)
      );
      CREATE INDEX idx_depense_bien_bien ON depense_bien(bien_id);

      -- ============================================================
      -- Ventilations : ce qui est figé
      -- ============================================================

      -- calcul_json porte la justification complète, produite par la même
      -- fonction que les montants : les deux ne peuvent pas diverger. C'est ce
      -- qui permet d'expliquer un chiffre en un clic, des années plus tard,
      -- même si les parts et les règles ont changé depuis.
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
      CREATE INDEX idx_ventilation_personne ON ventilation(personne_id);

      -- Un recalcul est possible, mais explicite et motivé. L'ancienne
      -- ventilation est conservée : c'est ce qui permet de répondre à
      -- « pourquoi ce chiffre a-t-il changé ».
      CREATE TABLE ventilation_recalcul (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        depense_id INTEGER NOT NULL REFERENCES depense(id),
        avant_json TEXT NOT NULL,
        apres_json TEXT NOT NULL,
        motif      TEXT NOT NULL,
        fait_le    TEXT NOT NULL,
        fait_par   INTEGER REFERENCES personne(id)
      );

      -- ============================================================
      -- Règlements et appels de fonds
      -- ============================================================

      -- de_id et vers_id valent 0 pour désigner la STRUCTURE elle-même (le
      -- compte commun). Il n'y a donc pas de clé étrangère vers personne : une
      -- contrainte refuserait le zéro, et inventer une personne fictive « la
      -- SCI » polluerait la liste des membres partout ailleurs.
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
      CREATE INDEX idx_reglement_structure ON reglement(structure_id, statut);

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
    `);

    // Les catégories de la maquette. Ce sont des données, pas du code : elles
    // s'ajoutent et se désactivent depuis l'application sans redéploiement.
    const inserer = db.prepare('INSERT INTO categorie_depense (code, libelle, ordre) VALUES (?, ?, ?)');
    const categories: [string, string][] = [
      ['taxe_fonciere', 'Taxe foncière'],
      ['assurance', 'Assurance habitation'],
      ['energie', 'Énergie, eau, internet'],
      ['menage', 'Ménage et linge'],
      ['travaux', 'Travaux et gros entretien'],
      ['courses', 'Courses et consommables'],
    ];
    categories.forEach(([code, libelle], i) => inserer.run(code, libelle, i + 1));
  },
};
