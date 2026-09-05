// Le tour de choix saisonnier.
//
// Ce module ne décide rien : il applique un ordre convenu et rend le résultat
// visible, pour que l'équité se constate au lieu de se discuter. Les tests
// portent donc surtout sur ce qu'il **explique** : chaque refus doit dire
// pourquoi, et le bilan doit montrer les dépassements sans les empêcher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arbitrer, ordreSuivant } from '../src/sejours/tour-de-choix';
import { MOT_DE_PASSE, amorcer, creerCompte, demarrer } from './aide';

const HELENE = 1, CLAIRE = 2, THOMAS = 3, JULIEN = 4;

const voeu = (id: number, foyerId: number, rang: number, du: string, au: string) =>
  ({ id, foyerId, rang, du, au, occupants: 4 });

test('les premiers choix sont servis dans l\'ordre de priorité', () => {
  // Tout le monde veut la première quinzaine d'août : c'est le cas nominal.
  const r = arbitrer({
    voeux: [
      voeu(1, JULIEN, 1, '2026-08-01', '2026-08-15'),
      voeu(2, HELENE, 1, '2026-08-01', '2026-08-15'),
      voeu(3, CLAIRE, 1, '2026-08-01', '2026-08-15'),
    ],
    ordre: [HELENE, CLAIRE, THOMAS, JULIEN],
    quotas: new Map(), deja: [],
  });
  assert.deepEqual(r.attributions.map((a) => a.foyerId), [HELENE]);
  assert.deepEqual(r.refus.map((x) => x.foyerId), [CLAIRE, JULIEN]);
  for (const x of r.refus) assert.match(x.raison, /déjà attribuée, du 2026-08-01 au 2026-08-15/);
});

test('les seconds choix sont servis sur ce qui reste', () => {
  const r = arbitrer({
    voeux: [
      voeu(1, HELENE, 1, '2026-08-01', '2026-08-15'),
      voeu(2, CLAIRE, 1, '2026-08-01', '2026-08-15'),
      voeu(3, CLAIRE, 2, '2026-08-15', '2026-08-29'),
    ],
    ordre: [HELENE, CLAIRE], quotas: new Map(), deja: [],
  });
  assert.deepEqual(r.attributions.map((a) => [a.foyerId, a.du]), [
    [HELENE, '2026-08-01'], [CLAIRE, '2026-08-15'],
  ]);
});

test('ce qui est déjà posé sur la saison bloque les voeux', () => {
  // Une semaine louée posée avant l'ouverture du tour de choix.
  const r = arbitrer({
    voeux: [voeu(1, HELENE, 1, '2026-08-01', '2026-08-15')],
    ordre: [HELENE], quotas: new Map(),
    deja: [{ du: '2026-07-28', au: '2026-08-04' }],
  });
  assert.equal(r.attributions.length, 0);
  assert.match(r.refus[0].raison, /2026-07-28/);
});

test('la rotation le même jour reste possible dans le tour de choix', () => {
  const r = arbitrer({
    voeux: [
      voeu(1, HELENE, 1, '2026-08-01', '2026-08-08'),
      voeu(2, CLAIRE, 1, '2026-08-08', '2026-08-15'),
    ],
    ordre: [HELENE, CLAIRE], quotas: new Map(), deja: [],
  });
  assert.equal(r.attributions.length, 2, 'les deux semaines se suivent sans se chevaucher');
});

test('le quota est indicatif : il apparaît au bilan, il ne refuse rien', () => {
  const r = arbitrer({
    voeux: [voeu(1, HELENE, 1, '2026-07-01', '2026-08-01')],
    ordre: [HELENE], quotas: new Map([[HELENE, 14]]), deja: [],
  });
  assert.equal(r.attributions.length, 1, 'le quota ne bloque pas : la gérante décide');
  const bilan = r.bilan.find((b) => b.foyerId === HELENE);
  assert.equal(bilan?.nuits, 31);
  assert.equal(bilan?.quota, 14);
  assert.equal(bilan?.depassement, 17);
});

test('un foyer absent de l\'ordre passe en dernier sans faire échouer l\'arbitrage', () => {
  const r = arbitrer({
    voeux: [
      voeu(1, JULIEN, 1, '2026-08-01', '2026-08-15'),
      voeu(2, HELENE, 1, '2026-08-01', '2026-08-15'),
    ],
    ordre: [HELENE], quotas: new Map(), deja: [],
  });
  assert.deepEqual(r.attributions.map((a) => a.foyerId), [HELENE]);
  assert.equal(r.refus.length, 1);
});

test('aucun voeu ne produit ni attribution ni erreur', () => {
  const r = arbitrer({ voeux: [], ordre: [HELENE, CLAIRE], quotas: new Map(), deja: [] });
  assert.deepEqual(r.attributions, []);
  assert.deepEqual(r.refus, []);
});

test('l\'ordre de priorité tourne d\'une année sur l\'autre', () => {
  assert.deepEqual(ordreSuivant([1, 2, 3, 4]), [2, 3, 4, 1]);
  assert.deepEqual(ordreSuivant([1]), [1]);
  assert.deepEqual(ordreSuivant([]), []);
});

test('l\'arbitrage propose des demandes, il ne valide rien', async () => {
  const i = await demarrer();
  try {
    const base = await amorcer(i);
    const fHelene = await i.post<{ id: number }>('/api/foyers', { nom: 'Hélène' });
    const fJulien = await i.post<{ id: number }>('/api/foyers', { nom: 'Julien et Sofia' });
    i.db.prepare('UPDATE personne SET foyer_id = ? WHERE id = 1').run(fHelene.corps.id);
    const julienId = await creerCompte(i, 'Julien', 'julien@exemple.fr', fJulien.corps.id);
    await i.post(`/api/structures/${base.structureId}/detentions`, {
      dateEffet: '2019-06-01', motif: 'Succession',
      parts: [{ personneId: 1, parts: 1 }, { personneId: julienId, parts: 1 }],
    });

    const saison = await i.post<{ id: number }>(`/api/biens/${base.bienId}/saisons`,
      { libelle: 'Été 2026', debut: '2026-07-01', fin: '2026-09-01' });
    assert.equal(saison.statut, 200);
    await i.post(`/api/biens/${base.bienId}/saisons/${saison.corps.id}/ordre`,
      { ordre: [fJulien.corps.id, fHelene.corps.id] });
    await i.post(`/api/biens/${base.bienId}/saisons/${saison.corps.id}/quotas`,
      { foyerId: fJulien.corps.id, nuitsMax: 7 });

    // Chacun dépose pour son foyer.
    await i.connexion('julien@exemple.fr', MOT_DE_PASSE);
    assert.equal((await i.post(`/api/biens/${base.bienId}/saisons/${saison.corps.id}/voeux`,
      { rang: 1, du: '2026-08-01', au: '2026-08-15', occupants: 4 })).statut, 204);

    await i.connexion('helene@exemple.fr', MOT_DE_PASSE);
    await i.post(`/api/biens/${base.bienId}/saisons/${saison.corps.id}/voeux`,
      { rang: 1, du: '2026-08-01', au: '2026-08-15', occupants: 2 });
    await i.post(`/api/biens/${base.bienId}/saisons/${saison.corps.id}/voeux`,
      { rang: 2, du: '2026-08-15', au: '2026-08-22', occupants: 2 });

    const arb = await i.post<{ attributions: unknown[]; refus: unknown[]; sejoursProposes: number[]; depassements: { foyerId: number; depassement: number }[] }>(
      `/api/biens/${base.bienId}/saisons/${saison.corps.id}/arbitrage`);
    assert.equal(arb.statut, 200);
    assert.equal(arb.corps.attributions.length, 2, 'Julien prioritaire, puis le second choix d\'Hélène');
    assert.equal(arb.corps.sejoursProposes.length, 2);
    assert.equal(arb.corps.depassements[0].depassement, 7, '14 nuits pour un quota de 7');

    // Les séjours créés sont des DEMANDES : la décision finale reste humaine.
    const statuts = i.db.prepare("SELECT DISTINCT statut FROM sejour WHERE origine = 'gerante'").all() as { statut: string }[];
    assert.deepEqual(statuts, [{ statut: 'demande' }]);
    // Et l'arbitrage est journalisé, avec son résultat complet.
    const audit = i.db.prepare("SELECT COUNT(*) AS n FROM journal_audit WHERE action = 'saison.arbitrage'").get() as { n: number };
    assert.equal(audit.n, 1);
  } finally { await i.fermer(); }
});

test('un voeu hors de la saison est refusé, avec les dates de la saison', async () => {
  const i = await demarrer();
  try {
    const base = await amorcer(i);
    const foyer = await i.post<{ id: number }>('/api/foyers', { nom: 'Hélène' });
    i.db.prepare('UPDATE personne SET foyer_id = ? WHERE id = 1').run(foyer.corps.id);
    const saison = await i.post<{ id: number }>(`/api/biens/${base.bienId}/saisons`,
      { libelle: 'Été 2026', debut: '2026-07-01', fin: '2026-09-01' });
    const r = await i.post<{ message: string }>(`/api/biens/${base.bienId}/saisons/${saison.corps.id}/voeux`,
      { rang: 1, du: '2026-12-20', au: '2026-12-27', occupants: 2 });
    assert.equal(r.statut, 400);
    assert.match(r.corps.message, /2026-07-01 au 2026-09-01/);
  } finally { await i.fermer(); }
});

test('une saison d\'un autre bien ne s\'arbitre pas par la porte de celui-ci', async () => {
  const i = await demarrer();
  try {
    const base = await amorcer(i);
    const autre = await i.post<{ bienId: number }>('/api/biens', {
      structureId: base.structureId, nom: 'La Cabane', commune: 'Crozon', type: 'mer', couchages: 2,
    });
    const saison = await i.post<{ id: number }>(`/api/biens/${autre.corps.bienId}/saisons`,
      { libelle: 'Été 2026', debut: '2026-07-01', fin: '2026-09-01' });
    const r = await i.post(`/api/biens/${base.bienId}/saisons/${saison.corps.id}/arbitrage`);
    assert.equal(r.statut, 404);
  } finally { await i.fermer(); }
});
