// La lecture en base des éléments qui composent une portée.
//
// Quatre requêtes courtes, exécutées une fois par requête HTTP authentifiée. La
// famille compte quelques dizaines de personnes et quelques biens : tout tient
// en mémoire, et recalculer à chaque fois évite le pire des bugs d'autorisation,
// celui d'un cache qui garde un accès révoqué.
import type { Db } from '../noyau/db';
import { aujourdhui } from '../noyau/dates';
import { Entrees, Portee, Role, auMoins, calculer } from './roles';
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

    personnes: db.prepare(`
      SELECT id AS personneId, foyer_id AS foyerId,
             admin_plateforme AS adminPlateforme
      FROM personne WHERE archive_le IS NULL
    `).all().map((l) => {
      const r = l as { personneId: number; foyerId: number | null; adminPlateforme: number };
      // SQLite rend 0 ou 1 : le module pur, lui, ne connaît que des booléens.
      return { personneId: r.personneId, foyerId: r.foyerId, adminPlateforme: r.adminPlateforme === 1 };
    }) as Entrees['personnes'],
  };
}

export function porteeDe(db: Db, personneId: number, date = aujourdhui()): Portee {
  return calculer(personneId, lireEntrees(db, date));
}

/** Les biens visibles, avec ce qu'il faut pour la barre de contexte. */
/**
 * Les personnes qu'un séjour peut nommer sur ce bien.
 *
 * Le calcul repasse par `calculer()`, personne par personne, plutôt que par une
 * requête SQL qui rejouerait la règle. C'est plus lourd d'une boucle sur
 * quelques dizaines de lignes, et cela évite la seule faute qui compte ici :
 * une seconde définition de « qui a accès à ce bien », qui aurait divergé de la
 * première au premier cas particulier (la détention qui donne « detenteur »
 * sans rôle saisi, le conjoint qui suit son foyer).
 *
 * Deux exclusions : les comptes ouverts uniquement par un lien de séjour
 * (`acces_lien_seul`), qui ne sont pas des membres de la famille, et les rôles
 * « invite », qui désignent justement ces passages.
 */
export function nommablesSurBien(db: Db, bienId: number, date = aujourdhui()): {
  id: number; nom: string; foyerNom: string | null;
}[] {
  const e = lireEntrees(db, date);
  const lignes = db.prepare(
    `SELECT p.id, p.nom, f.nom AS foyerNom
     FROM personne p LEFT JOIN foyer f ON f.id = p.foyer_id
     WHERE p.archive_le IS NULL AND p.acces_lien_seul = 0
     ORDER BY p.nom`,
  ).all() as { id: number; nom: string; foyerNom: string | null }[];
  return lignes.filter((l) => {
    const role = calculer(l.id, e).biens.get(bienId);
    return !!role && auMoins(role, 'membre_foyer');
  });
}

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
