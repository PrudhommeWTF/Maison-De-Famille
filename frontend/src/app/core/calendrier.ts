// La grille du calendrier. Module PUR, testé.
//
// La convention des nuits gouverne tout : une occupation est `[arrivee, depart)`,
// nuit d'arrivée incluse, nuit de départ exclue. Une case porte donc la NUIT qui
// commence ce jour-là, ce qui fait que deux séjours qui se succèdent le même jour
// n'occupent pas la même case.
//
// Le libellé n'est affiché que le premier jour d'une plage, comme dans la
// maquette : répéter le nom sur huit cases rendrait la grille illisible.
import { decale, premierDuMois } from './format';
import type { Nature, StatutSejour } from './modeles';

/**
 * La teinte d'une case, en classes Bootstrap plutôt qu'en couleurs.
 *
 * La palette vit dans le thème, pas ici : le module dit *quel rôle* porte la
 * nuit (une location est une réussite, un entretien une information), Bootstrap
 * dit de quelle couleur cela se traduit. Le jour où la palette bouge, ce
 * fichier ne bouge pas.
 */
export interface Teinte { classes: string }

export const TEINTES: Record<string, Teinte> = {
  famille: { classes: 'bg-primary-subtle border-primary-subtle text-primary-emphasis' },
  location: { classes: 'bg-success-subtle border-success-subtle text-success-emphasis' },
  entretien: { classes: 'bg-info-subtle border-info-subtle text-info-emphasis' },
  // Une demande n'est pas acquise : bordure tiretée, aucun fond, pour qu'on ne
  // la confonde ni avec un séjour validé ni avec une date libre.
  demande: { classes: 'border-primary text-primary-emphasis cal-dashed' },
  libre: { classes: 'text-body-secondary' },
};

/** La teinte d'une occupation : une demande se distingue de ce qui est acquis. */
export const teinteDe = (nature: Nature, statut: StatutSejour): Teinte =>
  statut === 'demande' ? TEINTES['demande'] : TEINTES[nature] ?? TEINTES['libre'];

export interface OccupationGrille {
  id: number; arrivee: string; depart: string; titre: string;
  nature: Nature; statut: StatutSejour;
}

export interface Case {
  /** Vide sur les cases de remplissage avant le 1er et après le dernier. */
  jour: number | null;
  date: string;
  teinte: Teinte;
  /** Affiché uniquement le premier jour de la plage. */
  libelle: string;
  /** Toutes les occupations de cette nuit : le titre du survol les nomme. */
  occupations: OccupationGrille[];
  enConflit: boolean;
  aujourdhui: boolean;
  /** Les zones scolaires en vacances cette nuit-là. */
  zones: ZoneVacances[];
  /** Le nom du jour férié, vide sinon. */
  ferie: string;
}

export type ZoneVacances = 'A' | 'B' | 'C';

/**
 * Les couleurs des trois zones de vacances scolaires.
 *
 * Elles ne peuvent pas être prises dans la palette des natures de séjour :
 * une case porte déjà un fond qui dit qui occupe la maison, et deux
 * informations ne peuvent pas se partager le même canal visuel. Les zones
 * s'affichent donc en bandeaux fins sous la case, dans trois teintes choisies
 * pour rester distinctes entre elles et de tous les fonds existants.
 */
export const COULEURS_ZONE: Record<ZoneVacances, string> = {
  A: '#c98a3f',
  B: '#5f87a8',
  C: '#8f7aa8',
};

export interface PeriodeVacances { nom: string; zone: ZoneVacances | null; debut: string; fin: string }
export interface JourFerie { date: string; nom: string }

/** Repères nationaux affichés sous la grille d'occupation. */
export interface Reperes {
  feries: JourFerie[];
  vacances: PeriodeVacances[];
  /** Faux quand la table des vacances ne couvre pas la plage demandée. */
  couvert: boolean;
  anneesCouvertes: string[];
}

export const REPERES_VIDES: Reperes = { feries: [], vacances: [], couvert: true, anneesCouvertes: [] };

/** Une année scolaire présente en base, telle que l'écran Réglages l'affiche. */
export interface AnneeVacances {
  anneeScolaire: string;
  periodes: number;
  debut: string;
  fin: string;
  source: string;
  importeLe: string;
  importePar: string | null;
}

export interface PeriodeImportee {
  anneeScolaire: string;
  nom: string;
  zone: ZoneVacances;
  debut: string;
  fin: string;
}

/**
 * Ce que le serveur répond à l'analyse d'un fichier téléversé. Rien n'est
 * encore écrit à ce stade : cet aperçu existe pour être relu avant d'accepter.
 */
export interface ApercuVacances {
  format: string;
  /** D'où viennent les octets : le nom du fichier déposé, ou le portail. */
  source: string;
  encodage: string | null;
  entetes: string[];
  lues: number;
  /** Vrai quand les dates de fin du fichier désignent le jour de la reprise. */
  finEstLaReprise: boolean;
  periodes: PeriodeImportee[];
  annees: { anneeScolaire: string; periodes: number }[];
  rejets: { ligne: number; apercu: string; raison: string }[];
  /** Les années déjà connues, pour dire lesquelles seront remplacées. */
  deja: string[];
}

/** L'année scolaire d'une date : le 1er septembre fait basculer. */
export function anneeScolaireDe(iso: string): string {
  const a = Number(iso.slice(0, 4));
  return iso.slice(5, 7) >= '09' ? `${a}-${a + 1}` : `${a - 1}-${a}`;
}

/**
 * Les zones en vacances un jour donné.
 *
 * Une période sans zone (Toussaint, Noël, été) vaut pour les trois : c'est ce
 * qui évite d'écrire trois lignes identiques dans la table.
 */
export function zonesDuJour(jour: string, periodes: readonly PeriodeVacances[]): ZoneVacances[] {
  const dedans = periodes.filter((p) => p.debut <= jour && jour <= p.fin);
  if (dedans.some((p) => p.zone === null)) return ['A', 'B', 'C'];
  return (['A', 'B', 'C'] as ZoneVacances[]).filter((z) => dedans.some((p) => p.zone === z));
}

export interface Semaine { cases: Case[] }

/**
 * La grille d'un mois.
 *
 * `nuitsEnConflit` vient du serveur : la détection de chevauchement n'est jamais
 * refaite ici. Deux implémentations d'une même règle finissent toujours par
 * diverger, et c'est celle du serveur qui fait autorité.
 */
export function grilleDuMois(
  annee: number, mois: number, occupations: readonly OccupationGrille[],
  options: {
    dimancheDabord?: boolean; nuitsEnConflit?: readonly string[]; aujourdhui?: string;
    reperes?: Reperes;
  } = {},
): Semaine[] {
  const premier = premierDuMois(annee, mois);
  const jourSemaine = new Date(`${premier}T00:00:00Z`).getUTCDay();          // 0 = dimanche
  const decalage = options.dimancheDabord ? jourSemaine : (jourSemaine + 6) % 7;
  const nbJours = new Date(Date.UTC(annee, mois + 1, 0)).getUTCDate();
  const conflits = new Set(options.nuitsEnConflit ?? []);
  const reperes = options.reperes ?? REPERES_VIDES;
  const feries = new Map(reperes.feries.map((f) => [f.date, f.nom]));

  const vide = (): Case => ({
    jour: null, date: '', teinte: { classes: 'border-0' },
    libelle: '', occupations: [], enConflit: false, aujourdhui: false, zones: [], ferie: '',
  });

  const cases: Case[] = [];
  for (let i = 0; i < decalage; i++) cases.push(vide());

  for (let j = 1; j <= nbJours; j++) {
    const date = decale(premier, j - 1);
    // La nuit du jour J appartient à un séjour si arrivee <= J < depart.
    const ici = occupations.filter((o) => o.arrivee <= date && date < o.depart);
    // Quand plusieurs se recouvrent, la teinte montre ce qui est acquis avant ce
    // qui est demandé : une case colorée « demande » sur un séjour validé
    // laisserait croire que la date est libre.
    const principale = ici.find((o) => o.statut === 'valide') ?? ici[0];
    cases.push({
      jour: j,
      date,
      teinte: principale ? teinteDe(principale.nature, principale.statut) : TEINTES['libre'],
      libelle: ici.find((o) => o.arrivee === date)?.titre ?? '',
      occupations: ici,
      enConflit: conflits.has(date),
      aujourdhui: date === options.aujourdhui,
      zones: zonesDuJour(date, reperes.vacances),
      ferie: feries.get(date) ?? '',
    });
  }

  while (cases.length % 7) cases.push(vide());

  const semaines: Semaine[] = [];
  for (let i = 0; i < cases.length; i += 7) semaines.push({ cases: cases.slice(i, i + 7) });
  return semaines;
}

/** Les occupations qui touchent le mois affiché, pour la liste sous la grille. */
export function occupationsDuMois<T extends { arrivee: string; depart: string }>(
  annee: number, mois: number, occupations: readonly T[],
): T[] {
  const debut = premierDuMois(annee, mois);
  const fin = premierDuMois(mois === 11 ? annee + 1 : annee, mois === 11 ? 0 : mois + 1);
  return occupations.filter((o) => o.arrivee < fin && o.depart > debut)
    .sort((a, b) => a.arrivee.localeCompare(b.arrivee));
}
