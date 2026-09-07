// Membres et quotes-parts, avec l'historique des détentions.
//
// L'écran porte le point de modélisation le plus important du projet : **une
// quote-part est un intervalle daté, pas une valeur courante**. La saisie
// demande donc toujours une date d'effet et un motif, et l'historique reste
// affiché en dessous : c'est ce qui rendra une répartition passée défendable le
// jour où quelqu'un la contestera.
//
// Le vocabulaire suit la structure : indivisaires et quotes-parts d'un côté,
// associés et parts sociales de l'autre.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import { aujourdhui, dateLongue, initiales } from '../core/format';
import type { LigneDetention, Personne, Structure } from '../core/modeles';

@Component({
  selector: 'app-membres',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="d-flex flex-column gap-4">
      <div>
        <h1 class="h2 mb-2">Membres &amp; {{ etat.vocabulaire().parts }}</h1>
        <p class="text-body-secondary mb-0">{{ structure()?.structure?.nom }}</p>
      </div>

      @if (erreur()) { <div class="alert alert-primary mb-0">{{ erreur() }}</div> }
      @if (message()) { <div class="alert alert-success mb-0">{{ message() }}</div> }

      @if (structure(); as s) {
        <section class="card">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap">
              <h2 class="h5 card-title mb-0">{{ majuscule(etat.vocabulaire().detenteurs) }}</h2>
              <span class="badge rounded-pill text-bg-light border fw-medium text-wrap text-start">{{ s.regles[0]?.libelle }}</span>
            </div>

            @if (s.detenteurs.length) {
              <div class="table-responsive mt-3">
                <table class="table table-hover align-middle mb-0">
                  <thead>
                    <tr class="eyebrow">
                      <th scope="col">{{ majuscule(etat.vocabulaire().detenteurs.replace(/s$/, '')) }}</th>
                      <th scope="col">Rôle</th>
                      @if (s.partsVisibles) { <th class="text-end" scope="col">Quote-part</th> }
                    </tr>
                  </thead>
                  <tbody>
                    @for (d of s.detenteurs; track d.personneId) {
                      <tr>
                        <td>
                          <div class="d-flex align-items-center gap-3">
                            <span class="avatar">{{ initiales(d.nom) }}</span>
                            <span>
                              <span class="d-block small fw-medium">{{ d.nom }}</span>
                              <span class="d-block text-body-secondary" style="font-size:.72rem">{{ d.foyerNom || 'Sans foyer' }}</span>
                            </span>
                          </div>
                        </td>
                        <td>
                          <span class="badge rounded-pill"
                                [class]="d.role === 'gerant'
                                  ? 'text-primary-emphasis bg-primary-subtle border border-primary-subtle'
                                  : 'text-bg-light border'">
                            {{ d.role === 'gerant' ? 'Gérant' : majuscule(etat.vocabulaire().detenteurs.replace(/s$/, '')) }}
                          </span>
                        </td>
                        @if (s.partsVisibles) {
                          <td class="text-end">
                            <span class="d-block small fw-medium tnum">{{ d.quotePart }}</span>
                            <span class="d-block text-body-secondary tnum" style="font-size:.72rem">{{ d.parts }} / {{ d.total }}</span>
                          </td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="text-body-secondary small mt-3 mb-0">
                Aucune répartition n'est encore saisie. Elle porte une date d'effet (une succession, un
                acte notarié) qu'aucun amorçage ne peut deviner : c'est à vous de l'entrer.
              </p>
            }
            @if (!s.partsVisibles) {
              <p class="text-body-secondary small mt-3 mb-0">
                La répartition chiffrée n'est pas affichée aux membres de foyer. Un gérant peut changer
                ce réglage dans la page Réglages.
              </p>
            }
          </div>
        </section>

        @if (etat.estGeranteIci()) {
          <section class="card">
            <div class="card-body">
              <h2 class="h5 card-title">Modifier la répartition</h2>
              <p class="text-body-secondary small">
                Les {{ etat.vocabulaire().parts }} sont des <strong>nombres entiers</strong> : une indivision à
                parts égales entre quatre s'écrit 1, 1, 1, 1 ; une SCI de 300 parts s'écrit 120, 90, 90.
                La date d'effet est celle de l'acte, pas celle de la saisie : les dépenses antérieures
                garderont la répartition d'alors.
              </p>

              @for (l of lignes(); track l.cle) {
                <div class="row g-2 align-items-end mb-2">
                  <div class="col">
                    <label class="form-label small text-body-secondary" [attr.for]="'p-' + l.cle">Personne</label>
                    <select class="form-select" [attr.id]="'p-' + l.cle" [(ngModel)]="l.personneId" [name]="'p-' + l.cle">
                      <option [ngValue]="0">Choisir...</option>
                      @for (p of personnes(); track p.id) { <option [ngValue]="p.id">{{ p.nom }}</option> }
                    </select>
                  </div>
                  <div class="col-auto" style="width:110px">
                    <label class="form-label small text-body-secondary" [attr.for]="'n-' + l.cle">Parts</label>
                    <input class="form-control" [attr.id]="'n-' + l.cle" type="number" min="1"
                           [(ngModel)]="l.parts" [name]="'n-' + l.cle">
                  </div>
                  <div class="col-auto">
                    <button class="btn btn-outline-secondary" type="button" (click)="retirerLigne(l.cle)"
                            aria-label="Retirer cette ligne">
                      <i class="bi bi-x-lg" aria-hidden="true"></i>
                    </button>
                  </div>
                </div>
              }
              <button class="btn btn-sm btn-outline-secondary mb-4" type="button" (click)="ajouterLigne()">
                <i class="bi bi-plus-circle me-1" aria-hidden="true"></i>Ajouter une personne
              </button>

              <div class="row g-3">
                <div class="col-12 col-md-4">
                  <label class="form-label small text-body-secondary" for="d-effet">Date d'effet</label>
                  <input class="form-control" id="d-effet" name="dateEffet" type="date" [(ngModel)]="dateEffet" required>
                </div>
                <div class="col-12 col-md-8">
                  <label class="form-label small text-body-secondary" for="d-motif">Motif</label>
                  <input class="form-control" id="d-motif" name="motif" [(ngModel)]="motif"
                         placeholder="Succession de Robert Prudhomme, rachat des parts de Julien..." required>
                </div>
              </div>
              <button class="btn btn-primary mt-3" (click)="enregistrer()" [disabled]="occupe()">
                Enregistrer la répartition
              </button>
            </div>
          </section>
        }

        @if (historique().length) {
          <section class="card">
            <div class="card-body">
              <h2 class="h5 card-title">Historique des {{ etat.vocabulaire().parts }}</h2>
              <p class="text-body-secondary small">
                Rien n'est écrasé : chaque changement ferme une période et en ouvre une autre.
              </p>
              <ul class="list-group list-group-flush">
                @for (l of historique(); track l.id) {
                  <li class="list-group-item d-flex gap-3 flex-wrap px-0">
                    <span class="text-body-secondary tnum flex-shrink-0" style="font-size:.78rem;width:190px">
                      {{ dateLongue(l.effetDu) }} → {{ l.effetAu ? dateLongue(l.effetAu) : 'aujourd\\'hui' }}
                    </span>
                    <span class="small flex-grow-1" style="min-width:120px">{{ l.nom }}</span>
                    <span class="small tnum">{{ l.parts }} part{{ l.parts > 1 ? 's' : '' }}</span>
                    <span class="text-body-secondary w-100" style="font-size:.72rem">{{ l.motif }}</span>
                  </li>
                }
              </ul>
            </div>
          </section>
        }
      }

      <section class="card">
        <div class="card-body">
          <div class="eyebrow mb-3">Ce que chaque rôle peut faire</div>
          <div class="row row-cols-1 row-cols-sm-2 row-cols-xl-4 g-3">
            <div class="col">
              <h3 class="h6 mb-1">Gérant</h3>
              <p class="text-body-secondary small mb-0">Arbitre les demandes, saisit un séjour pour quelqu'un d'autre,
                 modifie la répartition, gère les biens et les réglages.</p>
            </div>
            <div class="col">
              <h3 class="h6 mb-1">{{ majuscule(etat.vocabulaire().detenteurs.replace(/s$/, '')) }}</h3>
              <p class="text-body-secondary small mb-0">Voit le calendrier et l'historique, demande un séjour,
                 dépose ses voeux, consulte la répartition.</p>
            </div>
            <div class="col">
              <h3 class="h6 mb-1">Membre de foyer</h3>
              <p class="text-body-secondary small mb-0">Voit le calendrier et la fiche du bien, demande un séjour.
                 La répartition chiffrée dépend d'un réglage.</p>
            </div>
            <div class="col">
              <h3 class="h6 mb-1">Invité</h3>
              <p class="text-body-secondary small mb-0">Accède par un lien limité dans le temps, sans compte,
                 et ne voit que ce qui concerne son séjour.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  `,
})
export class Membres {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);
  readonly initiales = initiales;
  readonly dateLongue = dateLongue;

  readonly structure = signal<Structure | null>(null);
  readonly historique = signal<LigneDetention[]>([]);
  readonly personnes = signal<Personne[]>([]);
  readonly lignes = signal<{ cle: number; personneId: number; parts: number }[]>([]);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  dateEffet = aujourdhui();
  motif = '';
  private compteur = 0;

  readonly majuscule = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

  readonly structureId = computed(() => this.etat.bien()?.structureId ?? 0);

  constructor() {
    effect(() => { const id = this.structureId(); if (id) void this.charger(id); });
  }

  private async charger(structureId: number): Promise<void> {
    const s = await this.api.get<Structure>(`/structures/${structureId}`).catch(() => null);
    this.structure.set(s);
    if (!this.etat.estGeranteIci()) return;

    const [histo, personnes] = await Promise.all([
      this.api.get<{ lignes: LigneDetention[]; actuelle: { personneId: number; parts: number }[] }>(
        `/structures/${structureId}/detentions`).catch(() => null),
      this.api.get<Personne[]>('/personnes').catch(() => [] as Personne[]),
    ]);
    this.personnes.set(personnes);
    this.historique.set(histo?.lignes ?? []);
    // Le formulaire part de la répartition en vigueur : on la corrige, on ne la
    // retape pas.
    this.lignes.set((histo?.actuelle ?? []).map((a) => ({ cle: this.compteur++, personneId: a.personneId, parts: a.parts })));
    if (!this.lignes().length) {
      // Aucune répartition saisie : la première ligne part sur soi-même, parce
      // que c'est le cas de figure au premier jour, et qu'un « Choisir... »
      // vide oblige à un geste de plus pour rien.
      const moi = this.etat.moi()?.personne.id ?? 0;
      this.lignes.set([{ cle: this.compteur++, personneId: moi, parts: 1 }]);
    }
  }

  ajouterLigne(): void {
    this.lignes.update((l) => [...l, { cle: this.compteur++, personneId: 0, parts: 1 }]);
  }

  retirerLigne(cle: number): void {
    this.lignes.update((l) => l.filter((x) => x.cle !== cle));
  }

  async enregistrer(): Promise<void> {
    const id = this.structureId();
    if (!id || this.occupe()) return;
    const parts = this.lignes().filter((l) => l.personneId > 0)
      .map((l) => ({ personneId: Number(l.personneId), parts: Number(l.parts) }));
    if (!parts.length) { this.erreur.set('Indiquez au moins une personne et ses parts.'); return; }

    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try {
      await this.api.post(`/structures/${id}/detentions`, { dateEffet: this.dateEffet, motif: this.motif, parts });
      this.message.set(`Répartition enregistrée avec effet au ${dateLongue(this.dateEffet)}.`);
      this.motif = '';
      await this.charger(id);
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'enregistrement a échoué.");
    } finally {
      this.occupe.set(false);
    }
  }
}
