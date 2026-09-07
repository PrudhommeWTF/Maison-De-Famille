// Comparer des versions, et lire l'état d'une mise à jour. Module PUR.
//
// **La leçon vient de Foyer-App, et elle a coûté une panne.** Le fichier
// d'état est écrit par deux mains : le service y pose « en cours » quand il
// dépose le déclencheur, puis le script root le réécrit à chaque étape.
// L'interface, tant qu'il vaut « en cours », remplace les boutons par « Mise à
// jour en cours ».
//
// D'où la panne : si la mise à jour s'interrompt, ce fichier reste « en cours »
// **pour toujours**. Service redémarré, machine rebootée, unité systemd jamais
// déclenchée, coupure pendant la compilation : dans tous ces cas l'application
// se retrouve définitivement bloquée sur « Mise à jour en cours », sans bouton,
// et sans aucun moyen de s'en sortir depuis l'interface. Il fallait aller
// supprimer un fichier sur le serveur pour retrouver la main.
//
// Le remède : **un « en cours » qui n'a pas progressé depuis un moment n'en est
// plus un.** Le délai porte sur le temps *sans progression*, pas sur la durée
// totale, puisque le script réécrit l'horodatage à chaque étape. Un quart
// d'heure est large pour l'étape la plus lente (une compilation sur un petit
// conteneur) et court pour retrouver la main.

export type EtatMaj = 'inactif' | 'en_cours' | 'termine' | 'echec';

export interface StatutMaj {
  etat: EtatMaj;
  message?: string;
  /** Millisecondes depuis l'époque, réécrites à chaque étape du script. */
  ts?: number;
}

/** Temps sans progression au-delà duquel une mise à jour est tenue pour interrompue. */
export const SANS_NOUVELLES_MS = 15 * 60 * 1000;

/**
 * Compare deux versions `x.y.z`. Négatif si `a` précède `b`.
 *
 * Le `v` de tête est toléré des deux côtés : les tags GitHub le portent
 * presque toujours, `package.json` jamais, et comparer « v0.0.4 » à « 0.0.4 »
 * en texte donnerait une mise à jour disponible à chaque démarrage.
 */
export function comparer(a: string, b: string): number {
  const morceaux = (v: string): number[] =>
    v.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const [pa, pb] = [morceaux(a), morceaux(b)];
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/** `true` quand `candidate` est strictement postérieure à `installee`. */
export const estPlusRecente = (candidate: string, installee: string): boolean =>
  comparer(candidate, installee) > 0;

/**
 * L'état à servir à l'interface.
 *
 * Une mise à jour sans nouvelles est déclarée interrompue, avec le chemin du
 * journal : c'est la seule chose à lire pour savoir ce qui s'est passé, et
 * c'est ce qui rend le bouton à la famille.
 */
export function fraichir(
  statut: StatutMaj, maintenant: number, cheminJournal: string, sansNouvellesMs = SANS_NOUVELLES_MS,
): StatutMaj {
  if (statut.etat !== 'en_cours') return statut;
  // Un horodatage absent vient d'un format antérieur : la mise à jour qu'il
  // décrivait est de toute façon terminée depuis longtemps.
  const age = typeof statut.ts === 'number' ? maintenant - statut.ts : Infinity;
  if (age <= sansNouvellesMs) return statut;
  return {
    etat: 'echec',
    message: `Mise à jour interrompue : aucune progression depuis ${depuisLisible(age)}. `
      + `Le détail est dans ${cheminJournal}. Vous pouvez relancer depuis cet écran.`,
    ts: statut.ts,
  };
}

/** « 22 minutes », « 3 heures », « 6 jours ». Tout en minutes serait illisible. */
export function depuisLisible(ms: number): string {
  if (!Number.isFinite(ms)) return 'un long moment';
  const min = Math.round(ms / 60000);
  if (min < 120) return `${min} minute${min > 1 ? 's' : ''}`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} heures`;
  return `${Math.round(h / 24)} jours`;
}

/** Ce que le fichier d'état peut contenir de lisible, quoi qu'il porte réellement. */
export function lireStatut(brut: unknown): StatutMaj {
  const o = (brut ?? {}) as Record<string, unknown>;
  const etats: EtatMaj[] = ['inactif', 'en_cours', 'termine', 'echec'];
  const etat = etats.includes(o.etat as EtatMaj) ? (o.etat as EtatMaj) : 'inactif';
  return {
    etat,
    message: typeof o.message === 'string' ? o.message.slice(0, 500) : undefined,
    ts: typeof o.ts === 'number' && Number.isFinite(o.ts) ? o.ts : undefined,
  };
}
