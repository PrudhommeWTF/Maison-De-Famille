// La mise à jour depuis l'interface.
//
// Trois choses à protéger, dans cet ordre :
//
//   1. **Le mot de passe.** Ce bouton fait exécuter du code en root sur la
//      machine. Un jeton dérobé sur un téléphone déverrouillé ne doit pas
//      suffire.
//   2. **L'état qui se débloque tout seul.** Foyer-App a connu la panne : une
//      mise à jour interrompue laissait « en cours » pour toujours, sans bouton
//      et sans issue depuis l'interface. Il fallait aller supprimer un fichier
//      sur le serveur.
//   3. **Le service qui n'exécute rien.** Il écrit deux fichiers, et c'est tout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  SANS_NOUVELLES_MS, comparer, depuisLisible, estPlusRecente, fraichir, lireStatut,
} from '../src/systeme/versions';
import {
  FICHIER_DECLENCHEUR, FICHIER_ETAT, declencher, enCours, statut,
} from '../src/systeme/maj';
import { Transport, VerificationImpossible, derniereRelease, depotParDefaut } from '../src/systeme/depot';
import { MOT_DE_PASSE, amorcer, creerCompte, demarrer } from './aide';

// ---------------------------------------------------------------------------
// Les versions, en module pur.
// ---------------------------------------------------------------------------

test('les versions se comparent par nombre, pas par texte', () => {
  assert.ok(comparer('0.0.10', '0.0.9') > 0, '10 vient après 9, en texte c\'est l\'inverse');
  assert.ok(comparer('1.0.0', '0.9.9') > 0);
  assert.equal(comparer('0.0.4', '0.0.4'), 0);
  // Le « v » des tags GitHub ne doit pas créer une mise à jour perpétuelle.
  assert.equal(comparer('v0.0.4', '0.0.4'), 0);
  assert.ok(estPlusRecente('v0.0.5', '0.0.4'));
  assert.equal(estPlusRecente('v0.0.4', '0.0.4'), false);
  assert.equal(estPlusRecente('0.0.3', '0.0.4'), false, 'un retour en arrière n\'est pas une mise à jour');
  // Une version incomplète ou farfelue ne doit pas faire exploser la comparaison.
  assert.equal(comparer('1.2', '1.2.0'), 0);
  assert.ok(comparer('abc', '0.0.1') < 0);
});

test('une mise à jour sans nouvelles cesse d\'être « en cours »', () => {
  const t0 = 1_000_000_000_000;
  const enRoute = { etat: 'en_cours' as const, message: 'Compilation…', ts: t0 };

  // Tant qu'elle progresse, on la laisse tranquille.
  assert.deepEqual(fraichir(enRoute, t0 + 60_000, '/data/maj.log'), enRoute);
  assert.deepEqual(fraichir(enRoute, t0 + SANS_NOUVELLES_MS, '/data/maj.log'), enRoute);

  // Passé le délai, elle devient un échec, et le bouton revient.
  const perdue = fraichir(enRoute, t0 + SANS_NOUVELLES_MS + 1, '/data/maj.log');
  assert.equal(perdue.etat, 'echec');
  assert.match(perdue.message ?? '', /aucune progression depuis/);
  assert.match(perdue.message ?? '', /\/data\/maj\.log/, 'le message doit dire où regarder');
  assert.match(perdue.message ?? '', /relancer/, 'et que la main est rendue');

  // Un horodatage absent vient d'un format antérieur : c'est fini depuis
  // longtemps, quoi qu'en dise le fichier.
  assert.equal(fraichir({ etat: 'en_cours' }, t0, '/data/maj.log').etat, 'echec');
  // Les autres états ne sont jamais réécrits.
  for (const etat of ['inactif', 'termine', 'echec'] as const) {
    assert.deepEqual(fraichir({ etat }, t0 + 10 ** 9, '/l'), { etat });
  }
});

test('les durées se disent en français lisible', () => {
  assert.equal(depuisLisible(60_000), '1 minute');
  assert.equal(depuisLisible(22 * 60_000), '22 minutes');
  assert.equal(depuisLisible(3 * 3600_000), '3 heures');
  assert.equal(depuisLisible(6 * 24 * 3600_000), '6 jours');
  assert.equal(depuisLisible(Infinity), 'un long moment');
});

test('un fichier d\'état abîmé ne casse pas l\'écran', () => {
  assert.deepEqual(lireStatut(null), { etat: 'inactif', message: undefined, ts: undefined });
  assert.deepEqual(lireStatut({ etat: 'nawak' }), { etat: 'inactif', message: undefined, ts: undefined });
  assert.equal(lireStatut({ etat: 'en_cours', ts: 'demain' }).ts, undefined);
  assert.equal(lireStatut({ etat: 'echec', message: 'x'.repeat(9000) }).message?.length, 500);
});

// ---------------------------------------------------------------------------
// Le dépôt : un seul hôte, et rien qui s'installe.
// ---------------------------------------------------------------------------

function faux(reponses: { status?: number; url?: string; corps: string }[]): Transport {
  let i = 0;
  return async (url) => {
    const r = reponses[Math.min(i++, reponses.length - 1)];
    return {
      ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
      status: r.status ?? 200,
      url: r.url ?? url,
      text: async () => r.corps,
    };
  };
}

const erreurDe = async (a: () => Promise<unknown>): Promise<Error> => {
  try { await a(); } catch (e) { return e as Error; }
  throw new Error('Aucune erreur levée alors qu\'une était attendue.');
};

test('une release publiée est lue avec ses notes', async () => {
  const t = faux([{ corps: JSON.stringify({
    tag_name: 'v0.0.5', name: 'Guides et portée invité', body: 'Des notes.',
    html_url: 'https://github.com/x/y/releases/tag/v0.0.5', published_at: '2026-09-06T20:00:00Z',
  }) }]);
  const r = await derniereRelease(t, {});
  assert.equal(r.tag, 'v0.0.5');
  assert.equal(r.nom, 'Guides et portée invité');
  assert.equal(r.notes, 'Des notes.');
});

test('sans release publiée, le plus grand tag fait l\'affaire', async () => {
  // Un projet personnel pose souvent des tags sans rédiger de release. Refuser
  // ce cas rendrait la fonction inutile là où elle sert le plus.
  const t = faux([
    { status: 404, corps: '{}' },
    { corps: JSON.stringify([{ name: 'v0.0.2' }, { name: 'v0.0.10' }, { name: 'brouillon' }, { name: 'v0.0.9' }]) },
  ]);
  const r = await derniereRelease(t, {});
  assert.equal(r.tag, 'v0.0.10', 'et pas v0.0.9, qui gagnerait en comparaison de texte');
});

test('un dépôt sans aucune version le dit clairement', async () => {
  const t = faux([{ status: 404, corps: '{}' }, { corps: '[]' }]);
  const e = await erreurDe(() => derniereRelease(t, {}));
  assert.match(e.message, /ne publie ni release ni tag/);
});

test('une redirection hors de GitHub est refusée', async () => {
  const t = faux([{ url: 'https://ailleurs.test/releases', corps: '{"tag_name":"v9.9.9"}' }]);
  const e = await erreurDe(() => derniereRelease(t, {}));
  assert.ok(e instanceof VerificationImpossible);
  assert.match(e.message, /ne vient pas de api\.github\.com/);
});

test('un dépôt mal écrit est refusé avant tout appel', async () => {
  let appele = false;
  const t: Transport = async () => { appele = true; throw new Error('ne devrait pas arriver'); };
  const e = await erreurDe(() => derniereRelease(t, { MDF_DEPOT_GITHUB: 'https://exemple.test/x' }));
  assert.match(e.message, /proprietaire\/depot/);
  assert.equal(appele, false, 'rien ne doit partir vers une adresse pareille');
  assert.equal(depotParDefaut({}), 'PrudhommeWTF/Maison-De-Famille');
});

test('une limite de débit est distinguée d\'une panne', async () => {
  const e = await erreurDe(() => derniereRelease(faux([{ status: 403, corps: '{}' }]), {}));
  assert.match(e.message, /limite de débit ou pare-feu/);
});

// ---------------------------------------------------------------------------
// Le déclenchement : deux fichiers, et rien d'autre.
// ---------------------------------------------------------------------------

test('déclencher écrit l\'état avant le déclencheur', () => {
  const dossier = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'mdf-maj-'));
  assert.equal(statut(dossier).etat, 'inactif', 'un répertoire vide n\'est pas une panne');
  assert.equal(enCours(dossier), false);

  declencher(dossier, 1_700_000_000_000);
  const ecrit = JSON.parse(fs.readFileSync(path.join(dossier, FICHIER_ETAT), 'utf8'));
  assert.equal(ecrit.etat, 'en_cours');
  assert.equal(ecrit.ts, 1_700_000_000_000);
  assert.ok(fs.existsSync(path.join(dossier, FICHIER_DECLENCHEUR)), 'l\'unité systemd attend ce fichier');
  assert.equal(enCours(dossier, 1_700_000_000_000 + 1000), true);

  // Et le déblocage automatique vaut aussi pour ce qui est écrit sur disque.
  assert.equal(statut(dossier, 1_700_000_000_000 + SANS_NOUVELLES_MS + 1).etat, 'echec');
  assert.equal(enCours(dossier, 1_700_000_000_000 + SANS_NOUVELLES_MS + 1), false, 'la main est rendue');
});

test('un fichier d\'état illisible vaut « rien en cours »', () => {
  const dossier = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'mdf-maj-'));
  fs.writeFileSync(path.join(dossier, FICHIER_ETAT), 'ceci n\'est pas du JSON');
  assert.equal(statut(dossier).etat, 'inactif');
});

// ---------------------------------------------------------------------------
// Les routes.
// ---------------------------------------------------------------------------

test('la vérification est refusée tant que personne ne l\'a autorisée', async (t) => {
  const i = await demarrer();
  t.after(() => i.fermer());
  await amorcer(i);

  const r = await i.post<{ message: string }>('/api/systeme/maj/verification', {});
  assert.equal(r.statut, 422, JSON.stringify(r.corps));
  assert.match(r.corps.message, /n'est pas autorisée sur cette instance/);
  assert.match(r.corps.message, /Exploitation/, 'le message doit dire où l\'activer');
});

test('sans assistant root, le bouton d\'installation n\'existe pas', async (t) => {
  const i = await demarrer();
  t.after(() => i.fermer());
  await amorcer(i);

  const etat = await i.get<{ maj: { installationPossible: boolean; verificationAutorisee: boolean } }>('/api/etat');
  assert.equal(etat.corps.maj.installationPossible, false);
  assert.equal(etat.corps.maj.verificationAutorisee, false);

  const r = await i.post<{ message: string }>('/api/systeme/maj', { motDePasse: MOT_DE_PASSE });
  assert.equal(r.statut, 422, JSON.stringify(r.corps));
  assert.match(r.corps.message, /n'est pas installée sur ce serveur/);
  assert.match(r.corps.message, /MAJ_AUTO=true/, 'et comment l\'installer');
});

test('le mot de passe est exigé, et un mauvais ne lance rien', async (t) => {
  const i = await demarrer({ majAuto: true });
  t.after(() => i.fermer());
  await amorcer(i);

  const sans = await i.post('/api/systeme/maj', {});
  assert.equal(sans.statut, 400, 'sans mot de passe du tout');

  const faux = await i.post<{ message: string }>('/api/systeme/maj', { motDePasse: 'pas-le-bon-du-tout' });
  assert.equal(faux.statut, 403, JSON.stringify(faux.corps));
  assert.match(faux.corps.message, /installe et exécute du code sur le serveur/);

  // Le point qui compte : rien n'a été déposé.
  assert.equal(fs.existsSync(path.join(i.deps.config.dataDir, FICHIER_DECLENCHEUR)), false);
  assert.equal(statut(i.deps.config.dataDir).etat, 'inactif');
});

test('le bon mot de passe dépose le déclencheur, et refuse un second clic', async (t) => {
  const i = await demarrer({ majAuto: true });
  t.after(() => i.fermer());
  await amorcer(i);

  const r = await i.post<{ lancee: boolean; statut: { etat: string } }>(
    '/api/systeme/maj', { motDePasse: MOT_DE_PASSE });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.lancee, true);
  assert.equal(r.corps.statut.etat, 'en_cours');
  assert.ok(fs.existsSync(path.join(i.deps.config.dataDir, FICHIER_DECLENCHEUR)));

  // Un second clic pendant la compilation relancerait l'unité au milieu du
  // travail : il est refusé, en français.
  const encore = await i.post<{ message: string }>('/api/systeme/maj', { motDePasse: MOT_DE_PASSE });
  assert.equal(encore.statut, 400);
  assert.match(encore.corps.message, /déjà en cours/);
});

test('un membre de la famille ne met pas à jour le serveur', async (t) => {
  const i = await demarrer({ majAuto: true });
  t.after(() => i.fermer());
  const { bienId, structureId } = await amorcer(i);

  const claire = await creerCompte(i, 'Claire Prudhomme', 'claire@exemple.fr');
  assert.equal((await i.post(`/api/structures/${structureId}/roles`,
    { personneId: claire, role: 'membre_foyer' })).statut, 204);
  await i.connexion('claire@exemple.fr', MOT_DE_PASSE);
  assert.equal((await i.get(`/api/biens/${bienId}`)).statut, 200, 'Claire est bien rattachée');

  // Même avec son propre mot de passe, qui est le bon.
  assert.equal((await i.post('/api/systeme/maj', { motDePasse: MOT_DE_PASSE })).statut, 403);
  assert.equal((await i.post('/api/systeme/maj/verification', {})).statut, 403);
  assert.equal((await i.get('/api/systeme/maj')).statut, 403);
  assert.equal(fs.existsSync(path.join(i.deps.config.dataDir, FICHIER_DECLENCHEUR)), false);
});
