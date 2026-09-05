// L'ouverture de la base.
//
// SQLite en mode WAL, clés étrangères activées, transactions courtes. Le volume
// de cette application est minuscule (quelques milliers de lignes sur dix ans)
// et les écritures sont rares : ce qui compte n'est pas la performance, c'est
// que deux personnes qui saisissent en même temps n'écrasent pas le travail de
// l'autre. Les mutations sont granulaires, il n'y a aucun document global.
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { log } from './log';
import { ErreurDeMigration, appliquer } from './migrations';

export type { Db };

export function ouvrir(dbPath: string, dataDir: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  // Les clés étrangères sont déclarées partout dans le schéma et SQLite ne les
  // applique que si on le demande, connexion par connexion. Sans cette ligne,
  // les contraintes du schéma sont de la décoration.
  db.pragma('foreign_keys = ON');
  // Une écriture qui attend le verrou patiente cinq secondes au lieu de rendre
  // « database is locked » à quelqu'un qui valide un séjour.
  db.pragma('busy_timeout = 5000');
  // WAL sans synchronisation complète : le compromis standard, sûr en cas de
  // plantage du processus, exposé seulement à une coupure de courant brutale.
  db.pragma('synchronous = NORMAL');

  try {
    appliquer(db, dataDir);
  } catch (e) {
    if (e instanceof ErreurDeMigration) {
      console.error('');
      console.error('[mdf] Démarrage refusé : le schéma de la base ne peut pas être mis à jour.');
      console.error('[mdf] ' + e.message);
      console.error('');
      console.error(`[mdf] Base concernée : ${dbPath}`);
      console.error(`[mdf] Sauvegardes    : ${path.join(dataDir, 'sauvegardes')}`);
      console.error('');
      process.exit(1);
    }
    throw e;
  }

  log.debug(`Base ouverte : ${dbPath}`);
  return db;
}

/** Une base en mémoire, migrée, pour les tests. */
export function ouvrirEnMemoire(): Db {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  appliquer(db, fs.mkdtempSync(path.join(require('os').tmpdir(), 'mdf-test-')));
  return db;
}
