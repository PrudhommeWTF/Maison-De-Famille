// Le scénario de recette de la tranche 1, joué de bout en bout.
//
// C'est la liste que Thomas vérifiera lui-même à la main : une demande qui
// chevauche est signalée avant l'envoi et apparaît dans la file de la gérante,
// la validation prévient le demandeur, et le calendrier est à jour pour tout le
// monde.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Instance, MOT_DE_PASSE, amorcer, creerCompte, demarrer } from './aide';

interface Verification {
  nuits: number; couchages: number; envoiPossible: boolean;
  conflits: { nature: string; message: string; nuits: string[] }[];
}
interface Demande { id: number; statut: string; conflits: { nature: string }[] }

/** Hélène gérante, Julien indivisaire, et une location déjà posée en août. */
async function famille(i: Instance) {
  const base = await amorcer(i);
  const foyer = await i.post<{ id: number }>('/api/foyers', { nom: 'Julien et Sofia' });
  const julienId = await creerCompte(i, 'Julien Prudhomme', 'julien@exemple.fr', foyer.corps.id);
  await i.post(`/api/structures/${base.structureId}/detentions`, {
    dateEffet: '2019-06-01', motif: 'Succession de Robert Prudhomme',
    parts: [{ personneId: 1, parts: 1 }, { personneId: julienId, parts: 1 }],
  });
  // La location des Berger, du 1er au 8 août : elle occupe le bien comme
  // n'importe quel séjour.
  const loc = await i.post<Demande>(`/api/biens/${base.bienId}/sejours`, {
    arrivee: '2026-08-01', depart: '2026-08-08', occupants: 6, nature: 'location', titre: 'Famille Berger',
  });
  assert.equal(loc.statut, 200, JSON.stringify(loc.corps));
  assert.equal(loc.corps.statut, 'valide', 'un séjour saisi par la gérante naît validé');
  return { ...base, julienId, foyerId: foyer.corps.id };
}

test('une demande qui chevauche est signalée avant l\'envoi', async () => {
  const i = await demarrer();
  try {
    const f = await famille(i);
    await i.connexion('julien@exemple.fr', MOT_DE_PASSE);

    // Le 8 au 16 : rotation le même jour que le départ des Berger, aucun conflit.
    const propre = await i.post<Verification>(`/api/biens/${f.bienId}/verification`,
      { arrivee: '2026-08-08', depart: '2026-08-16', occupants: 4 });
    assert.equal(propre.statut, 200);
    assert.deepEqual(propre.corps.conflits, [], 'la rotation le même jour ne doit rien signaler');
    assert.equal(propre.corps.nuits, 8);

    // Le 6 au 16 : deux nuits en commun avec la location.
    const sale = await i.post<Verification>(`/api/biens/${f.bienId}/verification`,
      { arrivee: '2026-08-06', depart: '2026-08-16', occupants: 4 });
    const dur = sale.corps.conflits.find((c) => c.nature === 'sejour_valide');
    assert.ok(dur, 'le chevauchement doit être signalé avant l\'envoi');
    assert.deepEqual(dur.nuits, ['2026-08-06', '2026-08-07']);
    assert.match(dur.message, /Berger/);
  } finally { await i.fermer(); }
});

test('la demande part malgré le conflit et la gérante la voit dans sa file', async () => {
  const i = await demarrer();
  try {
    const f = await famille(i);
    await i.connexion('julien@exemple.fr', MOT_DE_PASSE);

    const d = await i.post<Demande>(`/api/biens/${f.bienId}/sejours`,
      { arrivee: '2026-08-06', depart: '2026-08-16', occupants: 4, note: 'Pour rejoindre les cousins' });
    assert.equal(d.statut, 200);
    assert.equal(d.corps.statut, 'demande', 'un indivisaire demande, il ne valide pas');
    assert.ok(d.corps.conflits.some((c) => c.nature === 'sejour_valide'));

    // Julien ne voit pas de file d'attente : il n'est pas gérant.
    assert.deepEqual((await i.get('/api/demandes')).corps, []);

    await i.connexion('helene@exemple.fr', MOT_DE_PASSE);
    const file = await i.get<{ id: number; titre: string; conflits: { nature: string }[] }[]>('/api/demandes');
    assert.equal(file.corps.length, 1);
    assert.equal(file.corps[0].titre, 'Julien Prudhomme');
    assert.ok(file.corps[0].conflits.some((c) => c.nature === 'sejour_valide'),
      'le conflit doit être visible dans la file, pas seulement au moment de la saisie');
  } finally { await i.fermer(); }
});

test('la gérante valide, le demandeur est prévenu et le calendrier suit', async () => {
  const i = await demarrer();
  try {
    const f = await famille(i);
    await i.connexion('julien@exemple.fr', MOT_DE_PASSE);
    const d = await i.post<Demande>(`/api/biens/${f.bienId}/sejours`,
      { arrivee: '2026-08-08', depart: '2026-08-16', occupants: 4 });

    await i.connexion('helene@exemple.fr', MOT_DE_PASSE);
    const dec = await i.post(`/api/biens/${f.bienId}/sejours/${d.corps.id}/decision`,
      { statut: 'valide', note: 'Bon séjour' });
    assert.equal(dec.statut, 200);

    // Le courriel est en file, prêt à partir, avec un lien absolu.
    const n = i.db.prepare('SELECT type, sujet, lien, personne_id FROM notification ORDER BY id DESC LIMIT 1')
      .get() as { type: string; sujet: string; lien: string; personne_id: number };
    assert.equal(n.type, 'demande_decidee');
    assert.equal(n.personne_id, f.julienId);
    assert.match(n.sujet, /Séjour validé/);
    assert.match(n.lien, /^https:\/\/maison\.test\//, 'les liens des courriels doivent être absolus');

    // Le calendrier est à jour pour tout le monde, Julien compris.
    await i.connexion('julien@exemple.fr', MOT_DE_PASSE);
    const cal = await i.get<{ sejours: { statut: string; arrivee: string }[] }>(
      `/api/biens/${f.bienId}/sejours?du=2026-08-01&au=2026-09-01`);
    const sien = cal.corps.sejours.find((s) => s.arrivee === '2026-08-08');
    assert.equal(sien?.statut, 'valide');
  } finally { await i.fermer(); }
});

test('une décision se renvoie avec un message, et s\'annule', async () => {
  const i = await demarrer();
  try {
    const f = await famille(i);
    await i.connexion('julien@exemple.fr', MOT_DE_PASSE);
    const d = await i.post<Demande>(`/api/biens/${f.bienId}/sejours`,
      { arrivee: '2026-08-08', depart: '2026-08-16', occupants: 4 });

    await i.connexion('helene@exemple.fr', MOT_DE_PASSE);
    await i.post(`/api/biens/${f.bienId}/sejours/${d.corps.id}/decision`,
      { statut: 'a_revoir', note: 'Peux-tu décaler au 9 ?' });
    let ligne = i.db.prepare('SELECT statut, decision_note FROM sejour WHERE id = ?').get(d.corps.id) as { statut: string; decision_note: string };
    assert.equal(ligne.statut, 'a_revoir');
    assert.equal(ligne.decision_note, 'Peux-tu décaler au 9 ?');

    await i.post(`/api/biens/${f.bienId}/sejours/${d.corps.id}/annulation-decision`);
    ligne = i.db.prepare('SELECT statut, decision_note FROM sejour WHERE id = ?').get(d.corps.id) as { statut: string; decision_note: string };
    assert.equal(ligne.statut, 'demande', 'annuler une décision la ramène en attente');
    // La trace de la décision annulée reste dans le journal.
    const audit = i.db.prepare("SELECT COUNT(*) AS n FROM journal_audit WHERE action = 'sejour.decision_annulee'").get() as { n: number };
    assert.equal(audit.n, 1);
  } finally { await i.fermer(); }
});

test('valider malgré un conflit est possible, et journalisé', async () => {
  const i = await demarrer();
  try {
    const f = await famille(i);
    await i.connexion('julien@exemple.fr', MOT_DE_PASSE);
    const d = await i.post<Demande>(`/api/biens/${f.bienId}/sejours`,
      { arrivee: '2026-08-06', depart: '2026-08-16', occupants: 4 });

    await i.connexion('helene@exemple.fr', MOT_DE_PASSE);
    const dec = await i.post<{ conflits: unknown[] }>(`/api/biens/${f.bienId}/sejours/${d.corps.id}/decision`,
      { statut: 'valide' });
    assert.equal(dec.statut, 200, 'la gérante arbitre : l\'application ne décide pas à sa place');
    assert.ok(dec.corps.conflits.length);

    const audit = i.db.prepare("SELECT detail_json FROM journal_audit WHERE action = 'sejour.validation_malgre_conflit'")
      .get() as { detail_json: string } | undefined;
    assert.ok(audit, 'le passage en force doit laisser une trace');
    assert.match(audit.detail_json, /Berger/);
  } finally { await i.fermer(); }
});

test('un indivisaire ne peut pas saisir un séjour pour quelqu\'un d\'autre', async () => {
  const i = await demarrer();
  try {
    const f = await famille(i);
    await i.connexion('julien@exemple.fr', MOT_DE_PASSE);
    const pourAutrui = await i.post(`/api/biens/${f.bienId}/sejours`,
      { arrivee: '2026-09-01', depart: '2026-09-05', occupants: 2, demandeurId: 1 });
    assert.equal(pourAutrui.statut, 403);

    const location = await i.post(`/api/biens/${f.bienId}/sejours`,
      { arrivee: '2026-09-01', depart: '2026-09-05', occupants: 2, nature: 'location' });
    assert.equal(location.statut, 403, 'poser une location n\'est pas à la main des indivisaires');
  } finally { await i.fermer(); }
});

test('chacun annule sa demande, la gérante annule ce qu\'elle veut', async () => {
  const i = await demarrer();
  try {
    const f = await famille(i);
    await i.connexion('julien@exemple.fr', MOT_DE_PASSE);
    const sien = await i.post<Demande>(`/api/biens/${f.bienId}/sejours`,
      { arrivee: '2026-07-01', depart: '2026-07-08', occupants: 2 });

    // Julien annule le séjour de la location, qui n'est pas le sien.
    const loc = i.db.prepare("SELECT id FROM sejour WHERE nature = 'location'").get() as { id: number };
    assert.equal((await i.post(`/api/biens/${f.bienId}/sejours/${loc.id}/annulation`)).statut, 403);
    // Le sien, oui.
    assert.equal((await i.post(`/api/biens/${f.bienId}/sejours/${sien.corps.id}/annulation`)).statut, 204);

    await i.connexion('helene@exemple.fr', MOT_DE_PASSE);
    assert.equal((await i.post(`/api/biens/${f.bienId}/sejours/${loc.id}/annulation`)).statut, 204);
  } finally { await i.fermer(); }
});

test('un séjour d\'un autre bien ne se décide pas par la porte de celui-ci', async () => {
  const i = await demarrer();
  try {
    const f = await famille(i);
    const autre = await i.post<{ bienId: number }>('/api/biens', {
      structureId: f.structureId, nom: 'La Cabane', commune: 'Crozon', type: 'mer', couchages: 2,
    });
    const s = await i.post<Demande>(`/api/biens/${autre.corps.bienId}/sejours`,
      { arrivee: '2026-10-01', depart: '2026-10-03', occupants: 2, demandeurId: f.julienId });

    // Même gérante, même structure : l'accès au bien est légitime. Le séjour,
    // lui, appartient à l'autre bien, et la route doit le refuser.
    const r = await i.post(`/api/biens/${f.bienId}/sejours/${s.corps.id}/decision`, { statut: 'valide' });
    assert.equal(r.statut, 404);
  } finally { await i.fermer(); }
});

test('la capacité du bien est signalée mais ne bloque pas par défaut', async () => {
  const i = await demarrer();
  try {
    const f = await famille(i);
    await i.connexion('julien@exemple.fr', MOT_DE_PASSE);
    const v = await i.post<Verification>(`/api/biens/${f.bienId}/verification`,
      { arrivee: '2026-09-01', depart: '2026-09-05', occupants: 12 });
    assert.ok(v.corps.conflits.some((c) => c.nature === 'capacite'));
    assert.equal(v.corps.envoiPossible, true, 'par défaut, la gérante tranche');

    // Le réglage du bien peut rendre le dépassement bloquant.
    await i.connexion('helene@exemple.fr', MOT_DE_PASSE);
    await i.post(`/api/biens/${f.bienId}/parametres`, { cle: 'capaciteBloquante', valeur: true });
    await i.connexion('julien@exemple.fr', MOT_DE_PASSE);
    const v2 = await i.post<Verification>(`/api/biens/${f.bienId}/verification`,
      { arrivee: '2026-09-01', depart: '2026-09-05', occupants: 12 });
    assert.equal(v2.corps.envoiPossible, false);
    assert.equal((await i.post(`/api/biens/${f.bienId}/sejours`,
      { arrivee: '2026-09-01', depart: '2026-09-05', occupants: 12 })).statut, 422);
  } finally { await i.fermer(); }
});

test('un séjour dont le départ précède l\'arrivée est refusé', async () => {
  const i = await demarrer();
  try {
    const f = await famille(i);
    for (const [arrivee, depart] of [['2026-08-16', '2026-08-08'], ['2026-08-08', '2026-08-08']]) {
      const r = await i.post(`/api/biens/${f.bienId}/sejours`, { arrivee, depart, occupants: 2 });
      assert.equal(r.statut, 400, `${arrivee} → ${depart} aurait dû être refusé`);
    }
  } finally { await i.fermer(); }
});
