// La mise en forme française, et l'arithmétique de dates.
//
// Le piège que ces tests gardent : passer par une date locale quelque part.
// Le bug qui en résulte décale une nuit deux fois par an, au changement d'heure,
// et personne ne fait le rapprochement six mois plus tard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dateCourte, dateLongue, decale, enTetesJours, euros, initiales, moisPrecedent,
  moisSuivant, nuitsEntre, nuitsLisible, personnesLisible, plage, premierDuMois,
} from './format';

test('les dates s\'écrivent en français', () => {
  assert.equal(dateLongue('2026-08-08'), '8 août 2026');
  assert.equal(dateLongue('2026-01-01'), '1 janvier 2026');
  assert.equal(dateCourte('2026-02-15'), '15 févr.');
  assert.equal(dateLongue('pas une date'), '');
});

test('une plage se raccourcit quand le mois ne change pas', () => {
  assert.equal(plage('2026-08-08', '2026-08-16'), '8 → 16 août');
  assert.equal(plage('2026-07-30', '2026-08-05'), '30 juil. → 5 août');
  assert.equal(plage('2026-12-28', '2027-01-04'), '28 déc. → 4 janv.');
});

test('l\'arithmétique de dates ne dépend pas du fuseau ni de l\'heure d\'été', () => {
  assert.equal(nuitsEntre('2026-08-08', '2026-08-16'), 8);
  // Le dernier dimanche de mars fait 23 heures en heure locale : compter en
  // local rendrait ici 1 au lieu de 2.
  assert.equal(nuitsEntre('2026-03-28', '2026-03-30'), 2);
  assert.equal(nuitsEntre('2026-10-24', '2026-10-26'), 2);
  assert.equal(decale('2026-03-28', 1), '2026-03-29');
  assert.equal(decale('2026-12-31', 1), '2027-01-01');
  assert.equal(decale('2026-01-01', -1), '2025-12-31');
});

test('les mois se suivent par-dessus le changement d\'année', () => {
  assert.deepEqual(moisSuivant(2026, 11), { annee: 2027, mois: 0 });
  assert.deepEqual(moisPrecedent(2026, 0), { annee: 2025, mois: 11 });
  assert.equal(premierDuMois(2026, 7), '2026-08-01');
});

test('les en-têtes de jours suivent le premier jour de semaine choisi', () => {
  assert.deepEqual(enTetesJours(false), ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim']);
  assert.deepEqual(enTetesJours(true), ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']);
});

test('les pluriels sont gérés une fois pour toutes', () => {
  assert.equal(nuitsLisible(1), '1 nuit');
  assert.equal(nuitsLisible(8), '8 nuits');
  assert.equal(personnesLisible(1), '1 personne');
  assert.equal(personnesLisible(4), '4 personnes');
});

test('les initiales tiennent compte des noms composés', () => {
  assert.equal(initiales('Hélène Prudhomme'), 'HP');
  assert.equal(initiales('Thomas'), 'T');
  assert.equal(initiales('Jean-Pierre Le Guen'), 'JG');
  assert.equal(initiales('   '), '?');
});

test('les montants sont en euros, à la française', () => {
  assert.match(euros(234000), /^2 340,00\s?€$/);
  assert.match(euros(5), /^0,05\s?€$/);
});
