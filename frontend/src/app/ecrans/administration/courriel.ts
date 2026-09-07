// Le courriel : ce qui est configuré, ce qui attend, et pourquoi ça n'part pas.
//
// Les réglages du relais vivent dans le registre, comme tous les autres ; ce
// qu'on trouve ici, c'est **l'état**, que seul le serveur connaît. Les deux
// étaient dans deux écrans différents, si bien qu'on lisait « 15 en attente »
// sans pouvoir toucher au relais, et qu'on réglait le relais sans savoir si
// quelque chose partait.
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { horodatageLisible } from '../../core/format';
import type { Etat as EtatModele } from '../../core/modeles';

@Component({
  selector: 'app-administration-courriel',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    pre {
      background: var(--bs-tertiary-bg); border-radius: var(--bs-border-radius);
      padding: 12px 14px; font-size: .78rem; overflow-x: auto; margin: .5rem 0 0;
    }
  `],
  template: `
    <div class="d-flex flex-column gap-3">
      @if (etat(); as e) {
        <section class="card">
          <div class="card-body">
            <div class="eyebrow mb-2">Le relais</div>
            <ul class="list-group list-group-flush">
              <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                <span class="text-body-secondary">Relais SMTP</span>
                <span class="fw-medium text-end">{{ e.courriel.relais || 'aucun' }}</span>
              </li>
              <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                <span class="text-body-secondary">Expéditeur</span>
                <span class="fw-medium text-end">{{ e.courriel.adresseExpediteur || 'Non renseigné' }}</span>
              </li>
              <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                <span class="text-body-secondary">Adresse publique</span>
                <span class="fw-medium text-end">{{ e.courriel.adressePublique || 'Non renseignée' }}</span>
              </li>
            </ul>

            @if (!e.courriel.relais) {
              <div class="alert alert-primary mt-3 mb-0 small">
                <strong>Aucun relais n'est configuré : les notifications s'accumulent sans partir.</strong>
                Ces trois valeurs viennent du fichier d'environnement, pas des réglages : elles
                contiennent un mot de passe, qui n'a rien à faire dans une base ni dans un écran.
                Définissez <code>MDF_SMTP_HOST</code>, <code>MDF_SMTP_FROM</code> et
                <code>MDF_PUBLIC_URL</code> dans <code>/etc/maison-de-famille/mdf.env</code>, puis
                <code>systemctl restart maison-de-famille</code>.
              </div>
            }
            <p class="text-body-secondary small mt-3 mb-0">
              Ce qui s'envoie, et après combien d'essais, se règle dans
              <a routerLink="/administration/reglages" fragment="courriel">Réglages, section Courriel</a>.
            </p>
          </div>
        </section>

        <section class="card">
          <div class="card-body">
            <div class="eyebrow mb-2">La file d'envoi</div>
            <div class="d-flex flex-wrap gap-4">
              <div>
                <div class="text-body-secondary small">En attente</div>
                <div class="fs-4 fw-medium tnum card-title mb-0"
                     [class.text-primary]="e.courriel.file.enAttente > 0">{{ e.courriel.file.enAttente }}</div>
              </div>
              <div>
                <div class="text-body-secondary small">Abandonnées</div>
                <div class="fs-4 fw-medium tnum card-title mb-0"
                     [class.text-primary]="e.courriel.file.abandonnees > 0">{{ e.courriel.file.abandonnees }}</div>
              </div>
              <div>
                <div class="text-body-secondary small">Envoyées (24 h)</div>
                <div class="fs-4 fw-medium tnum card-title mb-0">{{ e.courriel.file.envoyees24h }}</div>
              </div>
            </div>
            <p class="text-body-secondary small mt-3 mb-0">
              Une notification abandonnée reste en file : elle repart dès que le relais fonctionne
              de nouveau. Rien ne se perd.
            </p>
          </div>
        </section>

        @if (e.courriel.file.dernieresErreurs.length) {
          <section class="card">
            <div class="card-body">
              <div class="eyebrow mb-2">Dernières erreurs du relais</div>
              <p class="text-body-secondary small">
                Le message est celui du serveur de courriel, mot pour mot. C'est presque toujours
                lui qui dit ce qui manque : une authentification, un port, un expéditeur refusé.
              </p>
              @for (x of e.courriel.file.dernieresErreurs; track x.cree) {
                <pre>{{ x.type }} · {{ horodatageLisible(x.cree) }}
{{ x.erreur }}</pre>
              }
            </div>
          </section>
        }
      } @else {
        <div class="card"><div class="card-body">
          <p class="text-body-secondary small mb-0">Chargement...</p>
        </div></div>
      }
    </div>
  `,
})
export class AdministrationCourriel {
  private readonly api = inject(Api);
  readonly etat = signal<EtatModele | null>(null);
  readonly horodatageLisible = horodatageLisible;

  constructor() {
    void this.api.get<EtatModele>('/etat').then((e) => this.etat.set(e)).catch(() => this.etat.set(null));
  }
}
