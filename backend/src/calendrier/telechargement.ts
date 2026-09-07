// Le téléchargement du calendrier scolaire officiel.
//
// Ces dates sont fixées par arrêté et ne se déduisent d'aucune règle : il faut
// bien qu'elles entrent quelque part. Les faire recopier à la main une fois par
// an était une corvée que personne ne pensait à faire avant de buter dessus.
//
// L'appel est permis, mais **il reste enfermé**. Les cinq garde-fous ci-dessous
// ne dépendent pas de l'interdiction qui a disparu : ils disent que ce module
// ne peut joindre qu'un seul portail public, ne rapporte que des octets, et
// n'écrit rien. Chacun a sa raison :
//
//   1. **Une seule adresse, en dur.** Aucun réglage ne permet de la changer :
//      une URL configurable ferait de ce module un moyen d'exfiltration pour
//      qui obtiendrait un compte gérant.
//   2. **Le nom d'hôte est revérifié après les redirections.** Suivre une
//      redirection sans regarder où elle mène annule le garde-fou précédent.
//   3. **Une temporisation courte.** Un portail qui ne répond pas ne doit pas
//      immobiliser une requête de la famille.
//   4. **Une taille plafonnée.** On lit un calendrier scolaire, pas un flux.
//   5. **Aucune écriture.** Ce module rend des octets. Ce qui les interprète et
//      ce qui les enregistre sont deux étapes séparées : voir `import.ts` pour
//      la lecture, et `rafraichissement.ts` pour la seule écriture qui se passe
//      d'un humain, bornée aux années absentes de la base.
//
// **Le transport est injecté** pour que tout cela se teste sans réseau. Les
// tests passent un faux qui répond ce qu'ils veulent, y compris une redirection
// vers un autre domaine ou une réponse de dix mégaoctets.

/** Le jeu de données de l'Éducation nationale, export CSV, séparateur point-virgule. */
export const SOURCE =
  'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire'
  + '/exports/csv?lang=fr&timezone=Europe%2FParis&use_labels=false&delimiter=%3B';

/** Le seul hôte que ce module accepte de joindre, avant comme après redirection. */
export const HOTE = 'data.education.gouv.fr';

/** Au-delà, ce n'est plus le calendrier scolaire, et on cesse de lire. */
export const TAILLE_MAX = 8 * 1024 * 1024;

/** Un portail qui ne répond pas ne doit pas retenir une requête de la famille. */
export const DELAI_MS = 20_000;

/** Ce que le module attend d'un transport. La signature de `fetch`, en plus étroit. */
export type Transport = (url: string, init: { signal: AbortSignal; redirect: 'follow' }) => Promise<{
  ok: boolean;
  status: number;
  url: string;
  headers: { get(nom: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/**
 * Une panne de téléchargement, avec un message écrit pour la famille.
 *
 * Le détail technique (code HTTP, cause système) va dans `cause`, pour le
 * journal du serveur. La réponse HTTP ne porte que le message.
 */
export class TelechargementImpossible extends Error {
  constructor(message: string, readonly cause?: unknown) { super(message); }
}

const OCTETS_MAX_LISIBLE = `${Math.round(TAILLE_MAX / (1024 * 1024))} Mo`;

export async function telecharger(transport: Transport = fetch as unknown as Transport): Promise<Buffer> {
  const minuteur = AbortSignal.timeout(DELAI_MS);

  let reponse;
  try {
    reponse = await transport(SOURCE, { signal: minuteur, redirect: 'follow' });
  } catch (e) {
    // Trois causes très différentes, un seul symptôme pour la famille. Le
    // message doit dire quoi regarder, sinon il ne sert à rien.
    const expire = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new TelechargementImpossible(
      expire
        ? `Le portail de l'Éducation nationale n'a pas répondu en ${DELAI_MS / 1000} secondes. Réessayez plus tard, ou déposez le fichier vous-même.`
        : "Impossible de joindre data.education.gouv.fr. Soit le portail est indisponible, soit ce serveur n'a pas le droit de sortir sur Internet. Vous pouvez toujours télécharger le fichier vous-même et le déposer ici.",
      e,
    );
  }

  // La redirection a pu mener ailleurs : sans ce contrôle, l'adresse en dur ne
  // garantirait plus rien.
  let hoteFinal: string;
  try {
    hoteFinal = new URL(reponse.url || SOURCE).hostname;
  } catch {
    hoteFinal = '';
  }
  if (hoteFinal !== HOTE) {
    throw new TelechargementImpossible(
      `La réponse ne vient pas de ${HOTE} mais de ${hoteFinal || 'une adresse illisible'}. Rien n'a été lu.`,
    );
  }

  if (!reponse.ok) {
    // Un refus d'authentification ne vient presque jamais du portail, qui est
    // ouvert : chez un auto-hébergeur, c'est le filtre de sortie du réseau qui
    // répond à sa place. Dire « le jeu de données a changé d'adresse » enverrait
    // chercher au mauvais endroit pendant une heure.
    const filtre = [401, 403, 407].includes(reponse.status);
    throw new TelechargementImpossible(
      filtre
        ? `La sortie réseau a été refusée (${reponse.status}). Le portail est public : c'est très probablement un pare-feu ou un proxy de votre réseau qui bloque la sortie de ce serveur. Déposez le fichier vous-même en attendant.`
        : `Le portail a répondu ${reponse.status}. Le jeu de données a peut-être changé d'adresse : déposez le fichier vous-même en attendant.`,
    );
  }

  const annonce = Number(reponse.headers.get('content-length') ?? 0);
  if (annonce > TAILLE_MAX) {
    throw new TelechargementImpossible(`Le fichier annoncé dépasse ${OCTETS_MAX_LISIBLE}. Rien n'a été lu.`);
  }

  const octets = Buffer.from(await reponse.arrayBuffer());
  // L'en-tête peut mentir ou manquer : c'est la taille reçue qui tranche.
  if (octets.length > TAILLE_MAX) {
    throw new TelechargementImpossible(`Le fichier reçu dépasse ${OCTETS_MAX_LISIBLE}. Il n'a pas été lu.`);
  }
  if (!octets.length) {
    throw new TelechargementImpossible('Le portail a répondu un fichier vide.');
  }
  return octets;
}
