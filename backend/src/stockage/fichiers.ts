// Le service de fichiers, partagé par tous les modules dès le premier jour.
//
// Trois règles, posées maintenant pour ne pas avoir à les rattraper plus tard :
//
//   1. **Les octets vivent sur le disque**, sous le répertoire de données, et la
//      base ne porte que le chemin. Jamais de base64 dans un enregistrement :
//      une photo de huit méga-octets dans une colonne, c'est une base qu'on ne
//      sauvegarde plus, des requêtes qui rampent et un export impossible.
//   2. **L'adresse est l'empreinte du contenu.** Deux dépôts du même PDF ne
//      coûtent qu'une copie, et un fichier ne peut pas se retrouver au mauvais
//      endroit à cause d'un nom.
//   3. **Le téléchargement passe toujours par une route qui vérifie
//      l'autorisation.** Le répertoire n'est jamais servi par le serveur web, et
//      l'identifiant public est tiré au hasard sur 128 bits : il ne s'énumère
//      pas, même si le lien fuit.
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import type { Db } from '../noyau/db';
import { ErreurApp, introuvable } from '../noyau/erreurs';
import { horodatage } from '../noyau/dates';
import { idPublic } from '../noyau/ids';
import { log } from '../noyau/log';

/**
 * Les types acceptés, reconnus **par leurs octets d'en-tête** et non par
 * l'extension ni par le type que le navigateur déclare. Un fichier renommé en
 * `.jpg` ne devient pas une image, et accepter n'importe quoi dans un
 * répertoire servi par l'application est une des façons les plus simples de se
 * faire exécuter du code.
 */
export interface TypeDetecte { mime: string; ext: string }

const SIGNATURES: { octets: number[]; decalage?: number; type: TypeDetecte }[] = [
  { octets: [0xff, 0xd8, 0xff], type: { mime: 'image/jpeg', ext: 'jpg' } },
  { octets: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], type: { mime: 'image/png', ext: 'png' } },
  { octets: [0x47, 0x49, 0x46, 0x38], type: { mime: 'image/gif', ext: 'gif' } },
  { octets: [0x25, 0x50, 0x44, 0x46], type: { mime: 'application/pdf', ext: 'pdf' } },
];

/** WEBP : « RIFF » puis « WEBP » au huitième octet. */
const estWebp = (b: Buffer): boolean =>
  b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';

export function detecter(b: Buffer): TypeDetecte | null {
  for (const s of SIGNATURES) {
    const d = s.decalage ?? 0;
    if (b.length >= d + s.octets.length && s.octets.every((o, i) => b[d + i] === o)) return s.type;
  }
  return estWebp(b) ? { mime: 'image/webp', ext: 'webp' } : null;
}

let racine = '';

export function initialiser(dataDir: string): void {
  racine = path.join(dataDir, 'fichiers');
  fs.mkdirSync(racine, { recursive: true });
  log.debug(`Fichiers dans ${racine}`);
}

/** `aa/bb/<empreinte>.<ext>` : deux niveaux évitent un répertoire de dix mille entrées. */
const cheminDe = (sha: string, ext: string): string => path.join(sha.slice(0, 2), sha.slice(2, 4), `${sha}.${ext}`);

export interface Fichier {
  id: string; sha256: string; mime: string; taille: number; nomOriginal: string; creeLe: string;
}

interface Ligne { id: string; sha256: string; chemin_rel: string; mime: string; taille: number; nom_original: string; cree_le: string }

const vers = (l: Ligne): Fichier => ({
  id: l.id, sha256: l.sha256, mime: l.mime, taille: l.taille, nomOriginal: l.nom_original, creeLe: l.cree_le,
});

export interface Depot { fichier: Fichier; deduplique: boolean }

export function deposer(db: Db, contenu: Buffer, nomOriginal: string, parQui: number, tailleMaxMo: number): Depot {
  if (!racine) throw new Error('Le service de fichiers n\'est pas initialisé.');
  if (contenu.length === 0) throw new ErreurApp('FICHIER_REFUSE', 'Le fichier est vide.');
  if (contenu.length > tailleMaxMo * 1024 * 1024) {
    throw new ErreurApp('FICHIER_REFUSE',
      `Ce fichier pèse ${Math.round(contenu.length / 1048576)} Mo, la limite est de ${tailleMaxMo} Mo.`);
  }
  const type = detecter(contenu);
  if (!type) {
    throw new ErreurApp('FICHIER_REFUSE',
      'Ce type de fichier n\'est pas accepté. Les formats acceptés sont JPEG, PNG, GIF, WEBP et PDF.');
  }

  const sha = createHash('sha256').update(contenu).digest('hex');
  const relatif = cheminDe(sha, type.ext);
  const absolu = path.join(racine, relatif);
  let deduplique = true;
  if (!fs.existsSync(absolu)) {
    fs.mkdirSync(path.dirname(absolu), { recursive: true });
    // Écriture puis renommage : une coupure au milieu laisse un fichier
    // temporaire, jamais un fichier tronqué à l'adresse de son empreinte.
    const temporaire = `${absolu}.${process.pid}.tmp`;
    fs.writeFileSync(temporaire, contenu);
    fs.renameSync(temporaire, absolu);
    deduplique = false;
  }

  const id = idPublic();
  db.prepare(`
    INSERT INTO fichier (id, sha256, chemin_rel, mime, taille, nom_original, cree_le, cree_par)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, sha, relatif, type.mime, contenu.length, nomOriginal.slice(0, 200), horodatage(), parQui);

  return { fichier: { id, sha256: sha, mime: type.mime, taille: contenu.length, nomOriginal, creeLe: horodatage() }, deduplique };
}

export function fichier(db: Db, id: string): Fichier {
  const l = db.prepare('SELECT id, sha256, chemin_rel, mime, taille, nom_original, cree_le FROM fichier WHERE id = ?')
    .get(id) as Ligne | undefined;
  if (!l) throw introuvable('Ce fichier');
  return vers(l);
}

/** Le chemin absolu, ou null si les octets ont disparu du disque. */
export function cheminAbsolu(db: Db, id: string): { chemin: string; mime: string; nom: string } | null {
  const l = db.prepare('SELECT chemin_rel, mime, nom_original FROM fichier WHERE id = ?')
    .get(id) as { chemin_rel: string; mime: string; nom_original: string } | undefined;
  if (!l) return null;
  const absolu = path.join(racine, l.chemin_rel);
  // Ceinture et bretelles : le chemin vient de la base, mais s'il en sortait un
  // jour autrement, il ne doit pas pouvoir désigner un fichier hors du dépôt.
  if (!absolu.startsWith(racine + path.sep)) return null;
  return fs.existsSync(absolu) ? { chemin: absolu, mime: l.mime, nom: l.nom_original } : null;
}

/**
 * Les octets que plus aucune ligne ne cite. Appelé au démarrage, en compte
 * seulement : rien n'est supprimé automatiquement. Effacer des octets sur la
 * foi d'une requête est le genre de ménage qu'on regrette, et l'espace disque
 * d'un album familial ne presse pas.
 */
export function orphelins(db: Db): { nombre: number; octets: number } {
  if (!racine || !fs.existsSync(racine)) return { nombre: 0, octets: 0 };
  const cites = new Set((db.prepare('SELECT chemin_rel FROM fichier').all() as { chemin_rel: string }[])
    .map((l) => l.chemin_rel));
  let nombre = 0, octets = 0;
  const parcourir = (dossier: string, prefixe: string): void => {
    for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
      const rel = prefixe ? path.join(prefixe, e.name) : e.name;
      if (e.isDirectory()) { parcourir(path.join(dossier, e.name), rel); continue; }
      if (e.name.endsWith('.tmp') || cites.has(rel)) continue;
      nombre++;
      octets += fs.statSync(path.join(dossier, e.name)).size;
    }
  };
  parcourir(racine, '');
  return { nombre, octets };
}
