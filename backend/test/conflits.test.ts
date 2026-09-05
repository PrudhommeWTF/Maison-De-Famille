// La détection de chevauchement de séjours, et la capacité du bien.
//
// Le cas qui compte vraiment : la rotation le même jour. Les locataires partent
// le 8 au matin, la famille arrive le 8 dans l'après-midi. Refuser cela rendrait
// l'application inutilisable au coeur de la saison.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Occupation, bannierePourBien, detecter, nuitsConsommees } from '../src/sejours/conflits';

const COUCHAGES = 8;

const occ = (o: Partial<Occupation> & { id: number; arrivee: string; depart: string }): Occupation => ({
  occupants: 4, nature: 'famille', statut: 'valide', titre: 'Séjour', ...o,
});

test('la rotation le même jour ne produit aucun conflit', () => {
  const existantes = [occ({ id: 1, arrivee: '2026-08-01', depart: '2026-08-08', nature: 'location', titre: 'Berger' })];
  const c = detecter({ arrivee: '2026-08-08', depart: '2026-08-16', occupants: 4 }, existantes, COUCHAGES);
  assert.deepEqual(c, []);
});

test('un chevauchement avec un séjour validé est un conflit dur', () => {
  const existantes = [occ({ id: 1, arrivee: '2026-08-01', depart: '2026-08-09', nature: 'location', titre: 'Berger' })];
  const c = detecter({ arrivee: '2026-08-08', depart: '2026-08-16', occupants: 4 }, existantes, COUCHAGES);
  const dur = c.find((x) => x.nature === 'sejour_valide');
  assert.ok(dur, 'le conflit dur doit être signalé');
  assert.equal(dur.sejourId, 1);
  assert.deepEqual(dur.nuits, ['2026-08-08'], 'une seule nuit commune');
  assert.match(dur.message, /Berger/);
});

test('deux demandes en attente sur les mêmes dates s\'annoncent sans se bloquer', () => {
  const existantes = [occ({ id: 7, arrivee: '2026-08-08', depart: '2026-08-16', statut: 'demande', titre: 'Julien' })];
  const c = detecter({ arrivee: '2026-08-10', depart: '2026-08-14', occupants: 2 }, existantes, COUCHAGES);
  assert.equal(c.filter((x) => x.nature === 'sejour_valide').length, 0);
  assert.equal(c.filter((x) => x.nature === 'demande_concurrente').length, 1);
});

test('une demande refusée ou annulée n\'occupe plus rien', () => {
  const existantes = [
    occ({ id: 1, arrivee: '2026-08-08', depart: '2026-08-16', statut: 'annule' }),
    occ({ id: 2, arrivee: '2026-08-08', depart: '2026-08-16', statut: 'a_revoir' }),
  ];
  assert.deepEqual(detecter({ arrivee: '2026-08-08', depart: '2026-08-16', occupants: 4 }, existantes, COUCHAGES), []);
});

test('la capacité se juge nuit par nuit, pas sur le séjour entier', () => {
  // Trois personnes arrivent le 10 alors que six sont déjà là jusqu'au 12 :
  // seules les nuits du 10 et du 11 dépassent.
  const existantes = [occ({ id: 1, arrivee: '2026-08-05', depart: '2026-08-12', occupants: 6, titre: 'Claire' })];
  const c = detecter({ arrivee: '2026-08-10', depart: '2026-08-20', occupants: 3 }, existantes, COUCHAGES);
  const cap = c.find((x) => x.nature === 'capacite');
  assert.ok(cap);
  assert.deepEqual(cap.nuits, ['2026-08-10', '2026-08-11']);
  assert.match(cap.message, /9 personnes attendues pour 8 couchages/);
});

test('deux séjours qui se succèdent n\'additionnent pas leurs occupants', () => {
  const existantes = [occ({ id: 1, arrivee: '2026-08-01', depart: '2026-08-08', occupants: 8 })];
  const c = detecter({ arrivee: '2026-08-08', depart: '2026-08-16', occupants: 8 }, existantes, COUCHAGES);
  assert.deepEqual(c, [], 'huit puis huit, jamais seize la même nuit');
});

test('modifier un séjour ne le fait pas entrer en conflit avec lui-même', () => {
  const existantes = [occ({ id: 42, arrivee: '2026-08-08', depart: '2026-08-16', occupants: 6 })];
  const c = detecter({ arrivee: '2026-08-09', depart: '2026-08-16', occupants: 6, sejourId: 42 }, existantes, COUCHAGES);
  assert.deepEqual(c, []);
});

test('un séjour d\'une seule nuit se compare correctement', () => {
  const existantes = [occ({ id: 1, arrivee: '2026-08-08', depart: '2026-08-09' })];
  assert.equal(detecter({ arrivee: '2026-08-08', depart: '2026-08-09', occupants: 1 }, existantes, COUCHAGES).length, 1);
  assert.equal(detecter({ arrivee: '2026-08-09', depart: '2026-08-10', occupants: 1 }, existantes, COUCHAGES).length, 0);
});

test('une intervention d\'entretien bloque les dates comme un séjour', () => {
  // C'est tout l'intérêt d'une table unique : la maison louée pendant les
  // travaux est le bug classique de ce genre d'application.
  const existantes = [occ({ id: 1, arrivee: '2026-05-04', depart: '2026-05-08', nature: 'entretien', occupants: 1, titre: 'Ravalement' })];
  const c = detecter({ arrivee: '2026-05-06', depart: '2026-05-10', occupants: 4 }, existantes, COUCHAGES);
  assert.equal(c[0].nature, 'sejour_valide');
  assert.match(c[0].message, /l'intervention/);
});

test('la bannière du calendrier ne remonte que les conflits durs', () => {
  const demandes = [occ({ id: 10, arrivee: '2026-08-08', depart: '2026-08-16', statut: 'demande', titre: 'Julien' })];
  const existantes = [
    ...demandes,
    occ({ id: 1, arrivee: '2026-08-01', depart: '2026-08-09', nature: 'location', titre: 'Berger' }),
    occ({ id: 11, arrivee: '2026-08-10', depart: '2026-08-14', statut: 'demande', titre: 'Thomas' }),
  ];
  const b = bannierePourBien(demandes, existantes, COUCHAGES);
  assert.ok(b.some((c) => c.nature === 'sejour_valide'));
  assert.equal(b.some((c) => c.nature === 'demande_concurrente'), false);
});

test('les nuits consommées ignorent la location et l\'entretien', () => {
  const sejours = [
    occ({ id: 1, arrivee: '2026-07-01', depart: '2026-07-15' }),
    occ({ id: 2, arrivee: '2026-08-01', depart: '2026-08-08', nature: 'location' }),
    occ({ id: 3, arrivee: '2026-05-04', depart: '2026-05-08', nature: 'entretien' }),
    occ({ id: 4, arrivee: '2026-09-01', depart: '2026-09-03', statut: 'demande' }),
  ];
  assert.equal(nuitsConsommees(sejours), 14);
});
