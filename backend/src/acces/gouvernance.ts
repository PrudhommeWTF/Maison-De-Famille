// Les règles de gouvernance d'une structure. Module PUR : ni base, ni HTTP.
//
// Une seule règle pour l'instant, mais elle est structurante : **une structure
// doit compter au moins deux gérants**.
//
// La raison n'est pas théorique. La gérante d'aujourd'hui est la seule à tenir
// le calendrier ; si elle perd son téléphone, oublie son mot de passe et que son
// adresse de courriel n'est plus relevée, personne ne peut plus rien arbitrer,
// et l'application reproduit exactement le goulot d'étranglement qu'elle est
// censée supprimer. Un second gérant est la seule porte de secours qui ne passe
// pas par une restauration de sauvegarde.
//
// Le seuil n'est pas un invariant de la base : une instance qui vient d'être
// amorcée n'a **qu'une** personne, et lui interdire de fonctionner tant qu'elle
// est seule rendrait l'installation impossible. La règle s'exprime donc en deux
// temps : on ne peut jamais *descendre* sous deux gérants, et tant qu'il n'y en
// a pas deux, l'application le dit sans relâche.

/** Le nombre de gérants en dessous duquel une structure ne doit jamais tomber. */
export const GERANTS_MINIMUM = 2;

export class GouvernanceImpossible extends Error {}

/**
 * Peut-on retirer son rôle de gérant à quelqu'un ?
 *
 * `gerantsActuels` compte les gérants **avant** le retrait, la personne visée
 * comprise. Refuser le retrait du dernier gérant est évident ; refuser celui de
 * l'avant-dernier est le coeur de la règle, et c'est le cas qui se présentera
 * en vrai, le jour où une fratrie voudra « simplifier ».
 */
export function controlerRetraitGerant(gerantsActuels: number, nomStructure: string): void {
  if (gerantsActuels <= 1) {
    throw new GouvernanceImpossible(
      `${nomStructure} n'a qu'un seul gérant : le retirer fermerait la porte à tout le monde. `
      + 'Désignez d\'abord un autre gérant.');
  }
  if (gerantsActuels - 1 < GERANTS_MINIMUM) {
    throw new GouvernanceImpossible(
      `${nomStructure} doit compter au moins ${GERANTS_MINIMUM} gérants. `
      + 'Si une seule personne gère, plus personne ne peut arbitrer le jour où elle perd son accès. '
      + 'Désignez un troisième gérant avant de retirer celui-ci.');
  }
}

export interface AlerteGouvernance {
  structureId: number;
  structureNom: string;
  gerants: number;
  message: string;
}

/**
 * Les structures auxquelles il manque un gérant. Rend de quoi afficher une carte
 * qui ne se masque pas : le message dit le nombre, pas seulement « il manque
 * quelqu'un ».
 */
export function alertes(
  structures: readonly { id: number; nom: string; gerants: number }[],
): AlerteGouvernance[] {
  return structures
    .filter((s) => s.gerants < GERANTS_MINIMUM)
    .map((s) => ({
      structureId: s.id,
      structureNom: s.nom,
      gerants: s.gerants,
      message: s.gerants === 0
        ? `${s.nom} n'a aucun gérant. Personne ne peut arbitrer les demandes de séjour.`
        : `${s.nom} n'a qu'un seul gérant. Si cette personne perd son accès, plus personne `
          + 'ne peut arbitrer les demandes ni saisir un séjour. Désignez un second gérant.',
    }));
}
