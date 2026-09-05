// Le stockage des mots de passe.
//
// **argon2id**, pas bcrypt. Les deux sont acceptables, argon2id est meilleur sur
// le point qui compte ici : il est coûteux en mémoire, donc il résiste au calcul
// massivement parallèle sur carte graphique, là où bcrypt ne coûte que du
// processeur. Cette application publie sur Internet des adresses de résidences
// et des codes de portail : si la base fuit, le temps qu'un attaquant met à
// casser les condensats est ce qui reste entre lui et la maison.
//
// Paramètres retenus : 64 Mio de mémoire, trois passes, un fil. Mesuré autour de
// 60 ms sur une machine ordinaire, ce qui est imperceptible à la connexion et
// très cher à répéter des milliards de fois.
//
// Le calcul est **asynchrone** et natif : il s'exécute sur le pool de threads de
// libuv, pas sur la boucle d'événements. La route de connexion est publique, et
// une version synchrone permettrait de figer l'application pour toute la famille
// avec une poignée d'appels simultanés.
import { hash, verify, Algorithm } from '@node-rs/argon2';
import { invalide } from '../noyau/erreurs';

export const OPTIONS = { memoryCost: 65536, timeCost: 3, parallelism: 1, algorithm: Algorithm.Argon2id } as const;

/** Longueur minimale acceptée. Douze caractères, pas huit. */
export const LONGUEUR_MINI = 12;

export const hacher = (motDePasse: string): Promise<string> => hash(motDePasse, OPTIONS);

/**
 * Vérifie un mot de passe. Rend faux plutôt que de lever quand le condensat est
 * illisible : une ligne corrompue en base ne doit pas ouvrir la porte, ni faire
 * tomber la route de connexion.
 */
export async function verifier(motDePasse: string, condensat: string | null): Promise<boolean> {
  if (!condensat) return false;
  try { return await verify(condensat, motDePasse); } catch { return false; }
}

/**
 * Ce condensat mérite-t-il d'être refait ? Vrai quand il a été calculé avec des
 * paramètres plus faibles qu'aujourd'hui, ou par un autre algorithme. On le
 * refait à la connexion, seul instant où le mot de passe en clair est
 * disponible : le parc se met à niveau tout seul, sans que personne n'agisse.
 */
export function aRehacher(condensat: string): boolean {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(condensat);
  if (!m) return true;
  return Number(m[1]) < OPTIONS.memoryCost || Number(m[2]) < OPTIONS.timeCost;
}

/**
 * La politique de mot de passe, volontairement simple : de la longueur, et rien
 * d'autre. Les règles de complexité (une majuscule, un chiffre, un symbole)
 * produisent des mots de passe plus faibles et plus oubliés, et une partie de
 * cette famille a plus de soixante-dix ans.
 */
export function controlerPolitique(motDePasse: string): void {
  if (motDePasse.length < LONGUEUR_MINI) {
    throw invalide(`Le mot de passe doit faire au moins ${LONGUEUR_MINI} caractères.`, {
      motDePasse: `Au moins ${LONGUEUR_MINI} caractères. Une phrase dont vous vous souvenez fait un très bon mot de passe.`,
    });
  }
  if (motDePasse.length > 200) {
    throw invalide('Le mot de passe est trop long.', { motDePasse: 'Au plus 200 caractères.' });
  }
}
