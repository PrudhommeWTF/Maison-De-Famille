// Les jours fériés français.
//
// Le calcul de Pâques est vérifié contre des dates connues sur trente ans, y
// compris les deux cas qui font tomber les implémentations approximatives :
// une Pâque très précoce (22 mars) et une très tardive (25 avril).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feries, feriesEntre, paques } from '../src/calendrier/feries';

test('Pâques tombe aux bonnes dates', () => {
  const connues: Record<number, string> = {
    2020: '2020-04-12', 2021: '2021-04-04', 2022: '2022-04-17', 2023: '2023-04-09',
    2024: '2024-03-31', 2025: '2025-04-20', 2026: '2026-04-05', 2027: '2027-03-28',
    2028: '2028-04-16', 2029: '2029-04-01', 2030: '2030-04-21', 2031: '2031-04-13',
    2032: '2032-03-28', 2033: '2033-04-17', 2034: '2034-04-09', 2035: '2035-03-25',
    2038: '2038-04-25', 2040: '2040-04-01', 2050: '2050-04-10',
  };
  for (const [a, d] of Object.entries(connues)) {
    assert.equal(paques(Number(a)), d, `Pâques ${a}`);
  }
});

test('les bornes extrêmes de Pâques sont justes', () => {
  // Les deux cas qui piègent : le 22 mars est la date la plus précoce possible,
  // le 25 avril la plus tardive.
  assert.equal(paques(2285), '2285-03-22');
  assert.equal(paques(2038), '2038-04-25');
});

test('onze jours fériés en métropole, treize en Alsace-Moselle', () => {
  assert.equal(feries(2026).length, 11);
  assert.equal(feries(2026, true).length, 13);
});

test('les quatre fêtes mobiles se déduisent de Pâques', () => {
  const f = new Map(feries(2026).map((x) => [x.nom, x.date]));
  assert.equal(paques(2026), '2026-04-05');
  assert.equal(f.get('Lundi de Pâques'), '2026-04-06');
  assert.equal(f.get('Ascension'), '2026-05-14', 'trente-neuf jours après Pâques');
  assert.equal(f.get('Lundi de Pentecôte'), '2026-05-25', 'cinquante jours après Pâques');
});

test('les sept dates fixes ne bougent pas', () => {
  const f = new Map(feries(2026).map((x) => [x.nom, x.date]));
  assert.equal(f.get('Jour de l\'an'), '2026-01-01');
  assert.equal(f.get('Fête du Travail'), '2026-05-01');
  assert.equal(f.get('Victoire 1945'), '2026-05-08');
  assert.equal(f.get('Fête nationale'), '2026-07-14');
  assert.equal(f.get('Assomption'), '2026-08-15');
  assert.equal(f.get('Toussaint'), '2026-11-01');
  assert.equal(f.get('Armistice 1918'), '2026-11-11');
  assert.equal(f.get('Noël'), '2026-12-25');
});

test('la liste est triée, et un intervalle traverse les années', () => {
  const f = feries(2026);
  assert.deepEqual([...f].sort((a, b) => a.date.localeCompare(b.date)), f);

  // Un calendrier affiché à cheval sur décembre et janvier doit voir les deux.
  const e = feriesEntre('2026-12-20', '2027-01-05');
  assert.deepEqual(e.map((x) => x.date), ['2026-12-25', '2027-01-01']);
});

test('l\'Alsace-Moselle ajoute exactement deux jours, et ne retire rien', () => {
  const metro = feries(2026).map((f) => f.date);
  const est = feries(2026, true).map((f) => f.date);
  assert.ok(metro.every((d) => est.includes(d)), 'aucun férié métropolitain ne disparaît');
  const ajouts = est.filter((d) => !metro.includes(d));
  assert.deepEqual(ajouts, ['2026-04-03', '2026-12-26'], 'Vendredi saint et Saint Étienne');
});
