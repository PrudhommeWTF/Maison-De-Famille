// Administrer la plateforme n'est pas gérer un bien.
//
// Ce fichier protège la cloison dans les **deux** sens, et c'est le point : un
// droit qui ne fait que s'ajouter à l'autre n'aurait rien séparé du tout.
//
//   1. Un membre de foyer administrateur tient la machine, et ne voit toujours
//      **rien** des biens auxquels il n'est pas rattaché. La règle la plus
//      importante de l'application ne bouge pas d'un pouce.
//   2. Une gérante qui n'est pas administratrice n'ouvre **pas** l'écran
//      d'administration. Sans ce test, on aurait pu croire la séparation faite
//      alors que l'ancien droit continuait de tout ouvrir.
//   3. L'export complet, qui emporte les données de la famille, reste au
//      gérant : administrer la machine ne donne pas la main sur le contenu.
//   4. On ne retire pas le dernier administrateur, sinon l'instance ne se
//      rouvre qu'avec un accès au serveur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOT_DE_PASSE, amorcer, creerCompte, demarrer } from './aide';
import { calculer, estAdminPlateforme } from '../src/acces/roles';

// ---------------------------------------------------------------------------
// Le module pur.
// ---------------------------------------------------------------------------

const entrees = (adminPlateforme: boolean) => ({
  biens: [{ bienId: 1, structureId: 1 }],
  roles: [],
  detentions: [],
  personnes: [{ personneId: 7, foyerId: null, adminPlateforme }],
});

test("le droit d'administration n'ouvre aucun bien", () => {
  const p = calculer(7, entrees(true));
  assert.equal(estAdminPlateforme(p), true);
  assert.equal(p.biens.size, 0, 'un administrateur sans rattachement ne voit aucun bien');
  assert.equal(p.structures.size, 0);
});

test('et son absence ne retire rien', () => {
  assert.equal(estAdminPlateforme(calculer(7, entrees(false))), false);
});

// ---------------------------------------------------------------------------
// Les routes.
// ---------------------------------------------------------------------------

/** Hélène amorce (donc administre), Claire est membre de foyer et rien d'autre. */
async function instance() {
  const i = await demarrer();
  const { structureId, bienId } = await amorcer(i);
  const claire = await creerCompte(i, 'Claire Prudhomme', 'claire@exemple.fr');
  assert.equal((await i.post(`/api/structures/${structureId}/roles`,
    { personneId: claire, role: 'membre_foyer' })).statut, 204);
  return { i, structureId, bienId, claire };
}

const enClaire = async (i: Awaited<ReturnType<typeof demarrer>>) =>
  i.connexion('claire@exemple.fr', MOT_DE_PASSE);
const enHelene = async (i: Awaited<ReturnType<typeof demarrer>>) =>
  i.connexion('helene@exemple.fr', MOT_DE_PASSE);

test("l'amorçage donne le droit d'administration au premier compte", async (t) => {
  const i = await demarrer();
  t.after(() => i.fermer());
  await amorcer(i);
  const moi = await i.get<{ estGerant: boolean; estAdminPlateforme: boolean }>('/api/moi');
  assert.equal(moi.corps.estGerant, true);
  assert.equal(moi.corps.estAdminPlateforme, true);
  assert.equal((await i.get('/api/etat')).statut, 200);
});

test('un membre de foyer sans le droit ne touche pas à la machine', async (t) => {
  const { i } = await instance();
  t.after(() => i.fermer());
  await enClaire(i);

  const moi = await i.get<{ estAdminPlateforme: boolean }>('/api/moi');
  assert.equal(moi.corps.estAdminPlateforme, false);
  assert.equal((await i.get('/api/etat')).statut, 403);
  assert.equal((await i.post('/api/parametres', { cle: 'instanceNom', valeur: 'Chez nous' })).statut, 403);
  assert.equal((await i.get('/api/systeme/administrateurs')).statut, 403);
});

test('nommée administratrice, elle tient la machine sans rien gagner sur les biens', async (t) => {
  const { i, claire, bienId } = await instance();
  t.after(() => i.fermer());

  assert.equal((await i.post('/api/systeme/administrateurs',
    { personneId: claire, actif: true })).statut, 200);

  await enClaire(i);
  const moi = await i.get<{ estGerant: boolean; estAdminPlateforme: boolean }>('/api/moi');
  assert.equal(moi.corps.estAdminPlateforme, true);
  assert.equal(moi.corps.estGerant, false, 'administrer la plateforme ne fait pas gérant');

  // Ce qu'elle peut désormais : la machine.
  assert.equal((await i.get('/api/etat')).statut, 200);
  assert.equal((await i.post('/api/parametres', { cle: 'instanceNom', valeur: 'Chez nous' })).statut, 204);
  assert.equal((await i.get('/api/calendrier/vacances')).statut, 200);
  assert.equal((await i.get('/api/systeme/maj')).statut, 200);

  // Ce qu'elle ne peut toujours pas : les dossiers de la famille.
  assert.equal((await i.get('/api/export/instance.tar.gz')).statut, 403,
    "l'export emporte tout : il reste au gérant");
  assert.equal((await i.get('/api/personnes')).statut, 403);
  assert.equal((await i.post('/api/biens', { nom: 'x' })).statut, 403);
  assert.equal((await i.get('/api/import')).statut, 403);

  // Et son rôle sur le bien reste ce qu'il était : membre de foyer.
  const b = await i.get<{ role: string }>(`/api/biens/${bienId}`);
  assert.equal(b.statut, 200);
  assert.equal(b.corps.role, 'membre_foyer');
});

test('une gérante qui n\'administre pas se fait refuser la machine', async (t) => {
  const { i, structureId } = await instance();
  t.after(() => i.fermer());

  // Marc gère la structure, et rien de plus : le droit ne suit pas la gérance.
  const marc = await creerCompte(i, 'Marc Prudhomme', 'marc@exemple.fr');
  assert.equal((await i.post(`/api/structures/${structureId}/roles`,
    { personneId: marc, role: 'gerant' })).statut, 204);

  await i.connexion('marc@exemple.fr', MOT_DE_PASSE);
  const moi = await i.get<{ estGerant: boolean; estAdminPlateforme: boolean }>('/api/moi');
  assert.equal(moi.corps.estGerant, true);
  assert.equal(moi.corps.estAdminPlateforme, false);

  const r = await i.get<{ message: string }>('/api/etat');
  assert.equal(r.statut, 403);
  assert.match(r.corps.message, /administrateurs de la plateforme/);
  // Il garde évidemment ce qui relève de sa gérance.
  assert.equal((await i.get('/api/personnes')).statut, 200);
});

test('un accès temporaire par lien ne figure pas parmi les nommables', async (t) => {
  const { i, bienId } = await instance();
  t.after(() => i.fermer());

  // Un locataire de passage : pas de mot de passe, un compte qui ne vit que le
  // temps d'un séjour. Le proposer à la nomination serait un piège.
  const r = await i.post(`/api/biens/${bienId}/acces`, {
    libelle: 'Famille Berger', email: 'berger@exemple.fr',
    // Dans un mois : un accès temporaire ne dépasse pas un an.
    expireLe: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
  });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));

  const liste = await i.get<{ personnes: { nom: string }[] }>('/api/systeme/administrateurs');
  assert.equal(liste.corps.personnes.some((p) => p.nom === 'Famille Berger'), false);
});

test('le dernier administrateur ne se retire pas', async (t) => {
  const { i } = await instance();
  t.after(() => i.fermer());

  const liste = await i.get<{ personnes: { personneId: number; administrateur: boolean }[]; moi: number }>(
    '/api/systeme/administrateurs');
  assert.equal(liste.statut, 200);
  const admins = liste.corps.personnes.filter((p) => p.administrateur);
  assert.equal(admins.length, 1, 'Hélène est seule administratrice');

  const r = await i.post<{ message: string }>('/api/systeme/administrateurs',
    { personneId: liste.corps.moi, actif: false });
  assert.equal(r.statut, 422, JSON.stringify(r.corps));
  assert.match(r.corps.message, /dernier administrateur/);
  assert.equal((await i.get('/api/etat')).statut, 200, 'elle administre toujours');
});

test('à deux administrateurs, le retrait passe et laisse une trace', async (t) => {
  const { i, claire } = await instance();
  t.after(() => i.fermer());

  await i.post('/api/systeme/administrateurs', { personneId: claire, actif: true });
  const moi = (await i.get<{ moi: number }>('/api/systeme/administrateurs')).corps.moi;
  assert.equal((await i.post('/api/systeme/administrateurs', { personneId: moi, actif: false })).statut, 200);

  // Hélène s'est retirée elle-même : elle n'administre plus, Claire oui.
  assert.equal((await i.get('/api/etat')).statut, 403);
  await enClaire(i);
  assert.equal((await i.get('/api/etat')).statut, 200);

  const traces = i.db.prepare(
    "SELECT action FROM journal_audit WHERE action LIKE 'plateforme.administrateur.%' ORDER BY id",
  ).all() as { action: string }[];
  assert.deepEqual(traces.map((t2) => t2.action),
    ['plateforme.administrateur.ajout', 'plateforme.administrateur.retrait']);
});

test('un réglage d\'instance modifié laisse son auteur au journal', async (t) => {
  const { i } = await instance();
  t.after(() => i.fermer());
  await enHelene(i);

  assert.equal((await i.post('/api/parametres',
    { cle: 'membreFoyerVoitDepenses', valeur: true })).statut, 204);
  const trace = i.db.prepare(
    "SELECT acteur_id AS acteurId, detail_json AS detail FROM journal_audit WHERE action = 'parametre.change'",
  ).get() as { acteurId: number; detail: string } | undefined;
  assert.ok(trace, 'le changement doit être tracé');
  const detail = JSON.parse(trace.detail) as { cle: string; avant: string; apres: string };
  assert.equal(detail.cle, 'membreFoyerVoitDepenses');
  assert.notEqual(detail.avant, detail.apres);
});
