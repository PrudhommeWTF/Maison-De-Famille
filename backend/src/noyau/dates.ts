// Les dates, et la convention des nuits.
//
// Une date est un texte `AAAA-MM-JJ`. C'est comparable par `<` en SQL, lisible
// dans un export, indexable, et cela ne porte aucun fuseau : le 8 août est le
// 8 août, que le serveur soit à l'heure d'été ou non.
//
// **La convention des nuits est la règle centrale de toute l'application** :
// une occupation est l'intervalle `[arrivee, depart)`. La nuit d'arrivée est
// incluse, la nuit de départ est exclue. Les Berger partent le 8, Julien arrive
// le 8 : il n'y a pas de conflit, c'est une rotation.

/** Vrai si la chaîne est une date `AAAA-MM-JJ` réellement existante. */
export function estDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const JOUR_MS = 86_400_000;

const enMs = (iso: string): number => Date.parse(iso + 'T00:00:00Z');

/**
 * Le nombre de nuits entre deux dates. Du `2026-08-08` au `2026-08-16` fait
 * huit nuits, ce qui est exactement ce qu'affiche la maquette.
 */
export const nuits = (du: string, au: string): number => Math.round((enMs(au) - enMs(du)) / JOUR_MS);

/** La date décalée de `n` jours. `n` peut être négatif. */
export function decale(iso: string, n: number): string {
  return new Date(enMs(iso) + n * JOUR_MS).toISOString().slice(0, 10);
}

/**
 * Deux occupations se chevauchent-elles ?
 *
 * La formule autorise la rotation le même jour, et c'est voulu : `a` qui finit
 * le jour où `b` commence n'est pas un chevauchement.
 */
export const chevauche = (aDu: string, aAu: string, bDu: string, bAu: string): boolean =>
  aDu < bAu && bDu < aAu;

/** La liste des dates `[du, au)`, une par nuit occupée. */
export function nuitsDe(du: string, au: string): string[] {
  const out: string[] = [];
  for (let d = du; d < au; d = decale(d, 1)) out.push(d);
  return out;
}

/** Aujourd'hui, en date. Isolable dans les tests en passant une horloge. */
export const aujourdhui = (maintenant = new Date()): string => maintenant.toISOString().slice(0, 10);

/** Un horodatage ISO 8601 UTC, la forme stockée partout. */
export const horodatage = (maintenant = new Date()): string => maintenant.toISOString();
