// Migration 004 : l'invitation d'une personne.
//
// Le parcours promis par la tranche 1 (« le gérant crée la personne, elle
// choisit son mot de passe elle-même ») ne fonctionnait pas : le jeton de lien
// n'existait que pour un compte ayant déjà un mot de passe, si bien qu'une
// personne nouvellement créée ne pouvait jamais en obtenir un. La table des
// jetons devient donc commune aux deux usages, distingués par `motif`.
//
// `cree_par` répond à la question « qui a invité cette personne, et quand », qui
// se posera le jour où quelqu'un aura reçu un accès qu'il n'aurait pas dû avoir.
// `vu_le` marque le moment où le lien a été **affiché en clair** à un gérant :
// c'est le repli demandé quand aucun relais de courriel n'est configuré, et
// afficher le lien revient à pouvoir choisir le mot de passe de quelqu'un
// d'autre. Cela se trace.
import type { Migration } from './index';

export const migration004: Migration = {
  version: 4,
  libelle: 'Invitations : jetons de lien communs à la réinitialisation et à la bienvenue',
  up(db) {
    db.exec(`
      ALTER TABLE reinit_mot_de_passe ADD COLUMN motif TEXT NOT NULL DEFAULT 'oubli';
      ALTER TABLE reinit_mot_de_passe ADD COLUMN cree_par INTEGER REFERENCES personne(id);
      ALTER TABLE reinit_mot_de_passe ADD COLUMN vu_le TEXT;

      CREATE INDEX idx_reinit_personne ON reinit_mot_de_passe(personne_id, motif)
        WHERE utilise_le IS NULL;
    `);
  },
};
