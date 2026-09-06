// Le taux d'occupation d'une saison. Module PUR : ni base, ni HTTP.
//
// La maquette affiche « Occupation été 62 % » sur une maison de bord de mer et
// « Occupation hiver 88 % » sur un appartement de montagne. Deux décisions à
// prendre, et les deux méritent d'être écrites plutôt que devinées.
//
// **Quelle saison.** Elle suit le type du bien, pas le calendrier : une maison
// de plage vide en février ne dit rien de son usage, un studio aux Arcs vide en
// juillet non plus. Afficher un taux annuel ferait passer les deux pour des
// biens mal utilisés, et donnerait à la famille un chiffre qu'elle ne peut pas
// interpréter.
//
// **Quelles nuits.** Toutes les nuits occupées, quelle qu'en soit la nature :
// famille, location, et même une semaine bloquée pour des travaux. La question
// que pose ce chiffre est « la maison sert-elle ? », pas « qui en profite ? ».
// Une demande non arbitrée ne compte pas : elle n'occupe rien tant qu'elle
// n'est pas validée.
import { nuits } from '../noyau/dates';

export type TypeBien = 'mer' | 'montagne' | 'campagne' | 'ville';

/** Une fenêtre de saison, en jours de l'année, bornes incluses. */
export interface Saison { libelle: string; debut: string; fin: string }

/**
 * La saison d'un bien, pour une année donnée.
 *
 * L'hiver est à cheval sur deux années civiles. On le rattache à l'année de
 * son mois de janvier, qui est celle que la famille a en tête quand elle parle
 * de « la saison 2026 » aux sports d'hiver.
 */
export function saisonDe(type: TypeBien, annee: number): Saison {
  if (type === 'montagne') {
    return { libelle: 'Occupation hiver', debut: `${annee - 1}-12-01`, fin: `${annee}-03-31` };
  }
  if (type === 'mer' || type === 'campagne') {
    return { libelle: 'Occupation été', debut: `${annee}-06-01`, fin: `${annee}-09-30` };
  }
  // Un bien de ville n'a pas de saison : on regarde l'année entière, et le
  // libellé le dit pour qu'on ne compare pas deux chiffres différents.
  return { libelle: 'Occupation annuelle', debut: `${annee}-01-01`, fin: `${annee}-12-31` };
}

export interface Occupe { arrivee: string; depart: string }

/**
 * Le nombre de nuits d'un séjour qui tombent dans la fenêtre.
 *
 * La convention des nuits est `[arrivee, depart)` : la nuit d'arrivée compte,
 * celle de départ non. Un séjour qui déborde de la fenêtre n'y apporte que sa
 * partie commune, sinon deux semaines à cheval sur septembre et octobre
 * feraient dépasser cent pour cent.
 */
export function nuitsDansLaFenetre(s: Occupe, saison: Saison): number {
  const debut = s.arrivee > saison.debut ? s.arrivee : saison.debut;
  // La fenêtre est bornes incluses : la dernière nuit est celle du jour `fin`,
  // donc la borne de sortie est le lendemain.
  const finExclue = decale(saison.fin, 1);
  const fin = s.depart < finExclue ? s.depart : finExclue;
  return fin <= debut ? 0 : nuits(debut, fin);
}

const JOUR = 86_400_000;
const decale = (iso: string, jours: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + jours * JOUR).toISOString().slice(0, 10);

export interface Taux { libelle: string; pourcent: number; nuitsOccupees: number; nuitsSaison: number }

/**
 * Le taux d'occupation d'un bien sur sa saison.
 *
 * Les séjours qui se chevauchent ne comptent qu'une fois : deux familles la
 * même nuit, c'est une nuit occupée, pas deux. Sans cette précaution, un bien
 * très demandé afficherait plus de cent pour cent.
 */
export function taux(type: TypeBien, annee: number, sejours: readonly Occupe[]): Taux {
  const saison = saisonDe(type, annee);
  const nuitsSaison = nuits(saison.debut, decale(saison.fin, 1));

  const occupees = new Set<string>();
  for (const s of sejours) {
    if (!nuitsDansLaFenetre(s, saison)) continue;
    const debut = s.arrivee > saison.debut ? s.arrivee : saison.debut;
    const finExclue = decale(saison.fin, 1);
    const fin = s.depart < finExclue ? s.depart : finExclue;
    for (let d = debut; d < fin; d = decale(d, 1)) occupees.add(d);
  }
  return {
    libelle: saison.libelle,
    pourcent: nuitsSaison > 0 ? Math.round((occupees.size * 100) / nuitsSaison) : 0,
    nuitsOccupees: occupees.size,
    nuitsSaison,
  };
}
