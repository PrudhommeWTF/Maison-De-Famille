// Dépenses, règles, ventilations, soldes et règlements.
//
// Toutes les écritures passent par ici, en transactions courtes. Deux règles
// gouvernent ce fichier, et elles ne se contournent pas :
//
//   1. **Une ventilation est écrite une fois, à la saisie, avec sa
//      justification.** Aucune lecture ne la recalcule. Le seul chemin qui la
//      modifie est `recalculer()`, qui exige un motif et conserve l'ancienne.
//   2. **Les soldes ne sont jamais stockés.** Ils se dérivent des dépenses, des
//      ventilations et des règlements confirmés, à chaque affichage.
import type { Db } from '../noyau/db';
import { aujourdhui, horodatage, nuits } from '../noyau/dates';
import { conflit, etatInvalide, introuvable } from '../noyau/erreurs';
import { log } from '../noyau/log';
import { partsALaDate } from '../patrimoine/parts';
import { detentionsDe } from '../patrimoine/repo';
import {
  Detenteur, Justification, PartBien, Regle, RepartitionImpossible, repartirSurBiens,
} from './repartition';
import { DepenseSolde, ReglementSolde, STRUCTURE, Solde, Virement, calculer, virements } from './soldes';

// ============================================================
// Catégories
// ============================================================

export interface Categorie { id: number; code: string; libelle: string; ordre: number; actif: boolean }

interface LigneCategorie { id: number; code: string; libelle: string; ordre: number; actif: number }

export const categories = (db: Db): Categorie[] =>
  (db.prepare('SELECT id, code, libelle, ordre, actif FROM categorie_depense ORDER BY ordre')
    .all() as LigneCategorie[]).map((c) => ({ ...c, actif: !!c.actif }));

// ============================================================
// Règles de répartition, datées
// ============================================================

export interface RegleEnVigueur { id: number; regle: Regle; applicableDu: string }

/** La règle en vigueur pour ce bien et cette catégorie, à une date donnée. */
export function regleALaDate(db: Db, bienId: number, categorieId: number, date: string): RegleEnVigueur {
  const l = db.prepare(`
    SELECT id, regle, applicable_du AS applicableDu FROM regle_repartition
    WHERE bien_id = ? AND categorie_id = ? AND applicable_du <= ?
      AND (applicable_au IS NULL OR applicable_au > ?)
    ORDER BY applicable_du DESC LIMIT 1
  `).get(bienId, categorieId, date, date) as RegleEnVigueur | undefined;
  // Aucune règle saisie : les quotes-parts sont le défaut le moins surprenant,
  // et l'écran des règles le montre comme tel.
  return l ?? { id: 0, regle: 'quotes_parts', applicableDu: '1900-01-01' };
}

export const reglesDuBien = (db: Db, bienId: number, date: string): Map<number, RegleEnVigueur> =>
  new Map(categories(db).map((c) => [c.id, regleALaDate(db, bienId, c.id, date)]));

/**
 * Change la règle d'une catégorie, à partir d'une date.
 *
 * La ligne en vigueur est **fermée**, une nouvelle est ouverte. Les dépenses
 * déjà saisies gardent leur ventilation : elles ne sont pas recalculées, et
 * c'est tout l'intérêt du procédé.
 */
export function changerRegle(
  db: Db, bienId: number, categorieId: number, regle: Regle, applicableDu: string, parQui: number,
): void {
  const courante = db.prepare(`
    SELECT id, applicable_du AS du FROM regle_repartition
    WHERE bien_id = ? AND categorie_id = ? AND (applicable_au IS NULL OR applicable_au > ?)
    ORDER BY applicable_du DESC LIMIT 1
  `).get(bienId, categorieId, applicableDu) as { id: number; du: string } | undefined;

  if (courante && courante.du > applicableDu) {
    throw etatInvalide(
      `Une règle existe déjà à partir du ${courante.du}, postérieure à la date demandée (${applicableDu}). `
      + "Corrigez d'abord la règle la plus récente, ou choisissez une date postérieure.",
    );
  }

  db.transaction(() => {
    if (courante) {
      db.prepare('UPDATE regle_repartition SET applicable_au = ? WHERE id = ?').run(applicableDu, courante.id);
    }
    db.prepare(`
      INSERT INTO regle_repartition (bien_id, categorie_id, regle, applicable_du, cree_le, cree_par)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(bienId, categorieId, regle, applicableDu, horodatage(), parQui);
    db.prepare(`
      INSERT INTO journal_audit (acteur_id, action, objet_kind, objet_id, detail_json, fait_le)
      VALUES (?, 'regle.changement', 'bien', ?, ?, ?)
    `).run(parQui, bienId, JSON.stringify({ categorieId, regle, applicableDu }), horodatage());
  })();
  log.info(`Règle de répartition du bien ${bienId}, catégorie ${categorieId} : ${regle} au ${applicableDu}.`);
}

// ============================================================
// Ce qui alimente une répartition
// ============================================================

/** Les détenteurs de la structure à une date, avec leur foyer. */
export function detenteursPourRepartition(db: Db, structureId: number, date: string): Detenteur[] {
  const r = partsALaDate(detentionsDe(db, structureId), date);
  if (!r.total) return [];
  const ids = [...r.parts.keys()];
  const lignes = db.prepare(`
    SELECT p.id, p.nom, p.foyer_id AS foyerId, f.nom AS foyerNom
    FROM personne p LEFT JOIN foyer f ON f.id = p.foyer_id
    WHERE p.id IN (${ids.map(() => '?').join(',')})
  `).all(...ids) as { id: number; nom: string; foyerId: number | null; foyerNom: string | null }[];
  return lignes.map((l) => ({
    personneId: l.id, nom: l.nom, foyerId: l.foyerId, foyerNom: l.foyerNom,
    parts: r.parts.get(l.id) ?? 0,
  }));
}

/**
 * Les nuits consommées par foyer sur un bien, pendant l'exercice de la dépense.
 *
 * L'exercice est l'année civile de la dépense. Seuls les séjours **famille**
 * validés comptent : une semaine louée ou une intervention d'entretien n'est la
 * consommation de personne.
 */
export function nuitsParFoyer(db: Db, bienId: number, annee: number): Map<number, number> {
  const lignes = db.prepare(`
    SELECT foyer_id AS foyerId, arrivee, depart FROM sejour
    WHERE bien_id = ? AND archive_le IS NULL AND statut = 'valide' AND nature = 'famille'
      AND foyer_id IS NOT NULL AND arrivee < ? AND depart > ?
  `).all(bienId, `${annee + 1}-01-01`, `${annee}-01-01`) as
    { foyerId: number; arrivee: string; depart: string }[];

  const out = new Map<number, number>();
  for (const l of lignes) {
    // Un séjour à cheval sur deux années n'est compté que pour ses nuits de
    // l'exercice : sinon janvier paierait pour décembre.
    const du = l.arrivee < `${annee}-01-01` ? `${annee}-01-01` : l.arrivee;
    const au = l.depart > `${annee + 1}-01-01` ? `${annee + 1}-01-01` : l.depart;
    out.set(l.foyerId, (out.get(l.foyerId) ?? 0) + Math.max(0, nuits(du, au)));
  }
  return out;
}

// ============================================================
// Dépenses
// ============================================================

export type PayePar = 'personne' | 'structure';
export type StatutDepense = 'saisie' | 'validee' | 'annulee';

export interface CreationDepense {
  structureId: number;
  dateDepense: string;
  libelle: string;
  categorieId: number;
  montantCents: number;
  payePar: PayePar;
  avanceParId: number | null;
  justificatifId: string | null;
  note: string;
  /** Les biens concernés, avec leur poids. Au moins un. */
  biens: { bienId: number; poidsNum: number; poidsDen: number }[];
  groupeId?: number | null;
}

export interface Depense {
  id: number; groupeId: number | null; structureId: number; structureNom: string;
  dateDepense: string; libelle: string;
  categorieId: number; categorieLibelle: string;
  montantCents: number; payePar: PayePar;
  avanceParId: number | null; avanceParNom: string | null;
  justificatifId: string | null; statut: StatutDepense; note: string;
  creeLe: string; archiveLe: string | null;
  biens: { bienId: number; bienNom: string; poidsNum: number; poidsDen: number }[];
  /** La règle réellement appliquée, lue dans la ventilation figée. */
  regleAppliquee: Regle | null;
}

interface LigneDepense {
  id: number; groupe_id: number | null; structure_id: number; structure_nom: string;
  date_depense: string; libelle: string; categorie_id: number; categorie_libelle: string;
  montant_cents: number; paye_par: PayePar; avance_par_id: number | null; avance_par_nom: string | null;
  justificatif_id: string | null; statut: StatutDepense; note: string;
  cree_le: string; archive_le: string | null;
}

const SELECT_DEPENSE = `
  SELECT d.id, d.groupe_id, d.structure_id, s.nom AS structure_nom, d.date_depense, d.libelle,
         d.categorie_id, c.libelle AS categorie_libelle, d.montant_cents, d.paye_par,
         d.avance_par_id, p.nom AS avance_par_nom, d.justificatif_id, d.statut, d.note,
         d.cree_le, d.archive_le
  FROM depense d
  JOIN structure s ON s.id = d.structure_id
  JOIN categorie_depense c ON c.id = d.categorie_id
  LEFT JOIN personne p ON p.id = d.avance_par_id
`;

function habiller(db: Db, l: LigneDepense): Depense {
  const biens = db.prepare(`
    SELECT db.bien_id AS bienId, b.nom AS bienNom, db.poids_num AS poidsNum, db.poids_den AS poidsDen
    FROM depense_bien db JOIN bien b ON b.id = db.bien_id WHERE db.depense_id = ? ORDER BY b.nom
  `).all(l.id) as Depense['biens'];
  const v = db.prepare('SELECT calcul_json FROM ventilation WHERE depense_id = ? LIMIT 1')
    .get(l.id) as { calcul_json: string } | undefined;
  let regleAppliquee: Regle | null = null;
  if (v) {
    try { regleAppliquee = (JSON.parse(v.calcul_json) as Justification).regleAppliquee; } catch { /* illisible */ }
  }
  return {
    id: l.id, groupeId: l.groupe_id, structureId: l.structure_id, structureNom: l.structure_nom,
    dateDepense: l.date_depense, libelle: l.libelle,
    categorieId: l.categorie_id, categorieLibelle: l.categorie_libelle,
    montantCents: l.montant_cents, payePar: l.paye_par,
    avanceParId: l.avance_par_id, avanceParNom: l.avance_par_nom,
    justificatifId: l.justificatif_id, statut: l.statut, note: l.note,
    creeLe: l.cree_le, archiveLe: l.archive_le, biens, regleAppliquee,
  };
}

export function depense(db: Db, id: number): Depense {
  const l = db.prepare(`${SELECT_DEPENSE} WHERE d.id = ?`).get(id) as LigneDepense | undefined;
  if (!l) throw introuvable('Cette dépense');
  return habiller(db, l);
}

/** Les dépenses des biens autorisés, sur une période. */
export function surPeriode(
  db: Db, biensAutorises: readonly number[], du: string, au: string,
): Depense[] {
  if (!biensAutorises.length) return [];
  const marqueurs = biensAutorises.map(() => '?').join(',');
  const lignes = db.prepare(`
    ${SELECT_DEPENSE}
    WHERE d.archive_le IS NULL AND d.date_depense >= ? AND d.date_depense <= ?
      AND EXISTS (SELECT 1 FROM depense_bien db WHERE db.depense_id = d.id AND db.bien_id IN (${marqueurs}))
    ORDER BY d.date_depense DESC, d.id DESC
  `).all(du, au, ...biensAutorises) as LigneDepense[];
  return lignes.map((l) => habiller(db, l));
}

/**
 * Enregistre une dépense **et fige sa ventilation**.
 *
 * Tout se fait dans une seule transaction : une dépense sans ventilation serait
 * une dépense que personne ne doit, et elle fausserait les soldes sans que rien
 * ne le signale.
 */
export function creerDepense(db: Db, c: CreationDepense, parQui: number): number {
  if (!c.biens.length) throw etatInvalide("Rattachez cette dépense à au moins un bien.");

  const detenteurs = detenteursPourRepartition(db, c.structureId, c.dateDepense);
  const annee = Number(c.dateDepense.slice(0, 4));
  const parts: PartBien[] = c.biens.map((b) => {
    const nom = (db.prepare('SELECT nom FROM bien WHERE id = ?').get(b.bienId) as { nom: string } | undefined)?.nom;
    if (!nom) throw introuvable('Ce bien');
    const regle = regleALaDate(db, b.bienId, c.categorieId, c.dateDepense);
    return {
      bienId: b.bienId, bienNom: nom, poidsNum: b.poidsNum, poidsDen: b.poidsDen,
      regle: regle.regle,
      source: regle.id ? { regleId: regle.id, applicableDu: regle.applicableDu } : undefined,
      nuitsParFoyer: regle.regle === 'nuits' ? nuitsParFoyer(db, b.bienId, annee) : undefined,
    };
  });

  let resultat;
  try {
    resultat = repartirSurBiens(c.montantCents, c.dateDepense, detenteurs, parts);
  } catch (e) {
    // Le message est déjà écrit pour la gérante : il passe tel quel.
    if (e instanceof RepartitionImpossible) throw etatInvalide(e.message);
    throw e;
  }

  return db.transaction(() => {
    const id = Number(db.prepare(`
      INSERT INTO depense (groupe_id, structure_id, date_depense, libelle, categorie_id, montant_cents,
                           paye_par, avance_par_id, justificatif_id, statut, note, cree_le, cree_par)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'validee', ?, ?, ?)
    `).run(c.groupeId ?? null, c.structureId, c.dateDepense, c.libelle, c.categorieId, c.montantCents,
      c.payePar, c.avanceParId, c.justificatifId, c.note, horodatage(), parQui).lastInsertRowid);

    const insBien = db.prepare('INSERT INTO depense_bien (depense_id, bien_id, poids_num, poids_den) VALUES (?, ?, ?, ?)');
    for (const b of c.biens) insBien.run(id, b.bienId, b.poidsNum, b.poidsDen);

    ecrireVentilation(db, id, resultat.lignes, resultat.justification, parQui);
    return id;
  })();
}

function ecrireVentilation(
  db: Db, depenseId: number, lignes: readonly { personneId: number; montantCents: number }[],
  justification: Justification, parQui: number,
): void {
  const calcul = JSON.stringify(justification);
  const ins = db.prepare(`
    INSERT INTO ventilation (depense_id, personne_id, montant_cents, calcul_json, calcule_le, calcule_par)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const l of lignes) ins.run(depenseId, l.personneId, l.montantCents, calcul, horodatage(), parQui);
}

export interface LigneVentilation {
  personneId: number; nom: string; montantCents: number;
}

export function ventilationDe(db: Db, depenseId: number): { lignes: LigneVentilation[]; justification: Justification | null } {
  const lignes = db.prepare(`
    SELECT v.personne_id AS personneId, p.nom, v.montant_cents AS montantCents, v.calcul_json AS calcul
    FROM ventilation v JOIN personne p ON p.id = v.personne_id
    WHERE v.depense_id = ? ORDER BY v.montant_cents DESC, p.nom
  `).all(depenseId) as (LigneVentilation & { calcul: string })[];
  let justification: Justification | null = null;
  if (lignes.length) {
    try { justification = JSON.parse(lignes[0].calcul) as Justification; } catch { /* illisible */ }
  }
  return {
    lignes: lignes.map(({ personneId, nom, montantCents }) => ({ personneId, nom, montantCents })),
    justification,
  };
}

/**
 * Recalcule la ventilation d'une dépense, **explicitement**.
 *
 * C'est le seul chemin qui touche à une ventilation existante. Le motif est
 * obligatoire et l'ancienne version est conservée : c'est ce qui permet de
 * répondre à « pourquoi ce chiffre a-t-il changé », question qui viendra.
 */
export function recalculer(db: Db, depenseId: number, motif: string, parQui: number): void {
  const d = depense(db, depenseId);
  if (d.archiveLe || d.statut === 'annulee') throw etatInvalide('Cette dépense est annulée.');

  const avant = ventilationDe(db, depenseId);
  const detenteurs = detenteursPourRepartition(db, d.structureId, d.dateDepense);
  const annee = Number(d.dateDepense.slice(0, 4));
  const parts: PartBien[] = d.biens.map((b) => {
    const regle = regleALaDate(db, b.bienId, d.categorieId, d.dateDepense);
    return {
      bienId: b.bienId, bienNom: b.bienNom, poidsNum: b.poidsNum, poidsDen: b.poidsDen,
      regle: regle.regle,
      source: regle.id ? { regleId: regle.id, applicableDu: regle.applicableDu } : undefined,
      nuitsParFoyer: regle.regle === 'nuits' ? nuitsParFoyer(db, b.bienId, annee) : undefined,
    };
  });

  let resultat;
  try {
    resultat = repartirSurBiens(d.montantCents, d.dateDepense, detenteurs, parts);
  } catch (e) {
    if (e instanceof RepartitionImpossible) throw etatInvalide(e.message);
    throw e;
  }

  db.transaction(() => {
    db.prepare(`
      INSERT INTO ventilation_recalcul (depense_id, avant_json, apres_json, motif, fait_le, fait_par)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(depenseId, JSON.stringify(avant), JSON.stringify(resultat), motif, horodatage(), parQui);
    db.prepare('DELETE FROM ventilation WHERE depense_id = ?').run(depenseId);
    ecrireVentilation(db, depenseId, resultat.lignes, resultat.justification, parQui);
  })();
  log.info(`Ventilation de la dépense ${depenseId} recalculée par la personne ${parQui} : ${motif}`);
}

export const recalculsDe = (db: Db, depenseId: number): { motif: string; faitLe: string; parNom: string | null }[] =>
  db.prepare(`
    SELECT r.motif, r.fait_le AS faitLe, p.nom AS parNom
    FROM ventilation_recalcul r LEFT JOIN personne p ON p.id = r.fait_par
    WHERE r.depense_id = ? ORDER BY r.id DESC
  `).all(depenseId) as { motif: string; faitLe: string; parNom: string | null }[];

/** Annuler une dépense l'archive : rien ne s'efface, les soldes cessent de la compter. */
export function annulerDepense(db: Db, id: number, parQui: number): void {
  db.transaction(() => {
    db.prepare("UPDATE depense SET statut = 'annulee', archive_le = ? WHERE id = ?").run(horodatage(), id);
    db.prepare(`
      INSERT INTO journal_audit (acteur_id, action, objet_kind, objet_id, detail_json, fait_le)
      VALUES (?, 'depense.annulee', 'depense', ?, '{}', ?)
    `).run(parQui, id, horodatage());
  })();
}

// ============================================================
// Soldes et règlements
// ============================================================

export function soldesDe(db: Db, structureId: number): Map<number, Solde> {
  const depenses = db.prepare(`
    SELECT id, montant_cents AS montantCents, paye_par AS payePar, avance_par_id AS avanceParId
    FROM depense WHERE structure_id = ? AND archive_le IS NULL AND statut = 'validee'
  `).all(structureId) as { id: number; montantCents: number; payePar: PayePar; avanceParId: number | null }[];

  const ventilations = db.prepare(`
    SELECT v.depense_id AS depenseId, v.personne_id AS personneId, v.montant_cents AS montantCents
    FROM ventilation v JOIN depense d ON d.id = v.depense_id
    WHERE d.structure_id = ? AND d.archive_le IS NULL AND d.statut = 'validee'
  `).all(structureId) as { depenseId: number; personneId: number; montantCents: number }[];

  const parDepense = new Map<number, { personneId: number; montantCents: number }[]>();
  for (const v of ventilations) {
    const l = parDepense.get(v.depenseId);
    if (l) l.push(v); else parDepense.set(v.depenseId, [v]);
  }

  const pourSolde: DepenseSolde[] = depenses.map((d) => ({
    id: d.id,
    montantCents: d.montantCents,
    // Une dépense payée par le compte commun a la structure pour créancière.
    avanceParId: d.payePar === 'personne' ? d.avanceParId ?? STRUCTURE : STRUCTURE,
    ventilation: parDepense.get(d.id) ?? [],
  }));

  const reglements = db.prepare(`
    SELECT de_id AS deId, vers_id AS versId, montant_cents AS montantCents, statut
    FROM reglement WHERE structure_id = ? AND statut <> 'annule'
  `).all(structureId) as { deId: number; versId: number; montantCents: number; statut: string }[];

  const pourReglement: ReglementSolde[] = reglements.map((r) => ({
    deId: r.deId, versId: r.versId, montantCents: r.montantCents, confirme: r.statut === 'confirme',
  }));

  return calculer(pourSolde, pourReglement);
}

export const virementsProposes = (soldes: Map<number, Solde>): Virement[] => virements(soldes.values());

export interface Reglement {
  id: number; deId: number; deNom: string; versId: number; versNom: string;
  montantCents: number; dateReglement: string; statut: string; motif: string;
  appelId: number | null; confirmeLe: string | null;
}

/** Le nom d'un acteur de solde : une personne, ou la structure elle-même. */
export function nomActeur(db: Db, structureId: number, acteurId: number): string {
  if (acteurId === STRUCTURE) {
    const s = db.prepare('SELECT nom FROM structure WHERE id = ?').get(structureId) as { nom: string } | undefined;
    return s?.nom ?? 'Le compte commun';
  }
  const p = db.prepare('SELECT nom FROM personne WHERE id = ?').get(acteurId) as { nom: string } | undefined;
  return p?.nom ?? 'Personne retirée';
}

export function reglementsDe(db: Db, structureId: number): Reglement[] {
  const lignes = db.prepare(`
    SELECT id, de_id AS deId, vers_id AS versId, montant_cents AS montantCents,
           date_reglement AS dateReglement, statut, motif, appel_id AS appelId, confirme_le AS confirmeLe
    FROM reglement WHERE structure_id = ? AND statut <> 'annule'
    ORDER BY date_reglement DESC, id DESC
  `).all(structureId) as Omit<Reglement, 'deNom' | 'versNom'>[];
  return lignes.map((l) => ({ ...l, deNom: nomActeur(db, structureId, l.deId), versNom: nomActeur(db, structureId, l.versId) }));
}

export function creerReglement(
  db: Db, structureId: number, deId: number, versId: number, montantCents: number,
  motif: string, statut: 'propose' | 'annonce', appelId: number | null, parQui: number,
): number {
  if (deId === versId) throw etatInvalide('Un virement ne peut pas partir et arriver au même endroit.');
  return Number(db.prepare(`
    INSERT INTO reglement (structure_id, de_id, vers_id, montant_cents, date_reglement, statut, motif, appel_id, cree_le, cree_par, annonce_le)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(structureId, deId, versId, montantCents, aujourdhui(), statut, motif, appelId,
    horodatage(), parQui, statut === 'annonce' ? horodatage() : null).lastInsertRowid);
}

/**
 * Fait avancer un règlement.
 *
 * Trois états, et c'est la note de comportement de la maquette : proposé ne
 * bouge aucun solde, annoncé veut dire « j'ai viré », confirmé veut dire « j'ai
 * vu l'argent ». Seul le dernier compte, et **seul le bénéficiaire peut
 * confirmer** : sans cela, un solde se solderait tout seul.
 */
export function avancerReglement(
  db: Db, id: number, vers: 'annonce' | 'confirme' | 'annule', parQui: number,
): void {
  const r = db.prepare('SELECT de_id AS deId, vers_id AS versId, statut FROM reglement WHERE id = ?')
    .get(id) as { deId: number; versId: number; statut: string } | undefined;
  if (!r) throw introuvable('Ce virement');
  if (r.statut === 'confirme' && vers !== 'annule') throw conflit('Ce virement est déjà confirmé.');

  db.prepare(`
    UPDATE reglement SET statut = ?, annonce_le = COALESCE(annonce_le, ?), confirme_le = ?, confirme_par = ?
    WHERE id = ?
  `).run(vers,
    vers === 'annonce' ? horodatage() : null,
    vers === 'confirme' ? horodatage() : null,
    vers === 'confirme' ? parQui : null,
    id);
}

// ============================================================
// Appels de fonds
// ============================================================

export interface AppelDeFonds {
  id: number; structureId: number; libelle: string; dateAppel: string; echeance: string;
  statut: string; note: string;
  lignes: { personneId: number; nom: string; montantCents: number; statut: string }[];
}

export function appelsDe(db: Db, structureId: number): AppelDeFonds[] {
  const appels = db.prepare(`
    SELECT id, structure_id AS structureId, libelle, date_appel AS dateAppel, echeance, statut, note
    FROM appel_de_fonds WHERE structure_id = ? ORDER BY date_appel DESC, id DESC
  `).all(structureId) as Omit<AppelDeFonds, 'lignes'>[];

  return appels.map((a) => ({
    ...a,
    lignes: (db.prepare(`
      SELECT de_id AS personneId, montant_cents AS montantCents, statut
      FROM reglement WHERE appel_id = ? AND statut <> 'annule' ORDER BY montant_cents DESC
    `).all(a.id) as { personneId: number; montantCents: number; statut: string }[])
      .map((l) => ({ ...l, nom: nomActeur(db, structureId, l.personneId) })),
  }));
}

/**
 * Émet un appel de fonds : un règlement annoncé par personne débitrice envers
 * la structure. Le détail du calcul reste celui des soldes, consultable ligne
 * par ligne : un appel de fonds sans justification est un appel contesté.
 */
export function emettreAppel(
  db: Db, structureId: number, libelle: string, echeance: string, note: string, parQui: number,
): { appelId: number; lignes: { personneId: number; montantCents: number }[] } {
  const soldes = soldesDe(db, structureId);
  const debiteurs = [...soldes.values()]
    .filter((s) => s.acteurId !== STRUCTURE && s.montantCents < 0)
    .map((s) => ({ personneId: s.acteurId, montantCents: -s.montantCents }))
    .sort((a, b) => b.montantCents - a.montantCents);

  if (!debiteurs.length) throw etatInvalide('Personne n\'est débiteur : il n\'y a rien à appeler.');

  return db.transaction(() => {
    const appelId = Number(db.prepare(`
      INSERT INTO appel_de_fonds (structure_id, libelle, date_appel, echeance, statut, note, cree_le, cree_par)
      VALUES (?, ?, ?, ?, 'ouvert', ?, ?, ?)
    `).run(structureId, libelle, aujourdhui(), echeance, note, horodatage(), parQui).lastInsertRowid);

    for (const d of debiteurs) {
      creerReglement(db, structureId, d.personneId, STRUCTURE, d.montantCents, libelle, 'propose', appelId, parQui);
    }
    log.info(`Appel de fonds ${appelId} émis sur la structure ${structureId} : ${debiteurs.length} personne(s).`);
    return { appelId, lignes: debiteurs };
  })();
}
