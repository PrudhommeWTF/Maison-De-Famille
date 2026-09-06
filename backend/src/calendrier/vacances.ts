// Les vacances scolaires françaises. Module PUR : ni base, ni HTTP.
//
// **Pourquoi une table et non un calcul.** Contrairement aux jours fériés, ces
// dates ne se déduisent de rien : elles sont fixées par arrêté ministériel,
// publiées deux ou trois ans à l'avance, et l'ordre des zones tourne d'une
// année sur l'autre. Aucune formule ne les donne.
//
// **Pourquoi elles sont ici et non téléchargées.** Le brief est explicite :
// aucun appel réseau sortant. L'application ne va donc rien chercher chez
// l'Éducation nationale ; la table vit dans le dépôt et se met à jour par une
// modification de ce fichier, une fois par an.
//
// **Ce que fait l'application quand une année manque.** Elle le dit. Elle
// n'invente pas, elle ne devine pas par rotation des zones, et elle n'affiche
// pas un calendrier muet qui laisserait croire qu'il n'y a pas de vacances.
// Voir `couvre()`.
//
// Source à vérifier à chaque mise à jour :
// https://www.education.gouv.fr/le-calendrier-scolaire

export type Zone = 'A' | 'B' | 'C';
export const ZONES: readonly Zone[] = ['A', 'B', 'C'];

/**
 * Les académies de chaque zone, pour que la famille sache laquelle la
 * concerne sans aller chercher ailleurs.
 */
export const ACADEMIES: Record<Zone, string> = {
  A: 'Besançon, Bordeaux, Clermont-Ferrand, Dijon, Grenoble, Limoges, Lyon, Poitiers',
  B: 'Aix-Marseille, Amiens, Lille, Nancy-Metz, Nantes, Nice, Normandie, Orléans-Tours, Reims, Rennes, Strasbourg',
  C: 'Créteil, Montpellier, Paris, Toulouse, Versailles',
};

export interface Periode {
  nom: string;
  /** `null` quand la période vaut pour les trois zones (Toussaint, Noël, été). */
  zone: Zone | null;
  /** Premier jour de vacances, inclus. */
  debut: string;
  /** Dernier jour de vacances, inclus : la veille de la reprise. */
  fin: string;
}

/**
 * Le calendrier, année scolaire par année scolaire.
 *
 * Les bornes suivent l'usage des familles et non la formulation officielle :
 * « du samedi au dimanche inclus », c'est-à-dire tous les jours où les enfants
 * ne sont pas en classe. L'arrêté dit « après la classe » et « au matin de la
 * reprise », ce qui désigne les mêmes journées.
 */
export const CALENDRIER: Record<string, Periode[]> = {
  '2025-2026': [
    { nom: 'Toussaint', zone: null, debut: '2025-10-18', fin: '2025-11-02' },
    { nom: 'Noël', zone: null, debut: '2025-12-20', fin: '2026-01-04' },
    { nom: 'Hiver', zone: 'A', debut: '2026-02-07', fin: '2026-02-22' },
    { nom: 'Hiver', zone: 'B', debut: '2026-02-14', fin: '2026-03-01' },
    { nom: 'Hiver', zone: 'C', debut: '2026-02-21', fin: '2026-03-08' },
    { nom: 'Printemps', zone: 'A', debut: '2026-04-04', fin: '2026-04-19' },
    { nom: 'Printemps', zone: 'B', debut: '2026-04-11', fin: '2026-04-26' },
    { nom: 'Printemps', zone: 'C', debut: '2026-04-18', fin: '2026-05-03' },
    { nom: 'Été', zone: null, debut: '2026-07-04', fin: '2026-08-31' },
  ],
};

/** Les années scolaires renseignées, triées. */
export const ANNEES_COUVERTES = Object.keys(CALENDRIER).sort();

/** L'année scolaire d'une date : le 1er septembre fait basculer. */
export function anneeScolaire(iso: string): string {
  const a = Number(iso.slice(0, 4));
  const debutAout = iso.slice(5, 7) >= '09';
  return debutAout ? `${a}-${a + 1}` : `${a - 1}-${a}`;
}

/**
 * L'intervalle demandé est-il entièrement couvert par la table ?
 *
 * Sert à afficher un avertissement plutôt qu'un calendrier silencieusement
 * incomplet : une famille qui ne voit aucune vacance en février doit savoir si
 * c'est parce qu'il n'y en a pas, ou parce que personne n'a mis la table à jour.
 */
export function couvre(du: string, au: string): boolean {
  const annees = new Set([anneeScolaire(du), anneeScolaire(au)]);
  return [...annees].every((a) => a in CALENDRIER);
}

/** Les périodes qui recoupent `[du, au]`, bornes incluses. */
export function vacancesEntre(du: string, au: string, zones: readonly Zone[] = ZONES): Periode[] {
  const annees = new Set([anneeScolaire(du), anneeScolaire(au)]);
  const out: Periode[] = [];
  for (const a of annees) {
    for (const p of CALENDRIER[a] ?? []) {
      if (p.zone && !zones.includes(p.zone)) continue;
      if (p.fin < du || p.debut > au) continue;
      out.push(p);
    }
  }
  return out.sort((x, y) => x.debut.localeCompare(y.debut) || (x.zone ?? '').localeCompare(y.zone ?? ''));
}

/** Les zones en vacances un jour donné. Vide quand c'est jour de classe. */
export function zonesEnVacances(jour: string, periodes: readonly Periode[]): Zone[] {
  const dedans = periodes.filter((p) => p.debut <= jour && jour <= p.fin);
  if (dedans.some((p) => p.zone === null)) return [...ZONES];
  return ZONES.filter((z) => dedans.some((p) => p.zone === z));
}
