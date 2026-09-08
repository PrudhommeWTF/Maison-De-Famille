// Les vacances scolaires : la seule donnée de référence que l'application ne
// sait pas calculer.
//
// Les jours fériés se déduisent d'une règle, ces dates non : elles sont fixées
// par arrêté. Le service va donc chercher lui-même l'année qui manque sur le
// portail de l'Éducation nationale. Cet écran sert à voir ce qui est en base,
// d'où ça vient, et à reprendre la main : remplacer une année, ou déposer un
// fichier quand ce serveur ne sort pas sur Internet.
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Api, ErreurAppel } from '../../core/api';
import { COULEURS_ZONE, anneeScolaireDe } from '../../core/calendrier';
import type { AnneeVacances, ApercuVacances, ZoneVacances } from '../../core/calendrier';
import { aujourdhui, plage } from '../../core/format';

@Component({
  selector: 'app-administration-vacances',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="d-flex flex-column gap-3">
      @if (erreur()) { <div class="alert alert-primary mb-0">{{ erreur() }}</div> }
      @if (message()) { <div class="alert alert-success mb-0">{{ message() }}</div> }

      <!-- Les vacances scolaires sont la seule donnée de référence que
           l'application ne sait pas calculer : elle doit lui être donnée. -->
      <section class="card">
        <div class="card-body">
          <h2 class="h5 card-title">Vacances scolaires</h2>
          <p class="text-body-secondary small">
            Le calendrier fait ressortir les trois zones. Ces dates sont fixées par arrêté et ne se
            déduisent d'aucune règle. Le service les récupère tout seul sur data.education.gouv.fr
            quand une année manque, sans jamais toucher à une année déjà enregistrée : la colonne
            « Origine » dit, pour chacune, si elle est venue toute seule ou par un dépôt.
          </p>

          @if (anneeManquante()) {
            <div class="alert alert-primary small">
              L'année scolaire {{ anneeManquante() }} n'est pas renseignée. Le service réessaie
              toutes les six heures ; si elle ne vient pas, c'est que le portail ne la publie pas
              encore ou que ce serveur ne sort pas sur Internet. Le bouton ci-dessous force un
              essai, et le dépôt d'un fichier marche toujours.
            </div>
          }

          @if (annees().length) {
            <div class="table-responsive">
              <table class="table table-hover align-middle mb-0">
                <thead>
                  <tr class="eyebrow">
                    <th scope="col">Année scolaire</th><th scope="col">Périodes</th>
                    <th scope="col">Couvre</th><th scope="col">Origine</th>
                  </tr>
                </thead>
                <tbody>
                  @for (a of annees(); track a.anneeScolaire) {
                    <tr>
                      <td class="small fw-medium">{{ a.anneeScolaire }}</td>
                      <td class="small tnum">{{ a.periodes }}</td>
                      <td class="small text-body-secondary tnum">{{ plage(a.debut, a.fin) }}</td>
                      <td class="small text-body-secondary">
                        {{ a.source }}@if (a.importePar) {, déposé par {{ a.importePar }}}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }

          @if (!apercu()) {
            <div class="d-flex gap-2 flex-wrap align-items-center mt-3">
              <label class="btn btn-outline-secondary mb-0">
                <i class="bi bi-calendar-plus me-1" aria-hidden="true"></i>Déposer un calendrier
                <input type="file" accept=".xlsx,.xls,.csv,.txt,text/csv" hidden
                       [disabled]="occupe()" (change)="analyserCalendrier($event)">
              </label>
              <!-- Le rafraîchissement automatique n'ajoute que les années
                   absentes. Ce bouton fait la seule chose qu'il ne fera jamais :
                   rapporter une année déjà en base pour la remplacer. Il ne
                   remplit que l'aperçu, l'enregistrement reste un second clic. -->
              <button class="btn btn-outline-secondary" (click)="telechargerCalendrier()" [disabled]="occupe()">
                <i class="bi bi-cloud-arrow-down me-1" aria-hidden="true"></i>Récupérer maintenant
              </button>
            </div>
            <p class="text-body-secondary small mt-2 mb-0" style="max-width:620px">
              Le fichier attendu est le calendrier scolaire publié sur data.education.gouv.fr
              (jeu de données « fr-en-calendrier-scolaire », export CSV). Un tableau tenu à la main
              convient aussi, avec cinq colonnes : période, zone, début, fin, année scolaire.
              « Récupérer maintenant » va chercher le fichier officiel et vous le montre : rien
              n'est enregistré sans votre confirmation, y compris pour une année déjà connue.
            </p>
          } @else {
            <div class="border-top mt-4 pt-3">
              <div class="d-flex justify-content-between align-items-center gap-3 flex-wrap">
                <h3 class="h6 mb-0">Ce qui a été lu</h3>
                <button class="btn btn-sm btn-outline-secondary" (click)="apercu.set(null)"
                        [disabled]="occupe()">Annuler</button>
              </div>
              <p class="text-body-secondary small mt-2 mb-1">
                {{ apercu()!.source }} · {{ apercu()!.format }} · {{ apercu()!.lues }} lignes lues ·
                {{ apercu()!.periodes.length }} périodes retenues.
              </p>
              <!-- La borne de fin est le seul point où deux fichiers honnêtes
                   peuvent vouloir dire deux choses : on annonce ce qui a été
                   décidé plutôt que de le supposer en silence. -->
              <p class="text-body-secondary small mb-0">
                @if (apercu()!.finEstLaReprise) {
                  Les dates de fin ont été lues comme des jours de reprise des cours : le dernier
                  jour de vacances retenu est la veille.
                } @else {
                  Les dates de fin ont été lues comme le dernier jour de vacances, sans décalage.
                }
              </p>

              <ul class="list-unstyled d-flex flex-column gap-2 small mt-3">
                @for (a of apercu()!.annees; track a.anneeScolaire) {
                  <li>
                    <strong>{{ a.anneeScolaire }}</strong> : {{ a.periodes }} périodes
                    @if (apercu()!.deja.includes(a.anneeScolaire)) {
                      <span class="badge rounded-pill text-primary-emphasis bg-primary-subtle
                                   border border-primary-subtle">remplace l'existant</span>
                    } @else {
                      <span class="badge rounded-pill text-success-emphasis bg-success-subtle
                                   border border-success-subtle">nouvelle</span>
                    }
                  </li>
                }
              </ul>

              <ul class="list-group list-group-flush mt-2 overflow-auto" style="max-height:260px">
                @for (p of apercu()!.periodes; track $index) {
                  <li class="list-group-item d-flex align-items-center gap-3 px-0 py-1 small">
                    <span class="d-inline-block rounded-1 flex-shrink-0" style="width:10px;height:10px"
                          [style.background]="couleurZone(p.zone)" aria-hidden="true"></span>
                    <span style="min-width:120px">{{ p.nom }}</span>
                    <span class="text-body-secondary">zone {{ p.zone }}</span>
                    <span class="text-body-secondary tnum">{{ plage(p.debut, p.fin) }}</span>
                  </li>
                }
              </ul>

              @if (apercu()!.rejets.length) {
                <details class="mt-3">
                  <summary class="small" style="cursor:pointer">
                    {{ apercu()!.rejets.length }} lignes écartées, et pourquoi
                  </summary>
                  <ul class="list-group list-group-flush mt-2 overflow-auto" style="max-height:260px">
                    @for (r of apercu()!.rejets.slice(0, 40); track $index) {
                      <li class="list-group-item d-flex align-items-center gap-3 px-0 py-1 small">
                        <span class="text-body-secondary" style="min-width:80px">ligne {{ r.ligne }}</span>
                        <span>{{ r.raison }}</span>
                      </li>
                    }
                  </ul>
                  @if (apercu()!.rejets.length > 40) {
                    <p class="text-body-secondary small mt-2 mb-0">
                      Les {{ apercu()!.rejets.length - 40 }} autres suivent les mêmes raisons.
                    </p>
                  }
                </details>
              }

              <button class="btn btn-primary mt-3" (click)="enregistrerCalendrier()" [disabled]="occupe()">
                Enregistrer ces {{ apercu()!.periodes.length }} périodes
              </button>
            </div>
          }
        </div>
      </section>
    </div>
  `,
})
export class AdministrationVacances {
  private readonly api = inject(Api);

  readonly annees = signal<AnneeVacances[]>([]);
  readonly apercu = signal<ApercuVacances | null>(null);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');
  private nomFichier = '';

  plage = plage;
  couleurZone = (z: ZoneVacances): string => COULEURS_ZONE[z];

  /**
   * L'année scolaire en cours, si elle manque à l'appel.
   *
   * C'est la seule qui compte vraiment : une famille pose ses séjours pour
   * l'année qui vient, et un calendrier muet sur février est un piège.
   */
  readonly anneeManquante = computed(() => {
    const courante = anneeScolaireDe(aujourdhui());
    return this.annees().some((a) => a.anneeScolaire === courante) ? '' : courante;
  });

  constructor() { void this.chargerVacances(); }

  private async chargerVacances(): Promise<void> {
    const r = await this.api.get<{ annees: AnneeVacances[] }>('/calendrier/vacances').catch(() => ({ annees: [] }));
    this.annees.set(r.annees);
  }

  async analyserCalendrier(evt: Event): Promise<void> {
    const input = evt.target as HTMLInputElement;
    const fichier = input.files?.[0];
    if (!fichier || this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try {
      this.apercu.set(await this.api.deposer<ApercuVacances>('/calendrier/vacances/analyse', fichier));
      this.nomFichier = fichier.name.slice(0, 200);
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "Ce fichier n'a pas pu être lu.");
    } finally {
      // Sans cela, redéposer le même fichier après une correction ne
      // déclencherait aucun évènement et donnerait l'impression d'un bouton mort.
      input.value = '';
      this.occupe.set(false);
    }
  }

  async telechargerCalendrier(): Promise<void> {
    if (this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try {
      this.apercu.set(await this.api.post<ApercuVacances>('/calendrier/vacances/telechargement', {}));
      this.nomFichier = 'data.education.gouv.fr';
    } catch (e) {
      // Le serveur dit déjà quoi faire (portail muet, sortie réseau fermée) :
      // le remplacer ferait perdre la seule information utile.
      this.erreur.set(e instanceof ErreurAppel ? e.message : 'Le téléchargement a échoué.');
    } finally {
      this.occupe.set(false);
    }
  }

  async enregistrerCalendrier(): Promise<void> {
    const a = this.apercu();
    if (!a || this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    try {
      const r = await this.api.post<{ annees: string[]; ecrites: number }>(
        '/calendrier/vacances', { periodes: a.periodes, source: this.nomFichier });
      this.message.set(`${r.ecrites} périodes enregistrées pour ${r.annees.join(', ')}.`);
      this.apercu.set(null);
      await this.chargerVacances();
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'enregistrement a échoué.");
    } finally {
      this.occupe.set(false);
    }
  }
}
