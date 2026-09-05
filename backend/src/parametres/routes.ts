// La page de configuration, engendrée depuis le registre.
//
// Il n'y a pas une route par réglage, et il n'y en aura jamais : ajouter un
// paramètre consiste à ajouter une déclaration dans `registre.ts`, et l'écran
// comme les routes le prennent en charge sans être rouverts.
//
// Le découpage des routes suit les portées, pour que la garde d'accès reste
// mécanique : les réglages d'un bien passent par `/api/biens/:bienId/…` et sont
// donc protégés par le paramètre d'URL, comme tout le reste.
import { Deps, Routeur } from '../noyau/http';
import { invalide } from '../noyau/erreurs';
import { log } from '../noyau/log';
import { REGISTRE, SECTIONS } from './registre';
import { exposer, poser, remettreParDefaut } from './repo';

/** Lit un corps `{ cle, valeur }` et refuse une clé hors de la portée attendue. */
function cleDePortee(corps: unknown, portees: readonly string[]): { cle: string; valeur: unknown } {
  const c = (corps ?? {}) as { cle?: unknown; valeur?: unknown };
  if (typeof c.cle !== 'string') throw invalide('Réglage non précisé.');
  const d = REGISTRE.find((x) => x.cle === c.cle);
  if (!d) throw invalide('Ce réglage n\'existe pas.');
  if (!portees.includes(d.portee)) throw invalide(`Le réglage « ${d.libelle} » ne se change pas ici.`);
  return { cle: c.cle, valeur: c.valeur };
}

export function routesParametres(deps: Deps): Routeur {
  const r = new Routeur('parametres', deps);

  r.get('/parametres', { acces: 'authentifie' }, (ctx) => ({
    sections: SECTIONS,
    parametres: exposer(ctx.db, { personneId: ctx.personneId }),
  }));

  r.post('/parametres', { acces: 'gerant' }, (ctx) => {
    const { cle, valeur } = cleDePortee(ctx.corps, ['instance']);
    poser(ctx.db, cle, valeur, {}, ctx.personneId);
    log.info(`Réglage « ${cle} » modifié par la personne ${ctx.personneId}.`);
    return undefined;
  });

  r.post('/parametres/personnels', { acces: 'authentifie' }, (ctx) => {
    const { cle, valeur } = cleDePortee(ctx.corps, ['personnel']);
    poser(ctx.db, cle, valeur, { personneId: ctx.personneId }, ctx.personneId);
    return undefined;
  });

  r.get('/biens/:bienId/parametres', { acces: 'bien', role: 'gerant' }, (ctx) =>
    exposer(ctx.db, { bienId: ctx.bienId }));

  r.post('/biens/:bienId/parametres', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const { cle, valeur } = cleDePortee(ctx.corps, ['bien']);
    poser(ctx.db, cle, valeur, { bienId: ctx.bienId }, ctx.personneId);
    log.info(`Réglage « ${cle} » du bien ${ctx.bienId} modifié par la personne ${ctx.personneId}.`);
    return undefined;
  });

  r.post('/parametres/defaut', { acces: 'gerant' }, (ctx) => {
    const { cle } = cleDePortee(ctx.corps, ['instance']);
    remettreParDefaut(ctx.db, cle, {});
    return undefined;
  });

  return r;
}
