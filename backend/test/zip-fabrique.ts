// Un écrivain ZIP minimal, réservé aux tests.
//
// L'import doit savoir lire un vrai `.xlsx`, et un vrai `.xlsx` est un ZIP. Le
// fabriquer ici plutôt que de ranger un fichier binaire dans le dépôt a deux
// avantages : on voit ce que le fichier contient, et on peut le tordre à
// volonté pour éprouver le lecteur.
//
// Entrées stockées sans compression : c'est admis par le format, et cela évite
// d'avoir à produire un flux deflate correct pour un test.
import zlib from 'zlib';

interface Entree { nom: string; contenu: Buffer }

function enteteLocal(e: Entree, crc: number): Buffer {
  const nom = Buffer.from(e.nom, 'utf8');
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4);            // version minimale
  h.writeUInt16LE(0x0800, 6);        // noms en UTF-8
  h.writeUInt16LE(0, 8);             // méthode : stocké
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(e.contenu.length, 18);
  h.writeUInt32LE(e.contenu.length, 22);
  h.writeUInt16LE(nom.length, 26);
  return Buffer.concat([h, nom]);
}

export function zip(entrees: { nom: string; contenu: string | Buffer }[]): Buffer {
  const preparees: Entree[] = entrees.map((e) => ({
    nom: e.nom, contenu: Buffer.isBuffer(e.contenu) ? e.contenu : Buffer.from(e.contenu, 'utf8'),
  }));
  const morceaux: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of preparees) {
    const crc = zlib.crc32(e.contenu);
    const local = enteteLocal(e, crc);
    morceaux.push(local, e.contenu);

    const nom = Buffer.from(e.nom, 'utf8');
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(e.contenu.length, 20);
    c.writeUInt32LE(e.contenu.length, 24);
    c.writeUInt16LE(nom.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nom);
    offset += local.length + e.contenu.length;
  }

  const repertoire = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(preparees.length, 8);
  fin.writeUInt16LE(preparees.length, 10);
  fin.writeUInt32LE(repertoire.length, 12);
  fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...morceaux, repertoire, fin]);
}

/** Un classeur d'une feuille, à partir d'un tableau de textes. */
export function xlsx(lignes: string[][]): Buffer {
  const echapper = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = lignes.map((l, i) => {
    const cells = l.map((v, j) =>
      `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t>${echapper(v)}</t></is></c>`).join('');
    return `<row r="${i + 1}">${cells}</row>`;
  }).join('');
  return zip([
    { nom: '[Content_Types].xml', contenu: '<?xml version="1.0"?><Types/>' },
    { nom: 'xl/workbook.xml', contenu: '<?xml version="1.0"?><workbook><sheets><sheet name="Planning" sheetId="1"/></sheets></workbook>' },
    { nom: 'xl/worksheets/sheet1.xml', contenu: `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>` },
  ]);
}
