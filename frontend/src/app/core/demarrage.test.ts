import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etapes } from './demarrage';
import type { FaitsDemarrage } from './demarrage';

const INSTALLEE: FaitsDemarrage = {
  personnes: 5,
  structuresSansSecondGerant: [],
  quotesPartsSaisies: true,
  relaisConfigure: true,
  adressePubliqueRenseignee: true,
  sejours: 12,
};

/** L'état exact au sortir de l'amorçage : une personne, un bien, rien d'autre. */
const NEUVE: FaitsDemarrage = {
  personnes: 1,
  structuresSansSecondGerant: ["Indivision Kerloc'h"],
  quotesPartsSaisies: false,
  relaisConfigure: false,
  adressePubliqueRenseignee: false,
  sejours: 0,
};

test('une instance en service ne montre aucune étape', () => {
  assert.deepEqual(etapes(INSTALLEE), []);
});

test('une instance neuve dit par où commencer, dans l\'ordre des dépendances', () => {
  const e = etapes(NEUVE);
  assert.deepEqual(e.map((x) => x.cle), [
    'personnes', "gerant:Indivision Kerloc'h", 'quotes-parts', 'smtp', 'planning',
  ]);
  // Inscrire la famille vient avant désigner un second gérant : on ne peut pas
  // nommer quelqu'un qui n'existe pas encore.
  assert.ok(e.findIndex((x) => x.cle === 'personnes') < e.findIndex((x) => x.cle.startsWith('gerant:')));
});

test('chaque étape dit à quoi elle sert et où aller', () => {
  for (const e of etapes(NEUVE)) {
    assert.ok(e.pourquoi.length > 30, `« ${e.titre} » doit expliquer ce qu'on y gagne`);
    assert.ok(e.lien, `« ${e.titre} » doit mener quelque part`);
  }
});

test('le second gérant est la seule étape bloquante d\'une instance neuve', () => {
  const bloquantes = etapes(NEUVE).filter((x) => x.bloquante).map((x) => x.cle);
  assert.deepEqual(bloquantes, ["gerant:Indivision Kerloc'h"]);
});

test('chaque structure sous le seuil a sa propre étape', () => {
  const e = etapes({ ...INSTALLEE, structuresSansSecondGerant: ["Indivision Kerloc'h", 'SCI du Mont'] });
  assert.equal(e.length, 2);
  assert.deepEqual(e.map((x) => x.cle), ["gerant:Indivision Kerloc'h", 'gerant:SCI du Mont']);
  assert.match(e[1].titre, /SCI du Mont/, 'le titre doit nommer la structure, sinon les deux se confondent');
});

test('un relais configuré sans adresse publique est bloquant', () => {
  const e = etapes({ ...INSTALLEE, adressePubliqueRenseignee: false });
  assert.deepEqual(e.map((x) => x.cle), ['adresse-publique']);
  assert.equal(e[0].bloquante, true,
    'des courriels dont les liens ne mènent nulle part sont pires que pas de courriel');
});

test('sans relais, on ne réclame pas encore l\'adresse publique', () => {
  const e = etapes({ ...INSTALLEE, relaisConfigure: false, adressePubliqueRenseignee: false });
  assert.deepEqual(e.map((x) => x.cle), ['smtp'],
    "réclamer deux réglages à la fois pour le même sujet noie celui qui compte");
});

test('les étapes déjà faites disparaissent une à une', () => {
  const avecFamille = etapes({ ...NEUVE, personnes: 4 });
  assert.ok(!avecFamille.some((x) => x.cle === 'personnes'));
  const avecGerant = etapes({ ...NEUVE, personnes: 4, structuresSansSecondGerant: [] });
  assert.ok(!avecGerant.some((x) => x.cle.startsWith('gerant:')));
  assert.deepEqual(avecGerant.map((x) => x.cle), ['quotes-parts', 'smtp', 'planning']);
});
