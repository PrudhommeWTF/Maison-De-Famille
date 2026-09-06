// Juste assez de lecture ZIP pour ouvrir un .xlsx, qui est un ZIP de fichiers
// XML.
//
// Node fournit le décodeur inflate (zlib) : il ne reste qu'un parcours
// d'en-têtes. Écrit à la main plutôt qu'en tirant une bibliothèque de tableur :
// la grammaire est courte, et nous ne lisons que deux ou trois entrées connues.
//
// Repris de Foyer-App, où ce module a déjà servi à absorber des exports de
// banque. Il porte sa leçon avec lui, voir la borne ci-dessous.
import zlib from 'zlib';

/**
 * Ce qu'une entrée a le droit de peser une fois décompressée.
 *
 * Sans cette borne, `inflateRawSync` va jusqu'à ce que zlib s'arrête, c'est-à-dire
 * jusqu'à deux gigaoctets. Mesuré sur Foyer-App : un faux .xlsx de 305 Ko amenait
 * le service à 988 Mo de mémoire résidente et bloquait le processus près de six
 * secondes. Le taux de compression d'un fichier ne contenant que des zéros étant
 * d'environ mille pour un, un seul téléversement suffit à faire tuer le conteneur
 * par le noyau, et la famille perd son application.
 *
 * Soixante-quatre mégaoctets laissent passer très largement le plus gros planning
 * qu'un tableur produise, et tiennent dans la mémoire du conteneur.
 */
const MAX_INFLATED = 64 * 1024 * 1024;

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;

interface Entry { name: string; method: number; compressedSize: number; uncompressedSize: number; localOffset: number; }

/** Retrouve la fin du répertoire central, en remontant par-dessus le commentaire. */
function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/** Le contenu des entrées demandées, et d'elles seules. */
export function readZip(buf: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error("Archive ZIP invalide (fin d'archive introuvable).");
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);

  const entries: Entry[] = [];
  for (let i = 0; i < count && at + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(at) !== CDIR_SIG) break;
    const method = buf.readUInt16LE(at + 10);
    const compressedSize = buf.readUInt32LE(at + 20);
    const uncompressedSize = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localOffset = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf-8');
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    at += 46 + nameLen + extraLen + commentLen;
  }

  const out = new Map<string, Buffer>();
  for (const e of entries) {
    if (!wanted(e.name)) continue;
    // L'en-tête local répète le nom et les champs additionnels, avec ses propres longueurs.
    const nameLen = buf.readUInt16LE(e.localOffset + 26);
    const extraLen = buf.readUInt16LE(e.localOffset + 28);
    const start = e.localOffset + 30 + nameLen + extraLen;
    const data = buf.subarray(start, start + e.compressedSize);
    // Le répertoire central annonce la taille décompressée : quand elle est déjà
    // hors limite, on refuse sans rien allouer. Un en-tête peut mentir, d'où la
    // seconde borne, celle que zlib fait respecter pendant la décompression.
    if (e.uncompressedSize > MAX_INFLATED) throw new Error(tropGros(e.name, e.uncompressedSize));
    if (e.method === 0) out.set(e.name, Buffer.from(data));
    else if (e.method === 8) {
      try {
        out.set(e.name, zlib.inflateRawSync(data, { maxOutputLength: MAX_INFLATED }));
      } catch (err) {
        // Au-delà de la borne, zlib rend soit ERR_BUFFER_TOO_LARGE, soit une
        // « buffer error » : deux formulations illisibles pour qui les lit dans
        // un journal, et c'est justement le cas qu'on veut nommer.
        const code = (err as { code?: string }).code ?? '';
        const texte = String((err as Error).message ?? '');
        if (/ERR_BUFFER_TOO_LARGE|ERR_ZLIB/.test(code) || /maxOutputLength|buffer error|larger than/i.test(texte)) {
          throw new Error(tropGros(e.name));
        }
        throw err;
      }
    }
    else throw new Error(`Compression ZIP non prise en charge (méthode ${e.method}) pour « ${e.name} ».`);
  }
  return out;
}

/** Le message de refus, le même que la taille soit annoncée ou constatée. */
function tropGros(nom: string, taille?: number): string {
  const poids = taille ? ` (${Math.round(taille / 1048576)} Mo annoncés)` : '';
  return `L'entrée « ${nom} » de cette archive dépasse ${MAX_INFLATED / 1048576} Mo une fois décompressée${poids}. `
    + 'Un planning de séjours ne pèse pas cela : le fichier est refusé.';
}

/** Vrai quand les octets commencent par un en-tête de fichier local (PK\3\4). */
export const isZip = (buf: Buffer): boolean =>
  buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;

/** Vrai pour le conteneur OLE2 d'Excel 97-2003 (.xls binaire, BIFF8). */
export const isOle2 = (buf: Buffer): boolean =>
  buf.length > 8 && buf.readUInt32LE(0) === 0xe011cfd0 && buf.readUInt32LE(4) === 0xe11ab1a1;
