// Le rafraîchissement automatique du calendrier scolaire.
//
// **Le problème que ça règle.** Les dates de vacances sont la seule donnée de
// référence que l'application ne sait pas calculer, et elle vieillit une fois
// par an, en silence. Le calendrier annonçait l'année manquante, mais il
// fallait qu'un gérant lise l'avertissement, trouve le fichier officiel et
// pense à le déposer. Entre les deux, la famille posait des séjours sur un
// février qui ne montrait aucune vacance.
//
// **Ce qui est écrit sans qu'un humain le demande, et rien de plus.** Une année
// scolaire **absente** de la base. Jamais une année déjà présente, même si le
// portail la publie autrement : ce qu'un gérant a relu et validé ne se fait pas
// réécrire par une tâche de fond. C'est ce qui rend cette écriture automatique
// acceptable, et c'est la seule de l'application.
//
// **Une panne n'est pas un incident.** Portail muet, sortie réseau fermée,
// fichier illisible : on journalise une fois et on réessaiera. Le dépôt manuel
// reste la voie de secours, et l'écran continue de dire ce qui manque.
import type { Db } from '../noyau/db';
import { log } from '../noyau/log';
import { aujourdhui } from '../noyau/dates';
import { lire } from '../noyau/tableau/tableau';
import { analyser } from './import';
import { anneesCouvertes, remplacer } from './repo';
import { Transport, telecharger } from './telechargement';
import { anneeScolaire } from './vacances';

/** Ce qui est écrit porte sa provenance : la table de l'écran le montre tel quel. */
export const SOURCE_AUTOMATIQUE = 'data.education.gouv.fr (rafraîchissement automatique)';

/** Un passage toutes les six heures suffit pour une donnée qui bouge une fois par an. */
export const PERIODE_MS = 6 * 3_600_000;

export interface Rafraichissement {
  /** `false` quand tout est déjà en base : aucun octet n'est parti. */
  tentee: boolean;
  annees: string[];
  ecrites: number;
  /** Renseignée quand rien n'a été écrit, pour le journal. */
  raison?: string;
}

/**
 * Les années qu'on veut voir en base : celle en cours, et la suivante.
 *
 * La suivante compte autant que l'autre : une famille arrête les dates de son
 * été en janvier, et le portail publie deux à trois ans à l'avance.
 */
export function anneesAttendues(jour: string = aujourdhui()): string[] {
  const courante = anneeScolaire(jour);
  const debut = Number(courante.slice(0, 4));
  return [courante, `${debut + 1}-${debut + 2}`];
}

/**
 * Complète la base si une année attendue manque.
 *
 * Le transport est injecté, comme partout où ce projet sort sur le réseau : les
 * tests couvrent le fichier officiel, le portail en panne et le fichier
 * incompréhensible sans ouvrir la moindre connexion.
 */
export async function rafraichir(
  db: Db, transport?: Transport, jour: string = aujourdhui(),
): Promise<Rafraichissement> {
  const deja = anneesCouvertes(db);
  const manquantes = anneesAttendues(jour).filter((a) => !deja.includes(a));
  if (!manquantes.length) return { tentee: false, annees: [], ecrites: 0 };

  const octets = await telecharger(transport);
  const rapport = analyser(lire(octets).lignes);
  // Le fichier couvre plusieurs années : on ne garde que celles qui manquent.
  // Écrire les autres reviendrait à écraser ce qu'un gérant a validé.
  const periodes = rapport.periodes.filter((p) => manquantes.includes(p.anneeScolaire));
  if (!periodes.length) {
    return {
      tentee: true, annees: [], ecrites: 0,
      raison: `le portail ne publie pas encore ${manquantes.join(' ni ')}`,
    };
  }
  const ecrit = remplacer(db, periodes, SOURCE_AUTOMATIQUE, 0);
  return { tentee: true, annees: ecrit.annees, ecrites: ecrit.ecrites };
}

/**
 * Le passage périodique. Rend de quoi l'arrêter, comme les autres ordonnanceurs.
 *
 * Le journal ne répète pas un échec identique : un serveur sans sortie réseau
 * remplirait le journal de la même ligne quatre fois par jour, et c'est ainsi
 * qu'on cesse de le lire.
 */
export function demarrerRafraichissementVacances(db: Db, transport?: Transport): () => void {
  let dernierEchec = '';
  const passer = async (): Promise<void> => {
    try {
      const r = await rafraichir(db, transport);
      dernierEchec = '';
      if (r.ecrites) {
        log.info(`Calendrier scolaire complété automatiquement : ${r.ecrites} périodes pour ${r.annees.join(', ')}.`);
      } else if (r.raison) {
        log.debug(`Calendrier scolaire : ${r.raison}.`);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message !== dernierEchec) {
        dernierEchec = message;
        log.attention(`Rafraîchissement du calendrier scolaire impossible : ${message}`);
      }
    }
  };
  void passer();
  const minuterie = setInterval(() => { void passer(); }, PERIODE_MS);
  minuterie.unref();
  return () => clearInterval(minuterie);
}
