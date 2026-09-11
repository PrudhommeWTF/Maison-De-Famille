// L'import du planning existant, en trois temps.
//
// « Sans reprise de l'existant, ma mère ne basculera pas. » Cet écran est donc
// jugé sur un seul critère : **elle doit voir ce qui va se passer avant que cela
// se passe**, et pouvoir défaire.
//
//   1. Le fichier est déposé et reconnu. Les colonnes sont proposées.
//   2. La simulation dit ce qui sera créé, ce qui est déjà là, et **quelles
//      lignes sont refusées et pourquoi**. Rien n'est écrit.
//   3. L'import s'exécute, et reste annulable en bloc.
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import { horodatageLisible, plage } from '../core/format';
import type { AnalyseImport, RapportImport } from '../core/modeles';

interface LigneHistorique {
  id: number; sourceNom: string; importeLe: string; importePar: string | null;
  lues: number; creees: number; ignorees: number; refusees: number; annuleLe: string | null;
}

@Component({
  selector: 'app-import',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    /* La zone de dépôt en tirets, et la ligne d'intitulés du fichier mise en
       relief : ni l'une ni l'autre n'a d'utilitaire Bootstrap. */
    .depot { border-style: dashed !important; cursor: pointer; }
    .depot:hover { border-color: var(--bs-primary) !important; }
    tr.entete-fichier td { background: var(--bs-tertiary-bg); font-weight: 600; }
  `],
  template: `
    <div class="d-flex flex-column gap-4">
      <div>
        <h1 class="h2 mb-2">Import du planning</h1>
        <p class="text-body-secondary mb-0">
          Reprenez le calendrier existant de {{ etat.bien()?.nom }} : un fichier Excel (.xlsx) ou un
          export CSV. Rien n'est écrit avant que vous ayez vu le rapport.
        </p>
      </div>

      @if (erreur()) { <div class="alert alert-primary mb-0">{{ erreur() }}</div> }
      @if (message()) { <div class="alert alert-success mb-0">{{ message() }}</div> }

      @if (!analyse()) {
        <section class="card">
          <div class="card-body">
            <label class="depot d-block border rounded-3 text-center text-body-secondary p-5">
              <i class="bi bi-filetype-xlsx d-block fs-2 mb-2 text-primary" aria-hidden="true"></i>
              <strong>Choisir le fichier du planning</strong>
              <span class="d-block small mt-2">
                .xlsx, .csv, ou un .xls exporté depuis un tableur. Le format est reconnu automatiquement.
              </span>
              <input type="file" accept=".xlsx,.xls,.csv,.txt,text/csv" (change)="analyser($event)" hidden>
            </label>
          </div>
        </section>
      } @else {
        <section class="card">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap">
              <div>
                <h2 class="h5 card-title mb-1">{{ analyse()!.nom }}</h2>
                <p class="text-body-secondary small mb-0">
                  {{ analyse()!.format }}{{ analyse()!.encodage ? ' · ' + analyse()!.encodage : '' }} ·
                  {{ analyse()!.lignes.length }} lignes lues
                </p>
              </div>
              <button class="btn btn-sm btn-outline-secondary" (click)="recommencer()">
                Choisir un autre fichier
              </button>
            </div>

            <h3 class="h6 mt-4">1. À quoi correspond chaque colonne ?</h3>
            <p class="text-body-secondary small">
              La proposition vient des intitulés de votre fichier. Corrigez ce qui ne va pas.
            </p>
            <div class="row row-cols-1 row-cols-md-2 row-cols-xl-3 g-3">
              @for (c of analyse()!.champs; track c.champ) {
                <div class="col">
                  <label class="form-label small text-body-secondary" [attr.for]="'c-' + c.champ">
                    {{ c.libelle }}@if (c.obligatoire) { <span class="text-primary"> *</span> }
                  </label>
                  <select class="form-select" [attr.id]="'c-' + c.champ" [(ngModel)]="correspondance[c.champ]"
                          [name]="'c-' + c.champ" (ngModelChange)="simuler()">
                    <option [ngValue]="-1">Aucune colonne</option>
                    @for (e of analyse()!.entetes; track $index) {
                      <option [ngValue]="$index">{{ e || 'colonne ' + ($index + 1) }}</option>
                    }
                  </select>
                </div>
              }
              <div class="col">
                <!-- Plus de menu déroulant : l'écran vit sous un bien, et c'est
                     celui-là qu'on alimente. Se tromper de bien dans une liste
                     et s'en apercevoir après coup coûtait une annulation
                     d'import. La colonne « bien » du fichier, elle, continue de
                     valoir : un planning qui nomme ses maisons reste importable
                     d'un coup. -->
                <label class="form-label small text-body-secondary">Bien par défaut</label>
                <div class="form-control-plaintext fw-medium">{{ etat.bien()?.nom }}</div>
                <div class="form-text">
                  Pour les lignes sans colonne « bien ». Les autres suivent ce que dit le fichier.
                </div>
              </div>
              <div class="col">
                <label class="form-label small text-body-secondary" for="c-entete">Ligne des intitulés</label>
                <input class="form-control" id="c-entete" name="ligneEntete" type="number" min="1"
                       [ngModel]="ligneEntete() + 1" (ngModelChange)="changerEntete($event)">
              </div>
            </div>

            <h3 class="h6 mt-4">2. Ce que le fichier contient</h3>
            <div class="table-responsive">
              <table class="table table-sm align-middle mb-0" style="white-space:nowrap">
                <tbody>
                  @for (l of apercu(); track $index) {
                    <tr [class.entete-fichier]="$index === ligneEntete()">
                      <td class="text-body-secondary tnum" style="font-size:.72rem">{{ $index + 1 }}</td>
                      @for (c of l; track $index) { <td class="small">{{ c }}</td> }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </section>

        @if (rapport(); as r) {
          <section class="card">
            <div class="card-body">
              <h2 class="h5 card-title">3. Ce qui va se passer</h2>
              <div class="d-flex gap-4 flex-wrap mb-3">
                <div>
                  <div class="fs-4 fw-medium tnum card-title mb-0">{{ r.aCreer.length }}</div>
                  <div class="text-body-secondary small">à créer</div>
                </div>
                <div>
                  <div class="fs-4 fw-medium tnum card-title mb-0">{{ r.doublons.length }}</div>
                  <div class="text-body-secondary small">déjà présents</div>
                </div>
                <div>
                  <div class="fs-4 fw-medium tnum card-title mb-0">{{ r.refusees.length }}</div>
                  <div class="text-body-secondary small">refusés</div>
                </div>
              </div>

              @if (r.refusees.length) {
                <div class="alert alert-primary small">
                  <strong>Ces lignes ne seront pas importées.</strong> Corrigez-les dans votre tableur et
                  relancez l'import : les lignes déjà créées ne seront pas dupliquées.
                  <div class="mt-2">
                    @for (x of r.refusees; track x.numero) {
                      <div>Ligne {{ x.numero }} : {{ x.raison }}</div>
                    }
                  </div>
                </div>
              }

              @if (r.aCreer.length) {
                <div class="table-responsive">
                  <table class="table table-hover align-middle mb-0" style="white-space:nowrap">
                    <thead>
                      <tr class="eyebrow">
                        <th scope="col">Ligne</th><th scope="col">Dates</th><th scope="col">Qui</th>
                        <th scope="col">Personnes</th><th scope="col">Nature</th><th scope="col">Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (l of r.aCreer; track l.numero) {
                        <tr>
                          <td class="text-body-secondary tnum" style="font-size:.72rem">{{ l.numero }}</td>
                          <td class="small tnum">{{ plage(l.arrivee, l.depart) }}</td>
                          <td class="small fw-medium">{{ l.titre }}</td>
                          <td class="small tnum">{{ l.occupants }}</td>
                          <td class="small text-body-secondary">{{ natureLisible(l.nature) }}</td>
                          <td class="small text-body-secondary">
                            {{ l.statut === 'valide' ? 'Validé' : 'En attente' }}
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }

              <div class="d-flex gap-2 flex-wrap mt-3">
                <button class="btn btn-primary" (click)="executer()" [disabled]="occupe() || !r.aCreer.length">
                  Importer {{ r.aCreer.length }} séjour(s)
                </button>
                <button class="btn btn-outline-secondary" (click)="recommencer()">Annuler</button>
              </div>
            </div>
          </section>
        }
      }

      @if (historique().length) {
        <section class="card">
          <div class="card-body">
            <div class="eyebrow mb-2">Imports précédents</div>
            <ul class="list-group list-group-flush">
              @for (h of historique(); track h.id) {
                <li class="list-group-item d-flex align-items-center gap-3 px-0">
                  <span class="flex-grow-1" style="min-width:0">
                    <span class="d-block small fw-medium">{{ h.sourceNom }}</span>
                    <span class="d-block text-body-secondary" style="font-size:.72rem">
                      {{ horodatageLisible(h.importeLe) }}{{ h.importePar ? ' par ' + h.importePar : '' }} ·
                      {{ h.creees }} créés, {{ h.ignorees }} déjà présents, {{ h.refusees }} refusés
                    </span>
                  </span>
                  @if (h.annuleLe) {
                    <span class="badge rounded-pill text-bg-light border">annulé</span>
                  } @else {
                    <button class="btn btn-sm btn-link text-body-secondary p-0"
                            (click)="annuler(h)">Annuler cet import</button>
                  }
                </li>
              }
            </ul>
            <p class="text-body-secondary small mt-3 mb-0">
              Annuler archive les séjours importés : ils sortent du calendrier, rien n'est effacé.
            </p>
          </div>
        </section>
      }
    </div>
  `,
})
export class Import {
  private readonly api = inject(Api);
  readonly etat = inject(Etat);
  readonly plage = plage;
  readonly horodatageLisible = horodatageLisible;

  readonly analyse = signal<AnalyseImport | null>(null);
  readonly rapport = signal<RapportImport | null>(null);
  readonly historique = signal<LigneHistorique[]>([]);
  readonly ligneEntete = signal(0);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  correspondance: Record<string, number> = {};
  bienParDefaut = 0;

  /** Les vingt premières lignes : de quoi reconnaître son fichier sans tout charger à l'écran. */
  readonly apercu = computed(() => (this.analyse()?.lignes ?? []).slice(0, 20));

  constructor() { void this.chargerHistorique(); }

  private async chargerHistorique(): Promise<void> {
    this.historique.set(await this.api.get<LigneHistorique[]>('/import').catch(() => []));
  }

  async analyser(evt: Event): Promise<void> {
    const fichier = (evt.target as HTMLInputElement).files?.[0];
    if (!fichier) return;
    await this.agir(async () => {
      const a = await this.api.televerser<AnalyseImport>('/import/analyse', fichier);
      this.analyse.set(a);
      this.ligneEntete.set(a.ligneEntete);
      this.correspondance = { ...a.correspondance };
      // Le bien ouvert, et rien d'autre : l'écran vit sous lui.
      this.bienParDefaut = this.etat.bien()?.id ?? a.biens[0]?.id ?? 0;
      await this.simuler();
    });
  }

  changerEntete(valeur: number): void {
    const n = Math.max(1, Number(valeur) || 1) - 1;
    this.ligneEntete.set(n);
    void this.simuler();
  }

  private options(): Record<string, unknown> {
    const a = this.analyse();
    return {
      lignes: a?.lignes ?? [], ligneEntete: this.ligneEntete(),
      correspondance: this.correspondance, bienParDefaut: Number(this.bienParDefaut),
      sha: a?.sha ?? '', nom: a?.nom ?? 'planning',
    };
  }

  async simuler(): Promise<void> {
    if (!this.analyse() || !this.bienParDefaut) return;
    try {
      this.rapport.set(await this.api.post<RapportImport>('/import/simulation', this.options()));
      this.erreur.set('');
    } catch (e) {
      this.rapport.set(null);
      this.erreur.set(e instanceof ErreurAppel ? e.message : 'La simulation a échoué.');
    }
  }

  async executer(): Promise<void> {
    await this.agir(async () => {
      const r = await this.api.post<{ creees: number }>('/import/execution', this.options());
      this.message.set(`${r.creees} séjour(s) importé(s). Vérifiez le calendrier : tout est annulable en bloc ci-dessous.`);
      this.recommencer();
      await this.chargerHistorique();
      await this.etat.rafraichir();
    });
  }

  async annuler(h: LigneHistorique): Promise<void> {
    await this.agir(async () => {
      const r = await this.api.post<{ archives: number }>(`/import/${h.id}/annulation`);
      this.message.set(`${r.archives} séjour(s) archivé(s). Rien n'a été supprimé.`);
      await this.chargerHistorique();
      await this.etat.rafraichir();
    });
  }

  recommencer(): void {
    this.analyse.set(null);
    this.rapport.set(null);
    this.erreur.set('');
  }

  natureLisible(n: string): string {
    return n === 'location' ? 'Location' : n === 'entretien' ? 'Entretien' : 'Famille';
  }

  private async agir(action: () => Promise<void>): Promise<void> {
    if (this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try { await action(); }
    catch (e) { this.erreur.set(e instanceof ErreurAppel ? e.message : "L'opération a échoué."); }
    finally { this.occupe.set(false); }
  }
}
