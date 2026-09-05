// La documentation engendrée doit être à jour.
//
// Deux fichiers sont produits depuis le code : le schéma de la base et la liste
// des réglages. Les versionner sert à deux choses, et les deux comptent :
// relire un schéma dans un diff de PR, et retrouver dans six mois ce qu'un
// réglage fait sans ouvrir le code. Un fichier périmé ne sert ni à l'un ni à
// l'autre, donc la CI le refuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const RACINE = path.join(__dirname, '..');
const DOCS = path.join(RACINE, '..', 'docs');

function engendrer(script: string): string {
  return execFileSync('npx', ['tsx', path.join(RACINE, 'scripts', script)], {
    cwd: RACINE, encoding: 'utf8', env: { ...process.env, MDF_LOG_LEVEL: 'erreur' },
  });
}

test('docs/schema.sql correspond aux migrations', () => {
  const attendu = engendrer('schema-dump.ts');
  const versionne = fs.readFileSync(path.join(DOCS, 'schema.sql'), 'utf8');
  assert.equal(versionne, attendu,
    'Le schéma versionné ne correspond plus aux migrations. Régénérez-le : cd backend && npm run docs:schema');
});

test('docs/parametres.md correspond au registre', () => {
  const attendu = engendrer('parametres-doc.ts');
  const versionne = fs.readFileSync(path.join(DOCS, 'parametres.md'), 'utf8');
  assert.equal(versionne, attendu,
    'La documentation des réglages est périmée. Régénérez-la : cd backend && npm run docs:parametres');
});

test('le schéma versionné porte toutes les tables attendues', () => {
  // Un garde-fou contre un fichier vidé par accident : la comparaison ci-dessus
  // passerait si les deux étaient vides.
  const sql = fs.readFileSync(path.join(DOCS, 'schema.sql'), 'utf8');
  for (const table of ['personne', 'structure', 'bien', 'detention', 'sejour', 'fichier', 'notification']) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table}\\b`), `table ${table} absente du schéma versionné`);
  }
});
