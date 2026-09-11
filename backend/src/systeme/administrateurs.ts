// Qui administre la plateforme.
//
// **Ce droit ne se déduit d'aucun rôle et n'en donne aucun.** Un administrateur
// tient la machine : version, mises à jour, réglages d'instance, relais de
// courriel, journal, calendrier scolaire. Il ne voit pas pour autant un bien
// auquel il n'est pas rattaché, et la règle la plus importante de
// l'application reste entière.
//
// **Il ne se donne qu'entre administrateurs.** Une gérante ne l'accorde pas au
// titre de sa gérance : ce serait refaire le mélange qu'on vient de défaire.
// La migration 010 l'a donné aux gérants en poste, ce qui fait qu'aucune
// instance existante ne s'est retrouvée sans personne pour l'accorder.
//
// **On ne retire jamais le dernier.** Une instance sans administrateur ne se
// répare plus depuis l'interface : il faut un accès au serveur et une commande
// SQL. C'est la même règle que les deux gérants d'une structure, pour la même
// raison, et elle se vérifie ici et non dans la route.
import type { Db } from '../noyau/db';
import { horodatage } from '../noyau/dates';
import { introuvable } from '../noyau/erreurs';
import { log } from '../noyau/log';

export class AdministrationImpossible extends Error {}

export interface Administrable {
  personneId: number;
  nom: string;
  email: string | null;
  administrateur: boolean;
  /** Vrai quand la personne gère au moins une structure : affiché pour situer. */
  gerant: boolean;
}

/**
 * Les personnes de l'instance, avec leur droit d'administration.
 *
 * Le nom et l'adresse suffisent à désigner quelqu'un ; rien d'autre n'est rendu.
 * Un administrateur qui n'est rattaché à aucun bien n'a pas à savoir qui détient
 * quoi, et cette liste ne le lui apprend pas.
 *
 * **Les accès temporaires par lien en sont exclus.** Ce sont des locataires de
 * passage, sans mot de passe, dont le compte n'existe que le temps d'un séjour :
 * les proposer à la nomination était un piège, repéré à la première recette.
 */
export const administrables = (db: Db): Administrable[] => db.prepare(`
  SELECT p.id AS personneId, p.nom, p.email,
         p.admin_plateforme AS admin,
         EXISTS (
           SELECT 1 FROM role_attribue r
           WHERE r.personne_id = p.id AND r.role = 'gerant'
             AND r.archive_le IS NULL AND (r.fin IS NULL OR r.fin >= date('now'))
         ) AS gere
  FROM personne p
  WHERE p.archive_le IS NULL AND p.acces_lien_seul = 0
  ORDER BY p.admin_plateforme DESC, p.nom
`).all().map((l) => {
  const r = l as { personneId: number; nom: string; email: string | null; admin: number; gere: number };
  return {
    personneId: r.personneId, nom: r.nom, email: r.email,
    administrateur: r.admin === 1, gerant: r.gere === 1,
  };
});

export const compterAdministrateurs = (db: Db): number =>
  (db.prepare('SELECT COUNT(*) AS n FROM personne WHERE admin_plateforme = 1 AND archive_le IS NULL')
    .get() as { n: number }).n;

/**
 * Accorde ou retire le droit. Rend `true` si quelque chose a changé.
 *
 * Le retrait du dernier administrateur est refusé avant d'écrire, et non
 * rattrapé après : une base qui passe une milliseconde sans administrateur est
 * une base où un incident au mauvais moment laisse l'instance close.
 */
export function poserAdministrateur(db: Db, personneId: number, actif: boolean, parQui: number): boolean {
  const cible = db.prepare(
    'SELECT nom, admin_plateforme AS admin FROM personne WHERE id = ? AND archive_le IS NULL',
  ).get(personneId) as { nom: string; admin: number } | undefined;
  if (!cible) throw new AdministrationImpossible('Cette personne n\'existe pas sur cette instance.');
  if ((cible.admin === 1) === actif) return false;

  if (!actif && compterAdministrateurs(db) <= 1) {
    throw new AdministrationImpossible(
      'C\'est le dernier administrateur de la plateforme : le retirer fermerait l\'administration '
      + 'à tout le monde, et il faudrait un accès au serveur pour la rouvrir. '
      + 'Désignez d\'abord quelqu\'un d\'autre.',
    );
  }

  db.transaction(() => {
    db.prepare('UPDATE personne SET admin_plateforme = ? WHERE id = ?').run(actif ? 1 : 0, personneId);
    db.prepare(`
      INSERT INTO journal_audit (acteur_id, action, objet_kind, objet_id, detail_json, fait_le)
      VALUES (?, ?, 'personne', ?, ?, ?)
    `).run(
      parQui, actif ? 'plateforme.administrateur.ajout' : 'plateforme.administrateur.retrait',
      personneId, JSON.stringify({ nom: cible.nom }), horodatage(),
    );
  })();
  return true;
}

// ---------------------------------------------------------------------------
// Réparer un accès, et rien de plus.
//
// **Où passe la cloison.** Un administrateur de plateforme tient la machine, pas
// les gens : il ne crée personne, n'archive personne, ne rattache personne à un
// foyer, ne donne aucun rôle et ne voit ni les foyers ni les quotes-parts. Les
// deux gestes ci-dessous sont du travail de machine, au même titre que
// réinstaller un service.
//
// **Pourquoi le second facteur avait besoin de ça.** Personne ne pouvait retirer
// celui d'un autre. Un téléphone perdu avec les codes de secours fermait le
// compte pour toujours, et il fallait ouvrir la base à la main pour en sortir.
// ---------------------------------------------------------------------------

export interface Compte {
  id: number; nom: string; email: string | null;
  aUnCompte: boolean; derniereConnexion: string | null; secondFacteur: boolean;
}

/**
 * Les comptes, vus par un administrateur de plateforme.
 *
 * Volontairement plus pauvre que `personnes()` : ni foyer, ni rôle, ni
 * quote-part. Ce qu'il faut pour réparer un accès, pas pour connaître la
 * composition de la famille.
 */
export const comptes = (db: Db): Compte[] => (db.prepare(`
  SELECT id, nom, email, mot_de_passe_hash AS hash, derniere_connexion AS derniereConnexion,
         totp_secret AS totp
  FROM personne
  WHERE archive_le IS NULL AND acces_lien_seul = 0
  ORDER BY nom
`).all() as { id: number; nom: string; email: string | null; hash: string | null;
  derniereConnexion: string | null; totp: string | null }[])
  .map((l) => ({
    id: l.id, nom: l.nom, email: l.email, aUnCompte: !!l.hash,
    derniereConnexion: l.derniereConnexion, secondFacteur: !!l.totp,
  }));

/**
 * Retirer le second facteur d'un compte bloqué.
 *
 * Ne donne aucun accès par lui-même : il reste le mot de passe. Combiné à
 * l'envoi d'un lien de réinitialisation, que l'administrateur déclenche mais ne
 * lit pas (il part par courriel, jamais affiché à l'écran), il ne compose pas
 * une prise de contrôle. Le geste est confirmé par le mot de passe de
 * l'administrateur et écrit au journal d'audit : c'est exactement le traitement
 * réservé à l'installation d'une mise à jour, et pour la même raison.
 */
export function retirerSecondFacteur(db: Db, personneId: number, parQui: number): string {
  const cible = db.prepare(
    'SELECT nom, totp_secret AS totp FROM personne WHERE id = ? AND archive_le IS NULL',
  ).get(personneId) as { nom: string; totp: string | null } | undefined;
  if (!cible) throw introuvable('Cette personne');
  if (!cible.totp) {
    throw new AdministrationImpossible(
      `${cible.nom} n'a pas de second facteur actif : il n'y a rien à retirer.`,
    );
  }
  db.transaction(() => {
    // `token_version` incrémenté : les sessions ouvertes tombent. Sans cela, un
    // téléphone volé encore connecté garderait sa session après le déblocage.
    db.prepare(`
      UPDATE personne SET totp_secret = NULL, totp_pending = NULL, totp_recovery = '[]',
                          totp_last_step = 0, totp_active_le = NULL,
                          token_version = token_version + 1
      WHERE id = ?
    `).run(personneId);
    db.prepare(`
      INSERT INTO journal_audit (acteur_id, action, objet_kind, objet_id, detail_json, fait_le)
      VALUES (?, 'plateforme.second_facteur.retrait', 'personne', ?, ?, ?)
    `).run(parQui, personneId, JSON.stringify({ nom: cible.nom }), horodatage());
  })();
  log.attention(`Second facteur de ${cible.nom} (${personneId}) retiré par la personne ${parQui}.`);
  return cible.nom;
}
