// Qui peut télécharger quel fichier.
//
// Cette route est le seul chemin vers les octets : le répertoire de données
// n'est pas exposé. Elle mérite donc sa propre recette, et notamment la
// vérification qu'un invité de passage ne récupère pas l'acte notarié en
// devinant un identifiant de fichier.
//
// Le point de départ de ces tests est un défaut réel, trouvé en préparant
// l'écran Souvenirs : un document du coffre était refusé à la gérante qui
// venait de le déposer, parce que la route ne connaissait aucun rattachement
// vers le coffre. La photo de couverture d'un bien, elle, ne s'affichait pas
// du tout, faute de jeton sur la requête de l'image.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { MOT_DE_PASSE, amorcer, creerCompte, demarrer } from './aide';
import type { Instance } from './aide';

/** Ouvre un accès temporaire et rend le jeton porté par le lien. */
async function jetonDeLien(
  i: Instance, bienId: number, libelle: string, sejourId: number, expireLe: string,
): Promise<string> {
  const a = await i.post<{ lien: string }>(`/api/biens/${bienId}/acces`,
    { libelle, expireLe, sejourId });
  assert.equal(a.statut, 200, JSON.stringify(a.corps));
  return decodeURIComponent(a.corps.lien.split('jeton=')[1]);
}

const CLE = 'e'.repeat(64);
const jourDecale = (j: number): string =>
  new Date(Date.now() + j * 86_400_000).toISOString().slice(0, 10);

const image = (n = 64): Buffer => Buffer.from(
  jpeg.encode({ data: Buffer.alloc(n * n * 4, 180), width: n, height: n }, 80).data);

const deposerCoffre = (i: Instance, bienId: number, nom: string, octets: Buffer) =>
  i.appel<{ id: string }>('POST', `/api/biens/${bienId}/coffre/fichier?nom=${encodeURIComponent(nom)}`, octets);

test('la photo de couverture d\'un bien est servie à qui voit le bien', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { bienId } = await amorcer(i);
    const p = await i.appel<{ fichierId: string }>('POST', `/api/biens/${bienId}/photo`, image(),
      { 'x-nom-fichier': 'facade.jpg' });
    assert.equal(p.statut, 200, JSON.stringify(p.corps));
    assert.equal((await i.get(`/api/fichiers/${p.corps.fichierId}`)).statut, 200);

    // Sans jeton, rien. C'est la raison pour laquelle l'écran ne peut pas se
    // contenter d'un <img src="/api/fichiers/...">, et va chercher les octets.
    const nu = await fetch(`${i.url}/api/fichiers/${p.corps.fichierId}`);
    assert.equal(nu.status, 401);
  } finally { await i.fermer(); }
});

test('un document du coffre est servi à la gérante qui l\'a déposé', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { bienId } = await amorcer(i);
    const f = await deposerCoffre(i, bienId, 'acte.jpg', image());
    assert.equal(f.statut, 200, JSON.stringify(f.corps));
    const doc = await i.post(`/api/biens/${bienId}/coffre/documents`,
      { nom: 'Acte de notoriété', portee: 'gerant', note: '', fichierId: f.corps.id });
    assert.equal(doc.statut, 200, JSON.stringify(doc.corps));
    assert.equal((await i.get(`/api/fichiers/${f.corps.id}`)).statut, 200,
      'un document du coffre doit pouvoir être téléchargé');
  } finally { await i.fermer(); }
});

test('un acte scanné de plus d\'un méga-octet se dépose au coffre', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { bienId } = await amorcer(i);
    // Un acte notarié scanné pèse couramment un à trois méga-octets. Le réglage
    // « Taille maximale d'un fichier » vaut 15 Mo : c'est lui qui doit décider,
    // et rien d'autre.
    const gros = Buffer.concat([image(), Buffer.alloc(2_500_000, 7)]);
    const f = await deposerCoffre(i, bienId, 'acte-scanne.jpg', gros);
    assert.equal(f.statut, 200, JSON.stringify(f.corps));
  } finally { await i.fermer(); }
});

test('un invité de passage ne télécharge pas l\'acte notarié', async () => {
  const i = await demarrer({ cleCoffre: CLE, publicUrl: 'http://test.local' });
  try {
    const { bienId } = await amorcer(i);
    const acte = await deposerCoffre(i, bienId, 'acte.jpg', image());
    await i.post(`/api/biens/${bienId}/coffre/documents`,
      { nom: 'Acte', portee: 'gerant', note: '', fichierId: acte.corps.id });
    const assurance = await deposerCoffre(i, bienId, 'assurance.jpg', image(48));
    await i.post(`/api/biens/${bienId}/coffre/documents`,
      { nom: 'Assurance', portee: 'sejour', note: '', fichierId: assurance.corps.id });

    // Un séjour en cours, et le lien d'accès qui va avec.
    const s = await i.post<{ id: number }>(`/api/biens/${bienId}/sejours`, {
      titre: 'Semaine des Berger', arrivee: jourDecale(-1), depart: jourDecale(5), occupants: 4,
    });
    assert.equal(s.statut, 200, JSON.stringify(s.corps));
    const jeton = await jetonDeLien(i, bienId, 'Famille Berger', s.corps.id, jourDecale(6));
    const invite = await i.post<{ acces: string }>('/api/auth/lien', { jeton });
    assert.equal(invite.statut, 200, JSON.stringify(invite.corps));
    i.utiliserJeton(invite.corps.acces);

    assert.equal((await i.get(`/api/fichiers/${acte.corps.id}`)).statut, 403,
      'l\'acte est de portée « gérants seuls » : un invité ne le télécharge pas');
    assert.equal((await i.get(`/api/fichiers/${assurance.corps.id}`)).statut, 200,
      'l\'assurance est de portée « pendant le séjour », et le séjour est en cours');
  } finally { await i.fermer(); }
});

test('un fichier sans rattachement connu n\'est jamais servi', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { bienId } = await amorcer(i);
    // Déposé, mais rattaché à rien : aucun document ne le référence.
    const f = await deposerCoffre(i, bienId, 'orphelin.jpg', image(32));
    assert.equal(f.statut, 200, JSON.stringify(f.corps));
    assert.equal((await i.get(`/api/fichiers/${f.corps.id}`)).statut, 403,
      'le défaut de cette route est le refus, pas l\'ouverture');
  } finally { await i.fermer(); }
});

test('une photo d\'album n\'est servie qu\'aux membres du bien', async () => {
  const i = await demarrer({ cleCoffre: CLE, publicUrl: 'http://test.local' });
  try {
    const { bienId, structureId } = await amorcer(i);
    await i.patch(`/api/biens/${bienId}`, { locationActivee: true });
    const alb = await i.post<{ id: number }>(`/api/biens/${bienId}/albums`, { titre: 'Été', annee: 2026 });
    const ph = await i.appel<{ fichierId: string; vignetteId: string }>(
      'POST', `/api/biens/${bienId}/albums/${alb.corps.id}/photos?nom=plage.jpg`, image(200));
    assert.equal(ph.statut, 200, JSON.stringify(ph.corps));

    // Un membre de foyer voit la photo et sa vignette.
    const claire = await creerCompte(i, 'Claire Prudhomme', 'claire@exemple.fr');
    await i.post(`/api/structures/${structureId}/roles`, { personneId: claire, role: 'membre_foyer' });
    i.deconnecte();
    await i.connexion('claire@exemple.fr', MOT_DE_PASSE);
    assert.equal((await i.get(`/api/fichiers/${ph.corps.fichierId}`)).statut, 200);
    assert.equal((await i.get(`/api/fichiers/${ph.corps.vignetteId}`)).statut, 200,
      'la vignette suit la photo : sans elle, la grille reste vide');

    // Un invité de passage, non.
    i.deconnecte();
    await i.connexion('helene@exemple.fr', MOT_DE_PASSE);
    const s = await i.post<{ id: number }>(`/api/biens/${bienId}/sejours`, {
      titre: 'Passage', arrivee: jourDecale(-1), depart: jourDecale(3), occupants: 2,
    });
    const jeton = await jetonDeLien(i, bienId, 'Locataire', s.corps.id, jourDecale(4));
    const invite = await i.post<{ acces: string }>('/api/auth/lien', { jeton });
    i.utiliserJeton(invite.corps.acces);
    assert.equal((await i.get(`/api/fichiers/${ph.corps.fichierId}`)).statut, 403,
      'les souvenirs de la famille ne sont pas pour un locataire de passage');
  } finally { await i.fermer(); }
});
