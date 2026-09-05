// La mise en forme française. Module PUR, testé.
//
// La locale, le fuseau et la devise sont **fixes** : cette application sert une
// famille française, et rendre cela configurable coûterait un réglage de plus à
// comprendre pour un besoin qui n'existe pas.
//
// Les dates sont manipulées en texte `AAAA-MM-JJ` de bout en bout, sans jamais
// passer par un `Date` local. Une conversion en heure locale au mauvais endroit
// décale une nuit sur deux au changement d'heure, et le bug est invisible six
// mois par an.

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MOIS_COURT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

/** « 8 août 2026 ». */
export function dateLongue(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [a, m, j] = iso.split('-');
  return `${Number(j)} ${MOIS[Number(m) - 1]} ${a}`;
}

/** « 8 août », sans l'année : dans un calendrier, elle est déjà à l'écran. */
export function dateCourte(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [, m, j] = iso.split('-');
  return `${Number(j)} ${MOIS_COURT[Number(m) - 1]}`;
}

/** « 8 → 16 août » quand le mois est le même, « 30 juil. → 5 août » sinon. */
export function plage(du: string, au: string): string {
  if (!du || !au) return '';
  return du.slice(0, 7) === au.slice(0, 7)
    ? `${Number(du.slice(8))} → ${dateCourte(au)}`
    : `${dateCourte(du)} → ${dateCourte(au)}`;
}

export const nomMois = (annee: number, mois: number): string => `${MOIS[mois]} ${annee}`;

/** Les en-têtes de colonnes, selon le premier jour de semaine choisi. */
export const enTetesJours = (dimancheDabord: boolean): string[] => {
  const abreges = JOURS.map((j) => j.slice(0, 3));
  return dimancheDabord ? [abreges[6], ...abreges.slice(0, 6)] : abreges;
};

/** « 8 nuits », « 1 nuit ». Le pluriel se règle ici, pas dans chaque écran. */
export const nuitsLisible = (n: number): string => `${n} nuit${n > 1 ? 's' : ''}`;
export const personnesLisible = (n: number): string => `${n} personne${n > 1 ? 's' : ''}`;

/** Les initiales d'un nom, pour les pastilles d'avatar. */
export function initiales(nom: string): string {
  const mots = nom.trim().split(/[\s-]+/).filter(Boolean);
  if (!mots.length) return '?';
  const premiere = mots[0][0] ?? '';
  const seconde = mots.length > 1 ? mots[mots.length - 1][0] ?? '' : '';
  return (premiere + seconde).toUpperCase();
}

/** Un montant en centimes, en euros lisibles. */
export const euros = (cents: number): string =>
  (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
    .replace(/ | /g, ' ');

/** Un horodatage ISO en « 8 août 2026 à 14:30 », dans le fuseau du navigateur. */
export function horodatageLisible(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${dateLongue(d.toISOString().slice(0, 10))} à ${heure}`;
}

// ---- Arithmétique de dates, en UTC pour ne jamais dépendre du fuseau ----

const JOUR_MS = 86_400_000;
const enMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

export const decale = (iso: string, jours: number): string =>
  new Date(enMs(iso) + jours * JOUR_MS).toISOString().slice(0, 10);

export const nuitsEntre = (du: string, au: string): number =>
  Math.round((enMs(au) - enMs(du)) / JOUR_MS);

export const aujourdhui = (): string => new Date().toISOString().slice(0, 10);

/** Le premier jour du mois, en texte. */
export const premierDuMois = (annee: number, mois: number): string =>
  `${annee}-${String(mois + 1).padStart(2, '0')}-01`;

/** Le premier jour du mois suivant : la borne haute exclue d'une plage. */
export function moisSuivant(annee: number, mois: number): { annee: number; mois: number } {
  return mois === 11 ? { annee: annee + 1, mois: 0 } : { annee, mois: mois + 1 };
}

export function moisPrecedent(annee: number, mois: number): { annee: number; mois: number } {
  return mois === 0 ? { annee: annee - 1, mois: 11 } : { annee, mois: mois - 1 };
}
