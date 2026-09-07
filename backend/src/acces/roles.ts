// Les rôles et le calcul de la portée. Module PUR : aucune base, aucun HTTP.
//
// C'est ici qu'est écrite la règle la plus importante de l'application :
//
//   > Un détenteur d'un bien ne doit rien voir d'un autre bien auquel il n'est
//   > pas rattaché.
//
// Elle n'est pas répartie dans les routes, où elle finirait par manquer à un
// endroit. Elle est calculée une fois par requête, ici, et les requêtes SQL des
// modules reçoivent la liste des biens autorisés en paramètre. Le serveur ne
// lit jamais ce qu'il n'a pas le droit de rendre : il ne filtre pas après coup.
//
// Trois sources de rôle, et elles se cumulent en gardant la plus large :
//
//   1. **La détention** : détenir des parts dans une structure à la date du jour
//      donne « detenteur » sur tous ses biens. C'est la source de vérité, il n'y
//      a pas de double comptabilité à tenir à jour.
//   2. **Le rôle attribué** : ce que la détention ne dit pas, c'est qui gère.
//      « gerant », « invite », et les rattachements explicites vivent là.
//   3. **Le foyer** : le conjoint d'un détenteur obtient « membre_foyer » sur
//      les biens de ce détenteur, sans qu'on ait à le saisir deux fois.

export type Role = 'gerant' | 'detenteur' | 'membre_foyer' | 'invite';

/** Du plus large au plus étroit. Un rôle en vaut un autre s'il le domine. */
export const RANG: Record<Role, number> = { gerant: 3, detenteur: 2, membre_foyer: 1, invite: 0 };

export const auMoins = (role: Role, requis: Role): boolean => RANG[role] >= RANG[requis];

/** Garde le plus large des deux. */
export const plusLarge = (a: Role | undefined, b: Role): Role =>
  a === undefined || RANG[b] > RANG[a] ? b : a;

export interface LigneRole {
  personneId: number;
  structureId: number | null;
  bienId: number | null;
  role: Role;
}

export interface LigneDetention { personneId: number; structureId: number }

/** Un bien et la structure qui le porte. */
export interface LigneBien { bienId: number; structureId: number }

export interface LignePersonne { personneId: number; foyerId: number | null }

export interface Entrees {
  biens: readonly LigneBien[];
  roles: readonly LigneRole[];
  detentions: readonly LigneDetention[];
  personnes: readonly LignePersonne[];
}

export interface Portee {
  personneId: number | null;
  /** Bien vers rôle effectif. Un bien absent de cette table n'existe pas pour cette personne. */
  biens: Map<number, Role>;
  structures: Map<number, Role>;
}

const vide = (personneId: number | null): Portee => ({ personneId, biens: new Map(), structures: new Map() });

/**
 * La portée effective d'une personne.
 *
 * L'ordre des trois passes compte : la détention pose le socle, les rôles
 * attribués élargissent (un gérant est aussi détenteur), et le foyer ne
 * s'applique qu'à ce que les deux premières n'ont pas déjà donné.
 */
export function calculer(personneId: number, e: Entrees): Portee {
  const p = vide(personneId);
  const biensDe = new Map<number, number[]>();
  for (const b of e.biens) {
    const l = biensDe.get(b.structureId);
    if (l) l.push(b.bienId); else biensDe.set(b.structureId, [b.bienId]);
  }

  const poserStructure = (structureId: number, role: Role): void => {
    p.structures.set(structureId, plusLarge(p.structures.get(structureId), role));
    for (const bienId of biensDe.get(structureId) ?? []) {
      p.biens.set(bienId, plusLarge(p.biens.get(bienId), role));
    }
  };

  // 1. La détention donne « detenteur » sur toute la structure.
  for (const d of e.detentions) if (d.personneId === personneId) poserStructure(d.structureId, 'detenteur');

  // 2. Les rôles attribués, à l'échelle d'une structure ou d'un seul bien.
  for (const r of e.roles) {
    if (r.personneId !== personneId) continue;
    if (r.structureId !== null) poserStructure(r.structureId, r.role);
    else if (r.bienId !== null) p.biens.set(r.bienId, plusLarge(p.biens.get(r.bienId), r.role));
  }

  // 3. Le foyer : ce que voit un détenteur, les siens le voient en membre de
  //    foyer. Sans cette passe, il faudrait saisir chaque conjoint sur chaque
  //    bien, et l'oubli se traduirait par « je ne vois pas le calendrier ».
  const moi = e.personnes.find((x) => x.personneId === personneId);
  if (moi?.foyerId != null) {
    const memeFoyer = new Set(
      e.personnes.filter((x) => x.foyerId === moi.foyerId && x.personneId !== personneId).map((x) => x.personneId),
    );
    for (const d of e.detentions) if (memeFoyer.has(d.personneId)) {
      p.structures.set(d.structureId, plusLarge(p.structures.get(d.structureId), 'membre_foyer'));
      for (const bienId of biensDe.get(d.structureId) ?? []) {
        p.biens.set(bienId, plusLarge(p.biens.get(bienId), 'membre_foyer'));
      }
    }
    for (const r of e.roles) {
      if (!memeFoyer.has(r.personneId) || !auMoins(r.role, 'detenteur')) continue;
      if (r.structureId !== null) {
        p.structures.set(r.structureId, plusLarge(p.structures.get(r.structureId), 'membre_foyer'));
        for (const bienId of biensDe.get(r.structureId) ?? []) {
          p.biens.set(bienId, plusLarge(p.biens.get(bienId), 'membre_foyer'));
        }
      } else if (r.bienId !== null) {
        p.biens.set(r.bienId, plusLarge(p.biens.get(r.bienId), 'membre_foyer'));
      }
    }
  }

  return p;
}

/** Le rôle sur ce bien, ou null quand le bien n'est pas dans la portée. */
export const roleSurBien = (p: Portee, bienId: number): Role | null => p.biens.get(bienId) ?? null;

export const roleSurStructure = (p: Portee, structureId: number): Role | null =>
  p.structures.get(structureId) ?? null;

/** Les identifiants de biens visibles, pour un `WHERE bien_id IN (...)`. */
export const biensVisibles = (p: Portee): number[] => [...p.biens.keys()];

/**
 * Les biens où le rôle atteint au moins `requis`.
 *
 * Sert aux listes consolidées, qui traversent plusieurs biens sans que l'adresse
 * en porte un : sans ce filtre, elles rendent au plus large ce que la route d'un
 * bien réserve au plus étroit. Le carnet d'entretien demande `membre_foyer`,
 * mais ses échéances remontaient au tableau de bord d'un invité.
 */
export const biensAuMoins = (p: Portee, requis: Role): number[] =>
  [...p.biens.entries()].filter(([, role]) => auMoins(role, requis)).map(([id]) => id);

/** Gérant d'au moins une structure : le droit de créer une structure ou un bien. */
export const estGerant = (p: Portee): boolean => [...p.structures.values()].includes('gerant');
