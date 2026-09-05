// Structures, biens, détentions, personnes et foyers.
//
// Toutes les écritures passent par ici, en transactions courtes et en requêtes
// préparées. Aucune route n'écrit directement en base : c'est ce qui permet de
// garantir les invariants (les périodes de détention ne se chevauchent pas, une
// structure a toujours ses règles de décision) à un seul endroit.
import type { Db } from '../noyau/db';
import { horodatage } from '../noyau/dates';
import { conflit, etatInvalide, introuvable } from '../noyau/erreurs';
import { ChangementImpossible, LigneDetention, anomalies, partsALaDate, preparerChangement } from './parts';

export type ModeStructure = 'indivision' | 'sci' | 'nom_propre';
export type TypeBien = 'mer' | 'montagne' | 'campagne' | 'ville';

export interface RegleSemee {
  acte: string; libelle: string; base: 'parts' | 'tetes';
  seuilNum: number; seuilDen: number; voteRequis: boolean;
}

/**
 * Les règles de décision semées à la création d'une structure.
 *
 * Ce sont des **valeurs de départ**, pas une vérité : elles vivent ensuite dans
 * la table `regle_decision` et s'y modifient. Une SCI dont les statuts exigent
 * l'unanimité pour un emprunt ajoute sa ligne sans qu'on recompile quoi que ce
 * soit, et un troisième bien avec ses propres règles arrivera de la même façon.
 */
export const REGLES_PAR_MODE: Record<ModeStructure, readonly RegleSemee[]> = {
  indivision: [
    { acte: 'gestion_courante', libelle: 'Deux tiers pour la gestion courante', base: 'parts', seuilNum: 2, seuilDen: 3, voteRequis: true },
    { acte: 'disposition', libelle: 'Unanimité pour vendre ou hypothéquer', base: 'parts', seuilNum: 1, seuilDen: 1, voteRequis: true },
  ],
  sci: [
    { acte: 'assemblee_ordinaire', libelle: 'Majorité des parts en assemblée ordinaire', base: 'parts', seuilNum: 1, seuilDen: 2, voteRequis: true },
    { acte: 'assemblee_extraordinaire', libelle: 'Deux tiers des parts en assemblée extraordinaire', base: 'parts', seuilNum: 2, seuilDen: 3, voteRequis: true },
  ],
  nom_propre: [
    { acte: 'decision_proprietaire', libelle: 'Décision du propriétaire, sans vote', base: 'parts', seuilNum: 1, seuilDen: 1, voteRequis: false },
  ],
};

/** Le vocabulaire affiché suit la structure : la maquette y tient, et la famille aussi. */
export const VOCABULAIRE: Record<ModeStructure, { part: string; parts: string; detenteur: string; detenteurs: string; regularisation: string }> = {
  indivision: { part: 'quote-part', parts: 'quotes-parts', detenteur: 'indivisaire', detenteurs: 'indivisaires', regularisation: "Régularisation d'indivision" },
  sci: { part: 'parts sociales', parts: 'parts sociales', detenteur: 'associé', detenteurs: 'associés', regularisation: 'Appel de fonds de la SCI' },
  nom_propre: { part: 'propriété', parts: 'propriété', detenteur: 'propriétaire', detenteurs: 'propriétaires', regularisation: 'Remboursement' },
};

export interface Structure {
  id: number; mode: ModeStructure; nom: string; notes: string; archiveLe: string | null;
}

export interface RegleDecision {
  id: number; acte: string; libelle: string; base: 'parts' | 'tetes';
  seuilNum: number; seuilDen: number; voteRequis: boolean;
}

interface LigneStructure { id: number; mode: ModeStructure; nom: string; notes: string; archive_le: string | null }

const versStructure = (l: LigneStructure): Structure =>
  ({ id: l.id, mode: l.mode, nom: l.nom, notes: l.notes, archiveLe: l.archive_le });

export function creerStructure(
  db: Db, mode: ModeStructure, nom: string, notes: string, parQui: number | null,
): number {
  return db.transaction(() => {
    const id = Number(db.prepare('INSERT INTO structure (mode, nom, notes, cree_le, cree_par) VALUES (?, ?, ?, ?, ?)')
      .run(mode, nom, notes, horodatage(), parQui).lastInsertRowid);
    const ins = db.prepare(`
      INSERT INTO regle_decision (structure_id, acte, libelle, base, seuil_num, seuil_den, vote_requis)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of REGLES_PAR_MODE[mode]) {
      ins.run(id, r.acte, r.libelle, r.base, r.seuilNum, r.seuilDen, r.voteRequis ? 1 : 0);
    }
    return id;
  })();
}

export function structure(db: Db, id: number): Structure {
  const l = db.prepare('SELECT id, mode, nom, notes, archive_le FROM structure WHERE id = ?').get(id) as LigneStructure | undefined;
  if (!l) throw introuvable('Cette structure');
  return versStructure(l);
}

interface LigneRegle { id: number; acte: string; libelle: string; base: 'parts' | 'tetes'; seuil_num: number; seuil_den: number; vote_requis: number }

export function reglesDe(db: Db, structureId: number): RegleDecision[] {
  return (db.prepare('SELECT id, acte, libelle, base, seuil_num, seuil_den, vote_requis FROM regle_decision WHERE structure_id = ? ORDER BY id')
    .all(structureId) as LigneRegle[])
    .map((l) => ({ id: l.id, acte: l.acte, libelle: l.libelle, base: l.base, seuilNum: l.seuil_num, seuilDen: l.seuil_den, voteRequis: !!l.vote_requis }));
}

/** La règle affichée sur la pastille d'un bien : celle de la gestion courante. */
export const regleCourante = (db: Db, structureId: number): string =>
  reglesDe(db, structureId)[0]?.libelle ?? '';

// ============================================================
// Biens
// ============================================================

export interface Bien {
  id: number; structureId: number; nom: string; commune: string; codePostal: string; adresse: string;
  type: TypeBien; couchages: number; locationActivee: boolean; photoFichierId: string | null;
  notes: string; archiveLe: string | null;
}

interface LigneBien {
  id: number; structure_id: number; nom: string; commune: string; code_postal: string; adresse: string;
  type: TypeBien; couchages: number; location_activee: number; photo_fichier_id: string | null;
  notes: string; archive_le: string | null;
}

const versBien = (l: LigneBien): Bien => ({
  id: l.id, structureId: l.structure_id, nom: l.nom, commune: l.commune, codePostal: l.code_postal,
  adresse: l.adresse, type: l.type, couchages: l.couchages, locationActivee: !!l.location_activee,
  photoFichierId: l.photo_fichier_id, notes: l.notes, archiveLe: l.archive_le,
});

const CHAMPS_BIEN = 'id, structure_id, nom, commune, code_postal, adresse, type, couchages, location_activee, photo_fichier_id, notes, archive_le';

export function bien(db: Db, id: number): Bien {
  const l = db.prepare(`SELECT ${CHAMPS_BIEN} FROM bien WHERE id = ?`).get(id) as LigneBien | undefined;
  if (!l) throw introuvable('Ce bien');
  return versBien(l);
}

export interface CreationBien {
  structureId: number; nom: string; commune: string; codePostal: string; adresse: string;
  type: TypeBien; couchages: number; locationActivee: boolean; notes: string;
}

export function creerBien(db: Db, c: CreationBien, parQui: number | null): number {
  return Number(db.prepare(`
    INSERT INTO bien (structure_id, nom, commune, code_postal, adresse, type, couchages, location_activee, notes, cree_le, cree_par)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(c.structureId, c.nom, c.commune, c.codePostal, c.adresse, c.type, c.couchages,
    c.locationActivee ? 1 : 0, c.notes, horodatage(), parQui).lastInsertRowid);
}

export function modifierBien(db: Db, id: number, c: Partial<CreationBien> & { photoFichierId?: string | null }): void {
  const actuel = bien(db, id);
  db.prepare(`
    UPDATE bien SET nom = ?, commune = ?, code_postal = ?, adresse = ?, type = ?, couchages = ?,
                    location_activee = ?, notes = ?, photo_fichier_id = ?
    WHERE id = ?
  `).run(
    c.nom ?? actuel.nom, c.commune ?? actuel.commune, c.codePostal ?? actuel.codePostal,
    c.adresse ?? actuel.adresse, c.type ?? actuel.type, c.couchages ?? actuel.couchages,
    (c.locationActivee ?? actuel.locationActivee) ? 1 : 0, c.notes ?? actuel.notes,
    c.photoFichierId !== undefined ? c.photoFichierId : actuel.photoFichierId, id,
  );
}

/**
 * Retirer un bien l'archive. Rien n'est supprimé : séjours, dépenses et
 * documents restent consultables, et l'action est réversible. La suppression
 * définitive passe par un export préalable, jamais par un bouton.
 */
export function archiverBien(db: Db, id: number, archiver: boolean): void {
  db.prepare('UPDATE bien SET archive_le = ? WHERE id = ?').run(archiver ? horodatage() : null, id);
}

// ============================================================
// Détentions
// ============================================================

interface LigneDet { id: number; personne_id: number; parts: number; effet_du: string; effet_au: string | null; motif: string }

export function detentionsDe(db: Db, structureId: number): LigneDetention[] {
  return (db.prepare('SELECT id, personne_id, parts, effet_du, effet_au, motif FROM detention WHERE structure_id = ? ORDER BY effet_du, id')
    .all(structureId) as LigneDet[])
    .map((l) => ({ id: l.id, personneId: l.personne_id, parts: l.parts, effetDu: l.effet_du, effetAu: l.effet_au, motif: l.motif }));
}

/**
 * Applique une nouvelle répartition à partir d'une date d'effet.
 *
 * Les lignes en vigueur sont **fermées**, de nouvelles sont ouvertes : le passé
 * garde ses parts, et une dépense de février continue de se répartir avec les
 * parts de février. C'est la raison d'être de tout ce module.
 */
export function changerDetentions(
  db: Db, structureId: number, nouvelles: Map<number, number>, dateEffet: string, motif: string, parQui: number,
): void {
  const avant = detentionsDe(db, structureId);
  let c;
  try {
    c = preparerChangement(avant, nouvelles, dateEffet, motif);
  } catch (e) {
    // Le message est déjà écrit pour la gérante : il passe tel quel.
    if (e instanceof ChangementImpossible) throw etatInvalide(e.message);
    throw e;
  }

  const apres: LigneDetention[] = [
    ...avant.map((l) => {
      const f = c.aFermer.find((x) => x.id === l.id);
      return f ? { ...l, effetAu: f.effetAu } : l;
    }),
    ...c.aCreer.map((l, i) => ({ ...l, id: -1 - i })),
  ];
  const mauvais = anomalies(apres);
  if (mauvais.length) {
    // Le message nomme la première anomalie : c'est celle qu'il faut corriger,
    // et une liste de dix lignes n'aide personne.
    throw etatInvalide(`Ce changement rendrait l'historique des détentions incohérent : ${mauvais[0].message}`);
  }

  db.transaction(() => {
    const fermer = db.prepare('UPDATE detention SET effet_au = ? WHERE id = ?');
    for (const f of c.aFermer) fermer.run(f.effetAu, f.id);
    const ouvrir = db.prepare(`
      INSERT INTO detention (structure_id, personne_id, parts, effet_du, effet_au, motif, cree_le, cree_par)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
    `);
    for (const l of c.aCreer) ouvrir.run(structureId, l.personneId, l.parts, l.effetDu, motif, horodatage(), parQui);
    db.prepare(`
      INSERT INTO journal_audit (acteur_id, action, objet_kind, objet_id, detail_json, fait_le)
      VALUES (?, 'detention.changement', 'structure', ?, ?, ?)
    `).run(parQui, structureId, JSON.stringify({ dateEffet, motif, nouvelles: [...nouvelles] }), horodatage());
  })();
}

export interface DetenteurAffiche {
  personneId: number; nom: string; foyerNom: string | null; parts: number; total: number;
  quotePart: string; role: string;
}

/** Les détenteurs en vigueur à une date, prêts pour l'écran Membres. */
export function detenteursALaDate(db: Db, structureId: number, date: string): DetenteurAffiche[] {
  const r = partsALaDate(detentionsDe(db, structureId), date);
  if (!r.total) return [];
  const ids = [...r.parts.keys()];
  const noms = db.prepare(`
    SELECT p.id, p.nom, f.nom AS foyer_nom FROM personne p LEFT JOIN foyer f ON f.id = p.foyer_id
    WHERE p.id IN (${ids.map(() => '?').join(',')})
  `).all(...ids) as { id: number; nom: string; foyer_nom: string | null }[];
  const roles = db.prepare('SELECT personne_id, role FROM role_attribue WHERE structure_id = ? AND archive_le IS NULL')
    .all(structureId) as { personne_id: number; role: string }[];

  return noms.map((n) => {
    const parts = r.parts.get(n.id) ?? 0;
    return {
      personneId: n.id, nom: n.nom, foyerNom: n.foyer_nom, parts, total: r.total,
      quotePart: `${String(Math.round((parts * 10000) / r.total) / 100).replace('.', ',')} %`,
      role: roles.find((x) => x.personne_id === n.id)?.role ?? 'detenteur',
    };
  }).sort((a, b) => b.parts - a.parts || a.nom.localeCompare(b.nom, 'fr'));
}

// ============================================================
// Personnes et foyers
// ============================================================

export interface Personne {
  id: number; nom: string; email: string | null; foyerId: number | null; foyerNom: string | null;
  aUnCompte: boolean; derniereConnexion: string | null; archiveLe: string | null;
}

interface LignePersonne {
  id: number; nom: string; email: string | null; foyer_id: number | null; foyer_nom: string | null;
  mot_de_passe_hash: string | null; derniere_connexion: string | null; archive_le: string | null;
}

const versPersonne = (l: LignePersonne): Personne => ({
  id: l.id, nom: l.nom, email: l.email, foyerId: l.foyer_id, foyerNom: l.foyer_nom,
  aUnCompte: !!l.mot_de_passe_hash, derniereConnexion: l.derniere_connexion, archiveLe: l.archive_le,
});

const SELECT_PERSONNE = `
  SELECT p.id, p.nom, p.email, p.foyer_id, f.nom AS foyer_nom, p.mot_de_passe_hash,
         p.derniere_connexion, p.archive_le
  FROM personne p LEFT JOIN foyer f ON f.id = p.foyer_id
`;

export function personne(db: Db, id: number): Personne {
  const l = db.prepare(`${SELECT_PERSONNE} WHERE p.id = ?`).get(id) as LignePersonne | undefined;
  if (!l) throw introuvable('Cette personne');
  return versPersonne(l);
}

export function personnes(db: Db): Personne[] {
  return (db.prepare(`${SELECT_PERSONNE} WHERE p.archive_le IS NULL ORDER BY p.nom`).all() as LignePersonne[]).map(versPersonne);
}

export function creerPersonne(
  db: Db, nom: string, email: string | null, foyerId: number | null, hash: string | null, parQui: number | null,
): number {
  if (email) {
    const deja = db.prepare('SELECT id FROM personne WHERE email = ?').get(email);
    if (deja) throw conflit('Une personne utilise déjà cette adresse de courriel.');
  }
  return Number(db.prepare(
    'INSERT INTO personne (nom, email, foyer_id, mot_de_passe_hash, cree_le, cree_par) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(nom, email, foyerId, hash, horodatage(), parQui).lastInsertRowid);
}

export function creerFoyer(db: Db, nom: string): number {
  return Number(db.prepare('INSERT INTO foyer (nom, cree_le) VALUES (?, ?)').run(nom, horodatage()).lastInsertRowid);
}

export function foyers(db: Db): { id: number; nom: string }[] {
  return db.prepare('SELECT id, nom FROM foyer WHERE archive_le IS NULL ORDER BY nom').all() as { id: number; nom: string }[];
}

export function attribuerRole(
  db: Db, personneId: number, cible: { structureId?: number; bienId?: number }, role: string, debut: string, parQui: number | null,
): void {
  db.prepare(`
    INSERT INTO role_attribue (personne_id, structure_id, bien_id, role, debut, cree_le, cree_par)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(personneId, cible.structureId ?? null, cible.bienId ?? null, role, debut, horodatage(), parQui);
}

/** Y a-t-il au moins une personne ? Sert à savoir si l'instance est amorcée. */
export const instanceAmorcee = (db: Db): boolean =>
  !!(db.prepare('SELECT 1 FROM personne LIMIT 1').get());
