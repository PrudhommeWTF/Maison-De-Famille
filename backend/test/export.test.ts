// Export et réversibilité.
//
// « J'exporte tout, je restaure sur une instance vierge, je retrouve la même
// chose. » C'est un point de recette, donc c'est un test : l'archive est
// produite, décompressée, et la base qu'elle contient est rouverte et
// interrogée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import Database from 'better-sqlite3';
import { amorcer, demarrer } from './aide';
import { champ, euros, tableau } from '../src/export/csv';
import { tar } from '../src/export/archive';

test('un champ CSV est échappé pour Excel, sans injection de formule', () => {
  assert.equal(champ('simple'), 'simple');
  assert.equal(champ('avec;point-virgule'), '"avec;point-virgule"');
  assert.equal(champ('avec "guillemets"'), '"avec ""guillemets"""');
  assert.equal(champ('sur\ndeux lignes'), '"sur\ndeux lignes"');
  assert.equal(champ(null), '');
  // Une cellule qui commence par « = » serait exécutée comme une formule à
  // l'ouverture : le préfixe apostrophe la neutralise.
  assert.equal(champ('=1+1'), "'=1+1");
  assert.equal(champ('+33 6 12 34 56 78'), "'+33 6 12 34 56 78");
  assert.equal(champ('@sofia'), "'@sofia");
});

test('un CSV porte la marque d\'octets Unicode, sans laquelle Excel casse les accents', () => {
  const csv = tableau(['Bien', 'Qui'], [["Maison de Kerloc'h", 'Hélène']]);
  assert.ok(csv.startsWith('﻿'), 'sans le BOM, « Hélène » devient illisible dans Excel');
  assert.ok(csv.includes('Bien;Qui'), 'le point-virgule est le séparateur attendu en configuration française');
  assert.ok(csv.endsWith('\r\n'));
});

test('les montants sont écrits avec la virgule décimale', () => {
  assert.equal(euros(234000), '2340,00');
  assert.equal(euros(5), '0,05');
  assert.equal(euros(0), '0,00');
});

test('l\'archive tar produite se relit avec l\'outil du système', () => {
  const contenu = tar([
    { nom: 'dossier/fichier.txt', contenu: 'bonjour' },
    { nom: 'dossier/autre.bin', contenu: Buffer.from([1, 2, 3, 4]) },
  ]);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mdf-tar-'));
  try {
    const chemin = path.join(d, 'a.tar');
    fs.writeFileSync(chemin, contenu);
    // Décompressé par tar lui-même : c'est la seule preuve qui compte, un
    // lecteur écrit par nous qui relit notre écrivain ne prouverait rien.
    const { execFileSync } = require('child_process') as typeof import('child_process');
    execFileSync('tar', ['-xf', chemin, '-C', d]);
    assert.equal(fs.readFileSync(path.join(d, 'dossier', 'fichier.txt'), 'utf8'), 'bonjour');
    assert.deepEqual([...fs.readFileSync(path.join(d, 'dossier', 'autre.bin'))], [1, 2, 3, 4]);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('l\'export complet se restaure sur une instance vierge', async () => {
  const i = await demarrer();
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mdf-restaure-'));
  try {
    const base = await amorcer(i);
    await i.post(`/api/biens/${base.bienId}/sejours`, {
      arrivee: '2026-08-08', depart: '2026-08-16', occupants: 4, titre: 'Julien et Sofia',
    });
    // Une photo, pour que l'archive porte aussi des octets sur le disque.
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7),
    ]);
    const photo = await i.appel('POST', `/api/biens/${base.bienId}/photo`, png,
      { 'content-type': 'image/png', 'x-nom-fichier': 'kerloch.png' });
    assert.equal(photo.statut, 200);

    // Appel direct plutôt que par le client de test : l'archive est binaire et
    // ne doit pas passer par le décodage JSON.
    const brut = await fetch(`${i.url}/api/export/instance.tar.gz`, { headers: i.entetesAuth });
    assert.equal(brut.status, 200);
    assert.match(brut.headers.get('content-disposition') ?? '', /maison-de-famille-\d{4}-\d{2}-\d{2}\.tar\.gz/);
    const archive = Buffer.from(await brut.arrayBuffer());

    const chemin = path.join(d, 'export.tar.gz');
    fs.writeFileSync(chemin, zlib.gunzipSync(archive));
    const { execFileSync } = require('child_process') as typeof import('child_process');
    execFileSync('tar', ['-xf', chemin, '-C', d]);

    const racine = path.join(d, 'maison-de-famille');
    const manifeste = JSON.parse(fs.readFileSync(path.join(racine, 'manifeste.json'), 'utf8')) as { schema: number };
    assert.ok(manifeste.schema >= 1);

    // La base restaurée porte les mêmes données.
    const copie = new Database(path.join(racine, 'maison.db'), { readonly: true });
    const sejour = copie.prepare('SELECT titre, arrivee, depart FROM sejour').get() as { titre: string; arrivee: string; depart: string };
    assert.deepEqual(sejour, { titre: 'Julien et Sofia', arrivee: '2026-08-08', depart: '2026-08-16' });
    const personnes = copie.prepare('SELECT COUNT(*) AS n FROM personne').get() as { n: number };
    assert.equal(personnes.n, 1);
    copie.close();

    // Et les pièces jointes sont là, octet pour octet.
    const fichiers: string[] = [];
    const parcours = (p: string): void => {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        if (e.isDirectory()) parcours(path.join(p, e.name)); else fichiers.push(path.join(p, e.name));
      }
    };
    parcours(path.join(racine, 'fichiers'));
    assert.equal(fichiers.length, 1);
    assert.deepEqual(fs.readFileSync(fichiers[0]), png);
  } finally {
    await i.fermer();
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('l\'export complet est réservé au gérant', async () => {
  const i = await demarrer();
  try {
    const base = await amorcer(i);
    const foyer = await i.post<{ id: number }>('/api/foyers', { nom: 'Julien' });
    const { creerCompte } = await import('./aide');
    const julienId = await creerCompte(i, 'Julien', 'julien@exemple.fr', foyer.corps.id);
    await i.post(`/api/structures/${base.structureId}/detentions`, {
      dateEffet: '2019-06-01', motif: 'Succession',
      parts: [{ personneId: 1, parts: 1 }, { personneId: julienId, parts: 1 }],
    });
    const { MOT_DE_PASSE } = await import('./aide');
    await i.connexion('julien@exemple.fr', MOT_DE_PASSE);
    assert.equal((await i.get('/api/export/instance.tar.gz')).statut, 403);
    // Le CSV de ses séjours, lui, reste accessible : c'est sa réversibilité.
    assert.equal((await i.get('/api/export/sejours.csv')).statut, 200);
  } finally { await i.fermer(); }
});
