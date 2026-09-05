// Les identifiants publics.
//
// Un identifiant qui sort de l'application et sert d'adresse (un fichier, un
// lien d'invitation) ne doit pas être devinable : `/api/fichiers/42` invite à
// essayer 41. Trente-deux hexadécimaux tirés du générateur cryptographique du
// système ne s'énumèrent pas.
//
// Les identifiants **internes** restent des entiers auto-incrémentés : ils sont
// rapides, compacts, et ne sortent jamais d'un dossier auquel on a déjà accès.
import { randomBytes, createHash, timingSafeEqual } from 'crypto';

/** Un identifiant public de 32 hexadécimaux (128 bits). */
export const idPublic = (): string => randomBytes(16).toString('hex');

/** Un jeton de lien d'invitation : plus long, il voyage dans une URL. */
export const jetonLien = (): string => randomBytes(32).toString('base64url');

/** L'empreinte stockée d'un jeton. Le jeton en clair n'existe qu'une fois. */
export const empreinte = (valeur: string): string =>
  createHash('sha256').update(valeur, 'utf8').digest('hex');

/**
 * Comparaison à durée constante de deux empreintes. Une comparaison naïve
 * révèle, par le temps qu'elle met, combien de caractères sont bons.
 */
export function memeEmpreinte(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8'), bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
