// La validation des entrées.
//
// Une seule règle : **rien n'entre sans être validé et converti**. Pas de
// `req.body.montant as number`, pas de `parseInt` optimiste. Chaque champ est
// lu par une fonction qui rend la valeur typée ou lève une erreur portant le
// nom du champ, ce qui permet à l'interface de surligner le bon endroit.
//
// Les messages sont en français et disent ce qui est attendu, pas « invalid
// input » : c'est la famille qui les lit.
import { ErreurApp, invalide } from './erreurs';
import { estDate } from './dates';

/**
 * Le lecteur accumule les erreurs et ne lève qu'à l'appel de `fin()`, pour
 * pouvoir signaler tous les champs fautifs d'un coup plutôt qu'un par un.
 *
 * La contrepartie est un piège : **oublier `fin()` fait accepter une valeur
 * invalide en silence**. C'est arrivé une fois, sur un motif de recalcul
 * obligatoire qui passait à vide. Un test de CI compte donc les lectures et les
 * `fin()` de chaque fichier de routes, et refuse tout déséquilibre.
 */
export class Lecteur {
  private readonly erreurs: Record<string, string> = {};

  constructor(private readonly source: Record<string, unknown>) {}

  private echec<T>(champ: string, message: string, defaut: T): T {
    this.erreurs[champ] = message;
    return defaut;
  }

  texte(champ: string, opts: { max?: number; min?: number; defaut?: string } = {}): string {
    const brut = this.source[champ];
    if (brut === undefined || brut === null || brut === '') {
      if (opts.defaut !== undefined) return opts.defaut;
      return this.echec(champ, 'Ce champ est obligatoire.', '');
    }
    if (typeof brut !== 'string') return this.echec(champ, 'Ce champ doit être du texte.', '');
    const v = brut.trim();
    const min = opts.min ?? 1;
    if (v.length < min) return this.echec(champ, `Au moins ${min} caractère${min > 1 ? 's' : ''}.`, '');
    const max = opts.max ?? 500;
    if (v.length > max) return this.echec(champ, `Au plus ${max} caractères.`, '');
    return v;
  }

  entier(champ: string, opts: { min?: number; max?: number; defaut?: number } = {}): number {
    const brut = this.source[champ];
    if (brut === undefined || brut === null || brut === '') {
      if (opts.defaut !== undefined) return opts.defaut;
      return this.echec(champ, 'Ce champ est obligatoire.', 0);
    }
    const v = typeof brut === 'number' ? brut : Number(brut);
    if (!Number.isInteger(v)) return this.echec(champ, 'Un nombre entier est attendu.', 0);
    if (opts.min !== undefined && v < opts.min) return this.echec(champ, `Au minimum ${opts.min}.`, 0);
    if (opts.max !== undefined && v > opts.max) return this.echec(champ, `Au maximum ${opts.max}.`, 0);
    return v;
  }

  date(champ: string, opts: { defaut?: string | null } = {}): string {
    const brut = this.source[champ];
    if (brut === undefined || brut === null || brut === '') {
      if (opts.defaut !== undefined) return opts.defaut ?? '';
      return this.echec(champ, 'Une date est obligatoire.', '');
    }
    if (!estDate(brut)) return this.echec(champ, 'Date attendue au format jour/mois/année.', '');
    return brut;
  }

  choix<T extends string>(champ: string, valeurs: readonly T[], opts: { defaut?: T } = {}): T {
    const brut = this.source[champ];
    if (brut === undefined || brut === null || brut === '') {
      if (opts.defaut !== undefined) return opts.defaut;
      return this.echec(champ, 'Ce champ est obligatoire.', valeurs[0]);
    }
    if (typeof brut !== 'string' || !valeurs.includes(brut as T)) {
      return this.echec(champ, `Valeur attendue parmi : ${valeurs.join(', ')}.`, valeurs[0]);
    }
    return brut as T;
  }

  booleen(champ: string, defaut = false): boolean {
    const brut = this.source[champ];
    if (brut === undefined || brut === null || brut === '') return defaut;
    if (typeof brut === 'boolean') return brut;
    if (brut === 'true' || brut === 1 || brut === '1') return true;
    if (brut === 'false' || brut === 0 || brut === '0') return false;
    return this.echec(champ, 'Oui ou non attendu.', defaut);
  }

  /** Un identifiant interne facultatif : un entier positif, ou null. */
  idFacultatif(champ: string): number | null {
    const brut = this.source[champ];
    if (brut === undefined || brut === null || brut === '') return null;
    const v = typeof brut === 'number' ? brut : Number(brut);
    if (!Number.isInteger(v) || v <= 0) return this.echec(champ, 'Identifiant invalide.', null);
    return v;
  }

  /**
   * Un entier facultatif : la valeur, ou null si le champ est absent.
   *
   * Distinct de `entier(champ, { defaut: 0 })` : un coût de zéro euro et un
   * coût non renseigné ne veulent pas dire la même chose, et les confondre
   * ferait apparaître des interventions gratuites dans l'historique.
   */
  entierFacultatif(champ: string, opts: { min?: number; max?: number } = {}): number | null {
    const brut = this.source[champ];
    if (brut === undefined || brut === null || brut === '') return null;
    const v = typeof brut === 'number' ? brut : Number(brut);
    if (!Number.isInteger(v)) return this.echec(champ, 'Un nombre entier est attendu.', null);
    if (opts.min !== undefined && v < opts.min) return this.echec(champ, `Au minimum ${opts.min}.`, null);
    if (opts.max !== undefined && v > opts.max) return this.echec(champ, `Au maximum ${opts.max}.`, null);
    return v;
  }

  /** Lève si un champ au moins a échoué. À appeler après toutes les lectures. */
  fin(): void {
    const cles = Object.keys(this.erreurs);
    if (!cles.length) return;
    const premier = this.erreurs[cles[0]];
    throw invalide(
      cles.length === 1 ? premier : `${cles.length} champs sont à corriger.`,
      { ...this.erreurs },
    );
  }
}

export const lire = (source: unknown): Lecteur =>
  new Lecteur(source && typeof source === 'object' ? (source as Record<string, unknown>) : {});

export { ErreurApp };
