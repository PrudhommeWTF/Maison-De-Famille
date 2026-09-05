// Les migrations : ce qui protège la base d'une montée de version ratée.
//
// Le cas que ces tests couvrent est celui qui coûte le plus cher en production :
// un déploiement en arrière, une migration à moitié appliquée, un schéma qui ne
// correspond plus au code. Aucun de ces trois cas ne doit se solder par des
// données abîmées.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { ErreurDeMigration, MIGRATIONS, appliquer, versionCible } from '../src/noyau/migrations';
import { migration001 } from '../src/noyau/migrations/001-socle';

function dossier(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'mdf-mig-')); }

test('une base vide se migre jusqu\'à la version courante', () => {
  const d = dossier();
  try {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    appliquer(db, d);
    const v = db.prepare('SELECT MAX(version) AS v FROM schema_migration').get() as { v: number };
    assert.equal(v.v, versionCible());
    // Aucune sauvegarde pour une première installation : un fichier vide qui
    // ferait douter serait pire que rien.
    assert.equal(fs.existsSync(path.join(d, 'sauvegardes')), false);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('rejouer les migrations ne fait rien', () => {
  const d = dossier();
  try {
    const db = new Database(':memory:');
    appliquer(db, d);
    const avant = db.prepare('SELECT COUNT(*) AS n FROM schema_migration').get() as { n: number };
    appliquer(db, d);
    const apres = db.prepare('SELECT COUNT(*) AS n FROM schema_migration').get() as { n: number };
    assert.deepEqual(avant, apres);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('une sauvegarde est prise avant de migrer une base déjà installée', () => {
  const d = dossier();
  try {
    const db = new Database(path.join(d, 'maison.db'));
    // Une installation réelle restée en version 1 : seul le socle est appliqué,
    // et la table de suivi le dit. C'est l'état d'un serveur qu'on met à jour.
    db.exec(`CREATE TABLE schema_migration (version INTEGER PRIMARY KEY, libelle TEXT NOT NULL,
             applique_le TEXT NOT NULL, duree_ms INTEGER NOT NULL)`);
    migration001.up(db);
    db.prepare('INSERT INTO schema_migration VALUES (1, ?, ?, 0)').run(migration001.libelle, new Date().toISOString());

    appliquer(db, d);
    assert.equal((db.prepare('SELECT MAX(version) AS v FROM schema_migration').get() as { v: number }).v, versionCible());
    const sauvegardes = fs.readdirSync(path.join(d, 'sauvegardes'));
    assert.equal(sauvegardes.length, 1, 'la marche arrière doit être réelle, pas théorique');
    assert.match(sauvegardes[0], /^avant-migration-1-vers-\d+-/);
    // La sauvegarde est une vraie base, lisible.
    const copie = new Database(path.join(d, 'sauvegardes', sauvegardes[0]), { readonly: true });
    assert.ok(copie.prepare("SELECT name FROM sqlite_master WHERE name = 'personne'").get());
    copie.close();
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('une base plus récente que le binaire arrête le service au lieu de l\'abîmer', () => {
  const d = dossier();
  try {
    const db = new Database(':memory:');
    appliquer(db, d);
    db.prepare('INSERT INTO schema_migration (version, libelle, applique_le, duree_ms) VALUES (?, ?, ?, 0)')
      .run(versionCible() + 5, 'venue du futur', new Date().toISOString());
    assert.throws(() => appliquer(db, d), (e: unknown) =>
      e instanceof ErreurDeMigration
      && /version antérieure/.test(e.message)
      && /restaurez une sauvegarde/.test(e.message));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('une migration qui échoue est annulée et laisse la base intacte', () => {
  const d = dossier();
  try {
    const db = new Database(':memory:');
    appliquer(db, d);
    const avant = db.prepare('SELECT MAX(version) AS v FROM schema_migration').get() as { v: number };

    const cassee = { version: versionCible() + 1, libelle: 'volontairement fausse', up: () => { throw new Error('boum'); } };
    (MIGRATIONS as unknown as typeof cassee[]).push(cassee);
    try {
      assert.throws(() => appliquer(db, d), (e: unknown) =>
        e instanceof ErreurDeMigration && /a échoué et a été annulée/.test(e.message) && /boum/.test(e.message));
      const apres = db.prepare('SELECT MAX(version) AS v FROM schema_migration').get() as { v: number };
      assert.deepEqual(apres, avant, 'la version installée ne doit pas bouger');
    } finally {
      (MIGRATIONS as unknown as typeof cassee[]).pop();
    }
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('les migrations sont numérotées sans trou ni doublon', () => {
  const versions = MIGRATIONS.map((m) => m.version);
  assert.deepEqual(versions, [...versions].sort((a, b) => a - b), 'les migrations doivent être en ordre');
  assert.equal(new Set(versions).size, versions.length, 'deux migrations portent le même numéro');
  versions.forEach((v, i) => assert.equal(v, i + 1, 'la numérotation doit être continue à partir de 1'));
  for (const m of MIGRATIONS) {
    assert.ok(m.libelle.length > 10, `la migration ${m.version} doit dire ce qu'elle fait`);
  }
});

test('les clés étrangères sont bien appliquées', () => {
  const d = dossier();
  try {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    appliquer(db, d);
    // Un séjour sur un bien qui n'existe pas doit être refusé par la base
    // elle-même, et pas seulement par le code qui écrit d'habitude.
    assert.throws(() => db.prepare(`
      INSERT INTO sejour (bien_id, arrivee, depart, occupants, nature, statut, origine, cree_le)
      VALUES (999, '2026-08-08', '2026-08-16', 2, 'famille', 'valide', 'app', '2026-01-01')
    `).run(), /FOREIGN KEY/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('les contraintes de cohérence des séjours tiennent au niveau de la base', () => {
  const d = dossier();
  try {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = OFF');
    appliquer(db, d);
    const inserer = (arrivee: string, depart: string, occupants: number): void => {
      db.prepare(`
        INSERT INTO sejour (bien_id, arrivee, depart, occupants, nature, statut, origine, cree_le)
        VALUES (1, ?, ?, ?, 'famille', 'valide', 'app', '2026-01-01')
      `).run(arrivee, depart, occupants);
    };
    assert.throws(() => inserer('2026-08-16', '2026-08-08', 2), /CHECK/, 'départ avant arrivée');
    assert.throws(() => inserer('2026-08-08', '2026-08-08', 2), /CHECK/, 'zéro nuit');
    assert.throws(() => inserer('2026-08-08', '2026-08-16', 0), /CHECK/, 'zéro occupant');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('un rôle porte une structure ou un bien, jamais les deux ni aucun', () => {
  const d = dossier();
  try {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = OFF');
    appliquer(db, d);
    const inserer = (s: number | null, b: number | null): void => {
      db.prepare("INSERT INTO role_attribue (personne_id, structure_id, bien_id, role, debut, cree_le) VALUES (1, ?, ?, 'gerant', '2026-01-01', '2026-01-01')")
        .run(s, b);
    };
    assert.throws(() => inserer(null, null), /CHECK/);
    assert.throws(() => inserer(1, 1), /CHECK/);
    assert.doesNotThrow(() => inserer(1, null));
    assert.doesNotThrow(() => inserer(null, 1));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
