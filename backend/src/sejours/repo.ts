// Les séjours : calendrier, demandes, arbitrage.
//
// Toutes les lectures prennent la liste des biens autorisés en paramètre et
// filtrent en SQL. Il n'y a nulle part de « on récupère tout puis on filtre à
// l'affichage » : le serveur ne lit jamais ce qu'il n'a pas le droit de rendre.
import type { Db } from '../noyau/db';
import { horodatage, nuits } from '../noyau/dates';
import { etatInvalide, introuvable } from '../noyau/erreurs';
import { Conflit, Occupation, detecter } from './conflits';

export type Nature = 'famille' | 'location' | 'entretien';
export type Statut = 'demande' | 'valide' | 'a_revoir' | 'annule';
export type Origine = 'app' | 'gerante' | 'import';

export interface Sejour {
  id: number; bienId: number; bienNom: string;
  demandeurId: number | null; demandeurNom: string | null;
  foyerId: number | null; foyerNom: string | null;
  titre: string; arrivee: string; depart: string; nuits: number; occupants: number;
  nature: Nature; statut: Statut; note: string; origine: Origine;
  creeLe: string; decideLe: string | null; decideParNom: string | null; decisionNote: string;
}

interface LigneSejour {
  id: number; bien_id: number; bien_nom: string; demandeur_id: number | null; demandeur_nom: string | null;
  foyer_id: number | null; foyer_nom: string | null; titre: string; arrivee: string; depart: string;
  occupants: number; nature: Nature; statut: Statut; note: string; origine: Origine;
  cree_le: string; decide_le: string | null; decide_par_nom: string | null; decision_note: string;
}

const SELECT = `
  SELECT s.id, s.bien_id, b.nom AS bien_nom, s.demandeur_id, d.nom AS demandeur_nom,
         s.foyer_id, f.nom AS foyer_nom, s.titre, s.arrivee, s.depart, s.occupants,
         s.nature, s.statut, s.note, s.origine, s.cree_le, s.decide_le,
         g.nom AS decide_par_nom, s.decision_note
  FROM sejour s
  JOIN bien b ON b.id = s.bien_id
  LEFT JOIN personne d ON d.id = s.demandeur_id
  LEFT JOIN personne g ON g.id = s.decide_par
  LEFT JOIN foyer f ON f.id = s.foyer_id
`;

const vers = (l: LigneSejour): Sejour => ({
  id: l.id, bienId: l.bien_id, bienNom: l.bien_nom,
  demandeurId: l.demandeur_id, demandeurNom: l.demandeur_nom,
  foyerId: l.foyer_id, foyerNom: l.foyer_nom,
  titre: l.titre || l.demandeur_nom || 'Séjour',
  arrivee: l.arrivee, depart: l.depart, nuits: nuits(l.arrivee, l.depart), occupants: l.occupants,
  nature: l.nature, statut: l.statut, note: l.note, origine: l.origine,
  creeLe: l.cree_le, decideLe: l.decide_le, decideParNom: l.decide_par_nom, decisionNote: l.decision_note,
});

/** Le titre affiché sur la grille : ce que le calendrier doit montrer, jamais un identifiant. */
const marqueurs = (ids: readonly number[]): string => ids.map(() => '?').join(',');

/**
 * Les séjours d'un ensemble de biens, sur une plage. La plage est comparée avec
 * la convention des nuits : un séjour compte s'il occupe au moins une nuit de
 * la plage demandée.
 */
export function surPlage(db: Db, biensAutorises: readonly number[], du: string, au: string): Sejour[] {
  if (!biensAutorises.length) return [];
  return (db.prepare(`
    ${SELECT}
    WHERE s.bien_id IN (${marqueurs(biensAutorises)}) AND s.archive_le IS NULL
      AND s.statut <> 'annule' AND s.arrivee < ? AND s.depart > ?
    ORDER BY s.arrivee, s.id
  `).all(...biensAutorises, au, du) as LigneSejour[]).map(vers);
}

/** Les occupations d'un bien, pour la détection de conflits. */
export function occupationsDe(db: Db, bienId: number): Occupation[] {
  return (db.prepare(`
    SELECT id, arrivee, depart, occupants, nature, statut,
           COALESCE(NULLIF(titre, ''), (SELECT nom FROM personne WHERE id = sejour.demandeur_id), 'Séjour') AS titre
    FROM sejour WHERE bien_id = ? AND archive_le IS NULL
  `).all(bienId) as Occupation[]);
}

export function sejour(db: Db, id: number): Sejour {
  const l = db.prepare(`${SELECT} WHERE s.id = ?`).get(id) as LigneSejour | undefined;
  if (!l) throw introuvable('Ce séjour');
  return vers(l);
}

/** La file d'attente de la gérante : les demandes en attente des biens autorisés. */
export function enAttente(db: Db, biensAutorises: readonly number[]): Sejour[] {
  if (!biensAutorises.length) return [];
  return (db.prepare(`
    ${SELECT}
    WHERE s.bien_id IN (${marqueurs(biensAutorises)}) AND s.statut = 'demande' AND s.archive_le IS NULL
    ORDER BY s.arrivee, s.cree_le
  `).all(...biensAutorises) as LigneSejour[]).map(vers);
}

export function compterEnAttente(db: Db, biensAutorises: readonly number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (!biensAutorises.length) return out;
  const lignes = db.prepare(`
    SELECT bien_id, COUNT(*) AS n FROM sejour
    WHERE bien_id IN (${marqueurs(biensAutorises)}) AND statut = 'demande' AND archive_le IS NULL
    GROUP BY bien_id
  `).all(...biensAutorises) as { bien_id: number; n: number }[];
  for (const l of lignes) out.set(l.bien_id, l.n);
  return out;
}

/** Les prochains séjours, pour le tableau de bord. */
export function aVenir(db: Db, biensAutorises: readonly number[], depuis: string, limite = 6): Sejour[] {
  if (!biensAutorises.length) return [];
  return (db.prepare(`
    ${SELECT}
    WHERE s.bien_id IN (${marqueurs(biensAutorises)}) AND s.archive_le IS NULL
      AND s.statut = 'valide' AND s.depart > ?
    ORDER BY s.arrivee LIMIT ?
  `).all(...biensAutorises, depuis, limite) as LigneSejour[]).map(vers);
}

export interface Creation {
  bienId: number; demandeurId: number | null; foyerId: number | null; titre: string;
  arrivee: string; depart: string; occupants: number; nature: Nature; note: string;
  origine: Origine; statut: Statut;
  importRunId?: number; importLigne?: number;
}

export function creer(db: Db, c: Creation, parQui: number | null): number {
  if (c.depart <= c.arrivee) throw etatInvalide('La date de départ doit être après la date d\'arrivée.');
  return Number(db.prepare(`
    INSERT INTO sejour (bien_id, demandeur_id, foyer_id, titre, arrivee, depart, occupants, nature,
                        statut, note, origine, cree_le, cree_par, decide_le, decide_par,
                        import_run_id, import_ligne)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    c.bienId, c.demandeurId, c.foyerId, c.titre, c.arrivee, c.depart, c.occupants, c.nature,
    c.statut, c.note, c.origine, horodatage(), parQui,
    // Un séjour saisi directement par la gérante est décidé au moment où elle le
    // saisit : c'est le cas réel des demandes qui arrivent par téléphone.
    c.statut === 'valide' ? horodatage() : null, c.statut === 'valide' ? parQui : null,
    c.importRunId ?? null, c.importLigne ?? null,
  ).lastInsertRowid);
}

/**
 * L'arbitrage. La gérante peut valider malgré un conflit : elle arbitre depuis
 * toujours, et l'application ne décide pas à sa place. Le passage en force est
 * journalisé, avec les conflits qui étaient affichés au moment de la décision.
 */
export function decider(
  db: Db, id: number, statut: 'valide' | 'a_revoir', note: string, parQui: number, conflits: readonly Conflit[],
): void {
  db.transaction(() => {
    db.prepare('UPDATE sejour SET statut = ?, decide_le = ?, decide_par = ?, decision_note = ? WHERE id = ?')
      .run(statut, horodatage(), parQui, note, id);
    if (statut === 'valide' && conflits.length) {
      db.prepare(`
        INSERT INTO journal_audit (acteur_id, action, objet_kind, objet_id, detail_json, fait_le)
        VALUES (?, 'sejour.validation_malgre_conflit', 'sejour', ?, ?, ?)
      `).run(parQui, id, JSON.stringify({ conflits: conflits.map((c) => c.message) }), horodatage());
    }
  })();
}

/** Annuler une décision la ramène en attente, sans effacer qu'elle a eu lieu. */
export function annulerDecision(db: Db, id: number, parQui: number): void {
  db.transaction(() => {
    db.prepare("UPDATE sejour SET statut = 'demande', decide_le = NULL, decide_par = NULL, decision_note = '' WHERE id = ?").run(id);
    db.prepare(`
      INSERT INTO journal_audit (acteur_id, action, objet_kind, objet_id, detail_json, fait_le)
      VALUES (?, 'sejour.decision_annulee', 'sejour', ?, '{}', ?)
    `).run(parQui, id, horodatage());
  })();
}

export function annuler(db: Db, id: number, parQui: number): void {
  db.prepare("UPDATE sejour SET statut = 'annule', decide_le = ?, decide_par = ? WHERE id = ?")
    .run(horodatage(), parQui, id);
}

/** Les conflits d'un séjour existant, recalculés à la demande. */
export function conflitsDe(db: Db, s: Sejour, couchages: number): Conflit[] {
  return detecter(
    { arrivee: s.arrivee, depart: s.depart, occupants: s.occupants, sejourId: s.id },
    occupationsDe(db, s.bienId), couchages,
  );
}
