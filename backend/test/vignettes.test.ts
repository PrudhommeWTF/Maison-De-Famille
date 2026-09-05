// Les vignettes.
//
// Les images d'essai sont fabriquées ici, pas lues sur le disque : un test qui
// dépend d'un fichier binaire versionné devient impossible à relire, et
// personne ne sait plus ce que l'image contenait quand il casse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { COTE_VIGNETTE, VIGNETTABLE, fabriquer, reduire } from '../src/location/vignettes';

/** Un damier, dont on peut vérifier la couleur moyenne après réduction. */
function damier(largeur: number, hauteur: number, taille = 8): Buffer {
  const d = Buffer.alloc(largeur * hauteur * 4);
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const clair = (Math.floor(x / taille) + Math.floor(y / taille)) % 2 === 0;
      const i = (y * largeur + x) * 4;
      d[i] = clair ? 220 : 20; d[i + 1] = clair ? 220 : 20; d[i + 2] = clair ? 220 : 20; d[i + 3] = 255;
    }
  }
  return d;
}

const versJpeg = (l: number, h: number): Buffer =>
  Buffer.from(jpeg.encode({ data: damier(l, h), width: l, height: h }, 90).data);

function versPng(l: number, h: number): Buffer {
  const p = new PNG({ width: l, height: h });
  damier(l, h).copy(p.data);
  return PNG.sync.write(p);
}

test('une photo JPEG donne une vignette JPEG plus petite', () => {
  const grande = versJpeg(1600, 1200);
  const v = fabriquer(grande, 'image/jpeg');
  assert.ok(v, 'une vignette doit être produite');
  assert.equal(v!.mime, 'image/jpeg');
  assert.equal(Math.max(v!.largeur, v!.hauteur), COTE_VIGNETTE);
  assert.equal(v!.hauteur, Math.round(1200 / (1600 / COTE_VIGNETTE)));
  assert.ok(v!.contenu.length < grande.length,
    `la vignette (${v!.contenu.length} o) doit peser moins que l'originale (${grande.length} o)`);
  // Et c'est bien un JPEG : les deux premiers octets sont la signature.
  assert.equal(v!.contenu[0], 0xff);
  assert.equal(v!.contenu[1], 0xd8);
});

test('un PNG donne aussi une vignette, encodée en JPEG', () => {
  const v = fabriquer(versPng(900, 900), 'image/png');
  assert.ok(v);
  assert.equal(v!.mime, 'image/jpeg', 'sur une photo, le JPEG est bien plus petit');
  assert.equal(v!.largeur, COTE_VIGNETTE);
  assert.equal(v!.hauteur, COTE_VIGNETTE);
});

test('les proportions sont conservées, portrait comme paysage', () => {
  const paysage = fabriquer(versJpeg(2000, 1000), 'image/jpeg')!;
  assert.equal(paysage.largeur, COTE_VIGNETTE);
  assert.equal(paysage.hauteur, COTE_VIGNETTE / 2);

  const portrait = fabriquer(versJpeg(1000, 2000), 'image/jpeg')!;
  assert.equal(portrait.hauteur, COTE_VIGNETTE);
  assert.equal(portrait.largeur, COTE_VIGNETTE / 2);
});

test('une image déjà petite n\'est pas agrandie', () => {
  const petite = { largeur: 100, hauteur: 80, donnees: damier(100, 80) };
  const r = reduire(petite);
  assert.equal(r.largeur, 100);
  assert.equal(r.hauteur, 80);
  assert.equal(r.donnees, petite.donnees, 'la même image est rendue, sans recopie inutile');
});

test('la réduction moyenne les pixels au lieu d\'en prendre un seul', () => {
  // Chaque pixel de sortie doit couvrir PLUSIEURS cases du damier, sinon il
  // reprend simplement la couleur de la case et le test ne prouve rien : avec
  // un damier de 8 pixels réduit à 8 par 8, chaque pixel couvre 16 sources,
  // soit deux cases, et doit tendre vers le gris moyen (220 + 20) / 2 = 120.
  const src = { largeur: 128, hauteur: 128, donnees: damier(128, 128, 8) };
  const r = reduire(src, 8);
  assert.equal(r.largeur, 8);
  const centre = ((4 * 8) + 4) * 4;
  assert.ok(Math.abs(r.donnees[centre] - 120) < 40,
    `le pixel réduit vaut ${r.donnees[centre]}, attendu autour de 120 : `
    + 'une réduction au plus proche voisin donnerait 20 ou 220 et produirait du moiré');
});

test('un contenu illisible ne fait pas échouer le dépôt', () => {
  // Ne lève jamais : perdre un souvenir parce que la miniature a raté serait
  // absurde. La photo est déposée, elle n'aura simplement pas de vignette.
  assert.equal(fabriquer(Buffer.from('ceci n\'est pas une image'), 'image/jpeg'), null);
  assert.equal(fabriquer(Buffer.alloc(0), 'image/png'), null);
  // Un JPEG dont on a coupé la fin : le décodeur lève, la fonction rend null.
  const tronque = versJpeg(400, 300).subarray(0, 200);
  assert.equal(fabriquer(tronque, 'image/jpeg'), null);
});

test('les types sans décodeur pur sont passés, pas refusés', () => {
  assert.deepEqual([...VIGNETTABLE], ['image/jpeg', 'image/png']);
  for (const mime of ['image/webp', 'image/gif', 'application/pdf']) {
    assert.equal(fabriquer(versJpeg(800, 600), mime), null,
      `${mime} n'a pas de décodeur purement JavaScript raisonnable : servi tel quel`);
  }
});

test('une vignette d\'une image d\'un seul pixel ne divise pas par zéro', () => {
  const v = fabriquer(versJpeg(1, 1), 'image/jpeg');
  assert.ok(v);
  assert.equal(v!.largeur, 1);
  assert.equal(v!.hauteur, 1);
});
