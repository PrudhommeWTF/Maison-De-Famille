// L'état partagé de l'application.
//
// **Le bien sélectionné est le pivot de toute l'expérience.** La barre de
// contexte le choisit, et la navigation comme les contenus suivent : calendrier,
// demandes, badge, réglages. Ce choix est mémorisé par personne, comme le
// demande la maquette.
//
// Tout est en signals, sans RxJS : l'état tient en cinq valeurs, et les dérivés
// (le bien courant, le nombre de demandes en attente, les entrées de navigation)
// se calculent à partir d'elles. Rien n'est dupliqué, donc rien ne peut
// diverger.
import { Injectable, computed, signal } from '@angular/core';
import { Api } from './api';
import type { BienResume, Moi } from './modeles';

/** « Tous les biens », la vue consolidée du portefeuille. */
export const TOUS = 'all' as const;
export type Contexte = typeof TOUS | number;

const CLE_BIEN = 'mdf.bien';

@Injectable({ providedIn: 'root' })
export class Etat {
  private readonly _moi = signal<Moi | null>(null);
  private readonly _contexte = signal<Contexte>(TOUS);
  private readonly _chargement = signal(false);

  readonly moi = this._moi.asReadonly();
  readonly chargement = this._chargement.asReadonly();
  readonly contexte = this._contexte.asReadonly();

  readonly biens = computed<BienResume[]>(() => this._moi()?.biens ?? []);
  readonly estGerant = computed(() => this._moi()?.estGerant ?? false);
  readonly estAdminPlateforme = computed(() => this._moi()?.estAdminPlateforme ?? false);
  readonly sessionLimitee = computed(() => this._moi()?.sessionLimitee ?? false);

  /** Le bien ouvert, ou null en vue consolidée. */
  readonly bien = computed<BienResume | null>(() => {
    const c = this._contexte();
    return c === TOUS ? null : this.biens().find((b) => b.id === c) ?? null;
  });

  /** Le rôle sur le bien ouvert. Sert à masquer ce qui répondrait 403. */
  readonly estGeranteIci = computed(() => this.bien()?.role === 'gerant');

  /** Le rôle effectif sur le bien ouvert. « invite » quand rien n'est plus large. */
  readonly roleIci = computed(() => this.bien()?.role ?? 'invite');

  /**
   * Les écrans d'argent sont réservés aux détenteurs. Un membre de foyer les
   * verrait répondre 403 : mieux vaut ne pas lui proposer l'entrée que lui
   * montrer une porte fermée.
   */
  readonly voitLArgent = computed(() => {
    const role = this.bien()?.role;
    return role === 'gerant' || role === 'detenteur';
  });

  /**
   * La même question, mais pour la vue consolidée, où aucun bien n'est ouvert.
   *
   * `voitLArgent` répond non quand `bien()` est nul, ce qui est juste dans la
   * navigation d'un bien et faux au tableau de bord : la carte de trésorerie y
   * disparaissait alors qu'il y avait bien de l'argent à montrer.
   */
  readonly voitLArgentQuelquePart = computed(() =>
    this.biens().some((b) => b.role === 'gerant' || b.role === 'detenteur'));

  /** Les structures dont cette personne peut voir l'argent, sans doublon. */
  readonly structuresArgent = computed(() => [...new Map(
    this.biens().filter((b) => b.role === 'gerant' || b.role === 'detenteur')
      .map((b) => [b.structureId, b.structureNom] as const),
  )].map(([id, nom]) => ({ id, nom })));

  /** Le badge de la navigation : les demandes en attente **du bien courant**. */
  readonly demandesEnAttente = computed(() => {
    const b = this.bien();
    return b ? b.demandesEnAttente : this.biens().reduce((t, x) => t + x.demandesEnAttente, 0);
  });

  /** Le vocabulaire suit la structure du bien ouvert. */
  readonly vocabulaire = computed(() => {
    const mode = this.bien()?.structureMode;
    if (mode === 'sci') return { detenteurs: 'associés', parts: 'parts sociales' };
    if (mode === 'nom_propre') return { detenteurs: 'propriétaires', parts: 'propriété' };
    return { detenteurs: 'indivisaires', parts: 'quotes-parts' };
  });

  constructor(private readonly api: Api) {}

  async charger(): Promise<void> {
    this._chargement.set(true);
    try {
      const moi = await this.api.get<Moi>('/moi');
      this._moi.set(moi);
      this.restaurerContexte(moi);
    } finally {
      this._chargement.set(false);
    }
  }

  /** Recharge sans écran de chargement : après une action qui change un compteur. */
  async rafraichir(): Promise<void> {
    try {
      const moi = await this.api.get<Moi>('/moi');
      this._moi.set(moi);
      // Le bien courant a pu disparaître (archivé, accès retiré) : on retombe
      // sur la vue consolidée plutôt que d'afficher un dossier vide.
      const c = this._contexte();
      if (c !== TOUS && !moi.biens.some((b) => b.id === c)) this.poserContexte(TOUS);
    } catch { /* une session expirée est traitée par l'appelant */ }
  }

  poserContexte(c: Contexte): void {
    this._contexte.set(c);
    const id = this._moi()?.personne.id;
    if (id) localStorage.setItem(`${CLE_BIEN}.${id}`, String(c));
  }

  vider(): void {
    this._moi.set(null);
    this._contexte.set(TOUS);
  }

  /**
   * Le dernier bien ouvert par cette personne. Un seul bien accessible ? On
   * l'ouvre directement : la vue consolidée n'a rien à consolider, et le
   * premier écran doit dire tout de suite ce qui concerne la personne.
   */
  private restaurerContexte(moi: Moi): void {
    const memorise = localStorage.getItem(`${CLE_BIEN}.${moi.personne.id}`);
    if (memorise && memorise !== TOUS) {
      const id = Number(memorise);
      if (moi.biens.some((b) => b.id === id)) { this._contexte.set(id); return; }
    }
    if (memorise === TOUS) { this._contexte.set(TOUS); return; }
    this._contexte.set(moi.biens.length === 1 ? moi.biens[0].id : TOUS);
  }
}
