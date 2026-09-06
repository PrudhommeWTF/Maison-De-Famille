// La reprise du planning existant.
//
// « Sans reprise de l'existant, ma mère ne basculera pas. » Ce module est donc
// jugé sur un seul critère : **elle doit pouvoir voir ce qui va se passer avant
// que cela se passe**, et défaire si elle s'est trompée.
//
// D'où trois propriétés, et elles ne sont pas négociables :
//
//   1. **Simulation d'abord.** Rien n'est écrit tant que le rapport n'a pas été
//      rendu. Le rapport dit combien de lignes seront créées, combien sont des
//      doublons, et **quelles lignes sont refusées et pourquoi**.
//   2. **Rejouable.** La clé de déduplication est (bien, arrivée, départ, nom
//      normalisé). Relancer le même fichier ne crée pas de doublon, ce qui rend
//      la reprise progressive possible : on importe, on corrige le tableur, on
//      réimporte.
//   3. **Annulable en bloc.** Chaque séjour importé porte son `import_run_id`.
//      Une correspondance de colonnes mal choisie se défait en une action, au
//      lieu de laisser trois cents lignes fausses dans le calendrier.
import type { Db } from '../../noyau/db';
import { dateLisible, horodatage } from '../../noyau/dates';
import { log } from '../../noyau/log';
import { normaliser, versDate, versEntier } from '../../noyau/tableau/valeurs';
import { Champ, Nature, Statut, versNature, versStatut } from './correspondance';

export interface BienConnu { id: number; nom: string }

export interface LigneProposee {
  numero: number;
  bienId: number;
  titre: string;
  arrivee: string;
  depart: string;
  occupants: number;
  nature: Nature;
  statut: Statut;
  note: string;
}

export interface LigneRefusee { numero: number; raison: string; brut: readonly string[] }

export interface Rapport {
  lues: number;
  aCreer: LigneProposee[];
  doublons: { numero: number; titre: string; arrivee: string }[];
  refusees: LigneRefusee[];
}

export interface Options {
  lignes: readonly (readonly string[])[];
  /** Le numéro de la ligne d'en-tête, à partir de zéro. Les lignes au-dessus sont ignorées. */
  ligneEntete: number;
  correspondance: Partial<Record<Champ, number>>;
  biens: readonly BienConnu[];
  /** Le bien à utiliser quand le fichier n'a pas de colonne « bien ». */
  bienParDefaut: number;
  /** Ce qui existe déjà, pour la déduplication. */
  existants: readonly { bienId: number; arrivee: string; depart: string; titre: string }[];
}

const cle = (bienId: number, arrivee: string, depart: string, titre: string): string =>
  `${bienId}|${arrivee}|${depart}|${normaliser(titre)}`;

/**
 * La simulation. Module pur : mêmes entrées, même rapport, sans toucher à la
 * base. C'est ce qui permet de le tester sur des fichiers tordus.
 */
export function preparer(o: Options): Rapport {
  const rapport: Rapport = { lues: 0, aCreer: [], doublons: [], refusees: [] };
  const vues = new Set(o.existants.map((e) => cle(e.bienId, e.arrivee, e.depart, e.titre)));
  const parNom = new Map(o.biens.map((b) => [normaliser(b.nom), b.id]));
  const col = (l: readonly string[], champ: Champ): string => {
    const i = o.correspondance[champ];
    return i === undefined || i < 0 ? '' : String(l[i] ?? '');
  };

  for (let n = o.ligneEntete + 1; n < o.lignes.length; n++) {
    const l = o.lignes[n];
    if (!l || !l.some((c) => String(c ?? '').trim())) continue;   // ligne vide du tableur
    rapport.lues++;
    const numero = n + 1;                                          // numéroté comme dans le tableur
    const refus = (raison: string): void => { rapport.refusees.push({ numero, raison, brut: l }); };

    const arrivee = versDate(col(l, 'arrivee'));
    if (!arrivee) { refus(`Date d'arrivée illisible : « ${col(l, 'arrivee')} »`); continue; }
    const depart = versDate(col(l, 'depart'));
    if (!depart) { refus(`Date de départ illisible : « ${col(l, 'depart')} »`); continue; }
    if (depart <= arrivee) {
      refus(`Le départ (${dateLisible(depart)}) doit être après l'arrivée (${dateLisible(arrivee)}). `
        + "Une ligne d'une seule nuit s'écrit du 8 au 9.");
      continue;
    }

    let bienId = o.bienParDefaut;
    const nomBien = col(l, 'bien').trim();
    if (nomBien) {
      const trouve = parNom.get(normaliser(nomBien));
      if (trouve === undefined) {
        // Une correspondance approchée plutôt qu'un refus : « Kerloch » pour
        // « Maison de Kerloc'h » est le cas normal d'un planning tenu à la main.
        // Une correspondance approchée n'est tentée qu'au-delà de quatre
        // caractères : en dessous, « arc » attraperait n'importe quoi et
        // rangerait des séjours dans le mauvais dossier, ce qui est pire qu'un
        // refus visible.
        const cherche = normaliser(nomBien);
        const approche = cherche.length >= 4
          ? [...parNom.entries()].find(([nom]) => nom.includes(cherche) || cherche.includes(nom))
          : undefined;
        if (!approche) { refus(`Bien inconnu : « ${nomBien} »`); continue; }
        bienId = approche[1];
      } else bienId = trouve;
    }

    const titre = col(l, 'titre').trim() || 'Séjour repris du planning';
    const k = cle(bienId, arrivee, depart, titre);
    if (vues.has(k)) { rapport.doublons.push({ numero, titre, arrivee }); continue; }
    vues.add(k);

    rapport.aCreer.push({
      numero, bienId, titre, arrivee, depart,
      occupants: versEntier(col(l, 'occupants'), 1),
      nature: versNature(col(l, 'nature')),
      statut: versStatut(col(l, 'statut')),
      note: col(l, 'note').slice(0, 1000),
    });
  }
  return rapport;
}

/** Écrit le rapport en base, en une transaction. Tout ou rien. */
export function executer(
  db: Db, rapport: Rapport, sourceNom: string, sha: string, parQui: number,
): { importRunId: number; creees: number } {
  return db.transaction(() => {
    const importRunId = Number(db.prepare(`
      INSERT INTO import_run (source_nom, fichier_sha, importe_le, importe_par, lues, creees, ignorees, refusees, rapport_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sourceNom.slice(0, 200), sha, horodatage(), parQui, rapport.lues, rapport.aCreer.length,
      rapport.doublons.length, rapport.refusees.length,
      JSON.stringify({ doublons: rapport.doublons, refusees: rapport.refusees })).lastInsertRowid);

    const ins = db.prepare(`
      INSERT INTO sejour (bien_id, demandeur_id, foyer_id, titre, arrivee, depart, occupants, nature,
                          statut, note, origine, cree_le, cree_par, decide_le, decide_par,
                          import_run_id, import_ligne)
      VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?, ?, ?, ?, ?)
    `);
    for (const l of rapport.aCreer) {
      ins.run(l.bienId, l.titre, l.arrivee, l.depart, l.occupants, l.nature, l.statut, l.note,
        horodatage(), parQui, l.statut === 'valide' ? horodatage() : null,
        l.statut === 'valide' ? parQui : null, importRunId, l.numero);
    }
    log.info(`Import ${importRunId} : ${rapport.aCreer.length} séjour(s) créé(s) depuis « ${sourceNom} ».`);
    return { importRunId, creees: rapport.aCreer.length };
  })();
}

/**
 * Défaire un import. Les séjours importés sont **archivés**, pas supprimés :
 * rien ne s'efface, tout se date, et un import annulé par erreur se retrouve
 * dans la base.
 */
export function annulerImport(db: Db, importRunId: number): number {
  return db.transaction(() => {
    const n = db.prepare('UPDATE sejour SET archive_le = ?, statut = ? WHERE import_run_id = ? AND archive_le IS NULL')
      .run(horodatage(), 'annule', importRunId).changes;
    db.prepare('UPDATE import_run SET annule_le = ? WHERE id = ?').run(horodatage(), importRunId);
    log.info(`Import ${importRunId} annulé : ${n} séjour(s) archivé(s).`);
    return n;
  })();
}
