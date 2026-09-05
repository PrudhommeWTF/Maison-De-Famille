// Le carnet d'entretien : les obligations récurrentes, les tâches ouvertes et
// l'historique des interventions.
//
// La maquette fixe la structure : « Tâches ouvertes » en pleine largeur,
// « Récurrences » et « Checklist de départ » côte à côte en dessous. Elle fixe
// aussi les quatre catégories et leurs couleurs.
//
// **Cocher une tâche demande une date.** C'est la note de comportement, et ce
// n'est pas une formalité : une haie taillée le 12 juin et cochée le
// 3 septembre reste taillée le 12. Un carnet d'entretien qui daterait tout au
// jour du clic ne servirait à rien face à un assureur.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import { aujourdhui, dateLongue, euros } from '../core/format';

type Categorie = 'obligatoire' | 'saison' | 'courant' | 'inventaire';
type Urgence = 'en_retard' | 'proche' | 'plus_tard';

interface Tache {
  id: number; libelle: string; detail: string; categorie: Categorie;
  echeance: string | null; statut: string; faitLe: string | null; faitParNom: string | null;
  coutCents: number | null; signaleParNom: string | null; urgence?: Urgence;
}
interface Recurrence { id: number; libelle: string; categorie: Categorie; lisible: string }
interface LigneChecklist { id: number; libelle: string }
interface Carnet {
  ouvertes: Tache[]; historique: Tache[]; recurrences: Recurrence[];
  checklist: LigneChecklist[]; inventaire: { id: number; libelle: string; etat: string }[];
}

const LIBELLE_CATEGORIE: Record<Categorie, string> = {
  obligatoire: 'Obligatoire', saison: 'Saison', courant: 'Courant', inventaire: 'Inventaire',
};

@Component({
  selector: 'app-entretien',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .tache { display: flex; gap: 12px; align-items: flex-start; padding: 12px 0;
             border-bottom: 1px solid var(--separateur); }
    .tache:last-child { border-bottom: none; }
    .tache .coche { width: 20px; height: 20px; flex: none; border: 1.5px solid var(--bordure);
                    border-radius: 6px; background: transparent; cursor: pointer; margin-top: 2px; }
    .tache .coche:hover { border-color: var(--accent); }
    .tache .quoi { flex: 1; min-width: 180px; }
    .tache .libelle { font-size: 14px; display: block; }
    .tache .meta { font-size: 12.5px; color: var(--encre-3); }
    .cat-obligatoire { background: #f0e0d5; color: #8d4a2e; }
    .cat-saison { background: #e5e8ea; color: #3f545f; }
    .cat-courant, .cat-inventaire { background: #f2ede5; color: #6b6157; }
    .retard { color: #8d4a2e; font-weight: 500; }
    .deux { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .ligne-r { display: flex; justify-content: space-between; gap: 12px; padding: 9px 0;
               border-top: 1px solid var(--separateur); font-size: 13px; }
    .ligne-r:first-of-type { border-top: none; }
    /* Une action textuelle discrète : la maquette n'en définit pas, et un
       bouton plein pour « retirer » écraserait la ligne qu'il accompagne. */
    .lien { border: none; background: none; padding: 0; font: inherit; font-size: 12.5px;
            color: var(--encre-3); text-decoration: underline; cursor: pointer; }
    .lien:hover { color: var(--accent); }
    .saisie { display: grid; grid-template-columns: 1fr 150px 150px auto; gap: 10px; align-items: end; }
    .cocher { display: grid; grid-template-columns: 150px 130px auto auto; gap: 10px; align-items: end; }
    @media (max-width: 860px) {
      .deux, .saisie, .cocher { grid-template-columns: 1fr; }
    }
  `],
  template: `
    <div class="colonne">
      <div>
        <h1>Carnet d'entretien</h1>
        <p class="secondaire" style="margin:6px 0 0">
          Les obligations récurrentes, les tâches ouvertes et l'historique des interventions.
        </p>
      </div>

      @if (erreur()) { <div class="encart">{{ erreur() }}</div> }
      @if (message()) { <div class="encart-positif">{{ message() }}</div> }

      @if (carnet(); as c) {
        <section class="carte">
          <div class="entre">
            <h2><i class="bi bi-tools" aria-hidden="true"></i> Tâches ouvertes</h2>
            <span class="pastille">{{ c.ouvertes.length }}</span>
          </div>

          @if (!c.ouvertes.length) {
            <p class="secondaire" style="margin:10px 0 0">Rien en attente.</p>
          }
          @for (t of c.ouvertes; track t.id) {
            <div class="tache">
              @if (gerant()) {
                <button class="coche" type="button" [attr.aria-label]="'Cocher ' + t.libelle"
                        (click)="ouvrirCochage(t)"></button>
              }
              <span class="quoi">
                <span class="libelle">{{ t.libelle }}</span>
                <span class="meta">
                  @if (t.echeance) {
                    <span [class.retard]="t.urgence === 'en_retard'">
                      {{ t.urgence === 'en_retard' ? 'En retard depuis le' : 'Avant le' }}
                      {{ dateLongue(t.echeance) }}
                    </span>
                  } @else { Sans date limite }
                  @if (t.signaleParNom) { · signalé par {{ t.signaleParNom }} }
                  @if (t.detail) { · {{ t.detail }} }
                </span>
              </span>
              <span class="pastille" [class]="'pastille cat-' + t.categorie">{{ categorie(t.categorie) }}</span>
            </div>

            @if (cochage() === t.id) {
              <form class="cocher" style="padding:10px 0 14px" (ngSubmit)="cocher(t)">
                <div>
                  <label [attr.for]="'d-' + t.id">Fait le</label>
                  <input [attr.id]="'d-' + t.id" type="date" [name]="'d-' + t.id"
                         [(ngModel)]="fFaitLe" [max]="aujourdhui()" required>
                </div>
                <div>
                  <label [attr.for]="'c-' + t.id">Coût (euros)</label>
                  <input [attr.id]="'c-' + t.id" type="number" min="0" step="0.01"
                         [name]="'c-' + t.id" [(ngModel)]="fCout" placeholder="facultatif">
                </div>
                <label class="btn">
                  <i class="bi bi-paperclip" aria-hidden="true"></i>
                  {{ fFactureNom || 'Facture' }}
                  <input type="file" accept="image/*,application/pdf" style="display:none"
                         (change)="choisirFacture($event)">
                </label>
                <button class="btn btn-primaire" type="submit" [disabled]="occupe()">Enregistrer</button>
              </form>
            }
          }
        </section>

        <div class="deux">
          <section class="carte">
            <h2>Récurrences</h2>
            <p class="secondaire" style="margin:4px 0 10px">
              Chacune engendre sa tâche avec sa date limite, d'elle-même.
            </p>
            @for (r of c.recurrences; track r.id) {
              <div class="ligne-r">
                <span>{{ r.libelle }}</span>
                <span style="color:var(--encre-3);text-align:right">
                  {{ r.lisible }}
                  @if (gerant()) {
                    <button class="lien" type="button" style="margin-left:8px"
                            (click)="supprimerRecurrence(r)">Retirer</button>
                  }
                </span>
              </div>
            }
            @if (!c.recurrences.length) {
              <p class="secondaire" style="margin:0">Aucune récurrence.</p>
            }

            @if (gerant()) {
              <details style="margin-top:12px">
                <summary class="secondaire" style="cursor:pointer;font-size:13px">Ajouter une récurrence</summary>
                <form class="saisie" style="margin-top:10px;grid-template-columns:1fr 1fr" (ngSubmit)="ajouterRecurrence()">
                  <div>
                    <label for="r-lib">Intitulé</label>
                    <input id="r-lib" name="rlib" [(ngModel)]="fRecLibelle" placeholder="Ramonage de la cheminée">
                  </div>
                  <div>
                    <label for="r-cat">Catégorie</label>
                    <select id="r-cat" name="rcat" [(ngModel)]="fRecCategorie">
                      @for (k of CATEGORIES; track k) { <option [value]="k">{{ categorie(k) }}</option> }
                    </select>
                  </div>
                  <div>
                    <label for="r-per">Rythme</label>
                    <select id="r-per" name="rper" [(ngModel)]="fRecPeriodicite">
                      <option value="annuelle">Tous les ans</option>
                      <option value="mensuelle">Tous les mois</option>
                      <option value="sejour">À chaque séjour</option>
                    </select>
                  </div>
                  @if (fRecPeriodicite === 'annuelle') {
                    <div>
                      <label for="r-lim">Avant le (mois-jour)</label>
                      <input id="r-lim" name="rlim" [(ngModel)]="fRecLimite" placeholder="10-15">
                    </div>
                  }
                  @if (fRecPeriodicite === 'mensuelle') {
                    <div>
                      <label for="r-md">De (mois)</label>
                      <input id="r-md" name="rmd" type="number" min="1" max="12" [(ngModel)]="fRecMoisDebut">
                    </div>
                    <div>
                      <label for="r-mf">À (mois)</label>
                      <input id="r-mf" name="rmf" type="number" min="1" max="12" [(ngModel)]="fRecMoisFin">
                    </div>
                  }
                  <button class="btn btn-primaire" type="submit"
                          [disabled]="occupe() || !fRecLibelle.trim()">Ajouter</button>
                </form>
              </details>
            }
          </section>

          <section class="carte">
            <h2><i class="bi bi-list-check" aria-hidden="true"></i> Checklist de départ</h2>
            <p class="secondaire" style="margin:4px 0 10px">
              Envoyée automatiquement la veille de chaque fin de séjour, à l'occupant.
            </p>
            <ul style="margin:0;padding-left:20px;font-size:13px;line-height:1.9">
              @for (l of c.checklist; track l.id) {
                <li>
                  {{ l.libelle }}
                  @if (gerant()) {
                    <button class="lien" type="button" (click)="supprimerChecklist(l)">retirer</button>
                  }
                </li>
              }
            </ul>
            @if (!c.checklist.length) {
              <p class="secondaire" style="margin:0">
                Aucune ligne : rien ne partira. Ajoutez ce qu'il faut vérifier avant de fermer la maison.
              </p>
            }
            @if (gerant()) {
              <form class="saisie" style="margin-top:12px;grid-template-columns:1fr auto"
                    (ngSubmit)="ajouterChecklist()">
                <div>
                  <label for="k-lib">Ajouter une ligne</label>
                  <input id="k-lib" name="klib" [(ngModel)]="fChecklist"
                         placeholder="Compteur d'eau relevé et vanne fermée">
                </div>
                <button class="btn" type="submit" [disabled]="occupe() || !fChecklist.trim()">Ajouter</button>
              </form>
            }
          </section>
        </div>

        @if (c.historique.length) {
          <section class="carte">
            <h2>Historique des interventions</h2>
            @for (t of c.historique; track t.id) {
              <div class="tache">
                <span class="quoi">
                  <span class="libelle">{{ t.libelle }}</span>
                  <span class="meta">
                    Fait le {{ dateLongue(t.faitLe!) }}
                    @if (t.faitParNom) { par {{ t.faitParNom }} }
                    @if (t.coutCents !== null) { · {{ euros(t.coutCents) }} }
                  </span>
                </span>
                <span class="pastille" [class]="'pastille cat-' + t.categorie">{{ categorie(t.categorie) }}</span>
              </div>
            }
          </section>
        }
      }
    </div>
  `,
})
export class Entretien {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);
  readonly dateLongue = dateLongue;
  readonly aujourdhui = aujourdhui;
  readonly euros = euros;
  readonly CATEGORIES: Categorie[] = ['obligatoire', 'saison', 'courant', 'inventaire'];

  readonly carnet = signal<Carnet | null>(null);
  readonly cochage = signal<number | null>(null);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  fFaitLe = aujourdhui();
  fCout: number | null = null;
  fFactureNom = '';
  private fFactureContenu = '';

  fRecLibelle = '';
  fRecCategorie: Categorie = 'obligatoire';
  fRecPeriodicite = 'annuelle';
  fRecLimite = '';
  fRecMoisDebut: number | null = null;
  fRecMoisFin: number | null = null;
  fChecklist = '';

  readonly gerant = computed(() => this.etat.estGeranteIci());
  readonly categorie = (c: Categorie): string => LIBELLE_CATEGORIE[c] ?? c;

  constructor() {
    effect(() => { const b = this.etat.bien(); if (b) void this.charger(b.id); });
  }

  private async charger(bienId: number): Promise<void> {
    this.carnet.set(await this.api.get<Carnet>(`/biens/${bienId}/entretien`).catch(() => null));
  }

  private async tenter(quoi: () => Promise<string>): Promise<void> {
    const b = this.etat.bien();
    if (!b || this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try {
      this.message.set(await quoi());
      await this.charger(b.id);
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'opération a échoué.");
    } finally {
      this.occupe.set(false);
    }
  }

  ouvrirCochage(t: Tache): void {
    this.cochage.set(this.cochage() === t.id ? null : t.id);
    this.fFaitLe = aujourdhui();
    this.fCout = null;
    this.fFactureNom = '';
    this.fFactureContenu = '';
  }

  choisirFacture(e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const lecteur = new FileReader();
    lecteur.onload = () => {
      this.fFactureNom = f.name;
      this.fFactureContenu = String(lecteur.result).split(',')[1] ?? '';
    };
    lecteur.readAsDataURL(f);
  }

  cocher(t: Tache): Promise<void> {
    const b = this.etat.bien();
    if (!b) return Promise.resolve();
    return this.tenter(async () => {
      let fichierId = '';
      if (this.fFactureContenu) {
        const f = await this.api.post<{ id: string }>(`/biens/${b.id}/entretien/facture`,
          { nom: this.fFactureNom, contenu: this.fFactureContenu });
        fichierId = f.id;
      }
      await this.api.post(`/biens/${b.id}/taches/${t.id}/realisation`, {
        faitLe: this.fFaitLe,
        // Les euros saisis deviennent des centimes : le serveur ne manipule que
        // des entiers, pour la même raison que la comptabilité de la tranche 2.
        coutCents: this.fCout === null || this.fCout === undefined ? null : Math.round(this.fCout * 100),
        fichierId,
      });
      this.cochage.set(null);
      return `« ${t.libelle} » enregistré comme fait le ${dateLongue(this.fFaitLe)}.`;
    });
  }

  ajouterRecurrence(): Promise<void> {
    const b = this.etat.bien();
    if (!b || !this.fRecLibelle.trim()) return Promise.resolve();
    return this.tenter(async () => {
      await this.api.post(`/biens/${b.id}/recurrences`, {
        libelle: this.fRecLibelle.trim(), categorie: this.fRecCategorie,
        periodicite: this.fRecPeriodicite,
        limiteMmjj: this.fRecPeriodicite === 'annuelle' ? this.fRecLimite : '',
        moisDebut: this.fRecPeriodicite === 'mensuelle' ? this.fRecMoisDebut : null,
        moisFin: this.fRecPeriodicite === 'mensuelle' ? this.fRecMoisFin : null,
      });
      const nom = this.fRecLibelle.trim();
      this.fRecLibelle = '';
      return `Récurrence « ${nom} » ajoutée, sa première échéance est posée.`;
    });
  }

  supprimerRecurrence(r: Recurrence): Promise<void> {
    const b = this.etat.bien();
    if (!b) return Promise.resolve();
    return this.tenter(async () => {
      await this.api.post(`/biens/${b.id}/recurrences/${r.id}/archivage`, {});
      return `Récurrence « ${r.libelle} » retirée. L'historique des interventions passées reste.`;
    });
  }

  ajouterChecklist(): Promise<void> {
    const b = this.etat.bien();
    if (!b || !this.fChecklist.trim()) return Promise.resolve();
    return this.tenter(async () => {
      await this.api.post(`/biens/${b.id}/checklist`,
        { libelle: this.fChecklist.trim(), ordre: (this.carnet()?.checklist.length ?? 0) + 1 });
      this.fChecklist = '';
      return 'Ligne ajoutée à la checklist de départ.';
    });
  }

  supprimerChecklist(l: LigneChecklist): Promise<void> {
    const b = this.etat.bien();
    if (!b) return Promise.resolve();
    return this.tenter(async () => {
      await this.api.post(`/biens/${b.id}/checklist/${l.id}/archivage`, {});
      return 'Ligne retirée.';
    });
  }
}
