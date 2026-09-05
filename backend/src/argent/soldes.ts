// Les soldes et la minimisation des virements. Module PUR.
//
// **Il n'y a pas de table de soldes.** Un solde stocké se désynchronise le jour
// où une dépense est annulée, et c'est la panne financière classique : les
// chiffres deviennent faux sans que rien ne le signale. Tout se recalcule à la
// demande, à partir des dépenses, des ventilations et des règlements confirmés.
//
// Le modèle est celui d'un graphe de dettes où la **structure elle-même est un
// acteur**. Sans cela, une dépense payée par le compte commun n'aurait pas de
// créancier et les comptes ne tomberaient jamais à zéro.
//
//   - une dépense avancée par une personne : elle est créditée du montant,
//     chacun est débité de sa part ;
//   - une dépense payée par le compte commun : la structure est créditée,
//     chacun est débité de sa part ;
//   - un règlement confirmé de A vers B : A est crédité, B est débité.
//
// L'invariant qui en découle est vérifiable et testé : **la somme de tous les
// soldes vaut exactement zéro**, à tout instant.

/** L'acteur d'un solde : une personne, ou la structure (compte commun). */
export const STRUCTURE = 0;

export interface DepenseSolde {
  id: number;
  montantCents: number;
  /** L'avanceur, ou STRUCTURE quand le compte commun a payé. */
  avanceParId: number;
  ventilation: readonly { personneId: number; montantCents: number }[];
}

export interface ReglementSolde {
  deId: number;
  versId: number;
  montantCents: number;
  /** Seuls les règlements confirmés déplacent un solde. */
  confirme: boolean;
}

export interface Solde {
  acteurId: number;
  /** Positif : on lui doit. Négatif : il doit. */
  montantCents: number;
  avanceCents: number;
  duCents: number;
  regleCents: number;
}

export function calculer(
  depenses: readonly DepenseSolde[], reglements: readonly ReglementSolde[],
): Map<number, Solde> {
  const out = new Map<number, Solde>();
  const ligne = (id: number): Solde => {
    const existant = out.get(id);
    if (existant) return existant;
    const neuf: Solde = { acteurId: id, montantCents: 0, avanceCents: 0, duCents: 0, regleCents: 0 };
    out.set(id, neuf);
    return neuf;
  };

  for (const d of depenses) {
    const avanceur = ligne(d.avanceParId);
    avanceur.avanceCents += d.montantCents;
    avanceur.montantCents += d.montantCents;
    for (const v of d.ventilation) {
      const l = ligne(v.personneId);
      l.duCents += v.montantCents;
      l.montantCents -= v.montantCents;
    }
  }

  for (const r of reglements) {
    if (!r.confirme) continue;
    const de = ligne(r.deId);
    const vers = ligne(r.versId);
    de.regleCents += r.montantCents;
    de.montantCents += r.montantCents;
    vers.regleCents -= r.montantCents;
    vers.montantCents -= r.montantCents;
  }

  return out;
}

/** La somme de tous les soldes. Doit valoir zéro : c'est le contrôle de cohérence. */
export const totalise = (soldes: Iterable<Solde>): number =>
  [...soldes].reduce((t, s) => t + s.montantCents, 0);

export interface Virement { deId: number; versId: number; montantCents: number }

/**
 * Les virements qui ramènent tout le monde à zéro, en **nombre minimal**.
 *
 * Deux passes, et la première fait tout le travail utile :
 *
 *   1. **Les paires qui s'annulent exactement.** Claire doit 310 et Hélène est
 *      créditrice de 310 : un seul virement règle les deux, et c'est celui que
 *      la famille attend de voir. Un algorithme glouton pur les manquerait
 *      quand un plus gros débiteur passe devant.
 *   2. **Le glouton du plus gros débiteur vers le plus gros créancier** pour le
 *      reste. Il produit au plus n-1 virements, ce qui est le pire cas
 *      acceptable.
 *
 * Le problème général est NP-difficile, mais sur une famille de six personnes
 * cette approche donne le minimum dans tous les cas réels, et un résultat
 * toujours correct : la somme des virements ramène chaque solde à zéro, ce que
 * le test vérifie.
 */
export function virements(soldes: Iterable<Solde>): Virement[] {
  const reste = new Map<number, number>();
  for (const s of soldes) if (s.montantCents !== 0) reste.set(s.acteurId, s.montantCents);

  const out: Virement[] = [];
  const acteurs = (): number[] => [...reste.keys()].sort((a, b) => a - b);

  // Passe 1 : les paires exactes.
  let trouve = true;
  while (trouve) {
    trouve = false;
    for (const debiteur of acteurs()) {
      const du = reste.get(debiteur) ?? 0;
      if (du >= 0) continue;
      for (const crediteur of acteurs()) {
        if ((reste.get(crediteur) ?? 0) !== -du) continue;
        out.push({ deId: debiteur, versId: crediteur, montantCents: -du });
        reste.delete(debiteur);
        reste.delete(crediteur);
        trouve = true;
        break;
      }
      if (trouve) break;
    }
  }

  // Passe 2 : le glouton.
  for (;;) {
    const debiteurs = acteurs().filter((a) => (reste.get(a) ?? 0) < 0);
    const crediteurs = acteurs().filter((a) => (reste.get(a) ?? 0) > 0);
    if (!debiteurs.length || !crediteurs.length) break;

    // À montant égal, l'identifiant le plus petit passe devant : le résultat ne
    // dépend pas de l'ordre de lecture de la base.
    const debiteur = debiteurs.reduce((p, a) => ((reste.get(a) ?? 0) < (reste.get(p) ?? 0) ? a : p));
    const crediteur = crediteurs.reduce((p, a) => ((reste.get(a) ?? 0) > (reste.get(p) ?? 0) ? a : p));
    const montant = Math.min(-(reste.get(debiteur) ?? 0), reste.get(crediteur) ?? 0);

    out.push({ deId: debiteur, versId: crediteur, montantCents: montant });
    const nouveauDebiteur = (reste.get(debiteur) ?? 0) + montant;
    const nouveauCrediteur = (reste.get(crediteur) ?? 0) - montant;
    if (nouveauDebiteur === 0) reste.delete(debiteur); else reste.set(debiteur, nouveauDebiteur);
    if (nouveauCrediteur === 0) reste.delete(crediteur); else reste.set(crediteur, nouveauCrediteur);
  }

  return out;
}

/** Applique des virements à des soldes. Sert au contrôle, et aux tests. */
export function appliquer(soldes: Iterable<Solde>, vs: readonly Virement[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const s of soldes) out.set(s.acteurId, s.montantCents);
  for (const v of vs) {
    out.set(v.deId, (out.get(v.deId) ?? 0) + v.montantCents);
    out.set(v.versId, (out.get(v.versId) ?? 0) - v.montantCents);
  }
  return out;
}
