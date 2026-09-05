// L'envoi effectif, et l'ordonnanceur qui dépile la file.
//
// **C'est la seule sortie réseau de toute l'application.** Aucun autre module ne
// contacte quoi que ce soit à l'extérieur : ni polices distantes, ni icônes de
// CDN, ni télémétrie. Le relais SMTP est configuré par l'administrateur, et il
// est le seul.
//
// Le choix du relais authentifié plutôt que de l'envoi direct depuis le
// conteneur n'est pas une préférence : une adresse résidentielle ou un préfixe
// d'hébergeur non réputé se fait classer en indésirable par Gmail et Outlook,
// silencieusement. Les messages ne seraient jamais lus, et personne ne saurait
// pourquoi.
import nodemailer, { Transporter } from 'nodemailer';
import type { Db } from '../noyau/db';
import type { Config } from '../noyau/config';
import { log } from '../noyau/log';
import { parametre } from '../parametres/repo';
import { marquerEchec, marquerEnvoyee, prochaines } from './file';

let transport: Transporter | null = null;

function obtenir(config: Config): Transporter {
  if (transport) return transport;
  if (!config.smtp) throw new Error('Aucun relais SMTP configuré (MDF_SMTP_HOST).');
  transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    // 465 est du TLS implicite, tout le reste passe par STARTTLS. Le chiffrement
    // n'est jamais facultatif : le mot de passe du relais transite dedans.
    secure: config.smtp.port === 465,
    requireTLS: config.smtp.port !== 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transport;
}

/** Remise à zéro du transport, quand la configuration a changé. */
export function oublierTransport(): void { transport = null; }

export interface Envoyeur {
  (destinataire: string, sujet: string, texte: string, html: string): Promise<void>;
}

export function envoyeurSmtp(config: Config): Envoyeur {
  return async (destinataire, sujet, texte, html) => {
    await obtenir(config).sendMail({ from: config.smtp!.from, to: destinataire, subject: sujet, text: texte, html });
  };
}

/**
 * Dépile la file. Rend le nombre de messages partis.
 *
 * L'envoyeur est injecté : les tests dépilent une vraie file avec un envoyeur
 * qui compte, sans ouvrir la moindre connexion.
 */
export async function depiler(
  db: Db, envoyer: Envoyeur, maintenant = new Date(),
): Promise<{ envoyes: number; echecs: number }> {
  if (!parametre<boolean>(db, 'notificationsActives')) return { envoyes: 0, echecs: 0 };
  const max = parametre<number>(db, 'notificationsTentativesMax');
  let envoyes = 0, echecs = 0;

  for (const n of prochaines(db, 20, maintenant)) {
    try {
      await envoyer(n.email, n.sujet, n.corpsTexte, n.corpsHtml);
      marquerEnvoyee(db, n.id, maintenant);
      envoyes++;
    } catch (e) {
      // Le message du relais est conservé tel quel : « 550 5.7.1 Relay access
      // denied » est exactement ce qu'il faut lire pour corriger, et le
      // reformuler en « échec d'envoi » le rendrait inutile.
      marquerEchec(db, n.id, e instanceof Error ? e.message : String(e), max, maintenant);
      echecs++;
    }
  }
  if (envoyes) log.info(`${envoyes} notification${envoyes > 1 ? 's' : ''} envoyée${envoyes > 1 ? 's' : ''}.`);
  return { envoyes, echecs };
}

/** L'ordonnanceur : un passage par minute, sans se chevaucher avec lui-même. */
export function demarrerOrdonnanceur(db: Db, config: Config): () => void {
  if (!config.smtp) {
    log.attention('Aucun relais SMTP configuré : les notifications seront enregistrées mais pas envoyées.');
    return () => undefined;
  }
  const envoyer = envoyeurSmtp(config);
  let enCours = false;
  const minuterie = setInterval(() => {
    if (enCours) return;
    enCours = true;
    depiler(db, envoyer)
      .catch((e) => log.erreur("Passage de l'ordonnanceur de notifications en échec", e))
      .finally(() => { enCours = false; });
  }, 60_000);
  minuterie.unref();
  log.info(`Ordonnanceur de notifications démarré (relais ${config.smtp.host}:${config.smtp.port}).`);
  return () => clearInterval(minuterie);
}
