// La convention des nuits est la règle centrale de l'application : nuit
// d'arrivée incluse, nuit de départ exclue. Tout le reste en dépend, donc elle
// se teste sur ses cas limites, pas sur son cas nominal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chevauche, decale, estDate, nuits, nuitsDe } from '../src/noyau/dates';

test('estDate refuse ce qui ressemble à une date sans en être une', () => {
  assert.equal(estDate('2026-08-08'), true);
  assert.equal(estDate('2026-02-29'), false, '2026 n\'est pas bissextile');
  assert.equal(estDate('2024-02-29'), true, '2024 l\'est');
  assert.equal(estDate('2026-13-01'), false);
  assert.equal(estDate('2026-08-32'), false);
  assert.equal(estDate('08/08/2026'), false);
  assert.equal(estDate(''), false);
  assert.equal(estDate(20260808), false);
});

test('le nombre de nuits est la différence des dates', () => {
  assert.equal(nuits('2026-08-08', '2026-08-16'), 8, 'la maquette annonce 8 nuits du 8 au 16');
  assert.equal(nuits('2026-08-08', '2026-08-09'), 1);
  assert.equal(nuits('2026-08-08', '2026-08-08'), 0);
});

test('le changement d\'heure d\'été ne change pas le compte des nuits', () => {
  // Le dernier dimanche de mars, une journée fait 23 heures en heure locale.
  // Compter en heure locale donnerait ici 0 nuit au lieu de 1.
  assert.equal(nuits('2026-03-28', '2026-03-30'), 2);
  assert.equal(nuits('2026-10-24', '2026-10-26'), 2);
});

test('les nuits enjambent les fins de mois et d\'année', () => {
  assert.equal(nuits('2026-12-28', '2027-01-04'), 7);
  assert.equal(nuits('2026-01-31', '2026-02-01'), 1);
  assert.deepEqual(nuitsDe('2026-12-31', '2027-01-02'), ['2026-12-31', '2027-01-01']);
});

test('la rotation le même jour n\'est pas un chevauchement', () => {
  // Les Berger partent le 8, Julien arrive le 8 : c'est le cas nominal d'une
  // maison louée, et le refuser rendrait l'application inutilisable en août.
  assert.equal(chevauche('2026-08-01', '2026-08-08', '2026-08-08', '2026-08-16'), false);
  assert.equal(chevauche('2026-08-08', '2026-08-16', '2026-08-01', '2026-08-08'), false);
});

test('le chevauchement se détecte dans les deux sens et par inclusion', () => {
  assert.equal(chevauche('2026-08-01', '2026-08-10', '2026-08-08', '2026-08-16'), true, 'partiel');
  assert.equal(chevauche('2026-08-08', '2026-08-16', '2026-08-01', '2026-08-10'), true, 'partiel inversé');
  assert.equal(chevauche('2026-08-01', '2026-08-31', '2026-08-08', '2026-08-16'), true, 'inclusion');
  assert.equal(chevauche('2026-08-08', '2026-08-16', '2026-08-01', '2026-08-31'), true, 'inclus');
  assert.equal(chevauche('2026-08-08', '2026-08-09', '2026-08-08', '2026-08-09'), true, 'identiques');
  assert.equal(chevauche('2026-08-01', '2026-08-05', '2026-08-10', '2026-08-16'), false, 'disjoints');
});

test('decale traverse les mois et les années', () => {
  assert.equal(decale('2026-08-31', 1), '2026-09-01');
  assert.equal(decale('2026-01-01', -1), '2025-12-31');
  assert.equal(decale('2026-08-08', 0), '2026-08-08');
});
