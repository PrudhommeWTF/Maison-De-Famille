// Lecteur XML minimal, juste ce qu'il faut pour les feuilles d'un .xlsx.
//
// Écrit à la main volontairement : tirer une pile XML complète pour lire deux
// balises connues coûterait plus en surface de mise à jour que cela n'apporte.
// Repris de Foyer-App.

export interface XmlNode { tag: string; attrs: Record<string, string>; children: XmlNode[]; text: string; }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function unescapeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Nom local d'une balise éventuellement préfixée : `ns:row` donne `row`. */
export const localName = (tag: string): string => {
  const at = tag.indexOf(':');
  return at >= 0 ? tag.slice(at + 1) : tag;
};

/**
 * Analyse un document en arbre. Un balisage inconnu ou malformé est ignoré
 * plutôt que levé : un fichier qui porte un élément bizarre doit quand même
 * s'importer.
 */
export function parseXml(text: string): XmlNode {
  const root: XmlNode = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const tagRe = /<(\/)?([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/)?>/g;
  let last = 0;
  let m: RegExpExecArray | null;

  const addText = (raw: string): void => {
    const top = stack[stack.length - 1];
    const t = unescapeXml(raw).trim();
    if (t) top.text += (top.text ? ' ' : '') + t;
  };

  // Commentaires, CDATA, instructions de traitement et DOCTYPE sont retirés d'abord.
  const src = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_x, inner: string) => String(inner).replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;')))
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');

  while ((m = tagRe.exec(src)) !== null) {
    addText(src.slice(last, m.index));
    last = tagRe.lastIndex;
    const [, closing, tag, rawAttrs, selfClosing] = m;
    if (closing) {
      // Ferme jusqu'à la balise correspondante ; une fermeture orpheline est ignorée.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs.matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[a[1]] = unescapeXml(a[2] ?? a[3] ?? '');
    }
    const node: XmlNode = { tag, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  addText(src.slice(last));
  return root;
}

/** Tous les noeuds dont le nom local correspond, en profondeur d'abord. */
export function findAll(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode): void => {
    for (const c of n.children) {
      if (localName(c.tag) === name) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

export function find(node: XmlNode, name: string): XmlNode | null {
  if (localName(node.tag) === name) return node;
  for (const c of node.children) {
    const hit = find(c, name);
    if (hit) return hit;
  }
  return null;
}

/** Le texte du premier descendant portant ce nom local, ou une chaîne vide. */
export function textOf(node: XmlNode, name: string): string {
  const hit = find(node, name);
  return hit ? hit.text : '';
}
