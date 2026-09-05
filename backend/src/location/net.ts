// Le net locatif et sa répartition. Module PUR : ni base, ni HTTP.
//
// Note de comportement de la maquette : « Le loyer net se calcule après
// déduction des charges directement liées à la location. »
//
// **Ce module ne réinvente pas la répartition.** Le net à répartir est un
// montant en centimes, et il se ventile avec `argent/repartition.ts`, celui de
// la tranche 2, avec les quotes-parts en vigueur à la date de clôture. Un
// second algorithme de répartition, c'est un second arrondi, donc deux tables
// qui ne tomberaient pas sur le même centime et deux personnes qui ne seraient
// pas d'accord.
//
// **Ce qui compte dans un loyer, c'est ce qui est encaissé.** Une réservation
// « à confirmer » ne rapporte rien ; une réservation avec acompte rapporte
// l'acompte, pas le loyer. Compter les loyers signés plutôt que les loyers reçus
// donnerait un net à répartir qu'on ne pourrait pas verser, et une famille qui
// se partage de l'argent qui n'est pas là se fâche vite.

import { estDate } from '../noyau/dates';

export type StatutLocation = 'a_confirmer' | 'acompte' | 'solde' | 'annule';

export interface Reservation {
  id: number;
  locataire: string;
  arrivee: string;
  depart: string;
  nuits: number;
  loyerCents: number;
  acompteCents: number;
  statut: StatutLocation;
}

export interface ChargeLocative {
  id: number;
  libelle: string;
  dateDepense: string;
  montantCents: number;
}

export interface Exercice {
  annee: number;
  /** Ce qui est réellement rentré : le loyer si soldé, l'acompte sinon. */
  encaisseCents: number;
  /** Ce qui reste à percevoir sur les réservations non annulées. */
  attenduCents: number;
  chargesCents: number;
  /** Encaissé moins charges. Peut être négatif : une saison peut coûter. */
  netCents: number;
  nuitsLouees: number;
  reservations: number;
  /** Les réservations qui ne rapportent encore rien, et qu'il faut relancer. */
  aConfirmer: number;
  explication: string;
}

/** Ce qu'une réservation a effectivement rapporté à ce jour. */
export function encaisse(r: Reservation): number {
  if (r.statut === 'annule') return 0;
  if (r.statut === 'solde') return r.loyerCents;
  // « à confirmer » comme « acompte » : ce qui est rentré, c'est l'acompte,
  // qui vaut zéro tant que rien n'a été versé.
  return r.acompteCents;
}

/** Ce qu'il reste à percevoir, hors réservations annulées. */
export const reste = (r: Reservation): number =>
  r.statut === 'annule' ? 0 : r.loyerCents - encaisse(r);

const euros = (cents: number): string => {
  const signe = cents < 0 ? '-' : '';
  const [entier, dec] = Math.abs(cents / 100).toFixed(2).split('.');
  return `${signe}${entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${dec} €`;
};

/**
 * L'exercice d'une saison.
 *
 * `annee` filtre sur la **date d'arrivée** : une semaine du 28 décembre au
 * 4 janvier compte pour l'année où les gens arrivent, ce qui est la convention
 * que retiendra une famille qui parle de « la saison 2026 ». Ce n'est pas la
 * règle fiscale des revenus fonciers, qui suit l'encaissement, et c'est
 * volontaire : l'écran sert à répartir entre frères et soeurs, pas à remplir
 * une déclaration (que le brief exclut explicitement).
 */
export function exercice(
  annee: number, reservations: readonly Reservation[], charges: readonly ChargeLocative[],
): Exercice {
  const dansLAnnee = reservations.filter((r) => estDate(r.arrivee) && Number(r.arrivee.slice(0, 4)) === annee);
  const chargesAnnee = charges.filter((c) => estDate(c.dateDepense) && Number(c.dateDepense.slice(0, 4)) === annee);

  const retenues = dansLAnnee.filter((r) => r.statut !== 'annule');
  const encaisseCents = retenues.reduce((t, r) => t + encaisse(r), 0);
  const attenduCents = retenues.reduce((t, r) => t + reste(r), 0);
  const chargesCents = chargesAnnee.reduce((t, c) => t + c.montantCents, 0);
  const netCents = encaisseCents - chargesCents;
  const nuitsLouees = retenues.reduce((t, r) => t + r.nuits, 0);
  const aConfirmer = dansLAnnee.filter((r) => r.statut === 'a_confirmer').length;

  const lignes = [
    `Saison ${annee} : ${retenues.length} réservation${retenues.length > 1 ? 's' : ''} `
    + `retenue${retenues.length > 1 ? 's' : ''}, ${nuitsLouees} nuit${nuitsLouees > 1 ? 's' : ''} louée${nuitsLouees > 1 ? 's' : ''}.`,
    `Loyers encaissés : ${euros(encaisseCents)}`
    + (attenduCents > 0 ? ` (${euros(attenduCents)} restent à percevoir, non comptés).` : '.'),
    `Charges directement liées à la location : ${euros(chargesCents)}`
    + (chargesAnnee.length ? ` sur ${chargesAnnee.length} dépense${chargesAnnee.length > 1 ? 's' : ''}.` : '.'),
    `Net à répartir : ${euros(encaisseCents)} moins ${euros(chargesCents)}, soit ${euros(netCents)}.`,
  ];
  if (netCents < 0) {
    lignes.push('La saison est déficitaire : les charges dépassent ce qui a été encaissé. '
      + 'Rien n\'est à répartir, le déficit reste porté par la structure.');
  }
  if (aConfirmer) {
    lignes.push(`${aConfirmer} réservation${aConfirmer > 1 ? 's' : ''} `
      + `${aConfirmer > 1 ? 'restent' : 'reste'} à confirmer : `
      + 'tant qu\'aucun acompte n\'est reçu, elles ne comptent pas dans les loyers encaissés.');
  }

  return {
    annee, encaisseCents, attenduCents, chargesCents, netCents, nuitsLouees,
    reservations: retenues.length, aConfirmer,
    explication: lignes.join('\n'),
  };
}

/**
 * L'avertissement de la maquette : « les semaines famille sont posées avant
 * l'ouverture à la location ; l'inverse déclenche une alerte ».
 *
 * Il ne bloque rien. Une gérante qui sait ce qu'elle fait doit pouvoir louer la
 * première quinzaine d'août : c'est son arbitrage, pas celui de l'application.
 * Mais elle doit le voir avant, pas le découvrir quand son frère appelle.
 */
export function alerteSaison(
  annee: number, reservations: readonly Reservation[], sejoursFamille: readonly { arrivee: string }[],
): string | null {
  const locations = reservations.filter(
    (r) => r.statut !== 'annule' && estDate(r.arrivee) && Number(r.arrivee.slice(0, 4)) === annee);
  if (!locations.length) return null;
  const famille = sejoursFamille.filter(
    (s) => estDate(s.arrivee) && Number(s.arrivee.slice(0, 4)) === annee);
  if (famille.length) return null;
  return `Aucun séjour de famille n'est encore posé sur ${annee}, alors que `
    + `${locations.length} semaine${locations.length > 1 ? 's sont ouvertes' : ' est ouverte'} `
    + 'à la location. La famille choisit ses dates avant : sinon, ceux qui demandent en dernier '
    + 'trouvent la maison prise par des inconnus.';
}
