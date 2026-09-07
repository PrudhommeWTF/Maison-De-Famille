// Ce qu'un invité lit du calendrier.
//
// Un locataire, un ami de passage ou un artisan entre par un lien et voit le
// calendrier du bien : il doit pouvoir situer son séjour et savoir si quelqu'un
// part le matin de son arrivée. Il n'a en revanche aucune raison de lire les
// noms de la famille, le mot laissé à la gérante, ni la bannière d'arbitrage.
//
// Ces tests vérifient les deux niveaux, et il faut les deux :
//
//   1. **La règle**, en module pur : ce qui tombe et ce qui reste.
//   2. **Le réel**, par HTTP : un vrai lien d'invité, et la réponse du serveur
//      relue champ par champ. Masquer à l'affichage laisserait les noms dans la
//      réponse réseau, à un clic de n'importe quel navigateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIBELLE_MASQUE, masquer, masquerListe } from '../src/sejours/discretion';
import { Instance, MOT_DE_PASSE, amorcer, creerCompte, demarrer } from './aide';

const CLE = 'a'.repeat(64);
const jourDecale = (n: number): string => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const unSejour = (id: number, bienId = 1) => ({
  id, bienId, titre: 'Claire, Paul et les cousins',
  demandeurId: 7, demandeurNom: 'Claire Prudhomme',
  foyerId: 3, foyerNom: 'Claire et Paul',
  note: 'Nous pouvons décaler si Julien tient à ces dates.',
  decideParNom: 'Hélène Prudhomme', decisionNote: 'Validé au téléphone.',
  arrivee: '2026-09-16', depart: '2026-09-23', occupants: 5, nature: 'famille', statut: 'valide',
});

test('le séjour de quelqu\'un d\'autre perd tout ce qui nomme une personne', () => {
  const m = masquer(unSejour(1), false);
  assert.equal(m.titre, LIBELLE_MASQUE);
  assert.equal(m.demandeurId, null);
  assert.equal(m.demandeurNom, null);
  assert.equal(m.foyerId, null);
  assert.equal(m.foyerNom, null);
  assert.equal(m.note, '');
  assert.equal(m.decideParNom, null);
  assert.equal(m.decisionNote, '');

  // Ce qui reste dit que la maison est prise, pour quel usage, et à quel point
  // elle est pleine. C'est ce dont un locataire a besoin pour comprendre une
  // rotation le jour de son arrivée.
  assert.equal(m.arrivee, '2026-09-16');
  assert.equal(m.depart, '2026-09-23');
  assert.equal(m.occupants, 5);
  assert.equal(m.nature, 'famille');

  const complet = JSON.stringify(m);
  for (const mot of ['Claire', 'Paul', 'Julien', 'Hélène', 'cousins']) {
    assert.equal(complet.includes(mot), false, `« ${mot} » ne doit pas subsister`);
  }
});

test('son propre séjour revient intact', () => {
  const s = unSejour(1);
  assert.deepEqual(masquer(s, true), s, 'sinon un locataire ne reconnaît plus le sien');
});

test('la portée se décide bien par bien, pas sur toute la liste', () => {
  // Une même personne peut être invitée sur une maison et indivisaire sur une
  // autre : la vue consolidée mélange les deux.
  const liste = [unSejour(1, 1), unSejour(2, 2)];
  const masquee = masquerListe(liste, (b) => b === 1, new Set());
  assert.equal(masquee[0].titre, LIBELLE_MASQUE, 'la maison où elle est invitée');
  assert.equal(masquee[1].titre, 'Claire, Paul et les cousins', 'celle où elle est chez elle');
});

test('le sien est reconnu même dans une liste masquée', () => {
  const masquee = masquerListe([unSejour(1), unSejour(2)], () => true, new Set([2]));
  assert.equal(masquee[0].titre, LIBELLE_MASQUE);
  assert.equal(masquee[1].titre, 'Claire, Paul et les cousins');
});

// ---------------------------------------------------------------------------
// Le réel : un vrai lien d'invité, et ce que le serveur lui répond.
// ---------------------------------------------------------------------------

/** Une maison, une demande de Claire qui chevauche un séjour validé de Julien. */
async function maisonAnimee(i: Instance) {
  const { bienId, structureId } = await amorcer(i);
  const claire = await creerCompte(i, 'Claire Prudhomme', 'claire@exemple.fr');
  const rattachee = await i.post(`/api/structures/${structureId}/roles`,
    { personneId: claire, role: 'membre_foyer' });
  assert.equal(rattachee.statut, 204, JSON.stringify(rattachee.corps));

  await i.post(`/api/biens/${bienId}/sejours`, {
    titre: 'Julien', arrivee: jourDecale(10), depart: jourDecale(17), occupants: 3, nature: 'famille', note: '',
  });
  // Claire dépose sa demande elle-même : saisie par la gérante, elle naîtrait
  // validée, et il n'y aurait aucun chevauchement à arbitrer à montrer.
  await i.connexion('claire@exemple.fr', MOT_DE_PASSE);
  const demande = await i.post(`/api/biens/${bienId}/sejours`, {
    titre: 'Claire, Paul et les cousins', arrivee: jourDecale(12), depart: jourDecale(19),
    occupants: 5, nature: 'famille',
    note: 'Nous pouvons décaler si Julien tient à ces dates.',
  });
  assert.equal(demande.statut, 200, JSON.stringify(demande.corps));
  await i.connexion('helene@exemple.fr', MOT_DE_PASSE);
  return { bienId, claire };
}

/** Ouvre un accès temporaire et bascule la session dessus. */
async function entrerParLien(i: Instance, bienId: number, sejourId: number | null) {
  const a = await i.post<{ lien: string; acces: { personneId: number } }>(`/api/biens/${bienId}/acces`, {
    libelle: 'Famille Berger, locataires', email: '', expireLe: jourDecale(30),
    ...(sejourId ? { sejourId } : {}),
  });
  assert.equal(a.statut, 200, JSON.stringify(a.corps));
  const jeton = decodeURIComponent(a.corps.lien.split('jeton=')[1]);
  i.deconnecte();
  const o = await i.post<{ acces: string }>('/api/auth/lien', { jeton });
  assert.equal(o.statut, 200, JSON.stringify(o.corps));
  i.utiliserJeton(o.corps.acces);
  return a.corps.acces.personneId;
}

test('un invité voit les jours occupés, pas qui les occupe', async () => {
  const i = await demarrer({ cleCoffre: CLE, publicUrl: 'https://maison.exemple.fr' });
  try {
    const { bienId } = await maisonAnimee(i);
    await entrerParLien(i, bienId, null);

    const r = await i.get<{ sejours: { titre: string; note: string; demandeurNom: string | null }[]; conflits: unknown[] }>(
      `/api/biens/${bienId}/sejours?du=${jourDecale(0)}&au=${jourDecale(40)}`);
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    assert.ok(r.corps.sejours.length >= 2, 'les périodes occupées restent visibles');

    for (const s of r.corps.sejours) {
      assert.equal(s.titre, LIBELLE_MASQUE);
      assert.equal(s.note, '');
      assert.equal(s.demandeurNom, null);
    }

    // La vérification qui compte vraiment : rien dans la réponse entière.
    const brut = JSON.stringify(r.corps);
    for (const mot of ['Claire', 'Julien', 'Hélène', 'cousins', 'décaler']) {
      assert.equal(brut.includes(mot), false, `« ${mot} » fuit dans la réponse`);
    }

    // La bannière d'arbitrage est une affaire de famille, et elle nomme les
    // séjours qu'elle croise.
    assert.deepEqual(r.corps.conflits, []);
  } finally { await i.fermer(); }
});

test('un invité reconnaît son propre séjour', async () => {
  const i = await demarrer({ cleCoffre: CLE, publicUrl: 'https://maison.exemple.fr' });
  try {
    const { bienId } = await maisonAnimee(i);
    const sien = await i.post<{ id: number }>(`/api/biens/${bienId}/sejours`, {
      titre: 'Famille Berger', arrivee: jourDecale(1), depart: jourDecale(8),
      occupants: 4, nature: 'location', note: '',
    });
    await entrerParLien(i, bienId, sien.corps.id);

    const r = await i.get<{ sejours: { id: number; titre: string }[] }>(
      `/api/biens/${bienId}/sejours?du=${jourDecale(0)}&au=${jourDecale(40)}`);
    const mien = r.corps.sejours.find((s) => s.id === sien.corps.id);
    assert.equal(mien?.titre, 'Famille Berger', 'sinon il ne sait plus lequel est à lui');
    assert.equal(r.corps.sejours.filter((s) => s.titre === LIBELLE_MASQUE).length >= 2, true,
      'les autres restent masqués');
  } finally { await i.fermer(); }
});

test('les deux autres listes de séjours masquent aussi', async () => {
  const i = await demarrer({ cleCoffre: CLE, publicUrl: 'https://maison.exemple.fr' });
  try {
    const { bienId } = await maisonAnimee(i);
    await entrerParLien(i, bienId, null);

    // Le calendrier consolidé, et la carte « Prochains séjours » du tableau de
    // bord : elles rendent les mêmes lignes par d'autres routes.
    for (const chemin of ['/api/sejours', '/api/sejours/a-venir']) {
      const r = await i.get(chemin);
      assert.equal(r.statut, 200, `${chemin} : ${JSON.stringify(r.corps)}`);
      const brut = JSON.stringify(r.corps);
      for (const mot of ['Claire', 'Julien', 'cousins', 'décaler']) {
        assert.equal(brut.includes(mot), false, `« ${mot} » fuit par ${chemin}`);
      }
    }
  } finally { await i.fermer(); }
});

test('un invité ne reçoit pas les échéances d\'entretien de la famille', async () => {
  const i = await demarrer({ cleCoffre: CLE, publicUrl: 'https://maison.exemple.fr' });
  try {
    const { bienId } = await maisonAnimee(i);
    const tache = await i.post(`/api/biens/${bienId}/taches`, {
      libelle: 'Purger les radiateurs', categorie: 'courant', echeance: jourDecale(-3), detail: '',
    });
    assert.equal(tache.statut, 200, JSON.stringify(tache.corps));
    // La famille la voit bien : c'est le témoin du test.
    assert.equal((await i.get<unknown[]>('/api/entretien/echeances')).corps.length >= 1, true);

    await entrerParLien(i, bienId, null);
    const r = await i.get<unknown[]>('/api/entretien/echeances');
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    assert.deepEqual(r.corps, [],
      'le carnet d\'un bien demande membre_foyer : ses échéances consolidées aussi');
  } finally { await i.fermer(); }
});

test('un membre de la famille continue de tout voir', async () => {
  const i = await demarrer({ cleCoffre: CLE, publicUrl: 'https://maison.exemple.fr' });
  try {
    const { bienId } = await maisonAnimee(i);
    await i.connexion('claire@exemple.fr', MOT_DE_PASSE);

    const r = await i.get<{ sejours: { titre: string }[]; conflits: unknown[] }>(
      `/api/biens/${bienId}/sejours?du=${jourDecale(0)}&au=${jourDecale(40)}`);
    const titres = r.corps.sejours.map((s) => s.titre);
    assert.ok(titres.includes('Julien'), 'la discrétion ne doit pas déborder sur la famille');
    assert.ok(titres.includes('Claire, Paul et les cousins'));
    assert.ok(r.corps.conflits.length >= 1, 'et la bannière d\'arbitrage reste');
  } finally { await i.fermer(); }
});
