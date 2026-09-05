// Les routes de l'argent.
//
// Comme partout, tout ce qui porte sur un bien passe par `/api/biens/:bienId/…`
// et tout ce qui porte sur une structure par `/api/structures/:structureId/…` :
// c'est ce qui fait appliquer la garde d'accès mécaniquement.
//
// Une dépense, elle, appartient à une **structure** (c'est là que l'argent est
// dû), et se rattache à un ou plusieurs biens de cette structure. Les routes qui
// la désignent vivent donc sous la structure, et le gestionnaire revérifie que
// la dépense lui appartient bien.
import { Deps, Routeur } from '../noyau/http';
import { aujourdhui, decale } from '../noyau/dates';
import { etatInvalide, introuvable, invalide, refuse } from '../noyau/erreurs';
import { log } from '../noyau/log';
import { lire } from '../noyau/valider';
import { parametre } from '../parametres/repo';
import { VOCABULAIRE, bien, structure } from '../patrimoine/repo';
import { deposer } from '../notifications/file';
import { appelDeFonds } from '../notifications/gabarits';
import { biensVisibles } from '../acces/roles';
import { REGLES, Regle, expliquer } from './repartition';
import { STRUCTURE } from './soldes';
import {
  annulerDepense, appelsDe, avancerReglement, categories, creerDepense, creerReglement,
  depense, emettreAppel, nomActeur, recalculer, recalculsDe, reglementsDe, reglesDuBien,
  changerRegle, soldesDe, surPeriode, ventilationDe, virementsProposes,
} from './repo';

/** L'exercice demandé, ou l'année courante. */
function exercice(q: Record<string, unknown>): { annee: number; du: string; au: string } {
  const brut = Number(q.annee);
  const annee = Number.isInteger(brut) && brut >= 1900 && brut <= 2200 ? brut : Number(aujourdhui().slice(0, 4));
  return { annee, du: `${annee}-01-01`, au: `${annee}-12-31` };
}

export function routesArgent(deps: Deps): Routeur {
  const r = new Routeur('argent', deps);

  /**
   * Un membre de foyer voit-il les dépenses ?
   *
   * Le défaut est non : ce serait le conjoint d'un indivisaire qui découvrirait
   * le montant de la taxe foncière avant l'indivisaire concerné. C'est un
   * réglage, parce que chaque famille tranchera différemment.
   */
  const voitLesDepenses = (ctx: { db: Deps['db']; portee: { biens: Map<number, string> } }, bienId: number): boolean =>
    ctx.portee.biens.get(bienId) !== 'membre_foyer' || parametre<boolean>(ctx.db, 'membreFoyerVoitDepenses');

  // ---------- Catégories et règles ----------

  r.get('/categories', { acces: 'authentifie' }, (ctx) => categories(ctx.db));

  r.get('/biens/:bienId/regles', { acces: 'bien', role: 'detenteur' }, (ctx) => {
    const date = aujourdhui();
    const regles = reglesDuBien(ctx.db, ctx.bienId, date);
    return categories(ctx.db).filter((c) => c.actif).map((c) => ({
      categorieId: c.id, categorieLibelle: c.libelle,
      ...regles.get(c.id),
      parDefaut: (regles.get(c.id)?.id ?? 0) === 0,
    }));
  });

  /**
   * Change la règle d'une catégorie, à partir d'une date.
   *
   * La pastille cyclable de la maquette appelle cette route. Elle **n'écrase
   * rien** : elle ferme la période en cours et en ouvre une nouvelle, et les
   * dépenses déjà saisies gardent leur ventilation.
   */
  r.post('/biens/:bienId/regles', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const categorieId = l.entier('categorieId', { min: 1 });
    const regle = l.choix<Regle>('regle', REGLES);
    const applicableDu = l.date('applicableDu', { defaut: aujourdhui() });
    l.fin();
    changerRegle(ctx.db, ctx.bienId, categorieId, regle, applicableDu, ctx.personneId);
    return undefined;
  });

  // ---------- Dépenses ----------

  /** Les dépenses des biens visibles, sur un exercice. */
  r.get('/depenses', { acces: 'authentifie' }, (ctx) => {
    const { annee, du, au } = exercice(ctx.req.query as Record<string, unknown>);
    const biens = biensVisibles(ctx.portee).filter((id) => voitLesDepenses(ctx, id));
    const depenses = surPeriode(ctx.db, biens, du, au);

    // Le total suit exactement la même liste que les lignes : le tableau de
    // bord, l'en-tête et la trésorerie ne peuvent donc pas afficher trois
    // chiffres différents. Une dépense partagée compte pour son poids dans le
    // dossier d'un bien, et en totalité en vue consolidée.
    const contexte = ctx.req.query.bienId ? Number(ctx.req.query.bienId) : null;
    const total = depenses.reduce((t, d) => t + partVisible(d, contexte, biens), 0);
    return { annee, total, depenses: depenses.map((d) => ({ ...d, partVisibleCents: partVisible(d, contexte, biens) })) };
  });

  r.get('/structures/:structureId/depenses/:depenseId', { acces: 'structure', role: 'detenteur' }, (ctx) => {
    const d = depenseDeLaStructure(ctx.db, ctx.structureId, Number(ctx.req.params.depenseId));
    const v = ventilationDe(ctx.db, d.id);
    const s = structure(ctx.db, d.structureId);
    return {
      depense: d,
      ventilation: v.lignes,
      justification: v.justification,
      // L'explication en clair, telle qu'elle se lit à voix haute devant un
      // frère qui conteste. C'est le point « chaque montant doit pouvoir être
      // expliqué en un clic ».
      explication: v.justification ? expliquer(v.justification) : [],
      recalculs: recalculsDe(ctx.db, d.id),
      vocabulaire: VOCABULAIRE[s.mode],
    };
  });

  r.post('/structures/:structureId/depenses', { acces: 'structure', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const dateDepense = l.date('dateDepense');
    const libelle = l.texte('libelle', { max: 160 });
    const categorieId = l.entier('categorieId', { min: 1 });
    const montantCents = l.entier('montantCents', { min: 1, max: 100_000_000 });
    const payePar = l.choix('payePar', ['personne', 'structure'] as const);
    const avanceParId = l.idFacultatif('avanceParId');
    const justificatifId = l.texte('justificatifId', { max: 40, defaut: '' });
    const note = l.texte('note', { max: 1000, defaut: '' });
    l.fin();

    if (payePar === 'personne' && !avanceParId) {
      throw invalide('Indiquez qui a avancé cette dépense.', { avanceParId: 'Personne à préciser.' });
    }
    if (payePar === 'structure' && avanceParId) {
      throw invalide('Une dépense payée par le compte commun n\'a pas d\'avanceur.');
    }

    const biens = lireBiens(ctx.corps, ctx.db, ctx.structureId);
    const id = creerDepense(ctx.db, {
      structureId: ctx.structureId, dateDepense, libelle, categorieId, montantCents,
      payePar, avanceParId: payePar === 'personne' ? avanceParId : null,
      justificatifId: justificatifId || null, note, biens,
    }, ctx.personneId);
    log.info(`Dépense ${id} enregistrée sur la structure ${ctx.structureId} : ${libelle}, ${montantCents} centimes.`);
    return { id };
  });

  /** Le justificatif : le corps de la requête est le fichier brut. */
  r.post('/structures/:structureId/justificatif', { acces: 'structure', role: 'gerant' }, async (ctx) => {
    const contenu = ctx.req.body;
    if (!Buffer.isBuffer(contenu)) throw invalide('Aucun fichier reçu.');
    const { deposer: deposerFichier } = await import('../stockage/fichiers');
    const nom = String(ctx.req.headers['x-nom-fichier'] || 'justificatif').slice(0, 200);
    const d = deposerFichier(ctx.db, contenu, nom, ctx.personneId, parametre<number>(ctx.db, 'fichierTailleMaxMo'));
    return { fichierId: d.fichier.id, mime: d.fichier.mime, nom: d.fichier.nomOriginal };
  });

  r.post('/structures/:structureId/depenses/:depenseId/recalcul', { acces: 'structure', role: 'gerant' }, (ctx) => {
    const d = depenseDeLaStructure(ctx.db, ctx.structureId, Number(ctx.req.params.depenseId));
    const l = lire(ctx.corps);
    const motif = l.texte('motif', { max: 240 });
    l.fin();
    recalculer(ctx.db, d.id, motif, ctx.personneId);
    return ventilationDe(ctx.db, d.id);
  });

  r.post('/structures/:structureId/depenses/:depenseId/annulation', { acces: 'structure', role: 'gerant' }, (ctx) => {
    const d = depenseDeLaStructure(ctx.db, ctx.structureId, Number(ctx.req.params.depenseId));
    annulerDepense(ctx.db, d.id, ctx.personneId);
    return undefined;
  });

  // ---------- Soldes, virements, appels de fonds ----------

  r.get('/structures/:structureId/soldes', { acces: 'structure', role: 'detenteur' }, (ctx) => {
    const s = structure(ctx.db, ctx.structureId);
    const soldes = soldesDe(ctx.db, ctx.structureId);
    const vocabulaire = VOCABULAIRE[s.mode];

    return {
      structure: { id: s.id, nom: s.nom, mode: s.mode },
      vocabulaire,
      soldes: [...soldes.values()]
        .sort((a, b) => b.montantCents - a.montantCents)
        .map((x) => ({
          acteurId: x.acteurId,
          nom: nomActeur(ctx.db, ctx.structureId, x.acteurId),
          estStructure: x.acteurId === STRUCTURE,
          montantCents: x.montantCents,
          avanceCents: x.avanceCents,
          duCents: x.duCents,
          regleCents: x.regleCents,
        })),
      // Les virements proposés ne déplacent aucun solde tant qu'ils ne sont pas
      // confirmés : ce sont des suggestions, pas des écritures.
      virements: virementsProposes(soldes).map((v) => ({
        ...v,
        deNom: nomActeur(ctx.db, ctx.structureId, v.deId),
        versNom: nomActeur(ctx.db, ctx.structureId, v.versId),
        motif: v.versId === STRUCTURE ? vocabulaire.regularisation
          : v.deId === STRUCTURE ? 'Remboursement de frais avancés' : vocabulaire.regularisation,
      })),
      reglements: reglementsDe(ctx.db, ctx.structureId),
      appels: appelsDe(ctx.db, ctx.structureId),
      controle: [...soldes.values()].reduce((t, x) => t + x.montantCents, 0),
    };
  });

  r.post('/structures/:structureId/reglements', { acces: 'structure', role: 'detenteur' }, (ctx) => {
    const l = lire(ctx.corps);
    const deId = l.entier('deId', { min: 0 });
    const versId = l.entier('versId', { min: 0 });
    const montantCents = l.entier('montantCents', { min: 1, max: 100_000_000 });
    const motif = l.texte('motif', { max: 160, defaut: '' });
    l.fin();

    // Chacun annonce ses propres virements ; la gérante peut en annoncer pour
    // le compte commun, qui n'a pas de doigts pour cliquer.
    const estGerante = ctx.portee.structures.get(ctx.structureId) === 'gerant';
    if (deId !== ctx.personneId && !estGerante) {
      throw refuse('Vous ne pouvez annoncer que vos propres virements.');
    }
    const id = creerReglement(ctx.db, ctx.structureId, deId, versId, montantCents, motif, 'annonce', null, ctx.personneId);
    return { id };
  });

  /**
   * Confirmer un virement.
   *
   * **Seul le bénéficiaire confirme**, ou la gérante quand c'est le compte
   * commun qui reçoit. Sans cette règle, un débiteur solderait sa propre dette
   * d'un clic, et le solde ne voudrait plus rien dire.
   */
  r.post('/structures/:structureId/reglements/:reglementId/confirmation', { acces: 'structure', role: 'detenteur' }, (ctx) => {
    const id = Number(ctx.req.params.reglementId);
    const r0 = ctx.db.prepare('SELECT structure_id AS structureId, vers_id AS versId FROM reglement WHERE id = ?')
      .get(id) as { structureId: number; versId: number } | undefined;
    if (!r0 || r0.structureId !== ctx.structureId) throw introuvable('Ce virement');

    const estGerante = ctx.portee.structures.get(ctx.structureId) === 'gerant';
    const beneficiaire = r0.versId === ctx.personneId || (r0.versId === STRUCTURE && estGerante);
    if (!beneficiaire) {
      throw refuse('Seul le bénéficiaire peut confirmer avoir reçu ce virement.');
    }
    avancerReglement(ctx.db, id, 'confirme', ctx.personneId);
    return undefined;
  });

  r.post('/structures/:structureId/reglements/:reglementId/annulation', { acces: 'structure', role: 'gerant' }, (ctx) => {
    const id = Number(ctx.req.params.reglementId);
    const r0 = ctx.db.prepare('SELECT structure_id AS structureId FROM reglement WHERE id = ?')
      .get(id) as { structureId: number } | undefined;
    if (!r0 || r0.structureId !== ctx.structureId) throw introuvable('Ce virement');
    avancerReglement(ctx.db, id, 'annule', ctx.personneId);
    return undefined;
  });

  r.post('/structures/:structureId/appels', { acces: 'structure', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const libelle = l.texte('libelle', { max: 160 });
    const echeance = l.date('echeance', { defaut: decale(aujourdhui(), 30) });
    const note = l.texte('note', { max: 1000, defaut: '' });
    l.fin();

    const s = structure(ctx.db, ctx.structureId);
    const { appelId, lignes } = emettreAppel(ctx.db, ctx.structureId, libelle, echeance, note, ctx.personneId);

    for (const ligne of lignes) {
      deposer(ctx.db, {
        personneId: ligne.personneId, type: 'appel_de_fonds',
        message: appelDeFonds({
          instance: parametre<string>(ctx.db, 'instanceNom'),
          urlBase: ctx.config.publicUrl ?? '',
          structure: s.nom, libelle, echeance, montantCents: ligne.montantCents,
          vocabulaire: VOCABULAIRE[s.mode].regularisation,
        }),
      });
    }
    return { appelId, lignes: lignes.length };
  });

  return r;
}

/** La dépense, à condition qu'elle appartienne bien à la structure de l'URL. */
function depenseDeLaStructure(db: Deps['db'], structureId: number, depenseId: number) {
  if (!Number.isInteger(depenseId) || depenseId <= 0) throw introuvable('Cette dépense');
  const d = depense(db, depenseId);
  if (d.structureId !== structureId) throw introuvable('Cette dépense');
  return d;
}

/**
 * Ce qu'une dépense pèse dans le périmètre affiché.
 *
 * En vue d'un bien, une dépense partagée compte pour son poids dans ce bien.
 * En vue consolidée, elle compte en totalité. C'est la règle de la maquette, et
 * elle est appliquée ici, une fois, pour que le total de l'en-tête, la
 * statistique du tableau de bord et la ligne de trésorerie soient dérivés de la
 * même liste.
 */
function partVisible(
  d: { montantCents: number; biens: { bienId: number; poidsNum: number; poidsDen: number }[] },
  bienContexte: number | null, biensAutorises: readonly number[],
): number {
  const retenus = d.biens.filter((b) =>
    bienContexte ? b.bienId === bienContexte : biensAutorises.includes(b.bienId));
  if (!retenus.length) return 0;
  const poids = retenus.reduce((t, b) => t + b.poidsNum / b.poidsDen, 0);
  return Math.round(d.montantCents * Math.min(1, poids));
}

/** Les biens d'une dépense, tous appartenant à la structure de l'URL. */
function lireBiens(corps: unknown, db: Deps['db'], structureId: number): { bienId: number; poidsNum: number; poidsDen: number }[] {
  const brut = (corps as { biens?: unknown }).biens;
  if (!Array.isArray(brut) || !brut.length) {
    throw invalide('Rattachez cette dépense à au moins un bien.', { biens: 'Aucun bien choisi.' });
  }
  const out: { bienId: number; poidsNum: number; poidsDen: number }[] = [];
  for (const ligne of brut as { bienId?: unknown; poidsNum?: unknown; poidsDen?: unknown }[]) {
    const bienId = Number(ligne.bienId);
    if (!Number.isInteger(bienId) || bienId <= 0) throw invalide('Un bien de la liste est invalide.');
    const b = bien(db, bienId);
    if (b.structureId !== structureId) {
      throw etatInvalide(
        `Le bien « ${b.nom} » n'appartient pas à cette structure. Une dépense qui sert à deux structures `
        + "s'enregistre en deux dépenses : l'argent est dû dans deux pots distincts.",
      );
    }
    const poidsNum = Number(ligne.poidsNum ?? 1);
    const poidsDen = Number(ligne.poidsDen ?? brut.length);
    if (!Number.isInteger(poidsNum) || !Number.isInteger(poidsDen) || poidsNum <= 0 || poidsDen <= 0) {
      throw invalide('Le poids d\'un bien doit être une fraction de nombres entiers positifs.');
    }
    out.push({ bienId, poidsNum, poidsDen });
  }
  return out;
}
