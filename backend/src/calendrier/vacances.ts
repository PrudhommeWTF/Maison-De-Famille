// Les vacances scolaires françaises. Module PUR : ni base, ni HTTP.
//
// **Pourquoi une table et non un calcul.** Contrairement aux jours fériés, ces
// dates ne se déduisent de rien : elles sont fixées par arrêté ministériel,
// publiées deux ou trois ans à l'avance, et l'ordre des zones tourne d'une
// année sur l'autre. Aucune formule ne les donne.
//
// **Pourquoi ce fichier ne contient plus le calendrier.** Il vivait ici en
// constante jusqu'à la version 8 du schéma, ce qui obligeait à modifier le code
// et à redéployer une fois par an. Il est maintenant en base, alimenté par
// l'import de l'écran Réglages. Ce module garde ce qui reste vrai pour
// toujours : le découpage en zones, la notion d'année scolaire, et la façon de
// lire un intervalle. Il ne sait pas d'où viennent les périodes.
//
// **D'où viennent les périodes.** Du portail de l'Éducation nationale, que le
// service va chercher lui-même quand l'année en cours manque, ou d'un fichier
// déposé par la famille. Ce module ne le sait pas et n'a pas à le savoir.
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
 * Une période telle qu'elle est stockée : rattachée à son année scolaire, et
 * toujours à une zone précise. Le regroupement en « les trois zones » est un
 * confort d'affichage, pas une forme de stockage. Voir `collapser`.
 *
 * Les bornes suivent l'usage des familles et non la formulation officielle :
 * `debut` et `fin` sont des jours **sans classe**, bornes incluses. L'arrêté,
 * lui, annonce le jour de la reprise, qui est le lendemain de `fin`.
 */
export interface PeriodeAnnuelle {
  anneeScolaire: string;
  nom: string;
  zone: Zone;
  debut: string;
  fin: string;
}

/** L'année scolaire d'une date : le 1er septembre fait basculer. */
export function anneeScolaire(iso: string): string {
  const a = Number(iso.slice(0, 4));
  const apresLaRentree = iso.slice(5, 7) >= '09';
  return apresLaRentree ? `${a}-${a + 1}` : `${a - 1}-${a}`;
}

/** Les années scolaires que traverse `[du, au]`, bornes incluses. */
export function anneesTraversees(du: string, au: string): string[] {
  const out: string[] = [];
  for (let a = Number(anneeScolaire(du).slice(0, 4)); a <= Number(anneeScolaire(au).slice(0, 4)); a++) {
    out.push(`${a}-${a + 1}`);
  }
  return out;
}

/**
 * L'intervalle demandé est-il entièrement couvert par ce qui est en base ?
 *
 * Sert à afficher un avertissement plutôt qu'un calendrier silencieusement
 * incomplet : une famille qui ne voit aucune vacance en février doit savoir si
 * c'est parce qu'il n'y en a pas, ou parce que personne n'a mis la table à jour.
 */
export function couvre(du: string, au: string, annees: readonly string[]): boolean {
  return anneesTraversees(du, au).every((a) => annees.includes(a));
}

/**
 * Regroupe en une seule période « toutes zones » ce qui porte le même nom et
 * les mêmes dates dans les trois zones. Sans cela, l'infobulle du 25 décembre
 * dirait « Noël, Noël, Noël ».
 */
export function collapser(periodes: readonly PeriodeAnnuelle[]): Periode[] {
  const paquets = new Map<string, PeriodeAnnuelle[]>();
  for (const p of periodes) {
    const cle = `${p.nom} ${p.debut} ${p.fin}`;
    const paquet = paquets.get(cle) ?? [];
    if (!paquet.length) paquets.set(cle, paquet);
    paquet.push(p);
  }
  const out: Periode[] = [];
  for (const groupe of paquets.values()) {
    const zones = new Set(groupe.map((p) => p.zone));
    if (ZONES.every((z) => zones.has(z))) {
      out.push({ nom: groupe[0].nom, zone: null, debut: groupe[0].debut, fin: groupe[0].fin });
    } else {
      for (const p of groupe) out.push({ nom: p.nom, zone: p.zone, debut: p.debut, fin: p.fin });
    }
  }
  return trier(out);
}

/** Les périodes qui recoupent `[du, au]`, bornes incluses. */
export function entre(periodes: readonly Periode[], du: string, au: string, zones: readonly Zone[] = ZONES): Periode[] {
  return trier(periodes.filter((p) => !(p.zone && !zones.includes(p.zone)) && p.fin >= du && p.debut <= au));
}

const trier = (p: Periode[]): Periode[] =>
  p.sort((x, y) => x.debut.localeCompare(y.debut) || (x.zone ?? '').localeCompare(y.zone ?? ''));

/** Les zones en vacances un jour donné. Vide quand c'est jour de classe. */
export function zonesEnVacances(jour: string, periodes: readonly Periode[]): Zone[] {
  const dedans = periodes.filter((p) => p.debut <= jour && jour <= p.fin);
  if (dedans.some((p) => p.zone === null)) return [...ZONES];
  return ZONES.filter((z) => dedans.some((p) => p.zone === z));
}
