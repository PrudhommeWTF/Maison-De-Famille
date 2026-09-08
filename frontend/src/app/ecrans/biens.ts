// Les biens gérés : ajouter, ouvrir, archiver.
//
// C'est l'écran qui porte la notion de structure. Le mode de détention se
// choisit à la création parce qu'il détermine tout le reste : les règles de
// vote, la répartition par défaut, et le vocabulaire affiché partout ailleurs.
//
// **Le retrait se fait en deux temps et n'efface rien.** Un encart explique que
// le bien est archivé, que ses séjours restent consultables, et que l'action est
// réversible. C'est plus honnête et plus sûr qu'une boîte de dialogue.
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import type { BienResume } from '../core/modeles';

const MODES = [
  { valeur: 'indivision', icone: 'bi-people', titre: 'Indivision', description: "Plusieurs héritiers détiennent le bien ensemble. Les décisions se prennent à la majorité, l'unanimité pour vendre." },
  { valeur: 'sci', icone: 'bi-building', titre: 'SCI', description: 'Une société civile immobilière détient le bien. Les décisions suivent les statuts et se prennent en assemblée.' },
  { valeur: 'nom_propre', icone: 'bi-person', titre: 'Nom propre', description: 'Une seule personne est propriétaire. Elle décide et invite les autres, sans vote.' },
] as const;

@Component({
  selector: 'app-biens',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="d-flex flex-column gap-4">
      <div class="d-flex justify-content-between align-items-end gap-3 flex-wrap">
        <div>
          <h1 class="h2 mb-2">Biens gérés</h1>
          <p class="text-body-secondary mb-0">
            Chaque bien appartient à une structure : c'est elle qui porte les règles de décision et le vocabulaire.
          </p>
        </div>
        <button class="btn btn-primary" (click)="formulaire.set(!formulaire())">
          <i class="bi me-1" [class.bi-plus-circle]="!formulaire()" [class.bi-x-circle]="formulaire()"></i>
          {{ formulaire() ? 'Fermer le formulaire' : 'Ajouter un bien' }}
        </button>
      </div>

      @if (erreur()) { <div class="alert alert-primary mb-0">{{ erreur() }}</div> }

      @if (formulaire()) {
        <section class="card">
          <div class="card-body">
            <h2 class="h5 card-title">Ajouter un bien</h2>
            <div class="eyebrow mt-4 mb-2">Mode de détention</div>
            <div class="row row-cols-1 row-cols-md-3 g-2">
              @for (m of modes; track m.valeur) {
                <div class="col">
                  <button class="card h-100 w-100 text-start border-2"
                          [class.border-primary]="f.structureMode === m.valeur"
                          [class.text-primary]="f.structureMode === m.valeur"
                          type="button" [attr.aria-pressed]="f.structureMode === m.valeur"
                          (click)="f.structureMode = m.valeur">
                    <span class="card-body p-3">
                      <span class="small fw-medium d-flex align-items-center gap-2">
                        <i class="bi" [class]="m.icone" aria-hidden="true"></i>{{ m.titre }}
                      </span>
                      <span class="d-block text-body-secondary mt-2" style="font-size:.78rem">{{ m.description }}</span>
                    </span>
                  </button>
                </div>
              }
            </div>

            <form class="row g-3 mt-1" (ngSubmit)="creer()">
              <div class="col-12 col-md-6">
                <label class="form-label small text-body-secondary" for="b-snom">Nom de la structure</label>
                <input class="form-control" id="b-snom" name="structureNom" [(ngModel)]="f.structureNom"
                       placeholder="Indivision Kerloc'h" required>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label small text-body-secondary" for="b-nom">Nom du bien</label>
                <input class="form-control" id="b-nom" name="nom" [(ngModel)]="f.nom"
                       placeholder="Maison de Kerloc'h" required>
              </div>
              <div class="col-12 col-md-6 col-xl-3">
                <label class="form-label small text-body-secondary" for="b-commune">Commune</label>
                <input class="form-control" id="b-commune" name="commune" [(ngModel)]="f.commune" required>
              </div>
              <div class="col-12 col-md-6 col-xl-3">
                <label class="form-label small text-body-secondary" for="b-type">Type</label>
                <select class="form-select" id="b-type" name="type" [(ngModel)]="f.type">
                  <option value="mer">Bord de mer</option>
                  <option value="montagne">Montagne</option>
                  <option value="campagne">Campagne</option>
                  <option value="ville">Ville</option>
                </select>
              </div>
              <div class="col-12 col-md-6 col-xl-3">
                <label class="form-label small text-body-secondary" for="b-couchages">Couchages</label>
                <input class="form-control" id="b-couchages" name="couchages" type="number" min="1" max="100"
                       [(ngModel)]="f.couchages" required>
              </div>
              <div class="col-12 col-md-6 col-xl-3">
                <label class="form-label small text-body-secondary" for="b-loc">Location saisonnière</label>
                <select class="form-select" id="b-loc" name="locationActivee" [(ngModel)]="f.locationActivee">
                  <option [ngValue]="false">Non louée</option>
                  <option [ngValue]="true">Louée en saison</option>
                </select>
              </div>
              <div class="col-12 d-flex gap-2 align-items-center flex-wrap">
                <button class="btn btn-primary" type="submit" [disabled]="occupe()">Créer le bien</button>
                <button class="btn btn-outline-secondary" type="button" (click)="formulaire.set(false)">Annuler</button>
                <span class="text-body-secondary small">
                  La structure choisie détermine les règles de vote et de répartition du bien.
                </span>
              </div>
            </form>
          </div>
        </section>
      }

      <div class="d-flex flex-column gap-3">
        @for (b of etat.biens(); track b.id) {
          <section class="card">
            <div class="card-body d-flex flex-wrap gap-4 align-items-start">
              <div class="flex-grow-1" style="min-width:260px">
                <h2 class="h5 card-title mb-1">{{ b.nom }}</h2>
                <p class="text-body-secondary small mb-2">
                  {{ b.commune }} · {{ b.couchages }} couchages · {{ b.locationActivee ? 'louée en saison' : 'non louée' }}
                </p>
                <div class="d-flex gap-2 flex-wrap">
                  <span class="badge rounded-pill text-bg-light border fw-medium">{{ b.structureNom }}</span>
                  <span class="badge rounded-pill text-bg-light border fw-normal">{{ detenteurs(b) }}</span>
                  <span class="badge rounded-pill text-bg-light border fw-normal">
                    {{ b.role === 'gerant' ? 'Vous gérez ce bien' : roleLisible(b.role) }}
                  </span>
                </div>
              </div>
              <div class="d-flex flex-column gap-2 align-items-start" style="min-width:190px">
                @if (retrait() === b.id) {
                  <div class="alert alert-primary mb-0 p-3">
                    <p class="small mb-3">
                      <strong>Retirer ce bien l'archive, cela n'efface rien.</strong>
                      Les séjours, les documents et l'historique restent consultables en lecture seule,
                      et vous pouvez le réactiver à tout moment. Pour supprimer définitivement, exportez
                      d'abord l'instance depuis l'Administration, section Données.
                    </p>
                    <div class="d-flex gap-2">
                      <button class="btn btn-sm btn-primary flex-fill" (click)="archiver(b, true)"
                              [disabled]="occupe()">Retirer</button>
                      <button class="btn btn-sm btn-outline-secondary flex-fill" (click)="retrait.set(null)">Garder</button>
                    </div>
                  </div>
                } @else {
                  <button class="btn btn-sm btn-outline-secondary" (click)="ouvrir(b)">
                    <i class="bi bi-box-arrow-in-right me-1"></i>Ouvrir le dossier
                  </button>
                  @if (b.role === 'gerant') {
                    <button class="btn btn-sm btn-link text-body-secondary p-0" (click)="retrait.set(b.id)">
                      Retirer ce bien
                    </button>
                  }
                }
              </div>
            </div>
          </section>
        } @empty {
          <div class="card">
            <div class="card-body">
              <p class="text-body-secondary small mb-0">Aucun bien pour l'instant. Ajoutez le premier.</p>
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class Biens {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  readonly modes = MODES;

  readonly formulaire = signal(false);
  readonly retrait = signal<number | null>(null);
  readonly occupe = signal(false);
  readonly erreur = signal('');

  f = {
    structureMode: 'indivision' as string, structureNom: '', nom: '', commune: '',
    type: 'mer', couchages: 6, locationActivee: false,
  };

  /**
   * « 3 indivisaires », « 2 associés ». Le mode se lit déjà dans le nom de la
   * structure : le répéter en puce n'apprenait rien.
   */
  detenteurs(b: BienResume): string {
    const qui = b.structureMode === 'sci' ? 'associé' : b.structureMode === 'nom_propre' ? 'propriétaire' : 'indivisaire';
    return b.detenteurs ? `${b.detenteurs} ${qui}${b.detenteurs > 1 ? 's' : ''}` : `Aucun ${qui} saisi`;
  }

  roleLisible(role: string): string {
    return role === 'detenteur' ? 'Vous détenez des parts' : role === 'membre_foyer' ? 'Membre de foyer' : 'Invité';
  }

  ouvrir(b: BienResume): void {
    this.etat.poserContexte(b.id);
    void this.router.navigate(['/']);
  }

  async creer(): Promise<void> {
    await this.agir(async () => {
      await this.api.post('/biens', { ...this.f, couchages: Number(this.f.couchages) });
      this.formulaire.set(false);
      this.f = { structureMode: 'indivision', structureNom: '', nom: '', commune: '', type: 'mer', couchages: 6, locationActivee: false };
      await this.etat.rafraichir();
    });
  }

  async archiver(b: BienResume, archiver: boolean): Promise<void> {
    await this.agir(async () => {
      await this.api.post(`/biens/${b.id}/archivage`, { archiver });
      this.retrait.set(null);
      await this.etat.rafraichir();
    });
  }

  private async agir(action: () => Promise<void>): Promise<void> {
    if (this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    try { await action(); }
    catch (e) { this.erreur.set(e instanceof ErreurAppel ? e.message : "L'action a échoué."); }
    finally { this.occupe.set(false); }
  }
}
