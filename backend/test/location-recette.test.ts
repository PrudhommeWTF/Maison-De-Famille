// La recette de la tranche 5, jouée par les routes.
//
// Les deux phrases du plan qui la commandent :
//
//   « Le module location n'existe nulle part sur le bien de montagne. »
//   « Une photo déposée sur un bien n'apparaît pas dans l'album de l'autre. »
//
// La seconde est vérifiée en devinant l'identifiant d'album de l'autre bien,
// pas seulement en regardant l'écran : c'est la seule façon de prouver que le
// filtre est en base et pas à l'affichage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { MOT_DE_PASSE, amorcer, creerCompte, demarrer } from './aide';
import type { Instance } from './aide';

const CLE = 'e'.repeat(64);
const jourDecale = (j: number): string =>
  new Date(Date.now() + j * 86_400_000).toISOString().slice(0, 10);

/** Une photo réelle : le service de fichiers refuse tout ce qui n'en est pas une. */
function photo(largeur = 640, hauteur = 480): Buffer {
  const d = Buffer.alloc(largeur * hauteur * 4);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = (i / 4) % 256; d[i + 1] = 120; d[i + 2] = 200; d[i + 3] = 255;
  }
  return Buffer.from(jpeg.encode({ data: d, width: largeur, height: hauteur }, 85).data);
}

/** Le dépôt d'une photo : le corps est le fichier, le reste en requête. */
const deposer = <T>(i: Instance, bienId: number, albumId: number, nom: string,
  octets: Buffer, legende = ''): Promise<{ statut: number; corps: T }> =>
  i.appel<T>('POST', `/api/biens/${bienId}/albums/${albumId}/photos`
    + `?nom=${encodeURIComponent(nom)}&legende=${encodeURIComponent(legende)}`, octets);

/** Kerloc'h est loué, Les Arcs ne le sont pas. C'est la situation de la maquette. */
async function deuxBiens(i: Instance) {
  const { bienId: mer } = await amorcer(i);
  const a = await i.patch(`/api/biens/${mer}`, { locationActivee: true });
  assert.equal(a.statut, 200, JSON.stringify(a.corps));
  const b = await i.post<{ bienId: number }>('/api/biens', {
    nom: 'Les Arcs 1800', commune: 'Bourg-Saint-Maurice', type: 'montagne', couchages: 6,
    structureMode: 'sci', structureNom: 'SCI Prudhomme Immobilier',
  });
  assert.equal(b.statut, 200, JSON.stringify(b.corps));
  return { mer, mont: b.corps.bienId };
}

test('la location est activable par bien, et n\'existe pas ailleurs', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { mer, mont } = await deuxBiens(i);

    assert.equal((await i.get(`/api/biens/${mer}/location`)).statut, 200,
      'Kerloc\'h est loué : le module répond');

    const refus = await i.get<{ message: string }>(`/api/biens/${mont}/location`);
    assert.equal(refus.statut, 422, 'Les Arcs ne sont pas loués');
    assert.match(refus.corps.message, /n'est pas activée sur ce bien/);
    assert.match(refus.corps.message, /fiche du bien/, 'le message doit dire où activer');

    // Et on ne peut pas y créer de réservation par la bande.
    const force = await i.post(`/api/biens/${mont}/location/reservations`, {
      locataire: 'X', arrivee: jourDecale(10), depart: jourDecale(17), occupants: 2, loyerCents: 50000,
    });
    assert.equal(force.statut, 422,
      'une route qui répondrait « rien à voir » laisserait croire qu\'il n\'y a pas de réservation');
  } finally { await i.fermer(); }
});

test('une réservation bloque le calendrier comme n\'importe quel séjour', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { mer } = await deuxBiens(i);
    const r = await i.post<{ id: number; sejourId: number }>(`/api/biens/${mer}/location/reservations`, {
      locataire: 'Famille Berger', arrivee: jourDecale(30), depart: jourDecale(44),
      occupants: 6, loyerCents: 310000, acompteCents: 100000,
    });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));

    const cal = await i.get<{ sejours: { id: number; nature: string; titre: string }[] }>(
      `/api/biens/${mer}/sejours?du=${jourDecale(0)}&au=${jourDecale(60)}`);
    const s = cal.corps.sejours.find((x) => x.id === r.corps.sejourId);
    assert.ok(s, 'la réservation doit apparaître au calendrier');
    assert.equal(s!.nature, 'location');

    // Et la famille qui demande la même semaine voit le conflit.
    const conflit = await i.post<{ conflits: { message: string }[] }>(`/api/biens/${mer}/verification`, {
      arrivee: jourDecale(35), depart: jourDecale(40), occupants: 4,
    });
    assert.ok(conflit.corps.conflits.length, 'la détection de conflit doit voir la location');
  } finally { await i.fermer(); }
});

test('l\'exercice ne compte que ce qui est encaissé, et le dit', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { mer } = await deuxBiens(i);
    const annee = Number(jourDecale(30).slice(0, 4));
    const soldee = await i.post<{ id: number }>(`/api/biens/${mer}/location/reservations`, {
      locataire: 'M. et Mme Corre', arrivee: `${annee}-07-04`, depart: `${annee}-07-11`,
      occupants: 4, loyerCents: 135000, acompteCents: 0,
    });
    await i.post(`/api/biens/${mer}/location/reservations`, {
      locataire: 'Mme Rolland', arrivee: `${annee}-08-08`, depart: `${annee}-08-15`,
      occupants: 3, loyerCents: 155000, acompteCents: 0,
    });
    await i.post(`/api/biens/${mer}/location/reservations/${soldee.corps.id}/statut`, { statut: 'solde' });

    const l = await i.get<{ exercice: { encaisseCents: number; attenduCents: number; netCents: number; explication: string } }>(
      `/api/biens/${mer}/location?annee=${annee}`);
    assert.equal(l.corps.exercice.encaisseCents, 135000, 'seule la réservation soldée est encaissée');
    assert.equal(l.corps.exercice.attenduCents, 155000);
    assert.equal(l.corps.exercice.netCents, 135000, 'aucune charge saisie');
    assert.match(l.corps.exercice.explication, /restent à percevoir, non comptés/);
  } finally { await i.fermer(); }
});

test('une annulation libère le calendrier', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { mer } = await deuxBiens(i);
    const r = await i.post<{ id: number; sejourId: number }>(`/api/biens/${mer}/location/reservations`, {
      locataire: 'Annulée', arrivee: jourDecale(30), depart: jourDecale(37),
      occupants: 2, loyerCents: 90000, acompteCents: 0,
    });
    await i.post(`/api/biens/${mer}/location/reservations/${r.corps.id}/statut`, { statut: 'annule' });

    const conflit = await i.post<{ conflits: unknown[] }>(`/api/biens/${mer}/verification`, {
      arrivee: jourDecale(31), depart: jourDecale(35), occupants: 4,
    });
    assert.deepEqual(conflit.corps.conflits, [],
      'une semaine annulée doit redevenir libre pour la famille');
  } finally { await i.fermer(); }
});

test('louer avant que la famille ait choisi déclenche une alerte, sans bloquer', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { mer } = await deuxBiens(i);
    const annee = Number(jourDecale(30).slice(0, 4));
    const r = await i.post(`/api/biens/${mer}/location/reservations`, {
      locataire: 'Famille Berger', arrivee: `${annee}-07-25`, depart: `${annee}-08-08`,
      occupants: 6, loyerCents: 310000, acompteCents: 0,
    });
    assert.equal(r.statut, 200, 'l\'alerte ne bloque rien : la gérante arbitre');

    const l = await i.get<{ alerte: string | null }>(`/api/biens/${mer}/location?annee=${annee}`);
    assert.ok(l.corps.alerte);
    assert.match(l.corps.alerte!, /La famille choisit ses dates avant/);
  } finally { await i.fermer(); }
});

test('une photo déposée sur un bien n\'apparaît pas dans l\'album de l\'autre', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { mer, mont } = await deuxBiens(i);
    const albumMer = await i.post<{ id: number }>(`/api/biens/${mer}/albums`,
      { titre: 'Été à Kerloc\'h', annee: 2026 });
    const albumMont = await i.post<{ id: number }>(`/api/biens/${mont}/albums`,
      { titre: 'Ski aux Arcs', annee: 2026 });

    const depot = await deposer(i, mer, albumMer.corps.id, 'plage.jpg', photo(), 'La plage');
    assert.equal(depot.statut, 200, JSON.stringify(depot.corps));

    // L'album de la montagne reste vide.
    const vues = await i.get<unknown[]>(`/api/biens/${mont}/albums/${albumMont.corps.id}`);
    assert.deepEqual(vues.corps, []);

    // Et en devinant l'identifiant de l'album de l'autre bien : introuvable.
    // Le filtre est en base, pas à l'affichage.
    const triche = await i.get(`/api/biens/${mont}/albums/${albumMer.corps.id}`);
    assert.equal(triche.statut, 404,
      'un album ne se lit que dans le chemin de son propre bien');

    const liste = await i.get<{ albums: { id: number; titre: string; photos: number }[] }>(
      `/api/biens/${mont}/albums`);
    assert.deepEqual(liste.corps.albums.map((a) => a.titre), ['Ski aux Arcs']);
  } finally { await i.fermer(); }
});

test('une photo déposée reçoit sa vignette, plus légère que l\'originale', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { mer } = await deuxBiens(i);
    const a = await i.post<{ id: number }>(`/api/biens/${mer}/albums`, { titre: 'Été', annee: 2026 });
    const p = await deposer<{ id: number; fichierId: string; vignetteId: string | null }>(
      i, mer, a.corps.id, 'Été en mer.jpg', photo(1600, 1200));
    assert.equal(p.statut, 200, JSON.stringify(p.corps));
    assert.ok(p.corps.vignetteId, 'une vignette doit être engendrée au dépôt');

    // Le nom voyage en paramètre de requête : les accents doivent survivre,
    // sinon la famille retrouve « Ã‰tÃ© en mer.jpg » dans ses téléchargements.
    assert.equal((i.db.prepare('SELECT nom_original AS n FROM fichier WHERE id = ?')
      .get(p.corps.fichierId) as { n: string }).n, 'Été en mer.jpg');

    const taille = (id: string): number =>
      (i.db.prepare('SELECT taille FROM fichier WHERE id = ?').get(id) as { taille: number }).taille;
    assert.ok(taille(p.corps.vignetteId!) < taille(p.corps.fichierId),
      'la vignette doit peser moins que la photo, c\'est tout son intérêt');

    // La couverture de l'album pointe la vignette, pas l'originale.
    const liste = await i.get<{ albums: { couvertureId: string }[] }>(`/api/biens/${mer}/albums`);
    assert.equal(liste.corps.albums[0].couvertureId, p.corps.vignetteId);
  } finally { await i.fermer(); }
});

test('seul l\'auteur ou un gérant retire une photo', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { mer } = await deuxBiens(i);
    const structureId = (i.db.prepare('SELECT structure_id AS s FROM bien WHERE id = ?')
      .get(mer) as { s: number }).s;
    const claire = await creerCompte(i, 'Claire Prudhomme', 'claire@exemple.fr');
    const julien = await creerCompte(i, 'Julien Prudhomme', 'julien@exemple.fr');
    for (const id of [claire, julien]) {
      await i.post(`/api/structures/${structureId}/roles`, { personneId: id, role: 'membre_foyer' });
    }
    const a = await i.post<{ id: number }>(`/api/biens/${mer}/albums`, { titre: 'Été', annee: 2026 });

    i.deconnecte();
    await i.connexion('claire@exemple.fr', MOT_DE_PASSE);
    const p = await deposer<{ id: number }>(
      i, mer, a.corps.id, 'claire.jpg', photo(320, 240), 'Vue de la terrasse');
    assert.equal(p.statut, 200, 'un membre de foyer dépose des photos');

    i.deconnecte();
    await i.connexion('julien@exemple.fr', MOT_DE_PASSE);
    const refus = await i.post<{ message: string }>(
      `/api/biens/${mer}/albums/photos/${p.corps.id}/archivage`, {});
    assert.equal(refus.statut, 403);
    assert.match(refus.corps.message, /Claire Prudhomme/, 'le message dit qui l\'a déposée');

    // La gérante, elle, peut.
    i.deconnecte();
    await i.connexion('helene@exemple.fr', MOT_DE_PASSE);
    assert.equal((await i.post(`/api/biens/${mer}/albums/photos/${p.corps.id}/archivage`, {})).statut, 204);
  } finally { await i.fermer(); }
});

test('un album de séjour se crée tout seul à la fin du séjour', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { mer } = await deuxBiens(i);
    await i.post(`/api/biens/${mer}/sejours`, {
      titre: 'Claire et Marc', arrivee: jourDecale(-10), depart: jourDecale(-3),
      occupants: 4, nature: 'famille',
    });
    const { creerAlbumsDesSejoursFinis } = await import('../src/location/routes');
    assert.equal(creerAlbumsDesSejoursFinis(i.db), 1);
    assert.equal(creerAlbumsDesSejoursFinis(i.db), 0, 'un second passage ne double pas l\'album');

    const l = await i.get<{ albums: { titre: string }[] }>(`/api/biens/${mer}/albums`);
    assert.deepEqual(l.corps.albums.map((a) => a.titre), ['Claire et Marc']);
  } finally { await i.fermer(); }
});

test('le livre d\'or garde un fil par année', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { mer } = await deuxBiens(i);
    await i.post(`/api/biens/${mer}/livre-or`,
      { texte: 'Une semaine de pluie et de fous rires.', signature: 'Claire', annee: 2025 });
    await i.post(`/api/biens/${mer}/livre-or`,
      { texte: 'La haie a bien poussé.', signature: 'Thomas', annee: 2026 });

    const l = await i.get<{ mots: { annee: number; texte: string }[] }>(`/api/biens/${mer}/albums`);
    assert.deepEqual(l.corps.mots.map((m) => m.annee), [2026, 2025], 'la plus récente en premier');
  } finally { await i.fermer(); }
});

test('un invité ne voit pas les souvenirs de la famille', async () => {
  const i = await demarrer({ cleCoffre: CLE, publicUrl: 'https://maison.exemple.fr' });
  try {
    const { mer } = await deuxBiens(i);
    await i.post(`/api/biens/${mer}/albums`, { titre: 'Été', annee: 2026 });
    const a = await i.post<{ lien: string }>(`/api/biens/${mer}/acces`, {
      libelle: 'Locataire', email: '', expireLe: jourDecale(7),
    });
    const jeton = decodeURIComponent(a.corps.lien.split('jeton=')[1]);
    i.deconnecte();
    const o = await i.post<{ acces: string }>('/api/auth/lien', { jeton });
    i.utiliserJeton(o.corps.acces);
    assert.equal((await i.get(`/api/biens/${mer}/albums`)).statut, 403,
      'les albums sont ce que la famille a de plus intime : pas pour un locataire');
    assert.equal((await i.get(`/api/biens/${mer}/location`)).statut, 403);
  } finally { await i.fermer(); }
});
