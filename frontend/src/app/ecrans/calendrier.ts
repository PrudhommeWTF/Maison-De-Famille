// Le calendrier d'occupation, et la demande de séjour.
//
// C'est l'écran qui remplace le fichier Excel, donc celui qui doit se
// comprendre sans explication. Trois choses le rendent lisible :
//
//   - une **légende** à quatre entrées, aux couleurs de la maquette ;
//   - un **libellé affiché seulement le premier jour** d'une plage ;
//   - une **bannière de conflit** qui n'apparaît que s'il y a un chevauchement
//     réel et non arbitré sur ce bien.
//
// La demande se saisit dans le même écran, et les conflits sont vérifiés
// **avant l'envoi**, auprès du serveur : refaire la règle ici la ferait diverger.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import { Case, OccupationGrille, grilleDuMois, occupationsDuMois } from '../core/calendrier';
import {
  aujourdhui, dateLongue, enTetesJours, moisPrecedent, moisSuivant, nomMois,
  nuitsEntre, nuitsLisible, personnesLisible, plage,
} from '../core/format';
import type { Conflit, Sejour, Verification } from '../core/modeles';

@Component({
  selector: 'app-calendrier',
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .mois { display: flex; align-items: center; gap: 10px; }
    .mois button { width: 34px; height: 34px; min-height: 34px; padding: 0; border-radius: 8px; }
    .mois .titre { font-family: var(--titre); font-size: 17px; font-weight: 500; min-width: 140px; text-align: center; }
    .legende { display: flex; gap: 14px; flex-wrap: wrap; }
    .legende span { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--encre-3); }
    .puce { width: 11px; height: 11px; border-radius: 3px; border: 1px solid; flex: none; }

    .entetes, .semaine { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 5px; }
    .entetes { margin: 14px 0 6px; }
    .entetes span { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--libelle-section); text-align: center; }
    .semaine { margin-bottom: 5px; }
    .case {
      min-height: 74px; border-radius: 9px; padding: 7px 8px; border: 1px solid;
      display: flex; flex-direction: column; gap: 3px; overflow: hidden;
    }
    .case .num { font-size: 12px; }
    .case .lib {
      font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .case.aujourdhui .num { font-weight: 700; text-decoration: underline; }
    .case.conflit { box-shadow: inset 0 0 0 2px var(--accent); }

    .sejours .ligne { border-bottom: 1px solid var(--separateur); border-radius: 0; margin: 0; }
    .sejours .ligne:last-child { border-bottom: none; }
    .col-plage { width: 120px; flex: none; font-size: 12px; color: var(--encre-3); }

    .deux { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 640px) {
      .case { min-height: 54px; padding: 5px; }
      .case .lib { display: none; }
      .deux { grid-template-columns: 1fr; }
      .col-plage { width: 100%; }
      .sejours .ligne { flex-direction: column; align-items: flex-start; gap: 4px; }
    }
  `],
  template: `
    <div class="colonne">
      <div class="entre">
        <div>
          <h1>Calendrier</h1>
          <p class="secondaire" style="margin:6px 0 0">
            {{ etat.bien()?.nom }} · {{ etat.bien()?.couchages }} couchages ·
            nuit d'arrivée incluse, nuit de départ libre
          </p>
        </div>
        <!-- Un locataire ou un invité ne demande pas de séjour : il en a un,
             c'est même la raison de son accès. Le bouton le mènerait à un refus. -->
        @if (etat.roleIci() !== 'invite') {
          <button class="btn btn-primaire" (click)="ouvrirDemande()">
            <i class="bi bi-calendar-plus" aria-hidden="true"></i> Demander un séjour
          </button>
        }
      </div>

      @if (conflits().length) {
        <div class="encart">
          <strong>{{ conflits().length }} chevauchement{{ conflits().length > 1 ? 's' : '' }} à arbitrer.</strong>
          {{ conflits()[0].message }}
          @if (etat.estGeranteIci()) { <a routerLink="/bien/demandes">Arbitrer</a> }
        </div>
      }

      @if (formulaire()) {
        <section class="carte">
          <h2>Demander un séjour</h2>
          <p class="secondaire" style="margin:6px 0 16px">
            Les dates sont vérifiées avant l'envoi. Un chevauchement n'empêche pas de demander :
            la gérante arbitre.
          </p>
          <form (ngSubmit)="envoyer()">
            <div class="deux">
              <div class="champ">
                <label for="d-arrivee">Arrivée</label>
                <input id="d-arrivee" name="arrivee" type="date" [(ngModel)]="f.arrivee" (ngModelChange)="verifier()" required>
              </div>
              <div class="champ">
                <label for="d-depart">Départ</label>
                <input id="d-depart" name="depart" type="date" [(ngModel)]="f.depart" (ngModelChange)="verifier()" required>
              </div>
            </div>
            <div class="champ">
              <label for="d-occupants">Occupants ({{ f.occupants }} / {{ etat.bien()?.couchages }} couchages)</label>
              <input id="d-occupants" name="occupants" type="number" min="1" max="60"
                     [(ngModel)]="f.occupants" (ngModelChange)="verifier()" required>
            </div>
            <div class="champ">
              <label for="d-note">Un mot pour la gérante (facultatif)</label>
              <textarea id="d-note" name="note" [(ngModel)]="f.note" maxlength="1000"></textarea>
            </div>

            @if (verification(); as v) {
              @if (v.conflits.length) {
                <div class="encart">
                  @for (c of v.conflits; track c.message) { <div>{{ c.message }}</div> }
                  @if (v.envoiPossible) {
                    <div style="margin-top:6px">Vous pouvez envoyer quand même : la gérante tranchera.</div>
                  }
                </div>
              } @else if (v.nuits > 0) {
                <div class="encart-positif">
                  Ces dates sont libres. {{ nuitsLisible(v.nuits) }}, {{ personnesLisible(f.occupants) }}.
                </div>
              }
            }
            @if (erreur()) { <div class="encart" style="margin-top:10px">{{ erreur() }}</div> }

            <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
              <button class="btn btn-primaire" type="submit" [disabled]="occupe() || !envoiPossible()">
                {{ etat.estGeranteIci() ? 'Enregistrer le séjour' : 'Envoyer la demande' }}
              </button>
              <button class="btn" type="button" (click)="formulaire.set(false)">Annuler</button>
            </div>
          </form>
        </section>
      }

      <section class="carte">
        <div class="entre">
          <div class="mois">
            <button class="btn" type="button" (click)="mois(-1)" aria-label="Mois précédent">
              <i class="bi bi-chevron-left" aria-hidden="true"></i>
            </button>
            <span class="titre">{{ nomMois(annee(), moisIndex()) }}</span>
            <button class="btn" type="button" (click)="mois(1)" aria-label="Mois suivant">
              <i class="bi bi-chevron-right" aria-hidden="true"></i>
            </button>
          </div>
          <div class="legende">
            <span><i class="puce" style="background:#f0e0d5;border-color:#ddc3b0"></i>Famille</span>
            <span><i class="puce" style="background:#e4e9dc;border-color:#c3cfb1"></i>Location</span>
            <span><i class="puce" style="background:#fffdf9;border-color:#b0603f;border-style:dashed"></i>Demande</span>
            <span><i class="puce" style="background:#e5e8ea;border-color:#c3ccd1"></i>Entretien</span>
          </div>
        </div>

        <div class="entetes" aria-hidden="true">
          @for (j of enTetes(); track j) { <span>{{ j }}</span> }
        </div>
        @for (s of grille(); track $index) {
          <div class="semaine">
            @for (c of s.cases; track $index) {
              <div class="case" [class.aujourdhui]="c.aujourdhui" [class.conflit]="c.enConflit"
                   [style.background]="c.teinte.fond" [style.border-color]="c.teinte.bordure"
                   [style.border-style]="c.teinte.tirets ? 'dashed' : 'solid'"
                   [style.color]="c.teinte.encre" [attr.title]="titreCase(c)">
                @if (c.jour) {
                  <span class="num chiffres">{{ c.jour }}</span>
                  @if (c.libelle) { <span class="lib">{{ c.libelle }}</span> }
                }
              </div>
            }
          </div>
        }
      </section>

      <section class="carte">
        <h2>Séjours du mois</h2>
        @if (duMois().length) {
          <div class="sejours" style="margin-top:8px">
            @for (s of duMois(); track s.id) {
              <div class="ligne">
                <span class="col-plage chiffres">{{ plage(s.arrivee, s.depart) }}</span>
                <span style="flex:1;min-width:0">
                  <span style="display:block">{{ s.titre }}</span>
                  <span class="meta">{{ nuitsLisible(s.nuits) }} · {{ personnesLisible(s.occupants) }}</span>
                </span>
                <span class="pastille" [class.pastille-accent]="s.nature === 'famille' && s.statut === 'valide'"
                      [class.pastille-positif]="s.nature === 'location'"
                      [class.pastille-info]="s.nature === 'entretien'">{{ etiquette(s) }}</span>
              </div>
            }
          </div>
        } @else {
          <p class="vide">Aucun séjour ce mois-ci.</p>
        }
      </section>
    </div>
  `,
})
export class Calendrier {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);
  readonly plage = plage;
  readonly nomMois = nomMois;
  readonly nuitsLisible = nuitsLisible;
  readonly personnesLisible = personnesLisible;

  private readonly sejours = signal<Sejour[]>([]);
  readonly conflits = signal<Conflit[]>([]);
  readonly annee = signal(new Date().getUTCFullYear());
  readonly moisIndex = signal(new Date().getUTCMonth());
  readonly formulaire = signal(false);
  readonly verification = signal<Verification | null>(null);
  readonly occupe = signal(false);
  readonly erreur = signal('');

  f = { arrivee: '', depart: '', occupants: 2, note: '' };

  readonly enTetes = computed(() => enTetesJours(this.etat.moi()?.semaineCommenceDimanche ?? false));

  readonly occupations = computed<OccupationGrille[]>(() => this.sejours().map((s) => ({
    id: s.id, arrivee: s.arrivee, depart: s.depart, titre: s.titre, nature: s.nature, statut: s.statut,
  })));

  readonly grille = computed(() => grilleDuMois(this.annee(), this.moisIndex(), this.occupations(), {
    dimancheDabord: this.etat.moi()?.semaineCommenceDimanche ?? false,
    nuitsEnConflit: this.conflits().flatMap((c) => c.nuits),
    aujourdhui: aujourdhui(),
  }));

  readonly duMois = computed(() => occupationsDuMois(this.annee(), this.moisIndex(), this.sejours()));

  readonly envoiPossible = computed(() => {
    const v = this.verification();
    return !!this.f.arrivee && !!this.f.depart && this.f.depart > this.f.arrivee && (!v || v.envoiPossible);
  });

  constructor() {
    // Le mois affiché et le bien courant pilotent le chargement : un seul effet,
    // et les données suivent toujours ce qui est à l'écran.
    effect(() => { const b = this.etat.bien(); this.annee(); this.moisIndex(); if (b) void this.charger(b.id); });
  }

  private async charger(bienId: number): Promise<void> {
    // Trois mois de part et d'autre : passer d'un mois à l'autre est instantané,
    // et un séjour à cheval sur deux mois s'affiche dans les deux.
    const p = moisPrecedent(this.annee(), this.moisIndex());
    const s = moisSuivant(this.annee(), this.moisIndex());
    const debut = `${p.annee}-${String(p.mois + 1).padStart(2, '0')}-01`;
    const fin = `${s.annee}-${String(s.mois + 1).padStart(2, '0')}-01`;
    const r = await this.api.get<{ sejours: Sejour[]; conflits: Conflit[] }>(
      `/biens/${bienId}/sejours?du=${debut}&au=${fin}`);
    this.sejours.set(r.sejours);
    this.conflits.set(r.conflits);
  }

  mois(pas: number): void {
    const suivant = pas > 0 ? moisSuivant(this.annee(), this.moisIndex()) : moisPrecedent(this.annee(), this.moisIndex());
    this.annee.set(suivant.annee);
    this.moisIndex.set(suivant.mois);
  }

  ouvrirDemande(): void {
    this.formulaire.set(true);
    this.erreur.set('');
    this.verification.set(null);
    if (!this.f.arrivee) {
      this.f.arrivee = aujourdhui();
      this.f.depart = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    }
  }

  /** La vérification part au serveur : la règle de conflit n'est jamais refaite ici. */
  async verifier(): Promise<void> {
    const b = this.etat.bien();
    if (!b || !this.f.arrivee || !this.f.depart || this.f.depart <= this.f.arrivee) {
      this.verification.set(null);
      return;
    }
    try {
      this.verification.set(await this.api.post<Verification>(`/biens/${b.id}/verification`, {
        arrivee: this.f.arrivee, depart: this.f.depart, occupants: Number(this.f.occupants),
      }));
    } catch { this.verification.set(null); }
  }

  async envoyer(): Promise<void> {
    const b = this.etat.bien();
    if (!b || this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    try {
      await this.api.post(`/biens/${b.id}/sejours`, {
        arrivee: this.f.arrivee, depart: this.f.depart,
        occupants: Number(this.f.occupants), note: this.f.note,
      });
      this.formulaire.set(false);
      this.f = { arrivee: '', depart: '', occupants: 2, note: '' };
      this.verification.set(null);
      await this.charger(b.id);
      await this.etat.rafraichir();
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'envoi a échoué.");
    } finally {
      this.occupe.set(false);
    }
  }

  etiquette(s: Sejour): string {
    if (s.statut === 'demande') return 'En attente';
    if (s.statut === 'a_revoir') return 'Dates à revoir';
    return s.nature === 'location' ? 'Location' : s.nature === 'entretien' ? 'Entretien' : 'Famille';
  }

  /** Le survol nomme ce qui occupe la nuit : la grille reste lisible sans texte. */
  titreCase(c: Case): string {
    if (!c.jour) return '';
    if (!c.occupations.length) return `${dateLongue(c.date)} · libre`;
    return `${dateLongue(c.date)} · ${c.occupations.map((o) => `${o.titre} (${nuitsLisible(nuitsEntre(o.arrivee, o.depart))})`).join(', ')}`;
  }
}
