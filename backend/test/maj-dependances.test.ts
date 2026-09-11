// La mise à jour depuis l'interface doit compiler, y compris sous systemd.
//
// **Pourquoi ce test existe.** Sur l'instance de la famille, le bouton
// « Installer maintenant » échouait sur « sh: 1: tsc: not found ». L'unité
// systemd de la mise à jour lit le fichier d'environnement du service, qui
// contient `NODE_ENV=production` : npm en déduit `omit=dev` et saute les
// dépendances de développement, dont `tsc` et le compilateur Angular. Lancé à
// la main, où NODE_ENV n'est pas posé, le même script marchait, ce qui rendait
// la panne difficile à croire.
//
// Le test joue la sémantique de npm pour de vrai, sans réseau : c'est elle que
// le correctif utilise, et c'est elle qui doit être vérifiée, pas une chaîne de
// caractères dans un script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LXC = path.join(__dirname, '..', '..', 'deploy', 'lxc');
const maj = fs.readFileSync(path.join(LXC, 'maj.sh'), 'utf8');
const install = fs.readFileSync(path.join(LXC, 'install.sh'), 'utf8');

/** La ligne `npm ... ci` qui vise ce préfixe, telle qu'elle est écrite. */
function ligneNpm(script: string, prefixe: string): string | undefined {
  const vise = `npm --prefix "${prefixe}" ci`;
  return script.split('\n').find((l) => l.includes(vise));
}

/** Ce que npm décide d'omettre, dans l'environnement donné. */
const omis = (env: Record<string, string>, args: string[] = []): string =>
  execFileSync('npm', ['config', 'get', 'omit', ...args],
    { env: { ...process.env, ...env }, encoding: 'utf8' }).trim();

test('NODE_ENV=production fait sauter les dépendances de développement', () => {
  // La prémisse du défaut. Si npm changeait d'avis un jour, ce test le dirait,
  // et les « --include=dev » ci-dessous deviendraient inutiles plutôt que faux.
  assert.equal(omis({ NODE_ENV: 'production' }), 'dev');
});

test('--include=dev les rétablit malgré NODE_ENV', () => {
  assert.notEqual(omis({ NODE_ENV: 'production' }, ['--include=dev']), 'dev');
});

test('les deux compilations de maj.sh installent les dépendances de développement', () => {
  for (const cible of ['backend', 'frontend']) {
    const ligne = ligneNpm(maj, `$TMP/src/${cible}`);
    assert.ok(ligne, `la ligne de compilation de ${cible} est introuvable dans maj.sh`);
    assert.match(ligne, /--include=dev/,
      `sans cela, ${cible} se compile sans tsc sous systemd`);
  }
});

test("l'installation en place, elle, reste sans dépendances de développement", () => {
  // On ne laisse pas un compilateur et ses cent paquets sur la machine de la
  // famille : c'est l'inverse des deux lignes ci-dessus, et c'est voulu.
  const ligne = ligneNpm(maj, '${APP_DIR}/backend');
  assert.ok(ligne);
  assert.match(ligne, /--omit=dev/);
  assert.doesNotMatch(ligne, /--include=dev/);
});

test("l'assistant se remplace avant de compiler, pour pouvoir se réparer", () => {
  // Tant que ce remplacement suivait la compilation, un assistant qui échouait
  // avant elle rejouait éternellement son propre défaut : il fallait un accès au
  // serveur pour en sortir. C'est ce qui est arrivé avec « tsc: not found ».
  const pose = maj.indexOf('ASSISTANT=/usr/local/sbin/maison-de-famille-maj.sh');
  const compile = maj.indexOf('etape "Compilation du serveur"');
  const archive = maj.indexOf("L'archive ${TAG} est incomplète");
  assert.ok(pose > 0 && compile > 0 && archive > 0);
  assert.ok(pose > archive, "l'archive doit être contrôlée avant qu'on en tire l'assistant");
  assert.ok(pose < compile, "un assistant cassé ne pourrait plus se réparer");
});

test("l'installateur compile lui aussi avec les dépendances de développement", () => {
  for (const cible of ['backend', 'frontend']) {
    const ligne = ligneNpm(install, `\${APP_DIR}/${cible}`);
    assert.ok(ligne, `la ligne de compilation de ${cible} est introuvable dans install.sh`);
    assert.match(ligne, /--include=dev/);
  }
});

// ---------------------------------------------------------------------------
// L'alignement sur Foyer-App, dont la mise à jour fonctionne depuis longtemps.
//
// Deux écarts expliquaient les deux symptômes vus sur l'instance de la famille,
// et les deux sont réparés du même côté que Foyer-App les avait déjà réparés.
// ---------------------------------------------------------------------------

test('NODE_ENV appartient à l\'unité du service, pas au fichier d\'environnement', () => {
  // Dans le fichier, l'unité de mise à jour l'hérite : npm saute alors les
  // dépendances de développement, et la compilation échoue sur « tsc: not
  // found ». Foyer-App le pose sur son unité de service depuis toujours.
  const heredoc = install.slice(install.indexOf('cat > "${ENV_FILE}"'),
    install.indexOf('chmod 600 "${ENV_FILE}"'));
  assert.doesNotMatch(heredoc, /^NODE_ENV=/m,
    'le fichier d\'environnement ne doit plus porter NODE_ENV');
  assert.match(install, /^Environment=NODE_ENV=production$/m,
    'l\'unité du service doit le porter');
  assert.match(install, /sed -i '\/\^NODE_ENV=\/d'/,
    'et la ligne doit disparaître des configurations déjà installées');
});

test('une configuration existante perd sa ligne NODE_ENV', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'mdf-env-'));
  const fichier = path.join(dossier, 'mdf.env');
  fs.writeFileSync(fichier, 'NODE_ENV=production\nPORT=8099\nMDF_JWT_SECRET=abcdef\n');
  execFileSync('bash', ['-c', `set -euo pipefail\nsed -i '/^NODE_ENV=/d' '${fichier}'`]);
  const apres = fs.readFileSync(fichier, 'utf8');
  fs.rmSync(dossier, { recursive: true, force: true });
  assert.doesNotMatch(apres, /^NODE_ENV=/m);
  assert.match(apres, /^MDF_JWT_SECRET=abcdef$/m, 'le reste ne bouge pas');
  assert.match(apres, /^PORT=8099$/m);
});

test('la version se déclare quand la source n\'est pas un dépôt git', () => {
  // Le cas réel : une archive de release, décompressée, sans .git. « git
  // describe » n'a rien à interroger et l'installation se rabattait sur
  // package.json, resté en arrière. Foyer-App accepte FOYER_VERSION pour ça.
  const bloc = install.slice(install.indexOf('# --- Version déployée ---'),
    install.indexOf('chown -R "${SERVICE_USER}'));
  assert.match(bloc, /VERSION="\$\{MDF_VERSION:-\}"/,
    'MDF_VERSION doit primer sur tout le reste');
  assert.ok(bloc.indexOf('VERSION="${MDF_VERSION:-}"') < bloc.indexOf('describe --tags'),
    'et être consulté avant git describe');
  assert.match(bloc, /describe --tags --abbrev=0/,
    '--abbrev=0 et non --exact-match : quelques commits après un tag, on répond');
  // Sur les lignes de commande seulement : le commentaire au-dessus cite
  // « --exact-match » pour dire qu'on ne s'en sert plus.
  const commandes = bloc.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
  assert.doesNotMatch(commandes, /--exact-match/);
});
