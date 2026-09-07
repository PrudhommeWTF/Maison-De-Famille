// Ce qu'un invité a le droit de lire d'un séjour. Module PUR : ni base, ni HTTP.
//
// **Pourquoi ce module existe.** Un locataire, un ami de passage ou un artisan
// entre par un lien et voit le calendrier du bien : c'est nécessaire, il doit
// pouvoir situer son séjour et savoir si quelqu'un part le matin de son
// arrivée. Mais il n'a aucune raison de lire « Claire, Paul et les cousins »,
// le mot laissé à la gérante, ni la bannière d'arbitrage de la famille.
//
// **Pourquoi côté serveur et non à l'affichage.** Masquer dans l'interface
// laisserait les noms dans la réponse réseau, à un clic de n'importe quel
// navigateur. La règle du projet est que le serveur ne rend pas ce qu'il n'a pas
// le droit de rendre.
//
// **Ce qui reste visible, et pourquoi.** Les dates, la nature du séjour et le
// nombre d'occupants. Ce sont des informations d'occupation, pas des
// informations sur des personnes : elles disent que la maison est prise, pour
// quel usage, et à quel point elle est pleine. C'est exactement ce dont un
// locataire a besoin pour comprendre une rotation le jour de son arrivée.
//
// **Son propre séjour n'est pas masqué.** Un locataire doit reconnaître le
// sien dans le calendrier, sinon il ne sait plus lequel est à lui.

/** Le libellé qui remplace le titre. Un mot, pas un tiret : il se lit à voix haute. */
export const LIBELLE_MASQUE = 'Occupé';

/** La forme minimale attendue. Tout séjour rendu par le dépôt la satisfait. */
export interface Masquable {
  id: number;
  titre: string;
  demandeurId: number | null;
  demandeurNom: string | null;
  foyerId: number | null;
  foyerNom: string | null;
  note: string;
  decideParNom: string | null;
  decisionNote: string;
}

/** Le séjour tel qu'un invité peut le lire. Le sien revient inchangé. */
export function masquer<T extends Masquable>(s: T, sien: boolean): T {
  if (sien) return s;
  return {
    ...s,
    titre: LIBELLE_MASQUE,
    demandeurId: null,
    demandeurNom: null,
    foyerId: null,
    foyerNom: null,
    note: '',
    decideParNom: null,
    decisionNote: '',
  };
}

/**
 * Masque la liste, bien par bien.
 *
 * `estInvite` répond pour un bien donné : une même personne peut être invitée
 * sur une maison et indivisaire sur une autre, et la vue consolidée mélange les
 * deux. Masquer sur toute la liste dès qu'un bien est en portée invité
 * cacherait à quelqu'un ce qu'il a le droit de voir chez lui.
 */
export function masquerListe<T extends Masquable & { bienId: number }>(
  sejours: readonly T[],
  estInvite: (bienId: number) => boolean,
  siens: ReadonlySet<number>,
): T[] {
  return sejours.map((s) => (estInvite(s.bienId) ? masquer(s, siens.has(s.id)) : s));
}
