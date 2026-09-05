// La reprise du planning existant.
//
// « Sans reprise de l'existant, ma mère ne basculera pas. » Ces tests portent
// donc autant sur ce que l'import accepte que sur ce qu'il refuse **en le
// disant** : une ligne perdue en silence dans un planning de trois cents lignes
// ne se retrouve jamais.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amorcer, demarrer } from './aide';
import { lireCsv, separateur, lire } from '../src/sejours/import/tableau';
import { proposer, versDate, versNature, versStatut } from '../src/sejours/import/correspondance';
import { preparer } from '../src/sejours/import/execution';
import { xlsx, zip } from './zip-fabrique';

test('le séparateur se devine sur la régularité des colonnes', () => {
  assert.equal(separateur('a;b;c\n1;2;3\n4;5;6'), ';');
  assert.equal(separateur('a,b,c\n1,2,3\n4,5,6'), ',');
  assert.equal(separateur('a\tb\tc\n1\t2\t3'), '\t');
  // Un texte qui contient des virgules dans les cellules mais des
  // points-virgules comme séparateur : la régularité doit trancher.
  assert.equal(separateur('nom;note\nJulien;venu avec Sofia, et les enfants\nClaire;rien'), ';');
});

test('les guillemets et les retours à la ligne sont respectés', () => {
  const t = lireCsv('nom;note\n"Julien";"il a dit ""oui"" ;-)"\nClaire;simple', ';');
  assert.deepEqual(t, [['nom', 'note'], ['Julien', 'il a dit "oui" ;-)'], ['Claire', 'simple']]);
});

test('les dates sont lues dans les formes qu\'un tableur produit', () => {
  assert.equal(versDate('08/08/2026'), '2026-08-08', 'jour d\'abord, format français');
  assert.equal(versDate('8/8/26'), '2026-08-08');
  assert.equal(versDate('2026-08-08'), '2026-08-08');
  assert.equal(versDate('08.08.2026'), '2026-08-08');
  assert.equal(versDate('8 août 2026'), '2026-08-08');
  assert.equal(versDate('8 aout'), `${new Date().getUTCFullYear()}-08-08`);
  // Numéro de série d'une cellule au format date dans un .xlsx.
  assert.equal(versDate('46242'), '2026-08-08');
  // Le mois d'abord quand le jour dépasse douze : un tableur en anglais.
  assert.equal(versDate('8/16/2026'), '2026-08-16');
});

test('une date impossible est refusée, jamais rapprochée', () => {
  assert.equal(versDate('32/08/2026'), null);
  assert.equal(versDate('29/02/2026'), null, '2026 n\'est pas bissextile');
  assert.equal(versDate('29/02/2024'), '2024-02-29');
  assert.equal(versDate('la semaine du 8'), null);
  assert.equal(versDate(''), null);
  assert.equal(versDate('à confirmer'), null);
});

test('la nature et le statut se déduisent du vocabulaire du planning', () => {
  assert.equal(versNature('Location'), 'location');
  assert.equal(versNature('loué'), 'location');
  assert.equal(versNature('Travaux'), 'entretien');
  assert.equal(versNature('Ménage'), 'entretien');
  assert.equal(versNature('Famille'), 'famille');
  assert.equal(versNature(''), 'famille');
  assert.equal(versStatut('à confirmer'), 'demande');
  assert.equal(versStatut('?'), 'demande');
  assert.equal(versStatut('OK'), 'valide');
  assert.equal(versStatut(''), 'valide');
});

test('les colonnes se reconnaissent sur les intitulés habituels', () => {
  const c = proposer(['Bien', 'Qui', 'Du', 'Au', 'Nb personnes', 'Type', 'Remarque']);
  assert.equal(c.bien, 0);
  assert.equal(c.titre, 1);
  assert.equal(c.arrivee, 2);
  assert.equal(c.depart, 3);
  assert.equal(c.occupants, 4);
  assert.equal(c.nature, 5);
  assert.equal(c.note, 6);
});

test('une colonne non reconnue vaut -1 plutôt qu\'une correspondance au hasard', () => {
  const c = proposer(['Colonne A', 'Colonne B']);
  assert.equal(c.arrivee, -1);
  assert.equal(c.depart, -1);
});

const BIENS = [{ id: 1, nom: "Maison de Kerloc'h" }, { id: 2, nom: 'Les Arcs 1800' }];

function rapportDe(lignes: string[][], existants: { bienId: number; arrivee: string; depart: string; titre: string }[] = []) {
  const correspondance = proposer(lignes[0]);
  return preparer({ lignes, ligneEntete: 0, correspondance, biens: BIENS, bienParDefaut: 1, existants });
}

test('un planning ordinaire se lit en entier', () => {
  const r = rapportDe([
    ['Bien', 'Qui', 'Du', 'Au', 'Nb personnes', 'Type'],
    ["Kerloc'h", 'Julien et Sofia', '08/08/2026', '16/08/2026', '4', 'Famille'],
    ['Les Arcs', 'Claire et Marc', '15/08/2026', '22/08/2026', '5', 'Famille'],
    ["Kerloc'h", 'Berger', '01/08/2026', '08/08/2026', '6', 'Location'],
  ]);
  assert.equal(r.lues, 3);
  assert.equal(r.refusees.length, 0);
  assert.deepEqual(r.aCreer.map((l) => [l.bienId, l.titre, l.arrivee, l.depart, l.occupants, l.nature]), [
    [1, 'Julien et Sofia', '2026-08-08', '2026-08-16', 4, 'famille'],
    [2, 'Claire et Marc', '2026-08-15', '2026-08-22', 5, 'famille'],
    [1, 'Berger', '2026-08-01', '2026-08-08', 6, 'location'],
  ]);
});

test('un nom de bien approché est rattrapé, un nom inconnu est refusé', () => {
  const r = rapportDe([
    ['Bien', 'Qui', 'Du', 'Au'],
    ['Kerloch', 'Julien', '08/08/2026', '16/08/2026'],
    ['La Bergerie', 'Claire', '08/08/2026', '16/08/2026'],
  ]);
  assert.equal(r.aCreer.length, 1);
  assert.equal(r.aCreer[0].bienId, 1, '« Kerloch » doit retrouver « Maison de Kerloc\'h »');
  assert.equal(r.refusees.length, 1);
  assert.match(r.refusees[0].raison, /Bien inconnu : « La Bergerie »/);
  assert.equal(r.refusees[0].numero, 3, 'le numéro doit être celui de la ligne dans le tableur');
});

test('chaque ligne refusée dit pourquoi, avec son numéro', () => {
  const r = rapportDe([
    ['Qui', 'Du', 'Au'],
    ['Julien', 'la semaine du 8', '16/08/2026'],
    ['Claire', '16/08/2026', '08/08/2026'],
    ['Thomas', '08/08/2026', '08/08/2026'],
    ['Sofia', '08/08/2026', ''],
  ]);
  assert.equal(r.aCreer.length, 0);
  assert.equal(r.refusees.length, 4);
  assert.match(r.refusees[0].raison, /Date d'arrivée illisible/);
  assert.match(r.refusees[1].raison, /doit être après/);
  assert.match(r.refusees[2].raison, /d'une seule nuit s'écrit du 8 au 9/);
  assert.match(r.refusees[3].raison, /Date de départ illisible/);
  assert.deepEqual(r.refusees.map((x) => x.numero), [2, 3, 4, 5]);
});

test('les lignes vides du tableur ne comptent pas', () => {
  const r = rapportDe([
    ['Qui', 'Du', 'Au'],
    ['Julien', '08/08/2026', '16/08/2026'],
    ['', '', ''],
    [],
    ['Claire', '20/08/2026', '27/08/2026'],
  ]);
  assert.equal(r.lues, 2);
  assert.equal(r.aCreer.length, 2);
});

test('relancer le même fichier ne crée pas de doublon', () => {
  const lignes = [
    ['Qui', 'Du', 'Au'],
    ['Julien et Sofia', '08/08/2026', '16/08/2026'],
  ];
  const premier = rapportDe(lignes);
  assert.equal(premier.aCreer.length, 1);

  // Deuxième passage, avec ce que le premier a créé.
  const second = rapportDe(lignes, [
    { bienId: 1, arrivee: '2026-08-08', depart: '2026-08-16', titre: 'Julien et Sofia' },
  ]);
  assert.equal(second.aCreer.length, 0);
  assert.equal(second.doublons.length, 1);
  assert.equal(second.doublons[0].numero, 2);
});

test('la déduplication ignore la casse et les accents du nom', () => {
  const r = rapportDe(
    [['Qui', 'Du', 'Au'], ['HÉLÈNE', '08/08/2026', '16/08/2026']],
    [{ bienId: 1, arrivee: '2026-08-08', depart: '2026-08-16', titre: 'Hélène' }],
  );
  assert.equal(r.doublons.length, 1);
});

test('un doublon à l\'intérieur du même fichier est vu', () => {
  const r = rapportDe([
    ['Qui', 'Du', 'Au'],
    ['Julien', '08/08/2026', '16/08/2026'],
    ['Julien', '08/08/2026', '16/08/2026'],
  ]);
  assert.equal(r.aCreer.length, 1);
  assert.equal(r.doublons.length, 1);
});

test('un vrai .xlsx se lit, et un faux .xls annoncé comme tel est refusé avec une consigne', () => {
  const contenu = xlsx([
    ['Planning Kerloc\'h 2026', '', ''],
    ['Qui', 'Du', 'Au'],
    ['Julien', '08/08/2026', '16/08/2026'],
  ]);
  const lu = lire(contenu);
  assert.match(lu.format, /Classeur Excel/);
  assert.deepEqual(lu.lignes[1], ['Qui', 'Du', 'Au']);

  // Un classeur Excel 97-2003 : le seul format que nous choisissons de ne pas
  // décoder, et le refus doit dire quoi faire.
  const ole2 = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]);
  assert.throws(() => lire(ole2), /réenregistrez-le en \.xlsx/);
});

test('un tableau HTML déguisé en .xls se lit quand même', () => {
  const html = '<html><body><table><tr><th>Qui</th><th>Du</th><th>Au</th></tr>'
    + '<tr><td>Julien</td><td>08/08/2026</td><td>16/08/2026</td></tr></table></body></html>';
  const lu = lire(Buffer.from(html, 'utf8'));
  assert.match(lu.format, /Tableau HTML/);
  assert.deepEqual(lu.lignes, [['Qui', 'Du', 'Au'], ['Julien', '08/08/2026', '16/08/2026']]);
});

test('un fichier Windows-1252 garde ses accents', () => {
  // « Hélène » en Windows-1252 : é vaut 0xE9, è vaut 0xE8.
  const octets = Buffer.from([0x51, 0x75, 0x69, 0x0a, 0x48, 0xe9, 0x6c, 0xe8, 0x6e, 0x65]);
  const lu = lire(octets);
  assert.equal(lu.encodage, 'Windows-1252');
  assert.deepEqual(lu.lignes, [['Qui'], ['Hélène']]);
});

test('une archive dont une entrée annonce une taille démesurée est refusée', () => {
  // Une bombe de décompression : le point qui avait coûté cher à Foyer-App.
  const bombe = zip([{ nom: 'xl/worksheets/sheet1.xml', contenu: Buffer.alloc(1024) }]);
  // On maquille la taille décompressée annoncée dans le répertoire central.
  const central = bombe.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bombe.writeUInt32LE(0x7fffffff, central + 24);
  assert.throws(() => lire(bombe), /dépasse 64 Mo une fois décompressée/);
});

// ------------------------------------------------------------------
// De bout en bout, par les routes
// ------------------------------------------------------------------

test('analyse, simulation puis exécution, et l\'import s\'annule en bloc', async () => {
  const i = await demarrer();
  try {
    const base = await amorcer(i);
    const contenu = Buffer.from(
      'Qui;Du;Au;Nb personnes;Type\n'
      + 'Julien et Sofia;08/08/2026;16/08/2026;4;Famille\n'
      + 'Berger;01/08/2026;08/08/2026;6;Location\n'
      + 'Erreur;pas une date;16/08/2026;2;Famille\n', 'utf8');

    const analyse = await i.appel<{ lignes: string[][]; ligneEntete: number; correspondance: Record<string, number>; sha: string; format: string }>(
      'POST', '/api/import/analyse', contenu, { 'content-type': 'text/csv', 'x-nom-fichier': 'planning.csv' });
    assert.equal(analyse.statut, 200);
    assert.match(analyse.corps.format, /Texte séparé/);
    assert.equal(analyse.corps.ligneEntete, 0);

    const options = {
      lignes: analyse.corps.lignes, ligneEntete: 0,
      correspondance: analyse.corps.correspondance, bienParDefaut: base.bienId,
      sha: analyse.corps.sha, nom: 'planning.csv',
    };

    const simulation = await i.post<{ lues: number; aCreer: unknown[]; refusees: { raison: string }[] }>('/api/import/simulation', options);
    assert.equal(simulation.corps.lues, 3);
    assert.equal(simulation.corps.aCreer.length, 2);
    assert.equal(simulation.corps.refusees.length, 1);
    // Rien n'a été écrit : la simulation ne touche pas à la base.
    assert.equal((i.db.prepare('SELECT COUNT(*) AS n FROM sejour').get() as { n: number }).n, 0);

    const execution = await i.post<{ importRunId: number; creees: number }>('/api/import/execution', options);
    assert.equal(execution.corps.creees, 2);
    assert.equal((i.db.prepare('SELECT COUNT(*) AS n FROM sejour').get() as { n: number }).n, 2);

    // Rejouable : le même fichier ne crée rien de plus.
    const rejeu = await i.post<{ aCreer: unknown[]; doublons: unknown[] }>('/api/import/simulation', options);
    assert.equal(rejeu.corps.aCreer.length, 0);
    assert.equal(rejeu.corps.doublons.length, 2);

    // Annulable en bloc, sans rien effacer.
    const annulation = await i.post<{ archives: number }>(`/api/import/${execution.corps.importRunId}/annulation`);
    assert.equal(annulation.corps.archives, 2);
    const restants = i.db.prepare('SELECT COUNT(*) AS n FROM sejour WHERE archive_le IS NULL').get() as { n: number };
    assert.equal(restants.n, 0);
    const total = i.db.prepare('SELECT COUNT(*) AS n FROM sejour').get() as { n: number };
    assert.equal(total.n, 2, 'archivé, pas supprimé');
  } finally { await i.fermer(); }
});

test('on n\'importe pas dans un bien qu\'on ne gère pas', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    const r = await i.post<{ code: string }>('/api/import/simulation', {
      lignes: [['Qui', 'Du', 'Au'], ['Julien', '08/08/2026', '16/08/2026']],
      ligneEntete: 0, correspondance: { titre: 0, arrivee: 1, depart: 2 }, bienParDefaut: 9999,
    });
    assert.equal(r.statut, 403);
  } finally { await i.fermer(); }
});
