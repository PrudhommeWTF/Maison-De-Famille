// Les réécritures qui rendent un guide affichable dans l'application.
//
// Ce sont exactement les quatre points qui cassent si on ne les tient pas :
// une ancre qui bouge, un lien qui ne mène nulle part, une image qui déborde.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUIDES, ancre, guideDe, preparer, titreDu } from './guides';

test("l'ancre déplie les accents et laisse tomber la numérotation", () => {
  assert.equal(ancre('3. Arbitrer une demande'), 'arbitrer-une-demande');
  assert.equal(ancre('Répartition des dépenses'), 'repartition-des-depenses');
  assert.equal(ancre('15 bis. Qui administre la plateforme'), 'qui-administre-la-plateforme');
  // Deux titres différents ne doivent pas rendre la même adresse.
  assert.notEqual(ancre('Les séjours'), ancre('Les dépenses'));
});

test('les titres de niveau deux alimentent le sommaire', () => {
  const r = preparer('<h2>1. Se connecter</h2><p>x</p><h2>2. Le calendrier</h2>', 'gerant');
  assert.deepEqual(r.sommaire, [
    { id: 'se-connecter', texte: '1. Se connecter' },
    { id: 'le-calendrier', texte: '2. Le calendrier' },
  ]);
  assert.match(r.html, /<h2 id="se-connecter"/);
});

test('un lien vers un autre guide devient une adresse de l\'application', () => {
  const r = preparer('<a href="gerant.md">Guide du gérant</a>', 'gerant');
  assert.equal(r.html, '<a href="/aide/gerant">Guide du gérant</a>');
});

test('un lien vers une section d\'un autre guide garde son ancre', () => {
  const r = preparer('<a href="premiers-pas.md#se-connecter">là</a>', 'gerant');
  assert.equal(r.html, '<a href="/aide/premiers-pas#se-connecter">là</a>');
});

test('un lien vers un document non publié garde son texte et perd son lien', () => {
  // `installation.md` n'est pas dans les guides : le lien mènerait à un 404,
  // et un lien mort est pire qu'une mention en clair.
  const r = preparer('<p>voir <a href="../installation.md">installation.md</a> pour la suite</p>', 'gerant');
  assert.equal(r.html, '<p>voir installation.md pour la suite</p>');
});

test('un lien externe s\'ouvre à côté, sans donner la main à la page ouverte', () => {
  const r = preparer('<a href="https://data.education.gouv.fr">portail</a>', 'gerant');
  assert.match(r.html, /target="_blank" rel="noopener noreferrer"/);
});

test('les images sont servies depuis les ressources et ne débordent pas', () => {
  const r = preparer('<img src="images/gerant-calendrier.png" alt="Le calendrier">', 'gerant');
  assert.match(r.html, /src="aide\/images\/gerant-calendrier\.png"/);
  assert.match(r.html, /class="img-fluid rounded border my-3"/);
  assert.match(r.html, /alt="Le calendrier"/, "le texte de remplacement ne se perd pas");
  assert.match(r.html, /loading="lazy"/, 'six méga-octets de captures ne se chargent pas d\'un coup');
});

test('un tableau devient un tableau Bootstrap qui défile au doigt', () => {
  const r = preparer('<table><tr><td>x</td></tr></table>', 'gerant');
  assert.match(r.html, /<div class="table-responsive"><table class="table table-sm/);
  assert.match(r.html, /<\/table><\/div>/);
});

test("une ancre interne vise le guide et non la racine de l'application", () => {
  // Avec « <base href=\"/\"> », un « #x » nu se résout sur la base : le
  // sommaire interne du guide du gérant renvoyait au tableau de bord.
  const r = preparer('<a href="#le-calendrier">Le calendrier</a>', 'gerant');
  assert.equal(r.html, '<a href="/aide/gerant#le-calendrier">Le calendrier</a>');
});

test('le titre est décodé, pas échappé une seconde fois', () => {
  // Angular échappe déjà à l'interpolation : « Guides d&amp;#39;utilisation »
  // s'affichait tel quel à l'écran.
  const g = { slug: 'guides', fichier: 'README.md', titre: 'x', pourQui: '' };
  assert.equal(titreDu(g, '<h1>Guides d&#39;utilisation</h1>'), "Guides d'utilisation");
  assert.equal(titreDu(g, '<p>sans titre</p>'), 'x');
});

test('le registre des guides est cohérent', () => {
  assert.equal(new Set(GUIDES.map((g) => g.slug)).size, GUIDES.length, 'les slugs sont uniques');
  assert.equal(new Set(GUIDES.map((g) => g.fichier)).size, GUIDES.length, 'les fichiers sont uniques');
  assert.ok(guideDe('gerant'));
  assert.equal(guideDe('inconnu'), undefined);
});
