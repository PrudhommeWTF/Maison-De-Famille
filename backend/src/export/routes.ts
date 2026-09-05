// Export et réversibilité.
//
// « Je ne veux être prisonnier ni d'un tableur ni de ma propre application. »
// Deux sorties, donc, et les deux sont testées :
//
//   - le **CSV des séjours**, lisible dans Excel du premier coup ;
//   - l'**export complet** : la base et tous les fichiers joints dans une seule
//     archive, restaurable sur une instance vierge par une commande shell.
//
// L'export complet prend une copie **cohérente** de la base par `VACUUM INTO`,
// et non une copie du fichier : copier un fichier SQLite pendant que le journal
// WAL est actif produit une base qui s'ouvre et à laquelle il manque les
// dernières écritures, ce qui est pire qu'une erreur franche.
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { Deps, Routeur } from '../noyau/http';
import { aujourdhui, horodatage } from '../noyau/dates';
import { log } from '../noyau/log';
import { biensVisibles } from '../acces/roles';
import { surPlage } from '../sejours/repo';
import { versionCible } from '../noyau/migrations';
import { parametre } from '../parametres/repo';
import { tableau } from './csv';
import { Entree, fichiersDe, tar } from './archive';

const NATURES: Record<string, string> = { famille: 'Famille', location: 'Location', entretien: 'Entretien' };
const STATUTS: Record<string, string> = { demande: 'En attente', valide: 'Validé', a_revoir: 'À revoir', annule: 'Annulé' };

function envoyerFichier(res: import('express').Response, nom: string, type: string, contenu: Buffer | string): void {
  res.setHeader('Content-Type', type);
  // Le nom porte des accents : la RFC 6266 veut une forme repliée en ASCII pour
  // les clients anciens, et une forme UTF-8 encodée que les navigateurs actuels
  // préfèrent. Sans les deux, le fichier s'enregistre sous un nom illisible.
  const ascii = nom.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '_');
  res.setHeader('Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nom)}`);
  res.end(contenu);
}

export function routesExport(deps: Deps): Routeur {
  const r = new Routeur('export', deps);

  /** Les séjours des biens visibles, sur toute la période connue. */
  r.get('/export/sejours.csv', { acces: 'authentifie' }, (ctx) => {
    const sejours = surPlage(ctx.db, biensVisibles(ctx.portee), '1900-01-01', '2999-12-31');
    const csv = tableau(
      ['Bien', 'Titre', 'Demandeur', 'Foyer', 'Arrivée', 'Départ', 'Nuits', 'Occupants', 'Nature', 'Statut', 'Note', 'Origine', 'Créé le', 'Décidé le', 'Décidé par'],
      sejours.map((s) => [
        s.bienNom, s.titre, s.demandeurNom ?? '', s.foyerNom ?? '', s.arrivee, s.depart, s.nuits, s.occupants,
        NATURES[s.nature] ?? s.nature, STATUTS[s.statut] ?? s.statut, s.note, s.origine,
        s.creeLe.slice(0, 10), s.decideLe?.slice(0, 10) ?? '', s.decideParNom ?? '',
      ]),
    );
    envoyerFichier(ctx.res, `sejours-${aujourdhui()}.csv`, 'text/csv; charset=utf-8', csv);
    return undefined;
  });

  /**
   * L'export complet de l'instance. Réservé au gérant : l'archive contient tout,
   * y compris ce que chaque rôle ne voit pas dans l'application.
   */
  r.get('/export/instance.tar.gz', { acces: 'gerant' }, (ctx) => {
    const temporaire = path.join(os.tmpdir(), `mdf-export-${process.pid}-${Date.now()}.db`);
    try {
      ctx.db.prepare('VACUUM INTO ?').run(temporaire);
      const manifeste = {
        application: 'Maison de Famille',
        version: ctx.config.version,
        schema: versionCible(),
        instance: parametre<string>(ctx.db, 'instanceNom'),
        exporteLe: horodatage(),
        exportePar: ctx.personneId,
        contenu: {
          'maison.db': 'La base complète, copie cohérente prise par VACUUM INTO.',
          'fichiers/': 'Les pièces jointes et les photos, adressées par leur empreinte.',
        },
        restauration: 'Voir docs/sauvegarde-restauration.md',
      };
      const entrees: Entree[] = [
        { nom: 'maison-de-famille/manifeste.json', contenu: JSON.stringify(manifeste, null, 2) },
        { nom: 'maison-de-famille/maison.db', contenu: fs.readFileSync(temporaire) },
        ...fichiersDe(path.join(ctx.config.dataDir, 'fichiers'), 'maison-de-famille/fichiers'),
      ];
      const archive = zlib.gzipSync(tar(entrees), { level: 6 });
      log.info(`Export complet demandé par la personne ${ctx.personneId} (${Math.round(archive.length / 1024)} Ko).`);
      envoyerFichier(ctx.res, `maison-de-famille-${aujourdhui()}.tar.gz`, 'application/gzip', archive);
    } finally {
      // Le fichier temporaire porte une copie complète de la base : il ne reste
      // pas sur le disque, même si l'envoi échoue.
      try { fs.unlinkSync(temporaire); } catch { /* déjà parti */ }
    }
    return undefined;
  });

  return r;
}
