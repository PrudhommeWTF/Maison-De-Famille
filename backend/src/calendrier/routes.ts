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
import { invalide } from '../noyau/erreurs';
import { lire } from '../noyau/tableau/tableau';
import { parametre } from '../parametres/repo';
import { feriesEntre } from './feries';
import { FichierIncomprehensible, analyser, relire } from './import';
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

  r.post('/calendrier/vacances/analyse', { acces: 'gerant' }, (ctx) => {
    const contenu = ctx.req.body;
    if (!Buffer.isBuffer(contenu) || !contenu.length) throw invalide('Aucun fichier reçu.');

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

    try {
      const rapport = analyser(lecture.lignes);
      if (!rapport.periodes.length) {
        throw invalide('Aucune période de vacances n\'a été reconnue dans ce fichier.');
      }
      return { format: lecture.format, encodage: lecture.encodage, ...rapport, deja: anneesCouvertes(ctx.db) };
    } catch (e) {
      if (e instanceof FichierIncomprehensible) throw invalide(e.message);
      throw e;
    }
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
