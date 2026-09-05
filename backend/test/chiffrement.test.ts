// Le chiffrement des codes d'accès.
//
// Ce que ces tests vérifient tient en une phrase : un code enregistré ne se
// relit pas sans la clé, et une donnée altérée est détectée au lieu de rendre
// une valeur fausse. Une valeur fausse serait pire que pas de valeur, parce que
// quelqu'un partirait à trois heures de route avec un mauvais code de boîte à
// clés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COFFRE_VERROUILLE, CodeIllisible, CoffreVerrouille, disponible, memeCle, ouvrir,
} from '../src/coffre/chiffrement';

const CLE = 'a'.repeat(64);
const AUTRE = 'b'.repeat(64);

test('un aller-retour rend exactement ce qui a été mis', () => {
  const c = ouvrir(CLE);
  for (const clair of ['4712', 'goelands29', '1 8 4 0 B', 'un mot de passe avec des accents éàü', '']) {
    assert.equal(c.dechiffrer(c.chiffrer(clair)), clair);
  }
});

test('deux chiffrements du même code donnent des octets différents', () => {
  const c = ouvrir(CLE);
  const a = c.chiffrer('4712');
  const b = c.chiffrer('4712');
  assert.notEqual(a.toString('hex'), b.toString('hex'),
    'un nonce fixe laisserait deviner que deux codes sont identiques');
  assert.equal(c.dechiffrer(a), c.dechiffrer(b));
});

test('le code en clair n\'apparaît nulle part dans le paquet chiffré', () => {
  const c = ouvrir(CLE);
  const paquet = c.chiffrer('goelands29');
  assert.equal(paquet.includes(Buffer.from('goelands29', 'utf8')), false);
});

test('une autre clé ne relit rien, et le dit', () => {
  const paquet = ouvrir(CLE).chiffrer('4712');
  assert.throws(() => ouvrir(AUTRE).dechiffrer(paquet), (e: Error) => {
    assert.ok(e instanceof CodeIllisible);
    assert.match(e.message, /MDF_CLE_COFFRE/, 'le message doit nommer le réglage à vérifier');
    return true;
  });
});

test('un octet modifié est détecté', () => {
  const c = ouvrir(CLE);
  const paquet = c.chiffrer('4712');
  for (const i of [0, 5, 12, 20, paquet.length - 1]) {
    const abime = Buffer.from(paquet);
    abime[i] ^= 0xff;
    assert.throws(() => c.dechiffrer(abime), CodeIllisible, `octet ${i} modifié`);
  }
});

test('un paquet tronqué est refusé plutôt que mal interprété', () => {
  const c = ouvrir(CLE);
  assert.throws(() => c.dechiffrer(Buffer.alloc(0)), CodeIllisible);
  assert.throws(() => c.dechiffrer(Buffer.alloc(10)), CodeIllisible);
});

test('sans clé, le coffre est verrouillé et explique la marche à suivre', () => {
  for (const rien of [null, undefined, '', '   ']) {
    const c = ouvrir(rien);
    assert.equal(disponible(c), false);
    assert.throws(() => c.chiffrer('4712'), (e: Error) => {
      assert.ok(e instanceof CoffreVerrouille);
      assert.match(e.message, /openssl rand -hex 32/, 'le message doit donner la commande');
      assert.match(e.message, /sauvegardes/, 'et prévenir que la clé ne vit pas avec les données');
      return true;
    });
  }
  assert.equal(disponible(COFFRE_VERROUILLE), false);
});

test('une clé trop courte est refusée à l\'ouverture, pas au premier code', () => {
  assert.throws(() => ouvrir('trop-courte'), (e: Error) => {
    assert.ok(e instanceof CoffreVerrouille);
    assert.match(e.message, /au moins 32/);
    return true;
  });
});

test('l\'empreinte reconnaît une clé sans la révéler', () => {
  const a = ouvrir(CLE);
  const b = ouvrir(CLE);
  const autre = ouvrir(AUTRE);
  assert.equal(a.empreinteCle, b.empreinteCle);
  assert.notEqual(a.empreinteCle, autre.empreinteCle);
  assert.equal(memeCle(a.empreinteCle, b.empreinteCle), true);
  assert.equal(memeCle(a.empreinteCle, autre.empreinteCle), false);
  assert.equal(memeCle('', ''), false, 'deux coffres verrouillés ne sont pas « la même clé »');
  assert.ok(!a.empreinteCle.includes(CLE.slice(0, 8)), "l'empreinte ne doit rien laisser de la clé");
  assert.equal(disponible(a), true);
});

test('un code long passe sans découpage', () => {
  const c = ouvrir(CLE);
  const long = 'x'.repeat(4000);
  assert.equal(c.dechiffrer(c.chiffrer(long)), long);
});
