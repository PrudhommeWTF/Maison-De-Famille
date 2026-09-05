// Les accès temporaires : un invité ou un locataire entre par un lien, sans
// compte, pour une durée bornée et révocable.
//
// **Deux verrous indépendants, et il faut les deux.**
//
//   1. Le **jeton** expire : passé la date, il n'ouvre plus de session. C'est
//      ce qui empêche quelqu'un de revenir avec un vieux courriel.
//   2. Le **rôle** expire : `role_attribue.fin` porte la même date, et la
//      portée est recalculée à chaque requête à partir des rôles en cours. Une
//      session déjà ouverte perd donc son accès toute seule.
//
// Le second verrou est celui qui compte pour la recette : « un lien d'invité
// expiré ne donne plus accès au code d'accès, y compris en tapant l'adresse
// directement ». Sans lui, un locataire dont le séjour est fini garderait son
// onglet ouvert et son jeton d'accès valide jusqu'à expiration, quinze minutes
// plus tard peut-être, mais surtout renouvelable. Avec lui, il n'y a plus rien
// à voir : la portée est vide, et toutes les routes de bien répondent comme
// pour un étranger.
//
// **Pourquoi une vraie personne plutôt qu'un principal parallèle.** Un second
// mécanisme d'authentification, c'est un second endroit où se tromper. En
// créant une personne sans mot de passe et un rôle daté, tout le reste de
// l'application continue de fonctionner sans savoir que ce visiteur est arrivé
// par un lien : la portée du coffre-fort, le journal d'affichage des codes, les
// notifications. Le prix est un drapeau, `acces_lien_seul`, qui interdit à ce
// compte de se transformer en compte permanent par « mot de passe oublié ».
import type { Db } from '../noyau/db';
import { aujourdhui, horodatage } from '../noyau/dates';
import { introuvable } from '../noyau/erreurs';
import { log } from '../noyau/log';
import { empreinte, jetonLien } from '../noyau/ids';
import { revoquerTout } from '../auth/jetons';

export class AccesRefuse extends Error {}

export interface AccesTemporaire {
  id: number;
  bienId: number;
  bienNom: string;
  personneId: number;
  libelle: string;
  sejourId: number | null;
  expireLe: string;
  revoqueLe: string | null;
  derniereUtilisation: string | null;
  utilisations: number;
  /** Ce que le lien vaut aujourd'hui, dit en français pour l'écran. */
  etat: 'actif' | 'expire' | 'revoque';
}

const etatDe = (l: { expireLe: string; revoqueLe: string | null }, jour: string): AccesTemporaire['etat'] =>
  l.revoqueLe ? 'revoque' : l.expireLe < jour ? 'expire' : 'actif';

export function liste(db: Db, bienId: number, jour = aujourdhui()): AccesTemporaire[] {
  const lignes = db.prepare(
    `SELECT a.id, a.bien_id AS bienId, b.nom AS bienNom, a.personne_id AS personneId, a.libelle,
            a.sejour_id AS sejourId, a.expire_le AS expireLe, a.revoque_le AS revoqueLe,
            a.derniere_utilisation AS derniereUtilisation, a.utilisations
     FROM acces_temporaire a JOIN bien b ON b.id = a.bien_id
     WHERE a.bien_id = ? ORDER BY a.cree_le DESC`,
  ).all(bienId) as Omit<AccesTemporaire, 'etat'>[];
  return lignes.map((l) => ({ ...l, etat: etatDe(l, jour) }));
}

export interface Ouverture {
  /** Le lien complet, à transmettre. Rendu une seule fois. */
  lien: string;
  acces: AccesTemporaire;
}

/**
 * Ouvre un accès temporaire. Crée la personne, le rôle daté et le jeton, dans
 * une seule transaction : trois écritures dont l'une échoue laisseraient un
 * compte sans accès ou un accès sans compte.
 */
export function ouvrir(
  db: Db, bienId: number,
  v: { libelle: string; email: string | null; sejourId: number | null; expireLe: string },
  parQui: number, urlBase: string,
): Ouverture {
  const jeton = jetonLien();
  const id = db.transaction(() => {
    const personneId = Number(db.prepare(
      `INSERT INTO personne (nom, email, foyer_id, mot_de_passe_hash, acces_lien_seul, cree_le, cree_par)
       VALUES (?, ?, NULL, NULL, 1, ?, ?)`,
    ).run(v.libelle, v.email, horodatage(), parQui).lastInsertRowid);

    // Le rôle porte la date de fin : c'est lui qui coupe l'accès des sessions
    // déjà ouvertes, sans rien avoir à révoquer activement.
    const roleId = Number(db.prepare(
      `INSERT INTO role_attribue (personne_id, structure_id, bien_id, role, debut, fin, cree_le, cree_par)
       VALUES (?, NULL, ?, 'invite', ?, ?, ?, ?)`,
    ).run(personneId, bienId, aujourdhui(), v.expireLe, horodatage(), parQui).lastInsertRowid);

    return Number(db.prepare(
      `INSERT INTO acces_temporaire (bien_id, personne_id, role_id, sejour_id, jeton_hash,
                                     libelle, expire_le, cree_le, cree_par)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(bienId, personneId, roleId, v.sejourId, empreinte(jeton), v.libelle, v.expireLe,
      horodatage(), parQui).lastInsertRowid);
  })();

  log.info(`Accès temporaire ${id} ouvert sur le bien ${bienId} pour « ${v.libelle} » `
    + `jusqu'au ${v.expireLe}, par la personne ${parQui}.`);
  const acces = liste(db, bienId).find((a) => a.id === id)!;
  return { lien: `${urlBase.replace(/\/+$/, '')}/sejour?jeton=${encodeURIComponent(jeton)}`, acces };
}

/**
 * Échange un jeton contre l'identité de son porteur.
 *
 * Le message de refus ne distingue pas « jeton inconnu » de « jeton expiré » :
 * le premier renseignerait sur l'existence d'un lien, et la marche à suivre est
 * la même dans les deux cas, demander un nouveau lien à la gérante.
 */
export function ouvrirSession(db: Db, jeton: string, jour = aujourdhui()): { personneId: number; bienId: number; libelle: string } {
  const l = db.prepare(
    `SELECT id, personne_id AS personneId, bien_id AS bienId, libelle, expire_le AS expireLe,
            revoque_le AS revoqueLe
     FROM acces_temporaire WHERE jeton_hash = ?`,
  ).get(empreinte(jeton)) as {
    id: number; personneId: number; bienId: number; libelle: string;
    expireLe: string; revoqueLe: string | null;
  } | undefined;

  if (!l || l.revoqueLe || l.expireLe < jour) {
    throw new AccesRefuse(
      "Ce lien n'est plus valable. Demandez-en un nouveau à la personne qui vous l'a envoyé.");
  }
  db.prepare(
    'UPDATE acces_temporaire SET derniere_utilisation = ?, utilisations = utilisations + 1 WHERE id = ?',
  ).run(horodatage(), l.id);
  return { personneId: l.personneId, bienId: l.bienId, libelle: l.libelle };
}

/**
 * Révoque un accès, tout de suite.
 *
 * Quatre écritures, et les quatre comptent :
 *
 *   - le jeton du lien cesse d'ouvrir de nouvelles sessions ;
 *   - le rôle est archivé, donc la portée devient vide dès la requête suivante ;
 *   - `token_version` invalide les jetons d'accès en circulation ;
 *   - **les sessions sont révoquées**, ce qui invalide les jetons de
 *     renouvellement.
 *
 * La dernière a été ajoutée après l'avoir vu manquer au navigateur : sans elle,
 * le porteur restait connecté, dans une application vide certes, mais connecté,
 * parce que son jeton de renouvellement se rechargeait tout seul avec la
 * nouvelle version. La sécurité tenait, l'ergonomie non, et un accès révoqué
 * doit ramener à l'écran de connexion, pas à un tableau de bord sans rien
 * dedans.
 */
export function revoquer(db: Db, bienId: number, id: number, parQui: number): void {
  const l = db.prepare(
    'SELECT personne_id AS personneId, role_id AS roleId, libelle FROM acces_temporaire WHERE id = ? AND bien_id = ? AND revoque_le IS NULL',
  ).get(id, bienId) as { personneId: number; roleId: number; libelle: string } | undefined;
  if (!l) throw introuvable('Cet accès temporaire');

  db.transaction(() => {
    db.prepare('UPDATE acces_temporaire SET revoque_le = ? WHERE id = ?').run(horodatage(), id);
    db.prepare('UPDATE role_attribue SET archive_le = ?, fin = ? WHERE id = ?')
      .run(horodatage(), aujourdhui(), l.roleId);
    db.prepare('UPDATE personne SET token_version = token_version + 1 WHERE id = ?').run(l.personneId);
    revoquerTout(db, l.personneId);
  })();
  log.info(`Accès temporaire ${id} (« ${l.libelle} ») révoqué par la personne ${parQui}.`);
}

/** Un compte ouvert par lien ne devient jamais un compte permanent. */
export const estLienSeul = (db: Db, personneId: number): boolean =>
  !!(db.prepare('SELECT acces_lien_seul AS f FROM personne WHERE id = ?')
    .get(personneId) as { f: number } | undefined)?.f;
