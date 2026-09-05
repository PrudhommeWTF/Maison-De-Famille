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
  styles: [`
    .detenteur { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--separateur); }
    .detenteur:last-child { border-bottom: none; }
    .detenteur .nom { font-size: 14px; }
    .detenteur .part { margin-left: auto; text-align: right; }
    .detenteur .part .valeur { font-family: var(--titre); font-size: 17px; font-weight: 500; }
    .histo { font-size: 13px; }
    .histo .ligne-h { display: flex; gap: 12px; padding: 9px 0; border-top: 1px solid var(--separateur); flex-wrap: wrap; }
    .histo .periode { width: 190px; flex: none; color: var(--encre-3); font-size: 12px; }
    .roles { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; }
    .role h3 { font-size: 14px; margin-bottom: 5px; }
    .role p { font-size: 12.5px; color: var(--encre-3); margin: 0; }
    .saisie { display: grid; grid-template-columns: 1fr 100px auto; gap: 10px; align-items: end; margin-bottom: 10px; }
    @media (max-width: 640px) {
      .saisie { grid-template-columns: 1fr; }
      .histo .periode { width: 100%; }
    }
  `],
  template: `
    <div class="colonne">
      <div>
        <h1>Membres et {{ etat.vocabulaire().parts }}</h1>
        <p class="secondaire" style="margin:6px 0 0">{{ structure()?.structure?.nom }}</p>
      </div>

      @if (erreur()) { <div class="encart">{{ erreur() }}</div> }
      @if (message()) { <div class="encart-positif">{{ message() }}</div> }

      @if (structure(); as s) {
        <section class="carte">
          <div class="entre">
            <h2>{{ majuscule(etat.vocabulaire().detenteurs) }}</h2>
            <span class="pastille">{{ s.regles[0]?.libelle }}</span>
          </div>

          @if (s.detenteurs.length) {
            <div style="margin-top:8px">
              @for (d of s.detenteurs; track d.personneId) {
                <div class="detenteur">
                  <span class="avatar">{{ initiales(d.nom) }}</span>
                  <span>
                    <span class="nom" style="display:block">{{ d.nom }}</span>
                    <span class="meta">{{ d.foyerNom || 'Sans foyer' }}</span>
                  </span>
                  <span class="pastille" [class.pastille-accent]="d.role === 'gerant'">
                    {{ d.role === 'gerant' ? 'Gérant' : majuscule(etat.vocabulaire().detenteurs.replace(/s$/, '')) }}
                  </span>
                  @if (s.partsVisibles) {
                    <span class="part">
                      <span class="valeur chiffres">{{ d.quotePart }}</span>
                      <span class="meta" style="display:block">{{ d.parts }} / {{ d.total }}</span>
                    </span>
                  }
                </div>
              }
            </div>
          } @else {
            <p class="vide">
              Aucune répartition n'est encore saisie. Elle porte une date d'effet (une succession, un
              acte notarié) qu'aucun amorçage ne peut deviner : c'est à vous de l'entrer.
            </p>
          }
          @if (!s.partsVisibles) {
            <p class="meta" style="margin-top:12px">
              La répartition chiffrée n'est pas affichée aux membres de foyer. Un gérant peut changer
              ce réglage dans la page Réglages.
            </p>
          }
        </section>

        @if (etat.estGeranteIci()) {
          <section class="carte">
            <h2>Modifier la répartition</h2>
            <p class="secondaire" style="margin:6px 0 14px">
              Les {{ etat.vocabulaire().parts }} sont des <strong>nombres entiers</strong> : une indivision à
              parts égales entre quatre s'écrit 1, 1, 1, 1 ; une SCI de 300 parts s'écrit 120, 90, 90.
              La date d'effet est celle de l'acte, pas celle de la saisie : les dépenses antérieures
              garderont la répartition d'alors.
            </p>

            @for (l of lignes(); track l.cle) {
              <div class="saisie">
                <div class="champ" style="margin:0">
                  <label [attr.for]="'p-' + l.cle">Personne</label>
                  <select [attr.id]="'p-' + l.cle" [(ngModel)]="l.personneId" [name]="'p-' + l.cle">
                    <option [ngValue]="0">Choisir...</option>
                    @for (p of personnes(); track p.id) { <option [ngValue]="p.id">{{ p.nom }}</option> }
                  </select>
                </div>
                <div class="champ" style="margin:0">
                  <label [attr.for]="'n-' + l.cle">Parts</label>
                  <input [attr.id]="'n-' + l.cle" type="number" min="1" [(ngModel)]="l.parts" [name]="'n-' + l.cle">
                </div>
                <button class="btn" type="button" (click)="retirerLigne(l.cle)" aria-label="Retirer cette ligne">
                  <i class="bi bi-x-lg" aria-hidden="true"></i>
                </button>
              </div>
            }
            <button class="btn" type="button" (click)="ajouterLigne()" style="margin-bottom:14px">
              <i class="bi bi-plus-circle" aria-hidden="true"></i> Ajouter une personne
            </button>

            <div class="champ">
              <label for="d-effet">Date d'effet</label>
              <input id="d-effet" name="dateEffet" type="date" [(ngModel)]="dateEffet" required>
            </div>
            <div class="champ">
              <label for="d-motif">Motif</label>
              <input id="d-motif" name="motif" [(ngModel)]="motif"
                     placeholder="Succession de Robert Prudhomme, rachat des parts de Julien..." required>
            </div>
            <button class="btn btn-primaire" (click)="enregistrer()" [disabled]="occupe()">
              Enregistrer la répartition
            </button>
          </section>
        }

        @if (historique().length) {
          <section class="carte">
            <h2>Historique des {{ etat.vocabulaire().parts }}</h2>
            <p class="secondaire" style="margin:6px 0 10px">
              Rien n'est écrasé : chaque changement ferme une période et en ouvre une autre.
            </p>
            <div class="histo">
              @for (l of historique(); track l.id) {
                <div class="ligne-h">
                  <span class="periode chiffres">
                    {{ dateLongue(l.effetDu) }} → {{ l.effetAu ? dateLongue(l.effetAu) : 'aujourd\\'hui' }}
                  </span>
                  <span style="flex:1;min-width:120px">{{ l.nom }}</span>
                  <span class="chiffres">{{ l.parts }} part{{ l.parts > 1 ? 's' : '' }}</span>
                  <span class="meta" style="width:100%">{{ l.motif }}</span>
                </div>
              }
            </div>
          </section>
        }
      }

      <section class="carte">
        <h2>Ce que chaque rôle peut faire</h2>
        <div class="roles" style="margin-top:14px">
          <div class="role">
            <h3>Gérant</h3>
            <p>Arbitre les demandes, saisit un séjour pour quelqu'un d'autre, modifie la répartition,
               gère les biens et les réglages.</p>
          </div>
          <div class="role">
            <h3>{{ majuscule(etat.vocabulaire().detenteurs.replace(/s$/, '')) }}</h3>
            <p>Voit le calendrier et l'historique, demande un séjour, dépose ses voeux, consulte la
               répartition.</p>
          </div>
          <div class="role">
            <h3>Membre de foyer</h3>
            <p>Voit le calendrier et la fiche du bien, demande un séjour. La répartition chiffrée
               dépend d'un réglage.</p>
          </div>
          <div class="role">
            <h3>Invité</h3>
            <p>Accède par un lien limité dans le temps, sans compte, et ne voit que ce qui concerne
               son séjour.</p>
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
