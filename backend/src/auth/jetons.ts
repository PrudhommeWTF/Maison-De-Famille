// Les jetons.
//
// Deux jetons, pas un, et c'est ce qui permet à la fois une durée courte et une
// famille qui ne se reconnecte pas trois fois par jour :
//
//   - le **jeton d'accès** est un JWT de quinze minutes, jamais stocké. Il porte
//     l'identifiant de la personne et sa `token_version`.
//   - le **jeton de renouvellement** est un secret aléatoire de trente jours,
//     stocké **haché** en base (table `session`). Il se révoque un par un depuis
//     un écran, sans déconnecter toute la famille.
//
// Deux pièges classiques, évités explicitement :
//
//   1. **L'algorithme est vérifié.** `jwt.verify` sans `algorithms` accepte ce
//      que le jeton déclare, y compris `none` sur des bibliothèques anciennes.
//      Ici la liste est fermée à HS256.
//   2. **La révocation est réelle.** `token_version` invalide d'un coup tous les
//      jetons d'accès d'une personne (changement de mot de passe, sortie
//      d'indivision), sans attendre leur expiration.
import jwt from 'jsonwebtoken';
import type { Db } from '../noyau/db';
import { ErreurApp } from '../noyau/erreurs';
import { empreinte, jetonLien } from '../noyau/ids';
import { horodatage } from '../noyau/dates';

export const DUREE_ACCES_S = 15 * 60;
export const DUREE_RENOUVELLEMENT_JOURS = 30;

const ALGORITHME = 'HS256' as const;

export interface Charge { sub: number; tv: number }

export const signer = (secret: string, personneId: number, tokenVersion: number): string =>
  jwt.sign({ sub: personneId, tv: tokenVersion } satisfies Charge, secret, {
    algorithm: ALGORITHME, expiresIn: DUREE_ACCES_S,
  });

const expire = new ErreurApp('NON_AUTHENTIFIE', 'Votre session a expiré, reconnectez-vous.');
const invalideJeton = new ErreurApp('NON_AUTHENTIFIE', 'Session invalide, reconnectez-vous.');

/** Décode et vérifie un jeton d'accès. Lève une erreur d'authentification sinon. */
export function verifierAcces(secret: string, jeton: string): Charge {
  let brut: unknown;
  try {
    brut = jwt.verify(jeton, secret, { algorithms: [ALGORITHME] });
  } catch (e) {
    throw e instanceof jwt.TokenExpiredError ? expire : invalideJeton;
  }
  const c = brut as Partial<Charge>;
  if (typeof c.sub !== 'number' || typeof c.tv !== 'number') throw invalideJeton;
  return { sub: c.sub, tv: c.tv };
}

export interface SessionOuverte { jeton: string; expireLe: string }

/** Ouvre une session de renouvellement. Le jeton en clair n'existe qu'ici. */
export function ouvrirSession(
  db: Db, personneId: number, agent: string, ip: string, maintenant = new Date(),
): SessionOuverte {
  const jeton = jetonLien();
  const expireLe = new Date(maintenant.getTime() + DUREE_RENOUVELLEMENT_JOURS * 86_400_000).toISOString();
  db.prepare(`
    INSERT INTO session (personne_id, jeton_hash, cree_le, expire_le, agent, adresse_ip)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(personneId, empreinte(jeton), horodatage(maintenant), expireLe, agent.slice(0, 200), ip.slice(0, 60));
  return { jeton, expireLe };
}

interface LigneSession { id: number; personne_id: number; expire_le: string; revoque_le: string | null }

/**
 * Échange un jeton de renouvellement contre une nouvelle session. La rotation
 * est systématique : un jeton de renouvellement ne sert qu'une fois, ce qui rend
 * un vol détectable et borne la fenêtre d'exploitation.
 */
export function renouveler(
  db: Db, jeton: string, agent: string, ip: string, maintenant = new Date(),
): { personneId: number; session: SessionOuverte } {
  const ligne = db.prepare(
    'SELECT id, personne_id, expire_le, revoque_le FROM session WHERE jeton_hash = ?',
  ).get(empreinte(jeton)) as LigneSession | undefined;

  if (!ligne || ligne.revoque_le || ligne.expire_le <= horodatage(maintenant)) throw expire;

  return db.transaction(() => {
    db.prepare('UPDATE session SET revoque_le = ?, derniere_utilisation = ? WHERE id = ?')
      .run(horodatage(maintenant), horodatage(maintenant), ligne.id);
    return {
      personneId: ligne.personne_id,
      session: ouvrirSession(db, ligne.personne_id, agent, ip, maintenant),
    };
  })();
}

export function revoquer(db: Db, jeton: string, maintenant = new Date()): void {
  db.prepare('UPDATE session SET revoque_le = ? WHERE jeton_hash = ? AND revoque_le IS NULL')
    .run(horodatage(maintenant), empreinte(jeton));
}

/** Toutes les sessions d'une personne. Utilisé au changement de mot de passe. */
export function revoquerTout(db: Db, personneId: number, maintenant = new Date()): void {
  db.prepare('UPDATE session SET revoque_le = ? WHERE personne_id = ? AND revoque_le IS NULL')
    .run(horodatage(maintenant), personneId);
}

/** Les sessions expirées ou révoquées depuis longtemps ne servent plus à rien. */
export function purger(db: Db, maintenant = new Date()): number {
  const limite = new Date(maintenant.getTime() - 90 * 86_400_000).toISOString();
  return db.prepare('DELETE FROM session WHERE expire_le < ? OR (revoque_le IS NOT NULL AND revoque_le < ?)')
    .run(limite, limite).changes;
}
