// Le seul appel réseau sortant de l'application.
//
// Il n'existe que parce qu'un gérant l'a explicitement autorisé, et tout ce
// fichier sert à ce que cette phrase reste vraie. Le transport est injecté :
// ces tests ne touchent jamais Internet, et vérifient donc aussi les cas qu'on
// ne sait pas provoquer en vrai (une redirection vers un autre domaine, un
// fichier de dix mégaoctets, un portail muet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOTE, SOURCE, TAILLE_MAX, TelechargementImpossible, Transport, telecharger,
} from '../src/calendrier/telechargement';
import { MOT_DE_PASSE, amorcer, creerCompte, demarrer } from './aide';

/** Un transport de laboratoire : il répond ce que le test demande. */
function faux(reponse: Partial<{
  ok: boolean; status: number; url: string; longueur: string | null; corps: Buffer; erreur: Error;
}>): { transport: Transport; appels: string[] } {
  const appels: string[] = [];
  const transport: Transport = async (url) => {
    appels.push(url);
    if (reponse.erreur) throw reponse.erreur;
    const corps = reponse.corps ?? Buffer.from('vide');
    return {
      ok: reponse.ok ?? true,
      status: reponse.status ?? 200,
      url: reponse.url ?? SOURCE,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-length' ? (reponse.longueur ?? String(corps.length)) : null) },
      arrayBuffer: async () => corps.buffer.slice(corps.byteOffset, corps.byteOffset + corps.byteLength) as ArrayBuffer,
    };
  };
  return { transport, appels };
}

const erreurDe = async (action: () => Promise<unknown>): Promise<Error> => {
  try { await action(); } catch (e) { return e as Error; }
  throw new Error('Aucune erreur levée alors qu\'une était attendue.');
};

test("l'adresse est en dur et ne vise que le portail officiel", async () => {
  const { transport, appels } = faux({ corps: Buffer.from('description;start_date') });
  await telecharger(transport);
  assert.equal(appels.length, 1);
  assert.equal(new URL(appels[0]).protocol, 'https:', 'jamais en clair');
  assert.equal(new URL(appels[0]).hostname, HOTE);
});

test('une redirection vers un autre domaine est refusée', async () => {
  // Sans ce contrôle, l'adresse en dur ne garantirait plus rien : il suffirait
  // d'une redirection pour que l'application aille lire ailleurs.
  const { transport } = faux({ url: 'https://exemple-malveillant.test/calendrier.csv' });
  const e = await erreurDe(() => telecharger(transport));
  assert.ok(e instanceof TelechargementImpossible);
  assert.match(e.message, /ne vient pas de data\.education\.gouv\.fr/);
  assert.match(e.message, /Rien n'a été lu/);
});

test('une réponse en erreur dit quoi faire, pas seulement qu\'elle a échoué', async () => {
  const e = await erreurDe(() => telecharger(faux({ ok: false, status: 404 }).transport));
  assert.match(e.message, /404/);
  assert.match(e.message, /déposez le fichier vous-même/);
});

test('un refus d\'authentification désigne le pare-feu, pas le portail', async () => {
  // Vu à la recette : le proxy de sortie répond 403 à la place du portail, qui
  // est public. Parler d'un jeu de données déplacé enverrait chercher au
  // mauvais endroit pendant une heure.
  for (const status of [401, 403, 407]) {
    const e = await erreurDe(() => telecharger(faux({ ok: false, status }).transport));
    assert.match(e.message, /pare-feu ou un proxy/, `statut ${status}`);
    assert.match(e.message, /Le portail est public/, `statut ${status}`);
  }
});

test('un portail muet est distingué d\'un portail injoignable', async () => {
  const expire = Object.assign(new Error('délai'), { name: 'TimeoutError' });
  const lent = await erreurDe(() => telecharger(faux({ erreur: expire }).transport));
  assert.match(lent.message, /n'a pas répondu en 20 secondes/);

  const injoignable = await erreurDe(() => telecharger(faux({ erreur: new Error('ENOTFOUND') }).transport));
  assert.match(injoignable.message, /Impossible de joindre/);
  // Le message doit nommer la cause la plus probable chez un auto-hébergeur.
  assert.match(injoignable.message, /droit de sortir sur Internet/);
});

test('une réponse trop grosse est refusée, annoncée ou non', async () => {
  const annoncee = await erreurDe(() => telecharger(faux({ longueur: String(TAILLE_MAX + 1) }).transport));
  assert.match(annoncee.message, /dépasse 8 Mo/);

  // L'en-tête peut mentir : c'est la taille reçue qui tranche.
  const menteuse = faux({ longueur: '12', corps: Buffer.alloc(TAILLE_MAX + 1, 0x41) });
  const recue = await erreurDe(() => telecharger(menteuse.transport));
  assert.match(recue.message, /dépasse 8 Mo/);
});

test('une réponse vide est refusée', async () => {
  const e = await erreurDe(() => telecharger(faux({ corps: Buffer.alloc(0) }).transport));
  assert.match(e.message, /fichier vide/);
});

// ---------------------------------------------------------------------------
// La route, et le garde-fou qui compte le plus : elle est éteinte par défaut.
// ---------------------------------------------------------------------------

test('le téléchargement est refusé tant que personne ne l\'a autorisé', async (t) => {
  const i = await demarrer();
  t.after(() => i.fermer());
  await amorcer(i);

  const r = await i.post<{ message: string }>('/api/calendrier/vacances/telechargement', {});
  assert.equal(r.statut, 422, JSON.stringify(r.corps));
  assert.match(r.corps.message, /n'est pas autorisé sur cette instance/);
  assert.match(r.corps.message, /Réglages/, 'le message doit dire où l\'activer');
  assert.match(r.corps.message, /déposez-le ici/, 'et rappeler qu\'il existe une autre voie');

  // Le réglage existe, il est éteint, et c'est la valeur livrée.
  const p = await i.get<{ parametres: { cle: string; valeur: unknown; parDefaut: boolean }[] }>('/api/parametres');
  const reglage = p.corps.parametres.find((x) => x.cle === 'vacancesTelechargement');
  assert.equal(reglage?.valeur, false);
  assert.equal(reglage?.parDefaut, true);
});

test('et il reste refusé à qui n\'est pas gérant, même une fois autorisé', async (t) => {
  const i = await demarrer();
  t.after(() => i.fermer());
  const { bienId, structureId } = await amorcer(i);
  await i.post('/api/parametres', { cle: 'vacancesTelechargement', valeur: true });

  const claire = await creerCompte(i, 'Claire Prudhomme', 'claire@exemple.fr');
  assert.equal((await i.post(`/api/structures/${structureId}/roles`,
    { personneId: claire, role: 'membre_foyer' })).statut, 204);
  await i.connexion('claire@exemple.fr', MOT_DE_PASSE);
  assert.equal((await i.get(`/api/biens/${bienId}`)).statut, 200, 'Claire est bien rattachée');

  assert.equal((await i.post('/api/calendrier/vacances/telechargement', {})).statut, 403);
});

test('autorisé, il ne fait toujours rien tout seul', async (t) => {
  const i = await demarrer();
  t.after(() => i.fermer());
  await amorcer(i);
  await i.post('/api/parametres', { cle: 'vacancesTelechargement', valeur: true });

  // Le réglage allumé ne déclenche rien : aucune écriture n'a lieu sans qu'un
  // gérant demande le téléchargement, puis confirme l'aperçu.
  const avant = i.db.prepare('SELECT COUNT(*) AS n FROM vacance_scolaire').get() as { n: number };
  assert.equal(avant.n, 15, 'la table livrée avec l\'application, et rien de plus');
});
