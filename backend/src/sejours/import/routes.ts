// L'écran d'import du planning existant, en trois temps.
//
//   1. **Analyse** : le fichier est téléversé, reconnu, et rendu tel qu'il a été
//      lu, avec une proposition de correspondance des colonnes.
//   2. **Simulation** : la correspondance corrigée revient, et le serveur dit ce
//      qu'il ferait. Rien n'est écrit.
//   3. **Exécution** : et seulement alors, l'écriture.
//
// Le tableau lu fait l'aller-retour par le navigateur plutôt que d'être gardé
// côté serveur entre deux requêtes. Un planning tient en quelques centaines de
// lignes, et cela évite un stockage temporaire à nettoyer, un identifiant de
// session d'import à faire expirer, et le lot de pannes qui va avec.
import { createHash } from 'crypto';
import { Deps, Routeur } from '../../noyau/http';
import { invalide, refuse } from '../../noyau/erreurs';
import { lire as lireCorps } from '../../noyau/valider';
import { biensDeLaPortee } from '../../acces/repo';
import { Champ, CHAMPS, proposer } from './correspondance';
import { Options, annulerImport, executer, preparer } from './execution';
import { lire } from './tableau';

/** Au-delà, ce n'est plus un planning familial, et l'aller-retour deviendrait lourd. */
const MAX_LIGNES = 5000;

/** La ligne d'en-tête proposée : la première qui ressemble à des intitulés. */
function trouverEntete(lignes: readonly (readonly string[])[]): number {
  for (let i = 0; i < Math.min(lignes.length, 20); i++) {
    const remplies = lignes[i].filter((c) => String(c ?? '').trim()).length;
    if (remplies >= 2 && Object.values(proposer(lignes[i] as string[])).some((x) => x >= 0)) return i;
  }
  return 0;
}

function lireOptions(corps: unknown): Omit<Options, 'biens' | 'existants'> {
  const c = (corps ?? {}) as Record<string, unknown>;
  if (!Array.isArray(c.lignes)) throw invalide('Le tableau à importer est absent.');
  if (c.lignes.length > MAX_LIGNES) throw invalide(`Ce fichier compte plus de ${MAX_LIGNES} lignes.`);
  const l = lireCorps(c);
  const ligneEntete = l.entier('ligneEntete', { min: 0, max: 1000, defaut: 0 });
  const bienParDefaut = l.entier('bienParDefaut', { min: 1 });
  l.fin();

  const correspondance: Partial<Record<Champ, number>> = {};
  const brut = (c.correspondance ?? {}) as Record<string, unknown>;
  for (const { champ } of CHAMPS) {
    const v = Number(brut[champ]);
    correspondance[champ] = Number.isInteger(v) ? v : -1;
  }
  return {
    lignes: (c.lignes as unknown[]).map((ligne) => (Array.isArray(ligne) ? ligne.map((x) => String(x ?? '')) : [])),
    ligneEntete, correspondance, bienParDefaut,
  };
}

export function routesImport(deps: Deps): Routeur {
  const r = new Routeur('import', deps);

  /** Les biens que cet appelant peut alimenter : ceux qu'il gère, et eux seuls. */
  const biensGeres = (ctx: { portee: { biens: Map<number, string> } }): number[] =>
    [...ctx.portee.biens.entries()].filter(([, role]) => role === 'gerant').map(([id]) => id);

  r.post('/import/analyse', { acces: 'gerant' }, (ctx) => {
    const contenu = ctx.req.body;
    if (!Buffer.isBuffer(contenu) || !contenu.length) throw invalide('Aucun fichier reçu.');

    let lecture;
    try {
      lecture = lire(contenu);
    } catch (e) {
      // Le message vient du lecteur et dit quoi faire (réenregistrer en .xlsx,
      // exporter en CSV). Le remplacer par « fichier invalide » ferait perdre
      // exactement l'information utile.
      throw invalide(e instanceof Error ? e.message : 'Ce fichier n\'a pas pu être lu.');
    }
    if (!lecture.lignes.length) throw invalide('Ce fichier ne contient aucune ligne.');
    if (lecture.lignes.length > MAX_LIGNES) {
      throw invalide(`Ce fichier compte ${lecture.lignes.length} lignes, la limite est de ${MAX_LIGNES}.`);
    }

    const ligneEntete = trouverEntete(lecture.lignes);
    const geres = new Set(biensGeres(ctx));
    return {
      format: lecture.format,
      encodage: lecture.encodage,
      sha: createHash('sha256').update(contenu).digest('hex'),
      nom: String(ctx.req.headers['x-nom-fichier'] || 'planning').slice(0, 200),
      lignes: lecture.lignes,
      ligneEntete,
      entetes: lecture.lignes[ligneEntete] ?? [],
      correspondance: proposer((lecture.lignes[ligneEntete] ?? []) as string[]),
      champs: CHAMPS,
      biens: biensDeLaPortee(ctx.db, ctx.portee).filter((b) => geres.has(b.id))
        .map((b) => ({ id: b.id, nom: b.nom })),
    };
  });

  r.post('/import/simulation', { acces: 'gerant' }, (ctx) => rapportDe(ctx));

  r.post('/import/execution', { acces: 'gerant' }, (ctx) => {
    const rapport = rapportDe(ctx);
    if (!rapport.aCreer.length) throw invalide('Aucune ligne à créer : rien n\'a été importé.');
    const c = (ctx.corps ?? {}) as Record<string, unknown>;
    const sha = typeof c.sha === 'string' ? c.sha : '';
    const nom = typeof c.nom === 'string' ? c.nom : 'planning';
    return { ...executer(ctx.db, rapport, nom, sha, ctx.personneId), rapport };
  });

  r.get('/import', { acces: 'gerant' }, (ctx) => ctx.db.prepare(`
    SELECT i.id, i.source_nom AS sourceNom, i.importe_le AS importeLe, p.nom AS importePar,
           i.lues, i.creees, i.ignorees, i.refusees, i.annule_le AS annuleLe
    FROM import_run i LEFT JOIN personne p ON p.id = i.importe_par
    ORDER BY i.id DESC LIMIT 50
  `).all());

  r.post('/import/:importRunId/annulation', { acces: 'gerant' }, (ctx) => {
    const id = Number(ctx.req.params.importRunId);
    if (!Number.isInteger(id) || id <= 0) throw invalide('Import inconnu.');
    // Les séjours de cet import doivent tous être sur des biens que l'appelant
    // gère : sans ce contrôle, un gérant pourrait défaire l'import d'un autre.
    const geres = new Set(biensGeres(ctx));
    const touches = ctx.db.prepare('SELECT DISTINCT bien_id AS bienId FROM sejour WHERE import_run_id = ?')
      .all(id) as { bienId: number }[];
    if (touches.some((t) => !geres.has(t.bienId))) {
      throw refuse('Cet import porte sur un bien que vous ne gérez pas.');
    }
    return { archives: annulerImport(ctx.db, id) };
  });

  /** Construit le rapport, en refusant tout bien hors du périmètre de l'appelant. */
  function rapportDe(ctx: Parameters<Parameters<Routeur['post']>[2]>[0]) {
    const o = lireOptions(ctx.corps);
    const geres = biensGeres(ctx);
    if (!geres.includes(o.bienParDefaut)) throw refuse('Vous ne gérez pas ce bien.');

    const biens = biensDeLaPortee(ctx.db, ctx.portee).filter((b) => geres.includes(b.id))
      .map((b) => ({ id: b.id, nom: b.nom }));
    const existants = ctx.db.prepare(`
      SELECT bien_id AS bienId, arrivee, depart, titre FROM sejour
      WHERE bien_id IN (${geres.map(() => '?').join(',')}) AND archive_le IS NULL
    `).all(...geres) as { bienId: number; arrivee: string; depart: string; titre: string }[];

    return preparer({ ...o, biens, existants });
  }

  return r;
}
