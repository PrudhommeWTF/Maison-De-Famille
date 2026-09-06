// La lecture d'un calendrier scolaire téléversé. Module PUR : ni base, ni HTTP.
//
// **Ce que ce module reçoit.** Un tableau déjà décodé (`noyau/tableau`), qu'il
// vienne d'un CSV, d'un .xlsx ou d'un export de portail ouvert. Il ne connaît
// ni les octets, ni le réseau : l'application ne télécharge jamais le fichier
// officiel elle-même, c'est la famille qui le dépose.
//
// **Pourquoi une reconnaissance par alias et non un format figé.** Le fichier
// de l'Éducation nationale s'exporte avec des intitulés techniques
// (`description`, `start_date`) ou des libellés français selon le bouton
// cliqué, et une famille peut aussi bien saisir son propre tableau à cinq
// colonnes. Reconnaître les intitulés habituels couvre les trois cas ; ce qui
// n'est pas reconnu est **dit**, avec les colonnes attendues et celles vues,
// jamais deviné.
//
// **La borne de fin est le seul vrai piège.** Le fichier officiel donne le jour
// de la **reprise des cours** ; un tableau tenu à la main donne plutôt le
// **dernier jour de vacances**. Les deux se distinguent par un fait vérifiable
// et non par une supposition : une reprise tombe toujours un jour de classe,
// donc jamais un samedi ni un dimanche. La convention retenue est décidée pour
// le fichier entier, à la majorité, et **annoncée à l'écran** avec les dates
// telles qu'elles seront enregistrées. Rien n'est écrit avant confirmation.
import { decale } from '../noyau/dates';
import { normaliser, versDate } from '../noyau/tableau/valeurs';
import { PeriodeAnnuelle, Zone, ZONES, anneeScolaire } from './vacances';

/** Les colonnes cherchées, et les intitulés qui les désignent une fois normalisés. */
const ALIAS = {
  nom: ['description', 'libelle', 'intitule', 'periode', 'nom', 'vacances'],
  debut: ['start date', 'date de debut', 'date debut', 'debut', 'du'],
  fin: ['end date', 'date de fin', 'date fin', 'fin', 'au'],
  zone: ['zones', 'zone'],
  annee: ['annee scolaire', 'annee'],
  population: ['population', 'public'],
} as const;

export type Colonne = keyof typeof ALIAS;

/** Sans elles, il n'y a pas de période à enregistrer. */
const OBLIGATOIRES: readonly Colonne[] = ['nom', 'debut', 'fin', 'zone'];

/** Plus long que ça, ce n'est pas une période de vacances mais une erreur de lecture. */
const JOURS_MAX = 80;

export interface Rejet {
  /** Le numéro de ligne dans le fichier, tel qu'il s'affiche dans un tableur. */
  ligne: number;
  apercu: string;
  raison: string;
}

export interface Rapport {
  entetes: string[];
  ligneEntete: number;
  colonnes: Partial<Record<Colonne, number>>;
  /** `true` quand les dates de fin du fichier désignent le jour de la reprise. */
  finEstLaReprise: boolean;
  lues: number;
  periodes: PeriodeAnnuelle[];
  annees: { anneeScolaire: string; periodes: number }[];
  rejets: Rejet[];
}

export class FichierIncomprehensible extends Error {}

/** La forme comparable d'une valeur de zone : « Zone A » et « zone_a » se rejoignent. */
const zonesDe = (brut: string): Zone[] => {
  const n = normaliser(brut);
  const trouvees = [...n.matchAll(/zone ?([abc])(?![a-z0-9])/g)].map((m) => m[1].toUpperCase() as Zone);
  // Une colonne qui ne contient que « A » ou « B, C », sans le mot « zone ».
  if (!trouvees.length && /^[abc]( [abc])*$/.test(n)) return n.split(' ').map((z) => z.toUpperCase() as Zone);
  return [...new Set(trouvees)];
};

/**
 * « Vacances de la Toussaint » devient « Toussaint ».
 *
 * Le préfixe est retiré parce qu'il se répète sur chaque ligne et n'apprend
 * rien : dans une infobulle de calendrier, « Toussaint » suffit et tient.
 */
export function nomCourt(brut: string): string {
  const court = brut.trim()
    .replace(/^d[ée]but des\s+/i, '')
    .replace(/^vacances\s+(de\s+la\s+|de\s+l['’]|d['’]|de\s+|du\s+)?/i, '')
    .trim();
  return court || brut.trim();
}

/** La ligne d'en-tête : la première qui donne toutes les colonnes obligatoires. */
function trouverEntete(lignes: readonly (readonly string[])[]): { indice: number; colonnes: Partial<Record<Colonne, number>> } {
  let meilleur = { indice: 0, colonnes: {} as Partial<Record<Colonne, number>> };
  for (let i = 0; i < Math.min(lignes.length, 20); i++) {
    const colonnes = resoudre(lignes[i]);
    if (OBLIGATOIRES.every((c) => colonnes[c] !== undefined)) return { indice: i, colonnes };
    if (Object.keys(colonnes).length > Object.keys(meilleur.colonnes).length) meilleur = { indice: i, colonnes };
  }
  return meilleur;
}

/** Pour chaque colonne cherchée, l'indice dans l'en-tête, ou rien. */
function resoudre(entetes: readonly string[]): Partial<Record<Colonne, number>> {
  const normalises = entetes.map((e) => normaliser(String(e ?? '')));
  const out: Partial<Record<Colonne, number>> = {};
  const pris = new Set<number>();
  // Les alias sont classés du plus précis au plus vague : « date de debut »
  // est essayé avant « du », sinon une colonne « Durée » raflerait la place.
  for (const [colonne, mots] of Object.entries(ALIAS) as [Colonne, readonly string[]][]) {
    for (const mot of mots) {
      const i = normalises.findIndex((e, k) => e === mot && !pris.has(k));
      if (i >= 0) { out[colonne] = i; pris.add(i); break; }
    }
  }
  return out;
}

const ANNEE_SCOLAIRE = /^(\d{4})-(\d{4})$/;

export function analyser(lignes: readonly (readonly string[])[]): Rapport {
  const { indice: ligneEntete, colonnes } = trouverEntete(lignes);
  const entetes = (lignes[ligneEntete] ?? []).map((e) => String(e ?? ''));

  const manquantes = OBLIGATOIRES.filter((c) => colonnes[c] === undefined);
  if (manquantes.length) {
    throw new FichierIncomprehensible(
      `Ce fichier ne contient pas de colonne ${manquantes.map(libelleColonne).join(', ni de colonne ')}. ` +
      `Les intitulés lus sont : ${entetes.filter((e) => e.trim()).join(', ') || 'aucun'}. ` +
      'Téléversez le calendrier scolaire tel qu\'il se télécharge sur data.education.gouv.fr, ' +
      'ou un tableau à cinq colonnes : période, zone, début, fin, année scolaire.',
    );
  }

  const cellule = (ligne: readonly string[], c: Colonne): string =>
    colonnes[c] === undefined ? '' : String(ligne[colonnes[c]!] ?? '').trim();

  // Le numéro de ligne est gardé tel qu'il s'affiche dans un tableur : un rejet
  // qu'on ne peut pas retrouver dans le fichier ne sert à rien.
  const corps = lignes.map((ligne, i) => ({ ligne, numero: i + 1 })).slice(ligneEntete + 1)
    .filter(({ ligne }) => ligne.some((c) => String(c ?? '').trim()));

  // La convention de la borne de fin se décide sur le fichier entier : une
  // reprise des cours ne tombe jamais un samedi ni un dimanche.
  const finsLues = corps.map(({ ligne }) => versDate(cellule(ligne, 'fin'))).filter((d): d is string => d !== null);
  const enFinDeSemaine = finsLues.filter((d) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())).length;
  const finEstLaReprise = finsLues.length > 0 && enFinDeSemaine * 2 <= finsLues.length;

  const periodes: PeriodeAnnuelle[] = [];
  const rejets: Rejet[] = [];
  const vues = new Set<string>();

  for (const { ligne, numero } of corps) {
    const apercu = ligne.filter((c) => String(c ?? '').trim()).slice(0, 4).join(' | ').slice(0, 120);
    const refuser = (raison: string): void => { rejets.push({ ligne: numero, apercu, raison }); };

    if (/enseignant/.test(normaliser(cellule(ligne, 'population')))) {
      refuser('Concerne les enseignants et non les élèves.'); continue;
    }
    const brutNom = cellule(ligne, 'nom');
    if (/rentree/.test(normaliser(brutNom))) {
      refuser('Jour de rentrée, et non une période de vacances.'); continue;
    }

    const zones = zonesDe(cellule(ligne, 'zone'));
    if (!zones.length) {
      refuser(`Zone « ${cellule(ligne, 'zone') || 'vide'} » hors des zones A, B et C de métropole.`); continue;
    }

    const debut = versDate(cellule(ligne, 'debut'));
    const finBrute = versDate(cellule(ligne, 'fin'));
    if (!debut || !finBrute) { refuser('Date de début ou de fin illisible.'); continue; }

    const fin = finEstLaReprise ? decale(finBrute, -1) : finBrute;
    if (fin < debut) { refuser('La fin tombe avant le début.'); continue; }
    if ((Date.parse(fin) - Date.parse(debut)) / 86_400_000 > JOURS_MAX) {
      refuser(`Période de plus de ${JOURS_MAX} jours : ce n'est pas des vacances scolaires.`); continue;
    }

    const brutAnnee = cellule(ligne, 'annee');
    const m = ANNEE_SCOLAIRE.exec(brutAnnee);
    // L'année du fichier prime quand elle est cohérente ; sinon elle se déduit
    // de la date, parce qu'un « 2025/2026 » mal saisi ne doit pas tout refuser.
    const annee = m && Number(m[2]) === Number(m[1]) + 1 ? brutAnnee : anneeScolaire(debut);

    const nom = nomCourt(brutNom) || 'Vacances';
    for (const zone of zones) {
      const cle = `${annee} ${zone} ${nom} ${debut}`;
      if (vues.has(cle)) { refuser(`Déjà lue plus haut : ${nom}, zone ${zone}, ${debut}.`); continue; }
      vues.add(cle);
      periodes.push({ anneeScolaire: annee, nom, zone, debut, fin });
    }
  }

  periodes.sort((a, b) => a.debut.localeCompare(b.debut) || a.zone.localeCompare(b.zone));

  const parAnnee = new Map<string, number>();
  for (const p of periodes) parAnnee.set(p.anneeScolaire, (parAnnee.get(p.anneeScolaire) ?? 0) + 1);

  return {
    entetes, ligneEntete, colonnes, finEstLaReprise,
    lues: corps.length, periodes, rejets,
    annees: [...parAnnee.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([anneeScolaire, periodes]) => ({ anneeScolaire, periodes })),
  };
}

function libelleColonne(c: Colonne): string {
  return { nom: 'période', debut: 'date de début', fin: 'date de fin', zone: 'zone', annee: 'année scolaire', population: 'population' }[c];
}

/**
 * Relit ce que le navigateur renvoie après l'aperçu.
 *
 * L'aller-retour évite de garder le fichier côté serveur entre deux requêtes,
 * mais il rend le contenu **modifiable par l'appelant** : tout est donc revérifié
 * ici, exactement comme à la lecture du fichier.
 */
export function relire(brut: unknown): PeriodeAnnuelle[] {
  if (!Array.isArray(brut) || !brut.length) throw new FichierIncomprehensible('Aucune période à enregistrer.');
  if (brut.length > 5000) throw new FichierIncomprehensible('Trop de périodes en une fois.');

  return brut.map((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const rang = `Période ${i + 1}`;
    const annee = String(o.anneeScolaire ?? '');
    const m = ANNEE_SCOLAIRE.exec(annee);
    if (!m || Number(m[2]) !== Number(m[1]) + 1) throw new FichierIncomprehensible(`${rang} : année scolaire invalide.`);

    const zone = String(o.zone ?? '') as Zone;
    if (!ZONES.includes(zone)) throw new FichierIncomprehensible(`${rang} : zone invalide.`);

    const debut = versDate(String(o.debut ?? ''));
    const fin = versDate(String(o.fin ?? ''));
    if (!debut || !fin || fin < debut) throw new FichierIncomprehensible(`${rang} : dates invalides.`);
    if ((Date.parse(fin) - Date.parse(debut)) / 86_400_000 > JOURS_MAX) {
      throw new FichierIncomprehensible(`${rang} : période trop longue.`);
    }

    const nom = String(o.nom ?? '').trim().slice(0, 60);
    if (!nom) throw new FichierIncomprehensible(`${rang} : nom vide.`);

    return { anneeScolaire: annee, nom, zone, debut, fin };
  });
}
