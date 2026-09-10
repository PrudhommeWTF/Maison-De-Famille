import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lienAbsolu } from './liens';

test('un chemin nu prend le domaine du navigateur', () => {
  assert.equal(
    lienAbsolu('/reinitialiser?jeton=abc', 'https://maison.exemple.fr/'),
    'https://maison.exemple.fr/reinitialiser?jeton=abc');
});

test('l\'adresse publique configurée fait foi', () => {
  // La gérante consulte peut-être l'application sur l'adresse locale de la
  // machine, quand la famille passe par le nom de domaine.
  assert.equal(
    lienAbsolu('https://maison.exemple.fr/sejour?jeton=abc', 'http://192.168.1.50:8099/'),
    'https://maison.exemple.fr/sejour?jeton=abc');
});

test('un sous-chemin est conservé', () => {
  assert.equal(
    lienAbsolu('/sejour?jeton=abc', 'https://exemple.fr/maison/'),
    'https://exemple.fr/maison/sejour?jeton=abc');
});

test('le jeton traverse sans être abîmé', () => {
  const jeton = 'aZ0-_~.9';
  assert.equal(
    lienAbsolu(`/reinitialiser?jeton=${jeton}`, 'https://exemple.fr/'),
    `https://exemple.fr/reinitialiser?jeton=${jeton}`);
});

test('une base inutilisable rend le chemin plutôt que rien', () => {
  assert.equal(lienAbsolu('/sejour?jeton=abc', 'pas-une-url'), '/sejour?jeton=abc');
});

test('un lien vide reste vide', () => {
  assert.equal(lienAbsolu('', 'https://exemple.fr/'), '');
});
