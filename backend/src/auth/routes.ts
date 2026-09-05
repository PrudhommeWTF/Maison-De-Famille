// Les routes d'authentification.
//
// Le point délicat de cet écran est **l'absence d'énumération des comptes** : la
// réponse et le temps de réponse doivent être identiques que l'adresse existe ou
// non. Sans cela, un attaquant apprend en quelques minutes qui fait partie de la
// famille, ce qui est déjà une information, et il concentre ensuite ses essais.
//
// Deux précautions, et il faut les deux :
//
//   - le message d'échec ne distingue jamais « compte inconnu » de « mot de
//     passe faux » ;
//   - un compte inconnu déclenche quand même un calcul argon2 sur un condensat
//     factice, pour que la réponse mette le même temps.
import { Deps, Routeur, agentDe } from '../noyau/http';
import { ErreurApp, invalide } from '../noyau/erreurs';
import { horodatage } from '../noyau/dates';
import { empreinte, jetonLien } from '../noyau/ids';
import { log } from '../noyau/log';
import { lire } from '../noyau/valider';
import { SEUILS_ADRESSE, SEUILS_COMPTE, Temporisation } from './temporisation';
import { aRehacher, controlerPolitique, hacher, verifier } from './mots-de-passe';
import { ouvrirSession, renouveler, revoquer, revoquerTout, signer } from './jetons';
import {
  empreinteSecours, genererSecours, genererSecret, otpauthUri, secretLisible, verifierCode,
} from './totp';
import { porteeDe } from '../acces/repo';
import { estGerant } from '../acces/roles';
import { parametre } from '../parametres/repo';
import { deposer } from '../notifications/file';
import { motDePasseOublie } from '../notifications/gabarits';

const HEURES_REINIT = 4;

/**
 * Un condensat factice, calculé une fois au chargement. Il sert à faire perdre
 * à une tentative sur un compte inconnu exactement le même temps qu'une
 * tentative sur un compte réel.
 */
let condensatFactice: string | null = null;
async function factice(): Promise<string> {
  if (!condensatFactice) condensatFactice = await hacher('mot-de-passe-qui-nexiste-pas');
  return condensatFactice;
}

interface LigneCompte {
  id: number; nom: string; email: string; mot_de_passe_hash: string | null;
  token_version: number; archive_le: string | null;
  totp_secret: string | null; totp_recovery: string; totp_last_step: number;
}

const echecConnexion = (): ErreurApp =>
  new ErreurApp('NON_AUTHENTIFIE', 'Adresse de courriel ou mot de passe incorrect.');

const attenteEnMessage = (ms: number): ErreurApp => {
  const minutes = Math.ceil(ms / 60_000);
  return new ErreurApp('TROP_DE_TENTATIVES',
    `Trop de tentatives. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`);
};

export function routesAuth(deps: Deps): Routeur {
  const r = new Routeur('auth', deps);

  // Les compteurs appartiennent à l'instance, pas au module. En production cela
  // ne change rien (un processus sert une instance), mais un état de module
  // partagé se serait invité entre deux tests, et surtout entre deux instances
  // si le service en servait un jour plusieurs.
  const parCompte = new Temporisation(SEUILS_COMPTE);
  const parAdresse = new Temporisation(SEUILS_ADRESSE);

  r.post('/auth/connexion', { acces: 'public' }, async (ctx) => {
    const l = lire(ctx.corps);
    const email = l.texte('email', { max: 200 }).toLowerCase();
    const motDePasse = l.texte('motDePasse', { max: 200, min: 1 });
    l.fin();

    const now = Date.now();
    const attente = Math.max(parCompte.attente(email, now), parAdresse.attente(ctx.ip, now));
    if (attente > 0) throw attenteEnMessage(attente);

    const compte = ctx.db.prepare(`
      SELECT id, nom, email, mot_de_passe_hash, token_version, archive_le,
             totp_secret, totp_recovery, totp_last_step
      FROM personne WHERE email = ?
    `).get(email) as LigneCompte | undefined;

    const bon = compte && !compte.archive_le
      ? await verifier(motDePasse, compte.mot_de_passe_hash)
      : (await verifier(motDePasse, await factice()), false);

    if (!bon || !compte) {
      parCompte.echec(email, now);
      parAdresse.echec(ctx.ip, now);
      log.attention(`Échec de connexion pour ${email} depuis ${ctx.ip}.`);
      throw echecConnexion();
    }

    parCompte.reussite(email);
    parAdresse.reussite(ctx.ip);

    // La remise à niveau silencieuse : le seul instant où le mot de passe en
    // clair est disponible. Le parc se met à jour tout seul au fil des
    // connexions, sans que personne n'ait rien à faire.
    if (compte.mot_de_passe_hash && aRehacher(compte.mot_de_passe_hash)) {
      const neuf = await hacher(motDePasse);
      ctx.db.prepare('UPDATE personne SET mot_de_passe_hash = ? WHERE id = ?').run(neuf, compte.id);
      log.debug(`Condensat remis à niveau pour la personne ${compte.id}.`);
    }

    // Le second facteur, quand il est actif sur ce compte. Le mot de passe est
    // déjà vérifié à ce stade : dire que le code est attendu n'apprend rien de
    // plus à qui l'a saisi.
    let limite = false;
    if (compte.totp_secret) {
      const lc = lire(ctx.corps);
      const code = lc.texte('code', { max: 40, defaut: '' });
      lc.fin();
      if (!code) {
        throw new ErreurApp('SECOND_FACTEUR_REQUIS',
          'Saisissez le code à six chiffres de votre application d\'authentification.');
      }
      if (!consommerCode(ctx.db, compte, code)) {
        parCompte.echec(email, now);
        parAdresse.echec(ctx.ip, now);
        log.attention(`Second facteur refusé pour ${email} depuis ${ctx.ip}.`);
        throw new ErreurApp('SECOND_FACTEUR_REQUIS', 'Ce code n\'est pas valable.');
      }
    } else if (parametre<boolean>(ctx.db, 'totpObligatoirePourGerant')
      && estGerant(porteeDe(ctx.db, compte.id))) {
      // Elle entre, mais dans une session qui ne sait qu'une chose : activer le
      // second facteur. La refuser purement et simplement l'enfermerait dehors,
      // puisqu'on ne peut pas activer un second facteur sans se connecter.
      limite = true;
      log.attention(`Session limitée pour ${compte.nom} : second facteur obligatoire et non activé.`);
    }

    ctx.db.prepare('UPDATE personne SET derniere_connexion = ? WHERE id = ?').run(horodatage(), compte.id);
    const session = ouvrirSession(ctx.db, compte.id, agentDe(ctx.req), ctx.ip);
    log.info(`Connexion de ${compte.nom} (${compte.id})${limite ? ', session limitée' : ''}.`);
    return {
      acces: signer(ctx.config.jwtSecret, compte.id, compte.token_version, limite),
      renouvellement: session.jeton,
      expireLe: session.expireLe,
      secondFacteurAActiver: limite,
    };
  });

  // ---------- Second facteur ----------

  /**
   * Prépare un enrôlement : un secret est tiré et rangé à part, en attente. Il
   * ne protège rien tant que la personne n'a pas prouvé qu'elle lit bien les
   * codes, et il ne remplace donc jamais un second facteur déjà actif.
   */
  r.post('/auth/totp/preparation', { acces: 'authentifie' }, (ctx) => {
    const p = ctx.db.prepare('SELECT nom, email, totp_secret FROM personne WHERE id = ?')
      .get(ctx.personneId) as { nom: string; email: string | null; totp_secret: string | null };
    if (p.totp_secret) throw invalide('Le second facteur est déjà actif sur ce compte.');

    const secret = genererSecret();
    ctx.db.prepare('UPDATE personne SET totp_pending = ? WHERE id = ?').run(secret, ctx.personneId);
    return {
      // Le secret en clair ne sort qu'ici, une fois, pour être recopié dans
      // l'application d'authentification.
      uri: otpauthUri(secret, p.email ?? p.nom, parametre<string>(ctx.db, 'instanceNom')),
      secretLisible: secretLisible(secret),
    };
  });

  /**
   * Confirme l'enrôlement, et rend les codes de secours **une seule fois**.
   *
   * Un téléphone se perd, se casse, se réinitialise. Sans codes de secours, le
   * second facteur transforme chaque accident en « demander au gérant », et le
   * gérant qui perd le sien n'a plus personne à qui demander. En dernier recours,
   * il reste la commande d'administration dans le conteneur.
   */
  r.post('/auth/totp/activation', { acces: 'authentifie' }, (ctx) => {
    const l = lire(ctx.corps);
    const code = l.texte('code', { max: 40 });
    l.fin();
    const p = ctx.db.prepare('SELECT totp_pending, totp_secret FROM personne WHERE id = ?')
      .get(ctx.personneId) as { totp_pending: string | null; totp_secret: string | null };
    if (p.totp_secret) throw invalide('Le second facteur est déjà actif sur ce compte.');
    if (!p.totp_pending) throw invalide('Aucun enrôlement en cours. Recommencez depuis le début.');

    const pas = verifierCode(p.totp_pending, code, Date.now());
    if (pas === null) {
      throw invalide('Ce code n\'est pas valable. Vérifiez l\'heure de votre téléphone, puis réessayez.',
        { code: 'Code incorrect.' });
    }

    const secours = genererSecours();
    ctx.db.prepare(`
      UPDATE personne SET totp_secret = totp_pending, totp_pending = NULL,
        totp_recovery = ?, totp_last_step = ?, totp_active_le = ?
      WHERE id = ?
    `).run(JSON.stringify(secours.map(empreinteSecours)), pas, horodatage(), ctx.personneId);
    log.info(`Second facteur activé par la personne ${ctx.personneId}.`);

    // Les sessions ne sont **pas** révoquées, et c'est un choix.
    //
    // Le premier réflexe serait de tout déconnecter. Il produit exactement le
    // contraire de ce qu'on veut : le code qui vient de servir à l'activation
    // est consommé (protection contre le rejeu), donc la personne ne peut pas
    // se reconnecter avant que son application affiche le suivant. Trente
    // secondes d'écran d'erreur juste après avoir suivi une consigne de
    // sécurité, c'est la meilleure façon de faire désactiver la fonction.
    //
    // Rien ne le justifie par ailleurs : la personne vient de prouver son mot
    // de passe et son code. On lui rend simplement un jeton neuf, qui referme
    // au passage une éventuelle session limitée.
    const tv = (ctx.db.prepare('SELECT token_version FROM personne WHERE id = ?')
      .get(ctx.personneId) as { token_version: number }).token_version;
    return { secours, acces: signer(ctx.config.jwtSecret, ctx.personneId, tv) };
  });

  r.post('/auth/totp/desactivation', { acces: 'authentifie' }, async (ctx) => {
    const l = lire(ctx.corps);
    const motDePasse = l.texte('motDePasse', { max: 200, min: 1 });
    l.fin();
    const p = ctx.db.prepare('SELECT mot_de_passe_hash FROM personne WHERE id = ?')
      .get(ctx.personneId) as { mot_de_passe_hash: string | null };
    // Le mot de passe est redemandé : sans cela, un jeton volé suffirait à
    // retirer précisément la protection qui gênait.
    if (!await verifier(motDePasse, p.mot_de_passe_hash)) {
      throw invalide('Mot de passe incorrect.', { motDePasse: 'Mot de passe incorrect.' });
    }
    if (parametre<boolean>(ctx.db, 'totpObligatoirePourGerant') && estGerant(porteeDe(ctx.db, ctx.personneId))) {
      throw invalide('Le second facteur est obligatoire pour les gérants sur cette instance. '
        + 'Désactivez d\'abord le réglage, ou retirez-vous le rôle de gérant.');
    }
    ctx.db.prepare(`
      UPDATE personne SET totp_secret = NULL, totp_pending = NULL, totp_recovery = '[]',
        totp_last_step = 0, totp_active_le = NULL WHERE id = ?
    `).run(ctx.personneId);
    log.info(`Second facteur désactivé par la personne ${ctx.personneId}.`);
    return undefined;
  });

  r.post('/auth/renouveler', { acces: 'public' }, (ctx) => {
    const l = lire(ctx.corps);
    const jeton = l.texte('renouvellement', { max: 200 });
    l.fin();
    const { personneId, session } = renouveler(ctx.db, jeton, agentDe(ctx.req), ctx.ip);
    const p = ctx.db.prepare('SELECT token_version, archive_le FROM personne WHERE id = ?')
      .get(personneId) as { token_version: number; archive_le: string | null } | undefined;
    if (!p || p.archive_le) throw new ErreurApp('NON_AUTHENTIFIE', 'Ce compte n\'est plus actif.');
    return {
      acces: signer(ctx.config.jwtSecret, personneId, p.token_version),
      renouvellement: session.jeton,
      expireLe: session.expireLe,
    };
  });

  r.post('/auth/deconnexion', { acces: 'public' }, (ctx) => {
    const l = lire(ctx.corps);
    const jeton = l.texte('renouvellement', { max: 200, defaut: '' });
    l.fin();
    if (jeton) revoquer(ctx.db, jeton);
    return undefined;
  });

  /**
   * Mot de passe oublié. La réponse est **toujours** la même, que l'adresse
   * existe ou non : c'est ce qui empêche d'utiliser cet écran pour savoir qui a
   * un compte. Le cas est nominal, pas exceptionnel : une partie de la famille
   * se connecte trois fois par an.
   */
  r.post('/auth/mot-de-passe-oublie', { acces: 'public' }, (ctx) => {
    const l = lire(ctx.corps);
    const email = l.texte('email', { max: 200 }).toLowerCase();
    l.fin();
    const now = Date.now();
    // Une temporisation ici aussi : sans elle, cette route enverrait autant de
    // courriels qu'on le lui demande.
    if (parAdresse.attente(ctx.ip, now) > 0) throw attenteEnMessage(parAdresse.attente(ctx.ip, now));
    parAdresse.echec(ctx.ip, now);

    // Pas de filtre sur `mot_de_passe_hash` : un compte **jamais activé** doit
    // pouvoir obtenir un lien, sinon quelqu'un dont l'invitation a expiré reste
    // dehors sans comprendre pourquoi, et le gérant doit intervenir pour un cas
    // que la personne pouvait régler seule. Le filtre avait exactement cet
    // effet, et rendait le parcours d'invitation entier inopérant.
    const compte = ctx.db.prepare('SELECT id, nom FROM personne WHERE email = ? AND archive_le IS NULL')
      .get(email) as { id: number; nom: string } | undefined;

    if (compte) {
      const jeton = jetonLien();
      ctx.db.prepare('INSERT INTO reinit_mot_de_passe (personne_id, jeton_hash, cree_le, expire_le, adresse_ip) VALUES (?, ?, ?, ?, ?)')
        .run(compte.id, empreinte(jeton), horodatage(),
          new Date(Date.now() + HEURES_REINIT * 3_600_000).toISOString(), ctx.ip);
      deposer(ctx.db, {
        personneId: compte.id, type: 'mot_de_passe',
        message: motDePasseOublie({
          instance: parametre<string>(ctx.db, 'instanceNom'),
          urlBase: ctx.config.publicUrl ?? '', jeton, heures: HEURES_REINIT,
        }),
      });
      log.info(`Réinitialisation demandée pour la personne ${compte.id}.`);
    } else {
      log.debug(`Réinitialisation demandée pour une adresse inconnue depuis ${ctx.ip}.`);
    }
    return undefined;
  });

  r.post('/auth/mot-de-passe-reinitialiser', { acces: 'public' }, async (ctx) => {
    const l = lire(ctx.corps);
    const jeton = l.texte('jeton', { max: 200 });
    const motDePasse = l.texte('motDePasse', { max: 200, min: 1 });
    l.fin();
    controlerPolitique(motDePasse);

    const ligne = ctx.db.prepare('SELECT id, personne_id, expire_le, utilise_le FROM reinit_mot_de_passe WHERE jeton_hash = ?')
      .get(empreinte(jeton)) as { id: number; personne_id: number; expire_le: string; utilise_le: string | null } | undefined;
    if (!ligne || ligne.utilise_le || ligne.expire_le <= horodatage()) {
      throw invalide('Ce lien n\'est plus valable. Demandez-en un nouveau depuis l\'écran de connexion.');
    }

    const hash = await hacher(motDePasse);
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE reinit_mot_de_passe SET utilise_le = ? WHERE id = ?').run(horodatage(), ligne.id);
      // token_version invalide tous les jetons d'accès en circulation : si
      // quelqu'un s'était introduit, le changement de mot de passe le sort.
      ctx.db.prepare('UPDATE personne SET mot_de_passe_hash = ?, token_version = token_version + 1 WHERE id = ?')
        .run(hash, ligne.personne_id);
      revoquerTout(ctx.db, ligne.personne_id);
    })();
    log.info(`Mot de passe réinitialisé pour la personne ${ligne.personne_id}.`);
    return undefined;
  });

  r.post('/auth/mot-de-passe', { acces: 'authentifie' }, async (ctx) => {
    const l = lire(ctx.corps);
    const actuel = l.texte('actuel', { max: 200, min: 1 });
    const nouveau = l.texte('nouveau', { max: 200, min: 1 });
    l.fin();
    controlerPolitique(nouveau);

    const compte = ctx.db.prepare('SELECT mot_de_passe_hash FROM personne WHERE id = ?')
      .get(ctx.personneId) as { mot_de_passe_hash: string | null };
    if (!await verifier(actuel, compte.mot_de_passe_hash)) {
      throw invalide('Le mot de passe actuel est incorrect.', { actuel: 'Mot de passe incorrect.' });
    }

    const hash = await hacher(nouveau);
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE personne SET mot_de_passe_hash = ?, token_version = token_version + 1 WHERE id = ?')
        .run(hash, ctx.personneId);
      revoquerTout(ctx.db, ctx.personneId);
    })();
    log.info(`Mot de passe changé par la personne ${ctx.personneId}.`);
    return undefined;
  });

  return r;
}

/**
 * Vérifie un code de second facteur et le consomme.
 *
 * Deux formes acceptées : le code à six chiffres de l'application, et un code de
 * secours. Dans les deux cas, **le code consommé ne resert pas** : le pas validé
 * est enregistré pour refuser un rejeu, et un code de secours est retiré de la
 * liste. Sans cela, quelqu'un qui lit un code par-dessus une épaule a trente
 * secondes pour s'en servir à son tour.
 */
function consommerCode(db: Deps['db'], compte: LigneCompte, code: string): boolean {
  const pas = compte.totp_secret ? verifierCode(compte.totp_secret, code, Date.now()) : null;
  if (pas !== null) {
    if (pas <= compte.totp_last_step) return false;                 // déjà consommé
    db.prepare('UPDATE personne SET totp_last_step = ? WHERE id = ?').run(pas, compte.id);
    return true;
  }

  let secours: string[];
  try { secours = JSON.parse(compte.totp_recovery) as string[]; } catch { secours = []; }
  const empreinte = empreinteSecours(code);
  const reste = secours.filter((h) => h !== empreinte);
  if (reste.length === secours.length) return false;
  db.prepare('UPDATE personne SET totp_recovery = ? WHERE id = ?').run(JSON.stringify(reste), compte.id);
  log.attention(`Code de secours utilisé par la personne ${compte.id} : il en reste ${reste.length}.`);
  return true;
}
