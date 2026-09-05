// Le registre des paramètres.
//
// Un paramètre se déclare **ici, une seule fois** : sa clé, son type, sa valeur
// par défaut, sa portée, sa section, son libellé et sa description en français.
// La page de configuration est **engendrée** depuis ce fichier : ajouter un
// réglage ne demande jamais de toucher à un écran.
//
// Le code ne lit jamais une valeur autrement que par `parametre('cle', ...)`.
// C'est cette contrainte qui rend la dérive détectable, et la CI la détecte
// (voir backend/test/parametres-registre.test.ts) :
//
//   - un paramètre déclaré que personne ne lit fait échouer le test ;
//   - une clé lue qui n'est pas déclarée fait échouer le test ;
//   - la moindre différence entre les deux copies de ce fichier fait échouer.
//
// **Les deux copies de ce fichier sont identiques octet pour octet :**
//
//   backend/src/parametres/registre.ts
//   frontend/src/app/core/parametres/registre.ts
//
// Un vrai fichier partagé à la racine imposerait de changer le `rootDir` du
// backend, donc la forme de `dist/`, donc l'unité systemd et les scripts de mise
// à jour : le prix dépasse le bénéfice. Ce fichier n'importe donc rien, pour
// rester copiable tel quel.
//
// La clé d'un paramètre **est** sa clé de stockage : il n'y a aucune migration à
// écrire pour la renommer, parce qu'on ne la renomme pas. Un paramètre
// nouvellement déclaré n'existe dans aucune installation : la lecture rend son
// défaut, et rien n'est écrit tant que personne ne change la valeur. Une
// installation existante ne casse donc jamais.

/**
 * Où vit un paramètre, et qui a le droit de l'écrire.
 *
 *   - `deploiement` : variable d'environnement ou disque. Jamais modifiable
 *     depuis l'interface, affiché en lecture seule pour qu'on sache ce qui
 *     s'applique réellement.
 *   - `instance`    : partagé par toute la famille, écrit par un gérant.
 *   - `structure`   : propre à une indivision ou à une SCI.
 *   - `bien`        : propre à un bien. C'est ce qui permet à la location
 *     saisonnière d'exister sur un bien et pas sur l'autre, sans aucun test sur
 *     un identifiant de bien dans le code.
 *   - `personnel`   : propre à une personne, écrit par elle-même.
 */
export type Portee = 'deploiement' | 'instance' | 'structure' | 'bien' | 'personnel';

export type TypeParam = 'bool' | 'int' | 'enum' | 'text';

export interface Option { valeur: string; libelle: string }

export interface Declaration {
  /** Clé de stockage. Unique dans tout le registre, toutes portées confondues. */
  cle: string;
  type: TypeParam;
  portee: Portee;
  /** Identifiant d'une section de `SECTIONS`. */
  section: string;
  /** Le module propriétaire, tel qu'il se nomme pour l'utilisateur. */
  module: string;
  libelle: string;
  /**
   * Ce que le réglage change concrètement, et où l'effet se voit. Jamais une
   * reformulation du libellé : c'est le seul texte qui évite d'aller lire le code.
   */
  description: string;
  defaut: boolean | number | string;
  options?: readonly Option[];
  min?: number;
  max?: number;
  maxLongueur?: number;
}

export interface Section { id: string; libelle: string; description: string }

export const SECTIONS: readonly Section[] = [
  { id: 'general', libelle: 'Général', description: "Identité de l'instance et affichage." },
  { id: 'sejours', libelle: 'Séjours', description: 'Calendrier, conflits, capacité et quotas.' },
  { id: 'securite', libelle: 'Sécurité', description: 'Second facteur et visibilité des informations sensibles.' },
  { id: 'courriel', libelle: 'Courriel', description: "Envoi des notifications et reprise en cas de panne." },
  { id: 'fichiers', libelle: 'Fichiers', description: 'Photos et pièces jointes.' },
  { id: 'exploitation', libelle: 'Exploitation', description: 'Journalisation et diagnostic.' },
];

export const REGISTRE: readonly Declaration[] = [
  {
    cle: 'instanceNom', type: 'text', portee: 'instance', section: 'general', module: 'Général',
    libelle: "Nom de l'instance",
    description: "Apparaît dans l'objet des courriels et dans l'en-tête de l'application. Utile quand plusieurs familles hébergent la même application sur le même réseau.",
    defaut: 'Maison de Famille', maxLongueur: 60,
  },
  {
    cle: 'semaineCommenceDimanche', type: 'bool', portee: 'personnel', section: 'general', module: 'Calendrier',
    libelle: 'Commencer la semaine le dimanche',
    description: "Change la première colonne de la grille du calendrier. Chacun règle le sien, cela n'affecte personne d'autre.",
    defaut: false,
  },
  {
    cle: 'capaciteBloquante', type: 'bool', portee: 'bien', section: 'sejours', module: 'Séjours',
    libelle: 'Refuser une demande qui dépasse les couchages',
    description: "Quand ce réglage est actif, une demande dont le nombre d'occupants dépasse la capacité du bien ne peut pas être envoyée. Sinon elle part avec un avertissement, et la gérante tranche.",
    defaut: false,
  },
  {
    cle: 'quotaAvertissement', type: 'bool', portee: 'bien', section: 'sejours', module: 'Séjours',
    libelle: 'Signaler le dépassement de quota',
    description: "Affiche un avertissement quand un foyer demande plus de nuits que son quota de la saison. Le quota reste indicatif : la gérante peut toujours valider, et le dépassement est enregistré dans le journal.",
    defaut: true,
  },
  {
    cle: 'totpObligatoirePourGerant', type: 'bool', portee: 'instance', section: 'securite', module: 'Sécurité',
    libelle: 'Second facteur obligatoire pour les gérants',
    description: "Un gérant qui n'a pas activé le second facteur ne peut plus se connecter tant qu'il ne l'a pas fait. À n'activer qu'une fois que chaque gérant a imprimé ses codes de secours : sans cela, vous vous verrouillez dehors.",
    defaut: false,
  },
  {
    cle: 'membreFoyerVoitDepenses', type: 'bool', portee: 'instance', section: 'securite', module: 'Sécurité',
    libelle: 'Les membres de foyer voient les dépenses',
    description: "Quand ce réglage est inactif, le conjoint d'un indivisaire ne voit ni la liste des dépenses ni les soldes des autres foyers. Le défaut est prudent : sinon un conjoint découvrirait le montant de la taxe foncière avant l'indivisaire concerné.",
    defaut: false,
  },
  {
    cle: 'membreFoyerVoitParts', type: 'bool', portee: 'instance', section: 'securite', module: 'Sécurité',
    libelle: 'Les membres de foyer voient les quotes-parts',
    description: "Quand ce réglage est inactif, le conjoint d'un indivisaire voit qui compose l'indivision mais pas la répartition chiffrée des parts. C'est une information patrimoniale, d'où le défaut prudent.",
    defaut: false,
  },
  {
    cle: 'notificationsActives', type: 'bool', portee: 'instance', section: 'courriel', module: 'Notifications',
    libelle: 'Envoyer les notifications par courriel',
    description: "Interrupteur général. Désactivé, les notifications continuent d'être enregistrées mais ne partent pas : utile pendant une reprise de données pour ne pas inonder la famille.",
    defaut: true,
  },
  {
    cle: 'notificationsTentativesMax', type: 'int', portee: 'instance', section: 'courriel', module: 'Notifications',
    libelle: 'Tentatives avant abandon',
    description: "Nombre d'essais d'envoi avant qu'une notification soit marquée abandonnée. Chaque échec double l'attente avant l'essai suivant. Une notification abandonnée reste visible dans l'écran d'état, avec l'erreur exacte du relais.",
    defaut: 5, min: 1, max: 20,
  },
  {
    cle: 'fichierTailleMaxMo', type: 'int', portee: 'instance', section: 'fichiers', module: 'Fichiers',
    libelle: 'Taille maximale d\'un fichier (Mo)',
    description: "S'applique aux photos et aux pièces jointes. Une photo de téléphone récente pèse entre 3 et 8 Mo. Monter cette valeur consomme l'espace disque du conteneur.",
    defaut: 15, min: 1, max: 100,
  },
  {
    cle: 'journalNiveau', type: 'enum', portee: 'instance', section: 'exploitation', module: 'Exploitation',
    libelle: 'Niveau de journalisation',
    description: "Prend effet immédiatement, sans redémarrage : « journalctl -f -u maison-de-famille » change de verbosité pendant qu'on le regarde. « debug » est bavard, à n'allumer que pour comprendre un cas précis.",
    defaut: 'info',
    options: [
      { valeur: 'erreur', libelle: 'Erreurs seulement' },
      { valeur: 'info', libelle: 'Normal' },
      { valeur: 'debug', libelle: 'Détaillé' },
    ],
  },
];

/** Recherche d'une déclaration. Lève si la clé n'existe pas : c'est une faute de code. */
export function declaration(cle: string): Declaration {
  const d = REGISTRE.find((x) => x.cle === cle);
  if (!d) throw new Error(`Paramètre inconnu : ${cle}. Déclarez-le dans parametres/registre.ts.`);
  return d;
}

/** Convertit la valeur stockée (toujours du texte) vers son type déclaré. */
export function convertir(d: Declaration, brut: string): boolean | number | string {
  switch (d.type) {
    case 'bool': return brut === '1' || brut === 'true';
    case 'int': {
      const n = Number(brut);
      if (!Number.isInteger(n)) return d.defaut;
      if (d.min !== undefined && n < d.min) return d.min;
      if (d.max !== undefined && n > d.max) return d.max;
      return n;
    }
    case 'enum': return d.options?.some((o) => o.valeur === brut) ? brut : d.defaut;
    case 'text': return brut.slice(0, d.maxLongueur ?? 500);
  }
}

/** Contrôle une valeur entrante et rend sa forme stockée, ou null si refusée. */
export function versStockage(d: Declaration, valeur: unknown): string | null {
  switch (d.type) {
    case 'bool':
      if (typeof valeur === 'boolean') return valeur ? '1' : '0';
      if (valeur === '1' || valeur === '0' || valeur === 'true' || valeur === 'false') {
        return valeur === '1' || valeur === 'true' ? '1' : '0';
      }
      return null;
    case 'int': {
      const n = typeof valeur === 'number' ? valeur : Number(valeur);
      if (!Number.isInteger(n)) return null;
      if (d.min !== undefined && n < d.min) return null;
      if (d.max !== undefined && n > d.max) return null;
      return String(n);
    }
    case 'enum':
      return typeof valeur === 'string' && d.options?.some((o) => o.valeur === valeur) ? valeur : null;
    case 'text': {
      if (typeof valeur !== 'string') return null;
      const v = valeur.trim();
      return v.length <= (d.maxLongueur ?? 500) ? v : null;
    }
  }
}
