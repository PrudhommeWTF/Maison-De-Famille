// Les guides d'utilisation, tels qu'ils s'affichent dans l'application.
//
// **Une seule source.** Les guides sont écrits en Markdown dans `docs/guides/`
// et lus aussi bien sur GitHub que dans l'application. Les recopier dans des
// composants Angular aurait créé deux versions qui divergent, et c'est toujours
// celle que personne ne relit qui reste affichée.
//
// Ce module est **pur** : il transforme du HTML en HTML, sans fichier ni
// réseau. C'est ce qui le rend testable, et la conversion Markdown vers HTML
// se fait à la compilation (voir `scripts/aide.ts`), pas dans le navigateur :
// aucune bibliothèque de rendu n'est embarquée dans l'application.

export interface Guide {
  slug: string;
  fichier: string;
  titre: string;
  /** Une ligne pour dire à qui il s'adresse, affichée dans la liste. */
  pourQui: string;
}

/**
 * Les guides publiés, dans l'ordre de lecture.
 *
 * `CAPTURES.md` n'y est pas : il explique comment réengendrer les copies
 * d'écran, ce qui regarde qui développe et non la famille.
 */
export const GUIDES: readonly Guide[] = [
  { slug: 'guides', fichier: 'README.md', titre: 'Quel guide est pour vous', pourQui: 'Commencez ici si vous ne savez pas lequel ouvrir' },
  { slug: 'premiers-pas', fichier: 'premiers-pas.md', titre: 'Premiers pas', pourQui: 'À lire en premier, quel que soit votre rôle' },
  { slug: 'gerant', fichier: 'gerant.md', titre: 'Guide du gérant', pourQui: 'Arbitrer les séjours, saisir les dépenses, tenir les papiers' },
  { slug: 'detenteur', fichier: 'detenteur.md', titre: 'Guide du détenteur', pourQui: 'Vous possédez une part de la maison sans la gérer' },
  { slug: 'membre-de-foyer', fichier: 'membre-de-foyer.md', titre: 'Guide du membre de foyer', pourQui: 'Votre conjoint possède une part, vous venez en famille' },
  { slug: 'invite', fichier: 'invite.md', titre: "Guide de l'invité", pourQui: 'Vous avez reçu un lien pour un séjour précis' },
];

export const guideDe = (slug: string): Guide | undefined => GUIDES.find((g) => g.slug === slug);

/** Le fichier Markdown vers la route de l'application : `gerant.md` donne `gerant`. */
const slugDuFichier = (fichier: string): string | null =>
  GUIDES.find((g) => g.fichier === fichier)?.slug ?? null;

/**
 * Un titre vers une ancre stable : « 3. Arbitrer » donne « arbitrer ».
 *
 * Les accents sont dépliés plutôt que supprimés, sinon « Répartition » et
 * « Rpartition » se retrouveraient dans la même adresse.
 */
export function ancre(titre: string): string {
  return titre.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    // Un titre numéroté ne fait pas une adresse : « 3-arbitrer » deviendrait
    // « 4-arbitrer » à la première section insérée, et tous les liens
    // tomberaient. Le numéro saute, le texte reste.
    .replace(/^\d+(-bis)?-/, '');
}

export interface Entree { id: string; texte: string }
export interface Prepare { html: string; sommaire: Entree[] }

/** Les seules entités que produit la conversion Markdown de nos guides. */
const decoder = (t: string): string => t
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

/**
 * Rend le HTML d'un guide affichable dans l'application.
 *
 * Quatre réécritures, et chacune répare quelque chose qui casserait :
 *
 *   1. **Les titres reçoivent une ancre** et alimentent le sommaire. Le guide
 *      du gérant fait plus de cinq cents lignes : sans sommaire, on le lit au
 *      défilement, donc on ne le lit pas.
 *   2. **Les liens entre guides** deviennent des adresses de l'application.
 *      `gerant.md` ne mène nulle part dans un navigateur.
 *   3. **Les liens vers d'autres documents** du dépôt perdent leur lien mais
 *      gardent leur texte : un lien mort est pire qu'une mention.
 *   4. **Les images** sont servies depuis les ressources compilées, et prennent
 *      les classes Bootstrap qui les empêchent de déborder sur un téléphone.
 */
export function preparer(html: string, slug: string): Prepare {
  const sommaire: Entree[] = [];

  // Le titre de niveau un est retiré : l'écran l'affiche déjà en tête de carte,
  // et le garder l'écrivait deux fois de suite. Le masquer en CSS n'était pas
  // une option : les styles d'un composant ne s'appliquent pas au HTML injecté.
  let sortie = html.replace(/<h1>.*?<\/h1>\s*/s, '');

  sortie = sortie.replace(/<h2>(.*?)<\/h2>/gs, (_, brut: string) => {
    const texte = brut.replace(/<[^>]+>/g, '').trim();
    const id = ancre(texte);
    sommaire.push({ id, texte });
    return `<h2 id="${id}" class="h4 mt-5 mb-3">${brut}</h2>`;
  });

  sortie = sortie.replace(/<a href="([^"]+)">/g, (entier, href: string) => {
    if (/^https?:/.test(href)) return `<a href="${href}" target="_blank" rel="noopener noreferrer">`;
    // Une ancre nue se résout sur `<base href="/">` et non sur l'adresse
    // courante : « #calendrier » menait à « /#calendrier », donc au tableau de
    // bord. Le sommaire interne des guides tombait entièrement dans ce trou.
    if (href.startsWith('#')) return `<a href="/aide/${slug}${href}">`;
    const [fichier, ancreCible] = href.split('#');
    // Nommée `vise` et non `slug` : le paramètre du même nom serait masqué, et
    // la branche des ancres nues ci-dessus lirait une variable pas encore
    // initialisée. C'est arrivé, et le message ne disait rien de clair.
    const vise = slugDuFichier(fichier.replace(/^\.\//, ''));
    if (vise) return `<a href="/aide/${vise}${ancreCible ? `#${ancreCible}` : ''}">`;
    return entier.replace(/^<a /, '<a data-mort="1" ');
  });
  // Un lien vers un document qui n'est pas publié ici garde son texte et perd
  // son lien : le marquage ci-dessus sert uniquement à le repérer maintenant.
  sortie = sortie.replace(/<a data-mort="1"[^>]*>(.*?)<\/a>/gs, '$1');

  sortie = sortie.replace(/<img src="(?:\.\/)?images\/([^"]+)"([^>]*)>/g,
    (_, nom: string, reste: string) => `<img src="aide/images/${nom}"${reste} loading="lazy" class="img-fluid rounded border my-3">`);

  sortie = sortie.replace(/<table>/g, '<div class="table-responsive"><table class="table table-sm align-middle">')
    .replace(/<\/table>/g, '</table></div>');

  return { html: sortie, sommaire };
}

/**
 * Le titre affiché : celui du registre, ou le premier titre de niveau un.
 *
 * Les entités sont **décodées** et non échappées : ce titre est rendu par une
 * interpolation Angular, qui échappe déjà. L'échapper une seconde fois
 * affichait « Guides d&amp;#39;utilisation » à l'écran.
 */
export const titreDu = (guide: Guide, html: string): string => {
  const m = /<h1>(.*?)<\/h1>/s.exec(html);
  return m ? decoder(m[1].replace(/<[^>]+>/g, '').trim()) : guide.titre;
};
