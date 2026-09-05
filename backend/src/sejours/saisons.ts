// Le tour de choix saisonnier : saisons, voeux, quotas, arbitrage.
//
// L'onglet « Tour de choix » de l'écran Demandes. Son rôle est de **documenter
// l'équité**, pas d'imposer un résultat : l'arbitrage propose des séjours à
// l'état « demande », que la gérante valide ou modifie ligne par ligne. Tout le
// monde veut la première quinzaine d'août, et ce n'est pas un algorithme qui
// réglera cela.
import { Deps, Routeur } from '../noyau/http';
import { aujourdhui, horodatage } from '../noyau/dates';
import { etatInvalide, introuvable, invalide } from '../noyau/erreurs';
import { log } from '../noyau/log';
import { lire } from '../noyau/valider';
import { parametre } from '../parametres/repo';
import { Voeu, arbitrer, ordreSuivant } from './tour-de-choix';
import { creer, occupationsDe } from './repo';

interface LigneSaison {
  id: number; bien_id: number; libelle: string; debut: string; fin: string;
  statut: string; ordre_json: string;
}

function saisonDuBien(db: Deps['db'], bienId: number, saisonId: number): LigneSaison {
  if (!Number.isInteger(saisonId) || saisonId <= 0) throw introuvable('Cette saison');
  const s = db.prepare('SELECT id, bien_id, libelle, debut, fin, statut, ordre_json FROM saison WHERE id = ?')
    .get(saisonId) as LigneSaison | undefined;
  // Comme pour les séjours : la garde a validé le bien de l'adresse, il reste à
  // vérifier que l'objet demandé appartient bien à ce bien.
  if (!s || s.bien_id !== bienId) throw introuvable('Cette saison');
  return s;
}

function detail(db: Deps['db'], s: LigneSaison) {
  const voeux = db.prepare(`
    SELECT v.id, v.foyer_id AS foyerId, f.nom AS foyerNom, v.rang, v.du, v.au, v.occupants
    FROM voeu v JOIN foyer f ON f.id = v.foyer_id WHERE v.saison_id = ? ORDER BY v.rang, v.du
  `).all(s.id) as (Voeu & { foyerNom: string })[];
  const quotas = db.prepare('SELECT foyer_id AS foyerId, nuits_max AS nuitsMax FROM quota WHERE saison_id = ?')
    .all(s.id) as { foyerId: number; nuitsMax: number }[];
  return {
    saison: {
      id: s.id, bienId: s.bien_id, libelle: s.libelle, debut: s.debut, fin: s.fin,
      statut: s.statut, ordre: JSON.parse(s.ordre_json) as number[],
    },
    voeux, quotas,
  };
}

export function routesSaisons(deps: Deps): Routeur {
  const r = new Routeur('saisons', deps);

  r.get('/biens/:bienId/saisons', { acces: 'bien', role: 'membre_foyer' }, (ctx) => {
    const lignes = ctx.db.prepare(
      'SELECT id, bien_id, libelle, debut, fin, statut, ordre_json FROM saison WHERE bien_id = ? ORDER BY debut DESC',
    ).all(ctx.bienId) as LigneSaison[];
    return lignes.map((s) => detail(ctx.db, s));
  });

  r.post('/biens/:bienId/saisons', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const libelle = l.texte('libelle', { max: 80 });
    const debut = l.date('debut');
    const fin = l.date('fin');
    l.fin();
    if (fin <= debut) throw invalide('La fin de la saison doit être après son début.', { fin: 'Après le début.' });

    // L'ordre de priorité part de la saison précédente, décalé d'un cran. C'est
    // une rotation que chacun peut vérifier de tête, ce qui vaut mieux qu'une
    // pondération savante que personne ne recalcule.
    const precedente = ctx.db.prepare(
      'SELECT ordre_json FROM saison WHERE bien_id = ? ORDER BY debut DESC LIMIT 1',
    ).get(ctx.bienId) as { ordre_json: string } | undefined;
    const ordre = precedente ? ordreSuivant(JSON.parse(precedente.ordre_json) as number[]) : [];

    const id = Number(ctx.db.prepare(`
      INSERT INTO saison (bien_id, libelle, debut, fin, statut, ordre_json, cree_le, cree_par)
      VALUES (?, ?, ?, ?, 'ouverte', ?, ?, ?)
    `).run(ctx.bienId, libelle, debut, fin, JSON.stringify(ordre), horodatage(), ctx.personneId).lastInsertRowid);
    return { id, ordre };
  });

  r.post('/biens/:bienId/saisons/:saisonId/ordre', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const s = saisonDuBien(ctx.db, ctx.bienId, Number(ctx.req.params.saisonId));
    const brut = (ctx.corps as { ordre?: unknown }).ordre;
    if (!Array.isArray(brut) || brut.some((x) => !Number.isInteger(x))) {
      throw invalide('L\'ordre de priorité doit être une liste de foyers.');
    }
    ctx.db.prepare('UPDATE saison SET ordre_json = ? WHERE id = ?').run(JSON.stringify(brut), s.id);
    return undefined;
  });

  /** Déposer un voeu. Chacun dépose pour son propre foyer, la gérante pour tous. */
  r.post('/biens/:bienId/saisons/:saisonId/voeux', { acces: 'bien', role: 'membre_foyer' }, (ctx) => {
    const s = saisonDuBien(ctx.db, ctx.bienId, Number(ctx.req.params.saisonId));
    if (s.statut !== 'ouverte') throw etatInvalide('Cette saison n\'accepte plus de voeux.');
    const l = lire(ctx.corps);
    const rang = l.entier('rang', { min: 1, max: 3 });
    const du = l.date('du');
    const au = l.date('au');
    const occupants = l.entier('occupants', { min: 1, max: 60 });
    const foyerDemande = l.idFacultatif('foyerId');
    l.fin();
    if (au <= du) throw invalide('La fin du voeu doit être après son début.', { au: 'Après le début.' });
    if (du < s.debut || au > s.fin) {
      throw invalide(`Ce voeu sort de la saison (${s.debut} au ${s.fin}).`);
    }

    const moi = ctx.db.prepare('SELECT foyer_id FROM personne WHERE id = ?')
      .get(ctx.personneId) as { foyer_id: number | null };
    const estGerante = ctx.portee.biens.get(ctx.bienId) === 'gerant';
    const foyerId = estGerante && foyerDemande ? foyerDemande : moi.foyer_id;
    if (!foyerId) throw etatInvalide('Vous n\'êtes rattaché à aucun foyer : demandez à la gérante de vous en attribuer un.');

    ctx.db.prepare(`
      INSERT INTO voeu (saison_id, foyer_id, rang, du, au, occupants, cree_le, cree_par)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (saison_id, foyer_id, rang) DO UPDATE
        SET du = excluded.du, au = excluded.au, occupants = excluded.occupants
    `).run(s.id, foyerId, rang, du, au, occupants, horodatage(), ctx.personneId);
    return undefined;
  });

  r.post('/biens/:bienId/saisons/:saisonId/quotas', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const s = saisonDuBien(ctx.db, ctx.bienId, Number(ctx.req.params.saisonId));
    const l = lire(ctx.corps);
    const foyerId = l.entier('foyerId', { min: 1 });
    const nuitsMax = l.entier('nuitsMax', { min: 0, max: 366 });
    l.fin();
    ctx.db.prepare(`
      INSERT INTO quota (saison_id, foyer_id, nuits_max) VALUES (?, ?, ?)
      ON CONFLICT (saison_id, foyer_id) DO UPDATE SET nuits_max = excluded.nuits_max
    `).run(s.id, foyerId, nuitsMax);
    return undefined;
  });

  /**
   * L'arbitrage. Il **propose** : chaque attribution devient un séjour à l'état
   * « demande », que la gérante valide ou modifie. La décision finale reste
   * humaine et modifiable, ce qui est la seule façon que cet outil soit adopté.
   */
  r.post('/biens/:bienId/saisons/:saisonId/arbitrage', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const s = saisonDuBien(ctx.db, ctx.bienId, Number(ctx.req.params.saisonId));
    const d = detail(ctx.db, s);
    if (!d.voeux.length) throw etatInvalide('Aucun voeu n\'a été déposé pour cette saison.');

    // Ce qui occupe déjà le bien sur la saison : les semaines louées et les
    // interventions posées avant l'ouverture du tour de choix.
    const deja = occupationsDe(ctx.db, ctx.bienId)
      .filter((o) => (o.statut === 'valide') && o.depart > s.debut && o.arrivee < s.fin)
      .map((o) => ({ du: o.arrivee, au: o.depart }));

    const resultat = arbitrer({
      voeux: d.voeux, ordre: d.saison.ordre,
      quotas: new Map(d.quotas.map((q) => [q.foyerId, q.nuitsMax])),
      deja,
    });

    const noms = new Map((ctx.db.prepare('SELECT id, nom FROM foyer').all() as { id: number; nom: string }[])
      .map((f) => [f.id, f.nom]));
    const creees = ctx.db.transaction(() => resultat.attributions.map((a) => creer(ctx.db, {
      bienId: ctx.bienId, demandeurId: null, foyerId: a.foyerId,
      titre: noms.get(a.foyerId) ?? 'Foyer',
      arrivee: a.du, depart: a.au, occupants: a.occupants, nature: 'famille',
      note: `Attribué par le tour de choix « ${s.libelle} » (choix numéro ${a.rang}).`,
      origine: 'gerante', statut: 'demande',
    }, ctx.personneId)))();

    ctx.db.prepare("UPDATE saison SET statut = 'arbitree' WHERE id = ?").run(s.id);
    ctx.db.prepare(`
      INSERT INTO journal_audit (acteur_id, action, objet_kind, objet_id, detail_json, fait_le)
      VALUES (?, 'saison.arbitrage', 'saison', ?, ?, ?)
    `).run(ctx.personneId, s.id, JSON.stringify(resultat), horodatage());

    // Le dépassement de quota n'empêche rien : il est signalé, et la gérante
    // décide. Le réglage ne fait que rendre l'avertissement visible ou non.
    const avertir = parametre<boolean>(ctx.db, 'quotaAvertissement', { bienId: ctx.bienId });
    log.info(`Tour de choix « ${s.libelle} » arbitré : ${creees.length} séjour(s) proposé(s).`);
    return {
      ...resultat,
      sejoursProposes: creees,
      depassements: avertir ? resultat.bilan.filter((b) => b.depassement > 0) : [],
      bilan: resultat.bilan.map((b) => ({ ...b, foyerNom: noms.get(b.foyerId) ?? '' })),
      aujourdhui: aujourdhui(),
    };
  });

  return r;
}
