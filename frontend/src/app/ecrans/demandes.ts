// La file d'attente et le tour de choix.
//
// Deux onglets, comme dans la maquette. Le premier est le coeur du travail de la
// gérante : une carte par demande, avec ses conflits sous les yeux et deux
// boutons. Le second documente l'équité de la haute saison, sans l'imposer.
//
// **L'application propose, elle ne valide pas à sa place.** Un conflit ne bloque
// aucun bouton, il s'affiche. Une décision est réversible et horodatée.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import { dateLongue, horodatageLisible, nuitsLisible, personnesLisible, plage } from '../core/format';
import type { Demande, Saison } from '../core/modeles';

interface Arbitrage {
  attributions: { voeuId: number; foyerId: number; du: string; au: string; rang: number }[];
  refus: { voeuId: number; foyerId: number; du: string; au: string; raison: string }[];
  bilan: { foyerId: number; foyerNom: string; nuits: number; quota: number | null; depassement: number }[];
  depassements: { foyerId: number; depassement: number }[];
}

@Component({
  selector: 'app-demandes',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="d-flex flex-column gap-4">
      <div>
        <h1 class="h2 mb-2">Demandes de séjour</h1>
        <p class="text-body-secondary mb-0">
          {{ etat.bien()?.nom }} ·
          @if (file().length) { {{ file().length }} à traiter } @else { rien à traiter }
        </p>
      </div>

      <ul class="nav nav-tabs" role="tablist">
        <li class="nav-item">
          <button class="nav-link" role="tab" [class.active]="onglet() === 'file'"
                  [attr.aria-selected]="onglet() === 'file'" (click)="onglet.set('file')">File d'attente</button>
        </li>
        <li class="nav-item">
          <button class="nav-link" role="tab" [class.active]="onglet() === 'tour'"
                  [attr.aria-selected]="onglet() === 'tour'" (click)="onglet.set('tour')">Tour de choix</button>
        </li>
      </ul>

      @if (message()) { <div class="alert alert-success mb-0">{{ message() }}</div> }
      @if (erreur()) { <div class="alert alert-primary mb-0">{{ erreur() }}</div> }

      @if (onglet() === 'file') {
        @if (!etat.estGeranteIci()) {
          <div class="card"><div class="card-body">
            <p class="text-body-secondary small mb-0">
              Seule la gérante arbitre les demandes. Les vôtres apparaissent dans le calendrier.
            </p>
          </div></div>
        } @else if (file().length) {
          <div class="d-flex flex-column gap-3">
            @for (d of file(); track d.id) {
              <section class="card">
                <div class="card-body d-flex flex-wrap gap-4 align-items-start">
                  <div class="flex-grow-1" style="min-width:240px">
                    <div class="d-flex align-items-baseline gap-2 flex-wrap">
                      <h2 class="h5 card-title mb-0">{{ d.titre }}</h2>
                      <span class="small text-body-secondary">{{ d.bienNom }}</span>
                    </div>
                    <p class="small tnum mt-2 mb-1">
                      {{ plage(d.arrivee, d.depart) }} · {{ nuitsLisible(d.nuits) }} ·
                      {{ personnesLisible(d.occupants) }}
                    </p>
                    <p class="text-body-secondary mb-0" style="font-size:.72rem">
                      Demandé le {{ horodatageLisible(d.creeLe) }}
                    </p>
                    @if (d.note) {
                      <p class="small text-secondary-emphasis fst-italic mt-2 mb-0" style="max-width:52ch">
                        « {{ d.note }} »
                      </p>
                    }
                    @if (d.conflits.length) {
                      <div class="alert alert-primary d-inline-flex align-items-start gap-2 py-2 px-3 mt-3 mb-0 small">
                        <i class="bi bi-exclamation-triangle mt-1" aria-hidden="true"></i>
                        <span>@for (c of d.conflits; track c.message) { <span class="d-block">{{ c.message }}</span> }</span>
                      </div>
                    }
                  </div>
                  <div class="d-flex flex-column gap-2" style="min-width:200px">
                    <button class="btn btn-primary" (click)="decider(d, 'valide')" [disabled]="occupe()">
                      <i class="bi bi-check2 me-1"></i>Valider le séjour
                    </button>
                    <button class="btn btn-outline-secondary" (click)="ouvrirRenvoi(d)" [disabled]="occupe()">
                      Proposer d'autres dates
                    </button>
                    @if (renvoi() === d.id) {
                      <div>
                        <label class="form-label small text-body-secondary" [attr.for]="'note-' + d.id">
                          Message pour {{ d.titre }}
                        </label>
                        <textarea class="form-control" [attr.id]="'note-' + d.id" name="note" rows="3"
                                  [(ngModel)]="noteRenvoi"
                                  placeholder="Peux-tu décaler au 9 ? Les locataires partent dans la journée."></textarea>
                        <button class="btn btn-sm btn-outline-secondary mt-2 w-100"
                                (click)="decider(d, 'a_revoir')" [disabled]="occupe()">Renvoyer la demande</button>
                      </div>
                    }
                  </div>
                </div>
              </section>
            }
          </div>
        } @else {
          <div class="card"><div class="card-body">
            <p class="text-body-secondary small mb-0">Aucune demande en attente sur ce bien.</p>
          </div></div>
        }
      }

      @if (onglet() === 'tour') {
        @if (saisons().length) {
          <div class="d-flex flex-column gap-3">
            @for (s of saisons(); track s.saison.id) {
              <section class="card">
                <div class="card-body">
                  <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap">
                    <div>
                      <h2 class="h5 card-title mb-1">{{ s.saison.libelle }}</h2>
                      <p class="text-body-secondary small mb-0">
                        Du {{ dateLongue(s.saison.debut) }} au {{ dateLongue(s.saison.fin) }} ·
                        {{ s.saison.statut === 'ouverte' ? 'voeux ouverts' : s.saison.statut === 'arbitree' ? 'arbitrée' : 'close' }}
                      </p>
                    </div>
                    @if (etat.estGeranteIci() && s.saison.statut === 'ouverte') {
                      <button class="btn btn-primary" (click)="arbitrer(s)" [disabled]="occupe() || !s.voeux.length">
                        Lancer l'arbitrage
                      </button>
                    }
                  </div>

                  @if (s.voeux.length) {
                    <div class="table-responsive mt-3">
                      <table class="table align-middle mb-0">
                        <thead>
                          <tr class="eyebrow">
                            <th scope="col">Foyer</th>
                            <th scope="col">1<sup>er</sup> choix</th>
                            <th scope="col">2<sup>e</sup> choix</th>
                            <th scope="col">Quota</th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (f of foyersDe(s); track f.foyerId) {
                            <tr>
                              <td class="small fw-medium">{{ f.foyerNom }}</td>
                              <td class="small tnum">{{ f.choix1 || 'Aucun voeu' }}</td>
                              <td class="small tnum text-body-secondary">{{ f.choix2 || 'Aucun voeu' }}</td>
                              <td class="small tnum">{{ f.quota === null ? 'Sans quota' : nuitsLisible(f.quota) }}</td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  } @else {
                    <p class="text-body-secondary small mt-3 mb-0">Aucun voeu déposé pour l'instant.</p>
                  }

                  @if (voeuxOuverts(s)) {
                    <hr>
                    <h3 class="h6">Déposer votre voeu</h3>
                    <form class="row g-3 mt-0" (ngSubmit)="deposerVoeu(s)">
                      <div class="col-12 col-md-3">
                        <label class="form-label small text-body-secondary" [attr.for]="'v-rang-' + s.saison.id">Choix</label>
                        <select class="form-select" [attr.id]="'v-rang-' + s.saison.id" name="rang" [(ngModel)]="voeu.rang">
                          <option [value]="1">Premier choix</option>
                          <option [value]="2">Second choix</option>
                        </select>
                      </div>
                      <div class="col-12 col-md-3">
                        <label class="form-label small text-body-secondary" [attr.for]="'v-du-' + s.saison.id">Du</label>
                        <input class="form-control" [attr.id]="'v-du-' + s.saison.id" name="du" type="date"
                               [(ngModel)]="voeu.du" required>
                      </div>
                      <div class="col-12 col-md-3">
                        <label class="form-label small text-body-secondary" [attr.for]="'v-au-' + s.saison.id">Au</label>
                        <input class="form-control" [attr.id]="'v-au-' + s.saison.id" name="au" type="date"
                               [(ngModel)]="voeu.au" required>
                      </div>
                      <div class="col-12 col-md-3">
                        <label class="form-label small text-body-secondary" [attr.for]="'v-occ-' + s.saison.id">Personnes</label>
                        <input class="form-control" [attr.id]="'v-occ-' + s.saison.id" name="occupants" type="number"
                               min="1" max="60" [(ngModel)]="voeu.occupants">
                      </div>
                      <div class="col-12">
                        <button class="btn btn-outline-secondary" type="submit" [disabled]="occupe()">
                          Enregistrer mon voeu
                        </button>
                      </div>
                    </form>
                  }

                  @if (resultat() && resultat()!.saisonId === s.saison.id) {
                    <hr>
                    <h3 class="h6">Résultat proposé</h3>
                    <p class="text-body-secondary small">
                      Ces séjours sont créés <strong>en attente</strong> : validez-les un par un dans la file,
                      et modifiez ce qui doit l'être. La décision finale reste la vôtre.
                    </p>
                    <ul class="list-group list-group-flush">
                      @for (b of resultat()!.arbitrage.bilan; track b.foyerId) {
                        <li class="list-group-item d-flex gap-3 align-items-center px-0">
                          <span class="small flex-grow-1">{{ b.foyerNom }}</span>
                          <span class="small tnum">{{ nuitsLisible(b.nuits) }}</span>
                          @if (b.depassement > 0) {
                            <span class="badge rounded-pill text-primary-emphasis bg-primary-subtle border border-primary-subtle">
                              quota dépassé de {{ b.depassement }}
                            </span>
                          }
                        </li>
                      }
                    </ul>
                    @for (r of resultat()!.arbitrage.refus; track r.voeuId) {
                      <div class="alert alert-primary mt-3 mb-0 small">{{ r.raison }}</div>
                    }
                  }
                </div>
              </section>
            }
          </div>
        } @else {
          <section class="card">
            <div class="card-body">
              <h2 class="h5 card-title">Tour de choix</h2>
              <p class="text-body-secondary small">
                Le tour de choix sert à documenter l'équité de la haute saison : chacun dépose ses voeux,
                l'ordre de priorité tourne d'une année sur l'autre, et la gérante arbitre. Aucun algorithme
                ne décide à sa place.
              </p>
              @if (etat.estGeranteIci()) {
                <form class="row g-3" (ngSubmit)="creerSaison()">
                  <div class="col-12 col-md-4">
                    <label class="form-label small text-body-secondary" for="s-lib">Libellé</label>
                    <input class="form-control" id="s-lib" name="libelle" [(ngModel)]="saison.libelle"
                           placeholder="Été 2026" required>
                  </div>
                  <div class="col-12 col-md-4">
                    <label class="form-label small text-body-secondary" for="s-debut">Début</label>
                    <input class="form-control" id="s-debut" name="debut" type="date" [(ngModel)]="saison.debut" required>
                  </div>
                  <div class="col-12 col-md-4">
                    <label class="form-label small text-body-secondary" for="s-fin">Fin</label>
                    <input class="form-control" id="s-fin" name="fin" type="date" [(ngModel)]="saison.fin" required>
                  </div>
                  <div class="col-12">
                    <button class="btn btn-primary" type="submit" [disabled]="occupe()">Ouvrir une saison</button>
                  </div>
                </form>
              } @else {
                <p class="text-body-secondary small mb-0">Aucune saison ouverte pour l'instant.</p>
              }
            </div>
          </section>
        }
      }
    </div>
  `,
})
export class Demandes {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);
  readonly plage = plage;
  readonly dateLongue = dateLongue;
  readonly horodatageLisible = horodatageLisible;
  readonly nuitsLisible = nuitsLisible;
  readonly personnesLisible = personnesLisible;

  readonly onglet = signal<'file' | 'tour'>('file');
  private readonly demandes = signal<Demande[]>([]);
  readonly saisons = signal<Saison[]>([]);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');
  readonly renvoi = signal<number | null>(null);
  readonly resultat = signal<{ saisonId: number; arbitrage: Arbitrage } | null>(null);

  noteRenvoi = '';
  voeu = { rang: 1, du: '', au: '', occupants: 2 };
  saison = { libelle: '', debut: '', fin: '' };

  /** La file, filtrée sur le bien courant : le badge et cet écran comptent pareil. */
  readonly file = computed(() => this.demandes().filter((d) => d.bienId === this.etat.bien()?.id));

  constructor() {
    effect(() => { const b = this.etat.bien(); if (b) void this.charger(b.id); });
  }

  private async charger(bienId: number): Promise<void> {
    const [demandes, saisons] = await Promise.all([
      this.etat.estGeranteIci() ? this.api.get<Demande[]>('/demandes').catch(() => [] as Demande[]) : Promise.resolve([]),
      this.api.get<Saison[]>(`/biens/${bienId}/saisons`).catch(() => [] as Saison[]),
    ]);
    this.demandes.set(demandes);
    this.saisons.set(saisons);
  }

  ouvrirRenvoi(d: Demande): void {
    this.renvoi.set(this.renvoi() === d.id ? null : d.id);
    this.noteRenvoi = '';
  }

  async decider(d: Demande, statut: 'valide' | 'a_revoir'): Promise<void> {
    await this.agir(async () => {
      const r = await this.api.post<{ conflits: { message: string }[] }>(
        `/biens/${d.bienId}/sejours/${d.id}/decision`,
        { statut, note: statut === 'a_revoir' ? this.noteRenvoi : '' });
      this.renvoi.set(null);
      this.message.set(statut === 'valide'
        ? `Séjour de ${d.titre} validé.${r.conflits.length ? ' Le chevauchement a été enregistré dans le journal.' : ''} Un courriel lui a été envoyé.`
        : `Demande de ${d.titre} renvoyée avec votre message.`);
      await this.charger(d.bienId);
      await this.etat.rafraichir();
    });
  }

  async creerSaison(): Promise<void> {
    const b = this.etat.bien();
    if (!b) return;
    await this.agir(async () => {
      await this.api.post(`/biens/${b.id}/saisons`, this.saison);
      this.saison = { libelle: '', debut: '', fin: '' };
      await this.charger(b.id);
    });
  }

  async deposerVoeu(s: Saison): Promise<void> {
    const b = this.etat.bien();
    if (!b) return;
    await this.agir(async () => {
      await this.api.post(`/biens/${b.id}/saisons/${s.saison.id}/voeux`, {
        rang: Number(this.voeu.rang), du: this.voeu.du, au: this.voeu.au, occupants: Number(this.voeu.occupants),
      });
      this.message.set('Votre voeu est enregistré.');
      await this.charger(b.id);
    });
  }

  async arbitrer(s: Saison): Promise<void> {
    const b = this.etat.bien();
    if (!b) return;
    await this.agir(async () => {
      const r = await this.api.post<Arbitrage>(`/biens/${b.id}/saisons/${s.saison.id}/arbitrage`);
      this.resultat.set({ saisonId: s.saison.id, arbitrage: r });
      this.message.set(`${r.attributions.length} séjour(s) proposé(s), à valider dans la file d'attente.`);
      await this.charger(b.id);
      await this.etat.rafraichir();
    });
  }

  /** Les lignes du tableau des voeux : un foyer par ligne, ses deux choix. */
  foyersDe(s: Saison): { foyerId: number; foyerNom: string; choix1: string; choix2: string; quota: number | null }[] {
    const ids = [...new Set(s.voeux.map((v) => v.foyerId))];
    return ids.map((foyerId) => {
      const siens = s.voeux.filter((v) => v.foyerId === foyerId);
      const c1 = siens.find((v) => v.rang === 1);
      const c2 = siens.find((v) => v.rang === 2);
      return {
        foyerId,
        foyerNom: siens[0]?.foyerNom ?? '',
        choix1: c1 ? plage(c1.du, c1.au) : '',
        choix2: c2 ? plage(c2.du, c2.au) : '',
        quota: s.quotas.find((q) => q.foyerId === foyerId)?.nuitsMax ?? null,
      };
    });
  }

  /**
   * Le formulaire de voeu n'apparaît que si la saison est ouverte et que la
   * personne appartient à un foyer : sans foyer, le serveur refuserait, et
   * afficher un formulaire qui échoue toujours ne rend service à personne.
   */
  voeuxOuverts(s: Saison): boolean {
    return s.saison.statut === 'ouverte' && !!this.etat.moi()?.personne.foyerId;
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
