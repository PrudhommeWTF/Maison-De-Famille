// La règle la plus importante de l'application : un détenteur d'un bien ne doit
// rien voir d'un autre bien auquel il n'est pas rattaché.
//
// Ces tests portent sur le calcul pur de la portée. Les tests de bout en bout
// des routes sont dans acces-routes.test.ts : les deux sont nécessaires, celui-ci
// vérifie la règle, l'autre vérifie qu'aucune route ne l'oublie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Entrees, biensVisibles, calculer, estGerant, roleSurBien } from '../src/acces/roles';

// Deux structures, comme dans la maquette : l'indivision de Kerloc'h (bien 1)
// et la SCI qui porte Les Arcs (bien 2). Hélène gère l'indivision, Thomas la SCI.
const HELENE = 1, CLAIRE = 2, THOMAS = 3, JULIEN = 4, MARC = 5, ETRANGER = 9;
const INDIVISION = 1, SCI = 2;
const KERLOCH = 1, ARCS = 2;

const BASE: Entrees = {
  biens: [{ bienId: KERLOCH, structureId: INDIVISION }, { bienId: ARCS, structureId: SCI }],
  detentions: [
    { personneId: HELENE, structureId: INDIVISION },
    { personneId: CLAIRE, structureId: INDIVISION },
    { personneId: THOMAS, structureId: INDIVISION },
    { personneId: JULIEN, structureId: INDIVISION },
    { personneId: THOMAS, structureId: SCI },
    { personneId: CLAIRE, structureId: SCI },
  ],
  roles: [
    { personneId: HELENE, structureId: INDIVISION, bienId: null, role: 'gerant' },
    { personneId: THOMAS, structureId: SCI, bienId: null, role: 'gerant' },
  ],
  personnes: [
    { personneId: HELENE, foyerId: 1 }, { personneId: CLAIRE, foyerId: 2 },
    { personneId: MARC, foyerId: 2 },   { personneId: THOMAS, foyerId: 3 },
    { personneId: JULIEN, foyerId: 4 }, { personneId: ETRANGER, foyerId: 5 },
  ],
};

test('la détention donne accès aux biens de sa structure, et à eux seuls', () => {
  const p = calculer(JULIEN, BASE);
  assert.equal(roleSurBien(p, KERLOCH), 'detenteur');
  assert.equal(roleSurBien(p, ARCS), null, 'Julien n\'est pas dans la SCI : Les Arcs n\'existe pas pour lui');
  assert.deepEqual(biensVisibles(p), [KERLOCH]);
});

test('un rôle de gérant ne déborde pas sur l\'autre structure', () => {
  const helene = calculer(HELENE, BASE);
  assert.equal(roleSurBien(helene, KERLOCH), 'gerant');
  assert.equal(roleSurBien(helene, ARCS), null, 'gérante de l\'indivision, rien à voir avec la SCI');

  const thomas = calculer(THOMAS, BASE);
  assert.equal(roleSurBien(thomas, ARCS), 'gerant');
  assert.equal(roleSurBien(thomas, KERLOCH), 'detenteur', 'détenteur à Kerloc\'h, pas gérant');
});

test('une personne sans aucun rattachement ne voit rien', () => {
  const p = calculer(ETRANGER, BASE);
  assert.deepEqual(biensVisibles(p), []);
  assert.equal(estGerant(p), false);
});

test('le conjoint d\'un détenteur devient membre de foyer, sans saisie séparée', () => {
  // Marc est dans le foyer de Claire, qui détient dans les deux structures.
  const p = calculer(MARC, BASE);
  assert.equal(roleSurBien(p, KERLOCH), 'membre_foyer');
  assert.equal(roleSurBien(p, ARCS), 'membre_foyer');
});

test('le foyer n\'élargit jamais au-delà de ce que voit le détenteur', () => {
  // Le foyer de Julien ne contient que lui : personne n'hérite de la SCI.
  const e: Entrees = { ...BASE, personnes: [...BASE.personnes, { personneId: 10, foyerId: 4 }] };
  const p = calculer(10, e);
  assert.deepEqual(biensVisibles(p), [KERLOCH]);
});

test('le rôle le plus large gagne quand plusieurs sources se cumulent', () => {
  // Marc devient invité explicite sur Les Arcs : son rôle de membre de foyer,
  // plus large, doit l'emporter et non l'inverse.
  const e: Entrees = {
    ...BASE,
    roles: [...BASE.roles, { personneId: MARC, structureId: null, bienId: ARCS, role: 'invite' }],
  };
  assert.equal(roleSurBien(calculer(MARC, e), ARCS), 'membre_foyer');
});

test('un rôle attribué sur un seul bien ne donne pas la structure entière', () => {
  const e: Entrees = {
    ...BASE,
    biens: [...BASE.biens, { bienId: 3, structureId: INDIVISION }],
    roles: [...BASE.roles, { personneId: ETRANGER, structureId: null, bienId: KERLOCH, role: 'invite' }],
  };
  const p = calculer(ETRANGER, e);
  assert.deepEqual(biensVisibles(p), [KERLOCH], 'invité sur Kerloc\'h uniquement');
  assert.equal(roleSurBien(p, 3), null);
});

test('estGerant ne se déduit pas de la détention', () => {
  assert.equal(estGerant(calculer(CLAIRE, BASE)), false, 'détentrice dans les deux structures, gérante d\'aucune');
  assert.equal(estGerant(calculer(HELENE, BASE)), true);
});
