// Les erreurs de l'application.
//
// Une erreur porte trois choses, et les trois comptent :
//
//   - un **code stable** (`SEJOUR_CHEVAUCHE`), sur lequel le frontend peut
//     brancher un comportement sans lire un message en français ;
//   - un **message en français** destiné à l'utilisateur, qui dit ce qui s'est
//     passé et si possible quoi faire ;
//   - un **détail** technique journalisé mais **jamais renvoyé au client**,
//     parce qu'un message d'erreur trop bavard renseigne un attaquant.
//
// La règle qui évite les fuites : le message français est écrit pour être lu par
// la famille, le détail est écrit pour être lu dans `journalctl`.

export type CodeErreur =
  | 'REQUETE_INVALIDE' | 'NON_AUTHENTIFIE' | 'ACCES_REFUSE' | 'INTROUVABLE'
  | 'CONFLIT' | 'TROP_DE_TENTATIVES' | 'FICHIER_REFUSE' | 'ETAT_INVALIDE'
  | 'PANNE_INTERNE';

const STATUTS: Record<CodeErreur, number> = {
  REQUETE_INVALIDE: 400, NON_AUTHENTIFIE: 401, ACCES_REFUSE: 403, INTROUVABLE: 404,
  CONFLIT: 409, TROP_DE_TENTATIVES: 429, FICHIER_REFUSE: 415, ETAT_INVALIDE: 422,
  PANNE_INTERNE: 500,
};

export class ErreurApp extends Error {
  readonly statut: number;
  constructor(
    readonly code: CodeErreur,
    message: string,
    readonly detail?: string,
    readonly champs?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ErreurApp';
    this.statut = STATUTS[code];
  }
}

export const invalide = (message: string, champs?: Record<string, string>): ErreurApp =>
  new ErreurApp('REQUETE_INVALIDE', message, undefined, champs);

export const refuse = (message = "Vous n'avez pas accès à cet élément."): ErreurApp =>
  new ErreurApp('ACCES_REFUSE', message);

export const introuvable = (quoi: string): ErreurApp =>
  new ErreurApp('INTROUVABLE', quoi + ' est introuvable.');

export const conflit = (message: string, detail?: string): ErreurApp =>
  new ErreurApp('CONFLIT', message, detail);

export const etatInvalide = (message: string): ErreurApp =>
  new ErreurApp('ETAT_INVALIDE', message);
