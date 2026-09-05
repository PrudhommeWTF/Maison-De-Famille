// Le dépouillement d'un scrutin. Module PUR : ni base, ni HTTP.
//
// Deux principes, tirés du brief et de la maquette :
//
//   « Les voix sont pondérées par les quotes-parts, pas par tête. »
//   « La majorité requise dépend de la nature de l'acte : deux tiers pour la
//     gestion courante, unanimité pour un acte de disposition. »
//
// **Le seuil s'applique au corps électoral entier, pas aux voix exprimées.**
// C'est le point le plus lourd de conséquences de ce module, et il faut le dire
// clairement parce qu'il surprend : une abstention pèse donc comme un vote
// contre. Ce n'est pas un choix d'ergonomie, c'est la lecture de l'article
// 815-3 du Code civil, qui parle de « la majorité des deux tiers **des droits
// indivis** » et non des droits exprimés. Une indivision où deux personnes sur
// quatre ne répondent pas ne peut pas décider, et c'est précisément ce que la
// loi veut. La maquette dit la même chose à sa façon : « Il manque deux voix
// pour atteindre les deux tiers. »
//
// Le quorum, lui, porte sur la participation : il dit à partir de quand le
// scrutin est valide. Une SCI dont les statuts exigent un quorum en assemblée
// le renseigne, une indivision le laisse vide.
//
// **Aucun seuil n'est écrit ici.** Ils viennent tous de `regle_decision`, où
// ils sont modifiables : une convention d'indivision peut prévoir autre chose
// que les deux tiers, et des statuts de SCI prévoient à peu près tout. Un seuil
// codé en dur serait faux pour la moitié des familles.
//
// Toute l'arithmétique est **entière**. Comparer `pour / total >= 2 / 3` en
// virgule flottante fait échouer le cas exact, qui est justement celui qu'on
// contestera : `pour * 3 >= total * 2` ne se trompe jamais.

export type Sens = 'pour' | 'contre' | 'abstention';

export interface Regle {
  acte: string;
  libelle: string;
  base: 'parts' | 'tetes';
  seuilNum: number;
  seuilDen: number;
  quorumNum?: number | null;
  quorumDen?: number | null;
  voteRequis: boolean;
}

export interface Voix {
  personneId: number;
  nom?: string;
  /** Le poids figé à l'ouverture du scrutin. */
  poids: number;
  /** Null tant que la personne n'a pas voté : une abstention par défaut. */
  sens: Sens | null;
}

export interface Depouillement {
  /** Somme des poids du corps électoral, figé à l'ouverture. */
  total: number;
  pour: number;
  contre: number;
  abstention: number;
  /** Ce qui a été exprimé, dans un sens ou dans l'autre. */
  exprime: number;
  /** Le nombre de voix qu'il faut atteindre, arrondi au supérieur. */
  requis: number;
  /** Le quorum à atteindre en participation, ou null s'il n'y en a pas. */
  quorumRequis: number | null;
  quorumAtteint: boolean;
  adopte: boolean;
  /** Ce qui manque encore, zéro si le seuil est atteint. */
  manque: number;
  /** Le résultat, en une phrase, tel qu'il s'affiche et se relit dix ans après. */
  explication: string;
}

export class ScrutinImpossible extends Error {}

/**
 * Le plus petit entier `n` tel que `n * den >= total * num`.
 *
 * Arrondi au supérieur, et volontairement : avec un seuil de deux tiers sur
 * cent parts, il faut 67 voix et non 66. Un arrondi à l'inférieur ferait
 * adopter une décision à 66,67 %, ce qui est en dessous du seuil.
 */
export function seuilEnVoix(total: number, num: number, den: number): number {
  if (den <= 0 || num <= 0) throw new ScrutinImpossible('Un seuil doit avoir un numérateur et un dénominateur positifs.');
  return Math.ceil((total * num) / den);
}

/** Un pourcentage lisible, sans prétendre à une précision qu'on n'a pas. */
const pourcent = (part: number, total: number): string =>
  total <= 0 ? '0 %' : `${Math.round((part * 1000) / total) / 10} %`.replace('.', ',');

/**
 * Dépouille un scrutin.
 *
 * `voix` est le corps électoral **entier**, y compris ceux qui n'ont pas voté :
 * c'est ce qui permet de compter les abstentions, et de ne pas confondre « la
 * personne s'est abstenue » avec « la personne n'existait pas ».
 */
export function depouiller(regle: Regle, voix: readonly Voix[]): Depouillement {
  if (!regle.voteRequis) {
    throw new ScrutinImpossible(
      `L'acte « ${regle.libelle} » ne demande pas de vote : la décision se prend et s'enregistre, `
      + 'sans scrutin.');
  }
  if (!voix.length) {
    throw new ScrutinImpossible(
      'Ce scrutin n\'a aucun électeur. Saisissez la répartition des parts avant d\'ouvrir un vote.');
  }

  // Base « tetes » : chacun pèse une voix, quelles que soient ses parts. Une
  // convention peut le prévoir, et la table le permet.
  const poids = (v: Voix): number => (regle.base === 'tetes' ? 1 : v.poids);

  let total = 0, pour = 0, contre = 0, abstention = 0;
  for (const v of voix) {
    const p = poids(v);
    total += p;
    if (v.sens === 'pour') pour += p;
    else if (v.sens === 'contre') contre += p;
    else abstention += p;
  }

  const exprime = pour + contre;
  const requis = seuilEnVoix(total, regle.seuilNum, regle.seuilDen);
  const quorumRequis = regle.quorumNum && regle.quorumDen
    ? seuilEnVoix(total, regle.quorumNum, regle.quorumDen) : null;
  const quorumAtteint = quorumRequis === null || exprime >= quorumRequis;
  const adopte = quorumAtteint && pour >= requis;
  const manque = Math.max(0, requis - pour);

  return {
    total, pour, contre, abstention, exprime, requis, quorumRequis, quorumAtteint, adopte, manque,
    explication: expliquer(regle, {
      total, pour, contre, abstention, exprime, requis, quorumRequis, quorumAtteint, adopte, manque,
    }),
  };
}

function expliquer(regle: Regle, d: Omit<Depouillement, 'explication'>): string {
  const unite = regle.base === 'tetes' ? 'voix' : 'parts';
  // « Il manque 1 parts » se lit mal dans un document qu'on relira pour
  // défendre une décision : l'accord se fait, même pour un seul mot.
  const u = (n: number): string => (regle.base === 'tetes' ? 'voix' : n > 1 ? 'parts' : 'part');
  const lignes: string[] = [
    `Règle appliquée : ${regle.libelle} (${regle.seuilNum}/${regle.seuilDen} des ${unite}).`,
    `Corps électoral : ${d.total} ${unite}, figées à l'ouverture du scrutin.`,
    `Pour : ${d.pour} (${pourcent(d.pour, d.total)}). `
    + `Contre : ${d.contre} (${pourcent(d.contre, d.total)}). `
    + `Abstention : ${d.abstention} (${pourcent(d.abstention, d.total)}).`,
    `Seuil à atteindre : ${d.requis} ${unite} sur ${d.total}.`,
  ];
  if (d.quorumRequis !== null) {
    lignes.push(
      `Quorum : ${d.exprime} ${unite} exprimées sur les ${d.quorumRequis} requises, `
      + `${d.quorumAtteint ? 'atteint' : 'NON atteint'}.`);
  }
  if (!d.quorumAtteint) {
    lignes.push('Résultat : scrutin sans effet, le quorum n\'est pas atteint.');
  } else if (d.adopte) {
    lignes.push(`Résultat : adopté, avec ${d.pour - d.requis} ${u(d.pour - d.requis)} au-delà du seuil.`);
  } else {
    lignes.push(
      `Résultat : rejeté. Il manque ${d.manque} ${u(d.manque)} pour atteindre le seuil.`
      + (d.abstention > 0
        ? ` Les ${d.abstention} ${u(d.abstention)} d'abstention comptent dans le corps électoral : le seuil `
          + 'porte sur les droits détenus, pas sur les voix exprimées.'
        : ''));
  }
  return lignes.join('\n');
}

/**
 * L'état d'un scrutin encore ouvert, dit du point de vue de celui qui regarde.
 * La maquette affiche cette phrase sous les boutons de vote.
 */
export function enCours(regle: Regle, voix: readonly Voix[], monPoids: number | null): string {
  const d = depouiller(regle, voix);
  const attente = voix.filter((v) => v.sens === null).length;
  const morceaux: string[] = [];
  if (monPoids !== null && d.total > 0) {
    morceaux.push(`Votre voix pèse ${pourcent(monPoids, d.total)} des droits.`);
  }
  if (d.adopte) morceaux.push('Le seuil est atteint.');
  else if (d.manque > 0) {
    morceaux.push(`Il manque ${d.manque} `
      + `${regle.base === 'tetes' ? 'voix' : d.manque > 1 ? 'parts' : 'part'} pour atteindre le seuil.`);
  }
  if (attente > 0) {
    morceaux.push(`${attente} personne${attente > 1 ? 's n\'ont' : ' n\'a'} pas encore voté.`);
  }
  return morceaux.join(' ');
}

/**
 * Le scrutin peut-il déjà être dépouillé sans attendre sa clôture ?
 *
 * Vrai quand plus aucun vote restant ne peut changer le résultat : soit le
 * seuil est déjà atteint, soit il est devenu inatteignable même si tous les
 * indécis votaient pour. Attendre quinze jours de plus dans ce cas ne sert
 * personne, et la gérante doit pouvoir clore.
 */
export function issueCertaine(regle: Regle, voix: readonly Voix[]): boolean {
  const d = depouiller(regle, voix);
  if (!d.quorumAtteint) {
    // Le quorum peut encore être atteint tant qu'il reste des indécis.
    const restant = voix.filter((v) => v.sens === null)
      .reduce((t, v) => t + (regle.base === 'tetes' ? 1 : v.poids), 0);
    if (d.exprime + restant >= (d.quorumRequis ?? 0)) return false;
    return true;
  }
  if (d.adopte) return true;
  const restant = voix.filter((v) => v.sens === null)
    .reduce((t, v) => t + (regle.base === 'tetes' ? 1 : v.poids), 0);
  return d.pour + restant < d.requis;
}
