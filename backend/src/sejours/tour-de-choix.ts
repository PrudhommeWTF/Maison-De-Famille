// Le tour de choix saisonnier. Module PUR : aucune base, aucun HTTP.
//
// **Ce module ne décide rien.** Tout le monde veut la première quinzaine
// d'août, c'est le sujet politique de la famille, et aucun algorithme ne le
// réglera. Ce qu'il fait, c'est appliquer mécaniquement un ordre de priorité
// convenu et **rendre le résultat visible**, pour que l'équité se constate au
// lieu de se discuter. La gérante valide ou modifie ligne par ligne ensuite.
//
// La règle est celle de la maquette : les premiers choix sont attribués par
// ordre de priorité, puis les seconds choix sur ce qui reste libre. L'ordre de
// priorité tourne d'une année sur l'autre, ce qui est la seule façon connue de
// rendre le partage d'un mois d'août supportable dans la durée.
import { chevauche, nuits } from '../noyau/dates';

export interface Voeu {
  id: number;
  foyerId: number;
  /** 1 pour le premier choix, 2 pour le second. */
  rang: number;
  du: string;
  au: string;
  occupants: number;
}

export interface Attribution {
  voeuId: number; foyerId: number; du: string; au: string; occupants: number; rang: number;
}

export interface Refus {
  voeuId: number; foyerId: number; du: string; au: string; rang: number; raison: string;
}

export interface Resultat {
  attributions: Attribution[];
  refus: Refus[];
  /** Nuits attribuées par foyer, et écart au quota s'il en existe un. */
  bilan: { foyerId: number; nuits: number; quota: number | null; depassement: number }[];
}

export interface Entrees {
  voeux: readonly Voeu[];
  /** L'ordre de priorité de la saison, du premier servi au dernier. */
  ordre: readonly number[];
  /** Quota indicatif de nuits par foyer. Un foyer absent n'a pas de quota. */
  quotas: ReadonlyMap<number, number>;
  /** Ce qui occupe déjà le bien sur la saison (location déjà posée, entretien). */
  deja: readonly { du: string; au: string }[];
}

/**
 * L'arbitrage.
 *
 * Deux passes : les premiers choix dans l'ordre de priorité, puis les seconds
 * sur les dates encore libres. Un voeu refusé dit **pourquoi**, parce que
 * « votre semaine n'a pas été retenue » sans raison est exactement ce qui
 * ramène la famille au téléphone.
 *
 * Le quota ne bloque rien : il est indicatif, et le dépassement apparaît dans le
 * bilan. La gérante peut le dépasser, l'écart est visible de tous.
 */
export function arbitrer(e: Entrees): Resultat {
  const attributions: Attribution[] = [];
  const refus: Refus[] = [];
  const pris: { du: string; au: string }[] = e.deja.map((d) => ({ du: d.du, au: d.au }));

  const rang = (foyerId: number): number => {
    const i = e.ordre.indexOf(foyerId);
    // Un foyer absent de l'ordre passe en dernier, sans faire échouer
    // l'arbitrage : mieux vaut un résultat discutable qu'un écran d'erreur.
    return i === -1 ? e.ordre.length : i;
  };

  for (const passe of [1, 2]) {
    const candidats = e.voeux
      .filter((v) => v.rang === passe)
      .sort((a, b) => rang(a.foyerId) - rang(b.foyerId) || a.du.localeCompare(b.du));

    for (const v of candidats) {
      // Un foyer déjà servi sur ce rang de passe n'est pas resservi avant que
      // tout le monde ait eu son tour : c'est le principe même du tour de choix.
      if (passe === 2 && attributions.some((a) => a.foyerId === v.foyerId && a.rang === 1)) {
        const conflit = pris.find((p) => chevauche(v.du, v.au, p.du, p.au));
        if (conflit) {
          refus.push({ voeuId: v.id, foyerId: v.foyerId, du: v.du, au: v.au, rang: v.rang, raison: 'Premier choix déjà attribué, et ces dates sont prises.' });
          continue;
        }
      }
      const conflit = pris.find((p) => chevauche(v.du, v.au, p.du, p.au));
      if (conflit) {
        refus.push({
          voeuId: v.id, foyerId: v.foyerId, du: v.du, au: v.au, rang: v.rang,
          raison: `Ces dates chevauchent une période déjà attribuée, du ${conflit.du} au ${conflit.au}.`,
        });
        continue;
      }
      attributions.push({ voeuId: v.id, foyerId: v.foyerId, du: v.du, au: v.au, occupants: v.occupants, rang: v.rang });
      pris.push({ du: v.du, au: v.au });
    }
  }

  const foyers = new Set<number>([...e.voeux.map((v) => v.foyerId), ...e.quotas.keys()]);
  const bilan = [...foyers].map((foyerId) => {
    const n = attributions.filter((a) => a.foyerId === foyerId).reduce((t, a) => t + nuits(a.du, a.au), 0);
    const quota = e.quotas.get(foyerId) ?? null;
    return { foyerId, nuits: n, quota, depassement: quota === null ? 0 : Math.max(0, n - quota) };
  }).sort((a, b) => rang(a.foyerId) - rang(b.foyerId));

  return { attributions, refus, bilan };
}

/**
 * L'ordre de priorité de la saison suivante : le premier passe dernier, tout le
 * monde remonte d'un cran. Une rotation simple, que chacun peut vérifier de
 * tête, ce qui vaut mieux qu'une pondération savante que personne ne recalcule.
 */
export const ordreSuivant = (ordre: readonly number[]): number[] =>
  ordre.length ? [...ordre.slice(1), ordre[0]] : [];
