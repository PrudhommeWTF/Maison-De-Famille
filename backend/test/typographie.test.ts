// Pas de tiret cadratin.
//
// C'est une règle d'écriture du projet, posée au brief et reprise dans
// `CLAUDE.md` : ni dans l'interface, ni dans la documentation. Virgule,
// deux-points ou parenthèses.
//
// Elle a besoin d'un test parce qu'elle s'oublie exactement là où elle se voit
// le plus : sept tirets s'étaient glissés dans l'interface comme valeur vide,
// dont un sur le tableau de bord, c'est-à-dire sur le premier écran que voit
// quelqu'un après l'installation. Une valeur vide se dit avec un mot (« Aucun »,
// « Non renseigné », « Sans quota »), qui se lit à voix haute et qu'un lecteur
// d'écran énonce, là où un trait ne dit rien.
//
// Une seule exception, nommée ici plutôt que devinée : la table de décodage
// cp1252 du lecteur de tableaux doit évidemment porter le caractère, puisque son travail
// est de le reconnaître dans un fichier reçu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const RACINE = path.join(__dirname, '..', '..');

/** Le caractère par son point de code : l'écrire ferait échouer ce fichier. */
const CADRATIN = String.fromCharCode(0x2014);

const EXCEPTIONS = new Set([
  // Table de correspondance des encodages : reconnaître le caractère est son objet.
  path.join('backend', 'src', 'noyau', 'tableau', 'decode.ts'),
  // Ce fichier, qui doit bien nommer ce qu'il interdit.
  path.join('backend', 'test', 'typographie.test.ts'),
]);

const IGNORES = new Set(['node_modules', 'dist', '.angular', 'handoff']);

function fichiers(dossier: string, extensions: readonly string[]): string[] {
  const abs = path.join(RACINE, dossier);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (IGNORES.has(e.name)) continue;
    const rel = path.join(dossier, e.name);
    if (e.isDirectory()) out.push(...fichiers(rel, extensions));
    else if (extensions.some((x) => e.name.endsWith(x))) out.push(rel);
  }
  return out;
}

test("aucun tiret cadratin dans l'interface", () => {
  const fautifs: string[] = [];
  for (const f of fichiers(path.join('frontend', 'src'), ['.ts', '.html', '.css'])
    .concat(fichiers(path.join('backend', 'src'), ['.ts']))) {
    if (EXCEPTIONS.has(f)) continue;
    const lignes = fs.readFileSync(path.join(RACINE, f), 'utf8').split('\n');
    lignes.forEach((l, n) => { if (l.includes(CADRATIN)) fautifs.push(`${f}:${n + 1}`); });
  }
  assert.deepEqual(fautifs, [],
    'Un tiret cadratin est interdit : utilisez une virgule, deux-points, des parenthèses, '
    + "ou un mot quand il sert de valeur vide (« Aucun », « Non renseigné »).");
});

test('aucun tiret cadratin dans la documentation', () => {
  const fautifs: string[] = [];
  for (const f of fichiers('docs', ['.md'])) {
    const lignes = fs.readFileSync(path.join(RACINE, f), 'utf8').split('\n');
    lignes.forEach((l, n) => { if (l.includes(CADRATIN)) fautifs.push(`${f}:${n + 1}`); });
  }
  assert.deepEqual(fautifs, []);
});

test('la règle est bien écrite dans CLAUDE.md', () => {
  const claude = fs.readFileSync(path.join(RACINE, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /tirets? (longs?|cadratins?)/i,
    "une règle appliquée par la CI mais absente des conventions n'est pas transmissible");
});
