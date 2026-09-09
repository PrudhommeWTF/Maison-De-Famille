// Ce que l'installateur écrit dans la configuration d'une machine déjà
// installée.
//
// **Pourquoi ce test existe.** Sur l'instance de la famille, relancer
// l'installateur avec `MAJ_AUTO=true` posait l'assistant root, annonçait
// « activée », et l'écran continuait pourtant de dire que l'installation depuis
// l'interface n'était pas en place. La configuration existait déjà, et la ligne
// `MDF_MAJ_AUTO` n'était écrite qu'à la première installation.
//
// On ne peut pas jouer `install.sh` ici : il installe des paquets, crée un
// utilisateur système et écrit des unités systemd. On extrait donc la fonction
// qui pose une clé, et on la joue pour de vrai sur un fichier temporaire. Si
// quelqu'un la renomme, ce test échoue, et c'est ce qu'on veut : elle est le
// seul endroit qui garantit que la configuration dit la vérité.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const INSTALL = path.join(__dirname, '..', '..', 'deploy', 'lxc', 'install.sh');
const script = fs.readFileSync(INSTALL, 'utf8');

/** Joue `poser_env` extraite du vrai script, sur un fichier jetable. */
function poser(depart: string, appels: [string, string][]): string {
  const corps = script.match(/^poser_env\(\) \{$.*?^\}$/ms);
  assert.ok(corps, 'poser_env est introuvable dans install.sh');
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'mdf-env-'));
  const fichier = path.join(dossier, 'mdf.env');
  fs.writeFileSync(fichier, depart);
  const lignes = appels.map(([c, v]) => `poser_env ${c} '${v}' '${fichier}'`).join('\n');
  execFileSync('bash', ['-c', `set -euo pipefail\n${corps[0]}\n${lignes}`]);
  const sortie = fs.readFileSync(fichier, 'utf8');
  fs.rmSync(dossier, { recursive: true, force: true });
  return sortie;
}

test('relancer avec MAJ_AUTO=true active vraiment le bouton de mise à jour', () => {
  const apres = poser('NODE_ENV=production\nMDF_MAJ_AUTO=false\nMDF_JWT_SECRET=abcdef\n',
    [['MDF_MAJ_AUTO', 'true']]);
  assert.match(apres, /^MDF_MAJ_AUTO=true$/m,
    'sans cette ligne, l\'assistant root est posé mais le service l\'ignore');
  assert.match(apres, /^MDF_JWT_SECRET=abcdef$/m, 'le secret ne doit jamais bouger');
});

test('relancer sans MAJ_AUTO éteint le bouton, qui mentirait sinon', () => {
  // L'assistant root est retiré dans la foulée : laisser le drapeau à « true »
  // afficherait un bouton qui redemande le mot de passe et ne fait plus rien.
  const apres = poser('MDF_MAJ_AUTO=true\n', [['MDF_MAJ_AUTO', 'false']]);
  assert.match(apres, /^MDF_MAJ_AUTO=false$/m);
});

test('une clé absente est ajoutée, pas perdue en silence', () => {
  const apres = poser('NODE_ENV=production\n', [['MDF_VERSION', '0.0.8']]);
  assert.match(apres, /^MDF_VERSION=0\.0\.8$/m);
  assert.match(apres, /^NODE_ENV=production$/m);
});

test('une clé posée deux fois ne se duplique pas', () => {
  const apres = poser('MDF_VERSION=0.0.7\n', [['MDF_VERSION', '0.0.8'], ['MDF_VERSION', '0.0.9']]);
  assert.equal(apres.match(/^MDF_VERSION=/gm)?.length, 1);
  assert.match(apres, /^MDF_VERSION=0\.0\.9$/m);
});

test('l\'assistant root se prend dans le code déployé, pas à côté du script', () => {
  // `bash <(curl ...)` est la façon documentée d'installer : le script n'a alors
  // pas de dossier, et `${SCRIPT_DIR}/maj.sh` n'existe pas. L'installation
  // s'arrêtait là, après avoir déjà tout posé.
  const pose = script.match(/^\s*install .*maison-de-famille-maj\.sh$/m);
  assert.ok(pose, 'la pose de l\'assistant est introuvable');
  assert.doesNotMatch(pose[0], /SCRIPT_DIR/);
  assert.match(pose[0], /APP_DIR/);
});

test('MDF_MAJ_AUTO est écrit à chaque passage, pas seulement à la première installation', () => {
  // La garde qui protège le secret ne doit plus englober le drapeau.
  const premiere = script.indexOf('if [[ ! -f "${ENV_FILE}" ]]; then');
  const finGarde = script.indexOf('\nfi\n', script.indexOf('log "Configuration existante conservée'));
  const appel = script.indexOf('poser_env MDF_MAJ_AUTO');
  assert.ok(premiere > 0 && finGarde > 0 && appel > 0);
  assert.ok(appel > finGarde,
    'la pose de MDF_MAJ_AUTO doit être hors du bloc « première installation »');
});
