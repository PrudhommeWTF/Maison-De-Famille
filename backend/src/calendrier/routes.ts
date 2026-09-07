// Les repères du calendrier : jours fériés et vacances scolaires.
//
// Servis à part des séjours, et non greffés sur leur réponse : ils ne dépendent
// d'aucun bien, la même plage vaut pour tout le monde, et l'écran de location
// s'en servira aussi. Une route qui rend la même chose à tout le monde se cache
// aussi derrière l'authentification : ce n'est pas un secret, mais rien de cette
// application ne répond à un inconnu.
//
// L'import suit le même déroulé que celui du planning : **analyse** d'abord,
// qui ne fait qu'expliquer ce qui a été lu, puis **enregistrement**, sur
// confirmation. Ce qui revient du navigateur est revérifié intégralement.
import { Deps, Routeur } from '../noyau/http';
import { estDate } from '../noyau/dates';
import { etatInvalide, invalide } from '../noyau/erreurs';
import { log } from '../noyau/log';
import { lire } from '../noyau/tableau/tableau';
import { parametre } from '../parametres/repo';
import { feriesEntre } from './feries';
import { FichierIncomprehensible, analyser, relire } from './import';
import { HOTE, TelechargementImpossible, telecharger } from './telechargement';
import { anneesCouvertes, periodesEntre, remplacer, resume } from './repo';
import { ACADEMIES, ZONES, couvre, entre } from './vacances';

/** Au-delà, la réponse n'a plus d'usage d'affichage et coûte pour rien. */
const JOURS_MAX = 800;

/** Le fichier officiel couvre plusieurs années et reste très en dessous. */
const LIGNES_MAX = 20_000;

export function routesCalendrier(deps: Deps): Routeur {
  const r = new Routeur('calendrier', deps);

  r.get('/calendrier/reperes', { acces: 'authentifie' }, (ctx) => {
    const du = String(ctx.req.query.du ?? '');
    const au = String(ctx.req.query.au ?? '');
    if (!estDate(du) || !estDate(au) || au < du) {
      throw invalide('Indiquez une plage de dates au format AAAA-MM-JJ, la fin après le début.');
    }
    if ((Date.parse(au) - Date.parse(du)) / 86_400_000 > JOURS_MAX) {
      throw invalide('La plage demandée dépasse deux ans.');
    }
    const annees = anneesCouvertes(ctx.db);
    return {
      feries: feriesEntre(du, au, parametre<boolean>(ctx.db, 'feriesAlsaceMoselle')),
      vacances: entre(periodesEntre(ctx.db, du, au), du, au),
      zones: ZONES,
      academies: ACADEMIES,
      // L'application dit quand elle ne sait pas, plutôt que de rendre une
      // liste vide qu'on prendrait pour « pas de vacances ».
      couvert: couvre(du, au, annees),
      anneesCouvertes: annees,
    };
  });

  r.get('/calendrier/vacances', { acces: 'gerant' }, (ctx) => ({ annees: resume(ctx.db) }));

  /**
   * L'aperçu, quelle que soit la provenance des octets.
   *
   * Le fichier déposé à la main et le fichier téléchargé passent exactement par
   * le même chemin : même lecture, même analyse, même aperçu, même confirmation.
   * Sans cela, l'un des deux finirait par diverger, et ce serait celui qu'on
   * regarde le moins.
   */
  const apercuDe = (db: Deps['db'], contenu: Buffer, source: string) => {
    let lecture;
    try {
      lecture = lire(contenu);
    } catch (e) {
      // Le message vient du lecteur et dit quoi faire (réenregistrer en .xlsx,
      // exporter en CSV) : le remplacer ferait perdre l'information utile.
      throw invalide(e instanceof Error ? e.message : "Ce fichier n'a pas pu être lu.");
    }
    if (!lecture.lignes.length) throw invalide('Ce fichier ne contient aucune ligne.');
    if (lecture.lignes.length > LIGNES_MAX) {
      throw invalide(`Ce fichier compte ${lecture.lignes.length} lignes, la limite est de ${LIGNES_MAX}.`);
    }
    let rapport;
    try {
      rapport = analyser(lecture.lignes);
    } catch (e) {
      if (e instanceof FichierIncomprehensible) throw invalide(e.message);
      throw e;
    }
    if (!rapport.periodes.length) {
      throw invalide("Aucune période de vacances n'a été reconnue dans ce fichier.");
    }
    return {
      format: lecture.format, encodage: lecture.encodage, source, ...rapport, deja: anneesCouvertes(db),
    };
  };

  r.post('/calendrier/vacances/analyse', { acces: 'gerant' }, (ctx) => {
    const contenu = ctx.req.body;
    if (!Buffer.isBuffer(contenu) || !contenu.length) throw invalide('Aucun fichier reçu.');
    return apercuDe(ctx.db, contenu, String(ctx.req.query.nom ?? 'fichier déposé').slice(0, 200));
  });

  /**
   * Le même aperçu, mais les octets viennent du portail de l'Éducation
   * nationale au lieu du disque de la famille.
   *
   * **C'est le seul appel réseau sortant de l'application**, en dehors du relais
   * SMTP, et il n'existe que si un gérant l'a explicitement allumé. Il n'écrit
   * rien : comme un dépôt de fichier, il rend un aperçu qu'il faut confirmer.
   */
  r.post('/calendrier/vacances/telechargement', { acces: 'gerant' }, async (ctx) => {
    if (!parametre<boolean>(ctx.db, 'vacancesTelechargement')) {
      throw etatInvalide(
        "Le téléchargement du calendrier scolaire n'est pas autorisé sur cette instance. "
        + 'Un gérant peut l\'activer dans les Réglages, section « Général ». '
        + 'En attendant, téléchargez le fichier vous-même et déposez-le ici.',
      );
    }
    let octets: Buffer;
    try {
      octets = await telecharger();
    } catch (e) {
      if (e instanceof TelechargementImpossible) {
        // Le détail technique va au journal, jamais dans la réponse.
        log.attention(`Téléchargement du calendrier scolaire impossible : ${e.message}`, e.cause);
        throw etatInvalide(e.message);
      }
      throw e;
    }
    log.info(`Calendrier scolaire téléchargé depuis ${HOTE} par la personne ${ctx.personneId} (${octets.length} octets).`);
    return apercuDe(ctx.db, octets, HOTE);
  });

  r.post('/calendrier/vacances', { acces: 'gerant' }, (ctx) => {
    const c = (ctx.corps ?? {}) as Record<string, unknown>;
    let periodes;
    try {
      periodes = relire(c.periodes);
    } catch (e) {
      if (e instanceof FichierIncomprehensible) throw invalide(e.message);
      throw e;
    }
    const source = String(c.source ?? '').trim() || 'Fichier téléversé';
    return remplacer(ctx.db, periodes, source, ctx.personneId);
  });

  return r;
}
