// Le carnet d'entretien : récurrences, tâches, inventaire, checklist de départ.
//
// Note de comportement de la maquette, reprise telle quelle :
//
//   - « Les récurrences génèrent automatiquement une tâche avec sa date limite
//     légale ou d'usage. »
//   - « Cocher une tâche demande une date de réalisation et accepte une
//     facture. »
//   - « La checklist de départ part la veille de chaque fin de séjour à
//     l'occupant. »
//
// Qui peut quoi : **tout membre rattaché au bien lit le carnet**, parce que
// savoir que la chaudière est contrôlée intéresse tout le monde et que cacher
// l'entretien n'a jamais évité une panne. Seul un gérant crée, coche ou
// supprime, sauf le signalement de casse, ouvert aux membres de foyer : celui
// qui casse un matelas est rarement celui qui gère le bien.
import { Deps, Routeur } from '../noyau/http';
import { aujourdhui, estDate } from '../noyau/dates';
import { invalide } from '../noyau/erreurs';
import { log } from '../noyau/log';
import { lire } from '../noyau/valider';
import { parametre } from '../parametres/repo';
import { deposer as deposerFichier } from '../stockage/fichiers';
import { deposer } from '../notifications/file';
import { checklistDepart } from '../notifications/gabarits';
import { biensVisibles } from '../acces/roles';
import type { Db } from '../noyau/db';
import type { Config } from '../noyau/config';
import { rappelerClotures } from '../decisions/routes';
import { creerAlbumsDesSejoursFinis } from '../location/routes';
import { Categorie, Periodicite, lisible, urgence } from './recurrences';
import {
  archiverChecklist, archiverInventaire, archiverRecurrence, archiverTache, checklist,
  creerChecklist, creerInventaire, creerRecurrence, creerTache, echeancesProches, engendrer,
  inventaire, marquerChecklistEnvoyee, marquerFaite, modifierInventaire, recurrences, rouvrir,
  sejoursAPrevenir, signalerCasse, tache, taches,
} from './repo';

const CATEGORIES: readonly Categorie[] = ['obligatoire', 'saison', 'courant', 'inventaire'];
const PERIODICITES: readonly Periodicite[] = ['annuelle', 'mensuelle', 'sejour'];

export function routesEntretien(deps: Deps): Routeur {
  const r = new Routeur('entretien', deps);

  /** Le carnet d'un bien : tâches ouvertes, historique, récurrences, checklist. */
  r.get('/biens/:bienId/entretien', { acces: 'bien', role: 'membre_foyer' }, (ctx) => {
    // L'engendrement se fait à la lecture pour un gérant : il est idempotent, et
    // c'est le moment où quelqu'un regarde vraiment le carnet.
    if (ctx.portee.biens.get(ctx.bienId) === 'gerant') engendrer(ctx.db, ctx.bienId, ctx.personneId);
    const t = aujourdhui();
    return {
      ouvertes: taches(ctx.db, ctx.bienId, 'ouverte').map((x) => ({ ...x, urgence: urgence(x.echeance, t) })),
      historique: taches(ctx.db, ctx.bienId, 'faite').slice(0, 50),
      recurrences: recurrences(ctx.db, ctx.bienId).map((x) => ({ ...x, lisible: lisible(x) })),
      checklist: checklist(ctx.db, ctx.bienId),
      inventaire: inventaire(ctx.db, ctx.bienId),
    };
  });

  r.post('/biens/:bienId/taches', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const libelle = l.texte('libelle', { max: 200 });
    const detail = l.texte('detail', { max: 2000, defaut: '' });
    const categorie = l.choix<Categorie>('categorie', CATEGORIES);
    const echeance = l.texte('echeance', { max: 10, defaut: '' });
    l.fin();
    if (echeance && !estDate(echeance)) throw invalide('La date limite doit être au format AAAA-MM-JJ.');
    return { id: creerTache(ctx.db, {
      bienId: ctx.bienId, libelle, detail, categorie, echeance: echeance || null,
    }, ctx.personneId) };
  });

  /**
   * Cocher une tâche. La date de réalisation est **demandée**, jamais déduite :
   * une haie taillée le 12 juin et cochée le 3 septembre reste taillée le 12.
   */
  r.post('/biens/:bienId/taches/:tacheId/realisation', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const id = Number(ctx.req.params.tacheId);
    const l = lire(ctx.corps);
    const faitLe = l.texte('faitLe', { max: 10 });
    const coutCents = l.entierFacultatif('coutCents', { min: 0, max: 100_000_000 });
    const fichierId = l.texte('fichierId', { max: 64, defaut: '' });
    l.fin();
    if (!estDate(faitLe)) throw invalide('La date de réalisation doit être au format AAAA-MM-JJ.');
    if (faitLe > aujourdhui()) {
      throw invalide('Une tâche ne peut pas avoir été faite dans le futur.');
    }
    marquerFaite(ctx.db, ctx.bienId, id,
      { faitLe, coutCents: coutCents ?? null, fichierId: fichierId || null, depenseId: null },
      ctx.personneId);
    return tache(ctx.db, ctx.bienId, id);
  });

  r.post('/biens/:bienId/taches/:tacheId/reouverture', { acces: 'bien', role: 'gerant' }, (ctx) => {
    rouvrir(ctx.db, ctx.bienId, Number(ctx.req.params.tacheId));
    return undefined;
  });

  r.post('/biens/:bienId/taches/:tacheId/archivage', { acces: 'bien', role: 'gerant' }, (ctx) => {
    archiverTache(ctx.db, ctx.bienId, Number(ctx.req.params.tacheId));
    return undefined;
  });

  /** La facture d'une tâche. Même service de fichiers que les justificatifs. */
  r.post('/biens/:bienId/entretien/facture', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const nom = l.texte('nom', { max: 255 });
    const contenu = l.texte('contenu', { max: 30_000_000 });
    l.fin();
    const octets = Buffer.from(contenu, 'base64');
    const d = deposerFichier(ctx.db, octets, nom, ctx.personneId,
      parametre<number>(ctx.db, 'fichierTailleMaxMo'));
    return { id: d.fichier.id, mime: d.fichier.mime, taille: d.fichier.taille };
  });

  // ---------- Récurrences ----------

  r.post('/biens/:bienId/recurrences', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const libelle = l.texte('libelle', { max: 200 });
    const categorie = l.choix<Categorie>('categorie', CATEGORIES);
    const periodicite = l.choix<Periodicite>('periodicite', PERIODICITES);
    const limiteMmjj = l.texte('limiteMmjj', { max: 5, defaut: '' });
    const moisDebut = l.entierFacultatif('moisDebut', { min: 1, max: 12 });
    const moisFin = l.entierFacultatif('moisFin', { min: 1, max: 12 });
    l.fin();
    return { id: creerRecurrence(ctx.db, ctx.bienId, {
      libelle, categorie, periodicite,
      limiteMmjj: limiteMmjj || null, moisDebut: moisDebut ?? null, moisFin: moisFin ?? null,
    }, ctx.personneId) };
  });

  r.post('/biens/:bienId/recurrences/:recurrenceId/archivage', { acces: 'bien', role: 'gerant' }, (ctx) => {
    archiverRecurrence(ctx.db, ctx.bienId, Number(ctx.req.params.recurrenceId));
    return undefined;
  });

  // ---------- Inventaire ----------

  r.get('/biens/:bienId/inventaire', { acces: 'bien', role: 'membre_foyer' }, (ctx) =>
    inventaire(ctx.db, ctx.bienId));

  r.post('/biens/:bienId/inventaire', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const libelle = l.texte('libelle', { max: 200 });
    const etat = l.texte('etat', { max: 100, defaut: '' });
    const ordre = l.entierFacultatif('ordre', { min: 0, max: 9999 });
    l.fin();
    return { id: creerInventaire(ctx.db, ctx.bienId, libelle, etat, ordre ?? 0) };
  });

  r.post('/biens/:bienId/inventaire/:ligneId', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const libelle = l.texte('libelle', { max: 200 });
    const etat = l.texte('etat', { max: 100, defaut: '' });
    l.fin();
    modifierInventaire(ctx.db, ctx.bienId, Number(ctx.req.params.ligneId), libelle, etat);
    return undefined;
  });

  r.post('/biens/:bienId/inventaire/:ligneId/archivage', { acces: 'bien', role: 'gerant' }, (ctx) => {
    archiverInventaire(ctx.db, ctx.bienId, Number(ctx.req.params.ligneId));
    return undefined;
  });

  /**
   * Le signalement de casse, ouvert aux **membres de foyer**. Celui qui casse un
   * matelas est rarement celui qui gère le bien, et l'obliger à écrire à la
   * gérante pour signaler ferait perdre l'information.
   */
  r.post('/biens/:bienId/casse', { acces: 'bien', role: 'membre_foyer' }, (ctx) => {
    const l = lire(ctx.corps);
    const libelle = l.texte('libelle', { max: 200 });
    const detail = l.texte('detail', { max: 2000, defaut: '' });
    const inventaireId = l.idFacultatif('inventaireId');
    l.fin();
    return signalerCasse(ctx.db, ctx.bienId, { libelle, detail, inventaireId }, ctx.personneId);
  });

  // ---------- Checklist de départ ----------

  r.post('/biens/:bienId/checklist', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const libelle = l.texte('libelle', { max: 200 });
    const ordre = l.entierFacultatif('ordre', { min: 0, max: 9999 });
    l.fin();
    return { id: creerChecklist(ctx.db, ctx.bienId, libelle, ordre ?? 0) };
  });

  r.post('/biens/:bienId/checklist/:ligneId/archivage', { acces: 'bien', role: 'gerant' }, (ctx) => {
    archiverChecklist(ctx.db, ctx.bienId, Number(ctx.req.params.ligneId));
    return undefined;
  });

  /** Les échéances proches, tous biens visibles : la tuile du tableau de bord. */
  r.get('/entretien/echeances', { acces: 'authentifie' }, (ctx) => {
    const t = aujourdhui();
    return echeancesProches(ctx.db, biensVisibles(ctx.portee))
      .map((x) => ({ ...x, urgence: urgence(x.echeance, t) }));
  });

  return r;
}

/**
 * L'envoi des checklists de départ. Rend le nombre de messages mis en file.
 *
 * Séparé des routes pour être appelable par l'ordonnanceur **et** par un test,
 * avec un jour injecté. Une fonction qui lit l'horloge n'est pas testable au
 * jour près, et « la veille de la fin du séjour » est exactement ce qu'il faut
 * vérifier au jour près.
 */
export function envoyerChecklists(db: Db, config: Config, jour = aujourdhui()): number {
  let mis = 0;
  for (const s of sejoursAPrevenir(db, jour)) {
    const lignes = checklist(db, s.bienId).map((l) => l.libelle);
    // Un bien sans checklist ne déclenche pas un courriel vide : on marque
    // quand même le séjour, sinon la boucle le reprendrait chaque heure.
    if (lignes.length) {
      const envoye = deposer(db, {
        personneId: s.demandeurId,
        type: 'checklist_depart',
        message: checklistDepart({
          instance: parametre<string>(db, 'instanceNom'),
          urlBase: config.publicUrl ?? '',
          bien: s.bienNom, depart: s.depart, lignes,
        }),
      });
      if (envoye) mis++;
    }
    marquerChecklistEnvoyee(db, s.id);
  }
  if (mis) log.info(`${mis} checklist(s) de départ mise(s) en file.`);
  return mis;
}

/**
 * Le passage quotidien : checklists, rappels de clôture de vote, échéances
 * d'entretien à engendrer, et albums des séjours terminés.
 *
 * Une fois au démarrage, puis toutes les heures. L'heure plutôt que la journée
 * parce qu'un service redémarré à 23 h 50 ne doit pas sauter le passage du
 * lendemain, et parce que les deux opérations sont idempotentes : les repasser
 * ne coûte rien et ne double rien.
 */
export function demarrerEntretien(db: Db, config: Config): () => void {
  const passer = (): void => {
    try {
      envoyerChecklists(db, config);
      rappelerClotures(db, config);
      creerAlbumsDesSejoursFinis(db);
      for (const b of db.prepare('SELECT id FROM bien WHERE archive_le IS NULL').all() as { id: number }[]) {
        engendrer(db, b.id, 0);
      }
    } catch (e) {
      log.erreur("Passage quotidien de l'entretien en échec", e);
    }
  };
  passer();
  const minuterie = setInterval(passer, 3_600_000);
  minuterie.unref();
  return () => clearInterval(minuterie);
}
