// Ce qu'il reste à faire pour qu'une instance neuve serve à quelque chose.
//
// Module PUR : ni HTTP, ni signal. Il prend des faits et rend une liste
// d'étapes, ce qui le rend testable seul et empêche la logique de se disperser
// dans un gabarit.
//
// **Pourquoi cette carte existe.** Juste après l'installation, le tableau de
// bord annonçait « Rien à traiter pour le moment » et « Aucun séjour prévu ».
// C'était exact et inutile : rien ne disait par où commencer, alors que le
// brief demande que l'écran d'accueil dise immédiatement ce qui concerne la
// personne, sans exploration.
//
// L'ordre n'est pas décoratif, il suit les dépendances réelles : sans seconde
// personne on ne peut désigner personne d'autre gérant, sans quotes-parts
// aucune dépense ne se répartit, et sans relais de courriel personne n'est
// prévenu de rien.

export interface FaitsDemarrage {
  /** Nombre de personnes existantes, la gérante comprise. */
  personnes: number;
  /** Structures comptant moins de deux gérants, avec leur nom. */
  structuresSansSecondGerant: readonly string[];
  /** Une répartition de quotes-parts a-t-elle été saisie sur la structure ouverte ? */
  quotesPartsSaisies: boolean;
  /** Un relais SMTP est-il configuré ? */
  relaisConfigure: boolean;
  /** L'adresse publique, sans laquelle les liens des courriels sont inutilisables. */
  adressePubliqueRenseignee: boolean;
  /** Des séjours existent-ils déjà, importés ou saisis ? */
  sejours: number;
}

export interface Etape {
  cle: string;
  titre: string;
  /** Ce que la personne y gagne, pas ce que le logiciel y fait. */
  pourquoi: string;
  lien: string | null;
  /** Une étape bloquante ne se contourne pas : elle laisse l'instance fragile. */
  bloquante: boolean;
}

export function etapes(f: FaitsDemarrage): Etape[] {
  const out: Etape[] = [];

  if (f.personnes < 2) {
    out.push({
      cle: 'personnes',
      titre: 'Inscrire la famille',
      pourquoi: "Vous êtes seule sur l'instance. Créez les comptes, chacun choisira son mot de passe.",
      lien: '/administration/personnes', bloquante: false,
    });
  }

  for (const nom of f.structuresSansSecondGerant) {
    out.push({
      cle: `gerant:${nom}`,
      titre: `Désigner un second gérant pour ${nom}`,
      pourquoi: 'Si vous perdez votre accès, plus personne ne peut arbitrer une demande '
        + "ni saisir un séjour. C'est la seule porte de secours qui ne passe pas par une sauvegarde.",
      lien: '/bien/roles', bloquante: true,
    });
  }

  if (!f.quotesPartsSaisies) {
    out.push({
      cle: 'quotes-parts',
      titre: 'Saisir les quotes-parts',
      pourquoi: "Avec leur date d'effet réelle, celle de l'acte, pas celle du jour. "
        + 'Sans elles, aucune dépense ne peut se répartir.',
      lien: '/bien/membres', bloquante: false,
    });
  }

  if (!f.relaisConfigure) {
    out.push({
      cle: 'smtp',
      titre: 'Configurer le relais de courriel',
      pourquoi: 'Sans lui, les invitations et les notifications sont enregistrées mais ne partent pas. '
        + 'En attendant, un lien d\'invitation peut être affiché et transmis à la main.',
      lien: '/etat', bloquante: false,
    });
  } else if (!f.adressePubliqueRenseignee) {
    // Un relais configuré sans adresse publique envoie des courriels dont les
    // liens ne mènent nulle part : c'est pire que pas de courriel du tout.
    out.push({
      cle: 'adresse-publique',
      titre: "Renseigner l'adresse publique",
      pourquoi: 'Les liens des courriels sont absolus. Sans elle, ils partent incomplets '
        + 'et personne ne peut cliquer.',
      lien: '/etat', bloquante: true,
    });
  }

  if (!f.sejours) {
    out.push({
      cle: 'planning',
      titre: 'Importer le planning existant',
      pourquoi: 'Le calendrier reste vide tant que les séjours déjà convenus ne sont pas repris. '
        + "L'import se simule d'abord, et s'annule si le résultat ne convient pas.",
      lien: '/bien/import', bloquante: false,
    });
  }

  return out;
}
