// Lecture de tableur, sans bibliothèque de tableur.
//
// Un fichier nommé « .xls » est rarement un vrai classeur Excel : c'est souvent
// un tableau HTML ou du texte délimité portant la mauvaise extension. On
// reconnaît les octets plutôt que de croire le nom, et on traite les trois
// formes qui se rencontrent réellement. Le vrai format binaire Excel 97-2003 est
// refusé avec un message explicite : décoder du BIFF8 à la main serait
// déraisonnable, et réenregistrer en .xlsx demande deux clics.
//
// Repris de Foyer-App.
import { XmlNode, findAll, localName, parseXml } from './xml';
import { isOle2, isZip, readZip } from './zip';

/** Lettres de colonne vers un indice à partir de zéro : A donne 0, AA donne 26. */
function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref.toUpperCase());
  if (!letters) return 0;
  let n = 0;
  for (const ch of letters[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Le texte d'une chaîne partagée, qui peut être découpée en fragments. */
function sharedText(node: XmlNode): string {
  return findAll(node, 't').map((t) => t.text).join('');
}

/** La première feuille d'un .xlsx, sous forme de tableau rectangulaire de textes. */
export function readXlsx(buf: Buffer): string[][] {
  const parts = readZip(buf, (n) =>
    n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));

  const sharedNode = parts.get('xl/sharedStrings.xml');
  const shared = sharedNode
    ? parseXml(sharedNode.toString('utf-8')).children
      .filter((c) => localName(c.tag) === 'sst')
      .flatMap((sst) => sst.children.filter((c) => localName(c.tag) === 'si').map(sharedText))
    : [];

  const sheetNames = [...parts.keys()].filter((n) => n.startsWith('xl/worksheets/')).sort();
  if (!sheetNames.length) throw new Error("Aucune feuille de calcul trouvée dans le fichier .xlsx.");
  const sheet = parseXml(parts.get(sheetNames[0])!.toString('utf-8'));

  const table: string[][] = [];
  for (const row of findAll(sheet, 'row')) {
    const cells: string[] = [];
    for (const c of row.children.filter((x) => localName(x.tag) === 'c')) {
      const at = c.attrs['r'] ? columnIndex(c.attrs['r']) : cells.length;
      const type = c.attrs['t'] || '';
      let value = '';
      if (type === 's') {
        const idx = parseInt(findAll(c, 'v').map((v) => v.text)[0] || '', 10);
        value = Number.isInteger(idx) ? (shared[idx] ?? '') : '';
      } else if (type === 'inlineStr') {
        value = findAll(c, 't').map((t) => t.text).join('');
      } else {
        value = findAll(c, 'v').map((v) => v.text)[0] || '';
      }
      while (cells.length < at) cells.push('');
      cells[at] = value;
    }
    table.push(cells);
  }
  return table;
}

/** Un `<table>` HTML, déguisement habituel d'un faux .xls. */
export function readHtmlTable(text: string): string[][] {
  const rows: string[][] = [];
  for (const tr of text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells: string[] = [];
    for (const td of String(tr[1]).matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)) {
      cells.push(String(td[1])
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/\s+/g, ' ')
        .trim());
    }
    if (cells.some((c) => c !== '')) rows.push(cells);
  }
  return rows;
}

export const looksLikeHtmlTable = (text: string): boolean => /<table\b/i.test(text) && /<tr\b/i.test(text);

/** Le message de refus du seul format que nous choisissons de ne pas décoder. */
export const OLE2_MESSAGE =
  'Ce fichier est un classeur Excel 97-2003 (format binaire). Ce format n’est pas pris en charge : '
  + 'rouvrez-le dans votre tableur et réenregistrez-le en .xlsx, ou exportez-le en CSV '
  + '(séparateur point-virgule).';

export { isOle2, isZip };
