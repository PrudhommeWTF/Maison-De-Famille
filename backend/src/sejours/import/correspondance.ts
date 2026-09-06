// La correspondance entre les colonnes du fichier et les champs d'un séjour.
// Module PUR : aucune base, aucun HTTP.
//
// Personne ne sait à l'avance à quoi ressemble le fichier de sa mère. Ce module
// **propose** une correspondance en reconnaissant les intitulés habituels, et
// l'écran d'import la laisse corriger. La correspondance retenue est mémorisée
// pour le prochain import, parce qu'un planning se reprend plusieurs fois avant
// d'être bon.
//
// La lecture des valeurs elles-mêmes (dates écrites de six façons, entiers
// noyés dans du texte) vit dans `noyau/tableau/valeurs.ts` : elle ne connaît
// aucun domaine, et l'import du calendrier scolaire s'en sert aussi.
import { normaliser } from '../../noyau/tableau/valeurs';

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
