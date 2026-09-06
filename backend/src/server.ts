// Le service : un seul processus qui sert l'API et l'application compilée.
//
// Un seul conteneur, un seul port, un seul reverse-proxy à configurer. C'est ce
// qui rend l'exploitation simple : il n'y a rien à orchestrer entre un front et
// un back, et un redémarrage redémarre tout.
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { charger } from './noyau/config';
import { ouvrir } from './noyau/db';
import { Deps, ROUTES, routeInconnue, traiterErreurs } from './noyau/http';
import { log, poserSourceDeNiveau, Niveau } from './noyau/log';
import { purger } from './auth/jetons';
import { parametre } from './parametres/repo';
import { initialiser, orphelins } from './stockage/fichiers';
import { demarrerOrdonnanceur } from './notifications/envoi';
import { routesAcces } from './acces/routes';
import { routesAuth } from './auth/routes';
import { routesPatrimoine } from './patrimoine/routes';
import { routesSejours } from './sejours/routes';
import { routesArgent } from './argent/routes';
import { demarrerEntretien, routesEntretien } from './entretien/routes';
import { routesCoffre } from './coffre/routes';
import { routesMaison } from './maison/routes';
import { routesDecisions } from './decisions/routes';
import { routesLocation } from './location/routes';
import { routesSaisons } from './sejours/saisons';
import { routesImport } from './sejours/import/routes';
import { routesParametres } from './parametres/routes';
import { routesFichiers } from './stockage/routes';
import { routesExport } from './export/routes';
import { routesSysteme } from './systeme/routes';

export function construireApp(deps: Deps): express.Express {
  const app = express();

  // Derrière NGINX Proxy Manager, l'adresse réelle du client arrive dans
  // X-Forwarded-For. Sans cette ligne, toute la famille partagerait la même
  // adresse aux yeux de la temporisation, et un seul essai malheureux
  // verrouillerait tout le monde.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({
    // La politique peut être stricte parce que l'application ne charge rien de
    // l'extérieur : les polices et les icônes sont dans le dépôt, il n'y a aucun
    // CDN, et aucun appel réseau sortant en dehors du relais SMTP.
    contentSecurityPolicy: {
      directives: {
        // `upgrade-insecure-requests` vient des défauts de helmet, qui les
        // fusionne avec ce qu'on lui donne. Il faisait réécrire chaque
        // ressource en https, y compris sur une instance servie en clair sur le
        // réseau local : le navigateur n'obtenait aucun script et affichait une
        // page blanche. Invisible en test, parce que les navigateurs exemptent
        // « localhost » de cette réécriture.
        //
        // Le retirer ne coûte rien ici : l'application ne charge aucune
        // ressource extérieure, et toutes ses adresses sont relatives, donc
        // déjà dans le protocole de la page. La mise en ligne passe par un
        // reverse-proxy qui porte le certificat, et c'est lui qui doit rediriger
        // vers https, pas une directive qui casse le premier démarrage.
        upgradeInsecureRequests: null,
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'same-origin' },
  }));

  // Un plafond global, très large : il n'attrape pas un usage normal, il
  // attrape une boucle partie de travers ou un balayage. La vraie protection de
  // la connexion est la double temporisation d'auth/temporisation.ts.
  app.use('/api', rateLimit({
    windowMs: 60_000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { code: 'TROP_DE_TENTATIVES', message: 'Trop de requêtes, patientez un instant.' },
  }));

  // Le téléversement d'une photo arrive en octets bruts : le corps est le
  // fichier. Cela évite une dépendance d'analyse multipart, et le navigateur
  // sait envoyer un objet File tel quel.
  const brut = express.raw({ type: () => true, limit: `${parametre<number>(deps.db, 'fichierTailleMaxMo')}mb` });
  app.use('/api/biens/:bienId/photo', brut);
  app.use('/api/import/analyse', brut);
  app.use('/api/structures/:structureId/justificatif', brut);
  app.use('/api/biens/:bienId/albums/:albumId/photos', brut);
  app.use('/api/biens/:bienId/coffre/fichier', brut);
  app.use(express.json({ limit: '1mb' }));

  for (const routeur of [
    routesAuth(deps), routesAcces(deps), routesPatrimoine(deps), routesSejours(deps),
    routesSaisons(deps), routesImport(deps), routesArgent(deps), routesEntretien(deps),
    routesMaison(deps), routesCoffre(deps), routesDecisions(deps), routesLocation(deps),
    routesParametres(deps),
    routesFichiers(deps), routesExport(deps), routesSysteme(deps),
  ]) app.use('/api', routeur.router);

  app.use('/api', routeInconnue);

  if (deps.config.staticDir && fs.existsSync(deps.config.staticDir)) {
    const racine = deps.config.staticDir;
    app.use(express.static(racine, { index: false, maxAge: '7d', etag: true }));

    // L'index est lu une fois et sa balise `base` réécrite selon le chemin de
    // montage. Ce n'est pas un détail de confort : sans base absolue, un
    // rechargement sur /bien/calendrier fait chercher les fichiers de
    // l'application dans /bien/, le serveur répond l'index à leur place, et le
    // navigateur affiche une page blanche. C'est ce qui arrive à la première
    // personne qui met le calendrier en favori.
    let index = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');
    if (deps.config.baseHref !== '/') {
      index = index.replace(/<base href="[^"]*">/, `<base href="${deps.config.baseHref}">`);
      log.info(`Application servie sous ${deps.config.baseHref}`);
    }
    app.get('*', (_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      // L'index ne se met jamais en cache : il porte le nom des fichiers
      // compilés, qui change à chaque version.
      res.setHeader('Cache-Control', 'no-store');
      res.send(index);
    });
  }

  app.use(traiterErreurs);
  return app;
}

function demarrer(): void {
  const config = charger();
  const db = ouvrir(config.dbPath, config.dataDir);
  const deps: Deps = { db, config };

  // Le niveau de journalisation devient un réglage lu à chaque ligne : le
  // changer prend effet pendant qu'on regarde « journalctl -f ».
  poserSourceDeNiveau(() => parametre<Niveau>(db, 'journalNiveau'));
  initialiser(config.dataDir);

  const partis = purger(db);
  if (partis) log.debug(`${partis} session(s) expirée(s) purgée(s).`);
  const perdus = orphelins(db);
  if (perdus.nombre) {
    log.attention(`${perdus.nombre} fichier(s) sur le disque ne sont cités par aucune ligne (${Math.round(perdus.octets / 1024)} Ko). Rien n'a été supprimé.`);
  }

  const app = construireApp(deps);
  const arreterOrdonnanceur = demarrerOrdonnanceur(db, config);
  const arreterEntretien = demarrerEntretien(db, config);

  const serveur = app.listen(config.port, config.host, () => {
    log.info(`Maison de Famille ${config.version} écoute sur ${config.host}:${config.port}.`);
    log.info(`Données : ${config.dataDir}`);
    log.info(`${ROUTES.length} routes déclarées.`);
    if (!config.publicUrl) {
      log.attention('MDF_PUBLIC_URL n\'est pas défini : les liens des courriels seraient relatifs et inutilisables.');
    }
  });

  // systemd envoie SIGTERM. Fermer proprement évite une base laissée avec un
  // journal WAL à rejouer et une requête coupée au milieu d'une transaction.
  const arreter = (signal: string) => (): void => {
    log.info(`${signal} reçu, arrêt en cours.`);
    arreterOrdonnanceur();
    arreterEntretien();
    serveur.close(() => { db.close(); process.exit(0); });
    // Si une connexion pend, on ne reste pas bloqué indéfiniment.
    setTimeout(() => { db.close(); process.exit(0); }, 10_000).unref();
  };
  process.on('SIGTERM', arreter('SIGTERM'));
  process.on('SIGINT', arreter('SIGINT'));
}

if (require.main === module) demarrer();
