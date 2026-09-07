// Décisions et votes.
//
// La maquette fixe la structure : la carte du vote ouvert avec sa barre de voix
// exprimées, les deux boutons Pour et Contre, la phrase qui dit ce qui manque,
// et l'historique en dessous, quatre colonnes : date, objet, majorité requise,
// résultat.
//
// **Ce que cet écran ne fait pas : calculer.** Le seuil, le décompte et le
// verdict viennent tous du serveur, où ils sont figés au dépouillement. Un
// écran qui recalculerait afficherait un autre chiffre le jour où la règle
// change, et une décision de 2026 doit se relire en 2032 telle qu'elle a été
// prise.
//
// **Une différence assumée avec le prototype.** La maquette ne propose que Pour
// et Contre. L'abstention existe ici comme choix explicite, à côté du silence,
// parce que les deux ne veulent pas dire la même chose : se prononcer pour
// l'abstention est une position, ne pas répondre est un oubli. Les deux comptent
// pareil au décompte, mais la gérante voit la différence, et le rappel avant
// clôture ne part qu'aux silencieux.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import { dateLongue, euros } from '../core/format';

type Sens = 'pour' | 'contre' | 'abstention';

interface Regle {
  id: number; acte: string; libelle: string; base: 'parts' | 'tetes';
  seuilNum: number; seuilDen: number; voteRequis: boolean;
}
interface Depouillement {
  total: number; pour: number; contre: number; abstention: number; exprime: number;
  requis: number; quorumRequis: number | null; quorumAtteint: boolean;
  adopte: boolean; manque: number; explication: string;
}
interface ScrutinResume {
  id: number; titre: string; expose: string; montantCents: number | null;
  ouvertLe: string; clotureLe: string; statut: 'ouvert' | 'adopte' | 'rejete' | 'annule';
  convoqueLe: string | null; regle: string; resultat: Depouillement | null; creeParNom: string | null;
}
interface Liste {
  structure: { id: number; nom: string; mode: string };
  regles: Regle[];
  voteApplicable: boolean;
  scrutins: ScrutinResume[];
}
interface Vue {
  scrutin: ScrutinResume; regle: Regle;
  voix: { personneId: number; nom: string; poids: number; sens: Sens | null }[];
  depouillement: Depouillement;
  monSens: Sens | null; monPoids: number | null; phrase: string; issueCertaine: boolean;
}

const RESULTAT: Record<string, string> = {
  ouvert: 'En cours', adopte: 'Adopté', rejete: 'Rejeté', annule: 'Annulé',
};

@Component({
  selector: 'app-decisions',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="d-flex flex-column gap-4">
      <div>
        <h1 class="h2 mb-2">Décisions &amp; votes</h1>
        <p class="text-body-secondary mb-0">
          Les voix sont pondérées par les {{ etat.vocabulaire().parts }}, avec la majorité requise
          selon la nature de l'acte.
        </p>
      </div>

      @if (erreur()) { <div class="alert alert-primary mb-0">{{ erreur() }}</div> }
      @if (message()) { <div class="alert alert-success mb-0">{{ message() }}</div> }

      @if (liste(); as l) {
        @if (!l.voteApplicable) {
          <section class="card">
            <div class="card-body">
              <span class="badge rounded-pill text-bg-light border fw-medium">{{ l.structure.nom }}</span>
              <h2 class="h4 mt-3 mb-2">Aucun vote sur ce bien</h2>
              <p class="small text-secondary-emphasis mb-0" style="max-width:60ch">
                Ce bien est détenu en nom propre : le propriétaire décide et invite les autres,
                sans scrutin. Les décisions prises se consignent quand même, pour mémoire.
              </p>
            </div>
          </section>
        }

        @for (s of ouverts(); track s.id) {
          <article class="card">
            <div class="card-body">
              <div class="row g-4">
                <div class="col-12 col-lg-7">
                  <div class="small fw-medium text-primary">
                    Vote ouvert · clôture le {{ dateLongue(s.clotureLe) }}
                    @if (s.creeParNom) { · ouvert par {{ s.creeParNom }} }
                  </div>
                  <h2 class="h4 mt-2 mb-2">{{ s.titre }}</h2>
                  <span class="badge rounded-pill text-bg-light border fw-medium">
                    {{ l.structure.nom }} · {{ s.regle }}
                    @if (s.montantCents !== null) { · {{ euros(s.montantCents) }} }
                  </span>
                  @if (s.expose) {
                    <p class="small text-secondary-emphasis mt-3 mb-0" style="max-width:60ch">{{ s.expose }}</p>
                  }
                </div>

                @if (detail()[s.id]; as d) {
                  <div class="col-12 col-lg-5">
                    <div class="eyebrow">Voix exprimées</div>
                    <div class="progress-stacked mt-2" style="height:9px"
                         role="img"
                         [attr.aria-label]="'Pour ' + pct(d.depouillement.pour, d.depouillement.total)
                           + ', contre ' + pct(d.depouillement.contre, d.depouillement.total)">
                      <div class="progress" [style.width.%]="part(d.depouillement.pour, d.depouillement.total)">
                        <div class="progress-bar bg-success"></div>
                      </div>
                      <div class="progress" [style.width.%]="part(d.depouillement.contre, d.depouillement.total)">
                        <div class="progress-bar bg-primary"></div>
                      </div>
                    </div>
                    <ul class="list-group list-group-flush mt-2">
                      <li class="list-group-item d-flex justify-content-between px-0 py-1 small">
                        <span class="text-body-secondary">Pour</span>
                        <span class="fw-medium tnum">{{ pct(d.depouillement.pour, d.depouillement.total) }}</span>
                      </li>
                      <li class="list-group-item d-flex justify-content-between px-0 py-1 small">
                        <span class="text-body-secondary">Contre</span>
                        <span class="fw-medium tnum">{{ pct(d.depouillement.contre, d.depouillement.total) }}</span>
                      </li>
                      <li class="list-group-item d-flex justify-content-between px-0 py-1 small">
                        <span class="text-body-secondary">En attente</span>
                        <span class="fw-medium tnum">{{ pct(d.depouillement.abstention, d.depouillement.total) }}</span>
                      </li>
                    </ul>
                    <div class="text-body-secondary mt-2" style="font-size:.72rem">
                      Seuil à atteindre : {{ d.depouillement.requis }} sur {{ d.depouillement.total }}
                      ({{ pct(d.depouillement.requis, d.depouillement.total) }})
                    </div>
                  </div>
                }
              </div>

              @if (detail()[s.id]; as d) {
                @if (d.monPoids !== null) {
                  <div class="d-flex gap-2 align-items-center flex-wrap border-top mt-4 pt-3">
                    @for (c of CHOIX; track c.sens) {
                      <button class="btn" type="button" style="min-width:118px"
                              [class]="classeChoix(c.sens, d.monSens)" [disabled]="occupe()"
                              (click)="voter(s, c.sens)">
                        @if (d.monSens === c.sens) { <i class="bi bi-check2 me-1" aria-hidden="true"></i> }
                        {{ c.libelle }}
                      </button>
                    }
                    <span class="text-body-secondary small flex-grow-1" style="min-width:200px">{{ d.phrase }}</span>
                  </div>
                } @else {
                  <p class="text-body-secondary small border-top mt-4 pt-3 mb-0">
                    Vous ne faites pas partie du corps électoral de ce scrutin, figé à son ouverture.
                  </p>
                }

                @if (etat.estGeranteIci()) {
                  <div class="d-flex gap-2 align-items-center flex-wrap border-top mt-3 pt-3">
                    <button class="btn btn-primary" type="button" [disabled]="occupe()"
                            (click)="depouiller(s)">Dépouiller et clore</button>
                    <button class="btn btn-outline-secondary" type="button" [disabled]="occupe()"
                            (click)="annuler(s)">Annuler</button>
                    <span class="text-body-secondary small flex-grow-1" style="min-width:200px">
                      @if (d.issueCertaine) {
                        Plus aucune voix ne peut changer le résultat : vous pouvez clore sans attendre.
                      } @else {
                        Clôture prévue le {{ dateLongue(s.clotureLe) }}.
                      }
                    </span>
                  </div>
                  <details class="mt-3">
                    <summary class="text-body-secondary small" style="cursor:pointer">Qui a voté quoi</summary>
                    <ul class="list-group list-group-flush mt-2">
                      @for (v of d.voix; track v.personneId) {
                        <li class="list-group-item d-flex align-items-center gap-3 px-0 small">
                          <span class="flex-grow-1">{{ v.nom }}</span>
                          <span class="tnum">{{ v.poids }}</span>
                          <span class="badge rounded-pill text-bg-light border fw-normal">{{ sensLisible(v.sens) }}</span>
                        </li>
                      }
                    </ul>
                  </details>
                }
              }
            </div>
          </article>
        }

        @if (l.voteApplicable && etat.estGeranteIci()) {
          <section class="card">
            <div class="card-body">
              <h2 class="h5 card-title">Ouvrir un vote</h2>
              <form class="row g-3" (ngSubmit)="ouvrir()">
                <div class="col-12">
                  <label class="form-label small text-body-secondary" for="v-titre">Objet de la décision</label>
                  <input class="form-control" id="v-titre" name="vtitre" [(ngModel)]="fTitre"
                         placeholder="Remplacement de la chaudière">
                </div>
                <div class="col-12 col-md-6">
                  <label class="form-label small text-body-secondary" for="v-regle">Nature de l'acte</label>
                  <select class="form-select" id="v-regle" name="vregle" [(ngModel)]="fRegleId">
                    @for (g of l.regles; track g.id) {
                      @if (g.voteRequis) { <option [ngValue]="g.id">{{ g.libelle }}</option> }
                    }
                  </select>
                </div>
                <div class="col-12 col-md-6">
                  <label class="form-label small text-body-secondary" for="v-cloture">Clôture le</label>
                  <input class="form-control" id="v-cloture" name="vcloture" type="date"
                         [(ngModel)]="fClotureLe" [min]="demain()">
                </div>
                <div class="col-12 col-md-6">
                  <label class="form-label small text-body-secondary" for="v-montant">
                    Montant en jeu (euros, facultatif)
                  </label>
                  <input class="form-control" id="v-montant" name="vmontant" type="number" min="0" step="0.01"
                         [(ngModel)]="fMontant">
                </div>
                <div class="col-12 col-md-6">
                  <label class="form-label small text-body-secondary" for="v-convoc">
                    Convocation d'assemblée (facultatif)
                  </label>
                  <input class="form-control" id="v-convoc" name="vconvoc" type="date" [(ngModel)]="fConvoqueLe">
                </div>
                <div class="col-12">
                  <label class="form-label small text-body-secondary" for="v-expose">Exposé</label>
                  <textarea class="form-control" id="v-expose" name="vexpose" rows="3" [(ngModel)]="fExpose"
                            placeholder="Devis, contexte, ce que chacun doit savoir avant de se prononcer."></textarea>
                </div>
                <div class="col-12 d-flex gap-3 align-items-center flex-wrap">
                  <button class="btn btn-primary" type="submit"
                          [disabled]="occupe() || !fTitre.trim() || !fClotureLe">Ouvrir le vote</button>
                  <span class="text-body-secondary small">
                    Le corps électoral est figé à l'ouverture, avec les {{ etat.vocabulaire().parts }}
                    en vigueur ce jour-là. Chaque électeur reçoit un courriel.
                  </span>
                </div>
              </form>
            </div>
          </section>
        }

        <section class="card">
          <div class="card-body">
            <div class="eyebrow mb-2">Historique</div>
            @if (clos().length) {
              <div class="table-responsive">
                <table class="table table-hover align-middle mb-0">
                  <thead>
                    <tr class="eyebrow">
                      <th scope="col">Date</th><th scope="col">Objet</th>
                      <th scope="col">Majorité</th><th scope="col">Résultat</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (s of clos(); track s.id) {
                      <tr>
                        <td class="tnum small text-body-secondary">{{ mois(s.ouvertLe) }}</td>
                        <td class="small fw-medium">
                          {{ s.titre }}
                          @if (s.resultat) {
                            <button class="btn btn-sm btn-link text-body-secondary p-0 ms-2" type="button"
                                    (click)="basculerDetail(s.id)">
                              {{ montre()[s.id] ? 'masquer le détail' : 'voir le détail' }}
                            </button>
                          }
                        </td>
                        <td class="small text-body-secondary">{{ s.regle }}</td>
                        <td>
                          <span class="badge rounded-pill"
                                [class]="s.statut === 'adopte'
                                  ? 'text-success-emphasis bg-success-subtle border border-success-subtle'
                                  : s.statut === 'rejete'
                                    ? 'text-primary-emphasis bg-primary-subtle border border-primary-subtle'
                                    : 'text-bg-light border'">{{ resultat(s.statut) }}</span>
                        </td>
                      </tr>
                      @if (montre()[s.id] && s.resultat) {
                        <tr>
                          <td class="bg-body-tertiary small" colspan="4"
                              style="white-space:pre-wrap">{{ s.resultat.explication }}</td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="text-body-secondary small mb-0">Aucune décision enregistrée.</p>
            }
          </div>
        </section>
      }
    </div>
  `,
})
export class Decisions {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);
  readonly dateLongue = dateLongue;
  readonly euros = euros;
  readonly CHOIX: { sens: Sens; libelle: string }[] = [
    { sens: 'pour', libelle: 'Pour' },
    { sens: 'contre', libelle: 'Contre' },
    { sens: 'abstention', libelle: 'Abstention' },
  ];

  readonly liste = signal<Liste | null>(null);
  readonly detail = signal<Record<number, Vue>>({});
  readonly montre = signal<Record<number, boolean>>({});
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  fTitre = '';
  fRegleId = 0;
  fClotureLe = '';
  fMontant: number | null = null;
  fConvoqueLe = '';
  fExpose = '';

  readonly structureId = computed(() => this.etat.bien()?.structureId ?? 0);
  readonly ouverts = computed(() => (this.liste()?.scrutins ?? []).filter((s) => s.statut === 'ouvert'));
  readonly clos = computed(() => (this.liste()?.scrutins ?? []).filter((s) => s.statut !== 'ouvert'));

  readonly resultat = (s: string): string => RESULTAT[s] ?? s;

  /**
   * Le bouton du sens choisi se remplit, les autres restent en contour : la
   * couleur dit « voilà ce que vous avez voté », pas « voilà ce qu'il faut voter ».
   */
  classeChoix(sens: Sens, mien: Sens | null): string {
    const plein = sens === 'pour' ? 'btn-success' : sens === 'contre' ? 'btn-primary' : 'btn-secondary';
    return mien === sens ? plein : `btn-outline-${plein.slice(4)}`;
  }

  readonly sensLisible = (s: Sens | null): string =>
    s === 'pour' ? 'Pour' : s === 'contre' ? 'Contre' : s === 'abstention' ? 'Abstention' : 'En attente';
  readonly demain = (): string => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  readonly mois = (iso: string): string => dateLongue(iso).split(' ').slice(1).join(' ');

  /**
   * Deux formes du même arrondi : `part()` pour la largeur de la barre, `pct()`
   * pour le texte. Écrire « 66,7 % » dans une largeur CSS ne donne rien, et
   * écrire « 66.7 » dans une phrase française non plus.
   */
  readonly part = (part: number, total: number): number =>
    total <= 0 ? 0 : Math.round((part * 1000) / total) / 10;

  readonly pct = (part: number, total: number): string =>
    `${this.part(part, total)}`.replace('.', ',') + ' %';

  constructor() {
    effect(() => { const id = this.structureId(); if (id) void this.charger(id); });
  }

  private async charger(structureId: number): Promise<void> {
    const l = await this.api.get<Liste>(`/structures/${structureId}/decisions`).catch(() => null);
    this.liste.set(l);
    if (l && !this.fRegleId) {
      this.fRegleId = l.regles.find((g) => g.voteRequis)?.id ?? 0;
    }
    if (!this.fClotureLe) {
      this.fClotureLe = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
    }
    // Le détail de chaque vote ouvert : c'est lui qui porte le décompte et la
    // voix de la personne qui regarde.
    const vues = await Promise.all((l?.scrutins ?? []).filter((s) => s.statut === 'ouvert')
      .map((s) => this.api.get<Vue>(`/scrutins/${s.id}`).catch(() => null)));
    const carte: Record<number, Vue> = {};
    for (const v of vues) if (v) carte[v.scrutin.id] = v;
    this.detail.set(carte);
  }

  private async tenter(quoi: () => Promise<string>): Promise<void> {
    const id = this.structureId();
    if (!id || this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try {
      this.message.set(await quoi());
      await this.charger(id);
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'opération a échoué.");
    } finally {
      this.occupe.set(false);
    }
  }

  basculerDetail(id: number): void {
    this.montre.update((m) => ({ ...m, [id]: !m[id] }));
  }

  voter(s: ScrutinResume, sens: Sens): Promise<void> {
    return this.tenter(async () => {
      await this.api.post(`/scrutins/${s.id}/voix`, { sens });
      return `Votre voix est enregistrée : ${this.sensLisible(sens).toLowerCase()}. `
        + 'Vous pouvez la changer tant que le vote est ouvert.';
    });
  }

  ouvrir(): Promise<void> {
    if (!this.fTitre.trim() || !this.fClotureLe) return Promise.resolve();
    return this.tenter(async () => {
      await this.api.post(`/structures/${this.structureId()}/decisions`, {
        regleId: this.fRegleId, titre: this.fTitre.trim(), expose: this.fExpose.trim(),
        montantCents: this.fMontant === null || this.fMontant === undefined
          ? null : Math.round(this.fMontant * 100),
        clotureLe: this.fClotureLe, convoqueLe: this.fConvoqueLe,
      });
      const titre = this.fTitre.trim();
      this.fTitre = '';
      this.fExpose = '';
      this.fMontant = null;
      this.fConvoqueLe = '';
      return `Vote « ${titre} » ouvert. Les électeurs sont prévenus par courriel.`;
    });
  }

  depouiller(s: ScrutinResume): Promise<void> {
    return this.tenter(async () => {
      const v = await this.api.post<Vue>(
        `/structures/${this.structureId()}/decisions/${s.id}/depouillement`, {});
      return v.depouillement.adopte
        ? `« ${s.titre} » est adopté.` : `« ${s.titre} » est rejeté.`;
    });
  }

  annuler(s: ScrutinResume): Promise<void> {
    return this.tenter(async () => {
      await this.api.post(`/structures/${this.structureId()}/decisions/${s.id}/annulation`, {});
      return `Vote « ${s.titre} » annulé.`;
    });
  }
}
