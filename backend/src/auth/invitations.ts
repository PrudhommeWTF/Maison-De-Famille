// L'invitation d'une personne : ouvrir un jeton de lien, et le porter jusqu'à
// elle, par courriel ou de la main à la main.
//
// **Le repli est volontaire.** Le jour de l'installation, aucun relais SMTP
// n'est encore configuré, et une famille qui ne peut pas se créer de comptes ce
// jour-là ne reviendra pas. Le gérant peut donc afficher le lien en clair et le
// transmettre comme il veut : message, téléphone, papier.
//
// Ce repli a un prix, et il faut le nommer : **afficher le lien, c'est pouvoir
// choisir le mot de passe de quelqu'un d'autre.** Trois contreparties :
//
//   1. l'affichage est réservé au gérant, comme la création elle-même ;
//   2. il est daté en base (`vu_le`) et journalisé, avec qui a regardé ;
//   3. le jeton n'est jamais rendu deux fois : redemander le lien en engendre
//      un nouveau et périme le précédent, si bien qu'un lien noté quelque part
//      cesse de valoir dès la fois suivante.
import type { Db } from '../noyau/db';
import { horodatage } from '../noyau/dates';
import { log } from '../noyau/log';
import { parametre } from '../parametres/repo';
import { deposer } from '../notifications/file';
import { invitation as gabaritInvitation } from '../notifications/gabarits';
import { empreinte, jetonLien } from '../noyau/ids';

/** Sept jours : une invitation traverse un week-end et des vacances. */
export const JOURS_INVITATION = 7;

export interface Invitation {
  /** Le lien complet, à afficher au gérant ou à envoyer. */
  lien: string;
  expireLe: string;
  /** Vrai si un courriel a effectivement été mis en file. */
  courrielEnFile: boolean;
}

/**
 * Ouvre une invitation pour une personne, périme les précédentes, et met le
 * courriel en file si la personne a une adresse.
 *
 * `parId` est le gérant qui invite : il apparaît dans le message, parce qu'un
 * courriel signé d'un nom connu se lit, et qu'un courriel anonyme se jette.
 */
export function inviter(db: Db, personneId: number, parId: number, urlBase: string): Invitation {
  const cible = db.prepare('SELECT nom, email, archive_le FROM personne WHERE id = ?')
    .get(personneId) as { nom: string; email: string | null; archive_le: string | null } | undefined;
  if (!cible) throw new Error(`Personne ${personneId} introuvable.`);
  if (cible.archive_le) throw new Error(`La personne ${personneId} est archivée.`);

  const par = db.prepare('SELECT nom FROM personne WHERE id = ?')
    .get(parId) as { nom: string } | undefined;

  const jeton = jetonLien();
  const expireLe = new Date(Date.now() + JOURS_INVITATION * 86_400_000).toISOString();
  const base = urlBase.replace(/\/+$/, '');

  db.transaction(() => {
    // Un seul lien vivant à la fois : le précédent, noté sur un coin de table,
    // cesse de valoir dès qu'on en redemande un.
    db.prepare(
      "UPDATE reinit_mot_de_passe SET utilise_le = ? WHERE personne_id = ? AND utilise_le IS NULL")
      .run(horodatage(), personneId);
    db.prepare(
      `INSERT INTO reinit_mot_de_passe (personne_id, jeton_hash, cree_le, expire_le, motif, cree_par)
       VALUES (?, ?, ?, ?, 'invitation', ?)`)
      .run(personneId, empreinte(jeton), horodatage(), expireLe, parId);
  })();

  const message = gabaritInvitation({
    instance: parametre<string>(db, 'instanceNom'),
    urlBase: base, jeton, jours: JOURS_INVITATION,
    invitePar: par?.nom ?? 'Un gérant',
  });

  // `deposer` rend faux si la personne n'a pas d'adresse : on lit sa réponse
  // plutôt que de la déduire, sinon l'écran annoncerait un courriel parti alors
  // qu'il n'a jamais quitté la file.
  const courrielEnFile = deposer(db, { personneId, type: 'invitation', message });
  log.info(
    `Invitation ouverte pour la personne ${personneId} par ${parId}`
    + (courrielEnFile ? ' (courriel en file).' : ' (sans adresse de courriel, lien à transmettre à la main).'));

  return { lien: message.lien, expireLe, courrielEnFile };
}

/**
 * Marque qu'un gérant a regardé le lien en clair. Appelé au moment de
 * l'affichage, pas de la création : ouvrir une invitation qui part par courriel
 * n'expose rien, la regarder si.
 */
export function marquerLienVu(db: Db, personneId: number, parId: number): void {
  db.prepare(
    "UPDATE reinit_mot_de_passe SET vu_le = ? WHERE personne_id = ? AND motif = 'invitation' AND utilise_le IS NULL")
    .run(horodatage(), personneId);
  log.attention(`Lien d'invitation de la personne ${personneId} affiché en clair à la personne ${parId}.`);
}
