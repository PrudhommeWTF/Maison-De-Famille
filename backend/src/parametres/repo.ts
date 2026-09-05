// La lecture et l'écriture des paramètres.
//
// Une seule porte d'entrée en lecture, `parametre()`, et une seule en écriture,
// `poser()`. Aucun module ne fait de `SELECT` sur la table `parametre` : c'est
// ce qui permet à la CI de vérifier que tout ce qui est déclaré est lu, et que
// tout ce qui est lu est déclaré.
//
// La valeur d'un paramètre absent de la table est son défaut. Rien n'est écrit
// tant que personne ne change la valeur : une installation existante ne casse
// pas quand un réglage apparaît, et remettre à zéro consiste à supprimer la
// ligne.
import type { Db } from '../noyau/db';
import { horodatage } from '../noyau/dates';
import { invalide } from '../noyau/erreurs';
import { Declaration, REGISTRE, convertir, declaration, versStockage } from './registre';

/** À quoi le paramètre se rapporte. Selon sa portée, une seule de ces valeurs sert. */
export interface Cible { bienId?: number; structureId?: number; personneId?: number }

function porteeId(d: Declaration, cible: Cible): number {
  switch (d.portee) {
    case 'bien':
      if (!cible.bienId) throw new Error(`Le paramètre ${d.cle} est propre à un bien : précisez lequel.`);
      return cible.bienId;
    case 'structure':
      if (!cible.structureId) throw new Error(`Le paramètre ${d.cle} est propre à une structure : précisez laquelle.`);
      return cible.structureId;
    case 'personnel':
      if (!cible.personneId) throw new Error(`Le paramètre ${d.cle} est personnel : précisez la personne.`);
      return cible.personneId;
    default:
      return 0;
  }
}

/**
 * La valeur effective d'un paramètre.
 *
 * Typée par le point d'appel : `parametre<boolean>(db, 'capaciteBloquante', { bienId })`.
 * Une clé inconnue lève, parce que c'est une faute de code et non une donnée
 * douteuse.
 */
export function parametre<T extends boolean | number | string>(db: Db, cle: string, cible: Cible = {}): T {
  const d = declaration(cle);
  const ligne = db.prepare('SELECT valeur FROM parametre WHERE cle = ? AND portee = ? AND portee_id = ?')
    .get(cle, d.portee, porteeId(d, cible)) as { valeur: string } | undefined;
  return (ligne ? convertir(d, ligne.valeur) : d.defaut) as T;
}

export function poser(db: Db, cle: string, valeur: unknown, cible: Cible, parQui: number | null): void {
  const d = declaration(cle);
  if (d.portee === 'deploiement') {
    throw invalide(`Le réglage « ${d.libelle} » vient de la configuration du serveur et ne se change pas ici.`);
  }
  const stocke = versStockage(d, valeur);
  if (stocke === null) throw invalide(`La valeur proposée pour « ${d.libelle} » n'est pas acceptable.`);
  db.prepare(`
    INSERT INTO parametre (cle, portee, portee_id, valeur, maj_le, maj_par)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (cle, portee, portee_id) DO UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le, maj_par = excluded.maj_par
  `).run(cle, d.portee, porteeId(d, cible), stocke, horodatage(), parQui);
}

/** Remet un réglage à son défaut en supprimant la ligne. */
export function remettreParDefaut(db: Db, cle: string, cible: Cible): void {
  const d = declaration(cle);
  db.prepare('DELETE FROM parametre WHERE cle = ? AND portee = ? AND portee_id = ?')
    .run(cle, d.portee, porteeId(d, cible));
}

export interface ParametreExpose extends Declaration { valeur: boolean | number | string; parDefaut: boolean }

/**
 * Le registre avec les valeurs effectives, pour engendrer la page de
 * configuration. Les paramètres de portée `bien`, `structure` ou `personnel`
 * ne sont rendus que si la cible correspondante est fournie.
 */
export function exposer(db: Db, cible: Cible): ParametreExpose[] {
  const out: ParametreExpose[] = [];
  for (const d of REGISTRE) {
    if (d.portee === 'bien' && !cible.bienId) continue;
    if (d.portee === 'structure' && !cible.structureId) continue;
    if (d.portee === 'personnel' && !cible.personneId) continue;
    const ligne = db.prepare('SELECT valeur FROM parametre WHERE cle = ? AND portee = ? AND portee_id = ?')
      .get(d.cle, d.portee, porteeId(d, cible)) as { valeur: string } | undefined;
    out.push({ ...d, valeur: ligne ? convertir(d, ligne.valeur) : d.defaut, parDefaut: !ligne });
  }
  return out;
}
