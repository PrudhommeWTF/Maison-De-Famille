// La discipline du registre de paramètres, vérifiée par la CI.
//
// Un registre déclaratif ne vaut que si personne ne le contourne. Trois dérives
// possibles, trois tests :
//
//   - un réglage déclaré que **personne ne lit** : il apparaît dans l'écran de
//     configuration, on le change, et il ne se passe rien. C'est pire que son
//     absence, parce qu'on croit avoir agi.
//   - une clé **lue sans être déclarée** : elle n'a ni description, ni valeur par
//     défaut contrôlée, ni place dans l'écran.
//   - un accès **direct à la table** : le jour où la résolution de portée change,
//     ce code-là ne suit pas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { REGISTRE, SECTIONS, convertir, declaration, versStockage } from '../src/parametres/registre';

const SRC = path.join(__dirname, '..', 'src');

function fichiers(dossier: string): string[] {
  return fs.readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dossier, e.name);
    return e.isDirectory() ? fichiers(p) : e.name.endsWith('.ts') ? [p] : [];
  });
}

const SOURCES = fichiers(SRC).map((p) => ({ p, texte: fs.readFileSync(p, 'utf8') }));

/** Toutes les clés passées à `parametre(...)`, quel que soit le paramètre typé. */
function clesLues(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const { p, texte } of SOURCES) {
    if (p.endsWith(path.join('parametres', 'registre.ts'))) continue;
    for (const m of texte.matchAll(/parametre(?:<[^>]*>)?\(\s*[A-Za-z0-9_.]+\s*,\s*'([^']+)'/g)) {
      const liste = out.get(m[1]) ?? [];
      liste.push(path.relative(SRC, p));
      out.set(m[1], liste);
    }
    // `poser()` compte aussi comme un usage : un réglage qui n'est qu'écrit et
    // jamais lu reste inutile, mais un réglage écrit par un écran dédié est
    // légitimement absent des lectures directes.
    for (const m of texte.matchAll(/poser\(\s*[A-Za-z0-9_.]+\s*,\s*'([^']+)'/g)) {
      const liste = out.get(m[1]) ?? [];
      liste.push(path.relative(SRC, p));
      out.set(m[1], liste);
    }
  }
  return out;
}

test('chaque paramètre déclaré est réellement lu quelque part', () => {
  const lues = clesLues();
  const orphelins = REGISTRE.filter((d) => !lues.has(d.cle)).map((d) => d.cle);
  assert.deepEqual(orphelins, [],
    `Ces réglages sont déclarés mais personne ne les lit : ${orphelins.join(', ')}. `
    + 'Un réglage sans effet est pire que son absence : on croit avoir agi. Câblez-le ou retirez-le.');
});

test('chaque clé lue est déclarée dans le registre', () => {
  const declarees = new Set(REGISTRE.map((d) => d.cle));
  for (const [cle, ou] of clesLues()) {
    assert.ok(declarees.has(cle),
      `La clé « ${cle} » est lue dans ${ou.join(', ')} sans être déclarée dans parametres/registre.ts.`);
  }
});

test('personne ne lit la table des paramètres directement', () => {
  for (const { p, texte } of SOURCES) {
    if (p.endsWith(path.join('parametres', 'repo.ts'))) continue;
    if (p.includes(path.join('noyau', 'migrations'))) continue;
    assert.ok(!/FROM parametre\b|INTO parametre\b/i.test(texte),
      `${path.relative(SRC, p)} touche la table « parametre » directement. Passez par parametres/repo.ts.`);
  }
});

test('le registre est cohérent avec lui-même', () => {
  const vues = new Set<string>();
  const sections = new Set(SECTIONS.map((s) => s.id));
  for (const d of REGISTRE) {
    assert.ok(!vues.has(d.cle), `Clé en double : ${d.cle}`);
    vues.add(d.cle);
    assert.ok(sections.has(d.section), `${d.cle} pointe la section inconnue « ${d.section} ».`);
    assert.ok(d.description.length > 40,
      `${d.cle} : la description doit dire ce que le réglage change concrètement, pas reformuler le libellé.`);
    assert.equal(typeof d.defaut, d.type === 'bool' ? 'boolean' : d.type === 'int' ? 'number' : 'string',
      `${d.cle} : le défaut ne correspond pas au type déclaré.`);
    if (d.type === 'enum') {
      assert.ok(d.options?.length, `${d.cle} : un enum sans options.`);
      assert.ok(d.options.some((o) => o.valeur === d.defaut), `${d.cle} : le défaut n'est pas une option valide.`);
    }
    if (d.type === 'int') {
      assert.ok(d.min !== undefined && d.max !== undefined, `${d.cle} : un entier sans bornes.`);
    }
  }
});

test('une valeur stockée illisible retombe sur le défaut, sans lever', () => {
  // Une base éditée à la main, ou un réglage dont les bornes ont changé entre
  // deux versions : la lecture doit rester silencieuse et sûre.
  for (const d of REGISTRE) {
    assert.doesNotThrow(() => convertir(d, 'nawak'));
    assert.doesNotThrow(() => convertir(d, ''));
  }
  assert.equal(convertir(declaration('notificationsTentativesMax'), '999'), 20, 'borné au maximum déclaré');
  assert.equal(convertir(declaration('journalNiveau'), 'inexistant'), 'info', 'repli sur le défaut');
});

test('une valeur entrante hors bornes est refusée, pas rognée', () => {
  // À l'écriture, au contraire : rogner silencieusement ferait croire à
  // l'utilisateur qu'il a réglé autre chose que ce qui est enregistré.
  assert.equal(versStockage(declaration('notificationsTentativesMax'), 999), null);
  assert.equal(versStockage(declaration('notificationsTentativesMax'), 3), '3');
  assert.equal(versStockage(declaration('journalNiveau'), 'debug'), 'debug');
  assert.equal(versStockage(declaration('journalNiveau'), 'verbeux'), null);
  assert.equal(versStockage(declaration('capaciteBloquante'), 'peut-être'), null);
});

test('une clé inconnue lève, parce que c\'est une faute de code', () => {
  assert.throws(() => declaration('nExistePas'), /Déclarez-le dans/);
});
