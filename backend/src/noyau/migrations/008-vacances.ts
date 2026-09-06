// Migration 008 : le calendrier des vacances scolaires devient une donnée.
//
// **Pourquoi sortir cette table du code.** Elle était une constante compilée
// dans `calendrier/vacances.ts`, ce qui obligeait à modifier le dépôt et à
// redéployer une fois par an. Une famille auto-hébergée n'a pas envie de
// toucher au code pour que février s'affiche : elle téléverse le fichier de
// l'Éducation nationale depuis l'écran Réglages, et c'est fini.
//
// **L'application ne va toujours rien chercher en ligne.** Le brief interdit
// tout appel réseau sortant, et cette règle ne se contourne pas pour un confort
// d'affichage : c'est la famille qui télécharge le fichier officiel et qui le
// dépose. Rien dans cette table n'arrive autrement.
//
// **Une ligne par zone, même quand les trois partagent les mêmes dates.** La
// Toussaint est nationale, mais la stocker une fois avec « zone : toutes »
// obligerait à un champ nullable dans la clé d'unicité, que SQLite traite comme
// toujours distincte, et le remplacement d'une année dupliquerait les lignes.
// Le regroupement pour l'affichage se fait à la lecture, où il ne coûte rien.
import type { Migration } from './index';

/** Le calendrier 2025-2026, celui qui vivait dans le code jusqu'ici. */
const GRAINE: readonly [string, string | null, string, string][] = [
  ['Toussaint', null, '2025-10-18', '2025-11-02'],
  ['Noël', null, '2025-12-20', '2026-01-04'],
  ['Hiver', 'A', '2026-02-07', '2026-02-22'],
  ['Hiver', 'B', '2026-02-14', '2026-03-01'],
  ['Hiver', 'C', '2026-02-21', '2026-03-08'],
  ['Printemps', 'A', '2026-04-04', '2026-04-19'],
  ['Printemps', 'B', '2026-04-11', '2026-04-26'],
  ['Printemps', 'C', '2026-04-18', '2026-05-03'],
  ['Été', null, '2026-07-04', '2026-08-31'],
];

export const migration008: Migration = {
  version: 8,
  libelle: 'Calendrier des vacances scolaires en base',
  up(db) {
    db.exec(`
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

      CREATE INDEX idx_vacance_periode ON vacance_scolaire (debut, fin);
      CREATE INDEX idx_vacance_annee ON vacance_scolaire (annee_scolaire);
    `);

    const insert = db.prepare(`
      INSERT INTO vacance_scolaire (annee_scolaire, nom, zone, debut, fin, source, importe_le, importe_par)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `);
    const quand = new Date().toISOString();
    for (const [nom, zone, debut, fin] of GRAINE) {
      for (const z of zone ? [zone] : ['A', 'B', 'C']) {
        insert.run('2025-2026', nom, z, debut, fin, "Table livrée avec l'application", quand);
      }
    }
  },
};
