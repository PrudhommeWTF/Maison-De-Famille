// Les vacances scolaires.
//
// Le calcul ne s'invente rien : il lit une table, désormais en base. Ce qui se
// teste, c'est donc la lecture, les recoupements d'intervalles, le regroupement
// des trois zones quand elles partent ensemble, et surtout **l'aveu
// d'ignorance** quand une année n'est pas renseignée. Une famille qui ne voit
// aucune vacance en février doit pouvoir distinguer « il n'y en a pas » de
// « personne n'a mis la table à jour ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirEnMemoire } from '../src/noyau/db';
import { appliquer } from '../src/noyau/migrations';
import { anneesCouvertes, periodesEntre, resume } from '../src/calendrier/repo';
import {
  PeriodeAnnuelle, ZONES, anneeScolaire, anneesTraversees, collapser, couvre, entre, zonesEnVacances,
} from '../src/calendrier/vacances';
import fs from 'fs';
import os from 'os';
import path from 'path';

/** Une base migrée, seule et jetable : la graine de la migration 008 y est. */
function base() {
  const db = ouvrirEnMemoire();
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'mdf-vac-'));
  appliquer(db, dossier);
  return db;
}

const COUVERTES = ['2025-2026'];

test("l'année scolaire bascule au 1er septembre", () => {
  assert.equal(anneeScolaire('2026-08-31'), '2025-2026');
  assert.equal(anneeScolaire('2026-09-01'), '2026-2027');
  assert.equal(anneeScolaire('2026-01-15'), '2025-2026');
  assert.equal(anneeScolaire('2026-12-25'), '2026-2027');
});

test('un intervalle long traverse toutes les années intermédiaires', () => {
  assert.deepEqual(anneesTraversees('2026-02-01', '2026-03-01'), ['2025-2026']);
  assert.deepEqual(anneesTraversees('2025-10-01', '2027-10-01'), ['2025-2026', '2026-2027', '2027-2028']);
});

test('une année non renseignée est annoncée, pas silencieuse', () => {
  assert.equal(couvre('2026-02-01', '2026-02-28', COUVERTES), true);
  assert.equal(couvre('2030-02-01', '2030-02-28', COUVERTES), false,
    "la table ne va pas jusque-là, et l'application doit le dire");
  // Un intervalle à cheval sur une année couverte et une autre ne l'est pas.
  assert.equal(couvre('2026-08-01', '2026-10-01', COUVERTES), false);
});

test("les vacances d'hiver décalent bien les trois zones", () => {
  const db = base();
  const hiver = periodesEntre(db, '2026-02-01', '2026-03-15').filter((x) => x.nom === 'Hiver');
  assert.equal(hiver.length, 3, 'une période par zone');
  assert.deepEqual(hiver.map((x) => x.zone), ['A', 'B', 'C'], 'triées par date de début');
  // Chaque zone commence une semaine après la précédente.
  assert.deepEqual(hiver.map((x) => x.debut), ['2026-02-07', '2026-02-14', '2026-02-21']);
});

test('on ne demande que les zones qui concernent la famille', () => {
  const db = base();
  const p = periodesEntre(db, '2026-02-01', '2026-03-15');
  assert.deepEqual(entre(p, '2026-02-01', '2026-03-15', ['A']).filter((x) => x.nom === 'Hiver').map((x) => x.zone), ['A']);
  // Une période commune reste visible même en filtrant sur une zone.
  const noel = entre(periodesEntre(db, '2025-12-24', '2025-12-26'), '2025-12-24', '2025-12-26', ['A']);
  assert.equal(noel.length, 1);
  assert.equal(noel[0].zone, null, 'les trois zones partent ensemble : une seule période');
});

test('une période commune met les trois zones en vacances', () => {
  const p = periodesEntre(base(), '2025-12-01', '2026-01-31');
  assert.deepEqual(zonesEnVacances('2025-12-25', p), [...ZONES]);
  assert.deepEqual(zonesEnVacances('2025-12-19', p), [], "la veille, c'est encore la classe");
});

test("un jour d'hiver ne concerne que les zones qui y sont", () => {
  const p = periodesEntre(base(), '2026-02-01', '2026-03-15');
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
  const p = entre(periodesEntre(base(), '2026-02-01', '2026-03-15'), '2026-02-01', '2026-03-15', ['A']);
  assert.deepEqual(zonesEnVacances('2026-02-07', p), ['A'], 'premier jour');
  assert.deepEqual(zonesEnVacances('2026-02-22', p), ['A'], 'dernier jour');
  assert.deepEqual(zonesEnVacances('2026-02-23', p), [], 'la reprise');
});

test('une période qui ne couvre pas les trois zones ne se regroupe pas', () => {
  const deux: PeriodeAnnuelle[] = [
    { anneeScolaire: '2025-2026', nom: 'Essai', zone: 'A', debut: '2026-05-01', fin: '2026-05-05' },
    { anneeScolaire: '2025-2026', nom: 'Essai', zone: 'B', debut: '2026-05-01', fin: '2026-05-05' },
  ];
  assert.deepEqual(collapser(deux).map((p) => p.zone), ['A', 'B'],
    'sans la zone C, on ne peut pas dire « toutes zones »');
  const trois: PeriodeAnnuelle[] = [...deux, { ...deux[0], zone: 'C' }];
  assert.deepEqual(collapser(trois).map((p) => p.zone), [null]);
  // Des dates différentes ne se regroupent pas, même sous le même nom.
  const decalees: PeriodeAnnuelle[] = [...deux, { ...deux[0], zone: 'C', debut: '2026-05-08', fin: '2026-05-12' }];
  assert.deepEqual(collapser(decalees).map((p) => p.zone), ['A', 'B', 'C']);
});

test('la table livrée est cohérente : dates valides et fin après début', () => {
  const db = base();
  assert.deepEqual(anneesCouvertes(db), COUVERTES);
  const lignes = db.prepare('SELECT annee_scolaire AS a, nom, zone, debut, fin FROM vacance_scolaire')
    .all() as { a: string; nom: string; zone: string; debut: string; fin: string }[];
  assert.ok(lignes.length > 0, 'la migration doit avoir semé le calendrier connu');
  for (const l of lignes) {
    assert.match(l.debut, /^\d{4}-\d{2}-\d{2}$/, `${l.a} ${l.nom} début`);
    assert.match(l.fin, /^\d{4}-\d{2}-\d{2}$/, `${l.a} ${l.nom} fin`);
    assert.ok(l.fin > l.debut, `${l.a} ${l.nom} : la fin doit suivre le début`);
    // Toute période doit tomber dans son année scolaire, sinon la recherche
    // par année ne la trouverait jamais.
    assert.equal(anneeScolaire(l.debut), l.a, `${l.a} ${l.nom} ${l.zone} mal rangée`);
  }
});

test("chaque année en base l'est pour les trois zones", () => {
  const db = base();
  const lignes = db.prepare('SELECT annee_scolaire AS a, nom, zone FROM vacance_scolaire')
    .all() as { a: string; nom: string; zone: string }[];
  const paquets = new Map<string, string[]>();
  for (const l of lignes) paquets.set(`${l.a} ${l.nom}`, [...(paquets.get(`${l.a} ${l.nom}`) ?? []), l.zone]);
  for (const [cle, zones] of paquets) {
    assert.deepEqual(zones.sort(), [...ZONES], `${cle} : une zone manque`);
  }
});

test("le résumé dit d'où vient chaque année", () => {
  const [premiere] = resume(base());
  assert.equal(premiere.anneeScolaire, '2025-2026');
  assert.equal(premiere.periodes, 15, '9 périodes dont 3 nationales, éclatées par zone');
  assert.equal(premiere.debut, '2025-10-18');
  assert.equal(premiere.fin, '2026-08-31');
  assert.match(premiere.source, /livrée avec l'application/);
  assert.equal(premiere.importePar, null, 'personne ne l\'a téléversée : elle est d\'origine');
});
