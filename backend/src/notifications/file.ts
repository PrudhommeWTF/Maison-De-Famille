// La file d'attente des notifications.
//
// **Une notification est écrite en base avant d'être envoyée.** C'est la
// différence entre « le courriel n'est jamais arrivé et personne ne sait
// pourquoi » et « la file montre trois tentatives et l'erreur exacte du relais ».
// Un serveur SMTP injoignable à minuit ne perd rien.
import type { Db } from '../noyau/db';
import { horodatage } from '../noyau/dates';
import { log } from '../noyau/log';
import { Message, TYPES, TypeNotification } from './gabarits';

export interface EnFile { personneId: number; type: TypeNotification; message: Message }

/** Cette personne veut-elle ce type de message ? Le défaut vient du gabarit. */
export function accepte(db: Db, personneId: number, type: TypeNotification): boolean {
  const d = TYPES.find((t) => t.type === type);
  if (d?.obligatoire) return true;
  const l = db.prepare('SELECT actif FROM notification_pref WHERE personne_id = ? AND type = ?')
    .get(personneId, type) as { actif: number } | undefined;
  return l ? !!l.actif : d?.defaut ?? true;
}

/**
 * Met une notification en file. Une personne sans adresse de courriel, ou qui a
 * coupé ce type de message, n'en reçoit pas : ce n'est pas une erreur, c'est le
 * réglage qui s'applique.
 */
export function deposer(db: Db, n: EnFile, maintenant = new Date()): boolean {
  const p = db.prepare('SELECT email FROM personne WHERE id = ? AND archive_le IS NULL')
    .get(n.personneId) as { email: string | null } | undefined;
  if (!p?.email) return false;
  if (!accepte(db, n.personneId, n.type)) return false;

  db.prepare(`
    INSERT INTO notification (personne_id, type, sujet, corps_texte, corps_html, lien, cree_le, prochaine_tentative)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(n.personneId, n.type, n.message.sujet, n.message.texte, n.message.html, n.message.lien,
    horodatage(maintenant), horodatage(maintenant));
  log.debug(`Notification ${n.type} en file pour la personne ${n.personneId}.`);
  return true;
}

export interface AEnvoyer {
  id: number; personneId: number; email: string; type: string;
  sujet: string; corpsTexte: string; corpsHtml: string; tentatives: number;
}

export function prochaines(db: Db, limite = 20, maintenant = new Date()): AEnvoyer[] {
  return db.prepare(`
    SELECT n.id, n.personne_id AS personneId, p.email, n.type, n.sujet,
           n.corps_texte AS corpsTexte, n.corps_html AS corpsHtml, n.tentatives
    FROM notification n JOIN personne p ON p.id = n.personne_id
    WHERE n.envoye_le IS NULL AND n.abandonne_le IS NULL
      AND n.prochaine_tentative <= ? AND p.email IS NOT NULL
    ORDER BY n.cree_le LIMIT ?
  `).all(horodatage(maintenant), limite) as AEnvoyer[];
}

export function marquerEnvoyee(db: Db, id: number, maintenant = new Date()): void {
  db.prepare('UPDATE notification SET envoye_le = ?, derniere_erreur = NULL WHERE id = ?')
    .run(horodatage(maintenant), id);
}

/**
 * Un échec de plus. L'attente double à chaque fois (une minute, deux, quatre),
 * puis la notification est abandonnée et **reste visible** dans l'écran d'état
 * avec le message du relais. Une notification qui disparaît sans laisser de
 * trace est le pire des cas : personne ne saura jamais qu'elle n'est pas partie.
 */
export function marquerEchec(db: Db, id: number, erreur: string, maxTentatives: number, maintenant = new Date()): void {
  const l = db.prepare('SELECT tentatives FROM notification WHERE id = ?').get(id) as { tentatives: number } | undefined;
  const tentatives = (l?.tentatives ?? 0) + 1;
  if (tentatives >= maxTentatives) {
    db.prepare('UPDATE notification SET tentatives = ?, abandonne_le = ?, derniere_erreur = ? WHERE id = ?')
      .run(tentatives, horodatage(maintenant), erreur.slice(0, 500), id);
    log.erreur(`Notification ${id} abandonnée après ${tentatives} tentatives : ${erreur}`);
    return;
  }
  const attenteMs = Math.min(60_000 * 2 ** (tentatives - 1), 6 * 3_600_000);
  db.prepare('UPDATE notification SET tentatives = ?, prochaine_tentative = ?, derniere_erreur = ? WHERE id = ?')
    .run(tentatives, horodatage(new Date(maintenant.getTime() + attenteMs)), erreur.slice(0, 500), id);
  log.attention(`Notification ${id} en échec (tentative ${tentatives}), nouvel essai dans ${Math.round(attenteMs / 60000)} min`, erreur);
}

export interface EtatFile { enAttente: number; abandonnees: number; envoyees24h: number; dernieresErreurs: { type: string; erreur: string; cree: string }[] }

/** Ce que montre l'écran d'état système : la file, et pourquoi elle coince. */
export function etat(db: Db, maintenant = new Date()): EtatFile {
  const hier = horodatage(new Date(maintenant.getTime() - 86_400_000));
  const un = (sql: string, ...p: unknown[]): number => (db.prepare(sql).get(...p) as { n: number }).n;
  return {
    enAttente: un('SELECT COUNT(*) AS n FROM notification WHERE envoye_le IS NULL AND abandonne_le IS NULL'),
    abandonnees: un('SELECT COUNT(*) AS n FROM notification WHERE abandonne_le IS NOT NULL'),
    envoyees24h: un('SELECT COUNT(*) AS n FROM notification WHERE envoye_le >= ?', hier),
    dernieresErreurs: db.prepare(`
      SELECT type, derniere_erreur AS erreur, cree_le AS cree FROM notification
      WHERE derniere_erreur IS NOT NULL ORDER BY id DESC LIMIT 5
    `).all() as { type: string; erreur: string; cree: string }[],
  };
}
