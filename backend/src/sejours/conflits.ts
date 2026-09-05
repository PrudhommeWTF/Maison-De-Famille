// La détection de conflits. Module PUR : aucune base, aucun HTTP.
//
// Trois natures de conflit, et elles ne se valent pas :
//
//   - **chevauchement avec un séjour validé** : le bien est déjà pris. C'est le
//     conflit dur, celui qui apparaît dans la bannière du calendrier.
//   - **chevauchement avec une demande en attente** : deux personnes visent les
//     mêmes dates. Les deux restent en attente, la gérante arbitre.
//   - **capacité dépassée** : la somme des occupants sur une même nuit dépasse
//     les couchages du bien.
//
// **Rien n'est jamais refusé automatiquement.** La gérante arbitre depuis
// toujours ; si l'application lui donne le sentiment de lui retirer ce rôle,
// elle ne l'utilisera pas et la famille reviendra au téléphone. L'outil
// enregistre, signale et rend visible, elle décide. Un passage en force est
// possible et journalisé.
import { chevauche, dateLisible, nuits, nuitsDe, plageLisible } from '../noyau/dates';

export interface Occupation {
  id: number;
  arrivee: string;
  depart: string;
  occupants: number;
  nature: 'famille' | 'location' | 'entretien';
  statut: 'demande' | 'valide' | 'a_revoir' | 'annule';
  titre: string;
}

export type NatureConflit = 'sejour_valide' | 'demande_concurrente' | 'capacite';

export interface Conflit {
  nature: NatureConflit;
  /** Le séjour en cause. Absent pour un dépassement de capacité pur. */
  sejourId?: number;
  message: string;
  /** Les nuits concernées, pour surligner la grille. */
  nuits: string[];
}

/** Ce qui occupe réellement le bien : une demande refusée ou annulée, non. */
const compte = (o: Occupation): boolean => o.statut === 'demande' || o.statut === 'valide';

export interface Demande { arrivee: string; depart: string; occupants: number; sejourId?: number }

/**
 * Les conflits d'une demande contre les occupations existantes du bien.
 *
 * `sejourId` permet de modifier un séjour sans qu'il se signale lui-même comme
 * un conflit.
 */
export function detecter(d: Demande, existantes: readonly Occupation[], couchages: number): Conflit[] {
  const out: Conflit[] = [];
  const autres = existantes.filter((o) => compte(o) && o.id !== d.sejourId);

  for (const o of autres) {
    if (!chevauche(d.arrivee, d.depart, o.arrivee, o.depart)) continue;
    const communes = nuitsDe(
      d.arrivee > o.arrivee ? d.arrivee : o.arrivee,
      d.depart < o.depart ? d.depart : o.depart,
    );
    const quoi = o.nature === 'location' ? 'la location' : o.nature === 'entretien' ? "l'intervention" : 'le séjour';
    out.push(o.statut === 'valide'
      ? {
        nature: 'sejour_valide', sejourId: o.id, nuits: communes,
        message: `Chevauche ${quoi} « ${o.titre} », ${plageLisible(o.arrivee, o.depart)}.`,
      }
      : {
        nature: 'demande_concurrente', sejourId: o.id, nuits: communes,
        message: `Une autre demande porte sur les mêmes dates : « ${o.titre} », ${plageLisible(o.arrivee, o.depart)}.`,
      });
  }

  // La capacité se juge nuit par nuit : deux séjours qui se succèdent le même
  // jour ne s'additionnent pas, deux séjours qui se recouvrent, si.
  const parNuit = new Map<string, number>();
  for (const n of nuitsDe(d.arrivee, d.depart)) parNuit.set(n, d.occupants);
  for (const o of autres) {
    for (const n of nuitsDe(o.arrivee, o.depart)) {
      const v = parNuit.get(n);
      if (v !== undefined) parNuit.set(n, v + o.occupants);
    }
  }
  const saturees = [...parNuit.entries()].filter(([, total]) => total > couchages);
  if (saturees.length) {
    const pire = Math.max(...saturees.map(([, t]) => t));
    const nuitsSaturees = saturees.map(([n]) => n).sort();
    out.push({
      nature: 'capacite', nuits: nuitsSaturees,
      message: `Capacité dépassée : ${pire} personnes attendues pour ${couchages} couchages, `
        + (nuitsSaturees.length === 1
          ? `la nuit du ${dateLisible(nuitsSaturees[0])}.`
          : `sur ${nuitsSaturees.length} nuits, ${plageLisible(nuitsSaturees[0], nuitsSaturees[nuitsSaturees.length - 1])}.`),
    });
  }

  return out;
}

export const conflitDur = (conflits: readonly Conflit[]): boolean =>
  conflits.some((c) => c.nature === 'sejour_valide');

/** Le résumé d'une file de demandes, pour la bannière du calendrier. */
export function bannierePourBien(
  demandes: readonly Occupation[], existantes: readonly Occupation[], couchages: number,
): Conflit[] {
  const out: Conflit[] = [];
  for (const d of demandes) {
    if (d.statut !== 'demande') continue;
    out.push(...detecter(
      { arrivee: d.arrivee, depart: d.depart, occupants: d.occupants, sejourId: d.id },
      existantes, couchages,
    ).filter((c) => c.nature !== 'demande_concurrente'));
  }
  return out;
}

/** Les nuits consommées par un ensemble de séjours, hors location et entretien. */
export function nuitsConsommees(sejours: readonly Occupation[]): number {
  return sejours
    .filter((s) => s.statut === 'valide' && s.nature === 'famille')
    .reduce((t, s) => t + nuits(s.arrivee, s.depart), 0);
}
