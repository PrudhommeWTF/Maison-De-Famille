// La discipline de validation, vérifiée par la CI.
//
// `lire()` accumule les erreurs et ne lève qu'à l'appel de `fin()`. C'est ce qui
// permet de signaler tous les champs fautifs d'un coup, et c'est aussi un
// piège : oublier `fin()` fait accepter une valeur invalide **en silence**.
//
// C'est arrivé une fois, sur un motif de recalcul obligatoire qui passait à
// vide, et rien ne l'aurait signalé sans un test de bout en bout. Ce test-ci
// attrape la faute à la source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', 'src');

function fichiers(dossier: string): string[] {
  return fs.readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dossier, e.name);
    return e.isDirectory() ? fichiers(p) : e.name.endsWith('.ts') ? [p] : [];
  });
}

test('chaque lecture de corps de requête est close par un appel à fin()', () => {
  for (const p of fichiers(SRC)) {
    const texte = fs.readFileSync(p, 'utf8');
    // Seuls les fichiers qui importent le lecteur sont concernés : « lire » est
    // un nom courant, et l'import du planning a le sien.
    if (!/from '[^']*noyau\/valider'/.test(texte)) continue;
    const lectures = (texte.match(/\blire\(/g) ?? []).length;
    if (!lectures) continue;
    const fins = (texte.match(/\.fin\(\)/g) ?? []).length;
    assert.equal(fins, lectures,
      `${path.relative(SRC, p)} : ${lectures} appel(s) à lire() pour ${fins} appel(s) à fin(). `
      + "Sans fin(), les champs fautifs sont acceptés en silence.");
  }
});

test('personne ne lit req.body directement en dehors du téléversement de fichiers', () => {
  // Un corps JSON lu sans passer par le lecteur échappe à toute validation.
  // Les téléversements sont l'exception : leur corps est un Buffer, pas un objet.
  for (const p of fichiers(SRC)) {
    const texte = fs.readFileSync(p, 'utf8');
    for (const m of texte.matchAll(/req\.body/g)) {
      const debutLigne = texte.lastIndexOf('\n', m.index) + 1;
      const ligne = texte.slice(debutLigne, texte.indexOf('\n', m.index));
      // Une mention en commentaire n'est pas une lecture.
      if (/^\s*(\/\/|\*|\/\*)/.test(ligne)) continue;
      const contexte = texte.slice(Math.max(0, m.index - 200), m.index + 120);
      assert.ok(/Buffer\.isBuffer|corps: req\.body/.test(contexte),
        `${path.relative(SRC, p)} lit req.body hors d'un téléversement, sans validation.`);
    }
  }
});
