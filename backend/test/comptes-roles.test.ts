// La cloison entre tenir la machine et tenir les gens.
//
// La réorganisation a déplacé les comptes dans l'Administration et les rôles
// sous le bien. Deux capacités neuves accompagnent ce déplacement, et elles
// sont exactement du type qui se relâche tout seul en six mois :
//
//   1. **Un administrateur de plateforme répare un accès, et rien de plus.** Il
//      relance une invitation, qui part par courriel ; le lien ne lui est
//      **jamais** rendu. Le lui rendre serait lui laisser choisir le mot de
//      passe d'une gérante, donc lui ouvrir tous les biens : c'est le contraire
//      de ce que ce droit est censé être.
//   2. **Retirer un second facteur coupe les sessions.** Sans cela, un
//      téléphone volé encore connecté garderait sa session après le déblocage,
//      et le déblocage serait une régression de sécurité au lieu d'une
//      réparation.
//
// Le troisième test porte sur le confort et non sur la sûreté : donner un rôle
// à tout un foyer d'un coup. Il compte quand même, parce qu'il rend un relevé
// (« 2 ajoutés, 1 l'avait déjà ») et qu'un relevé faux se croit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOT_DE_PASSE, amorcer, creerCompte, demarrer } from './aide';

interface Compte {
  id: number; nom: string; email: string | null;
  aUnCompte: boolean; derniereConnexion: string | null; secondFacteur: boolean;
}

/** Hélène amorce (donc administre). Claire n'est qu'un membre de foyer. */
async function instance() {
  const i = await demarrer();
  const { structureId, bienId } = await amorcer(i);
  const claire = await creerCompte(i, 'Claire Prudhomme', 'claire@exemple.fr');
  return { i, structureId, bienId, claire };
}

// ---------------------------------------------------------------------------
// La liste des comptes.
// ---------------------------------------------------------------------------

test('la liste des comptes est réservée à qui administre la plateforme', async (t) => {
  const { i, claire } = await instance();
  t.after(() => i.fermer());
  // Claire est gérante de rien et n'administre rien : c'est le cas qui compte,
  // parce que c'est celui d'un compte volé au hasard dans la famille.
  assert.equal(claire > 0, true);
  await i.connexion('claire@exemple.fr', MOT_DE_PASSE);
  assert.equal((await i.get('/api/systeme/comptes')).statut, 403);
});

test('elle ne dit ni les foyers ni les rôles, et ignore les accès par lien', async (t) => {
  const { i, bienId } = await instance();
  t.after(() => i.fermer());
  const dans30j = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const lien = await i.post(`/api/biens/${bienId}/acces`, {
    libelle: 'Famille Berger', email: '', expireLe: dans30j,
  });
  assert.equal(lien.statut, 200);

  // Ni dans la liste des comptes, ni dans celle des personnes : un locataire de
  // passage n'est ni quelqu'un à qui on redonne un accès, ni un payeur possible,
  // ni un détenteur possible.
  const p = await i.get<{ nom: string }[]>('/api/personnes');
  assert.equal(p.corps.some((x) => x.nom.includes('Berger')), false);

  const r = await i.get<{ comptes: Compte[]; relaisConfigure: boolean }>('/api/systeme/comptes');
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps.comptes.map((c) => c.nom).sort(), ['Claire Prudhomme', 'Hélène Prudhomme']);
  // Un locataire de passage n'a pas de compte à réparer : le proposer à la
  // nomination était le piège de l'écran précédent.
  assert.equal(r.corps.comptes.some((c) => c.nom.includes('Berger')), false);
  const helene = r.corps.comptes.find((c) => c.nom.startsWith('Hélène'))!;
  assert.equal('foyerNom' in helene, false, 'la liste des comptes ne dit rien des foyers');
  assert.equal('roles' in helene, false);
});

// ---------------------------------------------------------------------------
// Renvoyer une invitation sans jamais montrer le lien.
// ---------------------------------------------------------------------------

test("l'administrateur relance une invitation, et le lien ne lui est jamais rendu", async (t) => {
  const { i, claire } = await instance();
  t.after(() => i.fermer());
  const r = await i.post<Record<string, unknown>>(`/api/systeme/comptes/${claire}/invitation`, {});
  assert.equal(r.statut, 200);
  assert.equal('lien' in r.corps, false, 'la réponse ne doit porter aucun lien');
  assert.equal(JSON.stringify(r.corps).includes('/reinitialiser'), false);
  // Le jeton existe bien en base : c'est l'invitation qui est partie, pas une
  // réponse polie qui ne fait rien.
  const n = i.db.prepare(
    "SELECT COUNT(*) AS n FROM reinit_mot_de_passe WHERE personne_id = ? AND motif = 'invitation' AND utilise_le IS NULL",
  ).get(claire) as { n: number };
  assert.equal(n.n, 1);
  // Et il n'est pas marqué « vu » : personne ne l'a regardé en clair.
  const vu = i.db.prepare(
    "SELECT vu_le FROM reinit_mot_de_passe WHERE personne_id = ? AND motif = 'invitation' AND utilise_le IS NULL",
  ).get(claire) as { vu_le: string | null };
  assert.equal(vu.vu_le, null);
});

test('une personne sans adresse ne reçoit rien, et on le dit', async (t) => {
  const { i } = await instance();
  t.after(() => i.fermer());
  const sans = await i.post<{ id: number }>('/api/personnes', { nom: 'Oncle Marcel', email: '' });
  const r = await i.post<{ message: string }>(`/api/systeme/comptes/${sans.corps.id}/invitation`, {});
  assert.equal(r.statut, 400);
  assert.match(r.corps.message, /adresse de courriel/);
});

// ---------------------------------------------------------------------------
// Débloquer un second facteur.
// ---------------------------------------------------------------------------

/** Pose un second facteur actif sur un compte, sans passer par le parcours d'activation. */
function poserSecondFacteur(i: Awaited<ReturnType<typeof demarrer>>, id: number): void {
  i.db.prepare("UPDATE personne SET totp_secret = 'JBSWY3DPEHPK3PXP', totp_active_le = '2026-01-01T00:00:00.000Z' WHERE id = ?")
    .run(id);
}

test('le retrait du second facteur se confirme par le mot de passe', async (t) => {
  const { i, claire } = await instance();
  t.after(() => i.fermer());
  poserSecondFacteur(i, claire);
  const r = await i.post(`/api/systeme/comptes/${claire}/second-facteur/retrait`, { motDePasse: 'pas-le-bon' });
  assert.equal(r.statut, 403);
  const reste = i.db.prepare('SELECT totp_secret AS t FROM personne WHERE id = ?').get(claire) as { t: string | null };
  assert.equal(reste.t, 'JBSWY3DPEHPK3PXP', 'un refus ne doit rien retirer du tout');
});

test('il coupe les sessions ouvertes et laisse une trace', async (t) => {
  const { i, claire } = await instance();
  t.after(() => i.fermer());
  poserSecondFacteur(i, claire);
  const avant = i.db.prepare('SELECT token_version AS v FROM personne WHERE id = ?').get(claire) as { v: number };

  const r = await i.post<{ nom: string; comptes: Compte[] }>(
    `/api/systeme/comptes/${claire}/second-facteur/retrait`, { motDePasse: MOT_DE_PASSE });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.nom, 'Claire Prudhomme');
  assert.equal(r.corps.comptes.find((c) => c.id === claire)?.secondFacteur, false);

  const apres = i.db.prepare(
    'SELECT totp_secret AS t, totp_recovery AS r, token_version AS v FROM personne WHERE id = ?',
  ).get(claire) as { t: string | null; r: string; v: number };
  assert.equal(apres.t, null);
  assert.equal(apres.r, '[]', 'les codes de secours de l\'ancien facteur ne valent plus rien');
  // Le point du test : un téléphone volé encore connecté perd sa session.
  assert.equal(apres.v, avant.v + 1);

  const trace = i.db.prepare(
    "SELECT COUNT(*) AS n FROM journal_audit WHERE action = 'plateforme.second_facteur.retrait' AND objet_id = ?",
  ).get(claire) as { n: number };
  assert.equal(trace.n, 1);
});

test('retirer un second facteur qui n\'existe pas est refusé, pas ignoré', async (t) => {
  const { i, claire } = await instance();
  t.after(() => i.fermer());
  const r = await i.post<{ message: string }>(
    `/api/systeme/comptes/${claire}/second-facteur/retrait`, { motDePasse: MOT_DE_PASSE });
  assert.equal(r.statut, 422);
  assert.match(r.corps.message, /pas de second facteur/);
});

// ---------------------------------------------------------------------------
// Donner un rôle à tout un foyer.
// ---------------------------------------------------------------------------

async function foyerDeDeux(): Promise<{
  i: Awaited<ReturnType<typeof demarrer>>; structureId: number; foyerId: number;
}> {
  const { i, structureId } = await instance();
  const f = await i.post<{ id: number }>('/api/foyers', { nom: 'Famille de Paul' });
  await creerCompte(i, 'Paul Prudhomme', 'paul@exemple.fr', f.corps.id);
  await creerCompte(i, 'Léa Prudhomme', 'lea@exemple.fr', f.corps.id);
  return { i, structureId, foyerId: f.corps.id };
}

test('un foyer entier reçoit le rôle en un geste', async (t) => {
  const { i, structureId, foyerId } = await foyerDeDeux();
  t.after(() => i.fermer());
  const r = await i.post<{ ajoutes: number; deja: string[]; total: number }>(
    `/api/structures/${structureId}/roles/foyer`, { foyerId, role: 'membre_foyer' });
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps, { ajoutes: 2, deja: [], total: 2 });
  const n = i.db.prepare(
    "SELECT COUNT(*) AS n FROM role_attribue WHERE structure_id = ? AND role = 'membre_foyer' AND archive_le IS NULL",
  ).get(structureId) as { n: number };
  assert.equal(n.n, 2);
});

test('le relevé distingue ce qui a été fait de ce qui existait déjà', async (t) => {
  const { i, structureId, foyerId } = await foyerDeDeux();
  t.after(() => i.fermer());
  await i.post(`/api/structures/${structureId}/roles/foyer`, { foyerId, role: 'membre_foyer' });
  const r = await i.post<{ ajoutes: number; deja: string[] }>(
    `/api/structures/${structureId}/roles/foyer`, { foyerId, role: 'membre_foyer' });
  assert.equal(r.corps.ajoutes, 0);
  assert.deepEqual(r.corps.deja.sort(), ['Léa Prudhomme', 'Paul Prudhomme']);
});

test('un foyer vide ne se traite pas en silence', async (t) => {
  const { i, structureId } = await instance();
  t.after(() => i.fermer());
  const f = await i.post<{ id: number }>('/api/foyers', { nom: 'Foyer sans personne' });
  const r = await i.post<{ message: string }>(
    `/api/structures/${structureId}/roles/foyer`, { foyerId: f.corps.id, role: 'membre_foyer' });
  assert.equal(r.statut, 400);
  assert.match(r.corps.message, /personne/);
});

test('seul un gérant de la structure donne un rôle à un foyer', async (t) => {
  const { i, structureId, foyerId } = await foyerDeDeux();
  t.after(() => i.fermer());
  await i.post(`/api/structures/${structureId}/roles/foyer`, { foyerId, role: 'membre_foyer' });
  await i.connexion('paul@exemple.fr', MOT_DE_PASSE);
  const r = await i.post(`/api/structures/${structureId}/roles/foyer`, { foyerId, role: 'gerant' });
  assert.equal(r.statut, 403);
});
