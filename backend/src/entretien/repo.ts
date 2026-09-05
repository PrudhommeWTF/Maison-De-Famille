// Le dépôt du carnet d'entretien : récurrences, tâches, inventaire, checklist.
//
// L'engendrement des occurrences est **idempotent** : la clé (récurrence,
// échéance) est unique en base, si bien que repasser la génération ne crée pas
// de doublon. C'est ce qui permet de l'appeler au démarrage du service et à
// chaque ouverture de l'écran, sans tenir de registre de ce qui a déjà été fait.
import type { Db } from '../noyau/db';
import { aujourdhui, decale, horodatage } from '../noyau/dates';
import { introuvable } from '../noyau/erreurs';
import { log } from '../noyau/log';
import { Categorie, Periodicite, Recurrence, controler, echeances, pourSejour } from './recurrences';

export interface Tache {
  id: number;
  bienId: number;
  bienNom: string;
  recurrenceId: number | null;
  libelle: string;
  detail: string;
  categorie: Categorie;
  echeance: string | null;
  statut: 'ouverte' | 'faite' | 'annulee';
  faitLe: string | null;
  faitParNom: string | null;
  coutCents: number | null;
  fichierId: string | null;
  depenseId: number | null;
  inventaireId: number | null;
  signaleParNom: string | null;
}

const SELECT_TACHE = `
  SELECT t.id, t.bien_id AS bienId, b.nom AS bienNom, t.recurrence_id AS recurrenceId,
         t.libelle, t.detail, t.categorie, t.echeance, t.statut, t.fait_le AS faitLe,
         f.nom AS faitParNom, t.cout_cents AS coutCents, t.fichier_id AS fichierId,
         t.depense_id AS depenseId, t.inventaire_id AS inventaireId, s.nom AS signaleParNom
  FROM tache t
  JOIN bien b ON b.id = t.bien_id
  LEFT JOIN personne f ON f.id = t.fait_par_id
  LEFT JOIN personne s ON s.id = t.signale_par_id
`;

export function taches(db: Db, bienId: number, statut?: 'ouverte' | 'faite'): Tache[] {
  const filtre = statut ? ' AND t.statut = ?' : '';
  const args: unknown[] = statut ? [bienId, statut] : [bienId];
  return db.prepare(
    `${SELECT_TACHE} WHERE t.bien_id = ? AND t.archive_le IS NULL${filtre}
     ORDER BY CASE WHEN t.echeance IS NULL THEN 1 ELSE 0 END, t.echeance, t.libelle`,
  ).all(...args) as Tache[];
}

/** Les échéances ouvertes de plusieurs biens, pour la tuile du tableau de bord. */
export function echeancesProches(db: Db, biens: readonly number[], limite = 5): Tache[] {
  if (!biens.length) return [];
  const trous = biens.map(() => '?').join(',');
  return db.prepare(
    `${SELECT_TACHE} WHERE t.bien_id IN (${trous}) AND t.archive_le IS NULL
       AND t.statut = 'ouverte' AND t.echeance IS NOT NULL
     ORDER BY t.echeance LIMIT ?`,
  ).all(...biens, limite) as Tache[];
}

export function tache(db: Db, bienId: number, id: number): Tache {
  const t = db.prepare(`${SELECT_TACHE} WHERE t.id = ? AND t.bien_id = ? AND t.archive_le IS NULL`)
    .get(id, bienId) as Tache | undefined;
  // Le contrôle du bien vit ici : une tâche demandée dans le chemin d'un autre
  // bien doit être introuvable, pas simplement invisible à l'écran.
  if (!t) throw introuvable('Cette tâche');
  return t;
}

export interface NouvelleTache {
  bienId: number; libelle: string; detail?: string; categorie: Categorie;
  echeance?: string | null; recurrenceId?: number | null;
  inventaireId?: number | null; signaleParId?: number | null;
}

export function creerTache(db: Db, t: NouvelleTache, parQui: number): number {
  return Number(db.prepare(
    `INSERT INTO tache (bien_id, recurrence_id, libelle, detail, categorie, echeance, statut,
                        inventaire_id, signale_par_id, cree_le, cree_par)
     VALUES (?, ?, ?, ?, ?, ?, 'ouverte', ?, ?, ?, ?)`,
  ).run(t.bienId, t.recurrenceId ?? null, t.libelle, t.detail ?? '', t.categorie,
    t.echeance ?? null, t.inventaireId ?? null, t.signaleParId ?? null,
    horodatage(), parQui).lastInsertRowid);
}

/**
 * Cocher une tâche. La date de réalisation est demandée, jamais déduite de
 * l'horloge : « fait le 12 juin par Thomas » n'a pas le même sens que « coché
 * aujourd'hui », et c'est la première qui fait un carnet d'entretien.
 */
export function marquerFaite(
  db: Db, bienId: number, id: number,
  v: { faitLe: string; coutCents: number | null; fichierId: string | null; depenseId: number | null },
  parQui: number,
): void {
  tache(db, bienId, id);
  db.prepare(
    `UPDATE tache SET statut = 'faite', fait_le = ?, fait_par_id = ?, cout_cents = ?,
                      fichier_id = COALESCE(?, fichier_id), depense_id = COALESCE(?, depense_id)
     WHERE id = ?`,
  ).run(v.faitLe, parQui, v.coutCents, v.fichierId, v.depenseId, id);
  log.info(`Tâche ${id} marquée faite le ${v.faitLe} par la personne ${parQui}.`);
}

export function rouvrir(db: Db, bienId: number, id: number): void {
  tache(db, bienId, id);
  db.prepare("UPDATE tache SET statut = 'ouverte', fait_le = NULL, fait_par_id = NULL WHERE id = ?").run(id);
}

export function archiverTache(db: Db, bienId: number, id: number): void {
  tache(db, bienId, id);
  db.prepare('UPDATE tache SET archive_le = ? WHERE id = ?').run(horodatage(), id);
}

// ---------- Récurrences ----------

const SELECT_RECURRENCE = `
  SELECT id, libelle, categorie, periodicite, limite_mmjj AS limiteMmjj,
         mois_debut AS moisDebut, mois_fin AS moisFin, actif, cree_le AS creeLe
  FROM recurrence
`;

export interface RecurrenceLue extends Recurrence { actif: number; creeLe: string }

export function recurrences(db: Db, bienId: number): RecurrenceLue[] {
  return db.prepare(
    `${SELECT_RECURRENCE} WHERE bien_id = ? AND archive_le IS NULL ORDER BY libelle`,
  ).all(bienId) as RecurrenceLue[];
}

export function creerRecurrence(
  db: Db, bienId: number,
  r: { libelle: string; categorie: Categorie; periodicite: Periodicite;
       limiteMmjj: string | null; moisDebut: number | null; moisFin: number | null },
  parQui: number,
): number {
  controler(r);
  const id = Number(db.prepare(
    `INSERT INTO recurrence (bien_id, libelle, categorie, periodicite, limite_mmjj,
                             mois_debut, mois_fin, cree_le, cree_par)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(bienId, r.libelle, r.categorie, r.periodicite, r.limiteMmjj,
    r.moisDebut, r.moisFin, horodatage(), parQui).lastInsertRowid);
  // La première occurrence est posée tout de suite : une récurrence créée qui
  // n'engendre rien avant le prochain démarrage donne l'impression de n'avoir
  // pas été enregistrée.
  engendrer(db, bienId, parQui);
  return id;
}

export function archiverRecurrence(db: Db, bienId: number, id: number): void {
  const r = db.prepare('SELECT id FROM recurrence WHERE id = ? AND bien_id = ? AND archive_le IS NULL')
    .get(id, bienId);
  if (!r) throw introuvable('Cette récurrence');
  db.prepare('UPDATE recurrence SET archive_le = ?, actif = 0 WHERE id = ?').run(horodatage(), id);
  // Les occurrences déjà faites restent : l'historique du ramonage ne disparaît
  // pas parce qu'on a cessé de le programmer. Seules les tâches ouvertes et non
  // encore échues s'en vont, sinon elles resteraient sans raison d'être.
  db.prepare(
    `UPDATE tache SET archive_le = ? WHERE recurrence_id = ? AND statut = 'ouverte' AND archive_le IS NULL`,
  ).run(horodatage(), id);
}

/**
 * Engendre les occurrences manquantes, sur une fenêtre glissante d'un an.
 *
 * **La fenêtre ne remonte jamais avant la création de la récurrence.** Sans
 * cette borne, une récurrence annuelle créée en septembre 2026 posait aussitôt
 * une échéance « en retard depuis le 15 octobre 2025 », pour une période où
 * elle n'existait pas et où l'application non plus. Un carnet qui s'ouvre sur
 * un manquement imaginaire fait douter de tous les autres. Pour consigner une
 * intervention antérieure, on crée une tâche ponctuelle avec sa date réelle.
 */
export function engendrer(db: Db, bienId: number, parQui: number, maintenant = aujourdhui()): number {
  const au = decale(maintenant, 365);
  const actives = (db.prepare(
    `${SELECT_RECURRENCE} WHERE bien_id = ? AND archive_le IS NULL AND actif = 1`,
  ).all(bienId) as RecurrenceLue[]);

  let creees = 0;
  const inserer = db.prepare(
    `INSERT OR IGNORE INTO tache (bien_id, recurrence_id, libelle, detail, categorie,
                                  echeance, statut, cree_le, cree_par)
     VALUES (?, ?, ?, '', ?, ?, 'ouverte', ?, ?)`,
  );
  db.transaction(() => {
    for (const r of actives) {
      // La plus tardive des deux bornes : jamais avant que la récurrence existe.
      const depuis = r.creeLe.slice(0, 10);
      const du = depuis > decale(maintenant, -365) ? depuis : decale(maintenant, -365);
      for (const e of echeances(r, du, au)) {
        // `INSERT OR IGNORE` s'appuie sur l'index unique (récurrence, échéance)
        // pour l'idempotence : c'est la base qui garantit l'unicité, pas un
        // SELECT préalable qui laisserait une fenêtre entre lecture et écriture.
        const res = inserer.run(bienId, r.id, e.libelle, e.categorie, e.echeance, horodatage(), parQui);
        creees += res.changes;
      }
    }
  })();
  if (creees) log.info(`${creees} échéance(s) d'entretien engendrée(s) pour le bien ${bienId}.`);
  return creees;
}

/**
 * Les occurrences « à chaque séjour ». Appelé quand un séjour est validé : la
 * tâche naît du séjour, pas du calendrier.
 */
export function engendrerPourSejour(
  db: Db, bienId: number, depart: string, parQui: number,
): number {
  const actives = (db.prepare(
    `${SELECT_RECURRENCE} WHERE bien_id = ? AND archive_le IS NULL AND actif = 1 AND periodicite = 'sejour'`,
  ).all(bienId) as RecurrenceLue[]);
  let creees = 0;
  const inserer = db.prepare(
    `INSERT OR IGNORE INTO tache (bien_id, recurrence_id, libelle, detail, categorie,
                                  echeance, statut, cree_le, cree_par)
     VALUES (?, ?, ?, '', ?, ?, 'ouverte', ?, ?)`,
  );
  for (const r of actives) {
    const e = pourSejour(r, depart);
    if (e) creees += inserer.run(bienId, r.id, e.libelle, e.categorie, e.echeance, horodatage(), parQui).changes;
  }
  return creees;
}

// ---------- Inventaire ----------

export interface LigneInventaire {
  id: number; bienId: number; libelle: string; etat: string; ordre: number;
}

export function inventaire(db: Db, bienId: number): LigneInventaire[] {
  return db.prepare(
    `SELECT id, bien_id AS bienId, libelle, etat, ordre FROM inventaire
     WHERE bien_id = ? AND archive_le IS NULL ORDER BY ordre, libelle`,
  ).all(bienId) as LigneInventaire[];
}

export function creerInventaire(db: Db, bienId: number, libelle: string, etat: string, ordre: number): number {
  return Number(db.prepare(
    'INSERT INTO inventaire (bien_id, libelle, etat, ordre, cree_le) VALUES (?, ?, ?, ?, ?)',
  ).run(bienId, libelle, etat, ordre, horodatage()).lastInsertRowid);
}

export function modifierInventaire(db: Db, bienId: number, id: number, libelle: string, etat: string): void {
  const r = db.prepare('SELECT id FROM inventaire WHERE id = ? AND bien_id = ? AND archive_le IS NULL')
    .get(id, bienId);
  if (!r) throw introuvable('Cette ligne d\'inventaire');
  db.prepare('UPDATE inventaire SET libelle = ?, etat = ? WHERE id = ?').run(libelle, etat, id);
}

export function archiverInventaire(db: Db, bienId: number, id: number): void {
  const r = db.prepare('SELECT id FROM inventaire WHERE id = ? AND bien_id = ? AND archive_le IS NULL')
    .get(id, bienId);
  if (!r) throw introuvable('Cette ligne d\'inventaire');
  db.prepare('UPDATE inventaire SET archive_le = ? WHERE id = ?').run(horodatage(), id);
}

/**
 * Le signalement de casse.
 *
 * Note de comportement de la fiche du bien : « Un signalement de casse crée une
 * tâche d'entretien et une ligne d'inventaire à remplacer. » Les deux dans la
 * même transaction : une tâche sans ligne d'inventaire, ou l'inverse, laisserait
 * un état que personne ne saurait interpréter.
 */
export function signalerCasse(
  db: Db, bienId: number, v: { libelle: string; detail: string; inventaireId: number | null },
  parQui: number,
): { tacheId: number; inventaireId: number } {
  return db.transaction(() => {
    let inventaireId = v.inventaireId;
    if (inventaireId) {
      const l = db.prepare('SELECT id FROM inventaire WHERE id = ? AND bien_id = ? AND archive_le IS NULL')
        .get(inventaireId, bienId);
      if (!l) throw introuvable('Cette ligne d\'inventaire');
      db.prepare("UPDATE inventaire SET etat = 'À remplacer' WHERE id = ?").run(inventaireId);
    } else {
      inventaireId = creerInventaire(db, bienId, v.libelle, 'À remplacer', 100);
    }
    const tacheId = creerTache(db, {
      bienId, libelle: `Remplacer ${v.libelle}`, detail: v.detail,
      categorie: 'inventaire', inventaireId, signaleParId: parQui,
    }, parQui);
    log.info(`Casse signalée sur le bien ${bienId} par la personne ${parQui} : ${v.libelle}.`);
    return { tacheId, inventaireId };
  })();
}

// ---------- Checklist de départ ----------

export interface LigneChecklist { id: number; libelle: string; ordre: number }

export function checklist(db: Db, bienId: number): LigneChecklist[] {
  return db.prepare(
    'SELECT id, libelle, ordre FROM checklist_ligne WHERE bien_id = ? AND archive_le IS NULL ORDER BY ordre, id',
  ).all(bienId) as LigneChecklist[];
}

export function creerChecklist(db: Db, bienId: number, libelle: string, ordre: number): number {
  return Number(db.prepare(
    'INSERT INTO checklist_ligne (bien_id, libelle, ordre, cree_le) VALUES (?, ?, ?, ?)',
  ).run(bienId, libelle, ordre, horodatage()).lastInsertRowid);
}

export function archiverChecklist(db: Db, bienId: number, id: number): void {
  const l = db.prepare('SELECT id FROM checklist_ligne WHERE id = ? AND bien_id = ? AND archive_le IS NULL')
    .get(id, bienId);
  if (!l) throw introuvable('Cette ligne de checklist');
  db.prepare('UPDATE checklist_ligne SET archive_le = ? WHERE id = ?').run(horodatage(), id);
}

/**
 * Les séjours dont la checklist doit partir : ceux qui finissent demain et pour
 * lesquels elle n'est pas encore partie.
 *
 * Le marquage sur le séjour est ce qui garantit un envoi unique. Une
 * notification de départ envoyée deux fois n'est pas seulement du bruit : elle
 * fait douter de toutes les autres.
 */
export interface SejourAPrevenir {
  id: number; bienId: number; bienNom: string; demandeurId: number; titre: string;
  arrivee: string; depart: string;
}

export function sejoursAPrevenir(db: Db, jour = aujourdhui()): SejourAPrevenir[] {
  const demain = decale(jour, 1);
  return db.prepare(
    `SELECT s.id, s.bien_id AS bienId, b.nom AS bienNom, s.demandeur_id AS demandeurId,
            s.titre, s.arrivee, s.depart
     FROM sejour s JOIN bien b ON b.id = s.bien_id
     WHERE s.depart = ? AND s.statut = 'valide' AND s.archive_le IS NULL
       AND s.demandeur_id IS NOT NULL AND s.checklist_envoyee_le IS NULL`,
  ).all(demain) as SejourAPrevenir[];
}

export function marquerChecklistEnvoyee(db: Db, sejourId: number): void {
  db.prepare('UPDATE sejour SET checklist_envoyee_le = ? WHERE id = ?').run(horodatage(), sejourId);
}
