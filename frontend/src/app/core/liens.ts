// Rendre absolu un lien d'invitation ou d'accès temporaire.
//
// **Le problème.** Le serveur fabrique ces liens avec `MDF_PUBLIC_URL`, la seule
// adresse en laquelle il ait le droit de croire. Tant qu'elle n'est pas
// renseignée, il rend un chemin nu (« /reinitialiser?jeton=... »), que la
// gérante recopie et transmet, et qui ne mène nulle part.
//
// **Pourquoi le navigateur peut trancher, et pas le serveur.** L'origine d'un
// document est celle que la personne a réellement tapée : elle est juste par
// construction, et il n'y a rien à configurer. Le serveur, lui, ne dispose que
// de l'en-tête « Host », que n'importe quel appelant écrit comme il veut.
// L'utiliser pour bâtir un lien de réinitialisation, c'est laisser un inconnu
// décider vers quel domaine part le jeton d'une personne de la famille. C'est
// pour cela que `MDF_PUBLIC_URL` existe, et elle reste seule à valoir pour les
// courriels, qui partent sans navigateur.
//
// L'adresse publique configurée garde donc la priorité : la gérante consulte
// peut-être l'application sur l'adresse locale de la machine, quand la famille,
// elle, passe par le nom de domaine.

/**
 * L'adresse complète du lien.
 *
 * `base` est l'URL de base du document (`document.baseURI`) et non l'origine :
 * elle porte le sous-chemin quand l'application est servie sous un préfixe,
 * que `MDF_BASE_HREF` permet.
 */
export function lienAbsolu(lien: string, base: string): string {
  if (!lien) return lien;
  // Déjà absolu : c'est que l'adresse publique est configurée, elle fait foi.
  if (/^[a-z][a-z0-9+.-]*:/i.test(lien)) return lien;
  try {
    return new URL(lien.replace(/^\/+/, ''), base).toString();
  } catch {
    // Base inutilisable : rendre le chemin nu vaut mieux que rendre vide.
    return lien;
  }
}
