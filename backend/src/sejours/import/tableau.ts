// Du fichier téléversé à un tableau de textes.
//
// Trois formes arrivent en pratique quand on demande « l'export du planning » :
// un vrai `.xlsx`, un CSV enregistré depuis le tableur, et un faux `.xls` qui
// est en réalité un tableau HTML. Les trois sont reconnues **par leurs octets**,
// jamais par l'extension du nom, qui ment souvent.
import { decodeText } from './decode';
import { OLE2_MESSAGE, isOle2, isZip, looksLikeHtmlTable, readHtmlTable, readXlsx } from './xlsx';

export interface Lecture {
  /** Le format reconnu, dit en français pour l'écran d'import. */
  format: string;
  encodage: string | null;
  lignes: string[][];
}

/** Le séparateur le plus probable : celui qui découpe le plus régulièrement. */
export function separateur(texte: string): string {
  const echantillon = texte.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let meilleur = ';', score = -1;
  for (const candidat of [';', ',', '\t', '|']) {
    const comptes = echantillon.map((l) => l.split(candidat).length);
    const moyenne = comptes.reduce((a, b) => a + b, 0) / (comptes.length || 1);
    if (moyenne < 2) continue;
    // Un bon séparateur donne le même nombre de colonnes à toutes les lignes.
    const ecart = comptes.reduce((t, n) => t + Math.abs(n - moyenne), 0) / (comptes.length || 1);
    const note = moyenne - ecart * 3;
    if (note > score) { score = note; meilleur = candidat; }
  }
  return meilleur;
}

/**
 * Analyse un CSV, guillemets compris. Écrit à la main parce que la grammaire
 * tient en vingt lignes et que le seul piège, le guillemet doublé à l'intérieur
 * d'un champ, est justement celui que les bibliothèques traitent différemment.
 */
export function lireCsv(texte: string, sep = separateur(texte)): string[][] {
  const lignes: string[][] = [];
  let champs: string[] = [], courant = '', entreGuillemets = false;

  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (entreGuillemets) {
      if (c !== '"') { courant += c; continue; }
      if (texte[i + 1] === '"') { courant += '"'; i++; continue; }   // guillemet doublé
      entreGuillemets = false;
      continue;
    }
    if (c === '"' && courant === '') { entreGuillemets = true; continue; }
    if (c === sep) { champs.push(courant.trim()); courant = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i++;
      champs.push(courant.trim());
      if (champs.some((x) => x !== '')) lignes.push(champs);
      champs = []; courant = '';
      continue;
    }
    courant += c;
  }
  champs.push(courant.trim());
  if (champs.some((x) => x !== '')) lignes.push(champs);
  return lignes;
}

export function lire(contenu: Buffer): Lecture {
  if (isOle2(contenu)) throw new Error(OLE2_MESSAGE);
  if (isZip(contenu)) return { format: 'Classeur Excel (.xlsx)', encodage: null, lignes: readXlsx(contenu) };

  const { text, encoding } = decodeText(contenu);
  if (looksLikeHtmlTable(text)) {
    return { format: 'Tableau HTML (fichier .xls déguisé)', encodage: encoding, lignes: readHtmlTable(text) };
  }
  const sep = separateur(text);
  const nom = sep === '\t' ? 'Texte tabulé' : `Texte séparé par « ${sep} »`;
  return { format: nom, encodage: encoding, lignes: lireCsv(text, sep) };
}
