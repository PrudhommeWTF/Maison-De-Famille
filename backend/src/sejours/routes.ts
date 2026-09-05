// Le calendrier, les demandes et l'arbitrage. Le coeur de la tranche 1 : c'est
// ce qui remplace le fichier Excel.
//
// Deux principes visibles partout dans ce fichier :
//
//   1. **Tout passe par `/api/biens/:bienId/…`**, y compris la décision sur un
//      séjour. Un séjour ne se désigne jamais seul : il se désigne dans son
//      bien, ce qui fait appliquer la garde d'accès sur le paramètre d'URL, et
//      le gestionnaire revérifie ensuite que le séjour appartient bien à ce bien.
//   2. **L'application ne décide jamais à la place de la gérante.** Un conflit
//      est signalé, jamais bloquant ; un quota est indicatif ; un passage en
//      force est possible et journalisé. Si l'outil lui donnait le sentiment de
//      lui retirer son rôle d'arbitre, la famille reviendrait au téléphone.
import { Deps, Routeur } from '../noyau/http';
import { aujourdhui, decale, estDate, nuits } from '../noyau/dates';
import { etatInvalide, invalide, introuvable, refuse } from '../noyau/erreurs';
import { log } from '../noyau/log';
import { lire } from '../noyau/valider';
import { parametre } from '../parametres/repo';
import { bien, personne } from '../patrimoine/repo';
import { deposer } from '../notifications/file';
import { demandeDecidee, demandeNouvelle } from '../notifications/gabarits';
import { biensVisibles } from '../acces/roles';
import { Conflit, detecter } from './conflits';
import {
  Nature, annuler, annulerDecision, aVenir, conflitsDe, creer, decider, enAttente,
  occupationsDe, sejour, surPlage,
} from './repo';

const NATURES: readonly Nature[] = ['famille', 'location', 'entretien'];

/** Le mois demandé, ou le mois courant. Rendu sous forme de plage `[du, au)`. */
function plageDemandee(q: Record<string, unknown>): { du: string; au: string } {
  const du = String(q.du ?? '');
  const au = String(q.au ?? '');
  if (estDate(du) && estDate(au) && au > du) {
    // Une plage de plus de deux ans n'a aucun usage à l'écran et ferait lire
    // toute la base : elle est ramenée à deux ans.
    return { du, au: nuits(du, au) > 730 ? decale(du, 730) : au };
  }
  const t = aujourdhui();
  return { du: `${t.slice(0, 8)}01`, au: decale(`${t.slice(0, 8)}01`, 62) };
}

export function routesSejours(deps: Deps): Routeur {
  const r = new Routeur('sejours', deps);

  /**
   * Le calendrier consolidé, tous biens visibles confondus. La liste des biens
   * autorisés part dans la requête SQL : ce qui n'est pas dans la portée n'est
   * jamais lu, et pas seulement jamais affiché.
   */
  r.get('/sejours', { acces: 'authentifie' }, (ctx) => {
    const { du, au } = plageDemandee(ctx.req.query as Record<string, unknown>);
    return { du, au, sejours: surPlage(ctx.db, biensVisibles(ctx.portee), du, au) };
  });

  r.get('/biens/:bienId/sejours', { acces: 'bien', role: 'invite' }, (ctx) => {
    const { du, au } = plageDemandee(ctx.req.query as Record<string, unknown>);
    const b = bien(ctx.db, ctx.bienId);
    const sejours = surPlage(ctx.db, [ctx.bienId], du, au);
    // La bannière de conflit du calendrier : uniquement les chevauchements réels
    // et non arbitrés, comme le prévoit la maquette.
    const occupations = occupationsDe(ctx.db, ctx.bienId);
    const conflits: Conflit[] = [];
    for (const o of occupations.filter((x) => x.statut === 'demande')) {
      conflits.push(...detecter(
        { arrivee: o.arrivee, depart: o.depart, occupants: o.occupants, sejourId: o.id },
        occupations, b.couchages,
      ).filter((c) => c.nature === 'sejour_valide'));
    }
    return { du, au, sejours, conflits, couchages: b.couchages };
  });

  /**
   * La vérification des dates pendant la saisie, avant l'envoi. Elle ne crée
   * rien : elle rend ce que la gérante verra, pour que le demandeur le sache
   * avant elle. C'est le point de recette « le conflit est signalé avant l'envoi ».
   */
  r.post('/biens/:bienId/verification', { acces: 'bien', role: 'membre_foyer' }, (ctx) => {
    const l = lire(ctx.corps);
    const arrivee = l.date('arrivee');
    const depart = l.date('depart');
    const occupants = l.entier('occupants', { min: 1, max: 60 });
    const sejourId = l.idFacultatif('sejourId');
    l.fin();
    if (depart <= arrivee) {
      throw invalide('La date de départ doit être après la date d\'arrivée.', { depart: 'Après l\'arrivée.' });
    }
    const b = bien(ctx.db, ctx.bienId);
    const conflits = detecter(
      { arrivee, depart, occupants, sejourId: sejourId ?? undefined },
      occupationsDe(ctx.db, ctx.bienId), b.couchages,
    );
    return {
      nuits: nuits(arrivee, depart), couchages: b.couchages, conflits,
      envoiPossible: !(parametre<boolean>(ctx.db, 'capaciteBloquante', { bienId: ctx.bienId })
        && conflits.some((c) => c.nature === 'capacite')),
    };
  });

  /**
   * Créer un séjour.
   *
   * Deux chemins dans la même route, parce que ce sont les deux cas réels :
   *
   *   - un membre demande, le séjour naît « demande » et la gérante est
   *     prévenue ;
   *   - **la gérante saisit pour quelqu'un d'autre**, le séjour naît « valide »
   *     sans passer par le circuit de demande. Pendant des mois, certains
   *     continueront d'appeler au téléphone : il lui faut deux gestes, pas un
   *     détour par une file d'attente qu'elle validerait aussitôt.
   */
  r.post('/biens/:bienId/sejours', { acces: 'bien', role: 'membre_foyer' }, (ctx) => {
    const l = lire(ctx.corps);
    const arrivee = l.date('arrivee');
    const depart = l.date('depart');
    const occupants = l.entier('occupants', { min: 1, max: 60 });
    const note = l.texte('note', { max: 1000, defaut: '' });
    const nature = l.choix<Nature>('nature', NATURES, { defaut: 'famille' });
    const pourQui = l.idFacultatif('demandeurId');
    const titre = l.texte('titre', { max: 120, defaut: '' });
    l.fin();

    if (depart <= arrivee) {
      throw invalide('La date de départ doit être après la date d\'arrivée.', { depart: 'Après l\'arrivée.' });
    }
    const estGerante = ctx.portee.biens.get(ctx.bienId) === 'gerant';
    if ((pourQui && pourQui !== ctx.personneId) || nature !== 'famille') {
      if (!estGerante) throw refuse('Seule la gérante peut saisir un séjour pour quelqu\'un d\'autre.');
    }

    const b = bien(ctx.db, ctx.bienId);
    const conflits = detecter({ arrivee, depart, occupants }, occupationsDe(ctx.db, ctx.bienId), b.couchages);
    if (!estGerante
      && parametre<boolean>(ctx.db, 'capaciteBloquante', { bienId: ctx.bienId })
      && conflits.some((c) => c.nature === 'capacite')) {
      throw etatInvalide(`Ce bien compte ${b.couchages} couchages, et ce nombre est dépassé sur au moins une nuit.`);
    }

    const demandeurId = pourQui ?? ctx.personneId;
    const demandeur = personne(ctx.db, demandeurId);
    // Ce que la gérante saisit est décidé : elle arbitre, il n'y a personne
    // au-dessus d'elle pour valider. La faire passer par sa propre file
    // d'attente lui donnerait un geste de plus à chaque appel téléphonique.
    const statut = estGerante ? 'valide' : 'demande';

    const id = creer(ctx.db, {
      bienId: ctx.bienId, demandeurId: nature === 'famille' ? demandeurId : null,
      foyerId: demandeur.foyerId, titre: titre || demandeur.nom,
      arrivee, depart, occupants, nature, note,
      origine: estGerante ? 'gerante' : 'app',
      statut,
    }, ctx.personneId);

    if (statut === 'demande') prevenirGerants(ctx, id, conflits);
    log.info(`Séjour ${id} créé sur le bien ${ctx.bienId} (${statut}, ${arrivee} → ${depart}).`);
    return { id, statut, conflits };
  });

  /** L'arbitrage : valider, ou renvoyer la demande avec un message. */
  r.post('/biens/:bienId/sejours/:sejourId/decision', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const s = sejourDuBien(ctx.db, ctx.bienId, Number(ctx.req.params.sejourId));
    const l = lire(ctx.corps);
    const statut = l.choix('statut', ['valide', 'a_revoir'] as const);
    const note = l.texte('note', { max: 1000, defaut: '' });
    l.fin();
    if (s.statut === 'annule') throw etatInvalide('Ce séjour est annulé.');

    const b = bien(ctx.db, ctx.bienId);
    const conflits = statut === 'valide' ? conflitsDe(ctx.db, s, b.couchages) : [];
    decider(ctx.db, s.id, statut, note, ctx.personneId, conflits);

    if (s.demandeurId && s.demandeurId !== ctx.personneId) {
      deposer(ctx.db, {
        personneId: s.demandeurId, type: 'demande_decidee',
        message: demandeDecidee({
          instance: parametre<string>(ctx.db, 'instanceNom'),
          urlBase: ctx.config.publicUrl ?? '',
          bien: b.nom, arrivee: s.arrivee, depart: s.depart,
          validee: statut === 'valide', parQui: personne(ctx.db, ctx.personneId).nom, note,
        }),
      });
    }
    if (statut === 'valide' && conflits.length) {
      log.attention(`Séjour ${s.id} validé malgré ${conflits.length} conflit(s) par la personne ${ctx.personneId}.`);
    }
    return { conflits };
  });

  /** Annuler une décision la ramène en attente, sans effacer qu'elle a eu lieu. */
  r.post('/biens/:bienId/sejours/:sejourId/annulation-decision', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const s = sejourDuBien(ctx.db, ctx.bienId, Number(ctx.req.params.sejourId));
    annulerDecision(ctx.db, s.id, ctx.personneId);
    return undefined;
  });

  /** Annuler un séjour. Chacun peut retirer sa demande, la gérante peut tout annuler. */
  r.post('/biens/:bienId/sejours/:sejourId/annulation', { acces: 'bien', role: 'membre_foyer' }, (ctx) => {
    const s = sejourDuBien(ctx.db, ctx.bienId, Number(ctx.req.params.sejourId));
    const estGerante = ctx.portee.biens.get(ctx.bienId) === 'gerant';
    if (!estGerante && s.demandeurId !== ctx.personneId) {
      throw refuse('Vous ne pouvez annuler que vos propres demandes.');
    }
    annuler(ctx.db, s.id, ctx.personneId);
    return undefined;
  });

  /** La file d'attente, tous biens gérés confondus. */
  r.get('/demandes', { acces: 'authentifie' }, (ctx) => {
    const geres = [...ctx.portee.biens.entries()].filter(([, role]) => role === 'gerant').map(([id]) => id);
    const demandes = enAttente(ctx.db, geres);
    const couchages = new Map(geres.map((id) => [id, bien(ctx.db, id).couchages]));
    return demandes.map((d) => ({
      ...d,
      conflits: conflitsDe(ctx.db, d, couchages.get(d.bienId) ?? 0),
    }));
  });

  /** Les prochains séjours, pour le tableau de bord. */
  r.get('/sejours/a-venir', { acces: 'authentifie' }, (ctx) =>
    aVenir(ctx.db, biensVisibles(ctx.portee), aujourdhui()));

  return r;
}

/** Le séjour, à condition qu'il appartienne bien au bien de l'URL. */
function sejourDuBien(db: Deps['db'], bienId: number, sejourId: number) {
  if (!Number.isInteger(sejourId) || sejourId <= 0) throw introuvable('Ce séjour');
  const s = sejour(db, sejourId);
  // La garde d'accès a validé le bien de l'URL. Sans cette vérification, un
  // identifiant de séjour d'un autre bien passerait par la porte du bien
  // autorisé : c'est exactement le trou que la structure des routes évite.
  if (s.bienId !== bienId) throw introuvable('Ce séjour');
  return s;
}

/** Prévenir les gérants du bien qu'une demande est arrivée. */
function prevenirGerants(
  ctx: { db: Deps['db']; config: Deps['config']; bienId: number; personneId: number },
  sejourId: number, conflits: readonly Conflit[],
): void {
  const s = sejour(ctx.db, sejourId);
  const b = bien(ctx.db, ctx.bienId);
  const gerants = ctx.db.prepare(`
    SELECT DISTINCT r.personne_id AS id FROM role_attribue r
    JOIN bien b ON b.structure_id = r.structure_id
    WHERE b.id = ? AND r.role = 'gerant' AND r.archive_le IS NULL
  `).all(ctx.bienId) as { id: number }[];

  for (const g of gerants) {
    if (g.id === ctx.personneId) continue;
    deposer(ctx.db, {
      personneId: g.id, type: 'demande_nouvelle',
      message: demandeNouvelle({
        instance: parametre<string>(ctx.db, 'instanceNom'),
        urlBase: ctx.config.publicUrl ?? '',
        demandeur: s.demandeurNom ?? s.titre, bien: b.nom,
        arrivee: s.arrivee, depart: s.depart, nuits: s.nuits, occupants: s.occupants,
        note: s.note, conflits: conflits.map((c) => c.message),
      }),
    });
  }
}
