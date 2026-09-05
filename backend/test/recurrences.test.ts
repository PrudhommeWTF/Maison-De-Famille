import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RecurrenceInvalide, controler, echeances, lisible, pourSejour, urgence,
} from '../src/entretien/recurrences';
import type { Recurrence } from '../src/entretien/recurrences';

const ramonage: Recurrence = {
  id: 1, libelle: 'Ramonage de la cheminée', categorie: 'obligatoire',
  periodicite: 'annuelle', limiteMmjj: '10-15', moisDebut: null, moisFin: null,
};

const jardin: Recurrence = {
  id: 2, libelle: 'Entretien du jardin', categorie: 'courant',
  periodicite: 'mensuelle', limiteMmjj: null, moisDebut: 4, moisFin: 10,
};

const compteurs: Recurrence = {
  id: 3, libelle: 'Relevé des compteurs', categorie: 'courant',
  periodicite: 'sejour', limiteMmjj: null, moisDebut: null, moisFin: null,
};

test('une annuelle engendre une échéance par an, à sa date limite', () => {
  const e = echeances(ramonage, '2026-01-01', '2028-12-31');
  assert.deepEqual(e.map((x) => x.echeance), ['2026-10-15', '2027-10-15', '2028-10-15']);
  assert.equal(e[0].libelle, 'Ramonage de la cheminée');
  assert.equal(e[0].categorie, 'obligatoire');
  assert.equal(e[0].recurrenceId, 1);
});

test('une annuelle hors fenêtre n\'engendre rien', () => {
  assert.deepEqual(echeances(ramonage, '2026-01-01', '2026-09-30'), []);
  assert.deepEqual(echeances(ramonage, '2026-10-16', '2026-12-31'), []);
  // Bornes comprises, des deux côtés.
  assert.equal(echeances(ramonage, '2026-10-15', '2026-10-15').length, 1);
});

test('une mensuelle suit sa saison, au dernier jour de chaque mois', () => {
  const e = echeances(jardin, '2026-01-01', '2026-12-31');
  assert.deepEqual(e.map((x) => x.echeance), [
    '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31',
    '2026-08-31', '2026-09-30', '2026-10-31',
  ]);
});

test('une mensuelle sans saison couvre les douze mois, février compris', () => {
  const tous: Recurrence = { ...jardin, moisDebut: null, moisFin: null };
  const e = echeances(tous, '2026-01-01', '2026-12-31');
  assert.equal(e.length, 12);
  assert.equal(e[1].echeance, '2026-02-28');
  const bissextile = echeances(tous, '2024-02-01', '2024-02-29');
  assert.deepEqual(bissextile.map((x) => x.echeance), ['2024-02-29']);
});

test('la génération traverse le changement d\'année', () => {
  const e = echeances(jardin, '2026-09-01', '2027-05-31');
  assert.deepEqual(e.map((x) => x.echeance), [
    '2026-09-30', '2026-10-31', '2027-04-30', '2027-05-31',
  ]);
});

test('les échéances sortent triées', () => {
  const e = echeances(jardin, '2026-01-01', '2027-12-31');
  const trie = [...e].sort((a, b) => a.echeance.localeCompare(b.echeance));
  assert.deepEqual(e, trie);
});

test('une récurrence de séjour n\'engendre rien au calendrier', () => {
  assert.deepEqual(echeances(compteurs, '2026-01-01', '2030-12-31'), []);
});

test('une récurrence de séjour engendre son occurrence au départ', () => {
  const e = pourSejour(compteurs, '2026-07-19');
  assert.deepEqual(e, {
    recurrenceId: 3, libelle: 'Relevé des compteurs', categorie: 'courant', echeance: '2026-07-19',
  });
  assert.equal(pourSejour(ramonage, '2026-07-19'), null, 'seule une récurrence de séjour répond');
  assert.equal(pourSejour(compteurs, 'pas-une-date'), null);
});

test('une fenêtre absurde ne rend rien plutôt que de boucler', () => {
  assert.deepEqual(echeances(ramonage, '2028-01-01', '2026-01-01'), []);
  assert.deepEqual(echeances(ramonage, 'n\'importe quoi', '2026-01-01'), []);
});

test('une annuelle sans date limite est refusée à la saisie', () => {
  assert.throws(() => controler({ periodicite: 'annuelle', limiteMmjj: null, moisDebut: null, moisFin: null }),
    (e: Error) => {
      assert.ok(e instanceof RecurrenceInvalide);
      assert.match(e.message, /10-15/, 'le message doit donner un exemple du format attendu');
      return true;
    });
});

test('une date limite qui n\'existe pas est refusée, pas rabattue en silence', () => {
  assert.throws(() => controler({ periodicite: 'annuelle', limiteMmjj: '02-30', moisDebut: null, moisFin: null }),
    /n'a pas 30 jours/);
  assert.throws(() => controler({ periodicite: 'annuelle', limiteMmjj: '13-01', moisDebut: null, moisFin: null }),
    RecurrenceInvalide);
  // Le 29 février est accepté : il existe une année sur quatre, et l'échéance
  // se pose alors au 29, ce qui est ce que veut dire « fin février ».
  assert.doesNotThrow(() => controler({ periodicite: 'annuelle', limiteMmjj: '02-29', moisDebut: null, moisFin: null }));
});

test('une saison à l\'envers est refusée avec la marche à suivre', () => {
  assert.throws(() => controler({ periodicite: 'mensuelle', limiteMmjj: null, moisDebut: 11, moisFin: 3 }),
    (e: Error) => {
      assert.match(e.message, /deux récurrences/, 'le message doit dire comment faire autrement');
      return true;
    });
});

test('le libellé se lit comme dans la maquette', () => {
  assert.equal(lisible(ramonage), 'Tous les ans, avant le 15 oct.');
  assert.equal(lisible(jardin), 'Tous les mois, avr. à oct.');
  assert.equal(lisible(compteurs), 'À chaque séjour');
  assert.equal(lisible({ periodicite: 'mensuelle', limiteMmjj: null, moisDebut: 1, moisFin: 12 }),
    'Tous les mois');
  assert.equal(lisible({ periodicite: 'annuelle', limiteMmjj: null, moisDebut: null, moisFin: null }),
    'Tous les ans');
});

test('l\'urgence classe le retard, le proche et le reste', () => {
  const aujourdhui = '2026-09-05';
  assert.equal(urgence('2026-09-04', aujourdhui), 'en_retard');
  assert.equal(urgence('2026-09-05', aujourdhui), 'proche', "aujourd'hui n'est pas en retard");
  assert.equal(urgence('2026-10-05', aujourdhui), 'proche', 'trente jours, borne comprise');
  assert.equal(urgence('2026-10-06', aujourdhui), 'plus_tard');
  assert.equal(urgence(null, aujourdhui), 'plus_tard', 'une tâche sans échéance ne presse pas');
  assert.equal(urgence('', aujourdhui), 'plus_tard');
});
