// Les formes que l'API rend. Écrites à la main plutôt qu'engendrées : elles
// tiennent en une page, et une génération automatique coûterait un outil de plus
// à faire tourner pour un gain nul à cette taille.

export type Role = 'gerant' | 'detenteur' | 'membre_foyer' | 'invite';
export type ModeStructure = 'indivision' | 'sci' | 'nom_propre';
export type TypeBien = 'mer' | 'montagne' | 'campagne' | 'ville';
export type Nature = 'famille' | 'location' | 'entretien';
export type StatutSejour = 'demande' | 'valide' | 'a_revoir' | 'annule';

export interface BienResume {
  id: number; nom: string; commune: string; type: TypeBien; couchages: number;
  locationActivee: boolean; structureId: number; structureMode: ModeStructure;
  structureNom: string; role: Role; demandesEnAttente: number;
  /** « Occupation été » ou « Occupation hiver », selon le type du bien. */
  occupationLibelle: string;
  occupationPourcent: number;
  /** Combien de personnes détiennent aujourd'hui la structure du bien. */
  detenteurs: number;
}

export interface Moi {
  personne: { id: number; nom: string; email: string | null; foyerId: number | null; foyerNom: string | null };
  estGerant: boolean;
  sessionLimitee: boolean;
  secondFacteur: { actif: boolean; obligatoirePourGerant: boolean; codesDeSecoursRestants: number };
  instanceNom: string;
  semaineCommenceDimanche: boolean;
  biens: BienResume[];
}

export interface Sejour {
  id: number; bienId: number; bienNom: string;
  demandeurId: number | null; demandeurNom: string | null;
  foyerId: number | null; foyerNom: string | null;
  titre: string; arrivee: string; depart: string; nuits: number; occupants: number;
  nature: Nature; statut: StatutSejour; note: string; origine: 'app' | 'gerante' | 'import';
  creeLe: string; decideLe: string | null; decideParNom: string | null; decisionNote: string;
}

export type NatureConflit = 'sejour_valide' | 'demande_concurrente' | 'capacite';
export interface Conflit { nature: NatureConflit; sejourId?: number; message: string; nuits: string[] }

export interface Demande extends Sejour { conflits: Conflit[] }

export interface Bien {
  id: number; structureId: number; nom: string; commune: string; codePostal: string;
  adresse: string; type: TypeBien; couchages: number; locationActivee: boolean;
  photoFichierId: string | null; notes: string; archiveLe: string | null;
}

export interface Vocabulaire {
  part: string; parts: string; detenteur: string; detenteurs: string; regularisation: string;
}

export interface FicheBien {
  bien: Bien;
  structure: { id: number; mode: ModeStructure; nom: string; notes: string };
  vocabulaire: Vocabulaire;
  regleMajorite: string;
  role: Role;
}

export interface Detenteur {
  personneId: number; nom: string; foyerNom: string | null;
  parts: number; total: number; quotePart: string; role: string;
}

export interface RegleDecision {
  id: number; acte: string; libelle: string; base: 'parts' | 'tetes';
  seuilNum: number; seuilDen: number; voteRequis: boolean;
}

export interface Structure {
  structure: { id: number; mode: ModeStructure; nom: string; notes: string; archiveLe: string | null };
  vocabulaire: Vocabulaire;
  regles: RegleDecision[];
  detenteurs: Detenteur[];
  partsVisibles: boolean;
}

export interface LigneDetention {
  id: number; personneId: number; nom: string; parts: number;
  effetDu: string; effetAu: string | null; motif: string;
}

export interface Personne {
  id: number; nom: string; email: string | null; foyerId: number | null; foyerNom: string | null;
  aUnCompte: boolean; derniereConnexion: string | null; archiveLe: string | null;
}

export interface Foyer { id: number; nom: string }

export interface Saison {
  saison: { id: number; bienId: number; libelle: string; debut: string; fin: string; statut: string; ordre: number[] };
  voeux: { id: number; foyerId: number; foyerNom: string; rang: number; du: string; au: string; occupants: number }[];
  quotas: { foyerId: number; nuitsMax: number }[];
}

export interface Verification {
  nuits: number; couchages: number; envoiPossible: boolean; conflits: Conflit[];
}

export interface ParametreExpose {
  cle: string; type: 'bool' | 'int' | 'enum' | 'text';
  portee: 'deploiement' | 'instance' | 'structure' | 'bien' | 'personnel';
  section: string; module: string; libelle: string; description: string;
  defaut: boolean | number | string; valeur: boolean | number | string; parDefaut: boolean;
  options?: { valeur: string; libelle: string }[];
  min?: number; max?: number; maxLongueur?: number;
}

/** L'état d'une mise à jour, tel que le script root l'écrit à chaque étape. */
export interface StatutMaj {
  etat: 'inactif' | 'en_cours' | 'termine' | 'echec';
  message?: string;
  ts?: number;
}

/** Ce que le serveur répond quand on lui demande s'il existe mieux. */
export interface Maj {
  installee: string;
  derniere: string;
  tag: string;
  nom: string;
  notes: string;
  url: string;
  publieeLe: string;
  misAJourDisponible: boolean;
  /** Faux quand le serveur ne sait pas quelle version il exécute (« 0.0.0 »). */
  versionConnue: boolean;
  installationPossible: boolean;
}

export interface Etat {
  version: string;
  maj: {
    /** Le réglage autorise-t-il l'appel à GitHub ? */
    verificationAutorisee: boolean;
    /** L'assistant root est-il installé ? Sans lui, le bouton ne mènerait à rien. */
    installationPossible: boolean;
    /** Faux quand le serveur ne sait pas quelle version il exécute (« 0.0.0 »). */
    versionConnue: boolean;
    depot: string;
    statut: StatutMaj;
  };
  schema: { applique: number; cible: number; migrations: { version: number; libelle: string; appliqueLe: string; dureeMs: number }[] };
  courriel: {
    relais: string | null; adresseExpediteur: string | null; adressePublique: string | null;
    file: {
      enAttente: number; abandonnees: number; envoyees24h: number;
      dernieresErreurs: { type: string; erreur: string; cree: string }[];
    };
  };
  donnees: {
    repertoire: string; personnes: number; biens: number; sejours: number; fichiers: number;
    orphelins: { nombre: number; octets: number };
  };
}

/** Le rapport d'une simulation ou d'une exécution d'import. */
export interface RapportImport {
  lues: number;
  aCreer: { numero: number; bienId: number; titre: string; arrivee: string; depart: string; occupants: number; nature: Nature; statut: string; note: string }[];
  doublons: { numero: number; titre: string; arrivee: string }[];
  refusees: { numero: number; raison: string; brut: string[] }[];
}

export interface AnalyseImport {
  format: string; encodage: string | null; sha: string; nom: string;
  lignes: string[][]; ligneEntete: number; entetes: string[];
  correspondance: Record<string, number>;
  champs: { champ: string; libelle: string; obligatoire: boolean }[];
  biens: { id: number; nom: string }[];
}

// ---- Argent (tranche 2) ----

export type Regle = 'quotes_parts' | 'nuits' | 'parts_egales_foyer';

export interface Categorie { id: number; code: string; libelle: string; ordre: number; actif: boolean }

export interface RegleLigne {
  categorieId: number; categorieLibelle: string;
  id: number; regle: Regle; applicableDu: string; parDefaut: boolean;
}

export interface Depense {
  id: number; groupeId: number | null; structureId: number; structureNom: string;
  dateDepense: string; libelle: string;
  categorieId: number; categorieLibelle: string;
  montantCents: number; payePar: 'personne' | 'structure';
  avanceParId: number | null; avanceParNom: string | null;
  justificatifId: string | null; statut: 'saisie' | 'validee' | 'annulee'; note: string;
  creeLe: string; archiveLe: string | null;
  biens: { bienId: number; bienNom: string; poidsNum: number; poidsDen: number }[];
  regleAppliquee: Regle | null;
  partVisibleCents: number;
}

export interface ListeDepenses { annee: number; total: number; depenses: Depense[] }

export interface DetailDepense {
  depense: Depense;
  ventilation: { personneId: number; nom: string; montantCents: number }[];
  justification: { regleAppliquee: Regle; repli?: string; dateReference: string } | null;
  /** L'explication en clair, ligne à ligne, telle qu'elle se lit à voix haute. */
  explication: string[];
  recalculs: { motif: string; faitLe: string; parNom: string | null }[];
  vocabulaire: Vocabulaire;
}

export interface SoldeActeur {
  acteurId: number; nom: string; estStructure: boolean;
  montantCents: number; avanceCents: number; duCents: number; regleCents: number;
}

export interface VirementPropose {
  deId: number; deNom: string; versId: number; versNom: string;
  montantCents: number; motif: string;
}

export interface Reglement {
  id: number; deId: number; deNom: string; versId: number; versNom: string;
  montantCents: number; dateReglement: string; statut: string; motif: string;
  appelId: number | null; confirmeLe: string | null;
}

export interface AppelDeFonds {
  id: number; libelle: string; dateAppel: string; echeance: string; statut: string; note: string;
  lignes: { personneId: number; nom: string; montantCents: number; statut: string }[];
}

export interface Soldes {
  structure: { id: number; nom: string; mode: ModeStructure };
  vocabulaire: Vocabulaire;
  soldes: SoldeActeur[];
  virements: VirementPropose[];
  reglements: Reglement[];
  appels: AppelDeFonds[];
  /** Doit valoir zéro. Affiché en clair si ce n'est pas le cas. */
  controle: number;
}
