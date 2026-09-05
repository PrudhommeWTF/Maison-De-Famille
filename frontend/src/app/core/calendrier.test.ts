// La grille du calendrier.
//
// Le cas qui compte : une case porte la NUIT qui commence ce jour-là. Le jour du
// départ n'est donc pas coloré, ce qui permet à une rotation le même jour de
// s'afficher correctement, avec un seul séjour par case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OccupationGrille, grilleDuMois, occupationsDuMois, teinteDe } from './calendrier';

const occ = (o: Partial<OccupationGrille> & { id: number; arrivee: string; depart: string }): OccupationGrille => ({
  titre: 'Séjour', nature: 'famille', statut: 'valide', ...o,
});

/** La case d'une date donnée, dans une grille. */
function caseDe(semaines: ReturnType<typeof grilleDuMois>, date: string) {
  for (const s of semaines) for (const c of s.cases) if (c.date === date) return c;
  throw new Error(`Case introuvable : ${date}`);
}

test('la grille commence au bon jour de la semaine', () => {
  // Le 1er août 2026 est un samedi.
  const lundi = grilleDuMois(2026, 7, []);
  assert.equal(lundi[0].cases.filter((c) => c.jour === null).length, 5, 'cinq cases vides avant samedi');
  assert.equal(lundi[0].cases[5].jour, 1);

  const dimanche = grilleDuMois(2026, 7, [], { dimancheDabord: true });
  assert.equal(dimanche[0].cases.filter((c) => c.jour === null).length, 6);
  assert.equal(dimanche[0].cases[6].jour, 1);
});

test('la grille est toujours faite de semaines complètes', () => {
  for (const mois of [0, 1, 6, 11]) {
    const g = grilleDuMois(2026, mois, []);
    for (const s of g) assert.equal(s.cases.length, 7);
  }
  // Février 2027 commence un lundi et fait 28 jours : exactement quatre semaines.
  assert.equal(grilleDuMois(2027, 1, []).length, 4);
});

test('la nuit de départ n\'est pas colorée', () => {
  const g = grilleDuMois(2026, 7, [occ({ id: 1, arrivee: '2026-08-08', depart: '2026-08-16' })]);
  assert.equal(caseDe(g, '2026-08-15').occupations.length, 1, 'la dernière nuit est celle du 15');
  assert.equal(caseDe(g, '2026-08-16').occupations.length, 0, 'le jour du départ est libre');
});

test('une rotation le même jour ne met qu\'un séjour par case', () => {
  const g = grilleDuMois(2026, 7, [
    occ({ id: 1, arrivee: '2026-08-01', depart: '2026-08-08', nature: 'location', titre: 'Berger' }),
    occ({ id: 2, arrivee: '2026-08-08', depart: '2026-08-16', titre: 'Julien' }),
  ]);
  const rotation = caseDe(g, '2026-08-08');
  assert.equal(rotation.occupations.length, 1);
  assert.equal(rotation.libelle, 'Julien');
  assert.equal(caseDe(g, '2026-08-07').occupations[0].titre, 'Berger');
});

test('le libellé n\'apparaît que le premier jour de la plage', () => {
  const g = grilleDuMois(2026, 7, [occ({ id: 1, arrivee: '2026-08-08', depart: '2026-08-16', titre: 'Julien' })]);
  assert.equal(caseDe(g, '2026-08-08').libelle, 'Julien');
  assert.equal(caseDe(g, '2026-08-09').libelle, '', 'répéter le nom sur huit cases rendrait la grille illisible');
});

test('un séjour à cheval sur deux mois s\'affiche dans les deux', () => {
  const s = [occ({ id: 1, arrivee: '2026-07-28', depart: '2026-08-04', titre: 'Claire' })];
  const juillet = grilleDuMois(2026, 6, s);
  const aout = grilleDuMois(2026, 7, s);
  assert.equal(caseDe(juillet, '2026-07-31').occupations.length, 1);
  assert.equal(caseDe(aout, '2026-08-01').occupations.length, 1);
  assert.equal(caseDe(aout, '2026-08-01').libelle, '', 'le libellé reste au premier jour réel');
  assert.equal(caseDe(aout, '2026-08-04').occupations.length, 0);
});

test('un séjour validé l\'emporte sur une demande pour la couleur de la case', () => {
  const g = grilleDuMois(2026, 7, [
    occ({ id: 1, arrivee: '2026-08-08', depart: '2026-08-16', statut: 'demande', titre: 'Julien' }),
    occ({ id: 2, arrivee: '2026-08-08', depart: '2026-08-16', statut: 'valide', titre: 'Claire' }),
  ]);
  const c = caseDe(g, '2026-08-10');
  assert.equal(c.occupations.length, 2);
  assert.equal(c.teinte.tirets, false, 'une case en tirets laisserait croire que la date est libre');
  assert.equal(c.teinte.fond, '#f0e0d5');
});

test('les nuits en conflit viennent du serveur et se marquent sur la grille', () => {
  const g = grilleDuMois(2026, 7, [occ({ id: 1, arrivee: '2026-08-06', depart: '2026-08-16' })],
    { nuitsEnConflit: ['2026-08-06', '2026-08-07'] });
  assert.equal(caseDe(g, '2026-08-06').enConflit, true);
  assert.equal(caseDe(g, '2026-08-08').enConflit, false);
});

test('une demande se distingue visuellement de ce qui est acquis', () => {
  assert.equal(teinteDe('famille', 'demande').tirets, true);
  assert.equal(teinteDe('famille', 'valide').tirets, false);
  assert.equal(teinteDe('location', 'valide').fond, '#e4e9dc');
  assert.equal(teinteDe('entretien', 'valide').fond, '#e5e8ea');
});

test('la liste sous la grille reprend ce qui touche le mois, dans l\'ordre', () => {
  const s = [
    occ({ id: 1, arrivee: '2026-08-20', depart: '2026-08-27', titre: 'Thomas' }),
    occ({ id: 2, arrivee: '2026-07-28', depart: '2026-08-04', titre: 'Claire' }),
    occ({ id: 3, arrivee: '2026-09-05', depart: '2026-09-12', titre: 'Hors mois' }),
    occ({ id: 4, arrivee: '2026-08-01', depart: '2026-08-08', titre: 'Berger' }),
  ];
  assert.deepEqual(occupationsDuMois(2026, 7, s).map((o) => o.titre), ['Claire', 'Berger', 'Thomas']);
});

test('un séjour qui finit le premier du mois n\'appartient plus à ce mois', () => {
  // Départ le 1er août : la dernière nuit est celle du 31 juillet.
  const s = [occ({ id: 1, arrivee: '2026-07-25', depart: '2026-08-01' })];
  assert.equal(occupationsDuMois(2026, 7, s).length, 0);
  assert.equal(occupationsDuMois(2026, 6, s).length, 1);
});
