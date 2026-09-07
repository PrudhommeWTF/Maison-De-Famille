// Le carnet d'entretien : les obligations récurrentes, les tâches ouvertes et
// l'historique des interventions.
//
// La maquette fixe la structure : « Tâches ouvertes » en pleine largeur,
// « Récurrences » et « Checklist de départ » côte à côte en dessous. Elle fixe
// aussi les quatre catégories et leurs couleurs.
//
// **Cocher une tâche demande une date.** C'est la note de comportement, et ce
// n'est pas une formalité : une haie taillée le 12 juin et cochée le
// 3 septembre reste taillée le 12. Un carnet d'entretien qui daterait tout au
// jour du clic ne servirait à rien face à un assureur.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import { aujourdhui, dateLongue, euros } from '../core/format';

type Categorie = 'obligatoire' | 'saison' | 'courant' | 'inventaire';
type Urgence = 'en_retard' | 'proche' | 'plus_tard';

interface Tache {
  id: number; libelle: string; detail: string; categorie: Categorie;
  echeance: string | null; statut: string; faitLe: string | null; faitParNom: string | null;
  coutCents: number | null; signaleParNom: string | null; urgence?: Urgence;
}
interface Recurrence { id: number; libelle: string; categorie: Categorie; lisible: string }
interface LigneChecklist { id: number; libelle: string }
interface Carnet {
  ouvertes: Tache[]; historique: Tache[]; recurrences: Recurrence[];
  checklist: LigneChecklist[]; inventaire: { id: number; libelle: string; etat: string }[];
}

const LIBELLE_CATEGORIE: Record<Categorie, string> = {
  obligatoire: 'Obligatoire', saison: 'Saison', courant: 'Courant', inventaire: 'Inventaire',
};

@Component({
  selector: 'app-entretien',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="d-flex flex-column gap-4">
      <div>
        <h1 class="h2 mb-2">Carnet d'entretien</h1>
        <p class="text-body-secondary mb-0">
          Les obligations récurrentes, les tâches ouvertes et l'historique des interventions.
        </p>
      </div>

      @if (erreur()) { <div class="alert alert-primary mb-0">{{ erreur() }}</div> }
      @if (message()) { <div class="alert alert-success mb-0">{{ message() }}</div> }

      @if (carnet(); as c) {
        <section class="card">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-center gap-3 mb-2">
              <div class="eyebrow"><i class="bi bi-tools me-2" aria-hidden="true"></i>Tâches ouvertes</div>
              <span class="badge rounded-pill text-bg-light border">{{ c.ouvertes.length }}</span>
            </div>

            @if (c.ouvertes.length) {
              <ul class="list-group list-group-flush">
                @for (t of c.ouvertes; track t.id) {
                  <li class="list-group-item px-0">
                    <div class="d-flex align-items-start gap-3">
                      @if (gerant()) {
                        <input class="form-check-input mt-1 flex-shrink-0" type="checkbox"
                               [checked]="cochage() === t.id" [attr.aria-label]="'Cocher ' + t.libelle"
                               (change)="ouvrirCochage(t)">
                      }
                      <span class="flex-grow-1" style="min-width:180px">
                        <span class="d-block small fw-medium">{{ t.libelle }}</span>
                        <span class="d-block text-body-secondary" style="font-size:.78rem">
                          @if (t.echeance) {
                            <span [class.text-primary-emphasis]="t.urgence === 'en_retard'"
                                  [class.fw-medium]="t.urgence === 'en_retard'">
                              {{ t.urgence === 'en_retard' ? 'En retard depuis le' : 'Avant le' }}
                              {{ dateLongue(t.echeance) }}
                            </span>
                          } @else { Sans date limite }
                          @if (t.signaleParNom) { · signalé par {{ t.signaleParNom }} }
                          @if (t.detail) { · {{ t.detail }} }
                        </span>
                      </span>
                      <span class="badge rounded-pill flex-shrink-0"
                            [class]="classeCategorie(t.categorie)">{{ categorie(t.categorie) }}</span>
                    </div>

                    @if (cochage() === t.id) {
                      <form class="row g-2 align-items-end mt-1" (ngSubmit)="cocher(t)">
                        <div class="col-12 col-md-3">
                          <label class="form-label small text-body-secondary" [attr.for]="'d-' + t.id">Fait le</label>
                          <input class="form-control" [attr.id]="'d-' + t.id" type="date" [name]="'d-' + t.id"
                                 [(ngModel)]="fFaitLe" [max]="aujourdhui()" required>
                        </div>
                        <div class="col-12 col-md-3">
                          <label class="form-label small text-body-secondary" [attr.for]="'c-' + t.id">Coût (euros)</label>
                          <input class="form-control" [attr.id]="'c-' + t.id" type="number" min="0" step="0.01"
                                 [name]="'c-' + t.id" [(ngModel)]="fCout" placeholder="facultatif">
                        </div>
                        <div class="col-12 col-md-3">
                          <label class="btn btn-outline-secondary w-100">
                            <i class="bi bi-paperclip me-1" aria-hidden="true"></i>{{ fFactureNom || 'Facture' }}
                            <input type="file" accept="image/*,application/pdf" hidden
                                   (change)="choisirFacture($event)">
                          </label>
                        </div>
                        <div class="col-12 col-md-3">
                          <button class="btn btn-primary w-100" type="submit" [disabled]="occupe()">Enregistrer</button>
                        </div>
                      </form>
                    }
                  </li>
                }
              </ul>
            } @else {
              <p class="text-body-secondary small mb-0">Rien en attente.</p>
            }
          </div>
        </section>

        <div class="row row-cols-1 row-cols-md-2 g-3">
          <div class="col">
            <section class="card h-100">
              <div class="card-body">
                <div class="eyebrow mb-2">Récurrences</div>
                <p class="text-body-secondary small">
                  Chacune engendre sa tâche avec sa date limite, d'elle-même.
                </p>
                @if (c.recurrences.length) {
                  <ul class="list-group list-group-flush">
                    @for (r of c.recurrences; track r.id) {
                      <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                        <span>{{ r.libelle }}</span>
                        <span class="text-body-secondary text-end">
                          {{ r.lisible }}
                          @if (gerant()) {
                            <button class="btn btn-sm btn-link text-body-secondary p-0 ms-2" type="button"
                                    (click)="supprimerRecurrence(r)">Retirer</button>
                          }
                        </span>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="text-body-secondary small mb-0">Aucune récurrence.</p>
                }

                @if (gerant()) {
                  <details class="mt-3">
                    <summary class="text-body-secondary small" style="cursor:pointer">Ajouter une récurrence</summary>
                    <form class="row g-2 mt-0" (ngSubmit)="ajouterRecurrence()">
                      <div class="col-12 col-md-6">
                        <label class="form-label small text-body-secondary" for="r-lib">Intitulé</label>
                        <input class="form-control" id="r-lib" name="rlib" [(ngModel)]="fRecLibelle"
                               placeholder="Ramonage de la cheminée">
                      </div>
                      <div class="col-12 col-md-6">
                        <label class="form-label small text-body-secondary" for="r-cat">Catégorie</label>
                        <select class="form-select" id="r-cat" name="rcat" [(ngModel)]="fRecCategorie">
                          @for (k of CATEGORIES; track k) { <option [value]="k">{{ categorie(k) }}</option> }
                        </select>
                      </div>
                      <div class="col-12 col-md-6">
                        <label class="form-label small text-body-secondary" for="r-per">Rythme</label>
                        <select class="form-select" id="r-per" name="rper" [(ngModel)]="fRecPeriodicite">
                          <option value="annuelle">Tous les ans</option>
                          <option value="mensuelle">Tous les mois</option>
                          <option value="sejour">À chaque séjour</option>
                        </select>
                      </div>
                      @if (fRecPeriodicite === 'annuelle') {
                        <div class="col-12 col-md-6">
                          <label class="form-label small text-body-secondary" for="r-lim">Avant le (mois-jour)</label>
                          <input class="form-control" id="r-lim" name="rlim" [(ngModel)]="fRecLimite" placeholder="10-15">
                        </div>
                      }
                      @if (fRecPeriodicite === 'mensuelle') {
                        <div class="col-6 col-md-3">
                          <label class="form-label small text-body-secondary" for="r-md">De (mois)</label>
                          <input class="form-control" id="r-md" name="rmd" type="number" min="1" max="12"
                                 [(ngModel)]="fRecMoisDebut">
                        </div>
                        <div class="col-6 col-md-3">
                          <label class="form-label small text-body-secondary" for="r-mf">À (mois)</label>
                          <input class="form-control" id="r-mf" name="rmf" type="number" min="1" max="12"
                                 [(ngModel)]="fRecMoisFin">
                        </div>
                      }
                      <div class="col-12">
                        <button class="btn btn-primary" type="submit"
                                [disabled]="occupe() || !fRecLibelle.trim()">Ajouter</button>
                      </div>
                    </form>
                  </details>
                }
              </div>
            </section>
          </div>

          <div class="col">
            <section class="card h-100">
              <div class="card-body">
                <div class="eyebrow mb-2">
                  <i class="bi bi-list-check me-2" aria-hidden="true"></i>Checklist de départ
                </div>
                <p class="text-body-secondary small">
                  Envoyée automatiquement la veille de chaque fin de séjour, à l'occupant.
                </p>
                @if (c.checklist.length) {
                  <ul class="mb-0 small lh-lg">
                    @for (l of c.checklist; track l.id) {
                      <li>
                        {{ l.libelle }}
                        @if (gerant()) {
                          <button class="btn btn-sm btn-link text-body-secondary p-0 ms-1" type="button"
                                  (click)="supprimerChecklist(l)">retirer</button>
                        }
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="text-body-secondary small mb-0">
                    Aucune ligne : rien ne partira. Ajoutez ce qu'il faut vérifier avant de fermer la maison.
                  </p>
                }
                @if (gerant()) {
                  <form class="row g-2 align-items-end mt-1" (ngSubmit)="ajouterChecklist()">
                    <div class="col">
                      <label class="form-label small text-body-secondary" for="k-lib">Ajouter une ligne</label>
                      <input class="form-control" id="k-lib" name="klib" [(ngModel)]="fChecklist"
                             placeholder="Compteur d'eau relevé et vanne fermée">
                    </div>
                    <div class="col-auto">
                      <button class="btn btn-outline-secondary" type="submit"
                              [disabled]="occupe() || !fChecklist.trim()">Ajouter</button>
                    </div>
                  </form>
                }
              </div>
            </section>
          </div>
        </div>

        @if (c.historique.length) {
          <section class="card">
            <div class="card-body">
              <div class="eyebrow mb-2">Historique des interventions</div>
              <ul class="list-group list-group-flush">
                @for (t of c.historique; track t.id) {
                  <li class="list-group-item d-flex align-items-start gap-3 px-0">
                    <span class="flex-grow-1">
                      <span class="d-block small fw-medium">{{ t.libelle }}</span>
                      <span class="d-block text-body-secondary" style="font-size:.78rem">
                        Fait le {{ dateLongue(t.faitLe!) }}
                        @if (t.faitParNom) { par {{ t.faitParNom }} }
                        @if (t.coutCents !== null) { · {{ euros(t.coutCents) }} }
                      </span>
                    </span>
                    <span class="badge rounded-pill flex-shrink-0"
                          [class]="classeCategorie(t.categorie)">{{ categorie(t.categorie) }}</span>
                  </li>
                }
              </ul>
            </div>
          </section>
        }
      }
    </div>
  `,
})
export class Entretien {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);
  readonly dateLongue = dateLongue;
  readonly aujourdhui = aujourdhui;
  readonly euros = euros;
  readonly CATEGORIES: Categorie[] = ['obligatoire', 'saison', 'courant', 'inventaire'];

  readonly carnet = signal<Carnet | null>(null);
  readonly cochage = signal<number | null>(null);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  fFaitLe = aujourdhui();
  fCout: number | null = null;
  fFactureNom = '';
  private fFactureContenu = '';

  fRecLibelle = '';
  fRecCategorie: Categorie = 'obligatoire';
  fRecPeriodicite = 'annuelle';
  fRecLimite = '';
  fRecMoisDebut: number | null = null;
  fRecMoisFin: number | null = null;
  fChecklist = '';

  readonly gerant = computed(() => this.etat.estGeranteIci());
  readonly categorie = (c: Categorie): string => LIBELLE_CATEGORIE[c] ?? c;

  /** Une obligation légale se voit, une tâche courante ne crie pas. */
  classeCategorie(c: Categorie): string {
    if (c === 'obligatoire') return 'text-primary-emphasis bg-primary-subtle border border-primary-subtle';
    if (c === 'saison') return 'text-info-emphasis bg-info-subtle border border-info-subtle';
    return 'text-bg-light border';
  }

  constructor() {
    effect(() => { const b = this.etat.bien(); if (b) void this.charger(b.id); });
  }

  private async charger(bienId: number): Promise<void> {
    this.carnet.set(await this.api.get<Carnet>(`/biens/${bienId}/entretien`).catch(() => null));
  }

  private async tenter(quoi: () => Promise<string>): Promise<void> {
    const b = this.etat.bien();
    if (!b || this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try {
      this.message.set(await quoi());
      await this.charger(b.id);
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'opération a échoué.");
    } finally {
      this.occupe.set(false);
    }
  }

  ouvrirCochage(t: Tache): void {
    this.cochage.set(this.cochage() === t.id ? null : t.id);
    this.fFaitLe = aujourdhui();
    this.fCout = null;
    this.fFactureNom = '';
    this.fFactureContenu = '';
  }

  choisirFacture(e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const lecteur = new FileReader();
    lecteur.onload = () => {
      this.fFactureNom = f.name;
      this.fFactureContenu = String(lecteur.result).split(',')[1] ?? '';
    };
    lecteur.readAsDataURL(f);
  }

  cocher(t: Tache): Promise<void> {
    const b = this.etat.bien();
    if (!b) return Promise.resolve();
    return this.tenter(async () => {
      let fichierId = '';
      if (this.fFactureContenu) {
        const f = await this.api.post<{ id: string }>(`/biens/${b.id}/entretien/facture`,
          { nom: this.fFactureNom, contenu: this.fFactureContenu });
        fichierId = f.id;
      }
      await this.api.post(`/biens/${b.id}/taches/${t.id}/realisation`, {
        faitLe: this.fFaitLe,
        // Les euros saisis deviennent des centimes : le serveur ne manipule que
        // des entiers, pour la même raison que la comptabilité de la tranche 2.
        coutCents: this.fCout === null || this.fCout === undefined ? null : Math.round(this.fCout * 100),
        fichierId,
      });
      this.cochage.set(null);
      return `« ${t.libelle} » enregistré comme fait le ${dateLongue(this.fFaitLe)}.`;
    });
  }

  ajouterRecurrence(): Promise<void> {
    const b = this.etat.bien();
    if (!b || !this.fRecLibelle.trim()) return Promise.resolve();
    return this.tenter(async () => {
      await this.api.post(`/biens/${b.id}/recurrences`, {
        libelle: this.fRecLibelle.trim(), categorie: this.fRecCategorie,
        periodicite: this.fRecPeriodicite,
        limiteMmjj: this.fRecPeriodicite === 'annuelle' ? this.fRecLimite : '',
        moisDebut: this.fRecPeriodicite === 'mensuelle' ? this.fRecMoisDebut : null,
        moisFin: this.fRecPeriodicite === 'mensuelle' ? this.fRecMoisFin : null,
      });
      const nom = this.fRecLibelle.trim();
      this.fRecLibelle = '';
      return `Récurrence « ${nom} » ajoutée, sa première échéance est posée.`;
    });
  }

  supprimerRecurrence(r: Recurrence): Promise<void> {
    const b = this.etat.bien();
    if (!b) return Promise.resolve();
    return this.tenter(async () => {
      await this.api.post(`/biens/${b.id}/recurrences/${r.id}/archivage`, {});
      return `Récurrence « ${r.libelle} » retirée. L'historique des interventions passées reste.`;
    });
  }

  ajouterChecklist(): Promise<void> {
    const b = this.etat.bien();
    if (!b || !this.fChecklist.trim()) return Promise.resolve();
    return this.tenter(async () => {
      await this.api.post(`/biens/${b.id}/checklist`,
        { libelle: this.fChecklist.trim(), ordre: (this.carnet()?.checklist.length ?? 0) + 1 });
      this.fChecklist = '';
      return 'Ligne ajoutée à la checklist de départ.';
    });
  }

  supprimerChecklist(l: LigneChecklist): Promise<void> {
    const b = this.etat.bien();
    if (!b) return Promise.resolve();
    return this.tenter(async () => {
      await this.api.post(`/biens/${b.id}/checklist/${l.id}/archivage`, {});
      return 'Ligne retirée.';
    });
  }
}
