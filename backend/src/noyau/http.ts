// La couche HTTP : déclaration des routes, gardes, enveloppe de réponse.
//
// **Aucune route ne s'écrit sans déclarer ce qu'elle exige.** C'est le point
// central de la sécurité de cette application : une route s'ajoute par
// `routeur.get(chemin, exigence, gestionnaire)`, jamais par un `router.get` nu.
// L'exigence est appliquée avant que le gestionnaire ne s'exécute, et elle est
// enregistrée dans un registre que la CI parcourt (voir test/portee.test.ts) :
//
//   - une route qui porte `:bienId` sans exiger une portée de bien échoue ;
//   - une route publique qui n'est pas dans la liste explicitement autorisée
//     échoue.
//
// Autrement dit, oublier une garde ne compile pas dans les faits : ça casse la
// CI, pas la production.
import express, { NextFunction, Request, Response, Router } from 'express';
import type { Db } from './db';
import type { Config } from './config';
import { ErreurApp } from './erreurs';
import { log } from './log';
import { Portee, Role, auMoins, estGerant } from '../acces/roles';
import { porteeDe } from '../acces/repo';
import { verifierAcces } from '../auth/jetons';

export type Exigence =
  /** Personne n'est connecté : connexion, mot de passe oublié, santé. */
  | { acces: 'public' }
  /** Un compte valide suffit. */
  | { acces: 'authentifie' }
  /** Gérant d'au moins une structure : créer une structure, un bien, une personne. */
  | { acces: 'gerant' }
  /** Rôle minimal sur le bien désigné par le paramètre d'URL (`bienId` par défaut). */
  | { acces: 'bien'; role: Role; param?: string }
  /** Rôle minimal sur la structure désignée (`structureId` par défaut). */
  | { acces: 'structure'; role: Role; param?: string };

export interface Contexte {
  db: Db;
  config: Config;
  req: Request;
  res: Response;
  /** Zéro sur une route publique. */
  personneId: number;
  /** Session limitée : second facteur obligatoire et pas encore activé. */
  limite: boolean;
  portee: Portee;
  /** Renseigné quand l'exigence porte sur un bien. */
  bienId: number;
  /** Renseigné quand l'exigence porte sur une structure. */
  structureId: number;
  corps: unknown;
  ip: string;
}

export type Gestionnaire = (ctx: Contexte) => unknown | Promise<unknown>;

export interface RouteDeclaree {
  module: string;
  methode: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  chemin: string;
  exigence: Exigence;
}

/** Le registre complet, rempli à la construction des routeurs. Lu par la CI. */
export const ROUTES: RouteDeclaree[] = [];

/**
 * Les seules routes publiques admises. Toute autre route publique fait échouer
 * la CI : c'est une liste qu'on relit, pas une case qu'on coche.
 */
export const PUBLIQUES_AUTORISEES: readonly string[] = [
  'POST /api/auth/connexion',
  'POST /api/auth/renouveler',
  'POST /api/auth/deconnexion',
  'POST /api/auth/mot-de-passe-oublie',
  // L'entrée par un lien d'invité : c'est le jeton qui authentifie, il n'y a
  // pas de compte à connecter. Le lien porte sa propre expiration, et le rôle
  // qu'il ouvre porte la sienne.
  'POST /api/auth/lien',
  'POST /api/auth/mot-de-passe-reinitialiser',
  'GET /api/sante',
  // L'amorçage : une instance vide n'a aucun compte, donc personne ne peut se
  // connecter pour en créer un. Ces deux routes se ferment définitivement dès
  // qu'une personne existe (voir acces/routes.ts), ce qui est vérifié par un test.
  'GET /api/amorce',
  'POST /api/amorce',
];

const ipDe = (req: Request): string =>
  (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');

const jetonDe = (req: Request): string | null => {
  const h = req.headers.authorization;
  return h && h.startsWith('Bearer ') ? h.slice(7).trim() : null;
};

/** Le portrait d'un appelant, pour les journaux. Jamais le jeton. */
export const agentDe = (req: Request): string => String(req.headers['user-agent'] || '').slice(0, 200);

interface LignePersonne { id: number; token_version: number; archive_le: string | null }

/**
 * Ce qu'une session limitée a le droit de faire : voir qui elle est, activer son
 * second facteur, changer son mot de passe, se déconnecter. Rien d'autre.
 *
 * La liste est ici, à côté de la garde qui l'applique, et non dans le module
 * d'authentification : c'est la garde qui décide, et une liste éloignée de son
 * point d'application est une liste qu'on oublie de tenir à jour.
 */
const ROUTES_SESSION_LIMITEE: readonly string[] = [
  'GET /moi',
  'POST /auth/totp/preparation',
  'POST /auth/totp/activation',
  'POST /auth/mot-de-passe',
];

function authentifier(db: Db, config: Config, req: Request): { personneId: number; limite: boolean } {
  const jeton = jetonDe(req);
  if (!jeton) throw new ErreurApp('NON_AUTHENTIFIE', 'Connectez-vous pour accéder à cette page.');
  const charge = verifierAcces(config.jwtSecret, jeton);
  const p = db.prepare('SELECT id, token_version, archive_le FROM personne WHERE id = ?')
    .get(charge.sub) as LignePersonne | undefined;
  // Le compte a disparu, a été archivé, ou sa version de jeton a été
  // incrémentée : le jeton est valide cryptographiquement et pourtant périmé.
  if (!p || p.archive_le || p.token_version !== charge.tv) {
    throw new ErreurApp('NON_AUTHENTIFIE', 'Votre session n\'est plus valide, reconnectez-vous.');
  }
  return { personneId: p.id, limite: charge.lim === 1 };
}

function appliquerExigence(ctx: Contexte, exigence: Exigence): void {
  switch (exigence.acces) {
    case 'public':
    case 'authentifie':
      return;

    case 'gerant':
      if (!estGerant(ctx.portee)) {
        throw new ErreurApp('ACCES_REFUSE', 'Cette action est réservée au gérant.');
      }
      return;

    case 'bien': {
      const brut = ctx.req.params[exigence.param ?? 'bienId'];
      const id = Number(brut);
      if (!Number.isInteger(id) || id <= 0) throw new ErreurApp('REQUETE_INVALIDE', "Ce bien n'est pas valide.");
      const role = ctx.portee.biens.get(id);
      // Le message ne distingue pas « le bien n'existe pas » de « vous n'y avez
      // pas accès » : la différence renseignerait sur l'existence d'un dossier.
      if (!role || !auMoins(role, exigence.role)) {
        throw new ErreurApp('ACCES_REFUSE', "Vous n'avez pas accès à ce bien.");
      }
      ctx.bienId = id;
      return;
    }

    case 'structure': {
      const brut = ctx.req.params[exigence.param ?? 'structureId'];
      const id = Number(brut);
      if (!Number.isInteger(id) || id <= 0) throw new ErreurApp('REQUETE_INVALIDE', "Cette structure n'est pas valide.");
      const role = ctx.portee.structures.get(id);
      if (!role || !auMoins(role, exigence.role)) {
        throw new ErreurApp('ACCES_REFUSE', "Vous n'avez pas accès à cette structure.");
      }
      ctx.structureId = id;
      return;
    }
  }
}

export interface Deps { db: Db; config: Config }

export class Routeur {
  readonly router: Router = express.Router();

  constructor(private readonly module: string, private readonly deps: Deps) {}

  get(chemin: string, exigence: Exigence, g: Gestionnaire): this { return this.ajouter('GET', chemin, exigence, g); }
  post(chemin: string, exigence: Exigence, g: Gestionnaire): this { return this.ajouter('POST', chemin, exigence, g); }
  patch(chemin: string, exigence: Exigence, g: Gestionnaire): this { return this.ajouter('PATCH', chemin, exigence, g); }
  delete(chemin: string, exigence: Exigence, g: Gestionnaire): this { return this.ajouter('DELETE', chemin, exigence, g); }

  private ajouter(
    methode: RouteDeclaree['methode'], chemin: string, exigence: Exigence, g: Gestionnaire,
  ): this {
    ROUTES.push({ module: this.module, methode, chemin, exigence });
    const { db, config } = this.deps;

    const pont = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const auth = exigence.acces === 'public' ? { personneId: 0, limite: false } : authentifier(db, config, req);
        const personneId = auth.personneId;
        const ctx: Contexte = {
          db, config, req, res, personneId, limite: auth.limite,
          portee: personneId ? porteeDe(db, personneId) : { personneId: null, biens: new Map(), structures: new Map() },
          bienId: 0, structureId: 0,
          corps: req.body,
          ip: ipDe(req),
        };
        if (auth.limite && !ROUTES_SESSION_LIMITEE.includes(`${methode} ${chemin}`)) {
          throw new ErreurApp('SECOND_FACTEUR_A_ACTIVER',
            'Le second facteur est obligatoire pour les gérants sur cette instance. Activez-le pour continuer.');
        }
        appliquerExigence(ctx, exigence);
        const resultat = await g(ctx);
        if (res.headersSent) return;                      // le gestionnaire a répondu lui-même (fichier, flux)
        if (resultat === undefined) { res.status(204).end(); return; }
        res.json(resultat);
      } catch (e) { next(e); }
    };

    this.router[methode.toLowerCase() as 'get'](chemin, pont);
    return this;
  }
}

/**
 * Le traitement final des erreurs.
 *
 * Ce qui part au client : le code stable, le message français, et les champs à
 * corriger. Ce qui reste dans le journal : le détail et la pile. Un message
 * d'erreur bavard renseigne un attaquant, un journal muet vous empêche de
 * déboguer : les deux besoins sont servis séparément.
 */
export function traiterErreurs(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ErreurApp) {
    if (err.detail) log.debug(`${req.method} ${req.path} → ${err.code} : ${err.detail}`);
    res.status(err.statut).json({ code: err.code, message: err.message, champs: err.champs });
    return;
  }
  // Corps trop gros : Express lève avant le gestionnaire, et sans ce cas la
  // famille recevait « une erreur interne s'est produite » pour une photo un peu
  // lourde, ce qui n'aide personne à comprendre quoi faire.
  if (err instanceof Error && (err as { type?: string }).type === 'entity.too.large') {
    log.debug(`${req.method} ${req.path} → corps refusé : ${err.message}`);
    res.status(415).json({
      code: 'FICHIER_REFUSE',
      message: 'Ce fichier est trop lourd pour être envoyé. La limite se règle dans '
        + 'Paramètres, section Fichiers.',
    });
    return;
  }
  // Charge JSON illisible : Express lève avant d'atteindre le gestionnaire.
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ code: 'REQUETE_INVALIDE', message: 'La requête est illisible.' });
    return;
  }
  log.erreur(`Panne non rattrapée sur ${req.method} ${req.path}`, err);
  if (err instanceof Error && err.stack) log.debug(err.stack);
  res.status(500).json({
    code: 'PANNE_INTERNE',
    message: "Une erreur interne s'est produite. Elle est enregistrée dans le journal du serveur.",
  });
}

/** Toute route inconnue sous /api. Évite qu'une faute de frappe rende la page Angular. */
export function routeInconnue(req: Request, res: Response): void {
  res.status(404).json({ code: 'INTROUVABLE', message: `Route inconnue : ${req.method} ${req.path}` });
}
