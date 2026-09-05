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
  styles: [`
    .regle { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--separateur); }
    .regle:first-of-type { border-top: none; }
    .regle .nom { flex: 1; font-size: 13.5px; }
    .pastille-regle {
      border: none; font-family: inherit; cursor: pointer; min-height: 32px;
      padding: 5px 12px; border-radius: 20px; background: var(--pastille-neutre);
      color: var(--encre-3); font-size: 12px;
    }
    .pastille-regle:hover { background: var(--actif); color: var(--encre); }
    .pastille-regle:disabled { cursor: default; }

    .depense { display: flex; align-items: center; gap: 12px; width: 100%; padding: 11px 8px;
               margin: 0 -8px; border: none; background: none; border-radius: 9px;
               text-align: left; font-family: inherit; color: inherit; cursor: pointer;
               border-bottom: 1px solid var(--separateur); }
    .depense:hover { background: var(--survol-liste); }
    .depense .date { width: 64px; flex: none; font-size: 12px; color: var(--encre-3); }
    .depense .corps { flex: 1; min-width: 0; }
    .depense .libelle { font-size: 13.5px; display: block; }
    .depense .montant { width: 96px; flex: none; text-align: right; font-size: 14px; }
    .depense.annulee .libelle, .depense.annulee .montant { text-decoration: line-through; color: var(--encre-faible); }

    .explication { background: var(--pastille-neutre); border-radius: 12px; padding: 14px 16px; margin-top: 12px; }
    .explication pre { margin: 0; font-family: inherit; font-size: 12.5px; white-space: pre-wrap; line-height: 1.7; }
    .part { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid var(--separateur); }
    .part:first-child { border-top: none; }

    .deux { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 640px) {
      .deux { grid-template-columns: 1fr; }
      .depense { flex-wrap: wrap; }
      .depense .montant { width: auto; margin-left: auto; }
    }
  `],
  template: `
    <div class="colonne">
      <div class="entre">
        <div>
          <h1>Dépenses et répartition</h1>
          <p class="secondaire" style="margin:6px 0 0">
            {{ etat.bien()?.nom }} · exercice {{ annee() }}
          </p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" (click)="changerAnnee(-1)">{{ annee() - 1 }}</button>
          <button class="btn" (click)="changerAnnee(1)">{{ annee() + 1 }}</button>
          @if (etat.estGeranteIci()) {
            <button class="btn btn-primaire" (click)="ouvrirSaisie()">
              <i class="bi bi-plus-circle" aria-hidden="true"></i> Saisir une dépense
            </button>
          }
        </div>
      </div>

      @if (erreur()) { <div class="encart">{{ erreur() }}</div> }
      @if (message()) { <div class="encart-positif">{{ message() }}</div> }

      @if (saisie()) {
        <section class="carte">
          <h2>Saisir une dépense</h2>
          <p class="secondaire" style="margin:6px 0 16px">
            La répartition est calculée à l'enregistrement, avec les
            {{ etat.vocabulaire().parts }} en vigueur à la date de la dépense, puis
            <strong>figée</strong>. Un changement de parts ultérieur ne la modifiera pas.
          </p>
          <form (ngSubmit)="enregistrer()">
            <div class="deux">
              <div class="champ">
                <label for="d-date">Date de la dépense</label>
                <input id="d-date" name="dateDepense" type="date" [(ngModel)]="f.dateDepense" required>
              </div>
              <div class="champ">
                <label for="d-montant">Montant en euros</label>
                <input id="d-montant" name="montant" type="text" inputmode="decimal"
                       [(ngModel)]="f.montant" placeholder="2340,00" required>
              </div>
            </div>
            <div class="champ">
              <label for="d-libelle">Libellé</label>
              <input id="d-libelle" name="libelle" [(ngModel)]="f.libelle" placeholder="Taxe foncière 2026" required>
            </div>
            <div class="deux">
              <div class="champ">
                <label for="d-cat">Catégorie</label>
                <select id="d-cat" name="categorieId" [(ngModel)]="f.categorieId">
                  @for (c of categories(); track c.id) { <option [ngValue]="c.id">{{ c.libelle }}</option> }
                </select>
                <p class="meta" style="margin-top:4px">Règle appliquée : {{ regleDe(f.categorieId) }}</p>
              </div>
              <div class="champ">
                <label for="d-paye">Payée par</label>
                <select id="d-paye" name="payePar" [(ngModel)]="f.payePar">
                  <option value="structure">Le compte commun</option>
                  <option value="personne">Une personne, qui a avancé</option>
                </select>
              </div>
            </div>
            @if (f.payePar === 'personne') {
              <div class="champ">
                <label for="d-avance">Qui a avancé</label>
                <select id="d-avance" name="avanceParId" [(ngModel)]="f.avanceParId">
                  <option [ngValue]="0">Choisir...</option>
                  @for (p of personnes(); track p.id) { <option [ngValue]="p.id">{{ p.nom }}</option> }
                </select>
              </div>
            }
            <div class="champ">
              <label>Justificatif (photo ou PDF)</label>
              @if (justificatif()) {
                <div class="encart-positif">{{ justificatif()!.nom }} joint.</div>
              } @else {
                <input type="file" accept="image/*,application/pdf" (change)="joindre($event)">
              }
            </div>
            <div class="champ">
              <label for="d-note">Note</label>
              <textarea id="d-note" name="note" [(ngModel)]="f.note" maxlength="1000"></textarea>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-primaire" type="submit" [disabled]="occupe()">Enregistrer</button>
              <button class="btn" type="button" (click)="saisie.set(false)">Annuler</button>
            </div>
          </form>
        </section>
      }

      <section class="carte">
        <div class="entre">
          <h2>Dépenses {{ annee() }} · {{ euros(liste()?.total ?? 0) }}</h2>
          <button class="btn" (click)="exporter()" [disabled]="occupe()">
            <i class="bi bi-filetype-csv" aria-hidden="true"></i> Exporter
          </button>
        </div>

        @if (depenses().length) {
          <div style="margin-top:10px">
            @for (d of depenses(); track d.id) {
              <button class="depense" [class.annulee]="d.statut === 'annulee'" (click)="ouvrir(d)"
                      [attr.aria-expanded]="detail()?.depense?.id === d.id">
                <span class="date chiffres">{{ dateCourte(d.dateDepense) }}</span>
                <span class="corps">
                  <span class="libelle">{{ d.libelle }}</span>
                  <span class="meta">
                    {{ d.categorieLibelle }} · {{ nomBiens(d) }} ·
                    {{ d.payePar === 'personne' ? 'avancé par ' + d.avanceParNom : 'compte commun' }}
                  </span>
                </span>
                @if (d.regleAppliquee) { <span class="pastille">{{ libelleRegle(d.regleAppliquee) }}</span> }
                <span class="montant chiffres">{{ euros(d.partVisibleCents) }}</span>
              </button>

              @if (detail(); as det) {
                @if (det.depense.id === d.id) {
                  <div class="explication">
                    <h3>Détail du calcul</h3>
                    <div style="margin:10px 0 14px">
                      @for (v of det.ventilation; track v.personneId) {
                        <div class="part">
                          <span>{{ v.nom }}</span>
                          <span class="chiffres">{{ euros(v.montantCents) }}</span>
                        </div>
                      }
                    </div>
                    <pre>{{ det.explication.join('\n') }}</pre>

                    @if (det.recalculs.length) {
                      <h3 style="margin-top:14px">Recalculs</h3>
                      @for (rc of det.recalculs; track rc.faitLe) {
                        <p class="meta" style="margin:4px 0">
                          {{ dateLongue(rc.faitLe.slice(0, 10)) }}{{ rc.parNom ? ', par ' + rc.parNom : '' }} :
                          {{ rc.motif }}
                        </p>
                      }
                    }

                    @if (det.depense.justificatifId) {
                      <p style="margin-top:12px">
                        <a class="btn" [href]="urlFichier(det.depense.justificatifId!)" target="_blank" rel="noopener">
                          <i class="bi bi-paperclip" aria-hidden="true"></i> Voir le justificatif
                        </a>
                      </p>
                    }

                    @if (etat.estGeranteIci() && det.depense.statut !== 'annulee') {
                      <div class="separateur" style="margin:14px 0 12px"></div>
                      <div class="champ" style="max-width:420px;margin:0">
                        <label [attr.for]="'motif-' + d.id">Recalculer, en disant pourquoi</label>
                        <input [attr.id]="'motif-' + d.id" name="motif" [(ngModel)]="motif"
                               placeholder="La succession a été rectifiée par le notaire">
                      </div>
                      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
                        <button class="btn" (click)="recalculer(d)" [disabled]="occupe() || !motif.trim()">
                          Recalculer la répartition
                        </button>
                        <button class="btn-lien" (click)="annuler(d)">Annuler cette dépense</button>
                      </div>
                      <p class="meta" style="margin-top:8px">
                        L'ancienne répartition est conservée : c'est ce qui permet de répondre
                        à « pourquoi ce chiffre a changé ».
                      </p>
                    }
                  </div>
                }
              }
            }
          </div>
        } @else {
          <p class="vide">Aucune dépense enregistrée sur cet exercice.</p>
        }
      </section>

      <section class="carte">
        <h2>Règles de répartition</h2>
        <p class="secondaire" style="margin:6px 0 12px">
          Chaque catégorie porte sa règle. La changer <strong>ne recalcule pas</strong> les dépenses
          déjà saisies : elle ouvre une nouvelle période à partir d'aujourd'hui.
        </p>
        @for (r of regles(); track r.categorieId) {
          <div class="regle">
            <span class="nom">{{ r.categorieLibelle }}</span>
            @if (!r.parDefaut) {
              <span class="meta">depuis le {{ dateLongue(r.applicableDu) }}</span>
            }
            <button class="pastille-regle" [disabled]="!etat.estGeranteIci() || occupe()"
                    (click)="cyclerRegle(r)"
                    [attr.aria-label]="'Règle de ' + r.categorieLibelle + ' : ' + libelleRegle(r.regle)">
              {{ libelleRegle(r.regle) }}
            </button>
          </div>
        }
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
