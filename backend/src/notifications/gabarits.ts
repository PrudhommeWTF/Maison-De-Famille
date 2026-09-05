// Les gabarits de courriel. Module PUR : aucune base, aucun envoi.
//
// Les messages sont **courts** et portent **un lien direct vers l'écran
// concerné**. Une famille dispersée, d'âges et de niveaux techniques très
// variés, ne lit pas un courriel de vingt lignes : elle regarde l'objet, et
// clique si le lien lui dit où il mène.
//
// Chaque message part en deux versions dans le même envoi, texte et HTML. La
// version texte n'est pas une politesse : certains clients de messagerie
// anciens n'affichent que celle-là, et elle améliore le classement anti-spam.

export type TypeNotification =
  | 'demande_nouvelle'
  | 'demande_decidee'
  | 'appel_de_fonds'
  | 'mot_de_passe'
  | 'invitation';

export interface Declaration {
  type: TypeNotification;
  libelle: string;
  /** Ce que la personne reçoit, dit du point de vue de la personne. */
  description: string;
  defaut: boolean;
  /**
   * Un message qu'on ne peut pas couper. Une réinitialisation de mot de passe
   * en fait partie : la couper reviendrait à s'enfermer dehors, et elle ne part
   * que sur demande explicite de la personne.
   */
  obligatoire?: boolean;
}

export const TYPES: readonly Declaration[] = [
  {
    type: 'demande_nouvelle', libelle: 'Nouvelle demande de séjour', defaut: true,
    description: "Vous recevez un courriel quand quelqu'un demande un séjour sur un bien que vous gérez.",
  },
  {
    type: 'demande_decidee', libelle: 'Réponse à votre demande', defaut: true,
    description: 'Vous recevez un courriel quand votre demande de séjour est validée ou renvoyée pour d\'autres dates.',
  },
  {
    type: 'appel_de_fonds', libelle: 'Appel de fonds', defaut: true,
    description: "Vous recevez un courriel quand un appel de fonds vous concerne, avec le montant, l'échéance et un lien vers le détail du calcul.",
  },
  {
    type: 'mot_de_passe', libelle: 'Réinitialisation de mot de passe', defaut: true, obligatoire: true,
    description: "Envoyé uniquement quand vous demandez vous-même à réinitialiser votre mot de passe. Ce message ne peut pas être désactivé.",
  },
  {
    type: 'invitation', libelle: "Invitation à rejoindre l'instance", defaut: true, obligatoire: true,
    description: "Envoyé quand un gérant vous ouvre un compte, pour que vous choisissiez votre mot de passe. Ce message ne peut pas être désactivé.",
  },
];

export interface Message { sujet: string; texte: string; html: string; lien: string }

const echapper = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « 8 août 2026 ». La date se lit, elle ne se déchiffre pas. */
export function dateLisible(iso: string): string {
  const [a, m, j] = iso.split('-');
  return `${Number(j)} ${MOIS[Number(m) - 1]} ${a}`;
}

export const plage = (du: string, au: string): string => `du ${dateLisible(du)} au ${dateLisible(au)}`;

/**
 * L'habillage commun. Volontairement sobre : pas d'image, pas de police
 * distante, pas de mise en page en tableau. Un courriel qui charge une image
 * depuis le serveur signalerait sa lecture, et cette application ne fait aucun
 * appel réseau sortant en dehors de l'envoi lui-même.
 */
function envelopper(instance: string, titre: string, corps: string, lien: string, libelleLien: string): string {
  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#24201b;max-width:520px">',
    `<p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b6157;margin:0 0 14px">${echapper(instance)}</p>`,
    `<h1 style="font-size:19px;font-weight:600;margin:0 0 12px">${echapper(titre)}</h1>`,
    corps,
    lien ? `<p style="margin:22px 0 0"><a href="${echapper(lien)}" style="background:#b0603f;color:#fffdf9;text-decoration:none;padding:10px 16px;border-radius:9px;display:inline-block">${echapper(libelleLien)}</a></p>` : '',
    '<p style="margin:24px 0 0;font-size:12px;color:#6b6157">Vous pouvez désactiver ce type de message dans vos préférences.</p>',
    '</div>',
  ].join('');
}

export interface ContexteDemande {
  instance: string;
  urlBase: string;
  demandeur: string;
  bien: string;
  arrivee: string;
  depart: string;
  nuits: number;
  occupants: number;
  note: string;
  conflits: readonly string[];
}

export function demandeNouvelle(c: ContexteDemande): Message {
  const lien = `${c.urlBase}/biens/demandes`;
  const l1 = `${c.demandeur} demande ${c.bien}, ${plage(c.arrivee, c.depart)}.`;
  const l2 = `${c.nuits} nuit${c.nuits > 1 ? 's' : ''}, ${c.occupants} personne${c.occupants > 1 ? 's' : ''}.`;
  const alerte = c.conflits.length ? `Attention : ${c.conflits.join(' ')}` : '';

  return {
    sujet: `Demande de séjour : ${c.demandeur}, ${c.bien}`,
    lien,
    texte: [l1, l2, c.note && `« ${c.note} »`, alerte, '', `Répondre : ${lien}`].filter(Boolean).join('\n'),
    html: envelopper(c.instance, 'Nouvelle demande de séjour', [
      `<p style="margin:0 0 8px">${echapper(l1)}</p>`,
      `<p style="margin:0 0 8px;color:#4a443c">${echapper(l2)}</p>`,
      c.note ? `<p style="margin:0 0 8px;color:#4a443c;font-style:italic">${echapper(c.note)}</p>` : '',
      alerte ? `<p style="margin:12px 0 0;padding:10px 12px;background:#fbf1ea;border:1px solid #e7c9b6;border-radius:10px;color:#8d4a2e">${echapper(alerte)}</p>` : '',
    ].join(''), lien, 'Voir la demande'),
  };
}

export interface ContexteDecision {
  instance: string; urlBase: string; bien: string; arrivee: string; depart: string;
  validee: boolean; parQui: string; note: string;
}

export function demandeDecidee(c: ContexteDecision): Message {
  const lien = `${c.urlBase}/biens/calendrier`;
  const titre = c.validee ? 'Votre séjour est validé' : 'Votre demande revient avec d\'autres dates';
  const l1 = c.validee
    ? `${c.parQui} a validé votre séjour à ${c.bien}, ${plage(c.arrivee, c.depart)}.`
    : `${c.parQui} vous propose de revoir les dates de votre séjour à ${c.bien}, ${plage(c.arrivee, c.depart)}.`;

  return {
    sujet: c.validee ? `Séjour validé : ${c.bien}, ${dateLisible(c.arrivee)}` : `Dates à revoir : ${c.bien}, ${dateLisible(c.arrivee)}`,
    lien,
    texte: [l1, c.note && `« ${c.note} »`, '', `Voir le calendrier : ${lien}`].filter(Boolean).join('\n'),
    html: envelopper(c.instance, titre, [
      `<p style="margin:0 0 8px">${echapper(l1)}</p>`,
      c.note ? `<p style="margin:0 0 8px;color:#4a443c;font-style:italic">${echapper(c.note)}</p>` : '',
    ].join(''), lien, c.validee ? 'Voir le calendrier' : 'Proposer d\'autres dates'),
  };
}

export interface ContexteReinit { instance: string; urlBase: string; jeton: string; heures: number }

export function motDePasseOublie(c: ContexteReinit): Message {
  const lien = `${c.urlBase}/reinitialiser?jeton=${encodeURIComponent(c.jeton)}`;
  const l1 = `Vous avez demandé à choisir un nouveau mot de passe. Ce lien est valable ${c.heures} heures et ne sert qu'une fois.`;
  const l2 = "Si vous n'avez rien demandé, ignorez ce message : votre mot de passe actuel reste valable.";
  return {
    sujet: `Nouveau mot de passe pour ${c.instance}`,
    lien,
    texte: [l1, '', lien, '', l2].join('\n'),
    html: envelopper(c.instance, 'Choisir un nouveau mot de passe', [
      `<p style="margin:0 0 8px">${echapper(l1)}</p>`,
      `<p style="margin:0 0 8px;color:#4a443c">${echapper(l2)}</p>`,
    ].join(''), lien, 'Choisir un mot de passe'),
  };
}

export interface ContexteInvitation {
  instance: string; urlBase: string; jeton: string; jours: number; invitePar: string;
}

/**
 * L'invitation. Elle mène au même écran que la réinitialisation (choisir un mot
 * de passe), mais elle n'en dit pas la même chose : quelqu'un qui reçoit
 * « nouveau mot de passe » sans avoir jamais eu de compte croit à une erreur,
 * ou pire, à une tentative d'hameçonnage. Le message nomme donc la personne qui
 * invite : c'est la seule chose qui le rende crédible pour un destinataire qui
 * n'attendait rien.
 */
export function invitation(c: ContexteInvitation): Message {
  const lien = `${c.urlBase}/reinitialiser?jeton=${encodeURIComponent(c.jeton)}`;
  const l1 = `${c.invitePar} vous a ouvert un accès à ${c.instance}, pour suivre le calendrier des séjours et les comptes de la famille.`;
  const l2 = `Choisissez votre mot de passe avec le lien ci-dessous. Il est valable ${c.jours} jours.`;
  const l3 = "Si ce lien a expiré, l'écran de connexion propose « mot de passe oublié » : il vaut aussi pour un premier mot de passe.";
  return {
    sujet: `${c.invitePar} vous invite sur ${c.instance}`,
    lien,
    texte: [l1, '', l2, '', lien, '', l3].join('\n'),
    html: envelopper(c.instance, 'Bienvenue', [
      `<p style="margin:0 0 8px">${echapper(l1)}</p>`,
      `<p style="margin:0 0 8px">${echapper(l2)}</p>`,
      `<p style="margin:0 0 8px;color:#4a443c">${echapper(l3)}</p>`,
    ].join(''), lien, 'Choisir mon mot de passe'),
  };
}

export interface ContexteAppel {
  instance: string; urlBase: string; structure: string; libelle: string;
  echeance: string; montantCents: number; vocabulaire: string;
}

/** Un montant en euros, à la française : virgule décimale, milliers séparés. */
const euros = (cents: number): string => {
  const [entier, decimales] = Math.abs(cents / 100).toFixed(2).split('.');
  return `${entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${decimales} €`;
};

/**
 * L'appel de fonds.
 *
 * Il porte le montant, l'échéance, et surtout **un lien vers le détail du
 * calcul**. C'est de l'argent entre frères et soeurs : un montant sans
 * justification est un montant contesté, et le courriel doit mener à
 * l'explication, pas la remplacer.
 */
export function appelDeFonds(c: ContexteAppel): Message {
  const lien = `${c.urlBase}/bien/soldes`;
  const l1 = `${c.vocabulaire} : ${euros(c.montantCents)} pour ${c.structure}.`;
  const l2 = `Libellé : ${c.libelle}. À régler avant le ${dateLisible(c.echeance)}.`;
  const l3 = "Le détail du calcul est consultable ligne par ligne dans l'application.";

  return {
    sujet: `${c.libelle} : ${euros(c.montantCents)}`,
    lien,
    texte: [l1, l2, l3, '', `Voir le détail : ${lien}`].join('\n'),
    html: envelopper(c.instance, c.libelle, [
      `<p style="margin:0 0 8px;font-size:19px">${echapper(euros(c.montantCents))}</p>`,
      `<p style="margin:0 0 8px">${echapper(l1)}</p>`,
      `<p style="margin:0 0 8px;color:#4a443c">${echapper(l2)}</p>`,
      `<p style="margin:0;color:#4a443c">${echapper(l3)}</p>`,
    ].join(''), lien, 'Voir le détail du calcul'),
  };
}
