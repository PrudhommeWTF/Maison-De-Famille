// Les notifications par courriel.
//
// Le point qui compte : **une panne du relais ne perd rien**. Une notification
// est écrite en base avant d'être envoyée, réessayée avec un recul croissant, et
// si elle finit par être abandonnée elle reste visible avec le message exact du
// relais. « Personne n'a reçu le courriel et on ne sait pas pourquoi » est
// exactement ce qu'on veut éviter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amorcer, demarrer } from './aide';
import { Envoyeur, depiler } from '../src/notifications/envoi';
import { accepte, deposer, etat, marquerEchec, prochaines } from '../src/notifications/file';
import { dateLisible, demandeDecidee, demandeNouvelle, plage } from '../src/notifications/gabarits';
import { poser } from '../src/parametres/repo';

const CTX = {
  instance: 'Maison de Famille', urlBase: 'https://maison.test',
  demandeur: 'Julien Prudhomme', bien: "Maison de Kerloc'h",
  arrivee: '2026-08-08', depart: '2026-08-16', nuits: 8, occupants: 4,
  note: 'Pour rejoindre les cousins', conflits: [] as string[],
};

test('les dates sont écrites en français, pas en ISO', () => {
  assert.equal(dateLisible('2026-08-08'), '8 août 2026');
  assert.equal(dateLisible('2026-01-01'), '1 janvier 2026');
  assert.equal(plage('2026-08-08', '2026-08-16'), 'du 8 août 2026 au 16 août 2026');
});

test('un courriel de demande dit l\'essentiel et porte un lien absolu', () => {
  const m = demandeNouvelle(CTX);
  assert.match(m.sujet, /Julien Prudhomme/);
  assert.match(m.sujet, /Kerloc'h/);
  assert.match(m.texte, /8 août 2026/);
  assert.match(m.texte, /8 nuits, 4 personnes/);
  assert.ok(m.lien.startsWith('https://maison.test/'), 'un lien relatif serait inutilisable dans un courriel');
  assert.ok(m.html.includes(m.lien));
  // Aucune image, aucune police distante : rien ne doit signaler la lecture.
  assert.ok(!/<img|fonts\.googleapis|https?:\/\/(?!maison\.test)/.test(m.html));
});

test('un conflit apparaît dans le courriel de la gérante', () => {
  const m = demandeNouvelle({ ...CTX, conflits: ['Chevauche la location « Berger ».'] });
  assert.match(m.texte, /Attention/);
  assert.match(m.html, /Berger/);
});

test('le contenu injecté par un utilisateur est échappé dans le HTML', () => {
  // Le titre d'un séjour est saisi par la famille : il ne doit pas pouvoir
  // écrire du balisage dans le courriel de quelqu'un d'autre.
  const m = demandeNouvelle({ ...CTX, demandeur: '<script>alert(1)</script>' });
  assert.ok(!m.html.includes('<script>'));
  assert.ok(m.html.includes('&lt;script&gt;'));
});

test('la décision distingue la validation du renvoi', () => {
  const base = { instance: 'X', urlBase: 'https://maison.test', bien: 'Kerloc\'h', arrivee: '2026-08-08', depart: '2026-08-16', parQui: 'Hélène', note: '' };
  assert.match(demandeDecidee({ ...base, validee: true }).sujet, /Séjour validé/);
  assert.match(demandeDecidee({ ...base, validee: false }).sujet, /Dates à revoir/);
  assert.match(demandeDecidee({ ...base, validee: false }).html, /Proposer d'autres dates/);
});

test('une personne sans adresse de courriel ne met rien en file', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    i.db.prepare('UPDATE personne SET email = NULL WHERE id = 1').run();
    const mis = deposer(i.db, { personneId: 1, type: 'demande_nouvelle', message: demandeNouvelle(CTX) });
    assert.equal(mis, false);
    assert.equal(prochaines(i.db).length, 0);
  } finally { await i.fermer(); }
});

test('chacun coupe le type de message qu\'il veut, sauf la réinitialisation', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    assert.equal(accepte(i.db, 1, 'demande_nouvelle'), true, 'actif par défaut');
    i.db.prepare("INSERT INTO notification_pref (personne_id, type, actif) VALUES (1, 'demande_nouvelle', 0)").run();
    assert.equal(accepte(i.db, 1, 'demande_nouvelle'), false);
    assert.equal(deposer(i.db, { personneId: 1, type: 'demande_nouvelle', message: demandeNouvelle(CTX) }), false);

    // La réinitialisation de mot de passe ne se coupe pas : la couper
    // reviendrait à s'enfermer dehors.
    i.db.prepare("INSERT INTO notification_pref (personne_id, type, actif) VALUES (1, 'mot_de_passe', 0)").run();
    assert.equal(accepte(i.db, 1, 'mot_de_passe'), true);
  } finally { await i.fermer(); }
});

test('un relais en panne ne perd rien et réessaie plus tard', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    const t0 = new Date('2026-09-05T10:00:00Z');
    deposer(i.db, { personneId: 1, type: 'demande_nouvelle', message: demandeNouvelle(CTX) }, t0);

    const enPanne: Envoyeur = async () => { throw new Error('550 5.7.1 Relay access denied'); };
    const premier = await depiler(i.db, enPanne, t0);
    assert.deepEqual(premier, { envoyes: 0, echecs: 1 });

    const ligne = i.db.prepare('SELECT tentatives, prochaine_tentative AS suivante, derniere_erreur AS erreur, envoye_le AS envoye FROM notification WHERE id = 1')
      .get() as { tentatives: number; suivante: string; erreur: string; envoye: string | null };
    assert.equal(ligne.tentatives, 1);
    assert.equal(ligne.envoye, null, 'rien ne doit être perdu');
    assert.match(ligne.erreur, /Relay access denied/, 'le message du relais est ce qui permet de corriger');
    assert.equal(ligne.suivante, '2026-09-05T10:01:00.000Z', 'une minute avant le prochain essai');

    // Trop tôt : rien ne repart.
    assert.equal((await depiler(i.db, enPanne, new Date('2026-09-05T10:00:30Z'))).echecs, 0);
    // L'attente double.
    await depiler(i.db, enPanne, new Date('2026-09-05T10:01:00Z'));
    const apres = i.db.prepare('SELECT prochaine_tentative AS s FROM notification WHERE id = 1').get() as { s: string };
    assert.equal(apres.s, '2026-09-05T10:03:00.000Z');

    // Puis le relais revient.
    const partis: string[] = [];
    const marche: Envoyeur = async (dest) => { partis.push(dest); };
    const bilan = await depiler(i.db, marche, new Date('2026-09-05T11:00:00Z'));
    assert.deepEqual(bilan, { envoyes: 1, echecs: 0 });
    assert.deepEqual(partis, ['helene@exemple.fr']);
    assert.equal(prochaines(i.db, 20, new Date('2026-09-05T12:00:00Z')).length, 0);
  } finally { await i.fermer(); }
});

test('une notification abandonnée reste visible avec son erreur', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    deposer(i.db, { personneId: 1, type: 'demande_nouvelle', message: demandeNouvelle(CTX) });
    for (let n = 0; n < 5; n++) marquerEchec(i.db, 1, 'connexion refusée', 5);

    const e = etat(i.db);
    assert.equal(e.enAttente, 0);
    assert.equal(e.abandonnees, 1);
    assert.equal(e.dernieresErreurs[0].erreur, 'connexion refusée');
    assert.equal(prochaines(i.db).length, 0, 'une notification abandonnée ne repart pas toute seule');
  } finally { await i.fermer(); }
});

test('l\'interrupteur général arrête les envois sans rien perdre', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    deposer(i.db, { personneId: 1, type: 'demande_nouvelle', message: demandeNouvelle(CTX) });
    poser(i.db, 'notificationsActives', false, {}, 1);

    let appels = 0;
    await depiler(i.db, async () => { appels++; });
    assert.equal(appels, 0, 'utile pendant une reprise de données, pour ne pas inonder la famille');
    assert.equal(etat(i.db).enAttente, 1, 'la file est conservée telle quelle');

    poser(i.db, 'notificationsActives', true, {}, 1);
    await depiler(i.db, async () => { appels++; });
    assert.equal(appels, 1);
  } finally { await i.fermer(); }
});

test('l\'écran d\'état dit si un relais est configuré', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    const e = await i.get<{ courriel: { relais: string | null; file: { enAttente: number } } }>('/api/etat');
    assert.equal(e.statut, 200);
    assert.equal(e.corps.courriel.relais, null, 'sans relais, les notifications s\'accumulent : il faut le voir');
  } finally { await i.fermer(); }
});
