// Le téléchargement des fichiers.
//
// **Un fichier n'est jamais servi directement par le serveur web.** Le
// répertoire de données n'est pas exposé, et cette route est le seul chemin
// vers les octets. Elle vérifie l'autorisation avant d'ouvrir quoi que ce soit.
//
// L'identifiant public est tiré au hasard sur 128 bits : même si un lien fuit
// dans une conversation, il ne permet pas de deviner les autres.
import fs from 'fs';
import { Deps, Routeur } from '../noyau/http';
import { introuvable, refuse } from '../noyau/erreurs';
import { biensVisibles } from '../acces/roles';
import { cheminAbsolu } from './fichiers';

export function routesFichiers(deps: Deps): Routeur {
  const r = new Routeur('fichiers', deps);

  /**
   * Rendre un fichier.
   *
   * L'autorisation se déduit de ce à quoi le fichier est rattaché : la photo
   * d'un bien, le justificatif d'une dépense. Chaque module suivant
   * (coffre-fort, albums) ajoute son propre rattachement ici, et un fichier
   * **sans rattachement connu n'est jamais servi**. Le défaut est le refus.
   */
  r.get('/fichiers/:fichierId', { acces: 'authentifie' }, (ctx) => {
    const id = String(ctx.req.params.fichierId ?? '');
    if (!/^[0-9a-f]{32}$/.test(id)) throw introuvable('Ce fichier');

    const visibles = biensVisibles(ctx.portee);
    const marqueurs = visibles.map(() => '?').join(',');
    const rattache = visibles.length && (
      ctx.db.prepare(
        `SELECT 1 AS ok FROM bien WHERE photo_fichier_id = ? AND id IN (${marqueurs})`,
      ).get(id, ...visibles)
      // Un justificatif suit sa dépense : il est visible de qui voit la dépense.
      || ctx.db.prepare(`
        SELECT 1 AS ok FROM depense d
        WHERE d.justificatif_id = ? AND d.archive_le IS NULL
          AND EXISTS (SELECT 1 FROM depense_bien db WHERE db.depense_id = d.id AND db.bien_id IN (${marqueurs}))
      `).get(id, ...visibles)
    );
    if (!rattache) throw refuse("Ce fichier ne fait pas partie de ce que vous pouvez consulter.");

    const f = cheminAbsolu(ctx.db, id);
    if (!f) throw introuvable('Ce fichier');

    ctx.res.setHeader('Content-Type', f.mime);
    // Les fichiers sont adressés par un identifiant unique et immuable : le
    // navigateur peut les garder longtemps, et « private » évite qu'un cache
    // partagé en conserve une copie accessible à d'autres.
    ctx.res.setHeader('Cache-Control', 'private, max-age=604800');
    fs.createReadStream(f.chemin).pipe(ctx.res);
    return undefined;
  });

  return r;
}
