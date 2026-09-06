// L'accès à la table des vacances scolaires.
//
// **Pourquoi un remplacement et non un archivage.** La règle du projet est que
// rien ne se supprime, et elle vaut pour les données de la famille : un séjour
// annulé, une personne sortie de l'indivision, un bien retiré. Ce n'en est pas.
// C'est une **copie locale d'un arrêté ministériel**, sans auteur ni histoire,
// que l'on rafraîchit quand le ministère publie. Garder les versions
// successives d'une même année scolaire n'apprendrait rien à personne et
// obligerait chaque lecture à trancher entre deux vérités. Un import remplace
// donc l'année qu'il apporte, et ne touche à aucune autre.
import type { Db } from '../noyau/db';
import { horodatage } from '../noyau/dates';
import { Periode, PeriodeAnnuelle, collapser } from './vacances';

export interface AnneeImportee {
  anneeScolaire: string;
  periodes: number;
  debut: string;
  fin: string;
  source: string;
  importeLe: string;
  importePar: string | null;
}

/** Les années scolaires présentes en base, triées. */
export const anneesCouvertes = (db: Db): string[] =>
  (db.prepare('SELECT DISTINCT annee_scolaire AS a FROM vacance_scolaire ORDER BY a').all() as { a: string }[])
    .map((r) => r.a);

/**
 * Ce que l'écran Réglages affiche : une ligne par année scolaire connue.
 *
 * `source`, `importe_le` et le nom de l'auteur sont pris tels quels dans le
 * groupe, sans agrégat : une année scolaire est écrite d'un seul tenant, dans
 * une seule transaction, donc les trois valeurs sont les mêmes sur toutes ses
 * lignes.
 */
export const resume = (db: Db): AnneeImportee[] => db.prepare(`
  SELECT v.annee_scolaire AS anneeScolaire, COUNT(*) AS periodes,
         MIN(v.debut) AS debut, MAX(v.fin) AS fin,
         v.source AS source, v.importe_le AS importeLe, p.nom AS importePar
  FROM vacance_scolaire v LEFT JOIN personne p ON p.id = v.importe_par
  GROUP BY v.annee_scolaire
  ORDER BY v.annee_scolaire DESC
`).all() as AnneeImportee[];

/** Les périodes qui recoupent `[du, au]`, regroupées pour l'affichage. */
export function periodesEntre(db: Db, du: string, au: string): Periode[] {
  const lignes = db.prepare(`
    SELECT annee_scolaire AS anneeScolaire, nom, zone, debut, fin FROM vacance_scolaire
    WHERE fin >= ? AND debut <= ?
  `).all(du, au) as PeriodeAnnuelle[];
  return collapser(lignes);
}

export interface Remplacement {
  annees: string[];
  ecrites: number;
  remplacees: number;
}

/** Écrit les périodes, une année scolaire à la fois, en remplaçant l'existant. */
export function remplacer(db: Db, periodes: readonly PeriodeAnnuelle[], source: string, personneId: number): Remplacement {
  const annees = [...new Set(periodes.map((p) => p.anneeScolaire))].sort();
  const quand = horodatage();
  const effacer = db.prepare('DELETE FROM vacance_scolaire WHERE annee_scolaire = ?');
  const inserer = db.prepare(`
    INSERT INTO vacance_scolaire (annee_scolaire, nom, zone, debut, fin, source, importe_le, importe_par)
    VALUES (@anneeScolaire, @nom, @zone, @debut, @fin, @source, @importeLe, @importePar)
  `);

  return db.transaction((): Remplacement => {
    let remplacees = 0;
    for (const a of annees) remplacees += effacer.run(a).changes;
    for (const p of periodes) {
      inserer.run({ ...p, source: source.slice(0, 200), importeLe: quand, importePar: personneId || null });
    }
    return { annees, ecrites: periodes.length, remplacees };
  })();
}
