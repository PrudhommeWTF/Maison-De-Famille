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
import { COULEURS_ZONE, Case, OccupationGrille, REPERES_VIDES, grilleDuMois, occupationsDuMois } from '../core/calendrier';
import type { Reperes, ZoneVacances } from '../core/calendrier';
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
    /* Trois marques que Bootstrap ne porte pas, et qui sont propres au projet.
       Elles restent ici, dans le composant, plutôt que dans le thème : aucun
       autre écran n'a de grille de calendrier. */

    /* Un jour férié se marque sur le numéro, pas sur le fond : le fond dit déjà
       qui occupe la maison, et deux informations ne peuvent pas se partager le
       même canal. Le point suffit à attirer l'oeil, le survol donne le nom. */
    .num.ferie { font-weight: 600; }
    .num.ferie::after {
      content: ''; display: inline-block; width: 4px; height: 4px; border-radius: 50%;
      background: var(--bs-primary); margin-left: 4px; vertical-align: middle;
    }
    /* Les zones scolaires : trois bandeaux fins collés au bas de la case, dans
       l'ordre A, B, C, chacun présent seulement si sa zone est en vacances. La
       position est fixe, si bien qu'une même zone reste sur la même ligne d'une
       case à l'autre et se lit en diagonale sur toute une semaine. */
    .zones { margin-top: auto; display: flex; flex-direction: column; gap: 1px; }
    .zones i { display: block; height: 3px; border-radius: 2px; }
    /* Une nuit en conflit se cercle par l'intérieur : la bordure porte déjà la
       nature de l'occupation, et l'anneau ne doit pas la remplacer. */
    .conflit { box-shadow: inset 0 0 0 2px var(--bs-primary); }
    @media (max-width: 640px) {
      .cal-cell { min-height: 54px; }
      .lib { display: none; }
    }
  `],
  template: `
    <div class="d-flex flex-column gap-4">
      <div class="d-flex justify-content-between align-items-end gap-3 flex-wrap">
        <div>
          <h1 class="h2 mb-2">Calendrier d'occupation</h1>
          <p class="text-body-secondary mb-0">
            {{ etat.bien()?.nom }} · {{ etat.bien()?.couchages }} couchages ·
            nuit d'arrivée incluse, nuit de départ libre
          </p>
        </div>
        <!-- Un locataire ou un invité ne demande pas de séjour : il en a un,
             c'est même la raison de son accès. Le bouton le mènerait à un refus. -->
        @if (etat.roleIci() !== 'invite') {
          <button class="btn btn-primary" (click)="ouvrirDemande()">
            <i class="bi bi-calendar-plus me-1" aria-hidden="true"></i>Demander un séjour
          </button>
        }
      </div>

      @if (conflits().length) {
        <div class="alert alert-primary d-flex gap-3 align-items-start mb-0" role="alert">
          <i class="bi bi-exclamation-circle fs-5" aria-hidden="true"></i>
          <div class="small">
            <strong>{{ conflits().length }} chevauchement{{ conflits().length > 1 ? 's' : '' }} à arbitrer.</strong>
            {{ conflits()[0].message }}
            @if (etat.estGeranteIci()) {
              <a class="ms-1" routerLink="/bien/demandes">Arbitrer</a>
            }
          </div>
        </div>
      }

      <!-- L'application dit quand elle ne sait pas. Sans cette ligne, un mois
           sans bandeau de vacances se lirait « pas de vacances » alors qu'il
           signifie « table non mise à jour ». -->
      @if (!reperes().couvert) {
        <div class="alert alert-primary mb-0 small">
          Les vacances scolaires ne sont pas renseignées pour cette période.
          @if (reperes().anneesCouvertes.length) {
            Les années connues sont {{ reperes().anneesCouvertes.join(', ') }}.
          }
          Les jours fériés, eux, restent justes : ils se calculent.
          @if (etat.estGeranteIci()) {
            <a class="ms-1" routerLink="/reglages">Déposer le calendrier officiel</a>
          }
        </div>
      }

      @if (formulaire()) {
        <section class="card">
          <div class="card-body">
            <h2 class="h5 card-title">Demander un séjour</h2>
            <p class="text-body-secondary small">
              Les dates sont vérifiées avant l'envoi. Un chevauchement n'empêche pas de demander :
              la gérante arbitre.
            </p>
            <form class="row g-3" (ngSubmit)="envoyer()">
              <div class="col-12 col-md-4">
                <label class="form-label small text-body-secondary" for="d-arrivee">Arrivée</label>
                <input class="form-control" id="d-arrivee" name="arrivee" type="date"
                       [(ngModel)]="f.arrivee" (ngModelChange)="verifier()" required>
              </div>
              <div class="col-12 col-md-4">
                <label class="form-label small text-body-secondary" for="d-depart">Départ</label>
                <input class="form-control" id="d-depart" name="depart" type="date"
                       [(ngModel)]="f.depart" (ngModelChange)="verifier()" required>
              </div>
              <div class="col-12 col-md-4">
                <label class="form-label small text-body-secondary" for="d-occupants">
                  Occupants ({{ f.occupants }} / {{ etat.bien()?.couchages }} couchages)
                </label>
                <input class="form-control" id="d-occupants" name="occupants" type="number" min="1" max="60"
                       [(ngModel)]="f.occupants" (ngModelChange)="verifier()" required>
              </div>
              <div class="col-12">
                <label class="form-label small text-body-secondary" for="d-note">Un mot pour la gérante (facultatif)</label>
                <textarea class="form-control" id="d-note" name="note" rows="3"
                          [(ngModel)]="f.note" maxlength="1000"></textarea>
              </div>

              @if (verification(); as v) {
                <div class="col-12">
                  @if (v.conflits.length) {
                    <div class="alert alert-primary mb-0 small">
                      @for (c of v.conflits; track c.message) { <div>{{ c.message }}</div> }
                      @if (v.envoiPossible) {
                        <div class="mt-2">Vous pouvez envoyer quand même : la gérante tranchera.</div>
                      }
                    </div>
                  } @else if (v.nuits > 0) {
                    <div class="alert alert-success mb-0 small">
                      Ces dates sont libres. {{ nuitsLisible(v.nuits) }}, {{ personnesLisible(f.occupants) }}.
                    </div>
                  }
                </div>
              }
              @if (erreur()) { <div class="col-12"><div class="alert alert-primary mb-0 small">{{ erreur() }}</div></div> }

              <div class="col-12 d-flex gap-2 flex-wrap">
                <button class="btn btn-primary" type="submit" [disabled]="occupe() || !envoiPossible()">
                  {{ etat.estGeranteIci() ? 'Enregistrer le séjour' : 'Envoyer la demande' }}
                </button>
                <button class="btn btn-outline-secondary" type="button" (click)="formulaire.set(false)">Annuler</button>
              </div>
            </form>
          </div>
        </section>
      }

      <section class="card">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-center gap-3 flex-wrap mb-3">
            <div class="d-flex align-items-center gap-2">
              <button class="btn btn-sm btn-outline-secondary" type="button" (click)="mois(-1)"
                      aria-label="Mois précédent">
                <i class="bi bi-chevron-left" aria-hidden="true"></i>
              </button>
              <div class="h5 mb-0 text-center" style="min-width:170px">{{ nomMois(annee(), moisIndex()) }}</div>
              <button class="btn btn-sm btn-outline-secondary" type="button" (click)="mois(1)"
                      aria-label="Mois suivant">
                <i class="bi bi-chevron-right" aria-hidden="true"></i>
              </button>
            </div>
            <div class="d-flex flex-column gap-2">
              <div class="d-flex gap-3 flex-wrap small text-body-secondary">
                <span class="d-flex align-items-center gap-2">
                  <span class="d-inline-block rounded-1 bg-primary-subtle border border-primary-subtle"
                        style="width:12px;height:12px"></span>Séjour famille
                </span>
                <span class="d-flex align-items-center gap-2">
                  <span class="d-inline-block rounded-1 bg-success-subtle border border-success-subtle"
                        style="width:12px;height:12px"></span>Location
                </span>
                <span class="d-flex align-items-center gap-2">
                  <span class="d-inline-block rounded-1 border border-primary cal-dashed"
                        style="width:12px;height:12px"></span>Demande en attente
                </span>
                <span class="d-flex align-items-center gap-2">
                  <span class="d-inline-block rounded-1 bg-info-subtle border border-info-subtle"
                        style="width:12px;height:12px"></span>Entretien
                </span>
              </div>
              <div class="d-flex gap-3 flex-wrap small text-body-secondary">
                @for (z of ZONES; track z) {
                  <span class="d-flex align-items-center gap-2"
                        [attr.title]="'Académies : ' + (academies()[z] || '')">
                    <span class="d-inline-block rounded-1" style="width:12px;height:12px"
                          [style.background]="couleurZone(z)"></span>Vacances zone {{ z }}
                  </span>
                }
                <span class="d-flex align-items-center gap-2">
                  <span class="d-inline-block rounded-circle bg-primary" style="width:8px;height:8px"></span>Jour férié
                </span>
              </div>
            </div>
          </div>

          <div class="row row-cols-7 g-1 mb-1" aria-hidden="true">
            @for (j of enTetes(); track j) { <div class="col text-center eyebrow">{{ j }}</div> }
          </div>
          @for (s of grille(); track $index) {
            <div class="row row-cols-7 g-1 mb-1">
              @for (c of s.cases; track $index) {
                <div class="col">
                  <div class="cal-cell rounded-2 p-2 h-100 overflow-hidden border d-flex flex-column"
                       [class]="c.teinte.classes" [class.conflit]="c.enConflit"
                       [attr.title]="titreCase(c)">
                    @if (c.jour) {
                      <div class="num tnum" style="font-size:.78rem"
                           [class.ferie]="!!c.ferie" [class.fw-bold]="c.aujourdhui"
                           [class.text-decoration-underline]="c.aujourdhui">{{ c.jour }}</div>
                      @if (c.libelle) {
                        <div class="lib fw-medium text-truncate mt-1" style="font-size:.7rem">{{ c.libelle }}</div>
                      }
                      @if (c.zones.length) {
                        <span class="zones" aria-hidden="true">
                          @for (z of ZONES; track z) {
                            <i [style.background]="c.zones.includes(z) ? couleurZone(z) : 'transparent'"></i>
                          }
                        </span>
                      }
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>
      </section>

      <section class="card">
        <div class="card-body">
          <div class="eyebrow mb-2">Séjours du mois</div>
          @if (duMois().length) {
            <div class="table-responsive">
              <table class="table table-hover align-middle mb-0">
                <thead>
                  <tr class="eyebrow">
                    <th scope="col">Dates</th><th scope="col">Qui</th>
                    <th scope="col">Détail</th><th scope="col">Nature</th>
                  </tr>
                </thead>
                <tbody>
                  @for (s of duMois(); track s.id) {
                    <tr>
                      <td class="tnum small text-body-secondary">{{ plage(s.arrivee, s.depart) }}</td>
                      <td class="small fw-medium">{{ s.titre }}</td>
                      <td class="small text-body-secondary">
                        {{ nuitsLisible(s.nuits) }} · {{ personnesLisible(s.occupants) }}
                      </td>
                      <td><span class="badge rounded-pill" [class]="classeEtiquette(s)">{{ etiquette(s) }}</span></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="text-body-secondary small mb-0">Aucun séjour ce mois-ci.</p>
          }
        </div>
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
  /** Jours fériés et vacances scolaires de la plage affichée. */
  readonly reperes = signal<Reperes & { academies?: Record<string, string> }>(REPERES_VIDES);
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
    reperes: this.reperes(),
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

  readonly ZONES: ZoneVacances[] = ['A', 'B', 'C'];
  readonly couleurZone = (z: ZoneVacances): string => COULEURS_ZONE[z];
  readonly academies = computed(() => this.reperes().academies ?? {} as Record<string, string>);

  private async charger(bienId: number): Promise<void> {
    // Trois mois de part et d'autre : passer d'un mois à l'autre est instantané,
    // et un séjour à cheval sur deux mois s'affiche dans les deux.
    const p = moisPrecedent(this.annee(), this.moisIndex());
    const s = moisSuivant(this.annee(), this.moisIndex());
    const debut = `${p.annee}-${String(p.mois + 1).padStart(2, '0')}-01`;
    const fin = `${s.annee}-${String(s.mois + 1).padStart(2, '0')}-01`;
    const [r, reperes] = await Promise.all([
      this.api.get<{ sejours: Sejour[]; conflits: Conflit[] }>(`/biens/${bienId}/sejours?du=${debut}&au=${fin}`),
      // Les repères ne dépendent d'aucun bien : un échec ne doit pas priver la
      // famille de son calendrier, il la prive seulement des vacances.
      this.api.get<Reperes & { academies: Record<string, string> }>(
        `/calendrier/reperes?du=${debut}&au=${fin}`).catch(() => null),
    ]);
    this.sejours.set(r.sejours);
    this.conflits.set(r.conflits);
    this.reperes.set(reperes ?? REPERES_VIDES);
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

  /** L'étiquette prend la même couleur que la case : le lien se fait tout seul. */
  classeEtiquette(s: Sejour): string {
    if (s.statut !== 'valide') return 'border border-primary text-primary-emphasis cal-dashed';
    if (s.nature === 'location') return 'text-success-emphasis bg-success-subtle border border-success-subtle';
    if (s.nature === 'entretien') return 'text-info-emphasis bg-info-subtle border border-info-subtle';
    return 'text-primary-emphasis bg-primary-subtle border border-primary-subtle';
  }

  etiquette(s: Sejour): string {
    if (s.statut === 'demande') return 'En attente';
    if (s.statut === 'a_revoir') return 'Dates à revoir';
    return s.nature === 'location' ? 'Location' : s.nature === 'entretien' ? 'Entretien' : 'Famille';
  }

  /** Le survol nomme ce qui occupe la nuit : la grille reste lisible sans texte. */
  titreCase(c: Case): string {
    if (!c.jour) return '';
    const bouts = [dateLongue(c.date)];
    if (c.ferie) bouts.push(c.ferie);
    bouts.push(c.occupations.length
      ? c.occupations.map((o) => `${o.titre} (${nuitsLisible(nuitsEntre(o.arrivee, o.depart))})`).join(', ')
      : 'libre');
    if (c.zones.length) {
      bouts.push(`vacances zone ${c.zones.join(', ')}`);
    }
    return bouts.join(' · ');
  }
}
