// La règle des deux gérants.
//
// Elle vaut au serveur, pas seulement à l'écran : une règle qui ne vit que dans
// l'interface ne s'applique pas, elle se contourne avec un client HTTP.
//
// Le cas qui compte n'est pas le retrait du dernier gérant, qui est évident.
// C'est le retrait de l'**avant-dernier**, celui qui se présentera en vrai, le
// jour où une fratrie voudra « simplifier » en laissant la mère seule aux
// commandes. C'est précisément la situation que l'application est censée
// supprimer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amorcer, demarrer } from './aide';
import { GERANTS_MINIMUM, GouvernanceImpossible, alertes, controlerRetraitGerant } from '../src/acces/gouvernance';

test('la règle pure refuse de descendre sous deux gérants', () => {
  assert.throws(() => controlerRetraitGerant(1, "Indivision Kerloc'h"), GouvernanceImpossible,
    'retirer le seul gérant fermerait la porte à tout le monde');
  assert.throws(() => controlerRetraitGerant(2, "Indivision Kerloc'h"), GouvernanceImpossible,
    "retirer l'avant-dernier est le cas qui compte");
  assert.doesNotThrow(() => controlerRetraitGerant(3, "Indivision Kerloc'h"));
  assert.equal(GERANTS_MINIMUM, 2);
});

test('le message nomme la structure et dit quoi faire', () => {
  try {
    controlerRetraitGerant(2, "Indivision Kerloc'h");
    assert.fail('aurait dû refuser');
  } catch (e) {
    const m = (e as Error).message;
    assert.match(m, /Kerloc'h/, 'un message sans le nom de la structure est illisible avec trois biens');
    assert.match(m, /Désignez/, "le message doit dire quoi faire, pas seulement que c'est refusé");
  }
});

test('les alertes ne remontent que les structures sous le seuil', () => {
  const a = alertes([
    { id: 1, nom: "Indivision Kerloc'h", gerants: 1 },
    { id: 2, nom: 'SCI du Mont', gerants: 2 },
    { id: 3, nom: 'Studio', gerants: 0 },
  ]);
  assert.deepEqual(a.map((x) => x.structureId), [1, 3]);
  assert.match(a[0].message, /un seul gérant/);
  assert.match(a[1].message, /aucun gérant/,
    'zéro gérant et un gérant ne se disent pas de la même façon');
});

test('une instance fraîchement amorcée signale son gérant unique', async () => {
  const i = await demarrer();
  try {
    const { structureId } = await amorcer(i);
    const g = await i.get<{ alertes: { structureId: number; gerants: number }[] }>('/api/gouvernance');
    assert.equal(g.statut, 200);
    assert.equal(g.corps.alertes.length, 1, "l'amorçage laisse une structure à un seul gérant");
    assert.equal(g.corps.alertes[0].structureId, structureId);
    assert.equal(g.corps.alertes[0].gerants, 1);
  } finally { await i.fermer(); }
});

test("l'alerte disparaît quand un second gérant est désigné", async () => {
  const i = await demarrer();
  try {
    const { structureId } = await amorcer(i);
    const paul = await i.post<{ id: number }>('/api/personnes',
      { nom: 'Paul Prudhomme', email: 'paul@exemple.fr' });
    await i.post(`/api/structures/${structureId}/roles`, { personneId: paul.corps.id, role: 'gerant' });

    const g = await i.get<{ alertes: unknown[] }>('/api/gouvernance');
    assert.equal(g.corps.alertes.length, 0);
  } finally { await i.fermer(); }
});

test('le serveur refuse de repasser à un seul gérant', async () => {
  const i = await demarrer();
  try {
    const { structureId, personneId } = await amorcer(i);
    const paul = await i.post<{ id: number }>('/api/personnes',
      { nom: 'Paul Prudhomme', email: 'paul@exemple.fr' });
    await i.post(`/api/structures/${structureId}/roles`, { personneId: paul.corps.id, role: 'gerant' });

    const retrait = await i.post<{ message: string }>(`/api/structures/${structureId}/roles/retrait`,
      { personneId: paul.corps.id, role: 'gerant' });
    assert.equal(retrait.statut, 422, 'deux gérants est un plancher, pas un conseil');
    assert.match(retrait.corps.message, /au moins 2 gérants/);

    // Et la gérante ne peut pas non plus se retirer elle-même.
    const soi = await i.post(`/api/structures/${structureId}/roles/retrait`,
      { personneId, role: 'gerant' });
    assert.equal(soi.statut, 422);

    const g = await i.get<{ alertes: unknown[] }>('/api/gouvernance');
    assert.equal(g.corps.alertes.length, 0, 'les deux gérants sont toujours là');
  } finally { await i.fermer(); }
});

test('un troisième gérant peut être retiré, les autres rôles aussi', async () => {
  const i = await demarrer();
  try {
    const { structureId } = await amorcer(i);
    const ids: number[] = [];
    for (const nom of ['Paul', 'Claire']) {
      const p = await i.post<{ id: number }>('/api/personnes',
        { nom, email: `${nom.toLowerCase()}@exemple.fr` });
      ids.push(p.corps.id);
      await i.post(`/api/structures/${structureId}/roles`, { personneId: p.corps.id, role: 'gerant' });
    }
    const retrait = await i.post(`/api/structures/${structureId}/roles/retrait`,
      { personneId: ids[1], role: 'gerant' });
    assert.equal(retrait.statut, 204, 'à trois gérants, le retrait passe');

    // Un rôle qui n'est pas gérant ne dépend pas du seuil.
    await i.post(`/api/structures/${structureId}/roles`, { personneId: ids[1], role: 'membre_foyer' });
    const autre = await i.post(`/api/structures/${structureId}/roles/retrait`,
      { personneId: ids[1], role: 'membre_foyer' });
    assert.equal(autre.statut, 204);
  } finally { await i.fermer(); }
});

test('retirer un rôle que la personne n\'a pas est refusé clairement', async () => {
  const i = await demarrer();
  try {
    const { structureId } = await amorcer(i);
    const paul = await i.post<{ id: number }>('/api/personnes',
      { nom: 'Paul Prudhomme', email: 'paul@exemple.fr' });
    const r = await i.post<{ message: string }>(`/api/structures/${structureId}/roles/retrait`,
      { personneId: paul.corps.id, role: 'detenteur' });
    assert.equal(r.statut, 400);
    assert.match(r.corps.message, /n'a pas ce rôle/);
  } finally { await i.fermer(); }
});

test('un rôle retiré coupe effectivement l\'accès', async () => {
  const i = await demarrer();
  try {
    const { structureId } = await amorcer(i);
    const paul = await i.post<{ id: number }>('/api/personnes',
      { nom: 'Paul Prudhomme', email: 'paul@exemple.fr' });
    await i.post(`/api/structures/${structureId}/roles`, { personneId: paul.corps.id, role: 'gerant' });

    const jeton = i.db.prepare(
      "SELECT lien FROM notification WHERE type = 'invitation' ORDER BY id DESC LIMIT 1",
    ).get() as { lien: string };
    const t = decodeURIComponent(/jeton=([^&]+)$/.exec(jeton.lien)![1]);
    i.deconnecte();
    await i.post('/api/auth/mot-de-passe-reinitialiser', { jeton: t, motDePasse: 'le-mot-de-passe-de-paul' });
    await i.connexion('paul@exemple.fr', 'le-mot-de-passe-de-paul');
    assert.equal((await i.get('/api/personnes')).statut, 200, 'Paul est gérant, il voit les personnes');

    // Hélène le rétrograde (ils sont trois avec Claire, pour passer le seuil).
    i.deconnecte();
    await i.connexion('helene@exemple.fr', 'un-mot-de-passe-qui-tient');
    const claire = await i.post<{ id: number }>('/api/personnes',
      { nom: 'Claire', email: 'claire@exemple.fr' });
    await i.post(`/api/structures/${structureId}/roles`, { personneId: claire.corps.id, role: 'gerant' });
    await i.post(`/api/structures/${structureId}/roles/retrait`,
      { personneId: paul.corps.id, role: 'gerant' });

    i.deconnecte();
    await i.connexion('paul@exemple.fr', 'le-mot-de-passe-de-paul');
    assert.equal((await i.get('/api/personnes')).statut, 403,
      'le retrait doit couper l\'accès tout de suite, pas à la prochaine expiration de jeton');
  } finally { await i.fermer(); }
});
