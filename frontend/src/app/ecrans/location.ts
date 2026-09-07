// Location saisonnière.
//
// La maquette fixe la structure : quatre mesures en bandeau (loyers encaissés,
// semaines louées, charges déduites, net à répartir), le tableau des
// réservations en cinq colonnes, puis deux encarts côte à côte, « Répartition
// des loyers » et « Accès locataire ».
//
// Trois notes de comportement, reprises telles quelles :
//
//   - « La location est activable par bien : seule Kerloc'h l'a activée ici. »
//   - « Les semaines famille sont posées avant l'ouverture à la location ;
//     l'inverse déclenche une alerte. »
//   - « Le loyer net se calcule après déduction des charges directement liées
//     à la location. »
//
// **Rien n'est calculé ici.** L'exercice, le net et l'explication viennent du
// serveur, où ils sont produits par un module pur et testé. Un écran qui
// referait la soustraction afficherait un jour un autre chiffre que la
// répartition réellement versée, et c'est le genre d'écart qui fâche une
// famille pour de bon.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import { aujourdhui, euros, nuitsLisible, plage } from '../core/format';

type Statut = 'a_confirmer' | 'acompte' | 'solde' | 'annule';

interface Reservation {
  id: number; sejourId: number; locataire: string; email: string; telephone: string;
  arrivee: string; depart: string; nuits: number; occupants: number;
  loyerCents: number; acompteCents: number; statut: Statut; note: string;
}
interface Charge { id: number; libelle: string; dateDepense: string; montantCents: number }
interface Exercice {
  annee: number; encaisseCents: number; attenduCents: number; chargesCents: number;
  netCents: number; nuitsLouees: number; reservations: number; aConfirmer: number;
  explication: string;
}
interface Saison {
  annee: number; exercice: Exercice; reservations: Reservation[]; charges: Charge[];
  alerte: string | null; peutModifier: boolean;
}

const LIBELLE: Record<Statut, string> = {
  a_confirmer: 'À confirmer', acompte: 'Acompte reçu', solde: 'Soldé', annule: 'Annulée',
};

@Component({
  selector: 'app-location',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="d-flex flex-column gap-4">
      <div class="d-flex justify-content-between align-items-end gap-3 flex-wrap">
        <div>
          <h1 class="h2 mb-2">Location saisonnière @if (etat.bien(); as b) { · {{ b.nom }} }</h1>
          <p class="text-body-secondary mb-0">
            Les semaines famille sont posées avant l'ouverture à la location.
          </p>
        </div>
        <div class="d-flex gap-2 align-items-center">
          <button class="btn btn-sm btn-outline-secondary" type="button" (click)="changerAnnee(-1)"
                  aria-label="Année précédente">
            <i class="bi bi-chevron-left" aria-hidden="true"></i>
          </button>
          <strong class="tnum">{{ annee() }}</strong>
          <button class="btn btn-sm btn-outline-secondary" type="button" (click)="changerAnnee(1)"
                  aria-label="Année suivante">
            <i class="bi bi-chevron-right" aria-hidden="true"></i>
          </button>
        </div>
      </div>

      @if (erreur()) { <div class="alert alert-primary mb-0">{{ erreur() }}</div> }
      @if (message()) { <div class="alert alert-success mb-0">{{ message() }}</div> }

      @if (refus()) {
        <section class="card">
          <div class="card-body">
            <h2 class="h5 card-title">La location n'est pas activée sur ce bien</h2>
            <p class="text-body-secondary small mb-0">{{ refus() }}</p>
          </div>
        </section>
      }

      @if (saison(); as s) {
        @if (s.alerte) { <div class="alert alert-primary mb-0">{{ s.alerte }}</div> }

        <div class="row row-cols-1 row-cols-sm-2 row-cols-xl-4 g-3">
          <div class="col"><div class="card h-100"><div class="card-body">
            <div class="text-body-secondary small">Loyers encaissés {{ s.annee }}</div>
            <div class="fs-3 mt-2 tnum card-title">{{ euros(s.exercice.encaisseCents) }}</div>
          </div></div></div>
          <div class="col"><div class="card h-100"><div class="card-body">
            <div class="text-body-secondary small">Nuits louées</div>
            <div class="fs-3 mt-2 tnum card-title">{{ s.exercice.nuitsLouees }}</div>
          </div></div></div>
          <div class="col"><div class="card h-100"><div class="card-body">
            <div class="text-body-secondary small">Charges déduites</div>
            <div class="fs-3 mt-2 tnum card-title">{{ euros(s.exercice.chargesCents) }}</div>
          </div></div></div>
          <div class="col"><div class="card h-100"><div class="card-body">
            <div class="text-body-secondary small">Net à répartir</div>
            <div class="fs-3 mt-2 tnum card-title"
                 [class.text-primary-emphasis]="s.exercice.netCents < 0"
                 [class.text-success-emphasis]="s.exercice.netCents > 0">
              {{ euros(s.exercice.netCents) }}
            </div>
          </div></div></div>
        </div>

        <section class="card">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-center gap-3 flex-wrap mb-2">
              <div class="eyebrow">Réservations</div>
              @if (s.peutModifier) {
                <button class="btn btn-sm btn-outline-secondary" type="button" (click)="depot.set(!depot())">
                  <i class="bi bi-plus-circle me-1" aria-hidden="true"></i>
                  {{ depot() ? 'Fermer' : 'Ajouter une réservation' }}
                </button>
              }
            </div>

            @if (depot() && s.peutModifier) {
              <form class="row g-3 mb-3" (ngSubmit)="creer()">
                <div class="col-12 col-md-6">
                  <label class="form-label small text-body-secondary" for="r-loc">Locataire</label>
                  <input class="form-control" id="r-loc" name="rloc" [(ngModel)]="fLocataire"
                         placeholder="M. et Mme Corre">
                </div>
                <div class="col-12 col-md-6">
                  <label class="form-label small text-body-secondary" for="r-mail">Courriel (facultatif)</label>
                  <input class="form-control" id="r-mail" name="rmail" type="email" [(ngModel)]="fEmail">
                </div>
                <div class="col-6 col-md-3">
                  <label class="form-label small text-body-secondary" for="r-arr">Arrivée</label>
                  <input class="form-control" id="r-arr" name="rarr" type="date" [(ngModel)]="fArrivee">
                </div>
                <div class="col-6 col-md-3">
                  <label class="form-label small text-body-secondary" for="r-dep">Départ</label>
                  <input class="form-control" id="r-dep" name="rdep" type="date" [(ngModel)]="fDepart">
                </div>
                <div class="col-6 col-md-2">
                  <label class="form-label small text-body-secondary" for="r-occ">Occupants</label>
                  <input class="form-control" id="r-occ" name="rocc" type="number" min="1" [(ngModel)]="fOccupants">
                </div>
                <div class="col-6 col-md-2">
                  <label class="form-label small text-body-secondary" for="r-loyer">Loyer (euros)</label>
                  <input class="form-control" id="r-loyer" name="rloyer" type="number" min="0" step="0.01"
                         [(ngModel)]="fLoyer">
                </div>
                <div class="col-6 col-md-2">
                  <label class="form-label small text-body-secondary" for="r-ac">Acompte (euros)</label>
                  <input class="form-control" id="r-ac" name="rac" type="number" min="0" step="0.01"
                         [(ngModel)]="fAcompte">
                </div>
                <div class="col-12 d-flex gap-3 align-items-center flex-wrap">
                  <button class="btn btn-primary" type="submit"
                          [disabled]="occupe() || !fLocataire.trim() || !fArrivee || !fDepart">
                    Enregistrer la réservation
                  </button>
                  <span class="text-body-secondary small">
                    La semaine est aussitôt bloquée au calendrier, comme un séjour de famille.
                  </span>
                </div>
              </form>
            }

            @if (s.reservations.length) {
              <div class="table-responsive">
                <table class="table table-hover align-middle mb-0">
                  <thead>
                    <tr class="eyebrow">
                      <th scope="col">Dates</th><th scope="col">Locataire</th>
                      <th scope="col">Occupants</th><th class="text-end" scope="col">Loyer</th>
                      <th scope="col">Statut</th><th scope="col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (r of s.reservations; track r.id) {
                      <tr [class.opacity-50]="r.statut === 'annule'">
                        <td class="tnum small text-body-secondary">{{ plage(r.arrivee, r.depart) }}</td>
                        <td>
                          <span class="d-block small fw-medium">{{ r.locataire }}</span>
                          <span class="d-block text-body-secondary" style="font-size:.72rem">
                            {{ nuitsLisible(r.nuits) }}
                          </span>
                        </td>
                        <td class="small text-body-secondary">{{ r.occupants }} personnes</td>
                        <td class="small fw-medium tnum text-end">{{ euros(r.loyerCents) }}</td>
                        <td>
                          <span class="badge rounded-pill" [class]="classeStatut(r.statut)">{{ libelle(r.statut) }}</span>
                        </td>
                        <td class="text-end">
                          @if (s.peutModifier && r.statut !== 'annule') {
                            <select class="form-select form-select-sm w-auto d-inline-block"
                                    (change)="changerStatut(r, $event)"
                                    [attr.aria-label]="'Changer le statut de la réservation de ' + r.locataire">
                              <option value="">Changer...</option>
                              @for (o of STATUTS; track o) {
                                @if (o !== r.statut) { <option [value]="o">{{ libelle(o) }}</option> }
                              }
                            </select>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="text-body-secondary small mb-0">Aucune réservation sur {{ s.annee }}.</p>
            }

            <div class="bg-body-tertiary rounded p-3 mt-3 small"
                 style="white-space:pre-wrap">{{ s.exercice.explication }}</div>
          </div>
        </section>

        <div class="row row-cols-1 row-cols-md-2 g-3">
          <div class="col">
            <section class="card h-100">
              <div class="card-body">
                <div class="eyebrow mb-2">Répartition des loyers</div>
                <p class="small text-secondary-emphasis mb-0">
                  Le net est réparti au prorata des {{ etat.vocabulaire().parts }} en vigueur à la
                  clôture de la saison, avec les mêmes règles et les mêmes arrondis que les dépenses.
                  Il se ventile depuis l'écran Dépenses, pour qu'il n'existe qu'une seule table de
                  répartition et un seul historique.
                </p>
              </div>
            </section>
          </div>
          <div class="col">
            <section class="card h-100">
              <div class="card-body">
                <div class="eyebrow mb-2">Charges de la saison</div>
                @if (s.charges.length) {
                  <ul class="list-group list-group-flush">
                    @for (c of s.charges; track c.id) {
                      <li class="list-group-item d-flex justify-content-between gap-2 px-0 small">
                        <span>{{ c.libelle }}</span>
                        <span class="fw-medium tnum">{{ euros(c.montantCents) }}</span>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="small text-secondary-emphasis mb-0">
                    Aucune charge marquée « liée à la location » sur {{ s.annee }}. La case se coche
                    à la saisie d'une dépense : ménage de fin de séjour, blanchisserie, commission.
                  </p>
                }
              </div>
            </section>
          </div>
        </div>
      }
    </div>
  `,
})
export class Location {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);
  readonly euros = euros;
  readonly plage = plage;
  readonly nuitsLisible = nuitsLisible;
  readonly STATUTS: Statut[] = ['a_confirmer', 'acompte', 'solde', 'annule'];

  readonly saison = signal<Saison | null>(null);
  /** Le message du serveur quand le module n'est pas activé sur ce bien. */
  readonly refus = signal('');
  readonly annee = signal(Number(aujourdhui().slice(0, 4)));
  readonly depot = signal(false);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  fLocataire = '';
  fEmail = '';
  fArrivee = '';
  fDepart = '';
  fOccupants = 2;
  fLoyer: number | null = null;
  fAcompte: number | null = null;

  readonly bienId = computed(() => this.etat.bien()?.id ?? 0);
  readonly libelle = (s: Statut): string => LIBELLE[s];

  /** Soldé se lit d'un coup d'oeil, un acompte se distingue d'une annulation. */
  classeStatut(s: Statut): string {
    if (s === 'solde') return 'text-success-emphasis bg-success-subtle border border-success-subtle';
    if (s === 'acompte') return 'text-primary-emphasis bg-primary-subtle border border-primary-subtle';
    return 'text-bg-light border';
  }

  constructor() {
    effect(() => { const id = this.bienId(); const a = this.annee(); if (id) void this.charger(id, a); });
  }

  changerAnnee(pas: number): void {
    this.annee.update((a) => a + pas);
  }

  private async charger(bienId: number, annee: number): Promise<void> {
    this.erreur.set('');
    try {
      this.saison.set(await this.api.get<Saison>(`/biens/${bienId}/location?annee=${annee}`));
      this.refus.set('');
    } catch (e) {
      this.saison.set(null);
      // Le serveur refuse plutôt que de rendre une liste vide, et son message
      // dit où activer le module : on l'affiche tel quel.
      this.refus.set(e instanceof ErreurAppel ? e.message : 'La saison n\'a pas pu être chargée.');
    }
  }

  private async tenter(quoi: () => Promise<string>): Promise<void> {
    const id = this.bienId();
    if (!id || this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try {
      this.message.set(await quoi());
      await this.charger(id, this.annee());
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'opération a échoué.");
    } finally {
      this.occupe.set(false);
    }
  }

  creer(): Promise<void> {
    if (!this.fLocataire.trim() || !this.fArrivee || !this.fDepart) return Promise.resolve();
    return this.tenter(async () => {
      await this.api.post(`/biens/${this.bienId()}/location/reservations`, {
        locataire: this.fLocataire.trim(), email: this.fEmail.trim(), telephone: '',
        arrivee: this.fArrivee, depart: this.fDepart, occupants: this.fOccupants,
        loyerCents: Math.round((this.fLoyer ?? 0) * 100),
        acompteCents: Math.round((this.fAcompte ?? 0) * 100),
        note: '',
      });
      const qui = this.fLocataire.trim();
      this.fLocataire = '';
      this.fEmail = '';
      this.fLoyer = null;
      this.fAcompte = null;
      this.depot.set(false);
      return `Réservation de ${qui} enregistrée, la semaine est bloquée au calendrier.`;
    });
  }

  changerStatut(r: Reservation, e: Event): Promise<void> {
    const select = e.target as HTMLSelectElement;
    const statut = select.value as Statut;
    // Le menu revient à « Changer... » : c'est une action, pas un champ, et la
    // pastille à côté porte déjà l'état.
    select.value = '';
    if (!statut || statut === r.statut) return Promise.resolve();
    return this.tenter(async () => {
      await this.api.post(`/biens/${this.bienId()}/location/reservations/${r.id}/statut`, { statut });
      return statut === 'annule'
        ? `Réservation de ${r.locataire} annulée : la semaine est rendue à la famille.`
        : `Réservation de ${r.locataire} : ${LIBELLE[statut].toLowerCase()}.`;
    });
  }
}
