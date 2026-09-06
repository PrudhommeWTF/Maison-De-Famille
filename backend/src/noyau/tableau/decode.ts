// Décodage d'un fichier téléversé.
//
// Un tableur enregistre en UTF-8 ou en Windows-1252 selon sa version et la
// case cochée à l'export, et la différence est invisible dans un fichier de
// deux mille lignes jusqu'à ce que « Kerloc'h » devienne « Kerloc?h ». On
// reconnaît plutôt que de supposer, et on dit ce qu'on a utilisé.
//
// Repris de Foyer-App.

/** Windows-1252 ne diffère de Latin-1 que sur 0x80-0x9F : voici ceux qui comptent. */
const CP1252_HIGH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž',
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

function fromCp1252(buf: Buffer): string {
  let out = '';
  for (const b of buf) out += b >= 0x80 && b <= 0x9f ? (CP1252_HIGH[b] ?? '�') : String.fromCharCode(b);
  return out;
}

/** Les octets forment-ils de l'UTF-8 valide ? Node substitue U+FFFD sinon. */
function isValidUtf8(buf: Buffer): boolean {
  return !buf.toString('utf-8').includes('�');
}

export interface Decoded { text: string; encoding: string; }

/**
 * Décode un fichier téléversé en texte. La marque d'octets Unicode l'emporte
 * quand elle est là ; sinon l'UTF-8 valide est supposé, et le reste retombe sur
 * Windows-1252, le seul autre encodage qu'un tableur français produise en
 * pratique.
 */
export function decodeText(buf: Buffer): Decoded {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString('utf-8'), encoding: 'UTF-8 (BOM)' };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: buf.subarray(2).toString('utf16le'), encoding: 'UTF-16 LE' };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // Node n'a pas de décodeur utf16be : on échange les paires et on réutilise utf16le.
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return { text: swapped.toString('utf16le'), encoding: 'UTF-16 BE' };
  }
  if (isValidUtf8(buf)) return { text: buf.toString('utf-8'), encoding: 'UTF-8' };
  return { text: fromCp1252(buf), encoding: 'Windows-1252' };
}
