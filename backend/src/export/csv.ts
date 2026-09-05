// L'écriture de CSV. Module PUR.
//
// Deux détails qui font la différence entre « ça s'ouvre » et « ça s'ouvre
// correctement » :
//
//   - **le point-virgule** comme séparateur, parce qu'Excel en configuration
//     française attend celui-là et met tout dans une seule colonne sinon ;
//   - **la marque d'octets Unicode en tête** (BOM), sans laquelle « Kerloc'h »
//     et les accents deviennent illisibles à l'ouverture.
//
// Les deux sont écrits pour Excel, parce que c'est l'outil que la famille a et
// que le but de cette application est de remplacer un fichier Excel, pas de
// rendre son export inutilisable.

export const SEPARATEUR = ';';
export const BOM = '﻿';

/**
 * Échappe une valeur. Le préfixe apostrophe sur une valeur qui commence par
 * `=`, `+`, `-` ou `@` empêche Excel de l'interpréter comme une formule : c'est
 * une injection classique, et elle s'écrit ici une fois pour toutes.
 */
export function champ(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const ligne = (valeurs: readonly unknown[]): string => valeurs.map(champ).join(SEPARATEUR);

export function tableau(entetes: readonly string[], lignes: readonly (readonly unknown[])[]): string {
  return BOM + [ligne(entetes), ...lignes.map(ligne)].join('\r\n') + '\r\n';
}

/** Un montant en centimes, écrit avec la virgule décimale française. */
export const euros = (cents: number): string => (cents / 100).toFixed(2).replace('.', ',');
