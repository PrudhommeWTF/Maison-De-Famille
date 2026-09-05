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
    .depot {
      border: 1.5px dashed var(--bordure-controle); border-radius: 14px; padding: 30px 20px;
      text-align: center; color: var(--encre-3);
    }
    .depot i { font-size: 26px; display: block; margin-bottom: 10px; color: var(--accent); }
    table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
    th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--separateur); white-space: nowrap; }
    th { font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em; color: var(--libelle-section); }
    tr.entete-fichier td { background: var(--pastille-neutre); font-weight: 600; }
    .corr { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .compteurs { display: flex; gap: 26px; flex-wrap: wrap; margin: 4px 0 14px; }
    .compteurs .valeur { font-family: var(--titre); font-size: 22px; font-weight: 500; }
    .compteurs .quoi { font-size: 11.5px; color: var(--encre-3); }
  `],
  template: `
    <div class="colonne">
      <div>
        <h1>Import du planning</h1>
        <p class="secondaire" style="margin:6px 0 0">
          Reprenez le calendrier existant : un fichier Excel (.xlsx) ou un export CSV. Rien n'est
          écrit avant que vous ayez vu le rapport.
        </p>
      </div>

      @if (erreur()) { <div class="encart">{{ erreur() }}</div> }
      @if (message()) { <div class="encart-positif">{{ message() }}</div> }

      @if (!analyse()) {
        <section class="carte">
          <label class="depot" style="display:block;cursor:pointer">
            <i class="bi bi-filetype-xlsx" aria-hidden="true"></i>
            <strong>Choisir le fichier du planning</strong>
            <div class="meta" style="margin-top:6px">
              .xlsx, .csv, ou un .xls exporté depuis un tableur. Le format est reconnu automatiquement.
            </div>
            <input type="file" accept=".xlsx,.xls,.csv,.txt,text/csv" (change)="analyser($event)" style="display:none">
          </label>
        </section>
      } @else {
        <section class="carte">
          <div class="entre">
            <div>
              <h2>{{ analyse()!.nom }}</h2>
              <p class="meta" style="margin:4px 0 0">
                {{ analyse()!.format }}{{ analyse()!.encodage ? ' · ' + analyse()!.encodage : '' }} ·
                {{ analyse()!.lignes.length }} lignes lues
              </p>
            </div>
            <button class="btn" (click)="recommencer()">Choisir un autre fichier</button>
          </div>

          <h3 style="margin-top:18px">1. À quoi correspond chaque colonne ?</h3>
          <p class="secondaire" style="margin:4px 0 12px">
            La proposition vient des intitulés de votre fichier. Corrigez ce qui ne va pas.
          </p>
          <div class="corr">
            @for (c of analyse()!.champs; track c.champ) {
              <div class="champ" style="margin:0">
                <label [attr.for]="'c-' + c.champ">
                  {{ c.libelle }}@if (c.obligatoire) { <span style="color:var(--accent)"> *</span> }
                </label>
                <select [attr.id]="'c-' + c.champ" [(ngModel)]="correspondance[c.champ]" [name]="'c-' + c.champ"
                        (ngModelChange)="simuler()">
                  <option [ngValue]="-1">— aucune —</option>
                  @for (e of analyse()!.entetes; track $index) {
                    <option [ngValue]="$index">{{ e || 'colonne ' + ($index + 1) }}</option>
                  }
                </select>
              </div>
            }
            <div class="champ" style="margin:0">
              <label for="c-bien">Bien par défaut</label>
              <select id="c-bien" name="bienParDefaut" [(ngModel)]="bienParDefaut" (ngModelChange)="simuler()">
                @for (b of analyse()!.biens; track b.id) { <option [ngValue]="b.id">{{ b.nom }}</option> }
              </select>
              <p class="meta" style="margin-top:4px">Utilisé pour les lignes sans colonne « bien ».</p>
            </div>
            <div class="champ" style="margin:0">
              <label for="c-entete">Ligne des intitulés</label>
              <input id="c-entete" name="ligneEntete" type="number" min="1"
                     [ngModel]="ligneEntete() + 1" (ngModelChange)="changerEntete($event)">
            </div>
          </div>

          <h3 style="margin-top:18px">2. Ce que le fichier contient</h3>
          <div class="defile-x" style="margin-top:8px">
            <table>
              <tbody>
                @for (l of apercu(); track $index) {
                  <tr [class.entete-fichier]="$index === ligneEntete()">
                    <td class="meta chiffres">{{ $index + 1 }}</td>
                    @for (c of l; track $index) { <td>{{ c }}</td> }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        @if (rapport(); as r) {
          <section class="carte">
            <h2>3. Ce qui va se passer</h2>
            <div class="compteurs">
              <div><div class="valeur chiffres">{{ r.aCreer.length }}</div><div class="quoi">à créer</div></div>
              <div><div class="valeur chiffres">{{ r.doublons.length }}</div><div class="quoi">déjà présents</div></div>
              <div><div class="valeur chiffres">{{ r.refusees.length }}</div><div class="quoi">refusés</div></div>
            </div>

            @if (r.refusees.length) {
              <div class="encart">
                <strong>Ces lignes ne seront pas importées.</strong> Corrigez-les dans votre tableur et
                relancez l'import : les lignes déjà créées ne seront pas dupliquées.
                <div style="margin-top:8px">
                  @for (x of r.refusees; track x.numero) {
                    <div>Ligne {{ x.numero }} : {{ x.raison }}</div>
                  }
                </div>
              </div>
            }

            @if (r.aCreer.length) {
              <div class="defile-x" style="margin-top:14px">
                <table>
                  <thead><tr><th>Ligne</th><th>Dates</th><th>Qui</th><th>Personnes</th><th>Nature</th><th>Statut</th></tr></thead>
                  <tbody>
                    @for (l of r.aCreer; track l.numero) {
                      <tr>
                        <td class="meta chiffres">{{ l.numero }}</td>
                        <td class="chiffres">{{ plage(l.arrivee, l.depart) }}</td>
                        <td>{{ l.titre }}</td>
                        <td class="chiffres">{{ l.occupants }}</td>
                        <td>{{ natureLisible(l.nature) }}</td>
                        <td>{{ l.statut === 'valide' ? 'Validé' : 'En attente' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }

            <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
              <button class="btn btn-primaire" (click)="executer()" [disabled]="occupe() || !r.aCreer.length">
                Importer {{ r.aCreer.length }} séjour(s)
              </button>
              <button class="btn" (click)="recommencer()">Annuler</button>
            </div>
          </section>
        }
      }

      @if (historique().length) {
        <section class="carte">
          <h2>Imports précédents</h2>
          <div style="margin-top:8px">
            @for (h of historique(); track h.id) {
              <div class="ligne">
                <span style="flex:1;min-width:0">
                  <span style="display:block">{{ h.sourceNom }}</span>
                  <span class="meta">
                    {{ horodatageLisible(h.importeLe) }}{{ h.importePar ? ' par ' + h.importePar : '' }} ·
                    {{ h.creees }} créés, {{ h.ignorees }} déjà présents, {{ h.refusees }} refusés
                  </span>
                </span>
                @if (h.annuleLe) {
                  <span class="pastille">annulé</span>
                } @else {
                  <button class="btn-lien" (click)="annuler(h)">Annuler cet import</button>
                }
              </div>
            }
          </div>
          <p class="meta" style="margin-top:12px">
            Annuler archive les séjours importés : ils sortent du calendrier, rien n'est effacé.
          </p>
        </section>
      }
    </div>
  `,
})
export class Import {
  private readonly api = inject(Api);
  private readonly etat = inject(Etat);
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
      this.bienParDefaut = a.biens.find((b) => b.id === this.etat.bien()?.id)?.id ?? a.biens[0]?.id ?? 0;
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
