// Dépenses et répartition.
//
// L'écran porte l'exigence de transparence : **chaque montant doit pouvoir être
// expliqué en un clic**. Cliquer une ligne ouvre le détail du calcul, tel qu'il
// a été figé à la saisie, et il se lit à voix haute devant quelqu'un qui
// conteste. C'est de l'argent entre frères et soeurs.
//
// La pastille de règle cycle entre les trois répartitions, comme dans la
// maquette. Elle **n'écrase rien** : elle ouvre une nouvelle période à partir
// d'aujourd'hui, et les dépenses déjà saisies gardent leur ventilation.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import { aujourdhui, dateCourte, dateLongue, euros } from '../core/format';
import type { Categorie, Depense, DetailDepense, ListeDepenses, Personne, Regle, RegleLigne } from '../core/modeles';

const SUIVANTE: Record<Regle, Regle> = {
  quotes_parts: 'nuits',
  nuits: 'parts_egales_foyer',
  parts_egales_foyer: 'quotes_parts',
};

const LIBELLE: Record<Regle, string> = {
  quotes_parts: 'Quotes-parts',
  nuits: 'Nuits occupées',
  parts_egales_foyer: 'Parts égales par foyer',
};

@Component({
  selector: 'app-depenses',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="d-flex flex-column gap-4">
      <div class="d-flex justify-content-between align-items-end gap-3 flex-wrap">
        <div>
          <h1 class="h2 mb-2">Dépenses &amp; répartition</h1>
          <p class="text-body-secondary mb-0">{{ etat.bien()?.nom }} · exercice {{ annee() }}</p>
        </div>
        <div class="d-flex gap-2 flex-wrap">
          <button class="btn btn-outline-secondary" (click)="changerAnnee(-1)">{{ annee() - 1 }}</button>
          <button class="btn btn-outline-secondary" (click)="changerAnnee(1)">{{ annee() + 1 }}</button>
          @if (etat.estGeranteIci()) {
            <button class="btn btn-primary" (click)="ouvrirSaisie()">
              <i class="bi bi-plus-circle me-1" aria-hidden="true"></i>Saisir une dépense
            </button>
          }
        </div>
      </div>

      @if (erreur()) { <div class="alert alert-primary mb-0">{{ erreur() }}</div> }
      @if (message()) { <div class="alert alert-success mb-0">{{ message() }}</div> }

      @if (saisie()) {
        <section class="card">
          <div class="card-body">
            <h2 class="h5 card-title">Saisir une dépense</h2>
            <p class="text-body-secondary small">
              La répartition est calculée à l'enregistrement, avec les
              {{ etat.vocabulaire().parts }} en vigueur à la date de la dépense, puis
              <strong>figée</strong>. Un changement de parts ultérieur ne la modifiera pas.
            </p>
            <form class="row g-3" (ngSubmit)="enregistrer()">
              <div class="col-12 col-md-3">
                <label class="form-label small text-body-secondary" for="d-date">Date de la dépense</label>
                <input class="form-control" id="d-date" name="dateDepense" type="date"
                       [(ngModel)]="f.dateDepense" required>
              </div>
              <div class="col-12 col-md-3">
                <label class="form-label small text-body-secondary" for="d-montant">Montant en euros</label>
                <input class="form-control" id="d-montant" name="montant" type="text" inputmode="decimal"
                       [(ngModel)]="f.montant" placeholder="2340,00" required>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label small text-body-secondary" for="d-libelle">Libellé</label>
                <input class="form-control" id="d-libelle" name="libelle" [(ngModel)]="f.libelle"
                       placeholder="Taxe foncière 2026" required>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label small text-body-secondary" for="d-cat">Catégorie</label>
                <select class="form-select" id="d-cat" name="categorieId" [(ngModel)]="f.categorieId">
                  @for (c of categories(); track c.id) { <option [ngValue]="c.id">{{ c.libelle }}</option> }
                </select>
                <div class="form-text">Règle appliquée : {{ regleDe(f.categorieId) }}</div>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label small text-body-secondary" for="d-paye">Payée par</label>
                <select class="form-select" id="d-paye" name="payePar" [(ngModel)]="f.payePar">
                  <option value="structure">Le compte commun</option>
                  <option value="personne">Une personne, qui a avancé</option>
                </select>
              </div>
              @if (f.payePar === 'personne') {
                <div class="col-12 col-md-6">
                  <label class="form-label small text-body-secondary" for="d-avance">Qui a avancé</label>
                  <select class="form-select" id="d-avance" name="avanceParId" [(ngModel)]="f.avanceParId">
                    <option [ngValue]="0">Choisir...</option>
                    @for (p of personnes(); track p.id) { <option [ngValue]="p.id">{{ p.nom }}</option> }
                  </select>
                </div>
              }
              <div class="col-12 col-md-6">
                <label class="form-label small text-body-secondary" for="d-just">Justificatif (photo ou PDF)</label>
                @if (justificatif()) {
                  <div class="alert alert-success mb-0 py-2 px-3 small">{{ justificatif()!.nom }} joint.</div>
                } @else {
                  <input class="form-control" id="d-just" type="file" accept="image/*,application/pdf"
                         (change)="joindre($event)">
                }
              </div>
              <div class="col-12">
                <label class="form-label small text-body-secondary" for="d-note">Note</label>
                <textarea class="form-control" id="d-note" name="note" rows="2"
                          [(ngModel)]="f.note" maxlength="1000"></textarea>
              </div>
              <div class="col-12 d-flex gap-2 flex-wrap">
                <button class="btn btn-primary" type="submit" [disabled]="occupe()">Enregistrer</button>
                <button class="btn btn-outline-secondary" type="button" (click)="saisie.set(false)">Annuler</button>
              </div>
            </form>
          </div>
        </section>
      }

      <section class="card">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-center gap-3 flex-wrap mb-2">
            <div class="eyebrow">Dépenses {{ annee() }} · {{ euros(liste()?.total ?? 0) }}</div>
            <button class="btn btn-sm btn-outline-secondary" (click)="exporter()" [disabled]="occupe()">
              <i class="bi bi-filetype-csv me-1" aria-hidden="true"></i>Exporter
            </button>
          </div>

          @if (depenses().length) {
            <div class="table-responsive">
              <table class="table table-hover align-middle mb-0">
                <thead>
                  <tr class="eyebrow">
                    <th scope="col">Date</th><th scope="col">Libellé</th>
                    <th scope="col">Avancé par</th><th scope="col">Règle</th>
                    <th class="text-end" scope="col">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  @for (d of depenses(); track d.id) {
                    <tr role="button" (click)="ouvrir(d)"
                        [class.text-decoration-line-through]="d.statut === 'annulee'"
                        [attr.aria-expanded]="detail()?.depense?.id === d.id">
                      <td class="tnum small text-body-secondary">{{ dateCourte(d.dateDepense) }}</td>
                      <td>
                        <span class="d-block small fw-medium">{{ d.libelle }}</span>
                        <span class="d-block text-body-secondary" style="font-size:.72rem">
                          {{ d.categorieLibelle }} · {{ nomBiens(d) }}
                        </span>
                      </td>
                      <td class="small text-body-secondary">
                        {{ d.payePar === 'personne' ? d.avanceParNom : 'Compte commun' }}
                      </td>
                      <td>
                        @if (d.regleAppliquee) {
                          <span class="badge rounded-pill text-bg-light border fw-normal">
                            {{ libelleRegle(d.regleAppliquee) }}
                          </span>
                        }
                      </td>
                      <td class="small fw-medium tnum text-end">{{ euros(d.partVisibleCents) }}</td>
                    </tr>

                    @if (detail(); as det) {
                      @if (det.depense.id === d.id) {
                        <tr>
                          <td class="bg-body-tertiary" colspan="5">
                            <h3 class="h6">Détail du calcul</h3>
                            <ul class="list-group list-group-flush mb-3">
                              @for (v of det.ventilation; track v.personneId) {
                                <li class="list-group-item d-flex justify-content-between gap-2 px-0 small bg-transparent">
                                  <span>{{ v.nom }}</span>
                                  <span class="fw-medium tnum">{{ euros(v.montantCents) }}</span>
                                </li>
                              }
                            </ul>
                            <pre class="small lh-lg mb-0" style="white-space:pre-wrap;font-family:inherit">{{ det.explication.join('\n') }}</pre>

                            @if (det.recalculs.length) {
                              <h3 class="h6 mt-3">Recalculs</h3>
                              @for (rc of det.recalculs; track rc.faitLe) {
                                <p class="text-body-secondary small mb-1">
                                  {{ dateLongue(rc.faitLe.slice(0, 10)) }}{{ rc.parNom ? ', par ' + rc.parNom : '' }} :
                                  {{ rc.motif }}
                                </p>
                              }
                            }

                            @if (det.depense.justificatifId) {
                              <a class="btn btn-sm btn-outline-secondary mt-3"
                                 [href]="urlFichier(det.depense.justificatifId!)" target="_blank" rel="noopener">
                                <i class="bi bi-paperclip me-1" aria-hidden="true"></i>Voir le justificatif
                              </a>
                            }

                            @if (etat.estGeranteIci() && det.depense.statut !== 'annulee') {
                              <hr>
                              <label class="form-label small text-body-secondary" [attr.for]="'motif-' + d.id">
                                Recalculer, en disant pourquoi
                              </label>
                              <input class="form-control" style="max-width:420px" [attr.id]="'motif-' + d.id"
                                     name="motif" [(ngModel)]="motif"
                                     placeholder="La succession a été rectifiée par le notaire">
                              <div class="d-flex gap-2 flex-wrap align-items-center mt-3">
                                <button class="btn btn-sm btn-outline-secondary" (click)="recalculer(d)"
                                        [disabled]="occupe() || !motif.trim()">Recalculer la répartition</button>
                                <button class="btn btn-sm btn-link text-body-secondary p-0"
                                        (click)="annuler(d)">Annuler cette dépense</button>
                              </div>
                              <p class="text-body-secondary small mt-2 mb-0">
                                L'ancienne répartition est conservée : c'est ce qui permet de répondre
                                à « pourquoi ce chiffre a changé ».
                              </p>
                            }
                          </td>
                        </tr>
                      }
                    }
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="text-body-secondary small mb-0">Aucune dépense enregistrée sur cet exercice.</p>
          }
        </div>
      </section>

      <section class="card">
        <div class="card-body">
          <div class="eyebrow">Règles de répartition</div>
          <p class="text-body-secondary small mt-2 mb-2">
            Chaque catégorie porte sa règle. La changer <strong>ne recalcule pas</strong> les dépenses
            déjà saisies : elle ouvre une nouvelle période à partir d'aujourd'hui.
          </p>
          <ul class="list-group list-group-flush">
            @for (r of regles(); track r.categorieId) {
              <li class="list-group-item d-flex justify-content-between align-items-center gap-3 px-0">
                <span class="small fw-medium">
                  {{ r.categorieLibelle }}
                  @if (!r.parDefaut) {
                    <span class="d-block text-body-secondary fw-normal" style="font-size:.72rem">
                      depuis le {{ dateLongue(r.applicableDu) }}
                    </span>
                  }
                </span>
                <button class="btn btn-sm btn-outline-secondary rounded-pill flex-shrink-0"
                        [disabled]="!etat.estGeranteIci() || occupe()" (click)="cyclerRegle(r)"
                        [attr.aria-label]="'Règle de ' + r.categorieLibelle + ' : ' + libelleRegle(r.regle)">
                  {{ libelleRegle(r.regle) }}
                </button>
              </li>
            }
          </ul>
        </div>
      </section>
    </div>
  `,
})
export class Depenses {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);
  readonly euros = euros;
  readonly dateCourte = dateCourte;
  readonly dateLongue = dateLongue;

  readonly annee = signal(Number(aujourdhui().slice(0, 4)));
  readonly liste = signal<ListeDepenses | null>(null);
  readonly regles = signal<RegleLigne[]>([]);
  readonly categories = signal<Categorie[]>([]);
  readonly personnes = signal<Personne[]>([]);
  readonly detail = signal<DetailDepense | null>(null);
  readonly justificatif = signal<{ fichierId: string; nom: string } | null>(null);
  readonly saisie = signal(false);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  motif = '';
  f = {
    dateDepense: aujourdhui(), montant: '', libelle: '', categorieId: 0,
    payePar: 'structure' as 'structure' | 'personne', avanceParId: 0, note: '',
  };

  readonly depenses = computed(() => this.liste()?.depenses ?? []);

  constructor() {
    effect(() => { const b = this.etat.bien(); this.annee(); if (b) void this.charger(b.id); });
  }

  private async charger(bienId: number): Promise<void> {
    const [liste, regles, categories, personnes] = await Promise.all([
      this.api.get<ListeDepenses>(`/depenses?annee=${this.annee()}&bienId=${bienId}`).catch(() => null),
      this.api.get<RegleLigne[]>(`/biens/${bienId}/regles`).catch(() => [] as RegleLigne[]),
      this.api.get<Categorie[]>('/categories').catch(() => [] as Categorie[]),
      this.etat.estGeranteIci() ? this.api.get<Personne[]>('/personnes').catch(() => [] as Personne[]) : Promise.resolve([]),
    ]);
    this.liste.set(liste);
    this.regles.set(regles);
    this.categories.set(categories.filter((c) => c.actif));
    this.personnes.set(personnes);
    if (!this.f.categorieId && categories.length) this.f.categorieId = categories[0].id;
  }

  libelleRegle(r: Regle): string { return LIBELLE[r]; }

  regleDe(categorieId: number): string {
    const r = this.regles().find((x) => x.categorieId === categorieId);
    return r ? LIBELLE[r.regle] : LIBELLE.quotes_parts;
  }

  nomBiens(d: Depense): string {
    return d.biens.map((b) => b.bienNom).join(' + ');
  }

  urlFichier(id: string): string {
    return `${document.baseURI.replace(/\/+$/, '')}/api/fichiers/${id}`;
  }

  changerAnnee(pas: number): void {
    this.annee.update((a) => a + pas);
    this.detail.set(null);
  }

  ouvrirSaisie(): void {
    this.saisie.set(true);
    this.erreur.set('');
    this.justificatif.set(null);
  }

  /** Ouvrir une ligne charge son détail : l'explication est lue, pas recalculée. */
  async ouvrir(d: Depense): Promise<void> {
    if (this.detail()?.depense.id === d.id) { this.detail.set(null); return; }
    this.motif = '';
    try {
      this.detail.set(await this.api.get<DetailDepense>(`/structures/${d.structureId}/depenses/${d.id}`));
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : 'Le détail est indisponible.');
    }
  }

  async joindre(evt: Event): Promise<void> {
    const fichier = (evt.target as HTMLInputElement).files?.[0];
    const b = this.etat.bien();
    if (!fichier || !b) return;
    await this.agir(async () => {
      const r = await this.api.televerser<{ fichierId: string; nom: string }>(
        `/structures/${b.structureId}/justificatif`, fichier);
      this.justificatif.set(r);
    });
  }

  /**
   * Le montant est saisi en euros et converti en centimes ici, une fois.
   * « 2 340,50 », « 2340.50 » et « 2340 » donnent tous le bon nombre entier.
   */
  private centimes(saisi: string): number {
    const propre = saisi.replace(/\s/g, '').replace(',', '.');
    const n = Number(propre);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100);
  }

  async enregistrer(): Promise<void> {
    const b = this.etat.bien();
    if (!b) return;
    const montantCents = this.centimes(this.f.montant);
    if (!montantCents) { this.erreur.set('Le montant doit être un nombre supérieur à zéro.'); return; }

    await this.agir(async () => {
      await this.api.post(`/structures/${b.structureId}/depenses`, {
        dateDepense: this.f.dateDepense, libelle: this.f.libelle, categorieId: this.f.categorieId,
        montantCents, payePar: this.f.payePar,
        ...(this.f.payePar === 'personne' ? { avanceParId: this.f.avanceParId } : {}),
        ...(this.justificatif() ? { justificatifId: this.justificatif()!.fichierId } : {}),
        note: this.f.note,
        biens: [{ bienId: b.id, poidsNum: 1, poidsDen: 1 }],
      });
      this.saisie.set(false);
      this.justificatif.set(null);
      this.f = { ...this.f, montant: '', libelle: '', note: '' };
      this.message.set('Dépense enregistrée, répartition figée.');
      await this.charger(b.id);
    });
  }

  async cyclerRegle(r: RegleLigne): Promise<void> {
    const b = this.etat.bien();
    if (!b) return;
    const suivante = SUIVANTE[r.regle];
    await this.agir(async () => {
      await this.api.post(`/biens/${b.id}/regles`, {
        categorieId: r.categorieId, regle: suivante, applicableDu: aujourdhui(),
      });
      this.message.set(`${r.categorieLibelle} : ${LIBELLE[suivante]} à partir d'aujourd'hui. Les dépenses passées ne changent pas.`);
      await this.charger(b.id);
    });
  }

  async recalculer(d: Depense): Promise<void> {
    await this.agir(async () => {
      await this.api.post(`/structures/${d.structureId}/depenses/${d.id}/recalcul`, { motif: this.motif });
      this.message.set('Répartition recalculée. L\'ancienne est conservée.');
      this.motif = '';
      // Le détail reste ouvert, avec ses nouveaux montants et la trace du
      // recalcul : c'est ce qu'on veut voir juste après avoir cliqué.
      this.detail.set(await this.api.get<DetailDepense>(`/structures/${d.structureId}/depenses/${d.id}`));
      const b = this.etat.bien();
      if (b) await this.charger(b.id);
    });
  }

  async annuler(d: Depense): Promise<void> {
    await this.agir(async () => {
      await this.api.post(`/structures/${d.structureId}/depenses/${d.id}/annulation`);
      this.detail.set(null);
      this.message.set('Dépense annulée. Elle reste consultable, et sort des soldes.');
      const b = this.etat.bien();
      if (b) await this.charger(b.id);
    });
  }

  async exporter(): Promise<void> {
    await this.agir(async () => {
      const { blob, nom } = await this.api.telecharger(`/export/depenses.csv?annee=${this.annee()}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nom;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  private async agir(action: () => Promise<void>): Promise<void> {
    if (this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try { await action(); }
    catch (e) { this.erreur.set(e instanceof ErreurAppel ? e.message : "L'action a échoué."); }
    finally { this.occupe.set(false); }
  }
}
