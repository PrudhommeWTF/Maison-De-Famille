// La lecture en base des éléments qui composent une portée.
//
// Quatre requêtes courtes, exécutées une fois par requête HTTP authentifiée. La
// famille compte quelques dizaines de personnes et quelques biens : tout tient
// en mémoire, et recalculer à chaque fois évite le pire des bugs d'autorisation,
// celui d'un cache qui garde un accès révoqué.
import type { Db } from '../noyau/db';
import { aujourdhui } from '../noyau/dates';
import { Entrees, Portee, Role, calculer } from './roles';
import { TypeBien, taux } from '../sejours/occupation';

/** Tout ce qui compose les portées, à une date donnée. */
export function lireEntrees(db: Db, date = aujourdhui()): Entrees {
  return {
    biens: db.prepare(
      'SELECT id AS bienId, structure_id AS structureId FROM bien WHERE archive_le IS NULL',
    ).all() as Entrees['biens'],

    roles: db.prepare(`
      SELECT personne_id AS personneId, structure_id AS structureId, bien_id AS bienId, role
      FROM role_attribue
      WHERE archive_le IS NULL AND debut <= ? AND (fin IS NULL OR fin >= ?)
    `).all(date, date) as Entrees['roles'],

    // La détention en vigueur à la date : c'est elle qui donne « detenteur »,
    // sans qu'aucun rôle n'ait à être saisi en double.
    detentions: db.prepare(`
      SELECT DISTINCT personne_id AS personneId, structure_id AS structureId
      FROM detention
      WHERE effet_du <= ? AND (effet_au IS NULL OR effet_au > ?)
    `).all(date, date) as Entrees['detentions'],

    personnes: db.prepare(
      'SELECT id AS personneId, foyer_id AS foyerId FROM personne WHERE archive_le IS NULL',
    ).all() as Entrees['personnes'],
  };
}

export function porteeDe(db: Db, personneId: number, date = aujourdhui()): Portee {
  return calculer(personneId, lireEntrees(db, date));
}

/** Les biens visibles, avec ce qu'il faut pour la barre de contexte. */
export interface BienVisible {
  id: number; nom: string; commune: string; type: string; couchages: number;
  locationActivee: boolean; structureId: number; structureMode: string; structureNom: string;
  role: Role;
  /** « Occupation été » ou « Occupation hiver », selon le type du bien. */
  occupationLibelle: string;
  occupationPourcent: number;
  /** Combien de personnes détiennent, aujourd'hui, la structure du bien. */
  detenteurs: number;
}

interface LigneBienVisible {
  id: number; nom: string; commune: string; type: string; couchages: number;
  location_activee: number; structureId: number; structureMode: string; structureNom: string;
}

/**
 * Le taux d'occupation de la saison, et le nombre de détenteurs.
 *
 * Les deux enrichissent la carte de bien du tableau de bord, que la maquette
 * veut à trois statistiques. Une requête par bien : une famille en a deux ou
 * trois, et le tableau de bord se charge une fois par ouverture de session.
 */
function saisonEtDetenteurs(db: Db, bienId: number, type: string, structureId: number): {
  occupationLibelle: string; occupationPourcent: number; detenteurs: number;
} {
  const annee = Number(aujourdhui().slice(0, 4));
  const sejours = db.prepare(
    `SELECT arrivee, depart FROM sejour
     WHERE bien_id = ? AND statut = 'valide' AND archive_le IS NULL`,
  ).all(bienId) as { arrivee: string; depart: string }[];
  const t = taux(type as TypeBien, annee, sejours);
  const detenteurs = (db.prepare(
    `SELECT COUNT(DISTINCT personne_id) AS n FROM detention
     WHERE structure_id = ? AND effet_du <= ? AND (effet_au IS NULL OR effet_au > ?)`,
  ).get(structureId, aujourdhui(), aujourdhui()) as { n: number } | undefined)?.n ?? 0;
  return { occupationLibelle: t.libelle, occupationPourcent: t.pourcent, detenteurs };
}

export function biensDeLaPortee(db: Db, p: Portee): BienVisible[] {
  const ids = [...p.biens.keys()];
  if (!ids.length) return [];
  const lignes = db.prepare(`
    SELECT b.id, b.nom, b.commune, b.type, b.couchages, b.location_activee,
           b.structure_id AS structureId, s.mode AS structureMode, s.nom AS structureNom
    FROM bien b JOIN structure s ON s.id = b.structure_id
    WHERE b.id IN (${ids.map(() => '?').join(',')}) AND b.archive_le IS NULL
    ORDER BY b.nom
  `).all(...ids) as LigneBienVisible[];
  return lignes.map((l) => ({
    id: l.id, nom: l.nom, commune: l.commune, type: l.type, couchages: l.couchages,
    locationActivee: !!l.location_activee,
    structureId: l.structureId, structureMode: l.structureMode, structureNom: l.structureNom,
    role: p.biens.get(l.id) as Role,
    ...saisonEtDetenteurs(db, l.id, l.type, l.structureId),
  }));
}
