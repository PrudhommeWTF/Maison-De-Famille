// Le schéma engendré par les migrations, versionné dans docs/schema.sql.
//
// La CI compare la sortie de ce script au fichier versionné. Une migration
// oubliée, ou une divergence entre ce que le code croit et ce que la base
// contient, échoue alors en intégration plutôt qu'au démarrage chez vous.
//
//   cd backend && npm run docs:schema
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

// La sortie de ce script EST le fichier : les migrations ne doivent pas
// raconter leur travail dedans.
process.env.MDF_LOG_LEVEL = 'erreur';

import { appliquer, versionCible } from '../src/noyau/migrations';

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'mdf-schema-'));
try {
  const db = new Database(':memory:');
  appliquer(db, dossier);
  const objets = db.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name
  `).all() as { type: string; name: string; sql: string }[];

  const lignes = [
    '-- Schéma de la base, engendré par les migrations. Ne pas modifier à la main.',
    `-- Version du schéma : ${versionCible()}`,
    '-- Régénérer : cd backend && npm run docs:schema',
    '',
    ...objets.map((o) => `${o.sql.trim()};`),
  ];
  process.stdout.write(lignes.join('\n') + '\n');
} finally {
  fs.rmSync(dossier, { recursive: true, force: true });
}
