// Amorce une instance de démonstration réaliste, uniquement par l'API publique.
// Rien n'est écrit directement en base : ce que montrent les captures est donc
// exactement ce que produit l'application.
const BASE = (process.env.MDF_URL || 'http://127.0.0.1:8099') + '/api';
const MDP = 'un-mot-de-passe-qui-tient';

const jetons = {};
let moi = null;

async function appel(methode, chemin, corps, brut) {
  const entetes = {};
  if (moi && jetons[moi]) entetes.authorization = `Bearer ${jetons[moi]}`;
  if (corps !== undefined && !brut) entetes['content-type'] = 'application/json';
  const r = await fetch(BASE + chemin, {
    method: methode,
    headers: entetes,
    body: corps === undefined ? undefined : (brut ? corps : JSON.stringify(corps)),
  });
  const texte = await r.text();
  const json = texte ? JSON.parse(texte) : null;
  if (!r.ok) throw new Error(`${methode} ${chemin} → ${r.status} ${texte.slice(0, 300)}`);
  return json;
}

const get = (c) => appel('GET', c);
const post = (c, b) => appel('POST', c, b ?? {});
const patch = (c, b) => appel('PATCH', c, b);

async function connexion(email) {
  const r = await fetch(`${BASE}/auth/connexion`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, motDePasse: MDP }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`connexion ${email} → ${r.status} ${JSON.stringify(j)}`);
  jetons[email] = j.acces;
  moi = email;
  return j;
}

const jour = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/** Crée un compte et lui donne un mot de passe, par le vrai parcours d'invitation. */
async function compte(nom, email, foyerId) {
  const p = await post('/personnes', { nom, email, foyerId: foyerId ?? null });
  const inv = await post(`/personnes/${p.id}/invitation`, { afficherLien: true });
  const jeton = new URL(inv.lien).searchParams.get('jeton');
  await fetch(`${BASE}/auth/mot-de-passe-reinitialiser`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jeton, motDePasse: MDP }),
  }).then(async (r) => { if (!r.ok) throw new Error(`mot de passe ${email} : ${await r.text()}`); });
  return p.id;
}

(async () => {
  // ---- Amorçage : Hélène, gérante de l'indivision de Kerloc'h ----
  const amorce = await appel('POST', '/amorce', {
    nom: 'Hélène Prudhomme', email: 'helene@exemple.fr', motDePasse: MDP,
    foyerNom: 'Hélène et Marc', structureMode: 'indivision', structureNom: "Indivision Kerloc'h",
    bienNom: "Maison de Kerloc'h", commune: 'Crozon', type: 'mer', couchages: 8,
  });
  await connexion('helene@exemple.fr');
  const { structureId: kerloch, bienId: maison } = amorce;
  const foyerHelene = (await get('/foyers')).find((f) => f.nom.startsWith('Hélène'))?.id ?? null;

  // ---- Les personnes ----
  const marc = await compte('Marc Prudhomme', 'marc@exemple.fr', foyerHelene);
  const foyerClaire = (await post('/foyers', { nom: 'Claire et Paul' })).id;
  const claire = await compte('Claire Prudhomme', 'claire@exemple.fr', foyerClaire);
  const paul = await compte('Paul Vasseur', 'paul@exemple.fr', foyerClaire);
  const julien = await compte('Julien Prudhomme', 'julien@exemple.fr', null);

  await connexion('helene@exemple.fr');
  await post(`/structures/${kerloch}/roles`, { personneId: marc, role: 'gerant' });

  // ---- La détention, historisée ----
  await post(`/structures/${kerloch}/detentions`, {
    dateEffet: '2019-06-01', motif: 'Succession de Robert Prudhomme',
    parts: [{ personneId: 1, parts: 1 }, { personneId: claire, parts: 1 }, { personneId: julien, parts: 1 }],
  });

  // ---- Un second bien, dans une autre structure : Claire n'y a aucun droit ----
  const chamonix = await post('/biens', {
    structureMode: 'sci', structureNom: 'SCI des Aiguilles',
    nom: 'Appartement de Chamonix', commune: 'Chamonix', type: 'montagne', couchages: 4,
  });

  // ---- Les séjours ----
  await connexion('helene@exemple.fr');
  const sejours = [
    { titre: 'Hélène et Marc', arrivee: jour(-40), depart: jour(-33), occupants: 4, nature: 'famille' },
    { titre: 'Claire et Paul', arrivee: jour(-12), depart: jour(-5), occupants: 2, nature: 'famille', demandeurId: claire },
    { titre: 'Julien', arrivee: jour(8), depart: jour(15), occupants: 3, nature: 'famille', demandeurId: julien },
    { titre: 'Ramonage et volets', arrivee: jour(30), depart: jour(32), occupants: 2, nature: 'entretien' },
  ];
  for (const s of sejours) await post(`/biens/${maison}/sejours`, { note: '', ...s });

  // Une demande en attente, posée par Claire : la gérante devra l'arbitrer.
  await connexion('claire@exemple.fr');
  await post(`/biens/${maison}/sejours`, {
    titre: 'Claire et Paul', arrivee: jour(45), depart: jour(52), occupants: 2, nature: 'famille',
    note: 'Si possible, la semaine avant la rentrée.',
  });
  // Et une seconde qui chevauche celle de Julien : de quoi montrer un conflit.
  await post(`/biens/${maison}/sejours`, {
    titre: 'Claire, Paul et les cousins', arrivee: jour(10), depart: jour(17), occupants: 5, nature: 'famille',
    note: 'Nous pouvons décaler si Julien tient à ces dates.',
  });

  // ---- L'argent ----
  await connexion('helene@exemple.fr');
  const categories = await get('/categories');
  const cat = (code) => categories.find((c) => c.code === code)?.id ?? categories[0].id;
  const depenses = [
    { dateDepense: jour(-200), libelle: 'Taxe foncière 2026', code: 'taxe', montantCents: 234000, payePar: 'structure' },
    { dateDepense: jour(-120), libelle: 'Assurance multirisque habitation', code: 'assurance', montantCents: 112800, payePar: 'structure' },
    { dateDepense: jour(-60), libelle: 'Ramonage de la cheminée', code: 'entretien', montantCents: 14500, payePar: 'personne', avanceParId: claire },
    { dateDepense: jour(-25), libelle: 'Remplacement du chauffe-eau', code: 'travaux', montantCents: 89000, payePar: 'personne', avanceParId: 1 },
    { dateDepense: jour(-10), libelle: 'Bois de chauffage, 3 stères', code: 'entretien', montantCents: 27000, payePar: 'personne', avanceParId: julien },
  ];
  for (const d of depenses) {
    await post(`/structures/${kerloch}/depenses`, {
      dateDepense: d.dateDepense, libelle: d.libelle, categorieId: cat(d.code),
      montantCents: d.montantCents, payePar: d.payePar,
      ...(d.avanceParId ? { avanceParId: d.avanceParId } : {}),
      biens: [{ bienId: maison, poidsNum: 1, poidsDen: 1 }],
    });
  }

  // ---- La maison : entretien, fiche, contacts, inventaire ----
  const taches = [
    { libelle: 'Ramoner la cheminée', categorie: 'obligatoire', echeance: jour(-58), detail: 'Certificat exigé par l\'assurance' },
    { libelle: 'Vérifier la chaudière', categorie: 'obligatoire', echeance: jour(20), detail: '' },
    { libelle: 'Rentrer le mobilier de jardin', categorie: 'saison', echeance: jour(70), detail: '' },
    { libelle: 'Purger les radiateurs', categorie: 'courant', echeance: jour(-3), detail: '' },
  ];
  const cree = [];
  for (const t of taches) cree.push(await post(`/biens/${maison}/taches`, t));
  await post(`/biens/${maison}/taches/${cree[0].id}/realisation`, { faitLe: jour(-58), note: 'Le Bihan, 145 €' })
    .catch((e) => console.log('réalisation :', e.message.slice(0, 160)));

  await post(`/biens/${maison}/recurrences`, {
    libelle: 'Ramonage de la cheminée', categorie: 'obligatoire', periodicite: 'annuelle', limiteMmjj: '10-15',
  }).catch((e) => console.log('récurrence :', e.message.slice(0, 160)));
  await post(`/biens/${maison}/recurrences`, {
    libelle: 'Entretien du jardin', categorie: 'saison', periodicite: 'mensuelle', moisDebut: 4, moisFin: 10,
  }).catch((e) => console.log('récurrence :', e.message.slice(0, 160)));
  await post(`/biens/${maison}/recurrences`, {
    libelle: 'Relever les compteurs', categorie: 'courant', periodicite: 'sejour',
  }).catch((e) => console.log('récurrence :', e.message.slice(0, 160)));

  for (const l of [
    { section: 'guide', cle: 'Vanne générale d\'eau', valeur: 'sous l\'escalier, à droite du compteur', ordre: 1 },
    { section: 'guide', cle: 'Disjoncteur', valeur: 'entrée, derrière la porte', ordre: 2 },
    { section: 'guide', cle: 'Poubelles', valeur: 'ramassage le mardi matin, bacs au bout du chemin', ordre: 3 },
    { section: 'guide', cle: 'Stationnement', valeur: 'deux places devant, la troisième est au voisin', ordre: 4 },
    { section: 'caracteristique', cle: 'Surface', valeur: '145 m² sur 1 200 m² de terrain', ordre: 1 },
    { section: 'caracteristique', cle: 'Chauffage', valeur: 'Chaudière fioul, cheminée insert', ordre: 2 },
  ]) await post(`/biens/${maison}/fiche`, l).catch((e) => console.log('fiche :', e.message.slice(0, 140)));

  for (const c of [
    { nom: 'Le Bihan, ramoneur et chauffagiste', role: 'artisan', telephone: '02 98 00 00 00', notes: 'Intervient sous 48 h' },
    { nom: 'Mme Kervella', role: 'voisin', telephone: '02 98 11 11 11', notes: 'Maison bleue en face, garde un jeu de clés' },
    { nom: 'Plomberie de la Presqu\'île', role: 'artisan', telephone: '02 98 22 22 22', notes: '' },
    { nom: 'Mairie de Crozon', role: 'mairie', telephone: '02 98 33 33 33', notes: 'Ordures et encombrants' },
  ]) await post(`/biens/${maison}/contacts`, { email: '', ...c }).catch((e) => console.log('contact :', e.message.slice(0, 140)));

  for (const l of [
    { libelle: 'Lave-vaisselle Bosch (2021)', etat: 'Bon état' },
    { libelle: 'Matelas de la chambre nord', etat: 'À remplacer' },
    { libelle: 'Tondeuse thermique', etat: 'Bon état' },
    { libelle: 'Salon de jardin en teck', etat: 'Usé mais utilisable' },
  ]) await post(`/biens/${maison}/inventaire`, l).catch((e) => console.log('inventaire :', e.message.slice(0, 140)));

  for (const l of ['Fermer les volets', 'Vider le réfrigérateur', 'Relever le compteur d\'eau', 'Sortir les poubelles']) {
    await post(`/biens/${maison}/checklist`, { libelle: l }).catch((e) => console.log('checklist :', e.message.slice(0, 140)));
  }

  // ---- Le coffre-fort ----
  for (const c of [
    { libelle: 'Portail du chemin', valeur: '1840B', portee: 'sejour', note: 'Étoile après le code' },
    { libelle: 'Boîte à clés', valeur: '2059', portee: 'sejour', note: 'À gauche de la porte' },
    { libelle: 'Wifi', valeur: 'goelands29', portee: 'membres', note: 'Réseau « Kerloch »' },
    { libelle: 'Alarme', valeur: '7714', portee: 'detenteur', note: '' },
  ]) await post(`/biens/${maison}/coffre/codes`, c).catch((e) => console.log('code refusé :', e.message.slice(0, 120)));

  // ---- Décisions ----
  const { regles } = await get(`/structures/${kerloch}/decisions`);
  if (regles && regles.length) {
    await post(`/structures/${kerloch}/decisions`, {
      regleId: regles[0].id, titre: 'Remplacer la chaudière',
      expose: 'Devis Le Bihan : 4 800 €. La chaudière actuelle a 22 ans et le ramoneur signale un rendement en baisse.',
      montantCents: 480000, clotureLe: jour(18),
    }).then(async (s) => {
      await connexion('claire@exemple.fr');
      await post(`/scrutins/${s.id}/voix`, { sens: 'pour' });
      await connexion('helene@exemple.fr');
      await post(`/scrutins/${s.id}/voix`, { sens: 'pour' });
    }).catch((e) => console.log('scrutin refusé :', e.message.slice(0, 160)));
  }

  // ---- Le coffre-fort : un document, déposé comme depuis l'écran ----
  await connexion('helene@exemple.fr');
  const pdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
    + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
    + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n'
    + 'trailer<</Root 1 0 R>>\n%%EOF\n', 'utf8');
  for (const d of [
    { nom: "Convention d'indivision", portee: 'detenteur', note: 'Signée le 14 mars 2019' },
    { nom: "Attestation d'assurance", portee: 'membres', note: 'Valable jusqu\'au 31 décembre' },
    { nom: 'Notice de la chaudière', portee: 'sejour', note: '' },
  ]) {
    try {
      const f = await appel('POST', `/biens/${maison}/coffre/fichier?nom=${encodeURIComponent(d.nom)}.pdf`, pdf, true);
      await post(`/biens/${maison}/coffre/documents`, { nom: d.nom, portee: d.portee, fichierId: f.id, note: d.note });
    } catch (e) { console.log('document :', e.message.slice(0, 160)); }
  }

  // ---- Location saisonnière ----
  await connexion('helene@exemple.fr');
  await patch(`/biens/${maison}`, { locationActivee: true })
    .catch((e) => console.log('activation location :', e.message.slice(0, 200)));
  await post(`/biens/${maison}/location/reservations`, {
    locataire: 'Famille Berger', email: 'berger@exemple.fr', telephone: '06 00 00 00 00',
    arrivee: jour(60), depart: jour(67), occupants: 6, loyerCents: 84000, acompteCents: 25000, note: '',
  }).catch((e) => console.log('réservation :', e.message.slice(0, 160)));

  // Une seconde réservation, qui commence demain : c'est elle qui permet de
  // montrer un coffre où le code est visible, l'autre montrant qu'il ne l'est
  // pas encore deux mois à l'avance.
  await post(`/biens/${maison}/location/reservations`, {
    locataire: 'Famille Morel', email: 'morel@exemple.fr', telephone: '06 11 11 11 11',
    arrivee: jour(1), depart: jour(8), occupants: 4, loyerCents: 76000, acompteCents: 76000, note: '',
  }).catch((e) => console.log('réservation proche :', e.message.slice(0, 160)));

  // ---- Un accès par lien, pour les locataires de l'été ----
  const reservations = await get(`/biens/${maison}/location`).catch(() => null);
  const sejourLoc = reservations?.reservations?.[0]?.sejourId ?? null;
  const acces = await post(`/biens/${maison}/acces`, {
    libelle: 'Famille Berger, séjour du mois prochain', email: 'berger@exemple.fr',
    sejourId: sejourLoc, expireLe: jour(70),
  }).catch((e) => { console.log('accès :', e.message.slice(0, 200)); return null; });

  const proche = (await get(`/biens/${maison}/location`).catch(() => null))?.reservations
    ?.find((r) => r.locataire === 'Famille Morel');
  const accesProche = proche ? await post(`/biens/${maison}/acces`, {
    libelle: 'Famille Morel, séjour de la semaine', email: 'morel@exemple.fr',
    sejourId: proche.sejourId, expireLe: jour(9),
  }).catch((e) => { console.log('accès proche :', e.message.slice(0, 200)); return null; }) : null;

  console.log(JSON.stringify({ lienLointain: acces?.lien ?? null, lienProche: accesProche?.lien ?? null }));
  console.log(JSON.stringify({ kerloch, maison, chamonix: chamonix.bienId ?? chamonix, marc, claire, paul, julien }, null, 2));
})().catch((e) => { console.error('ECHEC', e.message); process.exit(1); });
