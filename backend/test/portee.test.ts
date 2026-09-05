// La recette de la règle la plus importante de l'application.
//
// Deux niveaux de vérification, et il faut les deux :
//
//   1. **Structurel** : le registre des routes est parcouru, et une route qui
//      oublierait sa garde fait échouer la CI. C'est ce qui protège des routes
//      qui n'existent pas encore.
//   2. **Réel** : un détenteur d'un bien tape l'adresse d'un autre bien et se
//      fait refuser, sur chaque route qui porte un bien. C'est le point de
//      recette « un membre de foyer ne voit rien du bien auquel il n'est pas
//      rattaché, y compris en tapant l'adresse directement ».
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIQUES_AUTORISEES, ROUTES } from '../src/noyau/http';
import { Instance, MOT_DE_PASSE, amorcer, creerCompte, demarrer } from './aide';

// Le registre des routes ne se remplit qu'à la construction de l'application.
// Sans cette amorce, il serait vide et les tests structurels passeraient tous
// sans rien vérifier : c'est exactement le genre de test qui rassure à tort.
before(async () => { await (await demarrer()).fermer(); });

test('le registre des routes n\'est pas vide', () => {
  assert.ok(ROUTES.length >= 20, `seulement ${ROUTES.length} routes déclarées`);
});

test('aucune route publique en dehors de la liste explicitement autorisée', () => {
  const publiques = ROUTES.filter((r) => r.exigence.acces === 'public')
    .map((r) => `${r.methode} /api${r.chemin}`);
  for (const p of publiques) {
    assert.ok(PUBLIQUES_AUTORISEES.includes(p),
      `${p} est publique sans figurer dans PUBLIQUES_AUTORISEES. Si c'est voulu, ajoutez-la à la liste et expliquez pourquoi.`);
  }
});

test('toute route qui porte :bienId exige une portée de bien', () => {
  for (const r of ROUTES) {
    if (!r.chemin.includes(':bienId')) continue;
    assert.equal(r.exigence.acces, 'bien',
      `${r.methode} /api${r.chemin} porte un bien dans son adresse mais n'exige pas de portée de bien.`);
  }
});

test('toute route qui porte :structureId exige une portée de structure', () => {
  for (const r of ROUTES) {
    if (!r.chemin.includes(':structureId')) continue;
    assert.equal(r.exigence.acces, 'structure',
      `${r.methode} /api${r.chemin} porte une structure dans son adresse mais n'exige pas de portée de structure.`);
  }
});

test('un séjour ne se désigne jamais en dehors de son bien', () => {
  // Une route /api/sejours/:sejourId échapperait à la garde, qui s'applique sur
  // le bien de l'adresse. La structure des chemins est ce qui rend la règle
  // mécanique : on la vérifie ici pour qu'elle le reste.
  for (const r of ROUTES) {
    if (!r.chemin.includes(':sejourId')) continue;
    assert.ok(r.chemin.includes(':bienId'),
      `${r.methode} /api${r.chemin} désigne un séjour hors du chemin de son bien.`);
  }
});

test('les écritures ne sont jamais accessibles en simple lecture', () => {
  for (const r of ROUTES) {
    if (r.methode === 'GET' || r.exigence.acces !== 'bien') continue;
    assert.notEqual(r.exigence.role, 'invite',
      `${r.methode} /api${r.chemin} laisse écrire un invité.`);
  }
});

// ------------------------------------------------------------------
// La vérification réelle, sur une instance qui tourne.
// ------------------------------------------------------------------

/**
 * Deux dossiers étanches : Hélène gère Kerloc'h, Thomas gère Les Arcs, et
 * personne n'est dans les deux. C'est la situation qu'il faut absolument tenir.
 */
async function deuxDossiers(i: Instance) {
  const kerloch = await amorcer(i);
  const thomasId = await creerCompte(i, 'Thomas Prudhomme', 'thomas@exemple.fr');

  // Thomas crée sa propre structure et son bien : il en devient gérant, et
  // Hélène n'y a aucun accès.
  i.db.prepare("INSERT INTO role_attribue (personne_id, structure_id, role, debut, cree_le) VALUES (?, ?, 'gerant', '2020-01-01', datetime('now'))")
    .run(thomasId, kerloch.structureId);
  await i.connexion('thomas@exemple.fr', MOT_DE_PASSE);
  const arcs = await i.post<{ bienId: number; structureId: number }>('/api/biens', {
    structureMode: 'sci', structureNom: 'SCI Prudhomme Immobilier',
    nom: 'Les Arcs 1800', commune: 'Bourg-Saint-Maurice', type: 'montagne', couchages: 6,
  });
  assert.equal(arcs.statut, 200, JSON.stringify(arcs.corps));

  // Puis on retire à Thomas son rôle sur l'indivision : il ne reste gérant que
  // de la SCI, Hélène que de l'indivision.
  i.db.prepare('UPDATE role_attribue SET archive_le = datetime(\'now\') WHERE personne_id = ? AND structure_id = ?')
    .run(thomasId, kerloch.structureId);

  return { kerloch, arcs: arcs.corps, thomasId };
}

test('un gérant ne voit pas le bien de l\'autre structure, même en tapant l\'adresse', async () => {
  const i = await demarrer();
  try {
    const { kerloch, arcs } = await deuxDossiers(i);

    await i.connexion('helene@exemple.fr', MOT_DE_PASSE);
    const moi = await i.get<{ biens: { id: number }[] }>('/api/moi');
    assert.deepEqual(moi.corps.biens.map((b) => b.id), [kerloch.bienId],
      'la barre de contexte ne doit proposer que Kerloc\'h');

    // Chaque route portant un bien, essayée sur le bien de l'autre.
    for (const chemin of [
      `/api/biens/${arcs.bienId}`,
      `/api/biens/${arcs.bienId}/sejours`,
      `/api/biens/${arcs.bienId}/parametres`,
    ]) {
      const r = await i.get(chemin);
      assert.equal(r.statut, 403, `${chemin} aurait dû être refusée, statut ${r.statut}`);
    }
    for (const chemin of [
      `/api/biens/${arcs.bienId}/sejours`,
      `/api/biens/${arcs.bienId}/verification`,
      `/api/biens/${arcs.bienId}/archivage`,
    ]) {
      const r = await i.post(chemin, { arrivee: '2026-08-08', depart: '2026-08-16', occupants: 2 });
      assert.equal(r.statut, 403, `${chemin} aurait dû être refusée, statut ${r.statut}`);
    }
    const s = await i.get(`/api/structures/${arcs.structureId}`);
    assert.equal(s.statut, 403);
  } finally { await i.fermer(); }
});

test('le calendrier consolidé ne contient que les biens de la portée', async () => {
  const i = await demarrer();
  try {
    const { kerloch, arcs, thomasId } = await deuxDossiers(i);

    // Un séjour dans chaque dossier.
    i.db.prepare(`INSERT INTO sejour (bien_id, arrivee, depart, occupants, nature, statut, origine, cree_le, titre)
                  VALUES (?, '2026-08-01', '2026-08-08', 2, 'famille', 'valide', 'gerante', datetime('now'), 'Kerloc''h')`)
      .run(kerloch.bienId);
    i.db.prepare(`INSERT INTO sejour (bien_id, arrivee, depart, occupants, nature, statut, origine, cree_le, titre)
                  VALUES (?, '2026-08-01', '2026-08-08', 2, 'famille', 'valide', 'gerante', datetime('now'), 'Les Arcs')`)
      .run(arcs.bienId);

    await i.connexion('helene@exemple.fr', MOT_DE_PASSE);
    const cal = await i.get<{ sejours: { titre: string }[] }>('/api/sejours?du=2026-01-01&au=2026-12-31');
    assert.deepEqual(cal.corps.sejours.map((s) => s.titre), ["Kerloc'h"]);

    const csv = await i.get<string>('/api/export/sejours.csv');
    assert.ok(!csv.corps.includes('Les Arcs'), 'l\'export ne doit pas déborder sur l\'autre dossier');
    void thomasId;
  } finally { await i.fermer(); }
});

test('sans jeton, aucune route protégée ne répond', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    i.deconnecte();
    for (const chemin of ['/api/moi', '/api/sejours', '/api/demandes', '/api/personnes', '/api/etat', '/api/parametres']) {
      const r = await i.get(chemin);
      assert.equal(r.statut, 401, `${chemin} répond ${r.statut} sans authentification`);
    }
  } finally { await i.fermer(); }
});

test('un jeton falsifié ou signé avec un autre secret est refusé', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    const jwt = (await import('jsonwebtoken')).default;
    // Signé correctement, mais avec un autre secret : c'est la tentative la plus
    // évidente, et elle doit échouer sur la vérification de signature.
    i.poserJeton(jwt.sign({ sub: 1, tv: 0 }, 'un-autre-secret-tout-aussi-long-que-lautre', { algorithm: 'HS256' }));
    assert.equal((await i.get('/api/moi')).statut, 401);

    // Algorithme « none » : accepté par les bibliothèques mal configurées.
    const sansSignature = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
      + '.' + Buffer.from(JSON.stringify({ sub: 1, tv: 0 })).toString('base64url') + '.';
    i.poserJeton(sansSignature);
    assert.equal((await i.get('/api/moi')).statut, 401);
  } finally { await i.fermer(); }
});

test('l\'application se recharge correctement sur une route imbriquée', async () => {
  // Sans base absolue, un rechargement sur /bien/calendrier fait chercher les
  // fichiers de l'application dans /bien/, le serveur répond l'index à leur
  // place, et le navigateur affiche une page blanche. C'est ce qui arrive à la
  // première personne qui met le calendrier en favori.
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const statique = fs.mkdtempSync(path.join(os.tmpdir(), 'mdf-statique-'));
  fs.writeFileSync(path.join(statique, 'index.html'),
    '<!doctype html><html><head><base href="/"><link rel="stylesheet" href="styles.css"></head><body></body></html>');
  fs.writeFileSync(path.join(statique, 'styles.css'), 'body{}');

  const i = await demarrer({ staticDir: statique, baseHref: '/' });
  try {
    const imbrique = await fetch(`${i.url}/bien/calendrier`);
    assert.match(imbrique.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await imbrique.text(), /<base href="\/">/);

    const feuille = await fetch(`${i.url}/styles.css`);
    assert.match(feuille.headers.get('content-type') ?? '', /text\/css/,
      'la feuille de style doit rester une feuille de style, pas l\'index');
  } finally {
    await i.fermer();
    fs.rmSync(statique, { recursive: true, force: true });
  }
});

test('un montage sous un sous-chemin réécrit la base de l\'application', async () => {
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const statique = fs.mkdtempSync(path.join(os.tmpdir(), 'mdf-statique-'));
  fs.writeFileSync(path.join(statique, 'index.html'), '<!doctype html><html><head><base href="/"></head><body></body></html>');

  const i = await demarrer({ staticDir: statique, baseHref: '/maison/' });
  try {
    assert.match(await (await fetch(`${i.url}/`)).text(), /<base href="\/maison\/">/);
  } finally {
    await i.fermer();
    fs.rmSync(statique, { recursive: true, force: true });
  }
});

test('changer de mot de passe révoque les sessions ouvertes', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    assert.equal((await i.get('/api/moi')).statut, 200);
    const r = await i.post('/api/auth/mot-de-passe', { actuel: MOT_DE_PASSE, nouveau: 'un-autre-mot-de-passe-long' });
    assert.equal(r.statut, 204);
    // Le jeton d'accès est encore valide cryptographiquement, et pourtant périmé.
    assert.equal((await i.get('/api/moi')).statut, 401);
  } finally { await i.fermer(); }
});
