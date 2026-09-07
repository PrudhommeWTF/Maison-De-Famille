// Le déclenchement d'une mise à jour, côté service.
//
// **Le service ne met jamais à jour lui-même.** Il écrit deux fichiers dans son
// répertoire de données : un état lisible par l'interface, et un déclencheur.
// Une unité systemd **appartenant à root** surveille ce déclencheur, télécharge
// la version, recompile et redémarre le service.
//
// C'est le point le plus important de tout ce module. Le service tourne sous un
// compte sans privilège et le reste : il n'a ni `sudo`, ni le droit d'écrire
// dans son propre code, ni celui de redémarrer une unité. Le jour où quelqu'un
// obtiendrait l'exécution de code dans le service, il ne récupérerait pas la
// machine avec.
//
// Le prix de ce choix : la mise à jour ne peut pas rendre compte de son
// résultat par un retour de fonction. Elle se suit par le fichier d'état, que
// le script réécrit à chaque étape, et dont l'expiration est traitée dans
// `versions.ts` pour la raison qui y est écrite.
import fs from 'fs';
import path from 'path';
import { StatutMaj, fraichir, lireStatut } from './versions';

export const FICHIER_ETAT = 'maj-etat.json';
export const FICHIER_DECLENCHEUR = '.maj-declencheur';
export const FICHIER_JOURNAL = 'maj.log';

export const cheminEtat = (dataDir: string): string => path.join(dataDir, FICHIER_ETAT);
export const cheminJournal = (dataDir: string): string => path.join(dataDir, FICHIER_JOURNAL);

/** L'état courant, expiration comprise. Un répertoire vide vaut « inactif ». */
export function statut(dataDir: string, maintenant = Date.now()): StatutMaj {
  try {
    const brut = JSON.parse(fs.readFileSync(cheminEtat(dataDir), 'utf8')) as unknown;
    return fraichir(lireStatut(brut), maintenant, cheminJournal(dataDir));
  } catch {
    // Fichier absent, illisible ou corrompu : aucune mise à jour en cours. Ce
    // n'est pas une panne, c'est le cas courant.
    return { etat: 'inactif' };
  }
}

/**
 * Pose l'état « en cours » puis le déclencheur.
 *
 * L'ordre compte : l'unité systemd part dès que le déclencheur existe, et elle
 * réécrit l'état. Écrire le déclencheur en premier ouvrirait une fenêtre où
 * l'interface verrait « inactif » alors que la mise à jour tourne déjà, donc un
 * bouton encore cliquable.
 */
export function declencher(dataDir: string, maintenant = Date.now()): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const etat: StatutMaj = { etat: 'en_cours', message: 'Mise à jour demandée.', ts: maintenant };
  fs.writeFileSync(cheminEtat(dataDir), JSON.stringify(etat));
  fs.writeFileSync(path.join(dataDir, FICHIER_DECLENCHEUR), String(maintenant));
}

/** Une mise à jour est-elle déjà en route ? Sert à refuser un second clic. */
export const enCours = (dataDir: string, maintenant = Date.now()): boolean =>
  statut(dataDir, maintenant).etat === 'en_cours';
