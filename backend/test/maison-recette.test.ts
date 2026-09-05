// La recette de la tranche 3, jouée par les routes.
//
// Deux phrases du plan la commandent, et ce fichier ne fait que les vérifier :
//
//   « Un membre de foyer voit le guide d'arrivée mais pas la convention
//     d'indivision. »
//   « Un code de portail affiché pendant un séjour ne l'est plus le lendemain
//     de son départ, et vous retrouvez qui l'a affiché et quand. »
//
// Le second point est joué **par le temps**, pas par une simulation : le séjour
// est déplacé dans la base pour que le jour courant tombe avant, pendant, puis
// après. Une règle de date vérifiée avec une horloge figée ne prouve rien.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOT_DE_PASSE, amorcer, creerCompte, demarrer } from './aide';
import type { Instance } from './aide';

const CLE = 'c'.repeat(64);

/** Hélène gère, Claire est membre de foyer, et un séjour est posé pour Claire. */
async function maison(i: Instance) {
  const { bienId, structureId } = await amorcer(i);
  const claireId = await creerCompte(i, 'Claire Prudhomme', 'claire@exemple.fr');
  await i.post(`/api/structures/${structureId}/roles`, { personneId: claireId, role: 'membre_foyer' });
  return { bienId, structureId, claireId };
}

/** Pose un séjour validé pour Claire, aux dates voulues. */
async function sejour(i: Instance, bienId: number, claireId: number, arrivee: string, depart: string) {
  const r = await i.post<{ id: number }>(`/api/biens/${bienId}/sejours`, {
    titre: 'Claire', arrivee, depart, occupants: 2, nature: 'famille',
    demandeurId: claireId, note: '',
  });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  return r.corps.id;
}

const jourDecale = (jours: number): string =>
  new Date(Date.now() + jours * 86_400_000).toISOString().slice(0, 10);

test('un membre de foyer voit le guide d\'arrivée mais pas la convention d\'indivision', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { bienId } = await maison(i);

    await i.post(`/api/biens/${bienId}/fiche`, {
      section: 'guide', cle: 'Eau', valeur: "vanne générale sous l'escalier", ordre: 1,
    });
    const fichier = await i.post<{ id: string }>(`/api/biens/${bienId}/coffre/fichier`, {
      nom: 'convention.pdf', contenu: Buffer.from('%PDF-1.4 convention').toString('base64'),
    });
    await i.post(`/api/biens/${bienId}/coffre/documents`, {
      nom: "Convention d'indivision", portee: 'detenteur', fichierId: fichier.corps.id, note: '',
    });
    await i.post(`/api/biens/${bienId}/coffre/documents`, {
      nom: "Attestation d'assurance", portee: 'membres', fichierId: fichier.corps.id, note: '',
    });

    i.deconnecte();
    await i.connexion('claire@exemple.fr', MOT_DE_PASSE);

    const fiche = await i.get<{ guide: { cle: string }[] }>(`/api/biens/${bienId}/fiche`);
    assert.equal(fiche.statut, 200);
    assert.deepEqual(fiche.corps.guide.map((g) => g.cle), ['Eau'],
      "le guide d'arrivée est fait pour être lu par ceux qui séjournent");

    const coffre = await i.get<{ documents: { nom: string }[] }>(`/api/biens/${bienId}/coffre`);
    assert.deepEqual(coffre.corps.documents.map((d) => d.nom), ["Attestation d'assurance"],
      "la convention d'indivision ne doit pas sortir de la base pour un membre de foyer");
  } finally { await i.fermer(); }
});

test('un code de séjour : avant, pendant, le jour du départ, le lendemain', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { bienId, claireId } = await maison(i);
    const code = await i.post<{ id: number }>(`/api/biens/${bienId}/coffre/codes`, {
      libelle: 'Portail résidence', valeur: '1840B', portee: 'sejour', note: '',
    });
    assert.equal(code.statut, 200, JSON.stringify(code.corps));

    // Un séjour lointain : Claire voit le code exister ? Non, il est hors portée.
    const sejourId = await sejour(i, bienId, claireId, jourDecale(60), jourDecale(67));

    i.deconnecte();
    await i.connexion('claire@exemple.fr', MOT_DE_PASSE);
    const chemin = `/api/biens/${bienId}/coffre/codes/${code.corps.id}/affichage`;

    const loin = await i.post<{ message: string }>(chemin, {});
    assert.equal(loin.statut, 403, 'deux mois avant, le code ne se montre pas');
    assert.match(loin.corps.message, /autour de votre séjour/,
      "le refus doit dire quand ce sera possible, pas nier l'existence du code");

    // Le séjour est ramené sur aujourd'hui : Claire est sur place.
    const majSejour = (a: string, d: string): void => {
      i.db.prepare('UPDATE sejour SET arrivee = ?, depart = ? WHERE id = ?').run(a, d, sejourId);
    };
    majSejour(jourDecale(-3), jourDecale(4));
    const pendant = await i.post<{ valeur: string }>(chemin, {});
    assert.equal(pendant.statut, 200, 'pendant le séjour, le code se montre');
    assert.equal(pendant.corps.valeur, '1840B');

    // Le jour du départ : il faut bien refermer derrière soi.
    majSejour(jourDecale(-7), jourDecale(0));
    assert.equal((await i.post(chemin, {})).statut, 200, 'le jour du départ compte encore');

    // Le lendemain du départ : la faille que le brief nomme.
    majSejour(jourDecale(-8), jourDecale(-1));
    const apres = await i.post<{ message: string }>(chemin, {});
    assert.equal(apres.statut, 403, 'le lendemain du départ, le code est fermé');
    assert.match(apres.corps.message, /séjour/);

    // Et la liste ne le mentionne même plus.
    const liste = await i.get<{ codes: unknown[] }>(`/api/biens/${bienId}/coffre`);
    assert.deepEqual(liste.corps.codes, [], 'un code hors portée ne doit pas être listé non plus');
  } finally { await i.fermer(); }
});

test('on retrouve qui a affiché un code, et quand', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { bienId, claireId } = await maison(i);
    const code = await i.post<{ id: number }>(`/api/biens/${bienId}/coffre/codes`, {
      libelle: 'Boîte à clés', valeur: '2059', portee: 'sejour', note: '',
    });
    await sejour(i, bienId, claireId, jourDecale(-2), jourDecale(3));

    i.deconnecte();
    await i.connexion('claire@exemple.fr', MOT_DE_PASSE);
    await i.post(`/api/biens/${bienId}/coffre/codes/${code.corps.id}/affichage`, {});

    i.deconnecte();
    await i.connexion('helene@exemple.fr', MOT_DE_PASSE);
    const journal = await i.get<{ personneNom: string; afficheLe: string }[]>(
      `/api/biens/${bienId}/coffre/codes/${code.corps.id}/affichages`);
    assert.equal(journal.statut, 200);
    assert.equal(journal.corps.length, 1);
    assert.equal(journal.corps[0].personneNom, 'Claire Prudhomme');
    assert.match(journal.corps[0].afficheLe, /^\d{4}-\d{2}-\d{2}T/);
  } finally { await i.fermer(); }
});

test('la liste des codes ne porte jamais la valeur, même pour la gérante', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { bienId } = await maison(i);
    await i.post(`/api/biens/${bienId}/coffre/codes`, {
      libelle: 'Alarme', valeur: 'un-secret-reconnaissable', portee: 'membres', note: '',
    });
    const r = await i.get(`/api/biens/${bienId}/coffre`);
    assert.equal(JSON.stringify(r.corps).includes('un-secret-reconnaissable'), false,
      'envoyer les valeurs avec la liste rendrait le journal des affichages mensonger');
  } finally { await i.fermer(); }
});

test('le code est bien chiffré en base', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { bienId } = await maison(i);
    await i.post(`/api/biens/${bienId}/coffre/codes`, {
      libelle: 'Wifi', valeur: 'goelands29', portee: 'membres', note: '',
    });
    const l = i.db.prepare('SELECT valeur_chiffree AS v FROM code_acces').get() as { v: Buffer };
    assert.equal(l.v.includes(Buffer.from('goelands29', 'utf8')), false,
      'une base volée ne doit rendre aucun code');
  } finally { await i.fermer(); }
});

test('sans clé de coffre, la création d\'un code est refusée avec la marche à suivre', async () => {
  const i = await demarrer({ cleCoffre: null });
  try {
    const { bienId } = await maison(i);
    const r = await i.post<{ message: string }>(`/api/biens/${bienId}/coffre/codes`, {
      libelle: 'Alarme', valeur: '4712', portee: 'membres', note: '',
    });
    assert.equal(r.statut, 422);
    assert.match(r.corps.message, /openssl rand -hex 32/);
    const etat = await i.get<{ coffreDisponible: boolean }>(`/api/biens/${bienId}/coffre`);
    assert.equal(etat.corps.coffreDisponible, false, "l'écran doit pouvoir le dire avant l'échec");
  } finally { await i.fermer(); }
});

test('un document déposé à nouveau ajoute une version, il n\'écrase pas', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { bienId } = await maison(i);
    const f1 = await i.post<{ id: string }>(`/api/biens/${bienId}/coffre/fichier`, {
      nom: 'a.pdf', contenu: Buffer.from('%PDF-1.4 version un').toString('base64'),
    });
    const f2 = await i.post<{ id: string }>(`/api/biens/${bienId}/coffre/fichier`, {
      nom: 'b.pdf', contenu: Buffer.from('%PDF-1.4 version deux').toString('base64'),
    });
    const doc = await i.post<{ id: number }>(`/api/biens/${bienId}/coffre/documents`, {
      nom: "Attestation d'assurance", portee: 'membres', fichierId: f1.corps.id, note: '2026',
    });
    const v = await i.post<{ version: number }>(
      `/api/biens/${bienId}/coffre/documents/${doc.corps.id}/version`,
      { fichierId: f2.corps.id, note: '2027' });
    assert.equal(v.corps.version, 2);

    const lu = await i.get<{ document: { version: number }; versions: unknown[] }>(
      `/api/biens/${bienId}/coffre/documents/${doc.corps.id}`);
    assert.equal(lu.corps.document.version, 2, 'la version courante est la dernière');
    assert.equal(lu.corps.versions.length, 2, "l'ancienne reste consultable");
  } finally { await i.fermer(); }
});

test('un signalement de casse crée la tâche et la ligne d\'inventaire', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { bienId } = await maison(i);
    i.deconnecte();
    await i.connexion('claire@exemple.fr', MOT_DE_PASSE);

    const r = await i.post<{ tacheId: number; inventaireId: number }>(`/api/biens/${bienId}/casse`, {
      libelle: 'le matelas de la chambre nord', detail: 'affaissé au milieu',
    });
    assert.equal(r.statut, 200, 'un membre de foyer doit pouvoir signaler une casse');

    const inv = await i.get<{ libelle: string; etat: string }[]>(`/api/biens/${bienId}/inventaire`);
    assert.equal(inv.corps[0].etat, 'À remplacer');

    const carnet = await i.get<{ ouvertes: { libelle: string; signaleParNom: string }[] }>(
      `/api/biens/${bienId}/entretien`);
    assert.match(carnet.corps.ouvertes[0].libelle, /Remplacer le matelas/);
    assert.equal(carnet.corps.ouvertes[0].signaleParNom, 'Claire Prudhomme');
  } finally { await i.fermer(); }
});

test('une récurrence engendre son échéance, et cocher demande la date', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { bienId } = await maison(i);
    await i.post(`/api/biens/${bienId}/recurrences`, {
      libelle: 'Ramonage de la cheminée', categorie: 'obligatoire',
      periodicite: 'annuelle', limiteMmjj: '10-15',
    });
    const carnet = await i.get<{ ouvertes: { id: number; libelle: string; echeance: string }[] }>(
      `/api/biens/${bienId}/entretien`);
    const ramonage = carnet.corps.ouvertes.find((t) => t.libelle.startsWith('Ramonage'));
    assert.ok(ramonage, 'la récurrence doit engendrer son occurrence tout de suite');
    assert.match(ramonage!.echeance, /-10-15$/);

    // Sans date de réalisation, on ne coche pas.
    const sansDate = await i.post(`/api/biens/${bienId}/taches/${ramonage!.id}/realisation`, {});
    assert.equal(sansDate.statut, 400);

    const futur = await i.post(`/api/biens/${bienId}/taches/${ramonage!.id}/realisation`,
      { faitLe: jourDecale(3) });
    assert.equal(futur.statut, 400, 'une tâche ne peut pas avoir été faite dans le futur');

    const ok = await i.post<{ statut: string; faitLe: string; faitParNom: string }>(
      `/api/biens/${bienId}/taches/${ramonage!.id}/realisation`,
      { faitLe: jourDecale(-30), coutCents: 12000 });
    assert.equal(ok.statut, 200);
    assert.equal(ok.corps.statut, 'faite');
    assert.equal(ok.corps.faitLe, jourDecale(-30), 'la date saisie, pas celle du jour');
    assert.equal(ok.corps.faitParNom, 'Hélène Prudhomme');
  } finally { await i.fermer(); }
});

test('l\'engendrement est idempotent', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { bienId } = await maison(i);
    await i.post(`/api/biens/${bienId}/recurrences`, {
      libelle: 'Contrôle chaudière', categorie: 'obligatoire', periodicite: 'annuelle', limiteMmjj: '06-01',
    });
    const compter = async (): Promise<number> =>
      (await i.get<{ ouvertes: unknown[] }>(`/api/biens/${bienId}/entretien`)).corps.ouvertes.length;
    const un = await compter();
    await compter();
    await compter();
    assert.equal(await compter(), un, 'relire le carnet ne doit pas empiler les occurrences');
  } finally { await i.fermer(); }
});

test('le carnet d\'adresses sert les membres, pas les invités', async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { bienId, structureId, claireId } = await maison(i);
    await i.post(`/api/biens/${bienId}/contacts`, {
      nom: 'Le Bihan, plombier', role: 'artisan', telephone: '02 98 00 00 00',
      email: '', notes: 'Connaît la chaudière depuis 2009',
    });

    i.deconnecte();
    await i.connexion('claire@exemple.fr', MOT_DE_PASSE);
    const vu = await i.get<{ contacts: { nom: string }[]; peutModifier: boolean }>(
      `/api/biens/${bienId}/contacts`);
    assert.equal(vu.statut, 200, 'le jour où la chaudière lâche, le plombier doit être trouvable');
    assert.equal(vu.corps.contacts[0].nom, 'Le Bihan, plombier');
    assert.equal(vu.corps.peutModifier, false, 'un membre de foyer lit, il ne modifie pas');

    const refuse = await i.post(`/api/biens/${bienId}/contacts`, {
      nom: 'X', role: 'autre', telephone: '', email: '', notes: '',
    });
    assert.equal(refuse.statut, 403);

    // Rétrogradé en invité, Claire ne voit plus le carnet.
    i.deconnecte();
    await i.connexion('helene@exemple.fr', MOT_DE_PASSE);
    await i.post(`/api/structures/${structureId}/roles/retrait`, { personneId: claireId, role: 'membre_foyer' });
    await i.post(`/api/structures/${structureId}/roles`, { personneId: claireId, role: 'invite' });
    i.deconnecte();
    await i.connexion('claire@exemple.fr', MOT_DE_PASSE);
    assert.equal((await i.get(`/api/biens/${bienId}/contacts`)).statut, 403);
  } finally { await i.fermer(); }
});

test('la checklist de départ part la veille, une seule fois', async () => {
  const i = await demarrer({ cleCoffre: CLE, publicUrl: 'https://maison.exemple.fr' });
  try {
    const { bienId, claireId } = await maison(i);
    for (const l of ["Compteur d'eau relevé et vanne fermée", 'Volets fermés côté mer']) {
      await i.post(`/api/biens/${bienId}/checklist`, { libelle: l });
    }
    // Un séjour qui finit demain, un autre qui finit dans une semaine.
    await sejour(i, bienId, claireId, jourDecale(-5), jourDecale(1));
    await sejour(i, bienId, claireId, jourDecale(20), jourDecale(27));

    const { envoyerChecklists } = await import('../src/entretien/routes');
    const { charger } = await import('../src/noyau/config');
    const config = { ...charger(), publicUrl: 'https://maison.exemple.fr' };

    assert.equal(envoyerChecklists(i.db, config), 1, 'seul le séjour qui finit demain est concerné');
    assert.equal(envoyerChecklists(i.db, config), 0, 'un deuxième passage ne renvoie rien');

    const n = i.db.prepare(
      "SELECT sujet, corps_texte AS texte FROM notification WHERE type = 'checklist_depart'",
    ).get() as { sujet: string; texte: string };
    assert.match(n.sujet, /Départ de Maison de Kerloc'h demain/);
    assert.match(n.texte, /Compteur d'eau relevé/,
      "le contenu doit être dans le courriel : on ferme la maison sans réseau au fond d'une vallée");
    assert.match(n.texte, /Volets fermés/);
  } finally { await i.fermer(); }
});

test("une récurrence n'invente pas d'échéance antérieure à sa création", async () => {
  const i = await demarrer({ cleCoffre: CLE });
  try {
    const { bienId } = await maison(i);
    // Une date limite déjà passée cette année : sans borne, la génération
    // remontait d'un an et posait une échéance « en retard » pour une période
    // où ni la récurrence ni l'application n'existaient.
    const hier = jourDecale(-1).slice(5);
    await i.post(`/api/biens/${bienId}/recurrences`, {
      libelle: 'Contrôle chaudière', categorie: 'obligatoire',
      periodicite: 'annuelle', limiteMmjj: hier,
    });
    const c = await i.get<{ ouvertes: { libelle: string; echeance: string; urgence: string }[] }>(
      `/api/biens/${bienId}/entretien`);
    const chaudiere = c.corps.ouvertes.filter((t) => t.libelle.startsWith('Contrôle'));
    assert.equal(chaudiere.length, 1, "une seule occurrence, pas celle de l'an dernier");
    assert.ok(chaudiere[0].echeance > jourDecale(0),
      `l'échéance doit être à venir, elle vaut ${chaudiere[0].echeance}`);
    assert.notEqual(chaudiere[0].urgence, 'en_retard',
      'un carnet qui s\'ouvre sur un manquement imaginaire fait douter de tous les autres');
  } finally { await i.fermer(); }
});
