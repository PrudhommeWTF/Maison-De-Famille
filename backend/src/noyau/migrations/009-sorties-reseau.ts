// Migration 009 : deux réglages qui n'ont plus d'objet.
//
// `majVerification` et `vacancesTelechargement` n'existaient que pour tenir une
// règle disparue : « aucun appel réseau sortant ». Ils commandaient l'existence
// de deux boutons, et leur défaut éteint donnait un écran qui taisait pourquoi
// le bouton manquait. Les appels sont désormais permis, encadrés dans le code
// et non par un interrupteur.
//
// Une ligne de `parametre` dont la clé n'est plus déclarée est déjà ignorée à
// la lecture : cette migration ne corrige aucun défaut, elle évite qu'on tombe
// dans deux ans sur des valeurs orphelines en se demandant ce qu'elles
// commandent. C'est la seule suppression que ce projet s'autorise, et elle ne
// porte sur aucune donnée de la famille.
import type { Migration } from './index';

export const migration009: Migration = {
  version: 9,
  libelle: 'Retrait des deux interrupteurs de sortie réseau',
  up(db) {
    db.prepare("DELETE FROM parametre WHERE cle IN ('majVerification', 'vacancesTelechargement')").run();
  },
};
