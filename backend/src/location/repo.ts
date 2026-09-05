// Le dépôt de la location saisonnière et des souvenirs.
//
// **Une réservation crée un séjour.** C'est ce qui la fait apparaître au
// calendrier, entrer dans la détection de conflit et compter dans les nuits
// occupées, sans une ligne de code en plus. La table `location` ne porte que ce
// qu'un séjour ne sait pas dire : le locataire, le loyer, l'acompte.
//
// **`bien_id` est recopié sur chaque photo.** L'album le porte déjà, mais la
// photo aussi : c'est ce qui permet de filtrer en SQL sur le bien du chemin, et
// donc de garantir qu'une photo d'un bien ne peut pas ressortir dans l'album de
// l'autre, même par une erreur de jointure.
import type { Db } from '../noyau/db';
import { horodatage, nuits } from '../noyau/dates';
import { introuvable } from '../noyau/erreurs';
import { log } from '../noyau/log';
import type { Fichier } from '../stockage/fichiers';
import { deposer as deposerFichier } from '../stockage/fichiers';
import type { ChargeLocative, Reservation, StatutLocation } from './net';
import { fabriquer } from './vignettes';

// ---------- Location ----------

export interface ReservationDetaillee extends Reservation {
  sejourId: number;
  email: string;
  telephone: string;
  note: string;
  occupants: number;
}

const SELECT_RESERVATION = `
  SELECT l.id, l.sejour_id AS sejourId, l.locataire, l.email, l.telephone,
         l.loyer_cents AS loyerCents, l.acompte_cents AS acompteCents, l.statut, l.note,
         s.arrivee, s.depart, s.occupants
  FROM location l JOIN sejour s ON s.id = l.sejour_id
`;

export function reservations(db: Db, bienId: number): ReservationDetaillee[] {
  const lignes = db.prepare(
    `${SELECT_RESERVATION} WHERE l.bien_id = ? AND l.archive_le IS NULL ORDER BY s.arrivee`,
  ).all(bienId) as Omit<ReservationDetaillee, 'nuits'>[];
  return lignes.map((l) => ({ ...l, nuits: nuits(l.arrivee, l.depart) }));
}

/** Les dépenses marquées « charge de location » sur l'exercice. */
export function chargesDe(db: Db, bienId: number, annee: number): ChargeLocative[] {
  return db.prepare(
    `SELECT d.id, d.libelle, d.date_depense AS dateDepense, d.montant_cents AS montantCents
     FROM depense d JOIN depense_bien db2 ON db2.depense_id = d.id
     WHERE db2.bien_id = ? AND d.charge_location = 1 AND d.archive_le IS NULL
       AND d.statut <> 'annulee' AND d.date_depense LIKE ?
     ORDER BY d.date_depense`,
  ).all(bienId, `${annee}-%`) as ChargeLocative[];
}

/** Les séjours de famille de l'année, pour l'alerte de saison. */
export function sejoursFamilleDe(db: Db, bienId: number): { arrivee: string }[] {
  return db.prepare(
    `SELECT arrivee FROM sejour
     WHERE bien_id = ? AND nature = 'famille' AND statut = 'valide' AND archive_le IS NULL`,
  ).all(bienId) as { arrivee: string }[];
}

export interface NouvelleReservation {
  locataire: string; email: string; telephone: string;
  arrivee: string; depart: string; occupants: number;
  loyerCents: number; acompteCents: number; note: string;
}

export function creerReservation(
  db: Db, bienId: number, v: NouvelleReservation, parQui: number,
): { id: number; sejourId: number } {
  return db.transaction(() => {
    // Le séjour d'abord : c'est lui qui occupe le calendrier. Statut « valide »
    // parce qu'une réservation saisie par la gérante est décidée, pas demandée.
    const sejourId = Number(db.prepare(
      `INSERT INTO sejour (bien_id, demandeur_id, foyer_id, titre, arrivee, depart, occupants,
                           nature, statut, note, origine, cree_le, cree_par)
       VALUES (?, NULL, NULL, ?, ?, ?, ?, 'location', 'valide', ?, 'gerante', ?, ?)`,
    ).run(bienId, `Location ${v.locataire}`, v.arrivee, v.depart, v.occupants, v.note,
      horodatage(), parQui).lastInsertRowid);

    const id = Number(db.prepare(
      `INSERT INTO location (sejour_id, bien_id, locataire, email, telephone, loyer_cents,
                             acompte_cents, statut, note, cree_le, cree_par)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(sejourId, bienId, v.locataire, v.email, v.telephone, v.loyerCents, v.acompteCents,
      v.acompteCents > 0 ? 'acompte' : 'a_confirmer', v.note, horodatage(), parQui).lastInsertRowid);

    log.info(`Réservation ${id} créée sur le bien ${bienId} pour « ${v.locataire} » `
      + `du ${v.arrivee} au ${v.depart}.`);
    return { id, sejourId };
  })();
}

export function changerStatut(
  db: Db, bienId: number, id: number, statut: StatutLocation,
  acompteCents: number | null, parQui: number,
): void {
  const l = db.prepare(
    'SELECT sejour_id AS sejourId, loyer_cents AS loyerCents FROM location WHERE id = ? AND bien_id = ? AND archive_le IS NULL',
  ).get(id, bienId) as { sejourId: number; loyerCents: number } | undefined;
  if (!l) throw introuvable('Cette réservation');

  db.transaction(() => {
    // « Soldé » veut dire que tout est encaissé : l'acompte rejoint le loyer,
    // sinon l'exercice compterait moins que ce qui est réellement rentré.
    const acompte = statut === 'solde' ? l.loyerCents
      : acompteCents !== null ? Math.min(acompteCents, l.loyerCents) : null;
    if (acompte !== null) {
      db.prepare('UPDATE location SET statut = ?, acompte_cents = ? WHERE id = ?').run(statut, acompte, id);
    } else {
      db.prepare('UPDATE location SET statut = ? WHERE id = ?').run(statut, id);
    }
    // Une réservation annulée libère le calendrier : sinon la semaine resterait
    // bloquée pour la famille, ce qui est exactement l'inverse du but.
    db.prepare("UPDATE sejour SET statut = ? WHERE id = ?")
      .run(statut === 'annule' ? 'annule' : 'valide', l.sejourId);
  })();
  log.info(`Réservation ${id} passée à « ${statut} » par la personne ${parQui}.`);
}

// ---------- Souvenirs ----------

export interface Album {
  id: number; bienId: number; sejourId: number | null; titre: string; annee: number;
  photos: number; couvertureId: string | null;
}

export function albums(db: Db, bienId: number): Album[] {
  return db.prepare(
    `SELECT a.id, a.bien_id AS bienId, a.sejour_id AS sejourId, a.titre, a.annee,
            (SELECT COUNT(*) FROM photo p WHERE p.album_id = a.id AND p.archive_le IS NULL) AS photos,
            (SELECT COALESCE(p.vignette_id, p.fichier_id) FROM photo p
              WHERE p.album_id = a.id AND p.archive_le IS NULL ORDER BY p.id LIMIT 1) AS couvertureId
     FROM album a WHERE a.bien_id = ? AND a.archive_le IS NULL
     ORDER BY a.annee DESC, a.id DESC`,
  ).all(bienId) as Album[];
}

export function creerAlbum(
  db: Db, bienId: number, titre: string, annee: number, sejourId: number | null, parQui: number | null,
): number {
  return Number(db.prepare(
    'INSERT INTO album (bien_id, sejour_id, titre, annee, cree_le, cree_par) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(bienId, sejourId, titre, annee, horodatage(), parQui).lastInsertRowid);
}

export interface PhotoLue {
  id: number; albumId: number; fichierId: string; vignetteId: string | null;
  legende: string; deposeLe: string; deposePar: number | null; deposeParNom: string | null;
}

const SELECT_PHOTO = `
  SELECT p.id, p.album_id AS albumId, p.fichier_id AS fichierId, p.vignette_id AS vignetteId,
         p.legende, p.depose_le AS deposeLe, p.depose_par AS deposePar, q.nom AS deposeParNom
  FROM photo p LEFT JOIN personne q ON q.id = p.depose_par
`;

/**
 * Les photos d'un album. Le filtre porte sur `p.bien_id`, pas seulement sur
 * l'album : c'est ce qui rend impossible de voir les photos d'un autre bien en
 * devinant un identifiant d'album.
 */
export function photos(db: Db, bienId: number, albumId: number): PhotoLue[] {
  const a = db.prepare('SELECT id FROM album WHERE id = ? AND bien_id = ? AND archive_le IS NULL')
    .get(albumId, bienId);
  if (!a) throw introuvable('Cet album');
  return db.prepare(
    `${SELECT_PHOTO} WHERE p.album_id = ? AND p.bien_id = ? AND p.archive_le IS NULL ORDER BY p.id`,
  ).all(albumId, bienId) as PhotoLue[];
}

export function photo(db: Db, bienId: number, id: number): PhotoLue {
  const p = db.prepare(`${SELECT_PHOTO} WHERE p.id = ? AND p.bien_id = ? AND p.archive_le IS NULL`)
    .get(id, bienId) as PhotoLue | undefined;
  if (!p) throw introuvable('Cette photo');
  return p;
}

/**
 * Ajoute une photo et fabrique sa vignette.
 *
 * La vignette est un fichier comme un autre, déposé dans le même service : elle
 * hérite donc de l'identifiant non devinable, de la déduplication et du
 * contrôle d'autorisation au téléchargement, sans rien de particulier.
 */
export function ajouterPhoto(
  db: Db, bienId: number, albumId: number, fichier: Fichier, octets: Buffer,
  legende: string, parQui: number,
): PhotoLue {
  const a = db.prepare('SELECT id FROM album WHERE id = ? AND bien_id = ? AND archive_le IS NULL')
    .get(albumId, bienId);
  if (!a) throw introuvable('Cet album');

  let vignetteId: string | null = null;
  const v = fabriquer(octets, fichier.mime);
  if (v) {
    // La limite de taille du service de fichiers ne s'applique pas ici : une
    // vignette pèse quelques dizaines de kilo-octets par construction.
    vignetteId = deposerFichier(db, v.contenu, `vignette-${fichier.id}.jpg`, parQui, 64).fichier.id;
  } else {
    log.debug(`Aucune vignette pour ${fichier.id} (${fichier.mime}) : servie telle quelle.`);
  }

  const id = Number(db.prepare(
    `INSERT INTO photo (album_id, bien_id, fichier_id, vignette_id, legende, depose_le, depose_par)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(albumId, bienId, fichier.id, vignetteId, legende, horodatage(), parQui).lastInsertRowid);
  return photo(db, bienId, id);
}

export function archiverPhoto(db: Db, bienId: number, id: number): void {
  db.prepare('UPDATE photo SET archive_le = ? WHERE id = ? AND bien_id = ?')
    .run(horodatage(), id, bienId);
}

// ---------- Livre d'or ----------

export interface Mot {
  id: number; annee: number; texte: string; signature: string;
  ecritLe: string; ecritParNom: string | null;
}

export function motsDe(db: Db, bienId: number): Mot[] {
  return db.prepare(
    `SELECT m.id, m.annee, m.texte, m.signature, m.ecrit_le AS ecritLe, p.nom AS ecritParNom
     FROM mot_livre_or m LEFT JOIN personne p ON p.id = m.ecrit_par
     WHERE m.bien_id = ? AND m.archive_le IS NULL
     ORDER BY m.annee DESC, m.id DESC`,
  ).all(bienId) as Mot[];
}

export function ecrireMot(
  db: Db, bienId: number,
  v: { texte: string; signature: string; annee: number; sejourId: number | null },
  parQui: number,
): number {
  return Number(db.prepare(
    `INSERT INTO mot_livre_or (bien_id, sejour_id, annee, texte, signature, ecrit_le, ecrit_par)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(bienId, v.sejourId, v.annee, v.texte, v.signature, horodatage(), parQui).lastInsertRowid);
}
