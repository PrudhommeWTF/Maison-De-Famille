// Migration 010 : administrer la plateforme n'est plus gérer un bien.
//
// **Le problème.** « Gérant » disait deux choses à la fois : qui arbitre les
// séjours et les dépenses d'une indivision, et qui tient la machine. La
// personne qui héberge le service se retrouvait obligée de se nommer gérante
// d'une indivision où elle n'a rien à arbitrer, pour avoir le droit de regarder
// une file de courriel ou d'installer une mise à jour. L'inverse est aussi
// vrai : une gérante qui n'a jamais ouvert un terminal se voyait proposer de
// lancer du code en root sur un serveur.
//
// **Le droit est un attribut de la personne, pas un rôle.** Une colonne plutôt
// qu'une ligne dans `role_attribue` : ce droit ne se rapporte à aucune
// structure ni à aucun bien, il n'a ni date d'effet ni portée, et l'y ranger
// aurait obligé chaque lecture de rôle à écarter un cas qui n'en est pas un.
//
// **Les gérants actuels le reçoivent.** Sans cette ligne, la montée de version
// retirerait l'Administration à tout le monde d'un coup, y compris à la seule
// personne capable de la redonner. Une migration ne doit jamais fermer la porte
// derrière elle.
import type { Migration } from './index';

export const migration010: Migration = {
  version: 10,
  libelle: 'Droit d\'administration de la plateforme, distinct des rôles',
  up(db) {
    db.exec('ALTER TABLE personne ADD COLUMN admin_plateforme INTEGER NOT NULL DEFAULT 0');
    db.prepare(`
      UPDATE personne SET admin_plateforme = 1
      WHERE archive_le IS NULL AND id IN (
        SELECT personne_id FROM role_attribue
        WHERE role = 'gerant' AND archive_le IS NULL AND (fin IS NULL OR fin >= date('now'))
      )
    `).run();
  },
};
