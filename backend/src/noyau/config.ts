// La configuration de déploiement, lue une fois au démarrage.
//
// Le principe : **un service qui ne peut pas fonctionner correctement refuse de
// démarrer, avec un message qui dit quoi faire**. Il ne démarre pas à moitié
// pour tomber trois heures plus tard sur une requête, quand plus personne ne
// fait le lien avec le déploiement.
//
// Le secret JWT n'a **aucune valeur par défaut dans le code**. Un défaut, même
// « à changer en production », finit toujours en production : c'est l'un des cas
// les plus fréquents de compromission d'application auto-hébergée. En
// développement, un secret éphémère est tiré au hasard à chaque démarrage, ce
// qui déconnecte tout le monde au redémarrage et rend l'oubli visible tout de
// suite plutôt qu'invisible pour toujours.
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { log } from './log';

export interface Config {
  production: boolean;
  port: number;
  /** Racine des données : base SQLite, fichiers joints, sauvegardes. */
  dataDir: string;
  dbPath: string;
  /** Répertoire de l'application Angular compilée, servie par ce même service. */
  staticDir: string | null;
  jwtSecret: string;
  /** Adresse publique, obligatoire dès qu'un courriel part : ses liens sont absolus. */
  publicUrl: string | null;
  smtp: { host: string; port: number; user: string; pass: string; from: string } | null;
  version: string;
}

const REQUIS_JWT = 32;

class ErreurDeConfig extends Error {}

function secretJwt(production: boolean): string {
  const brut = (process.env.MDF_JWT_SECRET || '').trim();
  if (brut.length >= REQUIS_JWT) return brut;

  if (production) {
    throw new ErreurDeConfig(
      brut
        ? `MDF_JWT_SECRET fait ${brut.length} caractères, il en faut au moins ${REQUIS_JWT}.`
        : 'MDF_JWT_SECRET est absent.',
    );
  }
  const jetable = randomBytes(32).toString('hex');
  log.attention(
    'MDF_JWT_SECRET absent : un secret jetable a été tiré pour ce démarrage. ' +
    'Toutes les sessions seront perdues au prochain redémarrage. Acceptable en développement, ' +
    'refusé en production.',
  );
  return jetable;
}

function smtp(): Config['smtp'] {
  const host = (process.env.MDF_SMTP_HOST || '').trim();
  if (!host) return null;
  const from = (process.env.MDF_SMTP_FROM || '').trim();
  if (!from) throw new ErreurDeConfig('MDF_SMTP_HOST est défini mais MDF_SMTP_FROM est absent : aucun courriel ne pourrait partir.');
  return {
    host,
    port: Number(process.env.MDF_SMTP_PORT || 587),
    user: (process.env.MDF_SMTP_USER || '').trim(),
    pass: process.env.MDF_SMTP_PASS || '',
    from,
  };
}

function version(): string {
  const env = (process.env.MDF_VERSION || '').trim();
  if (env) return env;
  try {
    const p = path.join(__dirname, '..', '..', 'package.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).version || '0.0.0';
  } catch { return '0.0.0'; }
}

/**
 * Construit la configuration, ou lève. `charger()` en dessous transforme la
 * levée en message et en sortie propre : cette fonction reste pure pour être
 * testable sans tuer le processus de test.
 */
export function construire(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const dataDir = env.MDF_DATA_DIR || path.join(__dirname, '..', '..', 'data');
  const cfg: Config = {
    production,
    port: Number(env.PORT || 8099),
    dataDir,
    dbPath: env.MDF_DB_PATH || path.join(dataDir, 'maison.db'),
    staticDir: env.MDF_STATIC_DIR || null,
    jwtSecret: secretJwt(production),
    publicUrl: (env.MDF_PUBLIC_URL || '').trim().replace(/\/+$/, '') || null,
    smtp: smtp(),
    version: version(),
  };
  if (cfg.smtp && !cfg.publicUrl) {
    throw new ErreurDeConfig(
      'Un relais SMTP est configuré mais MDF_PUBLIC_URL est absent. ' +
      'Les courriels portent des liens absolus vers l\'application : sans cette adresse, ils seraient inutilisables.',
    );
  }
  return cfg;
}

/**
 * La configuration effective du processus. En cas de problème, le message
 * explique le réglage fautif et où le corriger, puis le service s'arrête. C'est
 * volontairement brutal : mieux vaut un service qui ne démarre pas et le dit
 * qu'un service qui démarre sans sécurité.
 */
export function charger(): Config {
  try {
    const cfg = construire();
    fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
    return cfg;
  } catch (e) {
    if (e instanceof ErreurDeConfig) {
      console.error('');
      console.error('[mdf] Démarrage refusé : la configuration est incomplète.');
      console.error('[mdf] ' + e.message);
      console.error('');
      console.error('[mdf] Où corriger :');
      console.error('[mdf]   LXC    : /etc/maison-de-famille/mdf.env, puis systemctl restart maison-de-famille');
      console.error('[mdf]   Docker : le bloc environment de docker-compose.yml, puis docker compose up -d');
      console.error('');
      console.error('[mdf] Pour engendrer un secret : openssl rand -hex 32');
      console.error('');
      process.exit(1);
    }
    throw e;
  }
}
