// Soldes et remboursements.
//
// Le point de la maquette : une carte par personne, un solde lisible, et des
// virements proposés en nombre minimal. Trois précisions qui comptent :
//
//   - **le solde du compte commun est affiché comme les autres.** Sans lui, les
//     comptes ne tombent pas à zéro et personne ne comprend pourquoi ;
//   - **un virement proposé ne déplace rien.** Il faut l'annoncer, puis que le
//     bénéficiaire confirme l'avoir reçu ;
//   - **chaque solde s'explique** : ce qui a été avancé, ce qui est dû, ce qui a
//     été réglé. Un chiffre non justifiable est un chiffre contesté.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import { aujourdhui, dateLongue, decale, euros, initiales } from '../core/format';
import type { SoldeActeur, Soldes as SoldesModele, VirementPropose } from '../core/modeles';

@Component({
  selector: 'app-soldes',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="d-flex flex-column gap-4">
      <div class="d-flex justify-content-between align-items-end gap-3 flex-wrap">
        <div>
          <h1 class="h2 mb-2">Soldes &amp; remboursements</h1>
          <p class="text-body-secondary mb-0">{{ donnees()?.structure?.nom }}</p>
        </div>
        @if (etat.estGeranteIci() && aDesDebiteurs()) {
          <button class="btn btn-primary" (click)="appel.set(!appel())">
            <i class="bi bi-file-earmark-text me-1" aria-hidden="true"></i>
            {{ appel() ? 'Fermer' : 'Générer l\\'appel de fonds' }}
          </button>
        }
      </div>

      @if (erreur()) { <div class="alert alert-primary mb-0">{{ erreur() }}</div> }
      @if (message()) { <div class="alert alert-success mb-0">{{ message() }}</div> }

      @if (donnees(); as d) {
        @if (d.controle !== 0) {
          <!-- La somme des soldes doit valoir zéro. Si elle ne vaut pas zéro,
               il faut le dire haut et fort plutôt que d'afficher des chiffres
               dont personne ne pourra expliquer l'écart. -->
          <div class="alert alert-primary mb-0">
            <strong>Incohérence détectée.</strong> La somme des soldes vaut {{ euros(d.controle) }} au lieu de zéro.
            Signalez-le : les montants affichés ci-dessous ne sont pas fiables.
          </div>
        }

        @if (appel()) {
          <section class="card">
            <div class="card-body">
              <h2 class="h5 card-title">Appel de fonds</h2>
              <p class="text-body-secondary small">
                Chaque personne débitrice recevra un courriel avec son montant, l'échéance, et un lien
                vers le détail du calcul.
              </p>
              <form class="row g-3" (ngSubmit)="emettre()">
                <div class="col-12 col-md-6">
                  <label class="form-label small text-body-secondary" for="a-libelle">Libellé</label>
                  <input class="form-control" id="a-libelle" name="libelle" [(ngModel)]="f.libelle"
                         [placeholder]="d.vocabulaire.regularisation + ' ' + annee" required>
                </div>
                <div class="col-12 col-md-4">
                  <label class="form-label small text-body-secondary" for="a-echeance">Échéance</label>
                  <input class="form-control" id="a-echeance" name="echeance" type="date"
                         [(ngModel)]="f.echeance" required>
                </div>
                <div class="col-12">
                  <button class="btn btn-primary" type="submit" [disabled]="occupe()">Émettre l'appel</button>
                </div>
              </form>
            </div>
          </section>
        }

        @if (d.soldes.length) {
          <div class="row row-cols-1 row-cols-sm-2 row-cols-xl-4 g-3">
            @for (s of d.soldes; track s.acteurId) {
              <div class="col">
                <div class="card h-100">
                  <div class="card-body">
                    <div class="d-flex align-items-center gap-2">
                      <span class="avatar">{{ s.estStructure ? '€' : initiales(s.nom) }}</span>
                      <span>
                        <span class="d-block small fw-medium">{{ s.nom }}</span>
                        @if (s.estStructure) {
                          <span class="d-block text-body-secondary" style="font-size:.72rem">compte commun</span>
                        }
                      </span>
                    </div>
                    <div class="fs-3 mt-3 tnum card-title"
                         [class.text-success-emphasis]="s.montantCents > 0"
                         [class.text-primary]="s.montantCents < 0">
                      {{ s.montantCents > 0 ? '+ ' : s.montantCents < 0 ? '− ' : '' }}{{ euros(Math.abs(s.montantCents)) }}
                    </div>
                    <p class="text-body-secondary mt-2 mb-2" style="font-size:.78rem">{{ motDeSolde(s) }}</p>
                    <ul class="list-group list-group-flush">
                      <li class="list-group-item d-flex justify-content-between gap-2 px-0 py-1"
                          style="font-size:.72rem">
                        <span class="text-body-secondary">A avancé</span>
                        <span class="tnum">{{ euros(s.avanceCents) }}</span>
                      </li>
                      <li class="list-group-item d-flex justify-content-between gap-2 px-0 py-1"
                          style="font-size:.72rem">
                        <span class="text-body-secondary">Sa part des dépenses</span>
                        <span class="tnum">{{ euros(s.duCents) }}</span>
                      </li>
                      @if (s.regleCents !== 0) {
                        <li class="list-group-item d-flex justify-content-between gap-2 px-0 py-1"
                            style="font-size:.72rem">
                          <span class="text-body-secondary">Virements confirmés</span>
                          <span class="tnum">{{ euros(s.regleCents) }}</span>
                        </li>
                      }
                    </ul>
                  </div>
                </div>
              </div>
            }
          </div>
        } @else {
          <div class="card"><div class="card-body">
            <p class="text-body-secondary small mb-0">Aucun solde : rien n'a encore été dépensé sur cet exercice.</p>
          </div></div>
        }

        @if (d.virements.length) {
          <section class="card">
            <div class="card-body">
              <div class="eyebrow">Virements proposés</div>
              <p class="text-body-secondary small mt-2 mb-2">
                {{ d.virements.length }} virement{{ d.virements.length > 1 ? 's' : '' }} suffi{{ d.virements.length > 1 ? 'sent' : 't' }}
                à remettre tout le monde à zéro. Tant qu'un virement n'est pas confirmé par celui qui
                reçoit, il ne déplace aucun solde.
              </p>
              <div class="table-responsive">
                <table class="table table-hover align-middle mb-0">
                  <thead>
                    <tr class="eyebrow">
                      <th scope="col">Virement</th><th scope="col">Motif</th>
                      <th class="text-end" scope="col">Montant</th><th scope="col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (v of d.virements; track v.deId + '-' + v.versId) {
                      <tr>
                        <td class="small">
                          <span class="fw-medium">{{ v.deNom }}</span>
                          <i class="bi bi-arrow-right mx-1 text-body-secondary" aria-hidden="true"></i>
                          <span class="fw-medium">{{ v.versNom }}</span>
                        </td>
                        <td class="small text-body-secondary">{{ v.motif }}</td>
                        <td class="small fw-medium tnum text-end">{{ euros(v.montantCents) }}</td>
                        <td class="text-end">
                          @if (peutAnnoncer(v)) {
                            <button class="btn btn-sm btn-outline-secondary" (click)="annoncer(v)"
                                    [disabled]="occupe()">J'ai fait le virement</button>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        }

        @if (d.reglements.length) {
          <section class="card">
            <div class="card-body">
              <div class="eyebrow mb-2">Virements annoncés</div>
              <div class="table-responsive">
                <table class="table table-hover align-middle mb-0">
                  <thead>
                    <tr class="eyebrow">
                      <th scope="col">Virement</th><th scope="col">Motif</th>
                      <th class="text-end" scope="col">Montant</th>
                      <th scope="col">Statut</th><th scope="col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (r of d.reglements; track r.id) {
                      <tr>
                        <td class="small">
                          <span class="fw-medium">{{ r.deNom }}</span>
                          <i class="bi bi-arrow-right mx-1 text-body-secondary" aria-hidden="true"></i>
                          <span class="fw-medium">{{ r.versNom }}</span>
                        </td>
                        <td class="small text-body-secondary">
                          {{ r.motif || 'Virement' }} · {{ dateLongue(r.dateReglement) }}
                        </td>
                        <td class="small fw-medium tnum text-end">{{ euros(r.montantCents) }}</td>
                        <td>
                          <span class="badge rounded-pill"
                                [class]="r.statut === 'confirme'
                                  ? 'text-success-emphasis bg-success-subtle border border-success-subtle'
                                  : r.statut === 'annonce'
                                    ? 'text-primary-emphasis bg-primary-subtle border border-primary-subtle'
                                    : 'text-bg-light border'">
                            {{ r.statut === 'confirme' ? 'Reçu' : r.statut === 'annonce' ? 'Annoncé' : 'Proposé' }}
                          </span>
                        </td>
                        <td class="text-end">
                          @if (r.statut !== 'confirme' && peutConfirmer(r.versId)) {
                            <button class="btn btn-sm btn-outline-secondary" (click)="confirmer(r.id)"
                                    [disabled]="occupe()">J'ai reçu l'argent</button>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <p class="text-body-secondary small mt-3 mb-0">
                Seul le bénéficiaire confirme avoir reçu : sans cette règle, un débiteur solderait sa
                propre dette d'un clic.
              </p>
            </div>
          </section>
        }

        @if (d.appels.length) {
          <section class="card">
            <div class="card-body">
              <div class="eyebrow mb-2">Appels de fonds</div>
              @for (a of d.appels; track a.id) {
                <div class="border-top pt-3 mt-3">
                  <div class="d-flex justify-content-between align-items-center gap-3 flex-wrap">
                    <strong class="small">{{ a.libelle }}</strong>
                    <span class="text-body-secondary" style="font-size:.72rem">
                      émis le {{ dateLongue(a.dateAppel) }}, échéance le {{ dateLongue(a.echeance) }}
                    </span>
                  </div>
                  <ul class="list-group list-group-flush">
                    @for (l of a.lignes; track l.personneId) {
                      <li class="list-group-item d-flex align-items-center gap-3 px-0">
                        <span class="small flex-grow-1">{{ l.nom }}</span>
                        <span class="small fw-medium tnum">{{ euros(l.montantCents) }}</span>
                        <span class="badge rounded-pill"
                              [class]="l.statut === 'confirme'
                                ? 'text-success-emphasis bg-success-subtle border border-success-subtle'
                                : 'text-bg-light border'">
                          {{ l.statut === 'confirme' ? 'Réglé' : l.statut === 'annonce' ? 'Annoncé' : 'Attendu' }}
                        </span>
                      </li>
                    }
                  </ul>
                </div>
              }
            </div>
          </section>
        }
      }
    </div>
  `,
})
export class Soldes {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);
  readonly euros = euros;
  readonly dateLongue = dateLongue;
  readonly initiales = initiales;
  readonly Math = Math;
  readonly annee = Number(aujourdhui().slice(0, 4));

  readonly donnees = signal<SoldesModele | null>(null);
  readonly appel = signal(false);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  f = { libelle: '', echeance: decale(aujourdhui(), 30) };

  readonly aDesDebiteurs = computed(() =>
    (this.donnees()?.soldes ?? []).some((s) => !s.estStructure && s.montantCents < 0));

  constructor() {
    effect(() => { const b = this.etat.bien(); if (b) void this.charger(b.structureId); });
  }

  private async charger(structureId: number): Promise<void> {
    try {
      this.donnees.set(await this.api.get<SoldesModele>(`/structures/${structureId}/soldes`));
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : 'Les soldes sont indisponibles.');
    }
  }

  /** Le mot qui explique le solde, en une ligne, sans jargon. */
  motDeSolde(s: SoldeActeur): string {
    if (s.montantCents === 0) return 'À jour';
    if (s.estStructure) {
      return s.montantCents > 0 ? 'Le compte commun a avancé, il attend les appels de fonds'
        : 'Le compte commun doit être remboursé aux avanceurs';
    }
    return s.montantCents > 0 ? 'A avancé plus que sa part' : 'Doit sa part des dépenses avancées';
  }

  /** Chacun annonce ses propres virements ; la gérante ceux du compte commun. */
  peutAnnoncer(v: VirementPropose): boolean {
    return v.deId === this.etat.moi()?.personne.id || (v.deId === 0 && this.etat.estGeranteIci());
  }

  peutConfirmer(versId: number): boolean {
    return versId === this.etat.moi()?.personne.id || (versId === 0 && this.etat.estGeranteIci());
  }

  async annoncer(v: VirementPropose): Promise<void> {
    const b = this.etat.bien();
    if (!b) return;
    await this.agir(async () => {
      await this.api.post(`/structures/${b.structureId}/reglements`, {
        deId: v.deId, versId: v.versId, montantCents: v.montantCents, motif: v.motif,
      });
      this.message.set(`Virement annoncé. Il comptera quand ${v.versNom} aura confirmé l'avoir reçu.`);
      await this.charger(b.structureId);
    });
  }

  async confirmer(id: number): Promise<void> {
    const b = this.etat.bien();
    if (!b) return;
    await this.agir(async () => {
      await this.api.post(`/structures/${b.structureId}/reglements/${id}/confirmation`);
      this.message.set('Virement confirmé, les soldes sont à jour.');
      await this.charger(b.structureId);
    });
  }

  async emettre(): Promise<void> {
    const b = this.etat.bien();
    if (!b) return;
    await this.agir(async () => {
      const r = await this.api.post<{ lignes: number }>(`/structures/${b.structureId}/appels`, this.f);
      this.appel.set(false);
      this.f = { libelle: '', echeance: decale(aujourdhui(), 30) };
      this.message.set(`Appel de fonds émis : ${r.lignes} personne(s) prévenue(s) par courriel.`);
      await this.charger(b.structureId);
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
