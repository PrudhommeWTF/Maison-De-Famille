// Le rafraîchissement automatique du calendrier scolaire.
//
// C'est la seule écriture de l'application que personne ne demande. Ces tests
// disent exactement jusqu'où elle va, et surtout où elle s'arrête :
//
//   1. **Elle n'ajoute que les années absentes.** Une année qu'un gérant a
//      relue et enregistrée ne se fait pas réécrire par une tâche de fond,
//      même si le portail la publie autrement.
//   2. **Elle ne sort pas pour rien.** Base à jour, aucun octet ne part.
//   3. **Une panne n'est pas un incident.** Portail muet ou année pas encore
//      publiée : rien n'est écrit, et la base reste telle quelle.
//
// Le transport est injecté : rien ici ne touche Internet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ouvrirEnMemoire } from '../src/noyau/db';
import { appliquer } from '../src/noyau/migrations';
import { anneesCouvertes, resume } from '../src/calendrier/repo';
import { SOURCE, SOURCE as ADRESSE, Transport } from '../src/calendrier/telechargement';
import { anneesAttendues, rafraichir } from '../src/calendrier/rafraichissement';

function base() {
  const db = ouvrirEnMemoire();
  appliquer(db, fs.mkdtempSync(path.join(os.tmpdir(), 'mdf-raf-')));
  return db;
}

/** Le portail, tel que le fichier officiel s'exporte, pour deux années scolaires. */
const PORTAIL = [
  'description;start_date;end_date;location;zones;annee_scolaire;population',
  'Vacances de la Toussaint;2026-10-17T00:00:00+02:00;2026-11-02T00:00:00+01:00;Lyon;Zone A;2026-2027;-',
  'Vacances de la Toussaint;2026-10-17T00:00:00+02:00;2026-11-02T00:00:00+01:00;Rennes;Zone B;2026-2027;-',
  'Vacances de la Toussaint;2026-10-17T00:00:00+02:00;2026-11-02T00:00:00+01:00;Paris;Zone C;2026-2027;-',
  "Vacances d'Hiver;2028-02-05T00:00:00+01:00;2028-02-21T00:00:00+01:00;Lyon;Zone A;2027-2028;Élèves",
  "Vacances d'Hiver;2028-02-12T00:00:00+01:00;2028-02-28T00:00:00+01:00;Rennes;Zone B;2027-2028;Élèves",
  "Vacances d'Hiver;2028-02-19T00:00:00+01:00;2028-03-06T00:00:00+01:00;Paris;Zone C;2027-2028;Élèves",
].join('\n');

function faux(corps: string | Error): { transport: Transport; appels: string[] } {
  const appels: string[] = [];
  const transport: Transport = async (url) => {
    appels.push(url);
    if (corps instanceof Error) throw corps;
    const octets = Buffer.from(corps, 'utf8');
    return {
      ok: true, status: 200, url: ADRESSE,
      headers: { get: () => String(octets.length) },
      arrayBuffer: async () => octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) as ArrayBuffer,
    };
  };
  return { transport, appels };
}

test("les années attendues sont celle en cours et la suivante", () => {
  // Septembre a déjà fait basculer l'année scolaire, juin non.
  assert.deepEqual(anneesAttendues('2026-09-07'), ['2026-2027', '2027-2028']);
  assert.deepEqual(anneesAttendues('2026-06-30'), ['2025-2026', '2026-2027']);
});

test('une base à jour ne déclenche aucun appel', async () => {
  const db = base();
  const { transport, appels } = faux(PORTAIL);
  // La graine de la migration 008 couvre 2025-2026 ; en juin, c'est l'année en
  // cours, et la suivante est celle du fichier.
  await rafraichir(db, transport, '2026-06-30');
  assert.deepEqual(appels, [ADRESSE]);

  // Une fois les deux années en base, le passage suivant ne sort plus.
  const r = await rafraichir(db, transport, '2026-06-30');
  assert.equal(r.tentee, false);
  assert.equal(appels.length, 1, 'aucun second appel');
  assert.equal(SOURCE.startsWith('https://data.education.gouv.fr/'), true);
});

test("l'année déjà enregistrée n'est jamais réécrite", async () => {
  const db = base();
  const avant = db.prepare('SELECT COUNT(*) AS n FROM vacance_scolaire').get() as { n: number };

  // Le fichier porte 2026-2027 et 2027-2028, la base porte 2025-2026. Le
  // portail publierait-il 2025-2026 autrement que rien n'y toucherait.
  const { transport } = faux(PORTAIL + '\n'
    + "Vacances d'Hiver;2026-02-07T00:00:00+01:00;2026-02-23T00:00:00+01:00;Lyon;Zone A;2025-2026;Élèves");
  const r = await rafraichir(db, transport, '2026-09-07');

  assert.deepEqual(r.annees, ['2026-2027', '2027-2028']);
  assert.deepEqual(anneesCouvertes(db), ['2025-2026', '2026-2027', '2027-2028']);
  const graine = (db.prepare('SELECT COUNT(*) AS n FROM vacance_scolaire WHERE annee_scolaire = ?')
    .get('2025-2026') as { n: number }).n;
  assert.equal(graine, avant.n, 'la graine est intacte, à la ligne près');

  // La provenance est écrite en clair : l'écran doit pouvoir dire qu'une année
  // est arrivée toute seule, et qu'aucune personne ne l'a déposée.
  const ligne = resume(db).find((a) => a.anneeScolaire === '2026-2027');
  assert.match(String(ligne?.source), /data\.education\.gouv\.fr/);
  assert.equal(ligne?.importePar, null);
});

test('un portail muet ne touche pas à la base', async () => {
  const db = base();
  const { transport } = faux(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
  await assert.rejects(() => rafraichir(db, transport, '2026-09-07'), /n'a pas répondu/);
  assert.deepEqual(anneesCouvertes(db), ['2025-2026']);
});

test("une année pas encore publiée n'est pas une panne", async () => {
  const db = base();
  const { transport } = faux(PORTAIL);
  // 2028-2029 n'est pas dans le fichier : on le dit, on n'écrit rien de faux.
  const r = await rafraichir(db, transport, '2028-09-07');
  assert.equal(r.tentee, true);
  assert.equal(r.ecrites, 0);
  assert.match(String(r.raison), /2028-2029/);
  assert.deepEqual(anneesCouvertes(db), ['2025-2026']);
});
