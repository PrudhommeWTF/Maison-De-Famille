// Santé et état du service.
//
// `/api/sante` répond à la sonde de Docker et du reverse-proxy : elle ne dit
// rien d'autre que « je réponds et voici ma version », parce qu'elle est
// publique.
//
// `/api/etat` est l'écran que vous ouvrirez quand quelque chose ne va pas. Il
// dit ce qu'aucun journal ne dit d'un coup d'oeil : combien de notifications
// attendent, avec quelle erreur exacte du relais, quelle version de schéma est
// appliquée, et combien d'octets traînent sans être cités par la base.
import { Deps, Routeur } from '../noyau/http';
import { versionCible } from '../noyau/migrations';
import { etat } from '../notifications/file';
import { orphelins } from '../stockage/fichiers';

export function routesSysteme(deps: Deps): Routeur {
  const r = new Routeur('systeme', deps);

  r.get('/sante', { acces: 'public' }, (ctx) => ({ ok: true, version: ctx.config.version }));

  r.get('/etat', { acces: 'gerant' }, (ctx) => {
    const migrations = ctx.db.prepare(
      'SELECT version, libelle, applique_le AS appliqueLe, duree_ms AS dureeMs FROM schema_migration ORDER BY version',
    ).all();
    const compte = (sql: string): number => (ctx.db.prepare(sql).get() as { n: number }).n;
    return {
      version: ctx.config.version,
      schema: { applique: migrations.length ? versionCible() : 0, cible: versionCible(), migrations },
      courriel: {
        // Sans relais configuré, les notifications s'accumulent sans partir :
        // c'est la première chose à vérifier quand « personne ne reçoit rien ».
        relais: ctx.config.smtp ? `${ctx.config.smtp.host}:${ctx.config.smtp.port}` : null,
        adresseExpediteur: ctx.config.smtp?.from ?? null,
        adressePublique: ctx.config.publicUrl,
        file: etat(ctx.db),
      },
      donnees: {
        repertoire: ctx.config.dataDir,
        personnes: compte('SELECT COUNT(*) AS n FROM personne WHERE archive_le IS NULL'),
        biens: compte('SELECT COUNT(*) AS n FROM bien WHERE archive_le IS NULL'),
        sejours: compte('SELECT COUNT(*) AS n FROM sejour WHERE archive_le IS NULL'),
        fichiers: compte('SELECT COUNT(*) AS n FROM fichier'),
        orphelins: orphelins(ctx.db),
      },
    };
  });

  return r;
}
