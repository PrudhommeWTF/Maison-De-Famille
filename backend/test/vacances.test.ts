// Les vacances scolaires.
//
// Le calcul ne s'invente rien : il lit une table. Ce qui se teste, c'est donc
// la lecture, les recoupements d'intervalles, et surtout **l'aveu d'ignorance**
// quand une année n'est pas renseignée. Une famille qui ne voit aucune vacance
// en février doit pouvoir distinguer « il n'y en a pas » de « personne n'a mis
// la table à jour ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANNEES_COUVERTES, CALENDRIER, ZONES, anneeScolaire, couvre, vacancesEntre, zonesEnVacances,
} from '../src/calendrier/vacances';

test('l\'année scolaire bascule au 1er septembre', () => {
  assert.equal(anneeScolaire('2026-08-31'), '2025-2026');
  assert.equal(anneeScolaire('2026-09-01'), '2026-2027');
  assert.equal(anneeScolaire('2026-01-15'), '2025-2026');
  assert.equal(anneeScolaire('2026-12-25'), '2026-2027');
});

test('une année non renseignée est annoncée, pas silencieuse', () => {
  assert.equal(couvre('2026-02-01', '2026-02-28'), true);
  assert.equal(couvre('2030-02-01', '2030-02-28'), false,
    'la table ne va pas jusque-là, et l\'application doit le dire');
  // Un intervalle à cheval sur une année couverte et une autre ne l'est pas.
  assert.equal(couvre('2026-08-01', '2026-10-01'), false);
});

test('les vacances d\'hiver décalent bien les trois zones', () => {
  const p = vacancesEntre('2026-02-01', '2026-03-15');
  const hiver = p.filter((x) => x.nom === 'Hiver');
  assert.equal(hiver.length, 3, 'une période par zone');
  assert.deepEqual(hiver.map((x) => x.zone), ['A', 'B', 'C'], 'triées par date de début');
  // Chaque zone commence une semaine après la précédente.
  assert.equal(hiver[0].debut, '2026-02-07');
  assert.equal(hiver[1].debut, '2026-02-14');
  assert.equal(hiver[2].debut, '2026-02-21');
});

test('on ne demande que les zones qui concernent la famille', () => {
  const p = vacancesEntre('2026-02-01', '2026-03-15', ['A']);
  assert.deepEqual(p.filter((x) => x.nom === 'Hiver').map((x) => x.zone), ['A']);
  // Une période commune reste visible même en filtrant sur une zone.
  const noel = vacancesEntre('2025-12-24', '2025-12-26', ['A']);
  assert.equal(noel.length, 1);
  assert.equal(noel[0].zone, null);
});

test('une période commune met les trois zones en vacances', () => {
  const p = vacancesEntre('2025-12-01', '2026-01-31');
  assert.deepEqual(zonesEnVacances('2025-12-25', p), [...ZONES]);
  assert.deepEqual(zonesEnVacances('2025-12-19', p), [], 'la veille, c\'est encore la classe');
});

test('un jour d\'hiver ne concerne que les zones qui y sont', () => {
  const p = vacancesEntre('2026-02-01', '2026-03-15');
  // Le 9 février : la zone A est partie, B et C sont en classe.
  assert.deepEqual(zonesEnVacances('2026-02-09', p), ['A']);
  // Le 16 : A et B.
  assert.deepEqual(zonesEnVacances('2026-02-16', p), ['A', 'B']);
  // Le 23 : A est rentrée, B et C sont dehors.
  assert.deepEqual(zonesEnVacances('2026-02-23', p), ['B', 'C']);
  // Le 5 mars : seule C.
  assert.deepEqual(zonesEnVacances('2026-03-05', p), ['C']);
});

test('les bornes sont incluses des deux côtés', () => {
  const p = vacancesEntre('2026-02-01', '2026-03-15', ['A']);
  assert.deepEqual(zonesEnVacances('2026-02-07', p), ['A'], 'premier jour');
  assert.deepEqual(zonesEnVacances('2026-02-22', p), ['A'], 'dernier jour');
  assert.deepEqual(zonesEnVacances('2026-02-23', p), [], 'la reprise');
});

test('la table est cohérente : dates valides et fin après début', () => {
  for (const [annee, periodes] of Object.entries(CALENDRIER)) {
    assert.ok(ANNEES_COUVERTES.includes(annee));
    for (const p of periodes) {
      assert.match(p.debut, /^\d{4}-\d{2}-\d{2}$/, `${annee} ${p.nom} début`);
      assert.match(p.fin, /^\d{4}-\d{2}-\d{2}$/, `${annee} ${p.nom} fin`);
      assert.ok(p.fin > p.debut, `${annee} ${p.nom} : la fin doit suivre le début`);
      assert.ok(p.zone === null || ZONES.includes(p.zone), `${annee} ${p.nom} : zone inconnue`);
      // Toute période doit tomber dans son année scolaire, sinon la recherche
      // par année ne la trouverait jamais.
      assert.equal(anneeScolaire(p.debut), annee, `${annee} ${p.nom} ${p.zone ?? ''} mal rangée`);
    }
  }
});

test('chaque année renseignée l\'est pour les trois zones', () => {
  for (const [annee, periodes] of Object.entries(CALENDRIER)) {
    for (const nom of new Set(periodes.filter((p) => p.zone).map((p) => p.nom))) {
      const zones = periodes.filter((p) => p.nom === nom).map((p) => p.zone).sort();
      assert.deepEqual(zones, [...ZONES], `${annee}, ${nom} : une zone manque`);
    }
  }
});
