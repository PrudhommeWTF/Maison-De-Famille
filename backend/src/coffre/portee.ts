// Qui voit quel document, quel code, et pendant quelle période.
//
// Module PUR : ni base, ni HTTP. C'est la règle la plus sensible de la
// tranche 3, et la phrase du brief qui la commande est sans ambiguïté :
//
//   « Un code d'accès affiché à quelqu'un dont le séjour est terminé est une
//     faille. »
//
// Quatre portées, de la plus étroite à la plus large :
//
//   `gerant`     la convention d'indivision, l'acte de notoriété : les gérants.
//   `detenteur`  ce qui touche au patrimoine : gérants et détenteurs.
//   `membres`    l'attestation d'assurance, le DPE : tous ceux qui sont
//                rattachés au bien, membres de foyer compris.
//   `sejour`     le code du portail, le mot de passe du wifi : les gérants et
//                les détenteurs en permanence, parce que la maison est à eux ;
//                les membres de foyer et les invités **seulement autour de leur
//                séjour**.
//
// La fenêtre autour du séjour n'est pas symétrique, et c'est voulu. Elle ouvre
// quelques jours avant l'arrivée, parce qu'on prépare un départ à l'avance et
// qu'un code reçu la veille au soir ne sert à rien quand on roule de nuit. Elle
// se ferme **le soir du jour de départ**, pas la veille : la convention des
// nuits veut que la nuit de départ soit exclue, donc l'occupant est encore sur
// place le matin du départ et a besoin du code pour refermer derrière lui.
// Le lendemain, il n'a plus rien à y faire.

import { estDate } from '../noyau/dates';

export type PorteeElement = 'gerant' | 'detenteur' | 'membres' | 'sejour';
export type RoleSurBien = 'gerant' | 'detenteur' | 'membre_foyer' | 'invite';

export const PORTEES: readonly PorteeElement[] = ['gerant', 'detenteur', 'membres', 'sejour'];

/** Ce que chaque portée dit, en français, pour l'écran et pour les messages. */
export const LIBELLE_PORTEE: Record<PorteeElement, string> = {
  gerant: 'Gérants seuls',
  detenteur: 'Détenteurs',
  membres: 'Tous les membres',
  sejour: 'Pendant le séjour',
};

/** Un séjour réduit à ce dont la règle a besoin. */
export interface SejourPourPortee {
  arrivee: string;
  depart: string;
}

export interface Fenetre {
  /** Jours d'avance avant l'arrivée. */
  avant: number;
  /** Jours de grâce après le jour de départ. Zéro par défaut, et c'est le point. */
  apres: number;
}

export const FENETRE_PAR_DEFAUT: Fenetre = { avant: 2, apres: 0 };

const JOUR = 86_400_000;

/** Décale une date ISO d'un nombre de jours, sans passer par le fuseau local. */
export function decaler(iso: string, jours: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + jours * JOUR).toISOString().slice(0, 10);
}

/**
 * Le séjour couvre-t-il ce jour, fenêtre comprise ?
 *
 * Bornes **incluses** des deux côtés : `arrivee - avant` et `depart + apres`.
 * Le jour de départ compte donc, celui d'après non, ce qui est exactement la
 * recette demandée.
 */
export function couvre(s: SejourPourPortee, jour: string, f: Fenetre = FENETRE_PAR_DEFAUT): boolean {
  if (!estDate(s.arrivee) || !estDate(s.depart) || !estDate(jour)) return false;
  return jour >= decaler(s.arrivee, -f.avant) && jour <= decaler(s.depart, f.apres);
}

export interface Demandeur {
  role: RoleSurBien;
  /** Les séjours de la personne sur ce bien, validés uniquement. */
  sejours: readonly SejourPourPortee[];
}

/**
 * La question centrale : cette personne peut-elle voir cet élément aujourd'hui ?
 *
 * `jour` est passé explicitement plutôt que lu de l'horloge : une règle qui
 * dépend de la date du jour doit être testable au jour près, et « la veille,
 * pendant, le lendemain » est précisément ce que la recette demande de vérifier.
 */
export function peutVoir(
  portee: PorteeElement, d: Demandeur, jour: string, f: Fenetre = FENETRE_PAR_DEFAUT,
): boolean {
  switch (portee) {
    case 'gerant':
      return d.role === 'gerant';
    case 'detenteur':
      return d.role === 'gerant' || d.role === 'detenteur';
    case 'membres':
      return d.role !== 'invite';
    case 'sejour':
      // Les gérants et les détenteurs ne dépendent pas d'un séjour : la maison
      // est la leur, et leur retirer le code du portail hors saison serait
      // absurde. Pour les autres, la présence est la condition.
      if (d.role === 'gerant' || d.role === 'detenteur') return true;
      return d.sejours.some((s) => couvre(s, jour, f));
    default:
      // Une portée inconnue ne s'ouvre pas. Le jour où le schéma en gagnera
      // une, ce défaut la fermera au lieu de l'ouvrir à tout le monde.
      return false;
  }
}

/**
 * Les portées qu'une personne peut voir. Sert à filtrer en SQL plutôt qu'à
 * charger puis écarter : ce qui n'est pas visible ne doit pas quitter la base.
 */
export function porteesVisibles(
  d: Demandeur, jour: string, f: Fenetre = FENETRE_PAR_DEFAUT,
): PorteeElement[] {
  return PORTEES.filter((p) => peutVoir(p, d, jour, f));
}

/**
 * Ce qu'un gérant a le droit d'attribuer comme portée. Il les a toutes : la
 * fonction existe pour que le jour où ce ne sera plus vrai, le changement ait
 * un seul endroit où se faire.
 */
export function porteesAttribuables(role: RoleSurBien): PorteeElement[] {
  return role === 'gerant' ? [...PORTEES] : [];
}

/**
 * Le message rendu quand l'accès est refusé.
 *
 * Il dit **pourquoi**, sans révéler ce qu'il refuse. « Ce code n'est visible
 * que pendant votre séjour » est utile à un membre de foyer légitime qui s'y
 * prend trop tôt ; « il n'existe pas » l'aurait envoyé écrire à la gérante pour
 * rien.
 */
export function refus(portee: PorteeElement, d: Demandeur): string {
  if (portee === 'sejour') {
    return d.sejours.length
      ? "Ce code n'est visible qu'autour de votre séjour, de deux jours avant l'arrivée au jour du départ inclus."
      : "Ce code n'est visible que par les personnes qui séjournent dans le bien.";
  }
  if (portee === 'membres') return 'Cet élément est réservé aux membres rattachés à ce bien.';
  if (portee === 'detenteur') return 'Cet élément est réservé aux détenteurs du bien.';
  return 'Cet élément est réservé aux gérants.';
}
