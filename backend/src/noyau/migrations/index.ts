// L'exécution des migrations, au démarrage.
//
// Le principe, et il tient en trois phrases :
//
//   1. Les migrations sont **numérotées** et appliquées dans l'ordre, chacune
//      dans sa transaction, et inscrites dans `schema_migration`.
//   2. Une base qui porte une version **inconnue de ce binaire** arrête le
//      service avec un message explicite, plutôt que de tourner sur un schéma
//      qu'elle ne comprend pas et de corrompre les données.
//   3. **Une sauvegarde est prise avant toute migration.** C'est ce qui rend la
//      marche arrière réelle et non théorique : il n'y a pas de migration
//      descendante, et un `down` que personne n'exécute jamais ne marche pas le
//      jour où on en a besoin.
import fs from 'fs';
import path from 'path';
import type { Database } from 'better-sqlite3';
import { log } from '../log';
import { horodatage } from '../dates';
import { migration001 } from './001-socle';
import { migration002 } from './002-totp';
import { migration003 } from './003-argent';
import { migration004 } from './004-invitations';
import { migration005 } from './005-maison';

export interface Migration {
  version: number;
  libelle: string;
  up(db: Database): void;
}

/** Dans l'ordre. Ajouter une migration, c'est ajouter une ligne ici. */
export const MIGRATIONS: readonly Migration[] = [migration001, migration002, migration003, migration004, migration005];

export const versionCible = (): number => Math.max(...MIGRATIONS.map((m) => m.version));

export class ErreurDeMigration extends Error {}

function versionInstallee(db: Database): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    version     INTEGER PRIMARY KEY,
    libelle     TEXT NOT NULL,
    applique_le TEXT NOT NULL,
    duree_ms    INTEGER NOT NULL
  )`);
  const r = db.prepare('SELECT MAX(version) AS v FROM schema_migration').get() as { v: number | null };
  return r.v ?? 0;
}

/**
 * Une copie cohérente de la base, prise avant la première migration d'un
 * démarrage. `VACUUM INTO` produit une base complète et propre, contrairement à
 * un `cp` du fichier pendant que le WAL est actif.
 */
function sauvegarderAvant(db: Database, dataDir: string, depuis: number, vers: number): string | null {
  const dossier = path.join(dataDir, 'sauvegardes');
  fs.mkdirSync(dossier, { recursive: true });
  const nom = `avant-migration-${String(depuis)}-vers-${String(vers)}-${horodatage().replace(/[:.]/g, '')}.db`;
  const cible = path.join(dossier, nom);
  try {
    db.prepare('VACUUM INTO ?').run(cible);
    log.info(`Sauvegarde avant migration : ${cible}`);
    return cible;
  } catch (e) {
    // Une sauvegarde impossible (disque plein, droits) est une raison
    // suffisante de ne pas migrer : c'est le filet, pas un agrément.
    throw new ErreurDeMigration(
      `Impossible d'écrire la sauvegarde préalable dans ${dossier} : ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** Ne garde que les dernières sauvegardes automatiques, par ordre de nom. */
function rotation(dataDir: string, garder = 10): void {
  const dossier = path.join(dataDir, 'sauvegardes');
  try {
    const fichiers = fs.readdirSync(dossier).filter((f) => f.startsWith('avant-migration-')).sort();
    for (const f of fichiers.slice(0, Math.max(0, fichiers.length - garder))) {
      fs.unlinkSync(path.join(dossier, f));
    }
  } catch (e) { log.attention('Rotation des sauvegardes impossible', e); }
}

export function appliquer(db: Database, dataDir: string): void {
  const installee = versionInstallee(db);
  const cible = versionCible();

  if (installee > cible) {
    throw new ErreurDeMigration(
      `La base est en version ${installee}, ce binaire ne connaît que jusqu'à ${cible}. ` +
      'Vous avez probablement déployé une version antérieure de l\'application. ' +
      'Redéployez la version la plus récente, ou restaurez une sauvegarde antérieure à la montée de version.',
    );
  }

  const aFaire = MIGRATIONS.filter((m) => m.version > installee).sort((a, b) => a.version - b.version);
  if (!aFaire.length) { log.debug(`Schéma en version ${installee}, rien à migrer.`); return; }

  // Une base vide n'a rien à sauvegarder : la première installation ne produit
  // pas un fichier de sauvegarde vide qui ferait douter.
  if (installee > 0) { sauvegarderAvant(db, dataDir, installee, cible); rotation(dataDir); }

  for (const m of aFaire) {
    const debut = Date.now();
    try {
      db.transaction(() => {
        m.up(db);
        db.prepare('INSERT INTO schema_migration (version, libelle, applique_le, duree_ms) VALUES (?, ?, ?, ?)')
          .run(m.version, m.libelle, horodatage(), Date.now() - debut);
      })();
    } catch (e) {
      throw new ErreurDeMigration(
        `La migration ${m.version} (${m.libelle}) a échoué et a été annulée. ` +
        `La base reste en version ${installee}. Cause : ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    log.info(`Migration ${m.version} appliquée (${m.libelle}) en ${Date.now() - debut} ms.`);
  }
}
