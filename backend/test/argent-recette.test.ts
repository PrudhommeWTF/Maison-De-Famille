// Le scénario de recette de la tranche 2, joué de bout en bout.
//
// Les deux points que Thomas vérifiera lui-même :
//
//   « Je saisis une dépense de taxe foncière : la répartition suit les
//     quotes-parts, et je peux afficher le détail du calcul. »
//   « Je modifie une quote-part avec une date d'effet dans le passé : les
//     dépenses antérieures gardent leur ventilation d'origine. »
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Instance, MOT_DE_PASSE, amorcer, creerCompte, demarrer } from './aide';

const HELENE = 1;

interface Contexte { structureId: number; bienId: number; julienId: number; claireId: number; categories: { id: number; code: string }[] }

/** L'indivision de Kerloc'h : Hélène, Claire, Julien, à parts égales depuis 2019. */
async function indivision(i: Instance): Promise<Contexte> {
  const base = await amorcer(i);
  const fClaire = await i.post<{ id: number }>('/api/foyers', { nom: 'Claire et Marc' });
  const fJulien = await i.post<{ id: number }>('/api/foyers', { nom: 'Julien et Sofia' });
  const claireId = await creerCompte(i, 'Claire Prudhomme', 'claire@exemple.fr', fClaire.corps.id);
  const julienId = await creerCompte(i, 'Julien Prudhomme', 'julien@exemple.fr', fJulien.corps.id);

  const r = await i.post(`/api/structures/${base.structureId}/detentions`, {
    dateEffet: '2019-06-01', motif: 'Succession de Robert Prudhomme',
    parts: [{ personneId: HELENE, parts: 1 }, { personneId: claireId, parts: 1 }, { personneId: julienId, parts: 1 }],
  });
  assert.equal(r.statut, 204, JSON.stringify(r.corps));

  const categories = (await i.get<{ id: number; code: string }[]>('/api/categories')).corps;
  return { structureId: base.structureId, bienId: base.bienId, julienId, claireId, categories };
}

const categorie = (c: Contexte, code: string): number => c.categories.find((x) => x.code === code)!.id;

/** Enregistre une dépense sur le bien principal. */
async function saisir(
  i: Instance, c: Contexte,
  d: { date: string; libelle: string; code: string; montantCents: number; avanceParId?: number },
): Promise<number> {
  const r = await i.post<{ id: number }>(`/api/structures/${c.structureId}/depenses`, {
    dateDepense: d.date, libelle: d.libelle, categorieId: categorie(c, d.code),
    montantCents: d.montantCents,
    payePar: d.avanceParId ? 'personne' : 'structure',
    ...(d.avanceParId ? { avanceParId: d.avanceParId } : {}),
    biens: [{ bienId: c.bienId, poidsNum: 1, poidsDen: 1 }],
  });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  return r.corps.id;
}

interface Detail {
  depense: { montantCents: number; regleAppliquee: string };
  ventilation: { personneId: number; nom: string; montantCents: number }[];
  explication: string[];
  justification: { regleAppliquee: string; dateReference: string };
  recalculs: { motif: string }[];
}

test('une taxe foncière se répartit selon les quotes-parts, et le calcul s\'explique', async () => {
  const i = await demarrer();
  try {
    const c = await indivision(i);
    const id = await saisir(i, c, {
      date: '2026-09-02', libelle: 'Taxe foncière 2026', code: 'taxe_fonciere',
      montantCents: 234000, avanceParId: HELENE,
    });

    const d = await i.get<Detail>(`/api/structures/${c.structureId}/depenses/${id}`);
    assert.equal(d.statut, 200);
    assert.equal(d.corps.ventilation.length, 3);
    assert.deepEqual(d.corps.ventilation.map((v) => v.montantCents), [78000, 78000, 78000]);
    assert.equal(d.corps.justification.regleAppliquee, 'quotes_parts');

    // L'explication se lit à voix haute devant quelqu'un qui conteste.
    const texte = d.corps.explication.join('\n');
    assert.match(texte, /Règle appliquée : Quotes-parts/);
    assert.match(texte, /2 septembre 2026/);
    assert.match(texte, /1 \/ 3/);
    assert.match(texte, /780,00 €/);
    assert.match(texte, /somme des parts vaut 2 340,00 €/);
  } finally { await i.fermer(); }
});

test('changer une quote-part dans le passé ne recalcule aucune dépense', async () => {
  const i = await demarrer();
  try {
    const c = await indivision(i);
    const id = await saisir(i, c, {
      date: '2026-02-10', libelle: 'Taxe foncière 2026', code: 'taxe_fonciere',
      montantCents: 234000, avanceParId: HELENE,
    });
    const avant = await i.get<Detail>(`/api/structures/${c.structureId}/depenses/${id}`);
    assert.deepEqual(avant.corps.ventilation.map((v) => v.montantCents), [78000, 78000, 78000]);

    // Julien rachète les parts de Claire, avec effet au 1er mars, donc APRÈS
    // la dépense de février.
    const r = await i.post(`/api/structures/${c.structureId}/detentions`, {
      dateEffet: '2026-03-01', motif: 'Rachat des parts de Claire',
      parts: [{ personneId: HELENE, parts: 1 }, { personneId: c.julienId, parts: 2 }],
    });
    assert.equal(r.statut, 204, JSON.stringify(r.corps));

    const apres = await i.get<Detail>(`/api/structures/${c.structureId}/depenses/${id}`);
    assert.deepEqual(apres.corps.ventilation, avant.corps.ventilation,
      'la ventilation de février doit rester exactement celle de février');

    // Une dépense saisie APRÈS le changement suit la nouvelle répartition.
    const suivante = await saisir(i, c, {
      date: '2026-04-10', libelle: 'Assurance', code: 'assurance',
      montantCents: 30000, avanceParId: HELENE,
    });
    const d2 = await i.get<Detail>(`/api/structures/${c.structureId}/depenses/${suivante}`);
    assert.equal(d2.corps.ventilation.length, 2);
    assert.deepEqual(d2.corps.ventilation.map((v) => v.montantCents).sort((a, b) => b - a), [20000, 10000]);
  } finally { await i.fermer(); }
});

test('changer une règle de répartition ne recalcule pas les dépenses passées', async () => {
  const i = await demarrer();
  try {
    const c = await indivision(i);
    const id = await saisir(i, c, {
      date: '2026-02-10', libelle: 'Fioul', code: 'energie', montantCents: 116000, avanceParId: HELENE,
    });
    const avant = await i.get<Detail>(`/api/structures/${c.structureId}/depenses/${id}`);
    assert.equal(avant.corps.justification.regleAppliquee, 'quotes_parts');

    const r = await i.post(`/api/biens/${c.bienId}/regles`, {
      categorieId: categorie(c, 'energie'), regle: 'nuits', applicableDu: '2026-06-01',
    });
    assert.equal(r.statut, 204, JSON.stringify(r.corps));

    const apres = await i.get<Detail>(`/api/structures/${c.structureId}/depenses/${id}`);
    assert.equal(apres.corps.justification.regleAppliquee, 'quotes_parts',
      'la dépense de février garde la règle de février');
  } finally { await i.fermer(); }
});

test('une règle antérieure à une règle existante est refusée, en disant quoi faire', async () => {
  const i = await demarrer();
  try {
    const c = await indivision(i);
    await i.post(`/api/biens/${c.bienId}/regles`, {
      categorieId: categorie(c, 'energie'), regle: 'nuits', applicableDu: '2026-06-01',
    });
    const r = await i.post<{ message: string }>(`/api/biens/${c.bienId}/regles`, {
      categorieId: categorie(c, 'energie'), regle: 'quotes_parts', applicableDu: '2026-01-01',
    });
    assert.equal(r.statut, 422);
    assert.match(r.corps.message, /postérieure à la date demandée/);
  } finally { await i.fermer(); }
});

test('un recalcul est possible, motivé, et conserve l\'ancienne ventilation', async () => {
  const i = await demarrer();
  try {
    const c = await indivision(i);
    const id = await saisir(i, c, {
      date: '2026-02-10', libelle: 'Taxe foncière', code: 'taxe_fonciere',
      montantCents: 234000, avanceParId: HELENE,
    });
    await i.post(`/api/structures/${c.structureId}/detentions`, {
      dateEffet: '2026-03-01', motif: 'Rachat', parts: [{ personneId: HELENE, parts: 1 }, { personneId: c.julienId, parts: 2 }],
    });

    // Sans motif, le recalcul est refusé.
    assert.equal((await i.post(`/api/structures/${c.structureId}/depenses/${id}/recalcul`, {})).statut, 400);

    const r = await i.post(`/api/structures/${c.structureId}/depenses/${id}/recalcul`,
      { motif: 'La succession a été rectifiée par le notaire' });
    assert.equal(r.statut, 200);

    const d = await i.get<Detail>(`/api/structures/${c.structureId}/depenses/${id}`);
    assert.equal(d.corps.ventilation.length, 3, 'la ventilation reste celle des parts de février');
    assert.equal(d.corps.recalculs.length, 1);
    assert.match(d.corps.recalculs[0].motif, /notaire/);
    // L'ancienne version est conservée : c'est ce qui permet de répondre à
    // « pourquoi ce chiffre a changé ».
    const garde = i.db.prepare('SELECT avant_json FROM ventilation_recalcul WHERE depense_id = ?').get(id) as { avant_json: string };
    assert.match(garde.avant_json, /78000/);
  } finally { await i.fermer(); }
});

test('les soldes tombent à zéro et les virements les ramènent à zéro', async () => {
  const i = await demarrer();
  try {
    const c = await indivision(i);
    await saisir(i, c, { date: '2026-09-02', libelle: 'Taxe foncière', code: 'taxe_fonciere', montantCents: 234000, avanceParId: HELENE });
    await saisir(i, c, { date: '2026-07-02', libelle: 'Fioul', code: 'energie', montantCents: 116000, avanceParId: HELENE });
    await saisir(i, c, { date: '2026-03-03', libelle: 'Portail', code: 'travaux', montantCents: 48000, avanceParId: c.claireId });
    await saisir(i, c, { date: '2026-05-05', libelle: 'Ménage', code: 'menage', montantCents: 42000 });

    interface Soldes {
      soldes: { acteurId: number; nom: string; estStructure: boolean; montantCents: number }[];
      virements: { deId: number; versId: number; montantCents: number; motif: string }[];
      controle: number;
    }
    const s = await i.get<Soldes>(`/api/structures/${c.structureId}/soldes`);
    assert.equal(s.statut, 200);
    assert.equal(s.corps.controle, 0, 'la somme de tous les soldes doit valoir exactement zéro');

    // Le compte commun a payé le ménage : il est créancier de ce montant.
    const commun = s.corps.soldes.find((x) => x.estStructure);
    assert.equal(commun?.montantCents, 42000);

    // Appliquer les virements proposés ramène tout le monde à zéro.
    const apres = new Map(s.corps.soldes.map((x) => [x.acteurId, x.montantCents]));
    for (const v of s.corps.virements) {
      apres.set(v.deId, (apres.get(v.deId) ?? 0) + v.montantCents);
      apres.set(v.versId, (apres.get(v.versId) ?? 0) - v.montantCents);
    }
    for (const [id, montant] of apres) assert.equal(montant, 0, `l'acteur ${id} n'est pas à zéro`);
    assert.ok(s.corps.virements.length <= s.corps.soldes.length - 1);
    assert.match(s.corps.virements[0].motif, /indivision|Remboursement/);
  } finally { await i.fermer(); }
});

test('un virement ne se confirme que par son bénéficiaire', async () => {
  const i = await demarrer();
  try {
    const c = await indivision(i);
    await saisir(i, c, { date: '2026-09-02', libelle: 'Taxe foncière', code: 'taxe_fonciere', montantCents: 234000, avanceParId: HELENE });

    // Julien annonce son virement vers Hélène.
    await i.connexion('julien@exemple.fr', MOT_DE_PASSE);
    const r = await i.post<{ id: number }>(`/api/structures/${c.structureId}/reglements`, {
      deId: c.julienId, versId: HELENE, montantCents: 78000, motif: 'Régularisation 2026',
    });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));

    // Il ne peut pas confirmer lui-même : sinon un débiteur solderait sa propre
    // dette d'un clic, et le solde ne voudrait plus rien dire.
    const soi = await i.post<{ message: string }>(`/api/structures/${c.structureId}/reglements/${r.corps.id}/confirmation`);
    assert.equal(soi.statut, 403);
    assert.match(soi.corps.message, /bénéficiaire/);

    // Tant qu'il n'est pas confirmé, le solde ne bouge pas.
    interface Soldes { soldes: { acteurId: number; montantCents: number }[] }
    await i.connexion('helene@exemple.fr', MOT_DE_PASSE);
    const avant = await i.get<Soldes>(`/api/structures/${c.structureId}/soldes`);
    assert.equal(avant.corps.soldes.find((x) => x.acteurId === c.julienId)?.montantCents, -78000);

    assert.equal((await i.post(`/api/structures/${c.structureId}/reglements/${r.corps.id}/confirmation`)).statut, 204);
    const apres = await i.get<Soldes>(`/api/structures/${c.structureId}/soldes`);
    assert.equal(apres.corps.soldes.find((x) => x.acteurId === c.julienId)?.montantCents, 0);
  } finally { await i.fermer(); }
});

test('un appel de fonds prévient chaque personne concernée', async () => {
  const i = await demarrer();
  try {
    const c = await indivision(i);
    await saisir(i, c, { date: '2026-09-02', libelle: 'Taxe foncière', code: 'taxe_fonciere', montantCents: 234000, avanceParId: HELENE });

    const r = await i.post<{ appelId: number; lignes: number }>(`/api/structures/${c.structureId}/appels`, {
      libelle: 'Régularisation 2026', echeance: '2026-10-31',
    });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    assert.equal(r.corps.lignes, 2, 'les deux débiteurs, pas la créancière');

    const notifs = i.db.prepare("SELECT personne_id AS pid, sujet, lien FROM notification WHERE type = 'appel_de_fonds'")
      .all() as { pid: number; sujet: string; lien: string }[];
    assert.equal(notifs.length, 2);
    assert.ok(notifs.every((n) => n.pid !== HELENE));
    assert.match(notifs[0].sujet, /Régularisation 2026 : 780,00 €/);
    assert.match(notifs[0].lien, /^https:\/\/maison\.test\//);
  } finally { await i.fermer(); }
});

test('un appel de fonds sans débiteur est refusé plutôt que vide', async () => {
  const i = await demarrer();
  try {
    const c = await indivision(i);
    const r = await i.post<{ message: string }>(`/api/structures/${c.structureId}/appels`,
      { libelle: 'Rien à appeler', echeance: '2026-10-31' });
    assert.equal(r.statut, 422);
    assert.match(r.corps.message, /rien à appeler/);
  } finally { await i.fermer(); }
});

test('une dépense ne peut pas mélanger deux structures, et le message dit quoi faire', async () => {
  const i = await demarrer();
  try {
    const c = await indivision(i);
    const autre = await i.post<{ bienId: number }>('/api/biens', {
      structureMode: 'sci', structureNom: 'SCI Prudhomme Immobilier',
      nom: 'Les Arcs 1800', commune: 'Bourg-Saint-Maurice', type: 'montagne', couchages: 6,
    });
    const r = await i.post<{ message: string }>(`/api/structures/${c.structureId}/depenses`, {
      dateDepense: '2026-05-05', libelle: 'Assurance multirisque', categorieId: categorie(c, 'assurance'),
      montantCents: 112800, payePar: 'structure',
      biens: [{ bienId: c.bienId, poidsNum: 1, poidsDen: 2 }, { bienId: autre.corps.bienId, poidsNum: 1, poidsDen: 2 }],
    });
    assert.equal(r.statut, 422);
    assert.match(r.corps.message, /deux pots distincts/);
  } finally { await i.fermer(); }
});

test('une dépense sans répartition saisie est refusée, en disant quoi faire', async () => {
  const i = await demarrer();
  try {
    const base = await amorcer(i);
    const categories = (await i.get<{ id: number; code: string }[]>('/api/categories')).corps;
    // Aucune détention n'a été saisie : l'amorçage n'en invente pas.
    const r = await i.post<{ message: string }>(`/api/structures/${base.structureId}/depenses`, {
      dateDepense: '2026-09-02', libelle: 'Taxe foncière', categorieId: categories[0].id,
      montantCents: 234000, payePar: 'structure',
      biens: [{ bienId: base.bienId, poidsNum: 1, poidsDen: 1 }],
    });
    assert.equal(r.statut, 422);
    assert.match(r.corps.message, /renseignez les quotes-parts/);
  } finally { await i.fermer(); }
});

test('un membre de foyer ne voit pas les dépenses tant que le réglage l\'interdit', async () => {
  const i = await demarrer();
  try {
    const c = await indivision(i);
    await saisir(i, c, { date: '2026-09-02', libelle: 'Taxe foncière', code: 'taxe_fonciere', montantCents: 234000, avanceParId: HELENE });

    // Marc est dans le foyer de Claire, sans détenir de parts : il est membre
    // de foyer, et pas indivisaire.
    const fClaire = (i.db.prepare("SELECT id FROM foyer WHERE nom = 'Claire et Marc'").get() as { id: number }).id;
    await creerCompte(i, 'Marc', 'marc@exemple.fr', fClaire);
    await i.connexion('marc@exemple.fr', MOT_DE_PASSE);

    interface Liste { total: number; depenses: unknown[] }
    const vide = await i.get<Liste>('/api/depenses');
    assert.equal(vide.statut, 200);
    assert.deepEqual(vide.corps.depenses, [], 'le défaut est prudent');
    assert.equal(vide.corps.total, 0);
    // Et le détail lui est refusé, la route étant réservée aux détenteurs.
    assert.equal((await i.get(`/api/structures/${c.structureId}/soldes`)).statut, 403);

    await i.connexion('helene@exemple.fr', MOT_DE_PASSE);
    await i.post('/api/parametres', { cle: 'membreFoyerVoitDepenses', valeur: true });
    await i.connexion('marc@exemple.fr', MOT_DE_PASSE);
    const visible = await i.get<Liste>('/api/depenses');
    assert.equal(visible.corps.depenses.length, 1);
  } finally { await i.fermer(); }
});

test('le total affiché est dérivé de la même liste que les lignes', async () => {
  const i = await demarrer();
  try {
    const c = await indivision(i);
    await saisir(i, c, { date: '2026-09-02', libelle: 'Taxe foncière', code: 'taxe_fonciere', montantCents: 234000, avanceParId: HELENE });
    await saisir(i, c, { date: '2026-07-02', libelle: 'Fioul', code: 'energie', montantCents: 116000, avanceParId: HELENE });
    await saisir(i, c, { date: '2025-07-02', libelle: 'Ancien exercice', code: 'energie', montantCents: 99900, avanceParId: HELENE });

    interface Liste { annee: number; total: number; depenses: { partVisibleCents: number }[] }
    const l = await i.get<Liste>('/api/depenses?annee=2026');
    assert.equal(l.corps.annee, 2026);
    assert.equal(l.corps.depenses.length, 2, "l'exercice 2025 n'entre pas dans le total 2026");
    assert.equal(l.corps.total, 234000 + 116000);
    assert.equal(l.corps.total, l.corps.depenses.reduce((t, d) => t + d.partVisibleCents, 0));
  } finally { await i.fermer(); }
});

test('l\'export CSV des dépenses porte la ventilation et la règle appliquée', async () => {
  const i = await demarrer();
  try {
    const c = await indivision(i);
    await saisir(i, c, { date: '2026-09-02', libelle: 'Taxe foncière 2026', code: 'taxe_fonciere', montantCents: 234000, avanceParId: HELENE });

    // Les octets bruts : le client HTTP retire la marque d'octets Unicode en
    // décodant, il faut donc la vérifier avant décodage.
    const brut = await fetch(`${i.url}/api/export/depenses.csv?annee=2026`, { headers: i.entetesAuth });
    assert.equal(brut.status, 200);
    const octets = Buffer.from(await brut.arrayBuffer());
    assert.deepEqual([...octets.subarray(0, 3)], [0xef, 0xbb, 0xbf], "sans le BOM, Excel casse les accents");

    const csv = await i.get<string>('/api/export/depenses.csv?annee=2026');
    assert.equal(csv.statut, 200);
    const lignes = csv.corps.trim().split('\r\n');
    assert.equal(lignes.length, 4, 'une ligne d\'en-tête, puis une ligne par personne');
    assert.match(lignes[0], /Règle appliquée;Personne;Part due/);
    assert.match(lignes[1], /Quotes-parts/);
    // Les montants sortent sans symbole ni séparateur de milliers : Excel les
    // reconnaît alors comme des nombres, et non comme du texte.
    assert.match(lignes[1], /;780,00;/);
    assert.match(lignes[1], /;2340,00;/);
  } finally { await i.fermer(); }
});

test('une dépense annulée sort des soldes sans être effacée', async () => {
  const i = await demarrer();
  try {
    const c = await indivision(i);
    const id = await saisir(i, c, { date: '2026-09-02', libelle: 'Erreur de saisie', code: 'travaux', montantCents: 100000, avanceParId: HELENE });

    interface Soldes { soldes: { acteurId: number; montantCents: number }[]; controle: number }
    const avant = await i.get<Soldes>(`/api/structures/${c.structureId}/soldes`);
    assert.notEqual(avant.corps.soldes.find((x) => x.acteurId === HELENE)?.montantCents, 0);

    assert.equal((await i.post(`/api/structures/${c.structureId}/depenses/${id}/annulation`)).statut, 204);
    const apres = await i.get<Soldes>(`/api/structures/${c.structureId}/soldes`);
    assert.equal(apres.corps.controle, 0);
    assert.equal(apres.corps.soldes.length, 0, 'plus aucune dette après annulation');

    const reste = i.db.prepare('SELECT statut, archive_le AS archive FROM depense WHERE id = ?').get(id) as { statut: string; archive: string | null };
    assert.equal(reste.statut, 'annulee');
    assert.ok(reste.archive, 'archivée, pas supprimée');
  } finally { await i.fermer(); }
});
