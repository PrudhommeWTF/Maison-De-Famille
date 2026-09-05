// Le dépôt des scrutins et des décisions.
//
// **L'ouverture fige le corps électoral.** C'est la seule chose difficile de ce
// fichier : au moment où le scrutin s'ouvre, on recopie les parts en vigueur
// dans `scrutin_voix`, et plus rien ne les touche. Un indivisaire qui cède ses
// parts pendant le scrutin garde sa voix et son poids ; celui qui entre après
// l'ouverture ne vote pas sur ce scrutin-là. C'est la seule façon d'avoir un
// résultat qui veut dire quelque chose, et de pouvoir le défendre des années
// après devant quelqu'un qui le conteste.
import type { Db } from '../noyau/db';
import { aujourdhui, horodatage } from '../noyau/dates';
import { etatInvalide, introuvable } from '../noyau/erreurs';
import { log } from '../noyau/log';
import { detenteursALaDate, reglesDe, structure } from '../patrimoine/repo';
import { Regle, ScrutinImpossible, Voix, depouiller, enCours, issueCertaine } from './majorite';

export interface Scrutin {
  id: number;
  structureId: number;
  bienId: number | null;
  regleId: number;
  titre: string;
  expose: string;
  montantCents: number | null;
  ouvertLe: string;
  clotureLe: string;
  statut: 'ouvert' | 'adopte' | 'rejete' | 'annule';
  depouilleLe: string | null;
  resultatJson: string | null;
  convoqueLe: string | null;
  creeParNom: string | null;
}

const SELECT_SCRUTIN = `
  SELECT s.id, s.structure_id AS structureId, s.bien_id AS bienId, s.regle_id AS regleId,
         s.titre, s.expose, s.montant_cents AS montantCents, s.ouvert_le AS ouvertLe,
         s.cloture_le AS clotureLe, s.statut, s.depouille_le AS depouilleLe,
         s.resultat_json AS resultatJson, s.convoque_le AS convoqueLe, p.nom AS creeParNom
  FROM scrutin s LEFT JOIN personne p ON p.id = s.cree_par
`;

export function scrutins(db: Db, structureId: number): Scrutin[] {
  return db.prepare(
    `${SELECT_SCRUTIN} WHERE s.structure_id = ? AND s.archive_le IS NULL
     ORDER BY CASE s.statut WHEN 'ouvert' THEN 0 ELSE 1 END, s.ouvert_le DESC`,
  ).all(structureId) as Scrutin[];
}

export function scrutin(db: Db, structureId: number, id: number): Scrutin {
  const s = db.prepare(`${SELECT_SCRUTIN} WHERE s.id = ? AND s.structure_id = ? AND s.archive_le IS NULL`)
    .get(id, structureId) as Scrutin | undefined;
  if (!s) throw introuvable('Ce scrutin');
  return s;
}

export function voixDe(db: Db, scrutinId: number): (Voix & { nom: string })[] {
  return db.prepare(
    `SELECT v.personne_id AS personneId, p.nom, v.poids, v.sens
     FROM scrutin_voix v JOIN personne p ON p.id = v.personne_id
     WHERE v.scrutin_id = ? ORDER BY p.nom`,
  ).all(scrutinId) as (Voix & { nom: string })[];
}

export function regle(db: Db, structureId: number, regleId: number): Regle {
  const r = reglesDe(db, structureId).find((x) => x.id === regleId);
  if (!r) throw introuvable('Cette règle de décision');
  return r;
}

/**
 * Ouvre un scrutin et fige son corps électoral.
 *
 * Les parts sont lues **à la date d'ouverture**, pas à celle du jour : ouvrir
 * un scrutin daté d'hier ne doit pas donner un corps électoral d'aujourd'hui.
 */
export function ouvrir(
  db: Db, structureId: number,
  v: { regleId: number; titre: string; expose: string; montantCents: number | null;
       bienId: number | null; clotureLe: string; convoqueLe: string | null },
  parQui: number, ouvertLe = aujourdhui(),
): number {
  const r = regle(db, structureId, v.regleId);
  if (!r.voteRequis) {
    throw new ScrutinImpossible(
      `${structure(db, structureId).nom} ne demande pas de vote pour « ${r.libelle} » : `
      + 'la décision se prend et s\'enregistre directement.');
  }
  if (v.clotureLe <= ouvertLe) {
    throw new ScrutinImpossible('La date de clôture doit être postérieure à l\'ouverture.');
  }

  const detenteurs = detenteursALaDate(db, structureId, ouvertLe);
  if (!detenteurs.length) {
    throw new ScrutinImpossible(
      'Aucune répartition des parts n\'est enregistrée à cette date. Saisissez-la avant d\'ouvrir un vote.');
  }

  return db.transaction(() => {
    const id = Number(db.prepare(
      `INSERT INTO scrutin (structure_id, bien_id, regle_id, titre, expose, montant_cents,
                            ouvert_le, cloture_le, statut, convoque_le, cree_par, cree_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ouvert', ?, ?, ?)`,
    ).run(structureId, v.bienId, v.regleId, v.titre, v.expose, v.montantCents,
      ouvertLe, v.clotureLe, v.convoqueLe, parQui, horodatage()).lastInsertRowid);

    const ins = db.prepare(
      'INSERT INTO scrutin_voix (scrutin_id, personne_id, poids) VALUES (?, ?, ?)');
    for (const d of detenteurs) ins.run(id, d.personneId, d.parts);
    log.info(`Scrutin ${id} ouvert sur la structure ${structureId} : ${detenteurs.length} électeurs figés.`);
    return id;
  })();
}

/** Voter, ou changer son vote tant que le scrutin est ouvert. */
export function voter(db: Db, structureId: number, id: number, personneId: number, sens: Voix['sens']): void {
  const s = scrutin(db, structureId, id);
  if (s.statut !== 'ouvert') throw etatInvalide('Ce scrutin est clos : les voix ne changent plus.');
  if (s.clotureLe < aujourdhui()) {
    throw etatInvalide(`Ce scrutin s'est clos le ${s.clotureLe}. Demandez son dépouillement à un gérant.`);
  }
  const r = db.prepare('UPDATE scrutin_voix SET sens = ?, vote_le = ? WHERE scrutin_id = ? AND personne_id = ?')
    .run(sens, horodatage(), id, personneId);
  if (!r.changes) {
    throw etatInvalide(
      'Vous ne faites pas partie du corps électoral de ce scrutin, figé à son ouverture. '
      + 'Si vous avez acquis des parts depuis, elles compteront au prochain vote.');
  }
}

export interface Vue {
  scrutin: Scrutin;
  regle: Regle;
  voix: (Voix & { nom: string })[];
  depouillement: ReturnType<typeof depouiller>;
  monSens: Voix['sens'] | null;
  monPoids: number | null;
  phrase: string;
  issueCertaine: boolean;
}

export function vue(db: Db, structureId: number, id: number, personneId: number): Vue {
  const s = scrutin(db, structureId, id);
  const r = regle(db, structureId, s.regleId);
  const voix = voixDe(db, id);
  const moi = voix.find((v) => v.personneId === personneId) ?? null;
  // Un scrutin dépouillé rend le résultat **enregistré**, jamais un recalcul :
  // le code peut avoir changé depuis, et une décision de 2026 doit se relire en
  // 2032 telle qu'elle a été prise.
  const depouillement = s.resultatJson
    ? JSON.parse(s.resultatJson) as ReturnType<typeof depouiller>
    : depouiller(r, voix);
  return {
    scrutin: s, regle: r, voix, depouillement,
    monSens: moi?.sens ?? null,
    monPoids: moi?.poids ?? null,
    phrase: s.statut === 'ouvert' ? enCours(r, voix, moi?.poids ?? null) : depouillement.explication,
    issueCertaine: s.statut === 'ouvert' && issueCertaine(r, voix),
  };
}

/**
 * Dépouille et fige le résultat.
 *
 * Le résultat est écrit en base, pas recalculé à chaque lecture : c'est ce qui
 * fait qu'une décision se relit dix ans après telle qu'elle a été prise, même
 * si la règle a changé entre-temps.
 */
export function depouillerEtClore(db: Db, structureId: number, id: number, parQui: number): Vue {
  const s = scrutin(db, structureId, id);
  if (s.statut !== 'ouvert') throw etatInvalide('Ce scrutin est déjà dépouillé.');
  const r = regle(db, structureId, s.regleId);
  const d = depouiller(r, voixDe(db, id));

  db.prepare('UPDATE scrutin SET statut = ?, depouille_le = ?, resultat_json = ? WHERE id = ?')
    .run(d.adopte ? 'adopte' : 'rejete', horodatage(), JSON.stringify(d), id);
  log.info(`Scrutin ${id} dépouillé par ${parQui} : ${d.adopte ? 'adopté' : 'rejeté'} `
    + `(${d.pour}/${d.total}, seuil ${d.requis}).`);
  return vue(db, structureId, id, parQui);
}

export function annuler(db: Db, structureId: number, id: number, parQui: number): void {
  const s = scrutin(db, structureId, id);
  if (s.statut !== 'ouvert') throw etatInvalide('Un scrutin dépouillé ne s\'annule pas : il fait partie de l\'histoire.');
  db.prepare("UPDATE scrutin SET statut = 'annule' WHERE id = ?").run(id);
  log.info(`Scrutin ${id} annulé par la personne ${parQui}.`);
}
