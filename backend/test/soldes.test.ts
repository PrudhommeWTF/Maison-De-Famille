// Les soldes et la minimisation des virements.
//
// Deux invariants gouvernent tout, et les tests les vérifient sur des cas
// construits comme sur des cas tirés au hasard :
//
//   1. la somme de tous les soldes vaut exactement zéro ;
//   2. appliquer les virements proposés ramène chacun à zéro.
//
// Sans le premier, les comptes ne tombent jamais juste et personne ne sait
// pourquoi. Sans le second, l'écran des soldes propose des virements qui ne
// règlent rien.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DepenseSolde, ReglementSolde, STRUCTURE, Solde, appliquer, calculer, totalise, virements,
} from '../src/argent/soldes';

const HELENE = 1, CLAIRE = 2, THOMAS = 3, JULIEN = 4;

/** Une dépense répartie à parts égales entre les personnes citées. */
const depense = (id: number, montant: number, avanceParId: number, entre: number[]): DepenseSolde => {
  const base = Math.floor(montant / entre.length);
  const reste = montant - base * entre.length;
  return {
    id, montantCents: montant, avanceParId,
    ventilation: entre.map((personneId, i) => ({ personneId, montantCents: base + (i < reste ? 1 : 0) })),
  };
};

const solde = (soldes: Map<number, Solde>, id: number): number => soldes.get(id)?.montantCents ?? 0;

test('une avance rend son auteur créancier, les autres débiteurs', () => {
  // Hélène avance 2 340 € de taxe foncière, réparti à quatre.
  const s = calculer([depense(1, 234000, HELENE, [HELENE, CLAIRE, THOMAS, JULIEN])], []);
  assert.equal(solde(s, HELENE), 234000 - 58500, 'elle a avancé, moins sa propre part');
  assert.equal(solde(s, CLAIRE), -58500);
  assert.equal(totalise(s.values()), 0);
});

test('une dépense payée par le compte commun fait de la structure le créancier', () => {
  // Sans cet acteur, la dépense n'aurait pas de créancier et les comptes ne
  // tomberaient jamais à zéro.
  const s = calculer([depense(1, 40000, STRUCTURE, [HELENE, CLAIRE, THOMAS, JULIEN])], []);
  assert.equal(solde(s, STRUCTURE), 40000);
  assert.equal(solde(s, HELENE), -10000);
  assert.equal(totalise(s.values()), 0);
});

test('un règlement confirmé déplace le solde, un règlement annoncé non', () => {
  const d = [depense(1, 40000, HELENE, [HELENE, CLAIRE])];
  const annonce: ReglementSolde = { deId: CLAIRE, versId: HELENE, montantCents: 20000, confirme: false };
  const confirme: ReglementSolde = { ...annonce, confirme: true };

  const avant = calculer(d, [annonce]);
  assert.equal(solde(avant, CLAIRE), -20000, "un virement annoncé n'est pas encore un virement reçu");

  const apres = calculer(d, [confirme]);
  assert.equal(solde(apres, CLAIRE), 0);
  assert.equal(solde(apres, HELENE), 0);
  assert.equal(totalise(apres.values()), 0);
});

test('la somme des soldes vaut toujours zéro, quel que soit le scénario', () => {
  const s = calculer([
    depense(1, 234000, HELENE, [HELENE, CLAIRE, THOMAS, JULIEN]),
    depense(2, 116000, HELENE, [HELENE, CLAIRE, THOMAS, JULIEN]),
    depense(3, 78000, THOMAS, [THOMAS, CLAIRE]),
    depense(4, 42000, STRUCTURE, [HELENE, CLAIRE, THOMAS, JULIEN]),
    depense(5, 10001, JULIEN, [HELENE, CLAIRE, THOMAS]),
  ], [
    { deId: CLAIRE, versId: HELENE, montantCents: 31000, confirme: true },
    { deId: JULIEN, versId: HELENE, montantCents: 31000, confirme: false },
  ]);
  assert.equal(totalise(s.values()), 0);
});

// ------------------------------------------------------------------
// Minimisation des virements
// ------------------------------------------------------------------

const soldesDe = (m: Record<number, number>): Solde[] =>
  Object.entries(m).map(([id, montant]) => ({
    acteurId: Number(id), montantCents: montant, avanceCents: 0, duCents: 0, regleCents: 0,
  }));

/** Après application, tout le monde doit être à zéro. */
function verifie(soldes: Solde[]): { vs: ReturnType<typeof virements>; final: Map<number, number> } {
  const vs = virements(soldes);
  const final = appliquer(soldes, vs);
  for (const [id, montant] of final) assert.equal(montant, 0, `l'acteur ${id} n'est pas à zéro`);
  return { vs, final };
}

test('une paire qui s\'annule exactement donne un seul virement', () => {
  // C'est le cas que la famille attend de voir : « Claire doit 310 à Hélène ».
  const { vs } = verifie(soldesDe({ [HELENE]: 31000, [CLAIRE]: -31000 }));
  assert.deepEqual(vs, [{ deId: CLAIRE, versId: HELENE, montantCents: 31000 }]);
});

test('les paires exactes sont trouvées même derrière un plus gros débiteur', () => {
  // Un glouton pur enverrait d'abord Thomas vers Hélène et casserait la paire
  // Claire-Julien, produisant trois virements au lieu de deux.
  const { vs } = verifie(soldesDe({
    [HELENE]: 62000, [THOMAS]: -62000, [CLAIRE]: -31000, [JULIEN]: 31000,
  }));
  assert.equal(vs.length, 2);
});

test('le cas de la maquette : trois débiteurs vers une créancière', () => {
  const { vs } = verifie(soldesDe({
    [HELENE]: 124000, [THOMAS]: -62000, [CLAIRE]: -31000, [JULIEN]: -31000,
  }));
  assert.equal(vs.length, 3, 'au plus n-1 virements');
  assert.ok(vs.every((v) => v.versId === HELENE));
  assert.equal(vs.reduce((t, v) => t + v.montantCents, 0), 124000);
});

test('un solde nul ne produit aucun virement', () => {
  const { vs } = verifie(soldesDe({ [HELENE]: 0, [CLAIRE]: 0 }));
  assert.deepEqual(vs, []);
  assert.deepEqual(virements([]), []);
});

test('la structure participe aux virements comme les personnes', () => {
  // Une SCI : elle a payé 420 € de charges depuis son compte, et Thomas a
  // avancé 480 € de literie. Les soldes sont ceux que produirait « calculer ».
  const soldes = calculer([
    { id: 1, montantCents: 42000, avanceParId: STRUCTURE, ventilation: [
      { personneId: THOMAS, montantCents: 16800 },
      { personneId: CLAIRE, montantCents: 12600 },
      { personneId: JULIEN, montantCents: 12600 },
    ] },
    { id: 2, montantCents: 48000, avanceParId: THOMAS, ventilation: [
      { personneId: THOMAS, montantCents: 19200 },
      { personneId: CLAIRE, montantCents: 14400 },
      { personneId: JULIEN, montantCents: 14400 },
    ] },
  ], []);
  assert.equal(totalise(soldes.values()), 0);
  assert.equal(soldes.get(STRUCTURE)?.montantCents, 42000, 'la SCI a avancé ses charges');
  assert.equal(soldes.get(THOMAS)?.montantCents, 12000);

  const { vs } = verifie([...soldes.values()]);
  assert.ok(vs.length <= 3, 'au plus n-1 virements');
  // La structure reçoit : c'est l'appel de fonds. Thomas reçoit : c'est le
  // remboursement de ses frais avancés. Le vocabulaire suit la structure.
  assert.ok(vs.some((v) => v.versId === STRUCTURE));
  assert.ok(vs.some((v) => v.versId === THOMAS));
});

test('le nombre de virements ne dépasse jamais le nombre d\'acteurs moins un', () => {
  // Un balayage aléatoire, reproductible : le générateur est déterministe.
  let graine = 42;
  const tirage = (max: number): number => {
    graine = (graine * 1103515245 + 12345) % 2147483648;
    return graine % max;
  };
  for (let essai = 0; essai < 300; essai++) {
    const n = 2 + tirage(6);
    const montants: Record<number, number> = {};
    let cumul = 0;
    for (let i = 1; i < n; i++) {
      const m = tirage(200001) - 100000;
      montants[i] = m;
      cumul += m;
    }
    montants[n] = -cumul;                       // la somme vaut zéro, par construction
    const soldes = soldesDe(montants).filter((s) => s.montantCents !== 0);
    if (!soldes.length) continue;
    const { vs } = verifie(soldes);
    assert.ok(vs.length <= soldes.length - 1,
      `${vs.length} virements pour ${soldes.length} acteurs (essai ${essai})`);
  }
});

test('aucun virement ne porte un montant nul ou négatif', () => {
  const soldes = soldesDe({ [HELENE]: 100000, [CLAIRE]: -33333, [THOMAS]: -33333, [JULIEN]: -33334 });
  const { vs } = verifie(soldes);
  for (const v of vs) {
    assert.ok(v.montantCents > 0, 'un virement de zéro euro n\'a rien à faire dans la liste');
    assert.notEqual(v.deId, v.versId);
  }
});

test('le résultat ne dépend pas de l\'ordre des soldes', () => {
  const m = { [HELENE]: 124000, [THOMAS]: -62000, [CLAIRE]: -31000, [JULIEN]: -31000 };
  const a = virements(soldesDe(m));
  const b = virements(soldesDe(m).reverse());
  assert.deepEqual(a, b);
});
