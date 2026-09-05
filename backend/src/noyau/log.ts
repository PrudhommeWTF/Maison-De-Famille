// La journalisation du service.
//
// Tout passe par ici plutôt que par `console`, pour une raison : pouvoir monter
// ou baisser le niveau sans redémarrer, et sans avoir à choisir entre un
// journal illisible et un journal muet le jour où quelque chose ne va pas.
//
// Trois niveaux :
//   - `erreur` : ce qui a échoué. Toujours écrit.
//   - `info`   : ce que le service a fait et qu'on veut retrouver après coup
//                (migrations, courriels envoyés, décisions). Le défaut.
//   - `debug`  : le détail qu'on allume pour comprendre un cas précis.
//
// La sortie reste stdout et stderr : c'est ce que systemd et Docker collectent,
// et il n'y a aucune raison d'inventer un fichier de plus à faire tourner.

export type Niveau = 'erreur' | 'info' | 'debug';

const RANG: Record<Niveau, number> = { erreur: 0, info: 1, debug: 2 };

/**
 * D'où vient le niveau courant. Posé par le serveur une fois la base ouverte :
 * ce module n'a aucune raison de connaître les paramètres, et le garder ignorant
 * le rend utilisable partout, y compris avant que la base existe.
 */
let source: () => Niveau = () => (process.env.MDF_LOG_LEVEL as Niveau) || 'info';
export function poserSourceDeNiveau(fn: () => Niveau): void { source = fn; }

export function niveau(): Niveau {
  try { const n = source(); return n in RANG ? n : 'info'; } catch { return 'info'; }
}

const ecrit = (voulu: Niveau, flux: 'out' | 'err', ligne: string): void => {
  if (RANG[voulu] > RANG[niveau()]) return;
  (flux === 'err' ? console.error : console.log)('[mdf] ' + ligne);
};

const avecCause = (ligne: string, e?: unknown): string =>
  ligne + (e instanceof Error ? ' : ' + e.message : e !== undefined ? ' : ' + String(e) : '');

export const log = {
  /** Une panne, ou ce qui empêche une opération d'aboutir. Jamais filtré. */
  erreur: (ligne: string, e?: unknown): void => ecrit('erreur', 'err', avecCause(ligne, e)),
  /** Ce qui a marché et qu'on veut pouvoir retrouver. Niveau par défaut. */
  info: (ligne: string): void => ecrit('info', 'out', ligne),
  /** Anormal mais sans conséquence immédiate. */
  attention: (ligne: string, e?: unknown): void => ecrit('info', 'err', avecCause(ligne, e)),
  /** Le détail qu'on allume pour comprendre, et qu'on éteint après. */
  debug: (ligne: string): void => ecrit('debug', 'out', ligne),
};
