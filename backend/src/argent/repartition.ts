// La répartition d'une dépense. Module PUR : aucune base, aucun HTTP.
//
// C'est de l'argent entre frères et soeurs : **un chiffre non justifiable est un
// chiffre contesté**. Ce module ne rend donc pas seulement des montants, il rend
// aussi la justification complète du calcul, dans la même passe. Les deux ne
// peuvent pas diverger, puisqu'ils sortent de la même fonction.
//
// Trois principes tiennent tout :
//
//   1. **Des centimes entiers, jamais de flottants.** `0,1 + 0,2` ne vaut pas
//      `0,3`, et une répartition à quatre se contesterait sur le centime.
//   2. **La somme des parts égale exactement le montant.** L'arrondi se fait au
//      plus fort reste, de façon déterministe : deux exécutions donnent le même
//      résultat, et les centimes résiduels vont aux plus grosses parts.
//   3. **Deux passes plutôt qu'une pondération savante.** Le montant est d'abord
//      réparti entre foyers, puis à l'intérieur de chaque foyer entre ses
//      détenteurs. C'est exact, et surtout c'est ce qu'on peut expliquer de vive
//      voix : « votre foyer a consommé 14 nuits sur 36, et vous en portez la
//      moitié avec Marc ».
import { dateLisible } from '../noyau/dates';

export type Regle = 'quotes_parts' | 'nuits' | 'parts_egales_foyer';

export const REGLES: readonly Regle[] = ['quotes_parts', 'nuits', 'parts_egales_foyer'];

export const LIBELLE_REGLE: Record<Regle, string> = {
  quotes_parts: 'Quotes-parts',
  nuits: 'Nuits occupées',
  parts_egales_foyer: 'Parts égales par foyer',
};

export interface Detenteur {
  personneId: number;
  nom: string;
  /** Null pour une personne sans foyer : elle forme alors son propre foyer. */
  foyerId: number | null;
  foyerNom: string | null;
  /** Ses parts à la date de la dépense. */
  parts: number;
}

export interface Entrees {
  montantCents: number;
  regle: Regle;
  /** La date de la dépense : c'est elle qui choisit les parts en vigueur. */
  dateDepense: string;
  detenteurs: readonly Detenteur[];
  /** Nuits consommées par foyer sur l'exercice, pour la règle « nuits ». */
  nuitsParFoyer?: ReadonlyMap<number, number>;
  /** Poids de ce dossier dans une dépense qui porte sur plusieurs biens. */
  poids?: { num: number; den: number };
  /** D'où vient la règle appliquée, pour que la justification puisse le dire. */
  source?: { regleId: number; applicableDu: string };
}

export interface Ligne { personneId: number; montantCents: number }

/** Une étape du calcul, telle qu'elle s'affiche dans l'explication. */
export interface Etape {
  titre: string;
  lignes: { libelle: string; cle: string; montant: number }[];
}

export interface Justification {
  regleDemandee: Regle;
  regleAppliquee: Regle;
  /** Renseigné quand la règle demandée n'était pas calculable. */
  repli?: string;
  dateReference: string;
  montantTotalCents: number;
  poids?: string;
  montantRepartiCents: number;
  methodeArrondi: string;
  source?: { regleId: number; applicableDu: string };
  etapes: Etape[];
  controle: string;
}

export interface Resultat { lignes: Ligne[]; justification: Justification }

export class RepartitionImpossible extends Error {}

/**
 * Répartit un montant entier selon des poids entiers, au plus fort reste.
 *
 * Chacun reçoit d'abord sa part entière, puis les centimes qui restent vont aux
 * plus forts restes. À reste égal, le plus gros poids l'emporte, puis la clé la
 * plus petite : le résultat ne dépend donc pas de l'ordre des données, et deux
 * calculs de la même dépense donnent la même chose.
 */
export function repartirEntier<T>(
  montant: number, poids: readonly { cle: T; poids: number; ordre: number }[],
): Map<T, number> {
  const out = new Map<T, number>();
  const total = poids.reduce((t, p) => t + p.poids, 0);
  if (total <= 0) throw new RepartitionImpossible('La somme des poids est nulle.');

  const restes: { cle: T; reste: number; poids: number; ordre: number }[] = [];
  let attribue = 0;
  for (const p of poids) {
    const exact = (montant * p.poids) / total;
    const entier = Math.floor(exact);
    out.set(p.cle, entier);
    attribue += entier;
    restes.push({ cle: p.cle, reste: exact - entier, poids: p.poids, ordre: p.ordre });
  }

  restes.sort((a, b) => b.reste - a.reste || b.poids - a.poids || a.ordre - b.ordre);
  for (let i = 0; i < montant - attribue; i++) {
    const r = restes[i % restes.length];
    out.set(r.cle, (out.get(r.cle) ?? 0) + 1);
  }
  return out;
}

/**
 * Un montant en euros, écrit à la française : virgule décimale et milliers
 * séparés. `Intl` produit une espace insécable étroite que certains clients de
 * messagerie affichent mal, d'où l'espace ordinaire.
 */
const euros = (cents: number): string => {
  const [entier, decimales] = Math.abs(cents / 100).toFixed(2).split('.');
  const groupe = entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${cents < 0 ? '-' : ''}${groupe},${decimales} €`;
};

/** Les foyers concernés, une personne sans foyer formant le sien. */
interface Foyer { id: string; nom: string; membres: Detenteur[]; parts: number }

function foyersDe(detenteurs: readonly Detenteur[]): Foyer[] {
  const parId = new Map<string, Foyer>();
  for (const d of detenteurs) {
    const id = d.foyerId === null ? `p${d.personneId}` : `f${d.foyerId}`;
    const existant = parId.get(id);
    if (existant) { existant.membres.push(d); existant.parts += d.parts; continue; }
    parId.set(id, { id, nom: d.foyerNom ?? d.nom, membres: [d], parts: d.parts });
  }
  // Ordre stable : par identifiant de foyer, puis par personne à l'intérieur.
  // L'ordre des données entrantes ne doit jamais changer un centime.
  const foyers = [...parId.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const f of foyers) f.membres.sort((a, b) => a.personneId - b.personneId);
  return foyers;
}

/**
 * Le calcul complet. Rend les montants **et** leur justification.
 *
 * Un repli est possible et **toujours dit** : une règle « nuits occupées » sur
 * une année où personne n'est venu diviserait par zéro. Plutôt que d'échouer ou
 * de rendre zéro, on retombe sur les quotes-parts et on l'écrit dans la
 * justification, où la personne qui conteste le lira.
 */
export function repartir(e: Entrees): Resultat {
  if (!Number.isInteger(e.montantCents) || e.montantCents <= 0) {
    throw new RepartitionImpossible('Le montant doit être un nombre entier de centimes, strictement positif.');
  }
  if (!e.detenteurs.length) {
    throw new RepartitionImpossible(
      "Aucune répartition n'est saisie à cette date : renseignez les quotes-parts avant d'enregistrer une dépense.",
    );
  }

  const poids = e.poids ?? { num: 1, den: 1 };
  const montant = poids.num === poids.den
    ? e.montantCents
    : Math.round((e.montantCents * poids.num) / poids.den);

  // L'ordre d'entrée ne doit jamais changer un centime : à reste égal, c'est
  // l'identifiant de la personne qui départage, et il est stable. Trier ici
  // rend aussi la justification stockée reproductible, ce qui compte le jour
  // où quelqu'un compare deux impressions du même calcul.
  const detenteurs = [...e.detenteurs].sort((a, b) => a.personneId - b.personneId);
  const foyers = foyersDe(detenteurs);
  let regle = e.regle;
  let repli: string | undefined;

  if (regle === 'nuits') {
    const total = foyers.reduce((t, f) => t + nuitsDuFoyer(f, e.nuitsParFoyer), 0);
    if (total <= 0) {
      regle = 'quotes_parts';
      repli = "Aucune nuit n'a été consommée sur l'exercice : la répartition retombe sur les quotes-parts.";
    }
  }
  if (regle === 'parts_egales_foyer' && foyers.length === 1) {
    regle = 'quotes_parts';
    repli = 'Un seul foyer est concerné : la répartition retombe sur les quotes-parts.';
  }

  const etapes: Etape[] = [];
  const lignes = regle === 'quotes_parts'
    ? parQuotesParts(montant, detenteurs, etapes)
    : parFoyer(montant, foyers, regle, e.nuitsParFoyer, etapes);

  const somme = [...lignes.values()].reduce((t, v) => t + v, 0);
  if (somme !== montant) {
    // Une invariante violée ici serait un centime qui disparaît. Mieux vaut
    // refuser que d'enregistrer une ventilation qui ne tombe pas juste.
    throw new RepartitionImpossible(`Erreur interne de répartition : ${somme} centimes répartis pour ${montant} attendus.`);
  }

  return {
    lignes: [...lignes.entries()].map(([personneId, montantCents]) => ({ personneId, montantCents }))
      .sort((a, b) => a.personneId - b.personneId),
    justification: {
      regleDemandee: e.regle,
      regleAppliquee: regle,
      repli,
      dateReference: e.dateDepense,
      montantTotalCents: e.montantCents,
      poids: poids.num === poids.den ? undefined : `${poids.num}/${poids.den}`,
      montantRepartiCents: montant,
      methodeArrondi: 'plus fort reste',
      source: e.source,
      etapes,
      controle: `La somme des parts vaut ${euros(somme)}, soit exactement le montant réparti.`,
    },
  };
}

/**
 * Les nuits d'un foyer sur l'exercice.
 *
 * Une personne sans foyer forme le sien, sous l'identifiant « p<id> » : elle
 * n'apparaît pas dans le décompte des nuits, qui se tient par foyer. Ses nuits
 * valent donc zéro, ce qui est exact tant qu'elle n'est rattachée à aucun foyer.
 */
const nuitsDuFoyer = (f: Foyer, nuits?: ReadonlyMap<number, number>): number =>
  (nuits && f.id.startsWith('f') ? nuits.get(Number(f.id.slice(1))) ?? 0 : 0);

function parQuotesParts(montant: number, detenteurs: readonly Detenteur[], etapes: Etape[]): Map<number, number> {
  const total = detenteurs.reduce((t, d) => t + d.parts, 0);
  const parts = repartirEntier(montant, detenteurs.map((d) => ({ cle: d.personneId, poids: d.parts, ordre: d.personneId })));
  etapes.push({
    titre: 'Répartition selon les quotes-parts en vigueur à la date de la dépense',
    lignes: detenteurs.map((d) => ({
      libelle: d.nom,
      cle: `${d.parts} / ${total}`,
      montant: parts.get(d.personneId) ?? 0,
    })),
  });
  return parts;
}

function parFoyer(
  montant: number, foyers: readonly Foyer[], regle: Regle,
  nuits: ReadonlyMap<number, number> | undefined, etapes: Etape[],
): Map<number, number> {
  const poidsFoyer = foyers.map((f, i) => ({
    cle: f.id,
    poids: regle === 'nuits' ? nuitsDuFoyer(f, nuits) : 1,
    // Les foyers sont déjà triés par identifiant : l'indice est donc stable.
    ordre: i,
  }));
  const parFoyerId = repartirEntier(montant, poidsFoyer);

  const totalPoids = poidsFoyer.reduce((t, p) => t + p.poids, 0);
  etapes.push({
    titre: regle === 'nuits'
      ? "Répartition entre foyers, selon les nuits consommées sur l'exercice"
      : 'Répartition à parts égales entre les foyers concernés',
    lignes: foyers.map((f) => ({
      libelle: f.nom,
      cle: regle === 'nuits' ? `${nuitsDuFoyer(f, nuits)} nuits sur ${totalPoids}` : `1 foyer sur ${foyers.length}`,
      montant: parFoyerId.get(f.id) ?? 0,
    })),
  });

  const out = new Map<number, number>();
  const detail: Etape['lignes'] = [];
  for (const f of foyers) {
    const du = parFoyerId.get(f.id) ?? 0;
    if (f.membres.length === 1) {
      out.set(f.membres[0].personneId, du);
      continue;
    }
    // Plusieurs détenteurs dans le même foyer : la part du foyer se répartit
    // entre eux au prorata de leurs propres parts. Le foyer est l'unité de
    // consommation, la personne reste l'unité de détention.
    const entre = repartirEntier(du, f.membres.map((m) => ({ cle: m.personneId, poids: m.parts, ordre: m.personneId })));
    for (const m of f.membres) {
      out.set(m.personneId, entre.get(m.personneId) ?? 0);
      detail.push({ libelle: `${m.nom} (${f.nom})`, cle: `${m.parts} / ${f.parts}`, montant: entre.get(m.personneId) ?? 0 });
    }
  }
  if (detail.length) {
    etapes.push({ titre: 'Répartition à l\'intérieur des foyers, au prorata des parts', lignes: detail });
  }
  return out;
}

/** L'explication en texte, telle qu'elle se lit à l'écran et à voix haute. */
export function expliquer(j: Justification): string[] {
  const out: string[] = [];
  out.push(`Règle appliquée : ${LIBELLE_REGLE[j.regleAppliquee]}.`);
  if (j.repli) out.push(j.repli);
  if (j.source) out.push(`Cette règle s'applique depuis le ${dateLisible(j.source.applicableDu)}.`);
  out.push(`Parts en vigueur à la date de la dépense, le ${dateLisible(j.dateReference)}.`);
  if (j.poids) {
    out.push(`Cette dépense porte sur plusieurs dossiers : ${j.poids} de ${euros(j.montantTotalCents)}, `
      + `soit ${euros(j.montantRepartiCents)} pour celui-ci.`);
  }
  for (const e of j.etapes) {
    out.push(`${e.titre} :`);
    for (const l of e.lignes) out.push(`  ${l.libelle} (${l.cle}) : ${euros(l.montant)}`);
  }
  out.push(`Arrondi au ${j.methodeArrondi}. ${j.controle}`);
  return out;
}

// ---------------------------------------------------------------------------
// Une dépense qui porte sur plusieurs biens d'une même structure
// ---------------------------------------------------------------------------

export interface PartBien {
  bienId: number;
  bienNom: string;
  /** Le poids de ce bien dans la dépense : deux biens à 1/2, trois à 1/3. */
  poidsNum: number;
  poidsDen: number;
  /** La règle en vigueur pour ce bien et cette catégorie, à la date de la dépense. */
  regle: Regle;
  source?: { regleId: number; applicableDu: string };
  /** Nuits consommées par foyer sur ce bien, pour la règle « nuits ». */
  nuitsParFoyer?: ReadonlyMap<number, number>;
}

/**
 * Répartit une dépense qui porte sur plusieurs biens.
 *
 * Chaque bien a sa propre règle de répartition : l'énergie peut suivre les
 * nuits sur la maison de mer et les quotes-parts sur l'appartement de montagne.
 * Le montant est donc d'abord découpé entre les biens selon leurs poids, puis
 * chaque morceau est réparti selon la règle de son bien.
 *
 * Le découpage entre biens se fait aussi au plus fort reste : sans cela, deux
 * arrondis successifs feraient disparaître un centime, et la somme des parts
 * ne vaudrait plus le montant de la dépense.
 */
export function repartirSurBiens(
  montantCents: number, dateDepense: string, detenteurs: readonly Detenteur[], biens: readonly PartBien[],
): Resultat {
  if (!biens.length) throw new RepartitionImpossible('Cette dépense n\'est rattachée à aucun bien.');
  if (biens.length === 1) {
    const b = biens[0];
    return repartir({
      montantCents, regle: b.regle, dateDepense, detenteurs,
      nuitsParFoyer: b.nuitsParFoyer, source: b.source,
      poids: { num: b.poidsNum, den: b.poidsDen },
    });
  }

  const parBien = repartirEntier(montantCents, biens.map((b) => ({
    cle: b.bienId, poids: Math.round((b.poidsNum * 1_000_000) / b.poidsDen), ordre: b.bienId,
  })));

  const cumul = new Map<number, number>();
  const etapes: Etape[] = [{
    titre: 'Découpage entre les biens concernés',
    lignes: biens.map((b) => ({
      libelle: b.bienNom, cle: `${b.poidsNum}/${b.poidsDen}`, montant: parBien.get(b.bienId) ?? 0,
    })),
  }];

  for (const b of biens) {
    const part = parBien.get(b.bienId) ?? 0;
    if (part <= 0) continue;
    const r = repartir({
      montantCents: part, regle: b.regle, dateDepense, detenteurs,
      nuitsParFoyer: b.nuitsParFoyer, source: b.source,
    });
    for (const l of r.lignes) cumul.set(l.personneId, (cumul.get(l.personneId) ?? 0) + l.montantCents);
    for (const e of r.justification.etapes) etapes.push({ ...e, titre: `${b.bienNom} : ${e.titre.toLowerCase()}` });
    if (r.justification.repli) {
      etapes.push({ titre: `${b.bienNom} : repli`, lignes: [{ libelle: r.justification.repli, cle: '', montant: 0 }] });
    }
  }

  const somme = [...cumul.values()].reduce((t, v) => t + v, 0);
  if (somme !== montantCents) {
    throw new RepartitionImpossible(`Erreur interne de répartition : ${somme} centimes répartis pour ${montantCents} attendus.`);
  }

  return {
    lignes: [...cumul.entries()].map(([personneId, montant]) => ({ personneId, montantCents: montant }))
      .sort((a, b) => a.personneId - b.personneId),
    justification: {
      regleDemandee: biens[0].regle,
      regleAppliquee: biens[0].regle,
      dateReference: dateDepense,
      montantTotalCents: montantCents,
      montantRepartiCents: montantCents,
      methodeArrondi: 'plus fort reste',
      etapes,
      controle: `La somme des parts vaut ${euros(somme)}, soit exactement le montant réparti.`,
    },
  };
}
