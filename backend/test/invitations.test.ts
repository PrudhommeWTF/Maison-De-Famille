// Le parcours d'inscription, de bout en bout.
//
// Ce fichier existe à cause d'un bug qui a tenu jusqu'ici : la route
// `POST /api/personnes` promettait, dans son propre commentaire, que la personne
// choisirait son mot de passe par « mot de passe oublié ». Or cette route-là
// filtrait sur `mot_de_passe_hash IS NOT NULL`, si bien qu'un compte
// fraîchement créé, qui n'a précisément pas d'empreinte, n'obtenait jamais de
// lien. La personne était créée et ne pouvait jamais se connecter.
//
// Aucun test ne l'a vu parce que le banc d'essai lui-même contourne le trou :
// `creerCompte` écrit l'empreinte directement en base, « sans passer par le
// courriel ». Les tests d'ici passent donc **par les routes**, jamais par la
// base, et vont jusqu'à la connexion effective. Un parcours d'inscription qui
// n'est pas suivi jusqu'à la connexion n'est pas testé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOT_DE_PASSE, amorcer, demarrer } from './aide';
import type { Instance } from './aide';

const NOUVEAU = 'un-mot-de-passe-que-paul-retient';

/** Le jeton en clair n'est jamais stocké : on le relit dans le lien du courriel. */
function jetonDuDernierCourriel(i: Instance, type: string): string {
  const n = i.db.prepare(
    'SELECT lien FROM notification WHERE type = ? ORDER BY id DESC LIMIT 1',
  ).get(type) as { lien: string } | undefined;
  assert.ok(n, `aucun courriel de type ${type} en file`);
  const m = /jeton=([^&]+)$/.exec(n.lien);
  assert.ok(m, `le lien ne porte pas de jeton : ${n.lien}`);
  return decodeURIComponent(m[1]);
}

test("une personne créée par la gérante reçoit une invitation et peut se connecter", async () => {
  const i = await demarrer({ publicUrl: 'https://maison.exemple.fr' });
  try {
    await amorcer(i);
    const cree = await i.post<{ id: number; courrielEnFile: boolean }>('/api/personnes',
      { nom: 'Paul Prudhomme', email: 'paul@exemple.fr' });
    assert.equal(cree.statut, 200);
    assert.equal(cree.corps.courrielEnFile, true, "l'invitation doit partir à la création");

    const jeton = jetonDuDernierCourriel(i, 'invitation');
    i.deconnecte();
    const choix = await i.post('/api/auth/mot-de-passe-reinitialiser', { jeton, motDePasse: NOUVEAU });
    assert.equal(choix.statut, 204);

    const co = await i.post<{ acces: string }>('/api/auth/connexion',
      { email: 'paul@exemple.fr', motDePasse: NOUVEAU });
    assert.equal(co.statut, 200, 'Paul doit pouvoir se connecter avec le mot de passe qu\'il a choisi');
    assert.ok(co.corps.acces);
  } finally { await i.fermer(); }
});

test("« mot de passe oublié » sert aussi un compte jamais activé", async () => {
  const i = await demarrer({ publicUrl: 'https://maison.exemple.fr' });
  try {
    await amorcer(i);
    // Sans adresse : aucune invitation ne part, la personne existe comme nom.
    const cree = await i.post<{ id: number; courrielEnFile: boolean }>('/api/personnes',
      { nom: 'Claire Prudhomme', email: '' });
    assert.equal(cree.corps.courrielEnFile, false);

    // La gérante renseigne l'adresse plus tard, puis réinvite.
    i.db.prepare('UPDATE personne SET email = ? WHERE id = ?').run('claire@exemple.fr', cree.corps.id);
    i.deconnecte();

    const oubli = await i.post('/api/auth/mot-de-passe-oublie', { email: 'claire@exemple.fr' });
    assert.equal(oubli.statut, 204);
    const jeton = jetonDuDernierCourriel(i, 'mot_de_passe');

    await i.post('/api/auth/mot-de-passe-reinitialiser', { jeton, motDePasse: NOUVEAU });
    const co = await i.post('/api/auth/connexion', { email: 'claire@exemple.fr', motDePasse: NOUVEAU });
    assert.equal(co.statut, 200, "un compte jamais activé doit pouvoir obtenir un premier mot de passe");
  } finally { await i.fermer(); }
});

test('réinviter périme le lien précédent', async () => {
  const i = await demarrer({ publicUrl: 'https://maison.exemple.fr' });
  try {
    await amorcer(i);
    const cree = await i.post<{ id: number }>('/api/personnes',
      { nom: 'Paul Prudhomme', email: 'paul@exemple.fr' });
    const premier = jetonDuDernierCourriel(i, 'invitation');

    const relance = await i.post<{ lien: string | null; courrielEnFile: boolean }>(
      `/api/personnes/${cree.corps.id}/invitation`, { afficherLien: true });
    assert.equal(relance.statut, 200);
    assert.ok(relance.corps.lien?.startsWith('https://maison.exemple.fr/reinitialiser?jeton='),
      'le lien de repli doit être complet et absolu');

    i.deconnecte();
    const avecAncien = await i.post('/api/auth/mot-de-passe-reinitialiser',
      { jeton: premier, motDePasse: NOUVEAU });
    assert.equal(avecAncien.statut, 400, 'un lien noté sur un coin de table cesse de valoir');

    const nouveau = decodeURIComponent(/jeton=([^&]+)$/.exec(relance.corps.lien!)![1]);
    const avecNouveau = await i.post('/api/auth/mot-de-passe-reinitialiser',
      { jeton: nouveau, motDePasse: NOUVEAU });
    assert.equal(avecNouveau.statut, 204);
  } finally { await i.fermer(); }
});

test("afficher le lien en clair est tracé, l'envoyer par courriel ne l'est pas", async () => {
  const i = await demarrer({ publicUrl: 'https://maison.exemple.fr' });
  try {
    await amorcer(i);
    const cree = await i.post<{ id: number }>('/api/personnes',
      { nom: 'Paul Prudhomme', email: 'paul@exemple.fr' });

    const vu = () => (i.db.prepare(
      "SELECT COUNT(*) n FROM reinit_mot_de_passe WHERE personne_id = ? AND vu_le IS NOT NULL",
    ).get(cree.corps.id) as { n: number }).n;

    await i.post(`/api/personnes/${cree.corps.id}/invitation`, { afficherLien: false });
    assert.equal(vu(), 0, "une invitation partie par courriel n'expose rien");

    await i.post(`/api/personnes/${cree.corps.id}/invitation`, { afficherLien: true });
    assert.equal(vu(), 1, "l'affichage en clair doit être daté en base");
  } finally { await i.fermer(); }
});

test("une personne sans adresse ne peut pas être invitée par courriel, et le message le dit", async () => {
  const i = await demarrer({ publicUrl: 'https://maison.exemple.fr' });
  try {
    await amorcer(i);
    const cree = await i.post<{ id: number }>('/api/personnes', { nom: 'Grand-père', email: '' });
    const r = await i.post<{ message: string }>(`/api/personnes/${cree.corps.id}/invitation`,
      { afficherLien: false });
    assert.equal(r.statut, 400);
    assert.match(r.corps.message, /adresse de courriel/,
      "le message doit dire quoi faire, pas seulement que c'est impossible");

    // Le repli reste ouvert : le lien s'affiche et se transmet à la main.
    const repli = await i.post<{ lien: string | null }>(`/api/personnes/${cree.corps.id}/invitation`,
      { afficherLien: true });
    assert.equal(repli.statut, 200);
    assert.ok(repli.corps.lien);
  } finally { await i.fermer(); }
});

test("l'invitation ne s'adresse qu'au gérant", async () => {
  const i = await demarrer({ publicUrl: 'https://maison.exemple.fr' });
  try {
    await amorcer(i);
    const cree = await i.post<{ id: number }>('/api/personnes',
      { nom: 'Paul Prudhomme', email: 'paul@exemple.fr' });
    const jeton = jetonDuDernierCourriel(i, 'invitation');
    i.deconnecte();
    await i.post('/api/auth/mot-de-passe-reinitialiser', { jeton, motDePasse: NOUVEAU });
    await i.connexion('paul@exemple.fr', NOUVEAU);

    const r = await i.post(`/api/personnes/${cree.corps.id}/invitation`, { afficherLien: true });
    assert.equal(r.statut, 403, 'Paul n\'est pas gérant : il ne doit pas voir de lien d\'invitation');

    const liste = await i.get('/api/personnes');
    assert.equal(liste.statut, 403);
  } finally { await i.fermer(); }
});

test('le mot de passe choisi respecte la politique', async () => {
  const i = await demarrer({ publicUrl: 'https://maison.exemple.fr' });
  try {
    await amorcer(i);
    await i.post('/api/personnes', { nom: 'Paul Prudhomme', email: 'paul@exemple.fr' });
    const jeton = jetonDuDernierCourriel(i, 'invitation');
    i.deconnecte();
    const court = await i.post('/api/auth/mot-de-passe-reinitialiser', { jeton, motDePasse: 'court' });
    assert.equal(court.statut, 400, 'la politique de mot de passe vaut aussi à la première saisie');
    // Et le jeton reste utilisable après un essai refusé : sinon une faute de
    // frappe obligerait à redemander une invitation.
    const ok = await i.post('/api/auth/mot-de-passe-reinitialiser', { jeton, motDePasse: MOT_DE_PASSE });
    assert.equal(ok.statut, 204);
  } finally { await i.fermer(); }
});
