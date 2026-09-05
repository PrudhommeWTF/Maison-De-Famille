// La répartition d'une dépense.
//
// C'est de l'argent entre frères et soeurs : ces tests portent autant sur
// l'exactitude au centime que sur la **justification**, parce qu'un chiffre non
// justifiable est un chiffre contesté.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Detenteur, RepartitionImpossible, expliquer, repartir, repartirEntier, repartirSurBiens,
} from '../src/argent/repartition';

const HELENE = 1, CLAIRE = 2, THOMAS = 3, JULIEN = 4, MARC = 5;

/** L'indivision de Kerloc'h : quatre parts égales, Claire et Marc dans un foyer. */
const INDIVISION: Detenteur[] = [
  { personneId: HELENE, nom: 'Hélène', foyerId: 1, foyerNom: 'Hélène', parts: 1 },
  { personneId: CLAIRE, nom: 'Claire', foyerId: 2, foyerNom: 'Claire et Marc', parts: 1 },
  { personneId: THOMAS, nom: 'Thomas', foyerId: 3, foyerNom: 'Thomas', parts: 1 },
  { personneId: JULIEN, nom: 'Julien', foyerId: 4, foyerNom: 'Julien et Sofia', parts: 1 },
];

const somme = (l: readonly { montantCents: number }[]): number => l.reduce((t, x) => t + x.montantCents, 0);
const du = (r: { lignes: { personneId: number; montantCents: number }[] }, id: number): number =>
  r.lignes.find((l) => l.personneId === id)?.montantCents ?? 0;

test('une taxe foncière se répartit selon les quotes-parts', () => {
  // 2 340 € à quatre parts égales : 585 € chacun, sans reste.
  const r = repartir({ montantCents: 234000, regle: 'quotes_parts', dateDepense: '2026-09-02', detenteurs: INDIVISION });
  assert.deepEqual(r.lignes.map((l) => l.montantCents), [58500, 58500, 58500, 58500]);
  assert.equal(somme(r.lignes), 234000);
});

test('la somme des parts égale toujours le montant, au centime', () => {
  // Un montant qui ne tombe pas rond : 100,01 € à trois.
  const trois = INDIVISION.slice(0, 3);
  const r = repartir({ montantCents: 10001, regle: 'quotes_parts', dateDepense: '2026-09-02', detenteurs: trois });
  assert.equal(somme(r.lignes), 10001);
  assert.deepEqual(r.lignes.map((l) => l.montantCents).sort((a, b) => b - a), [3334, 3334, 3333]);
});

test('l\'arrondi ne dépend pas de l\'ordre des données', () => {
  const inverse = [...INDIVISION].reverse();
  const a = repartir({ montantCents: 10001, regle: 'quotes_parts', dateDepense: '2026-09-02', detenteurs: INDIVISION });
  const b = repartir({ montantCents: 10001, regle: 'quotes_parts', dateDepense: '2026-09-02', detenteurs: inverse });
  assert.deepEqual(a.lignes, b.lignes, 'deux calculs de la même dépense doivent donner exactement la même chose');
});

test('les centimes résiduels vont aux plus grosses parts', () => {
  const sci: Detenteur[] = [
    { personneId: THOMAS, nom: 'Thomas', foyerId: 3, foyerNom: 'Thomas', parts: 120 },
    { personneId: CLAIRE, nom: 'Claire', foyerId: 2, foyerNom: 'Claire', parts: 90 },
    { personneId: JULIEN, nom: 'Julien', foyerId: 4, foyerNom: 'Julien', parts: 90 },
  ];
  // 100,00 € sur 300 parts : 40 / 30 / 30, exact.
  const exact = repartir({ montantCents: 10000, regle: 'quotes_parts', dateDepense: '2026-09-02', detenteurs: sci });
  assert.deepEqual([du(exact, THOMAS), du(exact, CLAIRE), du(exact, JULIEN)], [4000, 3000, 3000]);

  // 100,01 € : le centime va à la plus grosse part.
  const reste = repartir({ montantCents: 10001, regle: 'quotes_parts', dateDepense: '2026-09-02', detenteurs: sci });
  assert.equal(somme(reste.lignes), 10001);
  assert.equal(du(reste, THOMAS), 4001);
});

test('un montant d\'un centime ne se perd pas', () => {
  const r = repartir({ montantCents: 1, regle: 'quotes_parts', dateDepense: '2026-09-02', detenteurs: INDIVISION });
  assert.equal(somme(r.lignes), 1);
  assert.equal(r.lignes.filter((l) => l.montantCents === 1).length, 1);
});

test('une dépense partagée entre deux dossiers ne porte que son poids', () => {
  // L'assurance multirisque des deux biens : moitié dans chaque dossier.
  const r = repartir({
    montantCents: 112800, regle: 'quotes_parts', dateDepense: '2026-05-05',
    detenteurs: INDIVISION, poids: { num: 1, den: 2 },
  });
  assert.equal(somme(r.lignes), 56400);
  assert.equal(r.justification.poids, '1/2');
  assert.equal(r.justification.montantTotalCents, 112800);
  assert.equal(r.justification.montantRepartiCents, 56400);
});

test('la règle « nuits occupées » compte par foyer, puis par parts', () => {
  const nuits = new Map([[1, 10], [2, 14], [3, 8], [4, 8]]);   // 40 nuits en tout
  const r = repartir({
    montantCents: 40000, regle: 'nuits', dateDepense: '2026-09-02',
    detenteurs: INDIVISION, nuitsParFoyer: nuits,
  });
  assert.equal(du(r, HELENE), 10000, '10 nuits sur 40');
  assert.equal(du(r, CLAIRE), 14000, '14 nuits sur 40');
  assert.equal(du(r, THOMAS), 8000);
  assert.equal(somme(r.lignes), 40000);
});

test('deux détenteurs du même foyer se partagent la part du foyer', () => {
  // Claire et Marc détiennent tous deux, dans le même foyer.
  const avecMarc: Detenteur[] = [
    ...INDIVISION,
    { personneId: MARC, nom: 'Marc', foyerId: 2, foyerNom: 'Claire et Marc', parts: 1 },
  ];
  const nuits = new Map([[1, 0], [2, 10], [3, 0], [4, 0]]);
  const r = repartir({
    montantCents: 10000, regle: 'nuits', dateDepense: '2026-09-02',
    detenteurs: avecMarc, nuitsParFoyer: nuits,
  });
  // Le foyer de Claire et Marc a consommé toutes les nuits : il porte tout,
  // et le partage entre eux suit leurs parts, égales ici.
  assert.equal(du(r, CLAIRE), 5000);
  assert.equal(du(r, MARC), 5000);
  assert.equal(du(r, HELENE), 0);
  assert.equal(somme(r.lignes), 10000);
});

test('sans aucune nuit consommée, la règle retombe sur les quotes-parts et le dit', () => {
  // Une règle « nuits » sur une année où personne n'est venu diviserait par
  // zéro. Le repli est silencieux pour l'utilisateur, pas pour la justification.
  const r = repartir({
    montantCents: 40000, regle: 'nuits', dateDepense: '2026-01-15',
    detenteurs: INDIVISION, nuitsParFoyer: new Map(),
  });
  assert.equal(r.justification.regleDemandee, 'nuits');
  assert.equal(r.justification.regleAppliquee, 'quotes_parts');
  assert.match(r.justification.repli ?? '', /Aucune nuit/);
  assert.deepEqual(r.lignes.map((l) => l.montantCents), [10000, 10000, 10000, 10000]);
});

test('la règle « parts égales par foyer » ignore les quotes-parts', () => {
  const inegal: Detenteur[] = [
    { personneId: HELENE, nom: 'Hélène', foyerId: 1, foyerNom: 'Hélène', parts: 90 },
    { personneId: CLAIRE, nom: 'Claire', foyerId: 2, foyerNom: 'Claire', parts: 5 },
    { personneId: THOMAS, nom: 'Thomas', foyerId: 3, foyerNom: 'Thomas', parts: 5 },
  ];
  const r = repartir({ montantCents: 30000, regle: 'parts_egales_foyer', dateDepense: '2026-09-02', detenteurs: inegal });
  assert.deepEqual([du(r, HELENE), du(r, CLAIRE), du(r, THOMAS)], [10000, 10000, 10000],
    'les courses se partagent par foyer, pas au prorata du patrimoine');
});

test('un seul foyer concerné retombe sur les quotes-parts', () => {
  const seul = [INDIVISION[0]];
  const r = repartir({ montantCents: 10000, regle: 'parts_egales_foyer', dateDepense: '2026-09-02', detenteurs: seul });
  assert.equal(r.justification.regleAppliquee, 'quotes_parts');
  assert.equal(du(r, HELENE), 10000);
});

test('une personne sans foyer forme le sien', () => {
  const sansFoyer: Detenteur[] = [
    { personneId: HELENE, nom: 'Hélène', foyerId: 1, foyerNom: 'Hélène', parts: 1 },
    { personneId: THOMAS, nom: 'Thomas', foyerId: null, foyerNom: null, parts: 1 },
  ];
  const r = repartir({ montantCents: 10000, regle: 'parts_egales_foyer', dateDepense: '2026-09-02', detenteurs: sansFoyer });
  assert.deepEqual([du(r, HELENE), du(r, THOMAS)], [5000, 5000]);
});

test('une dépense sans répartition saisie est refusée, en disant quoi faire', () => {
  assert.throws(
    () => repartir({ montantCents: 10000, regle: 'quotes_parts', dateDepense: '2026-09-02', detenteurs: [] }),
    (e: unknown) => e instanceof RepartitionImpossible && /renseignez les quotes-parts/.test(e.message),
  );
});

test('un montant nul, négatif ou fractionnaire est refusé', () => {
  for (const montant of [0, -100, 12.5]) {
    assert.throws(
      () => repartir({ montantCents: montant, regle: 'quotes_parts', dateDepense: '2026-09-02', detenteurs: INDIVISION }),
      RepartitionImpossible, `${montant} aurait dû être refusé`,
    );
  }
});

test('la justification permet de reconstituer le calcul de vive voix', () => {
  const r = repartir({
    montantCents: 234000, regle: 'quotes_parts', dateDepense: '2026-09-02',
    detenteurs: INDIVISION, source: { regleId: 7, applicableDu: '2026-01-01' },
  });
  const texte = expliquer(r.justification).join('\n');
  assert.match(texte, /Règle appliquée : Quotes-parts/);
  assert.match(texte, /depuis le 1 janvier 2026/);
  assert.match(texte, /2 septembre 2026/);
  assert.match(texte, /Hélène \(1 \/ 4\) : 585,00 €/);
  assert.match(texte, /plus fort reste/);
  assert.match(texte, /somme des parts vaut 2 340,00 €/);
});

test('repartirEntier répartit exactement, quels que soient les poids', () => {
  // Un balayage : la somme doit toujours être exacte.
  for (let montant = 0; montant <= 200; montant++) {
    for (const poids of [[1, 1, 1], [7, 3], [1, 2, 3, 4], [120, 90, 90], [1]]) {
      const r = repartirEntier(montant, poids.map((p, i) => ({ cle: i, poids: p, ordre: i })));
      const total = [...r.values()].reduce((t, v) => t + v, 0);
      assert.equal(total, montant, `montant ${montant}, poids ${poids.join('/')}`);
      for (const v of r.values()) assert.ok(v >= 0, 'aucune part ne doit être négative');
    }
  }
});

test('des poids tous nuls sont refusés plutôt que divisés par zéro', () => {
  assert.throws(() => repartirEntier(100, [{ cle: 1, poids: 0, ordre: 0 }]), RepartitionImpossible);
});

test('une dépense sur deux biens suit la règle de chaque bien', () => {
  // L'énergie suit les nuits à Kerloc'h et les quotes-parts aux Arcs.
  const r = repartirSurBiens(100000, '2026-09-02', INDIVISION, [
    {
      bienId: 1, bienNom: "Kerloc'h", poidsNum: 1, poidsDen: 2, regle: 'nuits',
      nuitsParFoyer: new Map([[1, 10], [2, 10], [3, 0], [4, 0]]),
    },
    { bienId: 2, bienNom: 'Les Arcs', poidsNum: 1, poidsDen: 2, regle: 'quotes_parts' },
  ]);
  assert.equal(somme(r.lignes), 100000, 'aucun centime ne se perd entre les deux découpages');
  // 500 € à Kerloc'h partagés entre Hélène et Claire (250 chacune),
  // 500 € aux Arcs partagés à quatre (125 chacun).
  assert.equal(du(r, HELENE), 25000 + 12500);
  assert.equal(du(r, THOMAS), 12500);
  assert.match(r.justification.etapes[0].titre, /Découpage entre les biens/);
});

test('le découpage entre biens ne perd jamais de centime', () => {
  for (let montant = 1; montant <= 300; montant++) {
    const r = repartirSurBiens(montant, '2026-09-02', INDIVISION, [
      { bienId: 1, bienNom: 'A', poidsNum: 1, poidsDen: 3, regle: 'quotes_parts' },
      { bienId: 2, bienNom: 'B', poidsNum: 1, poidsDen: 3, regle: 'quotes_parts' },
      { bienId: 3, bienNom: 'C', poidsNum: 1, poidsDen: 3, regle: 'quotes_parts' },
    ]);
    assert.equal(somme(r.lignes), montant, `montant ${montant}`);
  }
});
