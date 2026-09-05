// La correspondance entre les colonnes du fichier et les champs d'un séjour.
// Module PUR : aucune base, aucun HTTP.
//
// Personne ne sait à l'avance à quoi ressemble le fichier de sa mère. Ce module
// **propose** une correspondance en reconnaissant les intitulés habituels, et
// l'écran d'import la laisse corriger. La correspondance retenue est mémorisée
// pour le prochain import, parce qu'un planning se reprend plusieurs fois avant
// d'être bon.
//
// Les dates sont le vrai piège : un tableur français écrit « 08/08/2026 »,
// un tableur en anglais « 8/8/2026 », et une cellule au format date dans un
// .xlsx sort en **numéro de série** (46 000 et quelques). Les trois sont
// reconnues, et ce qui ne l'est pas est refusé ligne par ligne avec sa raison,
// jamais deviné.

export type Champ = 'bien' | 'titre' | 'arrivee' | 'depart' | 'occupants' | 'nature' | 'note' | 'statut';

export const CHAMPS: readonly { champ: Champ; libelle: string; obligatoire: boolean }[] = [
  { champ: 'arrivee', libelle: "Date d'arrivée", obligatoire: true },
  { champ: 'depart', libelle: 'Date de départ', obligatoire: true },
  { champ: 'titre', libelle: 'Qui (nom affiché)', obligatoire: true },
  { champ: 'bien', libelle: 'Bien', obligatoire: false },
  { champ: 'occupants', libelle: 'Nombre de personnes', obligatoire: false },
  { champ: 'nature', libelle: 'Nature (famille, location, entretien)', obligatoire: false },
  { champ: 'statut', libelle: 'Statut', obligatoire: false },
  { champ: 'note', libelle: 'Note', obligatoire: false },
];

/** Les intitulés reconnus, en minuscules sans accent ni ponctuation. */
const INDICES: Record<Champ, readonly string[]> = {
  arrivee: ['arrivee', 'debut', 'du', 'date darrivee', 'date debut', 'entree', 'checkin', 'arrival'],
  depart: ['depart', 'fin', 'au', 'date de depart', 'date fin', 'sortie', 'checkout', 'departure'],
  titre: ['qui', 'nom', 'occupant', 'occupants', 'famille', 'personne', 'demandeur', 'locataire', 'reservation'],
  bien: ['bien', 'maison', 'lieu', 'logement', 'propriete', 'residence'],
  occupants: ['nombre', 'nb', 'personnes', 'nb personnes', 'effectif', 'pax', 'couchages utilises'],
  nature: ['nature', 'type', 'categorie'],
  statut: ['statut', 'etat', 'confirme'],
  note: ['note', 'remarque', 'commentaire', 'observation', 'infos'],
};

/**
 * La forme comparable d'un texte : sans accent, sans casse, sans ponctuation.
 *
 * Les apostrophes sont **retirées** et non remplacées par une espace, sinon
 * « Kerloc'h » donnerait « kerloc h » et ne se reconnaîtrait plus dans
 * « Kerloch » tapé à la main dans le planning. C'est exactement le genre de
 * détail qui fait refuser trois cents lignes.
 */
export const normaliser = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Propose une correspondance : pour chaque champ, l'indice de colonne ou -1. */
export function proposer(entetes: readonly string[]): Record<Champ, number> {
  const normalises = entetes.map(normaliser);
  const out = {} as Record<Champ, number>;
  const pris = new Set<number>();

  for (const { champ } of CHAMPS) {
    const mots = INDICES[champ];
    // Une correspondance exacte d'abord : « du » ne doit pas attraper « durée ».
    let trouve = normalises.findIndex((n, i) => !pris.has(i) && mots.includes(n));
    if (trouve === -1) {
      trouve = normalises.findIndex((n, i) => !pris.has(i) && n && mots.some((m) => m.length > 3 && n.includes(m)));
    }
    out[champ] = trouve;
    if (trouve >= 0) pris.add(trouve);
  }
  return out;
}

/** L'origine du calendrier des tableurs : le 30 décembre 1899, décalage compris. */
const ORIGINE_TABLEUR = Date.UTC(1899, 11, 30);

/**
 * Une date de cellule vers `AAAA-MM-JJ`, ou null.
 *
 * Rien n'est deviné : `03/04/2026` est lu comme le 3 avril, jour d'abord,
 * parce que le fichier vient d'un tableur français. Une valeur ambiguë que ce
 * choix rendrait invalide (`13/04` contre `04/13`) est rattrapée, mais
 * `03/04` reste le 3 avril, et c'est dit à l'écran d'import.
 */
export function versDate(brut: string): string | null {
  const v = String(brut ?? '').trim();
  if (!v) return null;

  // Numéro de série d'un tableur : une cellule au format date dans un .xlsx.
  if (/^\d{1,6}(\.\d+)?$/.test(v)) {
    const n = Number(v);
    if (n < 1 || n > 200000) return null;
    const d = new Date(ORIGINE_TABLEUR + Math.floor(n) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }

  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(v);
  if (iso) return valider(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const fr = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})/.exec(v);
  if (fr) {
    let [, j, m, a] = fr.map(Number) as unknown as [unknown, number, number, number];
    // Un tableur en anglais écrit le mois d'abord : si le « jour » dépasse 12 et
    // que le « mois » ne le dépasse pas, l'ordre est celui qu'on croit ; sinon
    // et seulement sinon, on échange.
    if (j <= 12 && m > 12) { const t = j; j = m; m = t; }
    if (a < 100) a += a < 70 ? 2000 : 1900;
    return valider(a, m, j);
  }

  const litteral = moisLitteral(v);
  return litteral;
}

const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

/** « 8 août 2026 », « 8 aout » ou « 8 août 26 », qu'on trouve dans les plannings tenus à la main. */
function moisLitteral(v: string): string | null {
  const n = normaliser(v);
  const m = /^(\d{1,2}) ([a-z]+)\.? ?(\d{2,4})?$/.exec(n);
  if (!m) return null;
  const mois = MOIS.findIndex((x) => x.startsWith(m[2].slice(0, 4)));
  if (mois < 0) return null;
  const annee = m[3] ? (Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3])) : new Date().getUTCFullYear();
  return valider(annee, mois + 1, Number(m[1]));
}

function valider(a: number, m: number, j: number): string | null {
  if (!(a >= 1900 && a <= 2200 && m >= 1 && m <= 12 && j >= 1 && j <= 31)) return null;
  const iso = `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toISOString().slice(0, 10) === iso ? iso : null;
}

export function versEntier(brut: string, defaut: number): number {
  const m = /-?\d+/.exec(String(brut ?? ''));
  const n = m ? Number(m[0]) : NaN;
  return Number.isInteger(n) && n > 0 && n < 1000 ? n : defaut;
}

export type Nature = 'famille' | 'location' | 'entretien';

export function versNature(brut: string): Nature {
  const n = normaliser(brut);
  if (/loc|loue|gite|airbnb|bnb/.test(n)) return 'location';
  if (/entretien|travaux|artisan|menage|ferme|indispo/.test(n)) return 'entretien';
  return 'famille';
}

export type Statut = 'demande' | 'valide';

/**
 * Un planning tenu à la main note parfois « à confirmer », ou simplement « ? ».
 * On le respecte : importer une réservation incertaine comme validée ferait
 * croire à toute la famille qu'une date est prise.
 *
 * Le point d'interrogation est cherché dans la valeur brute : la normalisation
 * retire la ponctuation, et c'est justement lui le signal.
 */
export function versStatut(brut: string): Statut {
  const v = String(brut ?? '');
  if (v.includes('?')) return 'demande';
  return /a confirmer|en attente|demande|provisoire|option|incertain/.test(normaliser(v)) ? 'demande' : 'valide';
}
