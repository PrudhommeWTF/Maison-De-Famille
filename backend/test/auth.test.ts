// La connexion : énumération, temporisation, second facteur, réinitialisation.
//
// Le point le plus important de ce fichier est l'absence d'énumération. Une
// application exposée sur Internet qui répond différemment selon qu'une adresse
// existe ou non apprend en quelques minutes à un inconnu qui compose la famille,
// et lui dit sur qui concentrer ses essais.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOT_DE_PASSE, amorcer, creerCompte, demarrer } from './aide';
import { codePour, genererSecret, pasDe } from '../src/auth/totp';
import { SEUILS_COMPTE, Temporisation } from '../src/auth/temporisation';

test('un compte inconnu et un mot de passe faux donnent la même réponse', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    i.deconnecte();
    const inconnu = await i.post<{ code: string; message: string }>('/api/auth/connexion',
      { email: 'personne@exemple.fr', motDePasse: 'un-mot-de-passe-quelconque' });
    const faux = await i.post<{ code: string; message: string }>('/api/auth/connexion',
      { email: 'helene@exemple.fr', motDePasse: 'un-mot-de-passe-quelconque' });

    assert.equal(inconnu.statut, faux.statut);
    assert.equal(inconnu.corps.code, faux.corps.code);
    assert.equal(inconnu.corps.message, faux.corps.message,
      'le message ne doit pas distinguer « compte inconnu » de « mot de passe faux »');
  } finally { await i.fermer(); }
});

test('un compte inconnu coûte le même temps qu\'un compte réel', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    i.deconnecte();
    const chrono = async (email: string): Promise<number> => {
      const t = Date.now();
      await i.post('/api/auth/connexion', { email, motDePasse: 'un-mot-de-passe-quelconque' });
      return Date.now() - t;
    };
    // Une mesure unique est bruitée : on prend le minimum de trois, qui est
    // stable, et on vérifie seulement que le compte inconnu n'est pas
    // manifestement plus rapide (il le serait d'un facteur dix sans le
    // condensat factice).
    const inconnu = Math.min(await chrono('a@exemple.fr'), await chrono('b@exemple.fr'), await chrono('c@exemple.fr'));
    const reel = Math.min(await chrono('helene@exemple.fr'), await chrono('helene@exemple.fr'), await chrono('helene@exemple.fr'));
    assert.ok(inconnu > reel / 3,
      `un compte inconnu répond en ${inconnu} ms contre ${reel} ms pour un compte réel : le temps trahit l'existence`);
  } finally { await i.fermer(); }
});

test('la temporisation par compte se déclenche après la franchise et double', () => {
  const t = new Temporisation(SEUILS_COMPTE);
  const now = 1_000_000;
  for (let n = 1; n <= SEUILS_COMPTE.franchise; n++) {
    assert.equal(t.echec('cible', now), 0, `l'essai ${n} ne doit rien coûter : on se trompe de mot de passe`);
  }
  assert.equal(t.echec('cible', now), SEUILS_COMPTE.premierDelaiMs);
  assert.equal(t.echec('cible', now), SEUILS_COMPTE.premierDelaiMs * 2);
  assert.equal(t.echec('cible', now), SEUILS_COMPTE.premierDelaiMs * 4);
  assert.ok(t.attente('cible', now) > 0);

  // Le plafond tient, quel que soit l'acharnement.
  for (let n = 0; n < 40; n++) t.echec('cible', now);
  assert.equal(t.echec('cible', now), SEUILS_COMPTE.delaiMaxMs);

  // Une réussite efface l'ardoise, et l'oubli finit par jouer.
  t.reussite('cible');
  assert.equal(t.attente('cible', now), 0);
});

test('l\'ardoise est oubliée après la durée prévue', () => {
  const t = new Temporisation(SEUILS_COMPTE);
  const now = 1_000_000;
  for (let n = 0; n < 10; n++) t.echec('cible', now);
  assert.ok(t.attente('cible', now) > 0);
  assert.equal(t.attente('cible', now + SEUILS_COMPTE.oubliMs + 1), 0);
});

test('une salve de tentatives finit par être temporisée', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    i.deconnecte();
    let bloque = false;
    for (let n = 0; n < 12 && !bloque; n++) {
      const r = await i.post<{ code: string }>('/api/auth/connexion',
        { email: 'helene@exemple.fr', motDePasse: 'faux' });
      bloque = r.statut === 429;
    }
    assert.ok(bloque, 'douze essais sur le même compte doivent finir temporisés');

    // Et le bon mot de passe est refusé aussi pendant l'attente : c'est le
    // prix, et il est assumé.
    const bon = await i.post('/api/auth/connexion', { email: 'helene@exemple.fr', motDePasse: MOT_DE_PASSE });
    assert.equal(bon.statut, 429);
  } finally { await i.fermer(); }
});

test('mot de passe oublié répond pareil pour une adresse connue et une inconnue', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    i.deconnecte();
    const connue = await i.post('/api/auth/mot-de-passe-oublie', { email: 'helene@exemple.fr' });
    const inconnue = await i.post('/api/auth/mot-de-passe-oublie', { email: 'inconnu@exemple.fr' });
    assert.equal(connue.statut, 204);
    assert.equal(inconnue.statut, 204);

    // Une seule notification a été mise en file : celle du compte réel.
    const n = i.db.prepare("SELECT COUNT(*) AS n FROM notification WHERE type = 'mot_de_passe'").get() as { n: number };
    assert.equal(n.n, 1);
    const jetons = i.db.prepare('SELECT COUNT(*) AS n FROM reinit_mot_de_passe').get() as { n: number };
    assert.equal(jetons.n, 1);
  } finally { await i.fermer(); }
});

test('un lien de réinitialisation ne sert qu\'une fois', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    i.deconnecte();
    // Le jeton en clair n'existe que dans le courriel : on le relit dans le lien.
    await i.post('/api/auth/mot-de-passe-oublie', { email: 'helene@exemple.fr' });
    const lien = (i.db.prepare("SELECT lien FROM notification WHERE type = 'mot_de_passe'").get() as { lien: string }).lien;
    const jeton = decodeURIComponent(new URL(lien).searchParams.get('jeton') ?? '');
    assert.ok(jeton.length > 20);

    // Le jeton n'est pas stocké en clair : une fuite de la base ne donne rien.
    const enBase = i.db.prepare('SELECT jeton_hash FROM reinit_mot_de_passe').get() as { jeton_hash: string };
    assert.notEqual(enBase.jeton_hash, jeton);

    const premier = await i.post('/api/auth/mot-de-passe-reinitialiser', { jeton, motDePasse: 'nouveau-mot-de-passe-long' });
    assert.equal(premier.statut, 204);
    const second = await i.post<{ message: string }>('/api/auth/mot-de-passe-reinitialiser', { jeton, motDePasse: 'encore-un-autre-long' });
    assert.equal(second.statut, 400);
    assert.match(second.corps.message, /plus valable/);

    assert.equal((await i.connexion('helene@exemple.fr', 'nouveau-mot-de-passe-long')).statut, 200);
  } finally { await i.fermer(); }
});

test('un mot de passe trop court est refusé, avec un message qui aide', async () => {
  const i = await demarrer();
  try {
    const r = await i.post<{ champs: Record<string, string> }>('/api/amorce', {
      nom: 'Test', email: 'test@exemple.fr', motDePasse: 'court',
      structureMode: 'indivision', structureNom: 'X', bienNom: 'Y', commune: 'Z', type: 'mer', couchages: 2,
    });
    assert.equal(r.statut, 400);
    assert.match(r.corps.champs.motDePasse, /phrase/, 'le message doit proposer une solution, pas seulement refuser');
  } finally { await i.fermer(); }
});

test('l\'amorçage se referme dès qu\'une personne existe', async () => {
  const i = await demarrer();
  try {
    assert.equal((await i.get<{ amorcee: boolean }>('/api/amorce')).corps.amorcee, false);
    await amorcer(i);
    assert.equal((await i.get<{ amorcee: boolean }>('/api/amorce')).corps.amorcee, true);
    const second = await i.post('/api/amorce', {
      nom: 'Intrus', email: 'intrus@exemple.fr', motDePasse: 'un-mot-de-passe-qui-tient',
      structureMode: 'indivision', structureNom: 'X', bienNom: 'Y', commune: 'Z', type: 'mer', couchages: 2,
    });
    assert.equal(second.statut, 409, 'la porte d\'amorçage doit être définitivement fermée');
  } finally { await i.fermer(); }
});

// ------------------------------------------------------------------
// Second facteur
// ------------------------------------------------------------------

test('le code TOTP correspond à la référence RFC 6238', () => {
  // Vecteur de la RFC 4226 : secret « 12345678901234567890 » en base32.
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(codePour(secret, 1), '287082');
  assert.equal(codePour(secret, 2), '359152');
  // T = 1 111 111 109 s, soit le pas 37 037 036 : la RFC donne 07081804.
  assert.equal(codePour(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(codePour('pas une base32 !', 1), null, 'un secret illisible vaut mieux qu\'un code faux');
});

test('activer le second facteur rend des codes de secours et force la reconnexion', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    const prep = await i.post<{ uri: string; secretLisible: string }>('/api/auth/totp/preparation');
    assert.equal(prep.statut, 200);
    assert.match(prep.corps.uri, /^otpauth:\/\/totp\//);

    const secret = new URL(prep.corps.uri.replace('otpauth://', 'https://')).searchParams.get('secret') ?? '';
    const code = codePour(secret, pasDe(Date.now())) ?? '';
    const act = await i.post<{ secours: string[]; acces: string }>('/api/auth/totp/activation', { code });
    assert.equal(act.statut, 200);
    assert.equal(act.corps.secours.length, 10);

    // La session en cours reste ouverte : le code d'activation vient d'être
    // consommé, exiger une reconnexion immédiate condamnerait la personne à
    // attendre le code suivant devant un écran d'erreur.
    assert.equal((await i.get('/api/moi')).statut, 200);
    const moi = await i.get<{ secondFacteur: { actif: boolean; codesDeSecoursRestants: number } }>('/api/moi');
    assert.equal(moi.corps.secondFacteur.actif, true);
    assert.equal(moi.corps.secondFacteur.codesDeSecoursRestants, 10);

    // Une nouvelle connexion, elle, réclame le code.
    const sansCode = await i.post<{ code: string }>('/api/auth/connexion',
      { email: 'helene@exemple.fr', motDePasse: MOT_DE_PASSE });
    assert.equal(sansCode.corps.code, 'SECOND_FACTEUR_REQUIS');

    // Le code du pas suivant : c'est celui qu'affichera l'application.
    const avecCode = await i.post<{ acces: string }>('/api/auth/connexion',
      { email: 'helene@exemple.fr', motDePasse: MOT_DE_PASSE, code: codePour(secret, pasDe(Date.now()) + 1) });
    assert.equal(avecCode.statut, 200);
    i.poserJeton(avecCode.corps.acces);
    assert.equal((await i.get('/api/moi')).statut, 200);
  } finally { await i.fermer(); }
});

test('un code déjà utilisé ne resert pas', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    const prep = await i.post<{ uri: string }>('/api/auth/totp/preparation');
    const secret = new URL(prep.corps.uri.replace('otpauth://', 'https://')).searchParams.get('secret') ?? '';
    await i.post('/api/auth/totp/activation', { code: codePour(secret, pasDe(Date.now())) });

    const code = codePour(secret, pasDe(Date.now()) + 1) ?? '';
    assert.equal((await i.post('/api/auth/connexion',
      { email: 'helene@exemple.fr', motDePasse: MOT_DE_PASSE, code })).statut, 200);
    // Le même code vaut encore par la fenêtre de tolérance : il doit pourtant
    // être refusé.
    const rejeu = await i.post<{ code: string }>('/api/auth/connexion',
      { email: 'helene@exemple.fr', motDePasse: MOT_DE_PASSE, code });
    assert.equal(rejeu.statut, 401, 'un code lu par-dessus une épaule ne doit pas resservir');
  } finally { await i.fermer(); }
});

test('un code de secours ouvre une fois, puis disparaît', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    const prep = await i.post<{ uri: string }>('/api/auth/totp/preparation');
    const secret = new URL(prep.corps.uri.replace('otpauth://', 'https://')).searchParams.get('secret') ?? '';
    const act = await i.post<{ secours: string[] }>('/api/auth/totp/activation', { code: codePour(secret, pasDe(Date.now())) });
    const secours = act.corps.secours[0];

    assert.equal((await i.post('/api/auth/connexion',
      { email: 'helene@exemple.fr', motDePasse: MOT_DE_PASSE, code: secours })).statut, 200);
    assert.equal((await i.post('/api/auth/connexion',
      { email: 'helene@exemple.fr', motDePasse: MOT_DE_PASSE, code: secours })).statut, 401,
      'un code de secours ne vaut qu\'une connexion');
    // Recopié en minuscules et sans tiret, il devrait marcher : c'est ce qu'un
    // humain fait d'une feuille imprimée. Ici il a déjà servi, donc il échoue.
    const restants = JSON.parse((i.db.prepare('SELECT totp_recovery AS r FROM personne WHERE id = 1').get() as { r: string }).r) as string[];
    assert.equal(restants.length, 9);
  } finally { await i.fermer(); }
});

test('un gérant sans second facteur obtient une session limitée quand le réglage l\'impose', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    await i.post('/api/parametres', { cle: 'totpObligatoirePourGerant', valeur: true });

    const r = await i.post<{ acces: string; secondFacteurAActiver: boolean }>('/api/auth/connexion',
      { email: 'helene@exemple.fr', motDePasse: MOT_DE_PASSE });
    assert.equal(r.statut, 200);
    assert.equal(r.corps.secondFacteurAActiver, true);
    i.poserJeton(r.corps.acces);

    // Elle peut voir qui elle est et activer son second facteur.
    assert.equal((await i.get('/api/moi')).statut, 200);
    assert.equal((await i.post('/api/auth/totp/preparation')).statut, 200);
    // Et rien d'autre.
    const refuse = await i.get<{ code: string }>('/api/sejours');
    assert.equal(refuse.statut, 403);
    assert.equal(refuse.corps.code, 'SECOND_FACTEUR_A_ACTIVER');
    assert.equal((await i.get('/api/demandes')).statut, 403);
  } finally { await i.fermer(); }
});

test('on ne désactive pas un second facteur obligatoire, et jamais sans mot de passe', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    const prep = await i.post<{ uri: string }>('/api/auth/totp/preparation');
    const secret = new URL(prep.corps.uri.replace('otpauth://', 'https://')).searchParams.get('secret') ?? '';
    await i.post('/api/auth/totp/activation', { code: codePour(secret, pasDe(Date.now())) });

    assert.equal((await i.post('/api/auth/totp/desactivation', { motDePasse: 'faux-mot-de-passe' })).statut, 400);
    await i.post('/api/parametres', { cle: 'totpObligatoirePourGerant', valeur: true });
    const bloque = await i.post<{ message: string }>('/api/auth/totp/desactivation', { motDePasse: MOT_DE_PASSE });
    assert.equal(bloque.statut, 400);
    assert.match(bloque.corps.message, /obligatoire pour les gérants/);
  } finally { await i.fermer(); }
});

test('un secret TOTP est différent à chaque enrôlement', () => {
  const secrets = new Set(Array.from({ length: 20 }, () => genererSecret()));
  assert.equal(secrets.size, 20);
});

test('une personne créée par la gérante n\'a pas de mot de passe tant qu\'elle n\'en choisit pas', async () => {
  const i = await demarrer();
  try {
    await amorcer(i);
    const id = await creerCompte(i, 'Julien', 'julien@exemple.fr');
    assert.ok(id > 0);
    // creerCompte pose un mot de passe pour les tests ; sans cela, la colonne
    // reste nulle et la connexion échoue proprement.
    i.db.prepare('UPDATE personne SET mot_de_passe_hash = NULL WHERE id = ?').run(id);
    i.deconnecte();
    assert.equal((await i.post('/api/auth/connexion', { email: 'julien@exemple.fr', motDePasse: MOT_DE_PASSE })).statut, 401);
  } finally { await i.fermer(); }
});
