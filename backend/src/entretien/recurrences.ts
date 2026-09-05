// Les récurrences et les échéances qu'elles engendrent. Module PUR.
//
// Note de comportement de la maquette : « Les récurrences génèrent
// automatiquement une tâche avec sa date limite légale ou d'usage. »
//
// Trois périodicités, tirées des exemples de la maquette et suffisantes pour
// une maison de famille :
//
//   `annuelle`   « Ramonage, tous les ans, avant le 15 octobre »
//   `mensuelle`  « Entretien du jardin, tous les mois, d'avril à octobre »
//   `sejour`     « Relevé des compteurs, à chaque séjour »
//
// **Ce module n'écrit rien.** Il rend la liste des échéances qui devraient
// exister sur une période, et le dépôt se charge de créer celles qui manquent.
// Cette séparation n'est pas de la coquetterie : elle rend la règle testable
// sur dix ans en une milliseconde, là où un engendrement couplé à la base
// demanderait de fabriquer dix ans de données pour vérifier un cas limite.
//
// L'idempotence est portée par la clé (récurrence, échéance), unique en base :
// repasser la génération deux fois dans la même journée ne crée pas de doublon,
// et c'est ce qui permet de l'appeler au démarrage sans y réfléchir.

import { estDate } from '../noyau/dates';

export type Periodicite = 'annuelle' | 'mensuelle' | 'sejour';
export type Categorie = 'obligatoire' | 'saison' | 'courant' | 'inventaire';

export interface Recurrence {
  id: number;
  libelle: string;
  categorie: Categorie;
  periodicite: Periodicite;
  /** Pour une annuelle : la date limite dans l'année, en 'MM-JJ'. */
  limiteMmjj: string | null;
  /** Pour une mensuelle : la saison, bornes comprises. */
  moisDebut: number | null;
  moisFin: number | null;
}

export interface Echeance {
  recurrenceId: number;
  libelle: string;
  categorie: Categorie;
  /** La date limite, en ISO. C'est elle qui identifie l'occurrence. */
  echeance: string;
}

export class RecurrenceInvalide extends Error {}

const jours = (annee: number, mois: number): number => new Date(Date.UTC(annee, mois, 0)).getUTCDate();
const deuxChiffres = (n: number): string => String(n).padStart(2, '0');

/**
 * Contrôle une récurrence à la saisie, plutôt qu'au moment d'engendrer.
 *
 * Une récurrence fautive découverte six mois plus tard, au premier
 * engendrement, serait invisible : personne ne regarde une tâche qui n'existe
 * pas. Elle est donc refusée tout de suite, avec un message qui dit quoi
 * corriger.
 */
export function controler(r: Pick<Recurrence, 'periodicite' | 'limiteMmjj' | 'moisDebut' | 'moisFin'>): void {
  if (r.periodicite === 'annuelle') {
    if (!r.limiteMmjj || !/^\d{2}-\d{2}$/.test(r.limiteMmjj)) {
      throw new RecurrenceInvalide(
        'Une récurrence annuelle demande une date limite dans l\'année, au format mois-jour '
        + '(par exemple 10-15 pour « avant le 15 octobre »).');
    }
    const [m, j] = r.limiteMmjj.split('-').map(Number);
    if (m < 1 || m > 12 || j < 1 || j > 31) {
      throw new RecurrenceInvalide(`La date limite « ${r.limiteMmjj} » n'existe pas.`);
    }
    // Le 30 février n'existe dans aucune année : refusé à la saisie plutôt que
    // rabattu en silence sur le 28, ce qui ferait une échéance que personne
    // n'a demandée.
    if (j > jours(2024, m)) {
      throw new RecurrenceInvalide(
        `Le mois ${deuxChiffres(m)} n'a pas ${j} jours. Choisissez une date limite qui existe.`);
    }
    return;
  }
  if (r.periodicite === 'mensuelle') {
    const d = r.moisDebut ?? 1;
    const f = r.moisFin ?? 12;
    if (d < 1 || d > 12 || f < 1 || f > 12) {
      throw new RecurrenceInvalide('Les mois de la saison vont de 1 (janvier) à 12 (décembre).');
    }
    if (d > f) {
      throw new RecurrenceInvalide(
        `La saison va du mois ${d} au mois ${f}, ce qui ne veut rien dire. `
        + 'Pour une saison à cheval sur deux années, créez deux récurrences.');
    }
  }
}

/**
 * Les échéances d'une récurrence entre deux dates, bornes comprises.
 *
 * Une récurrence « à chaque séjour » n'engendre rien ici : son occurrence naît
 * du séjour, pas du calendrier, et c'est `pourSejour` qui s'en charge.
 */
export function echeances(r: Recurrence, du: string, au: string): Echeance[] {
  if (!estDate(du) || !estDate(au) || au < du) return [];
  if (r.periodicite === 'sejour') return [];
  controler(r);

  const out: Echeance[] = [];
  const anneeDebut = Number(du.slice(0, 4));
  const anneeFin = Number(au.slice(0, 4));

  for (let a = anneeDebut; a <= anneeFin; a++) {
    if (r.periodicite === 'annuelle') {
      const date = `${a}-${r.limiteMmjj}`;
      if (date >= du && date <= au) {
        out.push({ recurrenceId: r.id, libelle: r.libelle, categorie: r.categorie, echeance: date });
      }
      continue;
    }
    const debut = r.moisDebut ?? 1;
    const fin = r.moisFin ?? 12;
    for (let m = debut; m <= fin; m++) {
      // Le dernier jour du mois : « entretien du jardin en avril » est dû
      // pendant avril, pas le 1er, sinon la tâche naît déjà en retard.
      const date = `${a}-${deuxChiffres(m)}-${deuxChiffres(jours(a, m))}`;
      if (date >= du && date <= au) {
        out.push({ recurrenceId: r.id, libelle: r.libelle, categorie: r.categorie, echeance: date });
      }
    }
  }
  return out.sort((x, y) => x.echeance.localeCompare(y.echeance));
}

/**
 * L'occurrence d'une récurrence « à chaque séjour ».
 *
 * L'échéance est le jour de départ : un relevé de compteurs se fait en partant,
 * pas en arrivant.
 */
export function pourSejour(r: Recurrence, depart: string): Echeance | null {
  if (r.periodicite !== 'sejour' || !estDate(depart)) return null;
  return { recurrenceId: r.id, libelle: r.libelle, categorie: r.categorie, echeance: depart };
}

/** Comment la récurrence se lit dans l'écran. Repris des libellés de la maquette. */
export function lisible(r: Pick<Recurrence, 'periodicite' | 'limiteMmjj' | 'moisDebut' | 'moisFin'>): string {
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  if (r.periodicite === 'sejour') return 'À chaque séjour';
  if (r.periodicite === 'annuelle') {
    if (!r.limiteMmjj) return 'Tous les ans';
    const [m, j] = r.limiteMmjj.split('-').map(Number);
    return `Tous les ans, avant le ${j} ${MOIS[m - 1]}`;
  }
  const d = r.moisDebut ?? 1;
  const f = r.moisFin ?? 12;
  if (d === 1 && f === 12) return 'Tous les mois';
  return `Tous les mois, ${MOIS[d - 1]} à ${MOIS[f - 1]}`;
}

/**
 * Une échéance est-elle en retard, proche, ou tranquille ?
 *
 * Sert au classement de l'écran et à la tuile du tableau de bord. Le seuil de
 * « proche » est à trente jours : c'est le délai qu'il faut pour trouver un
 * artisan disponible à la campagne, ce qui est le vrai facteur limitant.
 */
export type Urgence = 'en_retard' | 'proche' | 'plus_tard';

export function urgence(echeance: string | null, aujourdhui: string): Urgence {
  if (!echeance || !estDate(echeance)) return 'plus_tard';
  if (echeance < aujourdhui) return 'en_retard';
  const limite = new Date(Date.parse(`${aujourdhui}T00:00:00Z`) + 30 * 86_400_000)
    .toISOString().slice(0, 10);
  return echeance <= limite ? 'proche' : 'plus_tard';
}
