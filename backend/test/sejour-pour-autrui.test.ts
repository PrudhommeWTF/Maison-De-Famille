// La gérante saisit un séjour depuis le calendrier : pour un membre du foyer,
// ou pour un invité qui n'a pas de compte.
//
// Deux choses se vérifient ici, et la seconde est la plus importante : la liste
// des personnes nommables est une liste **de ce bien**. Servir celle de
// l'instance ferait de ce menu déroulant une fuite de la composition d'une
// autre indivision, qui ne se verrait à l'oeil nu qu'une fois l'application
// installée chez plusieurs familles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Instance, MOT_DE_PASSE, amorcer, creerCompte, demarrer } from './aide';

interface Occupants { personnes: { id: number; nom: string; foyerNom: string | null }[] }
interface Sejour { id: number; statut: string }
interface Liste { sejours: { id: number; titre: string; demandeurId: number | null; foyerNom: string | null; nature: string; statut: string }[] }

/** Hélène gérante, Julien indivisaire avec son foyer. */
async function famille(i: Instance) {
  const base = await amorcer(i);
  const foyer = await i.post<{ id: number }>('/api/foyers', { nom: 'Julien et Sofia' });
  const julienId = await creerCompte(i, 'Julien Prudhomme', 'julien@exemple.fr', foyer.corps.id);
  await i.post(`/api/structures/${base.structureId}/detentions`, {
    dateEffet: '2019-06-01', motif: 'Succession',
    parts: [{ personneId: base.personneId, parts: 1 }, { personneId: julienId, parts: 1 }],
  });
  return { ...base, julienId, foyerId: foyer.corps.id };
}

test('la liste des personnes nommables tient au bien, pas à l\'instance', async () => {
  const i = await demarrer();
  try {
    const f = await famille(i);
    // Une seconde indivision, sans rapport : Marc n'a rien à faire dans le menu
    // déroulant du calendrier de Kerloc'h.
    const autre = await i.post<{ structureId: number }>('/api/biens', {
      structureMode: 'sci', structureNom: 'SCI des Aiguilles', nom: 'Chalet',
      commune: 'Chamonix', type: 'montagne', couchages: 4,
    });
    const marcId = await creerCompte(i, 'Marc Ailleurs', 'marc@exemple.fr', null);
    await i.post(`/api/structures/${autre.corps.structureId}/roles`, { personneId: marcId, role: 'detenteur' });

    const r = await i.get<Occupants>(`/api/biens/${f.bienId}/occupants`);
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    const noms = r.corps.personnes.map((p) => p.nom);
    assert.ok(noms.includes('Hélène Prudhomme'));
    assert.ok(noms.includes('Julien Prudhomme'));
    assert.ok(!noms.includes('Marc Ailleurs'), 'une personne d\'une autre structure ne doit pas apparaître');
  } finally { await i.fermer(); }
});

test('un accès temporaire n\'entre pas dans la liste des personnes nommables', async () => {
  const i = await demarrer();
  try {
    const f = await famille(i);
    const jour = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await i.post(`/api/biens/${f.bienId}/acces`, { libelle: 'Les Berger', email: '', expireLe: jour });

    const r = await i.get<Occupants>(`/api/biens/${f.bienId}/occupants`);
    assert.ok(!r.corps.personnes.some((p) => p.nom === 'Les Berger'),
      'un compte ouvert par un lien de séjour n\'est pas un membre de la famille');
  } finally { await i.fermer(); }
});

test('seule la gérante voit la liste des personnes nommables', async () => {
  const i = await demarrer();
  try {
    const f = await famille(i);
    await i.connexion('julien@exemple.fr', MOT_DE_PASSE);
    const r = await i.get(`/api/biens/${f.bienId}/occupants`);
    assert.equal(r.statut, 403, 'un indivisaire n\'a pas à connaître la liste pour saisir');
  } finally { await i.fermer(); }
});

test('la gérante enregistre un séjour pour un membre, validé et à son nom', async () => {
  const i = await demarrer();
  try {
    const f = await famille(i);
    const s = await i.post<Sejour>(`/api/biens/${f.bienId}/sejours`, {
      arrivee: '2026-07-04', depart: '2026-07-11', occupants: 4, demandeurId: f.julienId,
    });
    assert.equal(s.statut, 200, JSON.stringify(s.corps));
    assert.equal(s.corps.statut, 'valide', 'la gérante arbitre, elle ne passe pas par sa propre file');

    const l = await i.get<Liste>(`/api/biens/${f.bienId}/sejours?du=2026-07-01&au=2026-08-01`);
    const pose = l.corps.sejours.find((x) => x.id === s.corps.id);
    assert.ok(pose);
    assert.equal(pose.demandeurId, f.julienId);
    assert.equal(pose.titre, 'Julien Prudhomme', 'sans titre saisi, le séjour porte le nom de la personne');
    assert.equal(pose.foyerNom, 'Julien et Sofia', 'les nuits se rattachent au foyer de la personne');
  } finally { await i.fermer(); }
});

test('la gérante enregistre un séjour d\'invité, à son nom, reçu par un membre', async () => {
  const i = await demarrer();
  try {
    const f = await famille(i);
    const s = await i.post<Sejour>(`/api/biens/${f.bienId}/sejours`, {
      arrivee: '2026-09-05', depart: '2026-09-09', occupants: 3,
      demandeurId: f.julienId, titre: 'Les Martin',
    });
    assert.equal(s.statut, 200, JSON.stringify(s.corps));

    const l = await i.get<Liste>(`/api/biens/${f.bienId}/sejours?du=2026-09-01&au=2026-10-01`);
    const pose = l.corps.sejours.find((x) => x.id === s.corps.id);
    assert.ok(pose);
    assert.equal(pose.titre, 'Les Martin', 'le calendrier nomme l\'invité, pas son hôte');
    assert.equal(pose.nature, 'famille');
    // L'invité n'a pas de compte : sans hôte, ces nuits sortiraient de la
    // répartition « nuits occupées » sans que personne ne le remarque.
    assert.equal(pose.demandeurId, f.julienId);
    assert.equal(pose.foyerNom, 'Julien et Sofia');
  } finally { await i.fermer(); }
});

test('un indivisaire ne peut pas saisir un séjour au nom de quelqu\'un d\'autre', async () => {
  const i = await demarrer();
  try {
    const f = await famille(i);
    await i.connexion('julien@exemple.fr', MOT_DE_PASSE);
    const s = await i.post(`/api/biens/${f.bienId}/sejours`, {
      arrivee: '2026-07-04', depart: '2026-07-11', occupants: 2, demandeurId: f.personneId,
    });
    assert.equal(s.statut, 403);
  } finally { await i.fermer(); }
});
