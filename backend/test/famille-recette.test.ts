// La recette de la tranche 4, jouée par les routes.
//
// La phrase qui la commande : « un lien d'invité expiré ne donne plus accès au
// code d'accès, y compris en tapant l'adresse directement ».
//
// Elle est vérifiée deux fois, pour les deux verrous qui doivent la tenir :
// le jeton, qui n'ouvre plus de session, et le rôle daté, qui coupe les
// sessions déjà ouvertes. Le second est celui qui compte : sans lui, un
// locataire dont le séjour est fini garderait son onglet ouvert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOT_DE_PASSE, amorcer, creerCompte, demarrer } from './aide';
import type { Instance } from './aide';

const CLE = 'd'.repeat(64);
const jourDecale = (j: number): string =>
  new Date(Date.now() + j * 86_400_000).toISOString().slice(0, 10);

/** Une indivision à quatre, à parts égales, avec la répartition saisie. */
async function indivision(i: Instance) {
  const { bienId, structureId, personneId } = await amorcer(i);
  const ids = [personneId];
  for (const nom of ['Claire', 'Julien', 'Thomas']) {
    ids.push(await creerCompte(i, `${nom} Prudhomme`, `${nom.toLowerCase()}@exemple.fr`));
  }
  const r = await i.post(`/api/structures/${structureId}/detentions`, {
    dateEffet: '2019-03-14', motif: "Convention d'indivision",
    parts: ids.map((id) => ({ personneId: id, parts: 25 })),
  });
  assert.equal(r.statut, 204, JSON.stringify(r.corps));
  return { bienId, structureId, ids };
}

const regleDe = async (i: Instance, structureId: number, acte: string): Promise<number> => {
  const d = await i.get<{ regles: { id: number; acte: string }[] }>(`/api/structures/${structureId}/decisions`);
  const g = d.corps.regles.find((x) => x.acte === acte);
  assert.ok(g, `règle ${acte} introuvable`);
  return g!.id;
};

// ------------------------------------------------------------------
// Les scrutins
// ------------------------------------------------------------------

test('un vote se joue aux parts, pas aux têtes, et le seuil vient de la table', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { structureId, ids } = await indivision(i);
    const regleId = await regleDe(i, structureId, 'gestion_courante');
    const s = await i.post<{ id: number }>(`/api/structures/${structureId}/decisions`, {
      regleId, titre: 'Remplacer la chaudière', expose: 'Devis Le Bihan, 4 800 €',
      montantCents: 480000, clotureLe: jourDecale(20),
    });
    assert.equal(s.statut, 200, JSON.stringify(s.corps));

    const v = await i.get<{ depouillement: { total: number; requis: number }; voix: unknown[] }>(
      `/api/structures/${structureId}/decisions/${s.corps.id}`);
    assert.equal(v.corps.voix.length, 4, 'les quatre indivisaires sont électeurs');
    assert.equal(v.corps.depouillement.total, 100);
    assert.equal(v.corps.depouillement.requis, 67, 'deux tiers de 100 valent 67, pas 66');

    // Trois voix pour : 75 sur 100, au-dessus du seuil.
    for (const [id, email] of [[ids[0], 'helene@exemple.fr'], [ids[1], 'claire@exemple.fr'], [ids[2], 'julien@exemple.fr']] as const) {
      void id;
      i.deconnecte();
      await i.connexion(email, MOT_DE_PASSE);
      const r = await i.post(`/api/scrutins/${s.corps.id}/voix`, { sens: 'pour' });
      assert.equal(r.statut, 200, JSON.stringify(r.corps));
    }
    i.deconnecte();
    await i.connexion('helene@exemple.fr', MOT_DE_PASSE);
    const d = await i.post<{ scrutin: { statut: string }; depouillement: { adopte: boolean; explication: string } }>(
      `/api/structures/${structureId}/decisions/${s.corps.id}/depouillement`, {});
    assert.equal(d.corps.scrutin.statut, 'adopte');
    assert.equal(d.corps.depouillement.adopte, true);
    assert.match(d.corps.depouillement.explication, /Seuil à atteindre : 67/);
  } finally { await i.fermer(); }
});

test('une abstention bloque, et le message dit pourquoi', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { structureId } = await indivision(i);
    const regleId = await regleDe(i, structureId, 'gestion_courante');
    const s = await i.post<{ id: number }>(`/api/structures/${structureId}/decisions`, {
      regleId, titre: 'Refaire la toiture', clotureLe: jourDecale(20),
    });
    // Deux pour, deux silences : 50 sur 100, sous le seuil, alors que les voix
    // exprimées seraient unanimes.
    for (const email of ['helene@exemple.fr', 'claire@exemple.fr']) {
      i.deconnecte();
      await i.connexion(email, MOT_DE_PASSE);
      await i.post(`/api/scrutins/${s.corps.id}/voix`, { sens: 'pour' });
    }
    i.deconnecte();
    await i.connexion('helene@exemple.fr', MOT_DE_PASSE);
    const d = await i.post<{ depouillement: { adopte: boolean; explication: string } }>(
      `/api/structures/${structureId}/decisions/${s.corps.id}/depouillement`, {});
    assert.equal(d.corps.depouillement.adopte, false);
    assert.match(d.corps.depouillement.explication, /abstention comptent dans le corps électoral/);
  } finally { await i.fermer(); }
});

test('un détenteur sorti pendant le scrutin garde sa voix', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { structureId, ids } = await indivision(i);
    const regleId = await regleDe(i, structureId, 'gestion_courante');
    const s = await i.post<{ id: number }>(`/api/structures/${structureId}/decisions`, {
      regleId, titre: 'Vendre le terrain du bas', clotureLe: jourDecale(20),
    });

    // Thomas cède ses parts aux trois autres, en cours de scrutin.
    const r = await i.post(`/api/structures/${structureId}/detentions`, {
      dateEffet: jourDecale(0), motif: 'Rachat des parts de Thomas',
      parts: [
        { personneId: ids[0], parts: 34 }, { personneId: ids[1], parts: 33 },
        { personneId: ids[2], parts: 33 },
      ],
    });
    assert.equal(r.statut, 204, JSON.stringify(r.corps));

    const v = await i.get<{ depouillement: { total: number }; voix: { personneId: number; poids: number }[] }>(
      `/api/structures/${structureId}/decisions/${s.corps.id}`);
    assert.equal(v.corps.voix.length, 4, 'le corps électoral reste celui de l\'ouverture');
    assert.equal(v.corps.depouillement.total, 100);
    assert.equal(v.corps.voix.find((x) => x.personneId === ids[3])?.poids, 25,
      'Thomas garde le poids qu\'il avait quand le scrutin s\'est ouvert');

    // Et il peut encore voter : sa voix a été appelée, elle compte.
    i.deconnecte();
    await i.connexion('thomas@exemple.fr', MOT_DE_PASSE);
    assert.equal((await i.post(`/api/scrutins/${s.corps.id}/voix`,
      { sens: 'contre' })).statut, 200);
  } finally { await i.fermer(); }
});

test('quelqu\'un hors du corps électoral ne vote pas, et on lui dit pourquoi', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { structureId, ids } = await indivision(i);
    const regleId = await regleDe(i, structureId, 'gestion_courante');
    const s = await i.post<{ id: number }>(`/api/structures/${structureId}/decisions`, {
      regleId, titre: 'Repeindre les volets', clotureLe: jourDecale(20),
    });
    // Une nouvelle indivisaire entre après l'ouverture.
    const sofia = await creerCompte(i, 'Sofia Prudhomme', 'sofia@exemple.fr');
    await i.post(`/api/structures/${structureId}/detentions`, {
      dateEffet: jourDecale(0), motif: 'Donation',
      parts: [...ids.map((id) => ({ personneId: id, parts: 20 })), { personneId: sofia, parts: 20 }],
    });
    i.deconnecte();
    await i.connexion('sofia@exemple.fr', MOT_DE_PASSE);
    const r = await i.post<{ message: string }>(
      `/api/scrutins/${s.corps.id}/voix`, { sens: 'pour' });
    assert.equal(r.statut, 422);
    assert.match(r.corps.message, /figé à son ouverture/);
    assert.match(r.corps.message, /prochain vote/, 'le message doit dire ce qui se passera ensuite');
  } finally { await i.fermer(); }
});

test('en nom propre, aucun vote ne s\'ouvre, et l\'écran le sait', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    await amorcer(i);
    const b = await i.post<{ bienId: number; structureId: number }>('/api/biens', {
      nom: 'Studio de Brest', commune: 'Brest', type: 'ville', couchages: 2,
      structureMode: 'nom_propre', structureNom: 'Hélène Prudhomme',
    });
    assert.equal(b.statut, 200, JSON.stringify(b.corps));
    const d = await i.get<{ voteApplicable: boolean; regles: { acte: string }[] }>(
      `/api/structures/${b.corps.structureId}/decisions`);
    assert.equal(d.corps.voteApplicable, false, "le nom propre ne vote pas : l'écran doit le dire");

    const regleId = await regleDe(i, b.corps.structureId, 'decision_proprietaire');
    const r = await i.post<{ message: string }>(`/api/structures/${b.corps.structureId}/decisions`, {
      regleId, titre: 'Changer la serrure', clotureLe: jourDecale(10),
    });
    assert.equal(r.statut, 422);
    assert.match(r.corps.message, /ne demande pas de vote/);
  } finally { await i.fermer(); }
});

test('le rappel de clôture ne part qu\'à ceux qui n\'ont pas voté', async () => {
  const i = await demarrer({ cleCoffre: CLE, publicUrl: 'https://maison.exemple.fr' });
  try {
    const { structureId } = await indivision(i);
    const regleId = await regleDe(i, structureId, 'gestion_courante');
    const s = await i.post<{ id: number }>(`/api/structures/${structureId}/decisions`, {
      regleId, titre: 'Ravalement de la façade', clotureLe: jourDecale(3),
    });
    i.deconnecte();
    await i.connexion('claire@exemple.fr', MOT_DE_PASSE);
    await i.post(`/api/scrutins/${s.corps.id}/voix`, { sens: 'pour' });

    const { rappelerClotures } = await import('../src/decisions/routes');
    const { charger } = await import('../src/noyau/config');
    const config = { ...charger(), publicUrl: 'https://maison.exemple.fr' };

    assert.equal(rappelerClotures(i.db, config), 3, 'trois personnes sur quatre restent à convaincre');
    const n = i.db.prepare(
      "SELECT corps_texte AS t FROM notification WHERE type = 'vote_cloture_proche' LIMIT 1",
    ).get() as { t: string };
    assert.match(n.t, /revient à voter contre/,
      'le rappel doit dire que le silence n\'est pas neutre');
  } finally { await i.fermer(); }
});

// ------------------------------------------------------------------
// Les accès temporaires
// ------------------------------------------------------------------

test('un lien d\'invité ouvre une session sans compte, et voit le code de son séjour', async () => {
  const i = await demarrer({ cleCoffre: CLE, publicUrl: 'https://maison.exemple.fr' });
  try {
    const { bienId } = await indivision(i);
    const code = await i.post<{ id: number }>(`/api/biens/${bienId}/coffre/codes`, {
      libelle: 'Boîte à clés', valeur: '2059', portee: 'sejour', note: '',
    });
    const a = await i.post<{ lien: string; acces: { id: number; personneId: number } }>(
      `/api/biens/${bienId}/acces`, {
        libelle: 'Famille Berger, locataires', email: '', expireLe: jourDecale(7),
      });
    assert.equal(a.statut, 200, JSON.stringify(a.corps));
    assert.match(a.corps.lien, /^https:\/\/maison\.exemple\.fr\/sejour\?jeton=/);

    const jeton = decodeURIComponent(a.corps.lien.split('jeton=')[1]);
    i.deconnecte();
    const ouverture = await i.post<{ acces: string; bienId: number; libelle: string }>(
      '/api/auth/lien', { jeton });
    assert.equal(ouverture.statut, 200, JSON.stringify(ouverture.corps));
    assert.equal(ouverture.corps.bienId, bienId);
    assert.equal(ouverture.corps.libelle, 'Famille Berger, locataires');
    i.utiliserJeton(ouverture.corps.acces);

    // Le rôle d'invité, avec un séjour en cours : le code de portée séjour est
    // visible. C'est exactement le cas d'usage du locataire.
    i.db.prepare(
      `INSERT INTO sejour (bien_id, demandeur_id, titre, arrivee, depart, occupants, nature,
                           statut, origine, cree_le)
       VALUES (?, ?, 'Berger', ?, ?, 4, 'location', 'valide', 'gerante', datetime('now'))`,
    ).run(bienId, a.corps.acces.personneId, jourDecale(-1), jourDecale(5));

    const vu = await i.post<{ valeur: string }>(
      `/api/biens/${bienId}/coffre/codes/${code.corps.id}/affichage`, {});
    assert.equal(vu.statut, 200, JSON.stringify(vu.corps));
    assert.equal(vu.corps.valeur, '2059');

    // Et il ne voit rien d'autre : ni les personnes, ni l'argent, ni l'entretien.
    for (const chemin of ['/api/personnes', `/api/biens/${bienId}/entretien`, `/api/biens/${bienId}/contacts`]) {
      assert.equal((await i.get(chemin)).statut, 403, `${chemin} doit rester fermé à un invité`);
    }
  } finally { await i.fermer(); }
});

test('le lien rattaché au séjour de la gérante donne bien le code de la boîte à clés', async () => {
  const i = await demarrer({ cleCoffre: CLE, publicUrl: 'https://maison.exemple.fr' });
  try {
    const { bienId } = await indivision(i);
    const code = await i.post<{ id: number }>(`/api/biens/${bienId}/coffre/codes`, {
      libelle: 'Boîte à clés', valeur: '4271', portee: 'sejour', note: '',
    });

    // Le chemin réel, et non celui du test précédent : c'est **la gérante** qui
    // pose le séjour, puis qui y rattache le lien. Le locataire n'est demandeur
    // de rien, et n'a pas de foyer. Sans le rattachement par l'accès temporaire,
    // il ouvrait un coffre vide, ce qui vide le lien de son seul intérêt.
    const s = await i.post<{ id: number }>(`/api/biens/${bienId}/sejours`, {
      titre: 'Location Berger', arrivee: jourDecale(-1), depart: jourDecale(5), occupants: 4,
    });
    assert.equal(s.statut, 200, JSON.stringify(s.corps));
    const a = await i.post<{ lien: string }>(`/api/biens/${bienId}/acces`, {
      libelle: 'Famille Berger', expireLe: jourDecale(6), sejourId: s.corps.id,
    });
    assert.equal(a.statut, 200, JSON.stringify(a.corps));

    i.deconnecte();
    const o = await i.post<{ acces: string }>('/api/auth/lien',
      { jeton: decodeURIComponent(a.corps.lien.split('jeton=')[1]) });
    i.utiliserJeton(o.corps.acces);

    const vue = await i.get<{ codes: { id: number }[] }>(`/api/biens/${bienId}/coffre`);
    assert.equal(vue.statut, 200, JSON.stringify(vue.corps));
    assert.equal(vue.corps.codes.length, 1, 'le locataire doit voir son code exister');

    const vu = await i.post<{ valeur: string }>(
      `/api/biens/${bienId}/coffre/codes/${code.corps.id}/affichage`, {});
    assert.equal(vu.statut, 200, JSON.stringify(vu.corps));
    assert.equal(vu.corps.valeur, '4271');
  } finally { await i.fermer(); }
});

test('un lien expiré ne donne plus le code, y compris en tapant l\'adresse', async () => {
  const i = await demarrer({ cleCoffre: CLE, publicUrl: 'https://maison.exemple.fr' });
  try {
    const { bienId } = await indivision(i);
    const code = await i.post<{ id: number }>(`/api/biens/${bienId}/coffre/codes`, {
      libelle: 'Portail', valeur: '1840B', portee: 'sejour', note: '',
    });
    const a = await i.post<{ lien: string; acces: { id: number; personneId: number } }>(
      `/api/biens/${bienId}/acces`, { libelle: 'Locataire', email: '', expireLe: jourDecale(2) });
    const jeton = decodeURIComponent(a.corps.lien.split('jeton=')[1]);

    i.db.prepare(
      `INSERT INTO sejour (bien_id, demandeur_id, titre, arrivee, depart, occupants, nature,
                           statut, origine, cree_le)
       VALUES (?, ?, 'Locataire', ?, ?, 2, 'location', 'valide', 'gerante', datetime('now'))`,
    ).run(bienId, a.corps.acces.personneId, jourDecale(-1), jourDecale(2));

    i.deconnecte();
    const ouverture = await i.post<{ acces: string }>('/api/auth/lien', { jeton });
    i.utiliserJeton(ouverture.corps.acces);
    assert.equal((await i.post(`/api/biens/${bienId}/coffre/codes/${code.corps.id}/affichage`, {})).statut, 200,
      'pendant le séjour, le code se montre');

    // Le temps passe : le lien et le rôle expirent tous les deux hier.
    i.db.prepare("UPDATE acces_temporaire SET expire_le = ? WHERE id = ?").run(jourDecale(-1), a.corps.acces.id);
    i.db.prepare("UPDATE role_attribue SET fin = ? WHERE personne_id = ?")
      .run(jourDecale(-1), a.corps.acces.personneId);

    // Premier verrou : la session déjà ouverte ne voit plus rien. C'est celui
    // qui compte, parce que l'onglet du locataire est resté ouvert.
    const apres = await i.post(`/api/biens/${bienId}/coffre/codes/${code.corps.id}/affichage`, {});
    assert.equal(apres.statut, 403,
      'un lien expiré ne donne plus accès au code, y compris en tapant l\'adresse directement');
    assert.equal((await i.get(`/api/biens/${bienId}/coffre`)).statut, 403);

    // Second verrou : le jeton n'ouvre plus de session neuve.
    i.deconnecte();
    const rejoue = await i.post<{ message: string }>('/api/auth/lien', { jeton });
    assert.equal(rejoue.statut, 400);
    assert.match(rejoue.corps.message, /n'est plus valable/);
  } finally { await i.fermer(); }
});

test('révoquer coupe l\'accès tout de suite, pas à la prochaine expiration', async () => {
  const i = await demarrer({ cleCoffre: CLE, publicUrl: 'https://maison.exemple.fr' });
  try {
    const { bienId } = await indivision(i);
    const a = await i.post<{ lien: string; acces: { id: number } }>(`/api/biens/${bienId}/acces`, {
      libelle: 'Voisin qui arrose', email: '', expireLe: jourDecale(30),
    });
    const jeton = decodeURIComponent(a.corps.lien.split('jeton=')[1]);
    i.deconnecte();
    const ouverture = await i.post<{ acces: string; renouvellement: string }>('/api/auth/lien', { jeton });
    i.utiliserJeton(ouverture.corps.acces);
    assert.equal((await i.get(`/api/biens/${bienId}/coffre`)).statut, 200);

    i.deconnecte();
    await i.connexion('helene@exemple.fr', MOT_DE_PASSE);
    await i.post(`/api/biens/${bienId}/acces/${a.corps.acces.id}/revocation`, {});

    // Le jeton d'accès déjà émis ne vaut plus rien : token_version a bougé.
    i.utiliserJeton(ouverture.corps.acces);
    assert.equal((await i.get(`/api/biens/${bienId}/coffre`)).statut, 401,
      'révoquer doit couper la session en cours, pas seulement empêcher la suivante');

    // Et le jeton de renouvellement non plus : sans cela, le navigateur
    // rechargeait tout seul une session valide, et le porteur restait connecté.
    const renouv = await i.post<{ message: string }>('/api/auth/renouveler',
      { renouvellement: ouverture.corps.renouvellement });
    assert.equal(renouv.statut, 401,
      'un accès révoqué ne doit pas pouvoir se recharger par renouvellement');

    i.deconnecte();
    assert.equal((await i.post('/api/auth/lien', { jeton })).statut, 400);
  } finally { await i.fermer(); }
});

test('un compte ouvert par lien ne devient pas un compte permanent', async () => {
  const i = await demarrer({ cleCoffre: CLE, publicUrl: 'https://maison.exemple.fr' });
  try {
    const { bienId } = await indivision(i);
    await i.post(`/api/biens/${bienId}/acces`, {
      libelle: 'Famille Berger', email: 'berger@exemple.fr', expireLe: jourDecale(7),
    });
    i.deconnecte();

    const avant = (i.db.prepare("SELECT COUNT(*) n FROM notification WHERE type = 'mot_de_passe'")
      .get() as { n: number }).n;
    const r = await i.post('/api/auth/mot-de-passe-oublie', { email: 'berger@exemple.fr' });
    assert.equal(r.statut, 204, 'la réponse reste identique : aucune énumération');
    const apres = (i.db.prepare("SELECT COUNT(*) n FROM notification WHERE type = 'mot_de_passe'")
      .get() as { n: number }).n;
    assert.equal(apres, avant,
      'un locataire ne doit pas pouvoir se transformer en compte permanent');
  } finally { await i.fermer(); }
});

test('un accès temporaire ne dépasse pas un an, et le message dit quoi faire', async () => {
  const i = await demarrer({ cleCoffre: CLE, publicUrl: 'https://maison.exemple.fr' });
  try {
    const { bienId } = await indivision(i);
    const trop = await i.post<{ message: string }>(`/api/biens/${bienId}/acces`, {
      libelle: 'Éternel', email: '', expireLe: jourDecale(400),
    });
    assert.equal(trop.statut, 400);
    assert.match(trop.corps.message, /Personnes et rôles/, 'le message doit dire par où passer');

    const passe = await i.post(`/api/biens/${bienId}/acces`, {
      libelle: 'Passé', email: '', expireLe: jourDecale(-1),
    });
    assert.equal(passe.statut, 400);
  } finally { await i.fermer(); }
});

test('la liste des accès dit leur état, et seul un gérant la voit', async () => {
  const i = await demarrer({ cleCoffre: CLE, publicUrl: 'https://maison.exemple.fr' });
  try {
    const { bienId, structureId, ids } = await indivision(i);
    const a = await i.post<{ acces: { id: number } }>(`/api/biens/${bienId}/acces`, {
      libelle: 'Locataire de juillet', email: '', expireLe: jourDecale(10),
    });
    await i.post(`/api/biens/${bienId}/acces/${a.corps.acces.id}/revocation`, {});
    const l = await i.get<{ libelle: string; etat: string }[]>(`/api/biens/${bienId}/acces`);
    assert.equal(l.corps[0].etat, 'revoque');

    // Claire est détentrice, pas gérante : la liste des accès lui est fermée.
    void ids;
    void structureId;
    i.deconnecte();
    await i.connexion('claire@exemple.fr', MOT_DE_PASSE);
    assert.equal((await i.get(`/api/biens/${bienId}/acces`)).statut, 403);
  } finally { await i.fermer(); }
});
