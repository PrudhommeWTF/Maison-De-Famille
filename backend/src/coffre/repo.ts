// Le dépôt du coffre-fort : documents versionnés et codes chiffrés.
//
// **Le filtrage se fait en SQL, pas à l'affichage.** Un document hors portée ne
// doit pas quitter la base : ce qui n'est jamais lu ne peut pas fuir par une
// trace de journal, un message d'erreur ou un champ oublié dans une réponse.
// Les portées visibles sont donc calculées d'abord, puis passées à la requête.
import type { Db } from '../noyau/db';
import { aujourdhui, horodatage } from '../noyau/dates';
import { introuvable, refuse } from '../noyau/erreurs';
import { log } from '../noyau/log';
import type { Coffre } from './chiffrement';
import {
  Demandeur, Fenetre, PorteeElement, RoleSurBien, peutVoir, porteesVisibles, refus,
} from './portee';

/** Les séjours validés d'une personne sur un bien. Sert à la portée `sejour`. */
export function sejoursDe(db: Db, bienId: number, personneId: number): { arrivee: string; depart: string }[] {
  return db.prepare(
    `SELECT s.arrivee, s.depart FROM sejour s
     LEFT JOIN personne p ON p.id = s.demandeur_id
     WHERE s.bien_id = ? AND s.statut = 'valide' AND s.archive_le IS NULL
       AND (s.demandeur_id = ? OR (s.foyer_id IS NOT NULL AND s.foyer_id = p.foyer_id AND p.id = ?))`,
  ).all(bienId, personneId, personneId) as { arrivee: string; depart: string }[];
}

/**
 * Le demandeur, tel que la règle de portée l'attend.
 *
 * Les séjours du **foyer** comptent, pas seulement ceux dont la personne est
 * demandeuse : un conjoint qui n'a pas déposé la demande dort dans la même
 * maison la même semaine, et lui refuser le code du portail serait absurde.
 */
export function demandeur(db: Db, bienId: number, personneId: number, role: RoleSurBien): Demandeur {
  return { role, sejours: role === 'gerant' || role === 'detenteur' ? [] : sejoursDe(db, bienId, personneId) };
}

// ---------- Documents ----------

export interface Document {
  id: number; bienId: number; nom: string; portee: PorteeElement; note: string;
  version: number | null; fichierId: string | null; mime: string | null;
  deposeLe: string | null; deposeParNom: string | null;
}

const SELECT_DOCUMENT = `
  SELECT d.id, d.bien_id AS bienId, d.nom, d.portee, d.note,
         v.version, v.fichier_id AS fichierId, f.mime, v.depose_le AS deposeLe, p.nom AS deposeParNom
  FROM document d
  LEFT JOIN document_version v ON v.document_id = d.id
       AND v.version = (SELECT MAX(version) FROM document_version WHERE document_id = d.id)
  LEFT JOIN fichier f ON f.id = v.fichier_id
  LEFT JOIN personne p ON p.id = v.depose_par_id
`;

export function documents(
  db: Db, bienId: number, d: Demandeur, jour = aujourdhui(), f?: Fenetre,
): Document[] {
  const visibles = porteesVisibles(d, jour, f);
  if (!visibles.length) return [];
  const trous = visibles.map(() => '?').join(',');
  return db.prepare(
    `${SELECT_DOCUMENT} WHERE d.bien_id = ? AND d.archive_le IS NULL
       AND d.portee IN (${trous}) ORDER BY d.nom`,
  ).all(bienId, ...visibles) as Document[];
}

/**
 * Un document précis, avec contrôle de portée.
 *
 * Le refus est un 403 qui **dit pourquoi**, pas un 404. Un membre de foyer
 * légitime qui s'y prend deux jours trop tôt doit comprendre qu'il lui suffit
 * d'attendre ; lui répondre « introuvable » l'enverrait écrire à la gérante
 * pour rien. Ce que le refus ne dit jamais, c'est le contenu.
 */
export function document(
  db: Db, bienId: number, id: number, d: Demandeur, jour = aujourdhui(), f?: Fenetre,
): Document {
  const doc = db.prepare(`${SELECT_DOCUMENT} WHERE d.id = ? AND d.bien_id = ? AND d.archive_le IS NULL`)
    .get(id, bienId) as Document | undefined;
  if (!doc) throw introuvable('Ce document');
  if (!peutVoir(doc.portee, d, jour, f)) throw refuse(refus(doc.portee, d));
  return doc;
}

export function versions(db: Db, documentId: number): {
  version: number; fichierId: string; note: string; deposeLe: string; deposeParNom: string | null;
}[] {
  return db.prepare(
    `SELECT v.version, v.fichier_id AS fichierId, v.note, v.depose_le AS deposeLe, p.nom AS deposeParNom
     FROM document_version v LEFT JOIN personne p ON p.id = v.depose_par_id
     WHERE v.document_id = ? ORDER BY v.version DESC`,
  ).all(documentId) as never;
}

export function creerDocument(
  db: Db, bienId: number, v: { nom: string; portee: PorteeElement; note: string; fichierId: string },
  parQui: number,
): number {
  return db.transaction(() => {
    const id = Number(db.prepare(
      'INSERT INTO document (bien_id, nom, portee, note, cree_le, cree_par) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(bienId, v.nom, v.portee, v.note, horodatage(), parQui).lastInsertRowid);
    db.prepare(
      `INSERT INTO document_version (document_id, fichier_id, version, note, depose_le, depose_par_id)
       VALUES (?, ?, 1, ?, ?, ?)`,
    ).run(id, v.fichierId, v.note, horodatage(), parQui);
    return id;
  })();
}

/** Déposer à nouveau n'écrase pas : la version précédente reste consultable. */
export function ajouterVersion(
  db: Db, bienId: number, documentId: number, fichierId: string, note: string, parQui: number,
): number {
  const doc = db.prepare('SELECT id FROM document WHERE id = ? AND bien_id = ? AND archive_le IS NULL')
    .get(documentId, bienId);
  if (!doc) throw introuvable('Ce document');
  const max = (db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM document_version WHERE document_id = ?')
    .get(documentId) as { v: number }).v;
  db.prepare(
    `INSERT INTO document_version (document_id, fichier_id, version, note, depose_le, depose_par_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(documentId, fichierId, max + 1, note, horodatage(), parQui);
  return max + 1;
}

export function changerPorteeDocument(db: Db, bienId: number, id: number, portee: PorteeElement, parQui: number): void {
  const doc = db.prepare('SELECT portee FROM document WHERE id = ? AND bien_id = ? AND archive_le IS NULL')
    .get(id, bienId) as { portee: string } | undefined;
  if (!doc) throw introuvable('Ce document');
  db.prepare('UPDATE document SET portee = ? WHERE id = ?').run(portee, id);
  log.info(`Portée du document ${id} : ${doc.portee} vers ${portee}, par la personne ${parQui}.`);
}

export function archiverDocument(db: Db, bienId: number, id: number): void {
  const doc = db.prepare('SELECT id FROM document WHERE id = ? AND bien_id = ? AND archive_le IS NULL')
    .get(id, bienId);
  if (!doc) throw introuvable('Ce document');
  db.prepare('UPDATE document SET archive_le = ? WHERE id = ?').run(horodatage(), id);
}

// ---------- Codes d'accès ----------

export interface CodeResume {
  id: number; bienId: number; libelle: string; portee: PorteeElement; note: string;
  majLe: string | null; dernierAffichage: string | null;
}

const SELECT_CODE = `
  SELECT c.id, c.bien_id AS bienId, c.libelle, c.portee, c.note, c.maj_le AS majLe,
         (SELECT MAX(affiche_le) FROM code_affichage WHERE code_id = c.id) AS dernierAffichage
  FROM code_acces c
`;

/**
 * La liste des codes. **La valeur n'y est jamais**, même chiffrée : un code ne
 * se déchiffre qu'à la demande, et cette demande se journalise. Envoyer la
 * liste avec les valeurs rendrait le journal des affichages mensonger, puisque
 * tout le monde les aurait reçues sans que rien ne le note.
 */
export function codes(
  db: Db, bienId: number, d: Demandeur, jour = aujourdhui(), f?: Fenetre,
): CodeResume[] {
  const visibles = porteesVisibles(d, jour, f);
  if (!visibles.length) return [];
  const trous = visibles.map(() => '?').join(',');
  return db.prepare(
    `${SELECT_CODE} WHERE c.bien_id = ? AND c.archive_le IS NULL
       AND c.portee IN (${trous}) ORDER BY c.libelle`,
  ).all(bienId, ...visibles) as CodeResume[];
}

/**
 * Affiche un code : déchiffre, et **journalise**.
 *
 * L'écriture du journal est dans la même transaction que la lecture : il ne
 * doit pas exister de chemin où la valeur sort sans que la trace entre.
 */
export function afficherCode(
  db: Db, coffre: Coffre, bienId: number, id: number, d: Demandeur,
  parQui: number, ip: string, jour = aujourdhui(), f?: Fenetre,
): { libelle: string; valeur: string } {
  const c = db.prepare(
    'SELECT libelle, portee, valeur_chiffree AS valeurChiffree FROM code_acces WHERE id = ? AND bien_id = ? AND archive_le IS NULL',
  ).get(id, bienId) as { libelle: string; portee: PorteeElement; valeurChiffree: Buffer } | undefined;
  if (!c) throw introuvable('Ce code');
  if (!peutVoir(c.portee, d, jour, f)) throw refuse(refus(c.portee, d));

  const valeur = coffre.dechiffrer(c.valeurChiffree);
  db.prepare(
    'INSERT INTO code_affichage (code_id, personne_id, affiche_le, adresse_ip) VALUES (?, ?, ?, ?)',
  ).run(id, parQui, horodatage(), ip.slice(0, 60));
  log.info(`Code ${id} affiché à la personne ${parQui}.`);
  return { libelle: c.libelle, valeur };
}

export function creerCode(
  db: Db, coffre: Coffre, bienId: number,
  v: { libelle: string; valeur: string; portee: PorteeElement; note: string }, parQui: number,
): number {
  return Number(db.prepare(
    `INSERT INTO code_acces (bien_id, libelle, valeur_chiffree, portee, note, cree_le, cree_par)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(bienId, v.libelle, coffre.chiffrer(v.valeur), v.portee, v.note, horodatage(), parQui).lastInsertRowid);
}

export function modifierCode(
  db: Db, coffre: Coffre, bienId: number, id: number,
  v: { libelle: string; valeur: string | null; portee: PorteeElement; note: string }, parQui: number,
): void {
  const c = db.prepare('SELECT portee FROM code_acces WHERE id = ? AND bien_id = ? AND archive_le IS NULL')
    .get(id, bienId) as { portee: string } | undefined;
  if (!c) throw introuvable('Ce code');
  if (v.valeur === null) {
    db.prepare('UPDATE code_acces SET libelle = ?, portee = ?, note = ?, maj_le = ? WHERE id = ?')
      .run(v.libelle, v.portee, v.note, horodatage(), id);
  } else {
    db.prepare('UPDATE code_acces SET libelle = ?, valeur_chiffree = ?, portee = ?, note = ?, maj_le = ? WHERE id = ?')
      .run(v.libelle, coffre.chiffrer(v.valeur), v.portee, v.note, horodatage(), id);
  }
  if (c.portee !== v.portee) {
    log.info(`Portée du code ${id} : ${c.portee} vers ${v.portee}, par la personne ${parQui}.`);
  }
}

export function archiverCode(db: Db, bienId: number, id: number): void {
  const c = db.prepare('SELECT id FROM code_acces WHERE id = ? AND bien_id = ? AND archive_le IS NULL')
    .get(id, bienId);
  if (!c) throw introuvable('Ce code');
  db.prepare('UPDATE code_acces SET archive_le = ? WHERE id = ?').run(horodatage(), id);
}

/** Le journal des affichages d'un code. « Qui l'a vu, et quand. » */
export function affichages(db: Db, bienId: number, id: number, limite = 50): {
  personneNom: string; afficheLe: string; adresseIp: string;
}[] {
  const c = db.prepare('SELECT id FROM code_acces WHERE id = ? AND bien_id = ?').get(id, bienId);
  if (!c) throw introuvable('Ce code');
  return db.prepare(
    `SELECT p.nom AS personneNom, a.affiche_le AS afficheLe, a.adresse_ip AS adresseIp
     FROM code_affichage a JOIN personne p ON p.id = a.personne_id
     WHERE a.code_id = ? ORDER BY a.affiche_le DESC LIMIT ?`,
  ).all(id, limite) as never;
}
