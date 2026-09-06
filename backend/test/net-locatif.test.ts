import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alerteSaison, encaisse, exercice, reste } from '../src/location/net';
import type { ChargeLocative, Reservation } from '../src/location/net';

const r = (
  id: number, arrivee: string, depart: string, nuits: number,
  loyer: number, acompte: number, statut: Reservation['statut'],
): Reservation => ({ id, locataire: `L${id}`, arrivee, depart, nuits, loyerCents: loyer, acompteCents: acompte, statut });

const c = (id: number, date: string, montant: number): ChargeLocative =>
  ({ id, libelle: `C${id}`, dateDepense: date, montantCents: montant });

test('ce qui compte, c\'est ce qui est encaissé', () => {
  assert.equal(encaisse(r(1, '2026-07-04', '2026-07-11', 7, 135000, 135000, 'solde')), 135000);
  assert.equal(encaisse(r(2, '2026-07-25', '2026-08-08', 14, 310000, 100000, 'acompte')), 100000);
  assert.equal(encaisse(r(3, '2026-08-08', '2026-08-15', 7, 155000, 0, 'a_confirmer')), 0,
    'une réservation sans acompte ne rapporte encore rien');
  assert.equal(encaisse(r(4, '2026-09-05', '2026-09-12', 7, 89000, 89000, 'annule')), 0,
    'une annulation ne rapporte rien, même si un acompte figure encore');
});

test('le reste à percevoir ignore les annulations', () => {
  assert.equal(reste(r(1, '2026-07-04', '2026-07-11', 7, 135000, 50000, 'acompte')), 85000);
  assert.equal(reste(r(2, '2026-07-04', '2026-07-11', 7, 135000, 135000, 'solde')), 0);
  assert.equal(reste(r(3, '2026-07-04', '2026-07-11', 7, 135000, 50000, 'annule')), 0);
});

test('la saison de la maquette : encaissé, charges, net', () => {
  const e = exercice(2026, [
    r(1, '2026-07-04', '2026-07-11', 7, 135000, 135000, 'solde'),
    r(2, '2026-07-25', '2026-08-08', 14, 310000, 310000, 'solde'),
    r(3, '2026-08-08', '2026-08-15', 7, 155000, 155000, 'solde'),
    r(4, '2026-09-05', '2026-09-12', 7, 89000, 89000, 'solde'),
  ], [c(1, '2026-07-20', 88000), c(2, '2026-08-30', 50000)]);

  assert.equal(e.encaisseCents, 689000);
  assert.equal(e.chargesCents, 138000);
  assert.equal(e.netCents, 551000);
  assert.equal(e.nuitsLouees, 35);
  assert.equal(e.reservations, 4);
  assert.match(e.explication, /Net à répartir/);
});

test('une réservation à confirmer ne gonfle pas les loyers encaissés', () => {
  const e = exercice(2026, [
    r(1, '2026-07-04', '2026-07-11', 7, 135000, 135000, 'solde'),
    r(2, '2026-08-08', '2026-08-15', 7, 155000, 0, 'a_confirmer'),
  ], []);
  assert.equal(e.encaisseCents, 135000);
  assert.equal(e.attenduCents, 155000, 'ce qui reste à percevoir est dit à part');
  assert.equal(e.aConfirmer, 1);
  assert.match(e.explication, /à confirmer/);
  assert.match(e.explication, /restent à percevoir, non comptés/);
});

test('une annulation sort complètement du compte', () => {
  const e = exercice(2026, [
    r(1, '2026-07-04', '2026-07-11', 7, 135000, 135000, 'solde'),
    r(2, '2026-08-08', '2026-08-15', 7, 155000, 50000, 'annule'),
  ], []);
  assert.equal(e.encaisseCents, 135000);
  assert.equal(e.reservations, 1);
  assert.equal(e.nuitsLouees, 7, 'les nuits annulées ne comptent pas comme louées');
});

test('une saison déficitaire le dit, et ne répartit rien', () => {
  const e = exercice(2026, [r(1, '2026-07-04', '2026-07-11', 7, 50000, 0, 'a_confirmer')],
    [c(1, '2026-07-20', 120000)]);
  assert.equal(e.netCents, -120000);
  assert.match(e.explication, /déficitaire/);
  assert.match(e.explication, /reste porté par la structure/);
});

test('l\'exercice filtre sur l\'année d\'arrivée', () => {
  const aCheval = [
    r(1, '2025-12-28', '2026-01-04', 7, 90000, 90000, 'solde'),
    r(2, '2026-07-04', '2026-07-11', 7, 135000, 135000, 'solde'),
  ];
  assert.equal(exercice(2026, aCheval, []).encaisseCents, 135000,
    'la semaine du nouvel an compte pour l\'année où les gens arrivent');
  assert.equal(exercice(2025, aCheval, []).encaisseCents, 90000);
  // Les charges suivent leur propre date.
  const e = exercice(2026, aCheval, [c(1, '2025-11-02', 40000), c(2, '2026-03-01', 30000)]);
  assert.equal(e.chargesCents, 30000);
});

test('une saison vide ne casse rien', () => {
  const e = exercice(2026, [], []);
  assert.equal(e.encaisseCents, 0);
  assert.equal(e.netCents, 0);
  assert.equal(e.reservations, 0);
  assert.match(e.explication, /Saison 2026/);
});

test('une date invalide est ignorée plutôt que comptée de travers', () => {
  const e = exercice(2026, [r(1, 'pas-une-date', '2026-07-11', 7, 135000, 135000, 'solde')], []);
  assert.equal(e.encaisseCents, 0);
});

test('louer avant que la famille ait choisi déclenche une alerte, sans bloquer', () => {
  const locations = [r(1, '2026-07-25', '2026-08-08', 14, 310000, 0, 'a_confirmer')];
  const a = alerteSaison(2026, locations, []);
  assert.ok(a, 'aucun séjour de famille posé : il faut le dire');
  assert.match(a!, /La famille choisit ses dates avant/);

  assert.equal(alerteSaison(2026, locations, [{ arrivee: '2026-06-13' }]), null,
    'dès qu\'un séjour de famille est posé, plus d\'alerte');
  assert.equal(alerteSaison(2026, [], []), null, 'sans location ouverte, rien à signaler');
  assert.ok(alerteSaison(2026, locations, [{ arrivee: '2025-06-13' }]),
    "un séjour de famille de l'an dernier ne protège pas la saison en cours");
  assert.equal(alerteSaison(2026, [r(9, '2026-07-25', '2026-08-08', 14, 310000, 0, 'annule')], []), null,
    'une location annulée n\'ouvre plus rien');
});
