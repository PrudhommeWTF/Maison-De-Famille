// Les données : ce qui sort, ce qui est en base, et ce que les migrations ont
// fait.
//
// « Vous n'êtes prisonnier ni d'un tableur ni de cette application » est une
// promesse du projet : l'export est donc la première carte, et non un lien
// discret en pied de page.
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Api, ErreurAppel } from '../../core/api';
import { horodatageLisible } from '../../core/format';
import type { Etat as EtatModele } from '../../core/modeles';

@Component({
  selector: 'app-administration-donnees',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="d-flex flex-column gap-3">
      @if (erreur()) { <div class="alert alert-primary mb-0">{{ erreur() }}</div> }

    <section class="card">
      <div class="card-body">
        <h2 class="h5 card-title">Export</h2>
        <p class="text-body-secondary small">
          Vous n'êtes prisonnier ni d'un tableur ni de cette application. L'export complet contient la
          base et toutes les pièces jointes, et se restaure sur une instance vierge.
        </p>
        <div class="d-flex gap-2 flex-wrap">
          <button class="btn btn-outline-secondary" (click)="exporter('/export/sejours.csv')" [disabled]="occupe()">
            <i class="bi bi-filetype-csv me-1" aria-hidden="true"></i>Séjours en CSV
          </button>
          <button class="btn btn-outline-secondary" (click)="exporter('/export/instance.tar.gz')"
                  [disabled]="occupe()">
            <i class="bi bi-box-arrow-down me-1" aria-hidden="true"></i>Export complet de l'instance
          </button>
        </div>
      </div>
    </section>

      @if (etat(); as e) {
        <section class="card">
          <div class="card-body">
            <div class="eyebrow mb-2">Base de données</div>
            <ul class="list-group list-group-flush">
              <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                <span class="text-body-secondary">Répertoire de données</span>
                <span class="fw-medium text-end">{{ e.donnees.repertoire }}</span>
              </li>
              <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                <span class="text-body-secondary">Schéma</span>
                <span class="fw-medium tnum">{{ e.schema.applique }} / {{ e.schema.cible }}</span>
              </li>
              <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                <span class="text-body-secondary">Personnes</span>
                <span class="fw-medium tnum">{{ e.donnees.personnes }}</span>
              </li>
              <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                <span class="text-body-secondary">Biens</span>
                <span class="fw-medium tnum">{{ e.donnees.biens }}</span>
              </li>
              <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                <span class="text-body-secondary">Séjours</span>
                <span class="fw-medium tnum">{{ e.donnees.sejours }}</span>
              </li>
              <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                <span class="text-body-secondary">Fichiers</span>
                <span class="fw-medium tnum">{{ e.donnees.fichiers }}</span>
              </li>
              @if (e.donnees.orphelins.nombre) {
                <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                  <span class="text-body-secondary">Fichiers orphelins</span>
                  <span class="fw-medium tnum">
                    {{ e.donnees.orphelins.nombre }} ({{ ko(e.donnees.orphelins.octets) }})
                  </span>
                </li>
              }
            </ul>
            @if (e.donnees.orphelins.nombre) {
              <p class="text-body-secondary small mt-3 mb-0">
                Des fichiers traînent sur le disque sans qu'aucune ligne de la base ne les cite.
                Ils viennent d'un dépôt interrompu, et l'export complet ne les emporte pas.
              </p>
            }
          </div>
        </section>

        <section class="card">
          <div class="card-body">
            <div class="eyebrow mb-2">Migrations appliquées</div>
            <ul class="list-group list-group-flush">
              @for (m of e.schema.migrations; track m.version) {
                <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                  <span class="tnum">{{ m.version }} · {{ m.libelle }}</span>
                  <span class="text-body-secondary text-end" style="font-size:.72rem">
                    {{ horodatageLisible(m.appliqueLe) }} ({{ m.dureeMs }} ms)
                  </span>
                </li>
              }
            </ul>
          </div>
        </section>
      }
    </div>
  `,
})
export class AdministrationDonnees {
  private readonly api = inject(Api);
  readonly etat = signal<EtatModele | null>(null);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly horodatageLisible = horodatageLisible;

  constructor() {
    void this.api.get<EtatModele>('/etat').then((e) => this.etat.set(e)).catch(() => this.etat.set(null));
  }

  /** Des octets bruts ne disent rien à personne. */
  ko(octets: number): string {
    return octets > 1_048_576 ? `${Math.round(octets / 104_857.6) / 10} Mo` : `${Math.round(octets / 1024)} ko`;
  }

  async exporter(chemin: string): Promise<void> {
    this.occupe.set(true);
    this.erreur.set('');
    try {
      const { blob, nom } = await this.api.telecharger(chemin);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nom;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'export a échoué.");
    } finally {
      this.occupe.set(false);
    }
  }
}
