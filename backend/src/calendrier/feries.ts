// Les jours fériés français. Module PUR : ni base, ni HTTP, aucune donnée à
// maintenir.
//
// **Pourquoi c'est calculé et non embarqué.** Sept des onze jours sont à date
// fixe, les quatre autres se déduisent de Pâques. Une table serait à corriger
// chaque année ; un calcul est juste pour toujours, y compris en 2043 quand
// plus personne ne touchera à cette application.
//
// **Le périmètre.** Ce sont les onze jours fériés de la France métropolitaine.
// L'Alsace-Moselle en compte deux de plus (Vendredi saint et 26 décembre) : ils
// sont là, derrière un drapeau, parce qu'une maison de famille à Gérardmer n'a
// pas les mêmes ponts qu'une maison à Locquirec.

/** Le dimanche de Pâques, algorithme de Meeus pour le calendrier grégorien. */
export function paques(annee: number): string {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return `${annee}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

const JOUR = 86_400_000;
const decale = (iso: string, jours: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + jours * JOUR).toISOString().slice(0, 10);

export interface Ferie { date: string; nom: string }

/**
 * Les jours fériés d'une année civile.
 *
 * `alsaceMoselle` ajoute les deux jours propres aux trois départements
 * concernés. Le défaut est faux : c'est le cas de la très grande majorité, et
 * afficher deux fériés qui n'en sont pas ferait rater un jour de travail.
 */
export function feries(annee: number, alsaceMoselle = false): Ferie[] {
  const p = paques(annee);
  const liste: Ferie[] = [
    { date: `${annee}-01-01`, nom: 'Jour de l\'an' },
    { date: decale(p, 1), nom: 'Lundi de Pâques' },
    { date: `${annee}-05-01`, nom: 'Fête du Travail' },
    { date: `${annee}-05-08`, nom: 'Victoire 1945' },
    { date: decale(p, 39), nom: 'Ascension' },
    { date: decale(p, 50), nom: 'Lundi de Pentecôte' },
    { date: `${annee}-07-14`, nom: 'Fête nationale' },
    { date: `${annee}-08-15`, nom: 'Assomption' },
    { date: `${annee}-11-01`, nom: 'Toussaint' },
    { date: `${annee}-11-11`, nom: 'Armistice 1918' },
    { date: `${annee}-12-25`, nom: 'Noël' },
  ];
  if (alsaceMoselle) {
    liste.push({ date: decale(p, -2), nom: 'Vendredi saint' });
    liste.push({ date: `${annee}-12-26`, nom: 'Saint Étienne' });
  }
  return liste.sort((x, y) => x.date.localeCompare(y.date));
}

/** Les fériés d'un intervalle `[du, au]`, bornes incluses, sur plusieurs années. */
export function feriesEntre(du: string, au: string, alsaceMoselle = false): Ferie[] {
  const debut = Number(du.slice(0, 4));
  const fin = Number(au.slice(0, 4));
  const out: Ferie[] = [];
  for (let a = debut; a <= fin; a++) {
    out.push(...feries(a, alsaceMoselle).filter((f) => f.date >= du && f.date <= au));
  }
  return out;
}
