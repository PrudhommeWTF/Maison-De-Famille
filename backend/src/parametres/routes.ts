// La page de configuration, engendrée depuis le registre.
//
// Il n'y a pas une route par réglage, et il n'y en aura jamais : ajouter un
// paramètre consiste à ajouter une déclaration dans `registre.ts`, et l'écran
// comme les routes le prennent en charge sans être rouverts.
//
// Le découpage des routes suit les portées, pour que la garde d'accès reste
// mécanique : les réglages d'un bien passent par `/api/biens/:bienId/…` et sont
// donc protégés par le paramètre d'URL, comme tout le reste.
import type { Db } from '../noyau/db';
import { Deps, Routeur } from '../noyau/http';
import { horodatage } from '../noyau/dates';
import { invalide } from '../noyau/erreurs';
import { log } from '../noyau/log';
import { REGISTRE, SECTIONS } from './registre';
import { exposer, parametre, poser, remettreParDefaut } from './repo';

/** La valeur effective, rendue lisible pour le journal. */
const valeurLisible = (db: Db, cle: string): string =>
  String(parametre<boolean | number | string>(db, cle));

/**
 * Un réglage d'instance qui change laisse une trace nominative.
 *
 * Ces réglages commandent qui voit les dépenses et combien de temps un code
 * d'accès reste affiché : les modifier est un acte, pas un détail de confort.
 */
function tracer(db: Db, acteurId: number, cle: string, avant: string, apres: string): void {
  if (avant === apres) return;
  db.prepare(`
    INSERT INTO journal_audit (acteur_id, action, objet_kind, objet_id, detail_json, fait_le)
    VALUES (?, 'parametre.change', 'parametre', 0, ?, ?)
  `).run(acteurId, JSON.stringify({ cle, avant, apres }), horodatage());
}

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

  /**
   * Les réglages d'instance : administrateur de la plateforme, pas gérant.
   *
   * La section « Sécurité » en fait partie, et c'est un choix assumé plutôt
   * qu'un oubli : `membreFoyerVoitDepenses` et la durée d'affichage des codes
   * y vivent, donc un administrateur peut s'ouvrir une vue qu'il n'avait pas.
   * Le droit ne se donne qu'entre administrateurs, et **chaque changement est
   * écrit au journal d'audit** avec son auteur et l'ancienne valeur : à défaut
   * de l'empêcher, on peut le relire.
   */
  r.post('/parametres', { acces: 'plateforme' }, (ctx) => {
    const { cle, valeur } = cleDePortee(ctx.corps, ['instance']);
    const avant = valeurLisible(ctx.db, cle);
    poser(ctx.db, cle, valeur, {}, ctx.personneId);
    tracer(ctx.db, ctx.personneId, cle, avant, valeurLisible(ctx.db, cle));
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

  r.post('/parametres/defaut', { acces: 'plateforme' }, (ctx) => {
    const { cle } = cleDePortee(ctx.corps, ['instance']);
    const avant = valeurLisible(ctx.db, cle);
    remettreParDefaut(ctx.db, cle, {});
    tracer(ctx.db, ctx.personneId, cle, avant, valeurLisible(ctx.db, cle));
    return undefined;
  });

  return r;
}
