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
import { etatInvalide, invalide, refuse } from '../noyau/erreurs';
import { log } from '../noyau/log';
import { lire } from '../noyau/valider';
import { verifier } from '../auth/mots-de-passe';
import { etat } from '../notifications/file';
import { orphelins } from '../stockage/fichiers';
import { VerificationImpossible, depotParDefaut } from './depot';
import { declencher, enCours, statut } from './maj';
import { lireVeille, verifier as veiller } from './veille';
import { versionConnue } from './versions';

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
      maj: {
        // Le service regarde de lui-même : l'écran affiche ce qu'il a vu sans
        // qu'on lui demande. Reste le seul verrou qui compte encore, l'assistant
        // root, sans lequel le bouton d'installation ne mènerait à rien.
        installationPossible: ctx.config.majAuto,
        versionConnue: versionConnue(ctx.config.version),
        depot: depotParDefaut(),
        statut: statut(ctx.config.dataDir),
        veille: lireVeille(ctx.config.dataDir),
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

  /**
   * Y a-t-il une version plus récente, maintenant ?
   *
   * Le service regarde déjà tout seul et garde ce qu'il a vu ; ce bouton sert à
   * ne pas attendre le prochain passage. Les deux chemins passent par la même
   * fonction, sinon l'un des deux finirait par répondre autre chose que l'autre.
   * Rien n'est installé ici.
   */
  r.post('/systeme/maj/verification', { acces: 'gerant' }, async (ctx) => {
    try {
      return { ...await veiller(ctx.config.dataDir, ctx.config.version), installationPossible: ctx.config.majAuto };
    } catch (e) {
      if (e instanceof VerificationImpossible) {
        log.attention(`Vérification des versions impossible : ${e.message}`, e.cause);
        throw etatInvalide(e.message);
      }
      throw e;
    }
  });

  r.get('/systeme/maj', { acces: 'gerant' }, (ctx) => ({
    installee: ctx.config.version,
    versionConnue: versionConnue(ctx.config.version),
    installationPossible: ctx.config.majAuto,
    depot: depotParDefaut(),
    statut: statut(ctx.config.dataDir),
    veille: lireVeille(ctx.config.dataDir),
  }));

  /**
   * Lancer la mise à jour.
   *
   * **Le mot de passe est redemandé ici, et nulle part ailleurs dans
   * l'application.** Ce bouton fait exécuter du code en root sur la machine :
   * le service dépose un fichier, une unité systemd root télécharge la dernière
   * version et la compile. Le dispositif est sain, le service ne gagne aucun
   * droit, mais il transforme « compte gérant volé » en « root sur le
   * serveur ». Un jeton dérobé sur un téléphone déverrouillé ne doit pas
   * suffire : il faut aussi savoir le mot de passe.
   */
  r.post('/systeme/maj', { acces: 'gerant' }, async (ctx) => {
    if (!ctx.config.majAuto) {
      throw etatInvalide(
        "La mise à jour depuis l'interface n'est pas installée sur ce serveur. "
        + 'Relancez l\'installateur avec MAJ_AUTO=true, ou mettez à jour à la main comme le décrit docs/installation.md.',
      );
    }
    const l = lire(ctx.corps);
    const motDePasse = l.texte('motDePasse', { max: 200, min: 1 });
    l.fin();

    const moi = ctx.db.prepare('SELECT mot_de_passe_hash AS hash, email FROM personne WHERE id = ?')
      .get(ctx.personneId) as { hash: string | null; email: string } | undefined;
    if (!moi || !await verifier(motDePasse, moi.hash)) {
      log.attention(`Mise à jour refusée : mot de passe incorrect (personne ${ctx.personneId}).`);
      throw refuse(
        'Mot de passe incorrect. Cette mise à jour installe et exécute du code sur le serveur : '
        + 'elle se confirme par votre mot de passe.',
      );
    }

    // Un second clic pendant que le script tourne réécrirait l'état et
    // relancerait l'unité au milieu d'une compilation.
    if (enCours(ctx.config.dataDir)) {
      throw invalide('Une mise à jour est déjà en cours. Attendez qu\'elle se termine.');
    }

    declencher(ctx.config.dataDir);
    log.info(`Mise à jour lancée par ${moi.email} (personne ${ctx.personneId}).`);
    return { lancee: true, statut: statut(ctx.config.dataDir) };
  });

  return r;
}
