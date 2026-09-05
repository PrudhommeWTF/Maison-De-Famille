// L'écriture d'une archive tar, sans dépendance.
//
// Pourquoi écrire un format d'archive à la main plutôt que d'ajouter une
// bibliothèque : le format ustar tient en une centaine de lignes, il est figé
// depuis 1988, et l'archive produite s'ouvre avec le `tar` de n'importe quelle
// machine. Une dépendance de plus pour cela coûterait davantage en surface de
// mise à jour qu'elle n'apporte.
//
// L'archive part **compressée** par `zlib`, qui est dans Node. Elle contient la
// base SQLite, tous les fichiers joints et un manifeste : de quoi restaurer sur
// une instance vierge, ce qui est le point de recette « j'exporte tout, je
// restaure, je retrouve la même chose ».
import fs from 'fs';
import path from 'path';

const BLOC = 512;

const cadrer = (valeur: string, taille: number): Buffer => {
  const b = Buffer.alloc(taille);
  b.write(valeur.slice(0, taille - 1), 'utf8');
  return b;
};

/** Un nombre en octal, sur `taille - 1` caractères, terminé par un espace. */
const octal = (n: number, taille: number): Buffer =>
  cadrer(n.toString(8).padStart(taille - 1, '0'), taille);

function entete(nom: string, taille: number, mtime: number): Buffer {
  const h = Buffer.alloc(BLOC);
  // Le format ustar coupe le nom en préfixe et nom quand il dépasse 100
  // caractères. Les noms produits ici sont courts, mais un album de photos
  // pourrait un jour en produire de longs.
  let prefixe = '', court = nom;
  if (Buffer.byteLength(nom) > 100) {
    const coupe = nom.lastIndexOf('/', 154);
    if (coupe > 0) { prefixe = nom.slice(0, coupe); court = nom.slice(coupe + 1); }
  }
  cadrer(court, 100).copy(h, 0);
  octal(0o644, 8).copy(h, 100);
  octal(0, 8).copy(h, 108);
  octal(0, 8).copy(h, 116);
  octal(taille, 12).copy(h, 124);
  octal(Math.floor(mtime / 1000), 12).copy(h, 136);
  h.write('        ', 148, 8, 'utf8');            // somme de contrôle : espaces pendant le calcul
  h.write('0', 156, 1, 'utf8');                   // fichier ordinaire
  h.write('ustar\0', 257, 6, 'binary');
  h.write('00', 263, 2, 'utf8');
  cadrer(prefixe, 155).copy(h, 345);

  let somme = 0;
  for (const octet of h) somme += octet;
  cadrer(somme.toString(8).padStart(6, '0') + '\0', 8).copy(h, 148);
  return h;
}

const remplissage = (taille: number): Buffer => Buffer.alloc((BLOC - (taille % BLOC)) % BLOC);

export interface Entree { nom: string; contenu: Buffer | string; mtime?: number }

/** Une archive tar complète, en mémoire. */
export function tar(entrees: readonly Entree[]): Buffer {
  const morceaux: Buffer[] = [];
  for (const e of entrees) {
    const contenu = Buffer.isBuffer(e.contenu) ? e.contenu : Buffer.from(e.contenu, 'utf8');
    morceaux.push(entete(e.nom, contenu.length, e.mtime ?? Date.now()), contenu, remplissage(contenu.length));
  }
  // Deux blocs nuls marquent la fin de l'archive.
  morceaux.push(Buffer.alloc(BLOC * 2));
  return Buffer.concat(morceaux);
}

/** Les fichiers d'un répertoire, à plat, avec leur chemin relatif. */
export function fichiersDe(racine: string, prefixeArchive: string): Entree[] {
  if (!fs.existsSync(racine)) return [];
  const out: Entree[] = [];
  const parcourir = (dossier: string, relatif: string): void => {
    for (const e of fs.readdirSync(dossier, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const complet = path.join(dossier, e.name);
      const rel = relatif ? `${relatif}/${e.name}` : e.name;
      if (e.isDirectory()) { parcourir(complet, rel); continue; }
      if (e.name.endsWith('.tmp')) continue;
      const stat = fs.statSync(complet);
      out.push({ nom: `${prefixeArchive}/${rel}`, contenu: fs.readFileSync(complet), mtime: stat.mtimeMs });
    }
  };
  parcourir(racine, '');
  return out;
}
