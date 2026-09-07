// La dernière version publiée sur GitHub.
//
// Comme le téléchargement du calendrier scolaire, cet appel obéit aux règles du
// projet pour toute sortie réseau : un seul hôte, en dur, revérifié après
// redirection, une temporisation courte, une taille plafonnée, et le transport
// injecté pour que tout se teste sans réseau.
//
// **Ce module ne décide de rien.** Il rend ce que GitHub annonce. Comparer à la
// version installée, et surtout installer quoi que ce soit, sont deux autres
// affaires, ailleurs, et la seconde demande un mot de passe.
//
// Le dépôt interrogé n'est pas configurable par l'interface : un dépôt
// paramétrable depuis un écran ferait de la mise à jour un moyen d'installer
// n'importe quel code pour qui obtiendrait un compte gérant. Il se change par
// variable d'environnement, donc par quelqu'un qui a déjà la main sur le
// serveur, et rien n'est perdu à cela.

import { comparer } from './versions';

export const HOTE = 'api.github.com';

/** Le dépôt officiel. Se change par `MDF_DEPOT_GITHUB`, jamais depuis l'interface. */
export const depotParDefaut = (env: NodeJS.ProcessEnv = process.env): string =>
  (env.MDF_DEPOT_GITHUB || '').trim() || 'PrudhommeWTF/Maison-De-Famille';

/** Un « owner/repo » et rien d'autre : ni chemin, ni hôte, ni requête. */
const DEPOT_VALIDE = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;

export const DELAI_MS = 10_000;
export const TAILLE_MAX = 512 * 1024;

export type Transport = (url: string, init: {
  signal: AbortSignal; redirect: 'follow'; headers: Record<string, string>;
}) => Promise<{
  ok: boolean;
  status: number;
  url: string;
  text(): Promise<string>;
}>;

export interface Release {
  tag: string;
  nom: string;
  notes: string;
  url: string;
  publieeLe: string;
}

export class VerificationImpossible extends Error {
  constructor(message: string, readonly cause?: unknown) { super(message); }
}

const entetes = (env: NodeJS.ProcessEnv): Record<string, string> => ({
  accept: 'application/vnd.github+json',
  'user-agent': 'Maison-de-Famille',
  // Un jeton n'est utile que pour un dépôt privé ou pour desserrer la limite
  // de débit anonyme. Il n'est jamais journalisé.
  ...(env.MDF_GITHUB_TOKEN ? { authorization: `Bearer ${env.MDF_GITHUB_TOKEN}` } : {}),
});

async function appeler(transport: Transport, url: string, env: NodeJS.ProcessEnv): Promise<string> {
  let r;
  try {
    r = await transport(url, {
      signal: AbortSignal.timeout(DELAI_MS), redirect: 'follow', headers: entetes(env),
    });
  } catch (e) {
    const expire = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new VerificationImpossible(
      expire
        ? `GitHub n'a pas répondu en ${DELAI_MS / 1000} secondes.`
        : "Impossible de joindre GitHub. Soit le service est indisponible, soit ce serveur n'a pas le droit de sortir sur Internet.",
      e,
    );
  }

  let hoteFinal: string;
  try { hoteFinal = new URL(r.url || url).hostname; } catch { hoteFinal = ''; }
  if (hoteFinal !== HOTE) {
    throw new VerificationImpossible(
      `La réponse ne vient pas de ${HOTE} mais de ${hoteFinal || 'une adresse illisible'}. Rien n'a été lu.`,
    );
  }

  if (r.status === 404) throw new VerificationImpossible('404');
  if (r.status === 403 || r.status === 429) {
    throw new VerificationImpossible(
      'GitHub a refusé la requête (limite de débit ou pare-feu de sortie). Réessayez plus tard.',
    );
  }
  if (!r.ok) throw new VerificationImpossible(`GitHub a répondu ${r.status}.`);

  const texte = await r.text();
  if (texte.length > TAILLE_MAX) {
    throw new VerificationImpossible('La réponse de GitHub est anormalement grosse. Elle n\'a pas été lue.');
  }
  return texte;
}

/**
 * La dernière version publiée.
 *
 * On préfère une **release** publiée, qui porte des notes lisibles. À défaut,
 * on retombe sur le plus grand tag de version : un dépôt qui pose des tags sans
 * rédiger de release reste utilisable, et c'est le cas de beaucoup de projets
 * personnels, celui-ci compris à ses débuts.
 */
export async function derniereRelease(
  transport: Transport = fetch as unknown as Transport,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Release> {
  const depot = depotParDefaut(env);
  if (!DEPOT_VALIDE.test(depot)) {
    throw new VerificationImpossible(
      `MDF_DEPOT_GITHUB vaut « ${depot} », qui n'est pas un dépôt de la forme « proprietaire/depot ».`,
    );
  }

  try {
    const j = JSON.parse(await appeler(transport, `https://${HOTE}/repos/${depot}/releases/latest`, env)) as {
      tag_name?: string; name?: string; body?: string; html_url?: string; published_at?: string;
    };
    if (j.tag_name) {
      return {
        tag: j.tag_name,
        nom: j.name || j.tag_name,
        notes: (j.body || '').slice(0, 4000),
        url: j.html_url || `https://github.com/${depot}/releases/tag/${j.tag_name}`,
        publieeLe: j.published_at || '',
      };
    }
  } catch (e) {
    // Un 404 signifie « aucune release publiée », pas « dépôt introuvable » :
    // on tente les tags avant d'abandonner. Toute autre panne remonte telle
    // quelle, avec son message.
    if (!(e instanceof VerificationImpossible && e.message === '404')) throw e;
  }

  const tags = JSON.parse(await appeler(transport, `https://${HOTE}/repos/${depot}/tags?per_page=100`, env)) as
    { name?: string }[];
  const versions = (Array.isArray(tags) ? tags : [])
    .map((t) => String(t?.name ?? ''))
    .filter((n) => /^v?\d+\.\d+/.test(n))
    .sort(comparer);
  const dernier = versions[versions.length - 1];
  if (!dernier) {
    throw new VerificationImpossible(
      `Le dépôt ${depot} ne publie ni release ni tag de version : il n'y a rien à proposer.`,
    );
  }
  return {
    tag: dernier, nom: dernier, notes: '',
    url: `https://github.com/${depot}/releases/tag/${dernier}`, publieeLe: '',
  };
}
