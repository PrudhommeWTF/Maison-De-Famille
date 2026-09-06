// Les repères du calendrier : jours fériés et vacances scolaires.
//
// Servis à part des séjours, et non greffés sur leur réponse : ils ne dépendent
// d'aucun bien, la même plage vaut pour tout le monde, et l'écran de location
// s'en servira aussi. Une route qui rend la même chose à tout le monde se cache
// aussi derrière l'authentification : ce n'est pas un secret, mais rien de cette
// application ne répond à un inconnu.
import { Deps, Routeur } from '../noyau/http';
import { estDate } from '../noyau/dates';
import { invalide } from '../noyau/erreurs';
import { parametre } from '../parametres/repo';
import { feriesEntre } from './feries';
import { ACADEMIES, ANNEES_COUVERTES, ZONES, couvre, vacancesEntre } from './vacances';

/** Au-delà, la réponse n'a plus d'usage d'affichage et coûte pour rien. */
const JOURS_MAX = 800;

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
    return {
      feries: feriesEntre(du, au, parametre<boolean>(ctx.db, 'feriesAlsaceMoselle')),
      vacances: vacancesEntre(du, au),
      zones: ZONES,
      academies: ACADEMIES,
      // L'application dit quand elle ne sait pas, plutôt que de rendre une
      // liste vide qu'on prendrait pour « pas de vacances ».
      couvert: couvre(du, au),
      anneesCouvertes: ANNEES_COUVERTES,
    };
  });

  return r;
}
