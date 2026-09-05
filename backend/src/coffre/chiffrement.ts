// Le chiffrement des codes d'accès au repos.
//
// **Ce que cela protège, et ce que cela ne protège pas.** Il faut le dire
// exactement, sinon la mesure donne une confiance qu'elle ne mérite pas.
//
// La clé vit dans `MDF_CLE_COFFRE`, c'est-à-dire dans le fichier
// d'environnement (`/etc/maison-de-famille/mdf.env`, en 0600), **hors du
// répertoire de données**. Une base de données qui fuit, une sauvegarde
// recopiée sur un NAS, un disque de conteneur exfiltré : aucun de ces cas ne
// rend un seul code, parce qu'aucun ne contient la clé. En revanche, quelqu'un
// qui obtient la racine sur la machine lit la clé comme le reste, et le
// chiffrement ne l'arrête pas. C'est une frontière réelle, ce n'est pas un
// coffre-fort.
//
// **Conséquence à ne pas découvrir un dimanche soir :** restaurer une
// sauvegarde du répertoire de données sur une machine neuve sans reporter
// `MDF_CLE_COFFRE` rend tout le reste et perd les codes. C'est écrit dans
// `docs/sauvegarde-restauration.md`, et le service le dit au démarrage.
//
// AES-256-GCM : chiffrement et authentification en une passe. Un code altéré en
// base est détecté au déchiffrement au lieu de rendre une valeur fausse, et une
// valeur fausse serait pire que pas de valeur du tout, puisque quelqu'un
// partirait à trois heures de route avec un mauvais code de boîte à clés.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'crypto';

/** 96 bits, la taille que GCM attend. */
const TAILLE_NONCE = 12;
const TAILLE_ETIQUETTE = 16;

export class CoffreVerrouille extends Error {}
export class CodeIllisible extends Error {}

export interface Coffre {
  chiffrer(clair: string): Buffer;
  dechiffrer(paquet: Buffer): string;
  /** Empreinte de la clé, pour vérifier qu'une base et une clé vont ensemble. */
  empreinteCle: string;
}

/**
 * Le coffre indisponible, quand aucune clé n'est configurée.
 *
 * Il ne lève pas au démarrage : une instance qui n'utilise pas encore les codes
 * doit pouvoir tourner, et une mise à jour ne doit pas empêcher un service
 * existant de redémarrer. Il lève au premier usage, avec la marche à suivre.
 */
export const COFFRE_VERROUILLE: Coffre = {
  chiffrer() { throw new CoffreVerrouille(MESSAGE_SANS_CLE); },
  dechiffrer() { throw new CoffreVerrouille(MESSAGE_SANS_CLE); },
  empreinteCle: '',
};

const MESSAGE_SANS_CLE =
  'Le coffre-fort des codes est verrouillé : la variable MDF_CLE_COFFRE n\'est pas configurée. '
  + 'Engendrez une clé avec « openssl rand -hex 32 », placez-la dans le fichier d\'environnement '
  + 'du service, puis redémarrez. Gardez-en une copie ailleurs que dans les sauvegardes du '
  + 'répertoire de données : sans elle, les codes déjà enregistrés ne se relisent pas.';

/**
 * Construit le coffre à partir de la clé brute (64 caractères hexadécimaux).
 *
 * La clé est passée par une empreinte SHA-256 plutôt qu'utilisée telle quelle :
 * cela accepte n'importe quelle longueur de secret sans laisser une clé trop
 * courte passer pour une clé de 256 bits.
 */
export function ouvrir(cleBrute: string | null | undefined): Coffre {
  const brut = (cleBrute || '').trim();
  if (!brut) return COFFRE_VERROUILLE;
  if (brut.length < 32) {
    throw new CoffreVerrouille(
      `MDF_CLE_COFFRE fait ${brut.length} caractères, il en faut au moins 32. `
      + 'Engendrez-la avec « openssl rand -hex 32 ».');
  }
  const cle = createHash('sha256').update(brut, 'utf8').digest();
  // L'empreinte publiée est celle de la clé dérivée, tronquée : elle sert à
  // reconnaître une clé, jamais à la retrouver.
  const empreinteCle = createHash('sha256').update(cle).digest('hex').slice(0, 16);

  return {
    empreinteCle,
    chiffrer(clair: string): Buffer {
      const nonce = randomBytes(TAILLE_NONCE);
      const c = createCipheriv('aes-256-gcm', cle, nonce);
      const chiffre = Buffer.concat([c.update(clair, 'utf8'), c.final()]);
      return Buffer.concat([nonce, c.getAuthTag(), chiffre]);
    },
    dechiffrer(paquet: Buffer): string {
      if (paquet.length < TAILLE_NONCE + TAILLE_ETIQUETTE) {
        throw new CodeIllisible('Ce code est enregistré dans un format inattendu.');
      }
      const nonce = paquet.subarray(0, TAILLE_NONCE);
      const etiquette = paquet.subarray(TAILLE_NONCE, TAILLE_NONCE + TAILLE_ETIQUETTE);
      const chiffre = paquet.subarray(TAILLE_NONCE + TAILLE_ETIQUETTE);
      try {
        const d = createDecipheriv('aes-256-gcm', cle, nonce);
        d.setAuthTag(etiquette);
        return Buffer.concat([d.update(chiffre), d.final()]).toString('utf8');
      } catch {
        // Le message ne dit pas « mauvaise clé » plutôt que « donnée
        // corrompue », parce qu'on ne peut pas les distinguer, et parce que la
        // marche à suivre est la même dans les deux cas.
        throw new CodeIllisible(
          'Ce code ne peut pas être relu. Soit la clé MDF_CLE_COFFRE a changé depuis son '
          + 'enregistrement, soit la donnée a été modifiée. Vérifiez la clé du fichier '
          + 'd\'environnement, puis, si elle est bien la bonne, ressaisissez le code.');
      }
    },
  };
}

/** Le coffre est-il utilisable ? Sert à l'écran d'état et à la carte de démarrage. */
export const disponible = (c: Coffre): boolean => c.empreinteCle !== '';

/**
 * Compare deux empreintes de clé sans laisser fuir d'information par le temps.
 * Sert au contrôle de cohérence entre une base restaurée et la clé en place.
 */
export function memeCle(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
