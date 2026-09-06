// Location saisonnière.
//
// La maquette fixe la structure : quatre mesures en bandeau (loyers encaissés,
// semaines louées, charges déduites, net à répartir), le tableau des
// réservations en cinq colonnes, puis deux encarts côte à côte, « Répartition
// des loyers » et « Accès locataire ».
//
// Trois notes de comportement, reprises telles quelles :
//
//   - « La location est activable par bien : seule Kerloc'h l'a activée ici. »
//   - « Les semaines famille sont posées avant l'ouverture à la location ;
//     l'inverse déclenche une alerte. »
//   - « Le loyer net se calcule après déduction des charges directement liées
//     à la location. »
//
// **Rien n'est calculé ici.** L'exercice, le net et l'explication viennent du
// serveur, où ils sont produits par un module pur et testé. Un écran qui
// referait la soustraction afficherait un jour un autre chiffre que la
// répartition réellement versée, et c'est le genre d'écart qui fâche une
// famille pour de bon.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import { aujourdhui, euros, nuitsLisible, plage } from '../core/format';

type Statut = 'a_confirmer' | 'acompte' | 'solde' | 'annule';

interface Reservation {
  id: number; sejourId: number; locataire: string; email: string; telephone: string;
  arrivee: string; depart: string; nuits: number; occupants: number;
  loyerCents: number; acompteCents: number; statut: Statut; note: string;
}
interface Charge { id: number; libelle: string; dateDepense: string; montantCents: number }
interface Exercice {
  annee: number; encaisseCents: number; attenduCents: number; chargesCents: number;
  netCents: number; nuitsLouees: number; reservations: number; aConfirmer: number;
  explication: string;
}
interface Saison {
  annee: number; exercice: Exercice; reservations: Reservation[]; charges: Charge[];
  alerte: string | null; peutModifier: boolean;
}

const LIBELLE: Record<Statut, string> = {
  a_confirmer: 'À confirmer', acompte: 'Acompte reçu', solde: 'Soldé', annule: 'Annulée',
};

@Component({
  selector: 'app-location',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .mesures { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; }
    .mesure { background: var(--surface); border: 1px solid var(--bordure); border-radius: 14px; padding: 16px 18px; }
    .mesure .cle { font-size: 11.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--encre-3); }
    .mesure .val { font: 500 25px/1.1 'Bricolage Grotesque', sans-serif; margin-top: 8px; }
    .mesure .val.deficit { color: var(--accent-doux-encre); }
    .ligne-r { display: grid; grid-template-columns: 130px 1fr 105px 105px 120px 150px; gap: 12px;
               align-items: center; padding: 11px 0; border-top: 1px solid var(--separateur); font-size: 13px; }
    .ligne-r:first-of-type { border-top: none; }
    .st-solde { background: #e4e9dc; color: #556340; }
    .st-acompte { background: #f0e0d5; color: #8d4a2e; }
    .st-annule { text-decoration: line-through; }
    .annulee { opacity: .55; }
    .deux { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .saisie { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; align-items: end; }
    .detail { font-size: 12.5px; white-space: pre-wrap; background: var(--pastille-neutre);
              border-radius: 10px; padding: 12px 14px; margin-top: 12px; }
    .annee { display: flex; gap: 8px; align-items: center; }
    .annee button { min-width: 40px; }
    @media (max-width: 860px) {
      .deux, .saisie { grid-template-columns: 1fr; }
      .ligne-r { grid-template-columns: 1fr 1fr; gap: 4px 12px; }
    }
  `],
  template: `
    <div class="colonne">
      <div class="entre">
        <div>
          <h1>Location saisonnière @if (etat.bien(); as b) { · {{ b.nom }} }</h1>
          <p class="secondaire" style="margin:6px 0 0">
            Les semaines famille sont posées avant l'ouverture à la location.
          </p>
        </div>
        <div class="annee">
          <button class="btn" type="button" (click)="changerAnnee(-1)">‹</button>
          <strong class="chiffres">{{ annee() }}</strong>
          <button class="btn" type="button" (click)="changerAnnee(1)">›</button>
        </div>
      </div>

      @if (erreur()) { <div class="encart">{{ erreur() }}</div> }
      @if (message()) { <div class="encart-positif">{{ message() }}</div> }

      @if (refus()) {
        <section class="carte">
          <h2>La location n'est pas activée sur ce bien</h2>
          <p class="secondaire" style="margin:8px 0 0">{{ refus() }}</p>
        </section>
      }

      @if (saison(); as s) {
        @if (s.alerte) { <div class="encart">{{ s.alerte }}</div> }

        <div class="mesures">
          <div class="mesure">
            <div class="cle">Loyers encaissés {{ s.annee }}</div>
            <div class="val chiffres">{{ euros(s.exercice.encaisseCents) }}</div>
          </div>
          <div class="mesure">
            <div class="cle">Nuits louées</div>
            <div class="val chiffres">{{ s.exercice.nuitsLouees }}</div>
          </div>
          <div class="mesure">
            <div class="cle">Charges déduites</div>
            <div class="val chiffres">{{ euros(s.exercice.chargesCents) }}</div>
          </div>
          <div class="mesure">
            <div class="cle">Net à répartir</div>
            <div class="val chiffres" [class.deficit]="s.exercice.netCents < 0">
              {{ euros(s.exercice.netCents) }}
            </div>
          </div>
        </div>

        <section class="carte">
          <div class="entre">
            <h2>Réservations</h2>
            @if (s.peutModifier) {
              <button class="btn" type="button" (click)="depot.set(!depot())">
                {{ depot() ? 'Fermer' : 'Ajouter une réservation' }}
              </button>
            }
          </div>

          @if (depot() && s.peutModifier) {
            <form class="saisie" style="margin:14px 0 4px" (ngSubmit)="creer()">
              <div style="grid-column:1/-1">
                <label for="r-loc">Locataire</label>
                <input id="r-loc" name="rloc" [(ngModel)]="fLocataire" placeholder="M. et Mme Corre">
              </div>
              <div>
                <label for="r-arr">Arrivée</label>
                <input id="r-arr" name="rarr" type="date" [(ngModel)]="fArrivee">
              </div>
              <div>
                <label for="r-dep">Départ</label>
                <input id="r-dep" name="rdep" type="date" [(ngModel)]="fDepart">
              </div>
              <div>
                <label for="r-occ">Occupants</label>
                <input id="r-occ" name="rocc" type="number" min="1" [(ngModel)]="fOccupants">
              </div>
              <div>
                <label for="r-loyer">Loyer (euros)</label>
                <input id="r-loyer" name="rloyer" type="number" min="0" step="0.01" [(ngModel)]="fLoyer">
              </div>
              <div>
                <label for="r-ac">Acompte reçu (euros)</label>
                <input id="r-ac" name="rac" type="number" min="0" step="0.01" [(ngModel)]="fAcompte">
              </div>
              <div>
                <label for="r-mail">Courriel (facultatif)</label>
                <input id="r-mail" name="rmail" type="email" [(ngModel)]="fEmail">
              </div>
              <div style="grid-column:1/-1">
                <button class="btn btn-primaire" type="submit"
                        [disabled]="occupe() || !fLocataire.trim() || !fArrivee || !fDepart">
                  Enregistrer la réservation
                </button>
                <span class="secondaire" style="margin-left:12px;font-size:12.5px">
                  La semaine est aussitôt bloquée au calendrier, comme un séjour de famille.
                </span>
              </div>
            </form>
          }

          <div style="margin-top:10px">
            @for (r of s.reservations; track r.id) {
              <div class="ligne-r" [class.annulee]="r.statut === 'annule'">
                <span class="secondaire">{{ plage(r.arrivee, r.depart) }}</span>
                <span>
                  {{ r.locataire }}
                  <br><span class="secondaire" style="font-size:12px">{{ nuitsLisible(r.nuits) }}</span>
                </span>
                <span class="secondaire">{{ r.occupants }} personnes</span>
                <span class="chiffres">{{ euros(r.loyerCents) }}</span>
                <span class="pastille" [class.st-solde]="r.statut === 'solde'"
                      [class.st-acompte]="r.statut === 'acompte'"
                      [class.st-annule]="r.statut === 'annule'">{{ libelle(r.statut) }}</span>
                @if (s.peutModifier && r.statut !== 'annule') {
                  <select (change)="changerStatut(r, $event)"
                          [attr.aria-label]="'Changer le statut de la réservation de ' + r.locataire">
                    <option value="">Changer...</option>
                    @for (o of STATUTS; track o) {
                      @if (o !== r.statut) { <option [value]="o">{{ libelle(o) }}</option> }
                    }
                  </select>
                } @else { <span></span> }
              </div>
            }
            @if (!s.reservations.length) {
              <p class="secondaire" style="margin:6px 0 0">
                Aucune réservation sur {{ s.annee }}.
              </p>
            }
          </div>

          <div class="detail">{{ s.exercice.explication }}</div>
        </section>

        <div class="deux">
          <section class="carte">
            <h2>Répartition des loyers</h2>
            <p class="secondaire" style="margin:10px 0 0">
              Le net est réparti au prorata des {{ etat.vocabulaire().parts }} en vigueur à la
              clôture de la saison, avec les mêmes règles et les mêmes arrondis que les dépenses.
              Il se ventile depuis l'écran Dépenses, pour qu'il n'existe qu'une seule table de
              répartition et un seul historique.
            </p>
          </section>
          <section class="carte">
            <h2>Charges de la saison</h2>
            @if (s.charges.length) {
              <div style="margin-top:8px">
                @for (c of s.charges; track c.id) {
                  <div class="ligne-r" style="grid-template-columns:1fr 110px">
                    <span>{{ c.libelle }}</span>
                    <span class="chiffres">{{ euros(c.montantCents) }}</span>
                  </div>
                }
              </div>
            } @else {
              <p class="secondaire" style="margin:10px 0 0">
                Aucune charge marquée « liée à la location » sur {{ s.annee }}. La case se coche
                à la saisie d'une dépense : ménage de fin de séjour, blanchisserie, commission.
              </p>
            }
          </section>
        </div>
      }
    </div>
  `,
})
export class Location {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);
  readonly euros = euros;
  readonly plage = plage;
  readonly nuitsLisible = nuitsLisible;
  readonly STATUTS: Statut[] = ['a_confirmer', 'acompte', 'solde', 'annule'];

  readonly saison = signal<Saison | null>(null);
  /** Le message du serveur quand le module n'est pas activé sur ce bien. */
  readonly refus = signal('');
  readonly annee = signal(Number(aujourdhui().slice(0, 4)));
  readonly depot = signal(false);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  fLocataire = '';
  fEmail = '';
  fArrivee = '';
  fDepart = '';
  fOccupants = 2;
  fLoyer: number | null = null;
  fAcompte: number | null = null;

  readonly bienId = computed(() => this.etat.bien()?.id ?? 0);
  readonly libelle = (s: Statut): string => LIBELLE[s];

  constructor() {
    effect(() => { const id = this.bienId(); const a = this.annee(); if (id) void this.charger(id, a); });
  }

  changerAnnee(pas: number): void {
    this.annee.update((a) => a + pas);
  }

  private async charger(bienId: number, annee: number): Promise<void> {
    this.erreur.set('');
    try {
      this.saison.set(await this.api.get<Saison>(`/biens/${bienId}/location?annee=${annee}`));
      this.refus.set('');
    } catch (e) {
      this.saison.set(null);
      // Le serveur refuse plutôt que de rendre une liste vide, et son message
      // dit où activer le module : on l'affiche tel quel.
      this.refus.set(e instanceof ErreurAppel ? e.message : 'La saison n\'a pas pu être chargée.');
    }
  }

  private async tenter(quoi: () => Promise<string>): Promise<void> {
    const id = this.bienId();
    if (!id || this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try {
      this.message.set(await quoi());
      await this.charger(id, this.annee());
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'opération a échoué.");
    } finally {
      this.occupe.set(false);
    }
  }

  creer(): Promise<void> {
    if (!this.fLocataire.trim() || !this.fArrivee || !this.fDepart) return Promise.resolve();
    return this.tenter(async () => {
      await this.api.post(`/biens/${this.bienId()}/location/reservations`, {
        locataire: this.fLocataire.trim(), email: this.fEmail.trim(), telephone: '',
        arrivee: this.fArrivee, depart: this.fDepart, occupants: this.fOccupants,
        loyerCents: Math.round((this.fLoyer ?? 0) * 100),
        acompteCents: Math.round((this.fAcompte ?? 0) * 100),
        note: '',
      });
      const qui = this.fLocataire.trim();
      this.fLocataire = '';
      this.fEmail = '';
      this.fLoyer = null;
      this.fAcompte = null;
      this.depot.set(false);
      return `Réservation de ${qui} enregistrée, la semaine est bloquée au calendrier.`;
    });
  }

  changerStatut(r: Reservation, e: Event): Promise<void> {
    const select = e.target as HTMLSelectElement;
    const statut = select.value as Statut;
    // Le menu revient à « Changer... » : c'est une action, pas un champ, et la
    // pastille à côté porte déjà l'état.
    select.value = '';
    if (!statut || statut === r.statut) return Promise.resolve();
    return this.tenter(async () => {
      await this.api.post(`/biens/${this.bienId()}/location/reservations/${r.id}/statut`, { statut });
      return statut === 'annule'
        ? `Réservation de ${r.locataire} annulée : la semaine est rendue à la famille.`
        : `Réservation de ${r.locataire} : ${LIBELLE[statut].toLowerCase()}.`;
    });
  }
}
