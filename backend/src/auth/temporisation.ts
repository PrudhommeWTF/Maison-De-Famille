// La temporisation des tentatives de connexion. Module PUR, en mémoire.
//
// La limitation par adresse IP seule ne tient aucune des deux promesses qu'on
// lui demande. Trente essais par quart d'heure et par adresse, sur mille
// adresses, font trente mille essais : c'est un bourrage d'identifiants
// confortable. Et dans l'autre sens, elle coupe la maison, parce que toute la
// famille peut sortir par la même adresse.
//
// D'où deux compteurs, avec des seuils opposés :
//
//   - **par compte visé**, strict, parce qu'un attaquant change d'adresse mais
//     pas de cible ;
//   - **par adresse**, généreux, parce que verrouiller la famille dehors est un
//     dégât, pas une protection.
//
// Le verrou est progressif : les premiers essais ne coûtent rien (on se trompe
// de mot de passe, c'est la vie), puis l'attente double. Une réussite efface
// l'ardoise.
//
// En mémoire : un redémarrage remet les compteurs à zéro, ce qui est acceptable
// pour une famille et évite d'écrire en base à chaque tentative.

export interface Seuils {
  /** Échecs tolérés avant que l'attente commence. */
  franchise: number;
  /** Attente après le premier échec au-delà de la franchise. */
  premierDelaiMs: number;
  /** Plafond de l'attente. */
  delaiMaxMs: number;
  /** Au-delà de cette durée sans échec, l'ardoise est oubliée. */
  oubliMs: number;
}

export const SEUILS_COMPTE: Seuils = {
  franchise: 5, premierDelaiMs: 30_000, delaiMaxMs: 15 * 60_000, oubliMs: 60 * 60_000,
};

export const SEUILS_ADRESSE: Seuils = {
  franchise: 30, premierDelaiMs: 10_000, delaiMaxMs: 5 * 60_000, oubliMs: 60 * 60_000,
};

interface Ardoise { echecs: number; dernier: number; jusqua: number }

export class Temporisation {
  private readonly ardoises = new Map<string, Ardoise>();

  constructor(private readonly seuils: Seuils, private readonly maxCles = 10_000) {}

  /** Millisecondes restant à attendre pour cette clé. Zéro si elle peut essayer. */
  attente(cle: string, now: number): number {
    const a = this.ardoises.get(cle);
    if (!a) return 0;
    if (now - a.dernier > this.seuils.oubliMs) { this.ardoises.delete(cle); return 0; }
    return Math.max(0, a.jusqua - now);
  }

  /** Un échec de plus. Rend l'attente désormais imposée. */
  echec(cle: string, now: number): number {
    this.purger(now);
    const a = this.ardoises.get(cle);
    const echecs = (a && now - a.dernier <= this.seuils.oubliMs ? a.echecs : 0) + 1;
    const surplus = echecs - this.seuils.franchise;
    const delai = surplus <= 0 ? 0
      : Math.min(this.seuils.premierDelaiMs * 2 ** (surplus - 1), this.seuils.delaiMaxMs);
    this.ardoises.set(cle, { echecs, dernier: now, jusqua: now + delai });
    return delai;
  }

  /** Une réussite efface l'ardoise. */
  reussite(cle: string): void { this.ardoises.delete(cle); }

  private purger(now: number): void {
    if (this.ardoises.size < this.maxCles) return;
    for (const [cle, a] of this.ardoises) {
      if (now - a.dernier > this.seuils.oubliMs) this.ardoises.delete(cle);
    }
    // Toujours pleine après purge : on vide. Un attaquant qui remplit la table
    // ne doit pas pouvoir faire grandir la mémoire du service indéfiniment, et
    // perdre des compteurs est moins grave que tomber.
    if (this.ardoises.size >= this.maxCles) this.ardoises.clear();
  }

  /** Pour les tests et l'écran d'état. */
  get taille(): number { return this.ardoises.size; }
}
