// Décisions, scrutins et accès temporaires.
//
// Notes de comportement de la maquette, reprises telles quelles :
//
//   - « Les voix sont pondérées par les quotes-parts, pas par tête. »
//   - « La majorité requise dépend de la nature de l'acte. »
//   - « Un vote a une date de clôture ; les abstentions restent visibles
//     jusqu'au dépouillement. »
//   - « Un invité ou un locataire reçoit un accès limité dans le temps,
//     révocable. »
//
// **Aucun seuil n'est écrit dans ce fichier.** Ils viennent tous de
// `regle_decision`, semée selon le mode de la structure et modifiable ensuite :
// une convention d'indivision peut prévoir autre chose que les deux tiers, et
// des statuts de SCI prévoient à peu près tout.
import { Deps, Routeur } from '../noyau/http';
import { aujourdhui, decale, estDate } from '../noyau/dates';
import { etatInvalide, introuvable, invalide } from '../noyau/erreurs';
import { log } from '../noyau/log';
import { lire } from '../noyau/valider';
import { parametre } from '../parametres/repo';
import { deposer } from '../notifications/file';
import { voteClotureProche, voteOuvert } from '../notifications/gabarits';
import { reglesDe, structure } from '../patrimoine/repo';
import { liste as listeAcces, ouvrir as ouvrirAcces, revoquer as revoquerAcces } from '../acces/temporaire';
import type { Db } from '../noyau/db';
import type { Config } from '../noyau/config';
import { ScrutinImpossible } from './majorite';
import {
  annuler, depouillerEtClore, ouvrir, scrutins, voixDe, voter, vue,
} from './repo';

const SENS = ['pour', 'contre', 'abstention'] as const;

/** Trois jours : assez pour réagir, assez court pour que le rappel serve. */
const JOURS_RAPPEL = 3;

export function routesDecisions(deps: Deps): Routeur {
  const r = new Routeur('decisions', deps);

  const traduire = <T>(f: () => T): T => {
    try { return f(); } catch (e) {
      if (e instanceof ScrutinImpossible) throw etatInvalide(e.message);
      throw e;
    }
  };

  /**
   * Les décisions d'une structure. Ouvert à tous ceux qui la voient : « toute
   * décision est horodatée et visible de tous les indivisaires », dit la
   * maquette, et une décision cachée à ceux qu'elle engage serait une décision
   * contestée.
   */
  r.get('/structures/:structureId/decisions', { acces: 'structure', role: 'membre_foyer' }, (ctx) => {
    const s = structure(ctx.db, ctx.structureId);
    const regles = reglesDe(ctx.db, ctx.structureId);
    return {
      structure: { id: s.id, nom: s.nom, mode: s.mode },
      regles,
      // Une structure dont aucun acte ne demande de vote (le nom propre) le dit
      // à l'écran, plutôt que d'offrir un bouton qui refusera.
      voteApplicable: regles.some((x) => x.voteRequis),
      scrutins: scrutins(ctx.db, ctx.structureId).map((x) => ({
        ...x,
        regle: regles.find((g) => g.id === x.regleId)?.libelle ?? '',
        resultat: x.resultatJson ? JSON.parse(x.resultatJson) : null,
        resultatJson: undefined,
      })),
    };
  });

  r.get('/structures/:structureId/decisions/:scrutinId', { acces: 'structure', role: 'membre_foyer' }, (ctx) =>
    traduire(() => vue(ctx.db, ctx.structureId, Number(ctx.req.params.scrutinId), ctx.personneId)));

  r.post('/structures/:structureId/decisions', { acces: 'structure', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const regleId = l.entier('regleId', { min: 1 });
    const titre = l.texte('titre', { max: 200 });
    const expose = l.texte('expose', { max: 5000, defaut: '' });
    const montantCents = l.entierFacultatif('montantCents', { min: 0, max: 1_000_000_000 });
    const bienId = l.idFacultatif('bienId');
    const clotureLe = l.texte('clotureLe', { max: 10 });
    const convoqueLe = l.texte('convoqueLe', { max: 10, defaut: '' });
    l.fin();
    if (!estDate(clotureLe)) throw invalide('La date de clôture doit être au format AAAA-MM-JJ.');
    if (convoqueLe && !estDate(convoqueLe)) throw invalide('La date de convocation doit être au format AAAA-MM-JJ.');

    const id = traduire(() => ouvrir(ctx.db, ctx.structureId, {
      regleId, titre, expose, montantCents: montantCents ?? null, bienId,
      clotureLe, convoqueLe: convoqueLe || null,
    }, ctx.personneId));

    prevenirOuverture(ctx.db, ctx.config, ctx.structureId, id);
    return { id };
  });

  /**
   * Voter, et consulter le scrutin auquel on est convoqué.
   *
   * **Ces deux routes ne portent pas de structure dans leur adresse, et c'est
   * délibéré.** Le corps électoral est figé à l'ouverture : quelqu'un qui cède
   * ses parts pendant le scrutin garde sa voix, mais il perd du même coup sa
   * portée sur la structure, si bien qu'une route gardée par cette portée lui
   * fermerait la porte. Le convoquer puis l'empêcher de répondre n'aurait aucun
   * sens, et rendrait sa voix figée équivalente à une abstention imposée.
   *
   * L'autorisation ne vient donc pas de la portée mais de **l'inscription sur
   * la liste électorale** : `voter` refuse toute personne qui n'a pas de ligne
   * dans `scrutin_voix`, et cette ligne ne désigne que sa propre voix. C'est
   * une autorisation plus étroite que la portée, pas plus large.
   */
  r.get('/scrutins/:scrutinId', { acces: 'authentifie' }, (ctx) => {
    const id = Number(ctx.req.params.scrutinId);
    const s = ctx.db.prepare(
      `SELECT s.structure_id AS structureId FROM scrutin s
       JOIN scrutin_voix v ON v.scrutin_id = s.id AND v.personne_id = ?
       WHERE s.id = ? AND s.archive_le IS NULL`,
    ).get(ctx.personneId, id) as { structureId: number } | undefined;
    if (!s) throw introuvable('Ce scrutin');
    return traduire(() => vue(ctx.db, s.structureId, id, ctx.personneId));
  });

  r.post('/scrutins/:scrutinId/voix', { acces: 'authentifie' }, (ctx) => {
    const l = lire(ctx.corps);
    const sens = l.choix('sens', SENS);
    l.fin();
    const id = Number(ctx.req.params.scrutinId);
    const s = ctx.db.prepare(
      `SELECT s.structure_id AS structureId FROM scrutin s
       JOIN scrutin_voix v ON v.scrutin_id = s.id AND v.personne_id = ?
       WHERE s.id = ? AND s.archive_le IS NULL`,
    ).get(ctx.personneId, id) as { structureId: number } | undefined;
    if (!s) {
      throw etatInvalide(
        'Vous ne faites pas partie du corps électoral de ce scrutin, figé à son ouverture. '
        + 'Si vous avez acquis des parts depuis, elles compteront au prochain vote.');
    }
    voter(ctx.db, s.structureId, id, ctx.personneId, sens);
    return vue(ctx.db, s.structureId, id, ctx.personneId);
  });

  r.post('/structures/:structureId/decisions/:scrutinId/depouillement', { acces: 'structure', role: 'gerant' }, (ctx) =>
    traduire(() => depouillerEtClore(ctx.db, ctx.structureId, Number(ctx.req.params.scrutinId), ctx.personneId)));

  r.post('/structures/:structureId/decisions/:scrutinId/annulation', { acces: 'structure', role: 'gerant' }, (ctx) => {
    annuler(ctx.db, ctx.structureId, Number(ctx.req.params.scrutinId), ctx.personneId);
    return undefined;
  });

  // ---------- Accès temporaires ----------

  /**
   * Les accès ouverts sur un bien. Réservé au gérant : la liste dit qui peut
   * entrer, ce qui est une information de sécurité.
   */
  r.get('/biens/:bienId/acces', { acces: 'bien', role: 'gerant' }, (ctx) =>
    listeAcces(ctx.db, ctx.bienId));

  r.post('/biens/:bienId/acces', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const libelle = l.texte('libelle', { max: 200 });
    const email = l.texte('email', { max: 200, defaut: '' }).toLowerCase();
    const sejourId = l.idFacultatif('sejourId');
    const expireLe = l.texte('expireLe', { max: 10 });
    l.fin();
    if (!estDate(expireLe)) throw invalide('La date de fin doit être au format AAAA-MM-JJ.');
    if (expireLe < aujourdhui()) throw invalide('Un accès qui expire dans le passé ne servirait à personne.');
    // Un an est déjà très long pour un « accès temporaire » : au-delà, ce n'est
    // plus un lien de passage, c'est un compte, et il faut le créer comme tel.
    if (expireLe > decale(aujourdhui(), 366)) {
      throw invalide(
        'Un accès temporaire ne dépasse pas un an. Au-delà, ouvrez un vrai compte '
        + 'depuis l\'écran « Personnes et rôles ».');
    }
    // Sans adresse publique, le lien sort en chemin nu et l'écran le complète
    // avec l'adresse du navigateur. On refusait ici, ce qui interdisait purement
    // d'ouvrir un accès sur une instance dont l'adresse n'est pas déclarée, alors
    // que la gérante a le lien sous les yeux et sait sur quel domaine elle est.
    // Aucun courriel ne porte ce lien, et un relais SMTP ne peut pas être
    // configuré sans adresse publique (le service refuse de démarrer) : il n'y a
    // donc pas de chemin par lequel un lien incomplet parte à quelqu'un.
    return ouvrirAcces(ctx.db, ctx.bienId,
      { libelle, email: email || null, sejourId, expireLe }, ctx.personneId, ctx.config.publicUrl ?? '');
  });

  r.post('/biens/:bienId/acces/:accesId/revocation', { acces: 'bien', role: 'gerant' }, (ctx) => {
    revoquerAcces(ctx.db, ctx.bienId, Number(ctx.req.params.accesId), ctx.personneId);
    return undefined;
  });

  return r;
}

/** Prévient les électeurs qu'un vote s'ouvre. */
function prevenirOuverture(db: Db, config: Config, structureId: number, scrutinId: number): void {
  const s = structure(db, structureId);
  const v = vue(db, structureId, scrutinId, 0);
  let partis = 0;
  for (const e of voixDe(db, scrutinId)) {
    if (deposer(db, {
      personneId: e.personneId, type: 'vote_ouvert',
      message: voteOuvert({
        instance: parametre<string>(db, 'instanceNom'),
        urlBase: config.publicUrl ?? '',
        titre: v.scrutin.titre, structure: s.nom, regle: v.regle.libelle,
        clotureLe: v.scrutin.clotureLe, expose: v.scrutin.expose,
      }),
    })) partis++;
  }
  if (partis) log.info(`Scrutin ${scrutinId} : ${partis} électeur(s) prévenu(s) de l'ouverture.`);
}

/**
 * Le rappel avant clôture. Rend le nombre de messages mis en file.
 *
 * **Seulement à qui n'a pas voté.** Rappeler à quelqu'un qui s'est déjà
 * prononcé que le vote se clôt est du bruit, et le bruit fait qu'on cesse de
 * lire les messages qui comptent.
 *
 * Le jour est injecté pour que « trois jours avant » soit vérifiable au jour
 * près, comme la checklist de départ.
 */
export function rappelerClotures(db: Db, config: Config, jour = aujourdhui()): number {
  const cible = decale(jour, JOURS_RAPPEL);
  const ouverts = db.prepare(
    `SELECT s.id, s.structure_id AS structureId FROM scrutin s
     WHERE s.statut = 'ouvert' AND s.archive_le IS NULL AND s.cloture_le = ?`,
  ).all(cible) as { id: number; structureId: number }[];

  let mis = 0;
  for (const o of ouverts) {
    const s = structure(db, o.structureId);
    const v = vue(db, o.structureId, o.id, 0);
    for (const e of voixDe(db, o.id)) {
      if (e.sens !== null) continue;
      if (deposer(db, {
        personneId: e.personneId, type: 'vote_cloture_proche',
        message: voteClotureProche({
          instance: parametre<string>(db, 'instanceNom'),
          urlBase: config.publicUrl ?? '',
          titre: v.scrutin.titre, structure: s.nom, regle: v.regle.libelle,
          clotureLe: v.scrutin.clotureLe, expose: v.scrutin.expose, jours: JOURS_RAPPEL,
        }),
      })) mis++;
    }
  }
  if (mis) log.info(`${mis} rappel(s) de clôture de vote mis en file.`);
  return mis;
}
