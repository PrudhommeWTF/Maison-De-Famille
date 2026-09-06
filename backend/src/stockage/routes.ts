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
import type { Db } from '../noyau/db';
import type { Portee } from '../acces/roles';
import { biensVisibles } from '../acces/roles';
import { parametre } from '../parametres/repo';
import { aujourdhui } from '../noyau/dates';
import type { PorteeElement, RoleSurBien } from '../coffre/portee';
import { peutVoir } from '../coffre/portee';
import { demandeur } from '../coffre/repo';
import { cheminAbsolu } from './fichiers';

/**
 * Ce fichier est-il rattaché à quelque chose que cette personne peut voir ?
 *
 * Un même fichier peut être rattaché plusieurs fois : le service de fichiers
 * dédoublonne sur l'empreinte, donc deux documents au contenu identique
 * partagent une ligne. Un seul rattachement autorisant suffit, et **aucun
 * rattachement connu ne vaut refus** : le défaut est fermé.
 */
function autorise(db: Db, portee: Portee, personneId: number, id: string): boolean {
  const visibles = biensVisibles(portee);
  if (!visibles.length) return false;
  const trous = visibles.map(() => '?').join(',');

  // La photo de couverture d'un bien : visible de qui voit le bien.
  if (db.prepare(`SELECT 1 FROM bien WHERE photo_fichier_id = ? AND id IN (${trous})`)
    .get(id, ...visibles)) return true;

  // Un justificatif suit sa dépense : il est visible de qui voit la dépense.
  if (db.prepare(`
    SELECT 1 FROM depense d
    WHERE d.justificatif_id = ? AND d.archive_le IS NULL
      AND EXISTS (SELECT 1 FROM depense_bien db WHERE db.depense_id = d.id AND db.bien_id IN (${trous}))
  `).get(id, ...visibles)) return true;

  // Une photo d'album, ou sa vignette. Même règle que l'écran Souvenirs :
  // ouvert aux membres de foyer, fermé aux invités de passage.
  const surAlbum = db.prepare(`
    SELECT DISTINCT p.bien_id AS bienId FROM photo p
    WHERE (p.fichier_id = ? OR p.vignette_id = ?) AND p.archive_le IS NULL AND p.bien_id IN (${trous})
  `).all(id, id, ...visibles) as { bienId: number }[];
  if (surAlbum.some((p) => portee.biens.get(p.bienId) !== 'invite')) return true;

  // Une version d'un document du coffre. La portée du document décide, avec la
  // même règle que l'écran : un invité en séjour ne télécharge pas l'acte
  // notarié parce qu'il en a deviné l'identifiant de fichier.
  const surCoffre = db.prepare(`
    SELECT DISTINCT d.bien_id AS bienId, d.portee FROM document_version v
    JOIN document d ON d.id = v.document_id
    WHERE v.fichier_id = ? AND d.archive_le IS NULL AND d.bien_id IN (${trous})
  `).all(id, ...visibles) as { bienId: number; portee: PorteeElement }[];
  if (surCoffre.length) {
    const jour = aujourdhui();
    const apres = parametre<number>(db, 'codesApresSejourJours');
    const f = { avant: 2, apres };
    for (const d of surCoffre) {
      const role = portee.biens.get(d.bienId) as RoleSurBien | undefined;
      if (!role) continue;
      if (peutVoir(d.portee, demandeur(db, d.bienId, personneId, role), jour, f)) return true;
    }
  }

  return false;
}

export function routesFichiers(deps: Deps): Routeur {
  const r = new Routeur('fichiers', deps);

  /**
   * Rendre un fichier.
   *
   * L'autorisation se déduit de ce à quoi le fichier est rattaché, et un
   * fichier **sans rattachement connu n'est jamais servi**. Chaque module qui
   * dépose des fichiers ajoute son rattachement dans `autorise` ci-dessus, et
   * un test vérifie qu'un fichier orphelin reste refusé.
   */
  r.get('/fichiers/:fichierId', { acces: 'authentifie' }, async (ctx) => {
    const id = String(ctx.req.params.fichierId ?? '');
    if (!/^[0-9a-f]{32}$/.test(id)) throw introuvable('Ce fichier');

    if (!autorise(ctx.db, ctx.portee, ctx.personneId, id)) {
      throw refuse('Ce fichier ne fait pas partie de ce que vous pouvez consulter.');
    }

    const f = cheminAbsolu(ctx.db, id);
    if (!f) throw introuvable('Ce fichier');

    ctx.res.setHeader('Content-Type', f.mime);
    // Les fichiers sont adressés par un identifiant unique et immuable : le
    // navigateur peut les garder longtemps, et « private » évite qu'un cache
    // partagé en conserve une copie accessible à d'autres.
    ctx.res.setHeader('Cache-Control', 'private, max-age=604800');

    // **On attend la fin de l'envoi.** Rendre la main avant que le flux n'ait
    // écrit son premier octet laissait le routeur conclure « rien à renvoyer »
    // et répondre 204 : la requête aboutissait, et l'image restait vide. Le
    // gestionnaire d'erreur, lui, évite qu'un fichier absent du disque (une
    // restauration partielle) fasse tomber le service sur un événement non
    // rattrapé.
    await new Promise<void>((resoudre, rejeter) => {
      const flux = fs.createReadStream(f.chemin);
      flux.on('error', rejeter);
      ctx.res.on('close', () => resoudre());
      flux.pipe(ctx.res).on('finish', () => resoudre());
    });
    return undefined;
  });

  return r;
}
