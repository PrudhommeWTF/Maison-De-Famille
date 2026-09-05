// Migration 002 : le second facteur.
//
// Séparée du socle à dessein : elle montre le mécanisme de migration à l'oeuvre
// sur une installation déjà en service, et une colonne ajoutée à une table qui
// porte des lignes est exactement le cas qu'il faut savoir gérer.
//
// `totp_pending` porte le secret d'un enrôlement commencé et pas confirmé : il
// ne protège rien tant que la personne n'a pas prouvé qu'elle lit bien les codes,
// et il ne doit donc pas être pris pour un second facteur actif.
//
// `totp_last_step` refuse le rejeu d'un code déjà consommé : sans cette colonne,
// quelqu'un qui lit un code par-dessus une épaule a trente secondes pour s'en
// servir à son tour.
import type { Migration } from './index';

export const migration002: Migration = {
  version: 2,
  libelle: 'Second facteur (TOTP) et codes de secours',
  up(db) {
    db.exec(`
      ALTER TABLE personne ADD COLUMN totp_secret TEXT;
      ALTER TABLE personne ADD COLUMN totp_pending TEXT;
      ALTER TABLE personne ADD COLUMN totp_recovery TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE personne ADD COLUMN totp_last_step INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE personne ADD COLUMN totp_active_le TEXT;
    `);
  },
};
