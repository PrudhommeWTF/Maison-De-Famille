// Les détentions dans le temps. Module PUR : aucune base, aucun HTTP.
//
// C'est le point de modélisation le plus important du projet, et celui qu'il ne
// faut surtout pas simplifier.
//
// **Une quote-part n'est pas une valeur, c'est un intervalle.** Une succession,
// une donation, un rachat de parts entre frères et soeurs modifient la
// répartition à une date donnée. Si la quote-part était une simple valeur
// courante, toutes les répartitions passées deviendraient fausses le jour où
// elle change, et la première contestation détruirait la confiance dans l'outil.
//
// **Les parts sont des entiers, la quote-part est dérivée.** La quote-part de
// Thomas au 12 mars vaut « ses parts ce jour-là / la somme des parts en vigueur
// ce jour-là ». Stocker « 25 % » obligerait à choisir un arrondi dès la saisie ;
// stocker 1 sur 4 permet une répartition exacte au centime. Une indivision à
// parts égales entre quatre s'écrit 1, 1, 1, 1. Une SCI de 300 parts s'écrit
// 120, 90, 90.

export interface LigneDetention {
  id?: number;
  personneId: number;
  parts: number;
  effetDu: string;
  effetAu: string | null;
  motif?: string;
}

/** Une répartition à une date : qui détient combien, et sur quel total. */
export interface Repartition {
  date: string;
  total: number;
  parts: Map<number, number>;
}

const enVigueur = (l: LigneDetention, date: string): boolean =>
  l.effetDu <= date && (l.effetAu === null || date < l.effetAu);

/**
 * La répartition en vigueur à une date. **C'est la fonction pivot** : toute
 * ventilation de dépense, tout poids de vote et tout appel de fonds passe par
 * elle, et aucun code ne lit les détentions autrement.
 */
export function partsALaDate(lignes: readonly LigneDetention[], date: string): Repartition {
  const parts = new Map<number, number>();
  let total = 0;
  for (const l of lignes) {
    if (!enVigueur(l, date)) continue;
    // Plusieurs lignes pour la même personne à la même date ne devraient pas
    // exister (l'invariant le vérifie), mais si cela arrivait, additionner est
    // moins faux que d'en perdre une silencieusement.
    parts.set(l.personneId, (parts.get(l.personneId) ?? 0) + l.parts);
    total += l.parts;
  }
  return { date, total, parts };
}

/** La quote-part d'une personne, en fraction exacte. Zéro sur zéro rend zéro. */
export function quotePart(r: Repartition, personneId: number): { num: number; den: number } {
  return { num: r.parts.get(personneId) ?? 0, den: r.total || 1 };
}

/** Le libellé affiché d'une quote-part, arrondi au centième de point. */
export function quotePartLisible(r: Repartition, personneId: number): string {
  if (!r.total) return '0 %';
  const pct = ((r.parts.get(personneId) ?? 0) * 100) / r.total;
  const arrondi = Math.round(pct * 100) / 100;
  return `${String(arrondi).replace('.', ',')} %`;
}

export interface Anomalie { personneId: number; message: string }

/**
 * Les invariants que SQLite ne sait pas exprimer (il n'a pas de contrainte
 * d'exclusion sur des intervalles). Vérifiés à chaque écriture et testés en CI.
 *
 *   1. Pour une même personne, deux périodes ne se chevauchent pas.
 *   2. Une période fermée finit après son début. (Déjà en CHECK, revérifié ici
 *      pour que le message soit compréhensible.)
 */
export function anomalies(lignes: readonly LigneDetention[]): Anomalie[] {
  const out: Anomalie[] = [];
  const parPersonne = new Map<number, LigneDetention[]>();
  for (const l of lignes) {
    const v = parPersonne.get(l.personneId);
    if (v) v.push(l); else parPersonne.set(l.personneId, [l]);
  }
  for (const [personneId, ses] of parPersonne) {
    const triees = [...ses].sort((a, b) => a.effetDu.localeCompare(b.effetDu));
    for (let i = 0; i < triees.length; i++) {
      const a = triees[i];
      if (a.effetAu !== null && a.effetAu <= a.effetDu) {
        out.push({ personneId, message: `Une période finit le ${a.effetAu}, avant ou le jour de son début le ${a.effetDu}.` });
      }
      const b = triees[i + 1];
      if (b && (a.effetAu === null || a.effetAu > b.effetDu)) {
        out.push({ personneId, message: `Deux périodes de détention se chevauchent à partir du ${b.effetDu}.` });
      }
    }
  }
  return out;
}

/**
 * Ce qui empêche d'appliquer un changement. Distincte d'une erreur ordinaire
 * parce que son message est destiné à la gérante et doit dire quoi faire, pas
 * seulement ce qui ne va pas.
 */
export class ChangementImpossible extends Error {}

export interface Changement {
  /** Les lignes à fermer, avec la date de fin à poser. */
  aFermer: { id: number; effetAu: string }[];
  /** Les lignes à créer. */
  aCreer: LigneDetention[];
}

/**
 * Le changement à appliquer pour qu'à partir de `dateEffet`, la répartition soit
 * exactement `nouvelles`.
 *
 * Rien n'est écrasé : les lignes en vigueur sont **fermées** à la date d'effet
 * et de nouvelles sont ouvertes. Une dépense antérieure continue donc de se
 * répartir avec les parts d'alors, ce qui est toute la raison d'être de cette
 * fonction.
 *
 * Une personne absente de `nouvelles` sort de la structure : sa ligne est
 * fermée, aucune n'est rouverte. Rien n'est supprimé, elle reste dans
 * l'historique et dans les ventilations passées.
 *
 * Une ligne dont les parts ne changent pas est laissée telle quelle : inutile de
 * fabriquer une coupure dans l'historique pour un changement qui n'en est pas un.
 */
export function preparerChangement(
  lignes: readonly LigneDetention[], nouvelles: ReadonlyMap<number, number>, dateEffet: string, motif: string,
): Changement {
  if (!nouvelles.size) {
    throw new ChangementImpossible('Une répartition ne peut pas être vide : indiquez au moins une personne et ses parts.');
  }
  // Une modification antérieure à une répartition déjà saisie est ambiguë :
  // remplace-t-elle ce qui suit, ou s'insère-t-elle avant ? Deviner produirait
  // un historique faux sans que personne ne s'en aperçoive, et c'est
  // exactement ce qu'on ne veut pas sur des quotes-parts. On refuse, en disant
  // quoi faire.
  const posterieures = lignes.filter((l) => l.effetDu > dateEffet);
  if (posterieures.length) {
    const premiere = posterieures.map((l) => l.effetDu).sort()[0];
    throw new ChangementImpossible(
      `Une répartition existe déjà à partir du ${premiere}, postérieure à la date d'effet demandée (${dateEffet}). ` +
      'Corrigez d\'abord la répartition la plus récente, ou choisissez une date d\'effet postérieure.',
    );
  }
  const courantes = lignes.filter((l) => enVigueur(l, dateEffet));
  const aFermer: Changement['aFermer'] = [];
  const aCreer: LigneDetention[] = [];

  for (const l of courantes) {
    const voulu = nouvelles.get(l.personneId);
    if (voulu === l.parts) continue;                       // inchangé : on ne touche à rien
    if (l.id === undefined) throw new ChangementImpossible('Une ligne de détention à fermer doit porter son identifiant.');
    aFermer.push({ id: l.id, effetAu: dateEffet });
  }

  const inchangees = new Set(
    courantes.filter((l) => nouvelles.get(l.personneId) === l.parts).map((l) => l.personneId),
  );
  for (const [personneId, parts] of nouvelles) {
    if (!Number.isInteger(parts) || parts <= 0) {
      throw new ChangementImpossible(`Les parts doivent être des nombres entiers strictement positifs (personne ${personneId}).`);
    }
    if (inchangees.has(personneId)) continue;
    aCreer.push({ personneId, parts, effetDu: dateEffet, effetAu: null, motif });
  }

  return { aFermer, aCreer };
}
