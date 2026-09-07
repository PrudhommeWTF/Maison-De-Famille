// La veille des versions : ce que GitHub publiait à la dernière vérification.
//
// **Pourquoi garder la réponse.** La vérification était un bouton, donc une
// information que personne n'avait tant que personne ne cliquait. Une famille
// qui n'ouvre l'administration qu'en cas de problème pouvait rester six mois
// sur une version corrigée depuis. Le service regarde donc de lui-même, et
// l'écran affiche ce qu'il a vu la dernière fois.
//
// **Regarder n'est pas installer.** Rien ne s'installe ici : l'installation
// reste un geste explicite, confirmé par le mot de passe, et exécuté par une
// unité root que ce service ne commande pas.
//
// **Le résultat vit dans un fichier**, à côté de l'état de mise à jour, pour la
// même raison : après un redémarrage, l'écran sait déjà quoi dire au lieu de
// rester muet le temps du premier passage. Un fichier absent ou illisible vaut
// « on n'a pas encore regardé », ce qui est le cas courant et non une panne.
import fs from 'fs';
import path from 'path';
import { horodatage } from '../noyau/dates';
import { log } from '../noyau/log';
import { Transport, VerificationImpossible, derniereRelease } from './depot';
import { estPlusRecente, versionConnue } from './versions';

export const FICHIER_VEILLE = 'veille-versions.json';

/** Une donnée qui bouge de loin en loin : quatre regards par jour suffisent. */
export const PERIODE_MS = 6 * 3_600_000;

export interface Veille {
  verifieLe: string;
  installee: string;
  tag: string;
  nom: string;
  notes: string;
  url: string;
  publieeLe: string;
  derniere: string;
  misAJourDisponible: boolean;
  versionConnue: boolean;
  /** Vide quand la dernière vérification a abouti. Le message est écrit pour la famille. */
  erreur: string;
}

export const cheminVeille = (dataDir: string): string => path.join(dataDir, FICHIER_VEILLE);

/** Ce qu'on a vu la dernière fois, ou rien. Un fichier abîmé vaut « rien ». */
export function lireVeille(dataDir: string): Veille | null {
  try {
    const v = JSON.parse(fs.readFileSync(cheminVeille(dataDir), 'utf8')) as Partial<Veille>;
    if (!v || typeof v.verifieLe !== 'string') return null;
    return {
      verifieLe: v.verifieLe,
      installee: String(v.installee ?? ''),
      tag: String(v.tag ?? ''),
      nom: String(v.nom ?? ''),
      notes: String(v.notes ?? ''),
      url: String(v.url ?? ''),
      publieeLe: String(v.publieeLe ?? ''),
      derniere: String(v.derniere ?? ''),
      misAJourDisponible: v.misAJourDisponible === true,
      versionConnue: v.versionConnue === true,
      erreur: String(v.erreur ?? ''),
    };
  } catch {
    return null;
  }
}

function ecrire(dataDir: string, v: Veille): Veille {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(cheminVeille(dataDir), JSON.stringify(v));
  } catch (e) {
    // Ne pas pouvoir garder la trace n'invalide pas ce qu'on vient d'apprendre :
    // l'appelant reçoit le résultat, l'écran l'affiche, et seul le souvenir manque.
    log.attention('Veille des versions : résultat non conservé', e);
  }
  return v;
}

/**
 * Demande à GitHub, note ce qu'il répond.
 *
 * En cas de panne, le dernier résultat connu est conservé et seule l'erreur est
 * mise à jour : perdre « la 1.2.0 existe » parce que le réseau a hoqueté ferait
 * régresser l'écran à chaque coupure.
 */
export async function verifier(
  dataDir: string, installee: string, transport?: Transport, env?: NodeJS.ProcessEnv,
): Promise<Veille> {
  const connue = versionConnue(installee);
  try {
    const release = await derniereRelease(transport, env);
    return ecrire(dataDir, {
      verifieLe: horodatage(),
      installee,
      tag: release.tag,
      derniere: release.tag.replace(/^v/i, ''),
      nom: release.nom,
      notes: release.notes,
      url: release.url,
      publieeLe: release.publieeLe,
      // Une version installée inconnue ne permet aucune comparaison. On propose
      // quand même : les instances posées avec cette version fantôme resteraient
      // enfermées sinon. L'écran, lui, dit qu'il ne sait pas.
      misAJourDisponible: !connue || estPlusRecente(release.tag, installee),
      versionConnue: connue,
      erreur: '',
    });
  } catch (e) {
    if (!(e instanceof VerificationImpossible)) throw e;
    const precedente = lireVeille(dataDir);
    ecrire(dataDir, {
      ...(precedente ?? {
        installee, tag: '', derniere: '', nom: '', notes: '', url: '', publieeLe: '',
        misAJourDisponible: false, versionConnue: connue,
      }),
      verifieLe: horodatage(),
      installee,
      versionConnue: connue,
      erreur: e.message,
    });
    throw e;
  }
}

/**
 * Le passage périodique. Rend de quoi l'arrêter, comme les autres ordonnanceurs.
 *
 * Une panne répétée ne se journalise qu'une fois : un serveur sans sortie
 * réseau écrirait la même ligne quatre fois par jour, et c'est ainsi qu'on
 * cesse de lire un journal.
 */
export function demarrerVeilleVersions(dataDir: string, installee: string, transport?: Transport): () => void {
  let dernierEchec = '';
  const passer = async (): Promise<void> => {
    try {
      const v = await verifier(dataDir, installee, transport);
      dernierEchec = '';
      if (v.misAJourDisponible) log.info(`Version ${v.tag} publiée (installée : ${v.installee || 'inconnue'}).`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message !== dernierEchec) {
        dernierEchec = message;
        log.attention(`Veille des versions impossible : ${message}`);
      }
    }
  };
  void passer();
  const minuterie = setInterval(() => { void passer(); }, PERIODE_MS);
  minuterie.unref();
  return () => clearInterval(minuterie);
}
