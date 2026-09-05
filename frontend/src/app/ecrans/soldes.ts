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
  styles: [`
    .cartes { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 14px; }
    .personne { background: var(--surface); border: 1px solid var(--bordure-carte); border-radius: 16px; padding: 18px; }
    .personne .haut { display: flex; align-items: center; gap: 10px; }
    .personne .avatar { width: 30px; height: 30px; font-size: 11px; }
    .personne .montant { font-family: var(--titre); font-size: 25px; font-weight: 500; margin: 12px 0 2px; }
    .crediteur { color: var(--positif-encre); }
    .debiteur { color: var(--accent); }
    .detail { margin-top: 10px; font-size: 12px; color: var(--encre-3); }
    .detail div { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; }

    .virement { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--separateur); flex-wrap: wrap; }
    .virement:first-of-type { border-top: none; }
    .virement .fleche { flex: 1; min-width: 200px; font-size: 13.5px; }
    .virement .montant { font-size: 15px; }
    @media (max-width: 560px) { .virement .montant { margin-left: auto; } }
  `],
  template: `
    <div class="colonne">
      <div class="entre">
        <div>
          <h1>Soldes et remboursements</h1>
          <p class="secondaire" style="margin:6px 0 0">{{ donnees()?.structure?.nom }}</p>
        </div>
        @if (etat.estGeranteIci() && aDesDebiteurs()) {
          <button class="btn btn-primaire" (click)="appel.set(!appel())">
            {{ appel() ? 'Fermer' : 'Générer l\\'appel de fonds' }}
          </button>
        }
      </div>

      @if (erreur()) { <div class="encart">{{ erreur() }}</div> }
      @if (message()) { <div class="encart-positif">{{ message() }}</div> }

      @if (donnees(); as d) {
        @if (d.controle !== 0) {
          <!-- La somme des soldes doit valoir zéro. Si elle ne vaut pas zéro,
               il faut le dire haut et fort plutôt que d'afficher des chiffres
               dont personne ne pourra expliquer l'écart. -->
          <div class="encart">
            <strong>Incohérence détectée.</strong> La somme des soldes vaut {{ euros(d.controle) }} au lieu de zéro.
            Signalez-le : les montants affichés ci-dessous ne sont pas fiables.
          </div>
        }

        @if (appel()) {
          <section class="carte">
            <h2>Appel de fonds</h2>
            <p class="secondaire" style="margin:6px 0 14px">
              Chaque personne débitrice recevra un courriel avec son montant, l'échéance, et un lien
              vers le détail du calcul.
            </p>
            <form (ngSubmit)="emettre()">
              <div class="champ">
                <label for="a-libelle">Libellé</label>
                <input id="a-libelle" name="libelle" [(ngModel)]="f.libelle"
                       [placeholder]="d.vocabulaire.regularisation + ' ' + annee" required>
              </div>
              <div class="champ">
                <label for="a-echeance">Échéance</label>
                <input id="a-echeance" name="echeance" type="date" [(ngModel)]="f.echeance" required>
              </div>
              <button class="btn btn-primaire" type="submit" [disabled]="occupe()">Émettre l'appel</button>
            </form>
          </section>
        }

        <div class="cartes">
          @for (s of d.soldes; track s.acteurId) {
            <div class="personne">
              <div class="haut">
                <span class="avatar">{{ s.estStructure ? '€' : initiales(s.nom) }}</span>
                <span>
                  <span style="display:block;font-size:13.5px">{{ s.nom }}</span>
                  @if (s.estStructure) { <span class="meta">compte commun</span> }
                </span>
              </div>
              <div class="montant chiffres" [class.crediteur]="s.montantCents > 0" [class.debiteur]="s.montantCents < 0">
                {{ s.montantCents > 0 ? '+ ' : s.montantCents < 0 ? '− ' : '' }}{{ euros(Math.abs(s.montantCents)) }}
              </div>
              <div class="meta">{{ motDeSolde(s) }}</div>
              <div class="detail">
                <div><span>A avancé</span><span class="chiffres">{{ euros(s.avanceCents) }}</span></div>
                <div><span>Sa part des dépenses</span><span class="chiffres">{{ euros(s.duCents) }}</span></div>
                @if (s.regleCents !== 0) {
                  <div><span>Virements confirmés</span><span class="chiffres">{{ euros(s.regleCents) }}</span></div>
                }
              </div>
            </div>
          } @empty {
            <p class="vide">Aucun solde : rien n'a encore été dépensé sur cet exercice.</p>
          }
        </div>

        @if (d.virements.length) {
          <section class="carte">
            <h2>Virements proposés</h2>
            <p class="secondaire" style="margin:6px 0 6px">
              {{ d.virements.length }} virement{{ d.virements.length > 1 ? 's' : '' }} suffi{{ d.virements.length > 1 ? 'sent' : 't' }}
              à remettre tout le monde à zéro. Tant qu'un virement n'est pas confirmé par celui qui
              reçoit, il ne déplace aucun solde.
            </p>
            @for (v of d.virements; track v.deId + '-' + v.versId) {
              <div class="virement">
                <span class="fleche">
                  <strong>{{ v.deNom }}</strong> vers <strong>{{ v.versNom }}</strong>
                  <span class="meta" style="display:block">{{ v.motif }}</span>
                </span>
                <span class="montant chiffres">{{ euros(v.montantCents) }}</span>
                @if (peutAnnoncer(v)) {
                  <button class="btn" (click)="annoncer(v)" [disabled]="occupe()">J'ai fait le virement</button>
                }
              </div>
            }
          </section>
        }

        @if (d.reglements.length) {
          <section class="carte">
            <h2>Virements annoncés</h2>
            @for (r of d.reglements; track r.id) {
              <div class="virement">
                <span class="fleche">
                  <strong>{{ r.deNom }}</strong> vers <strong>{{ r.versNom }}</strong>
                  <span class="meta" style="display:block">
                    {{ r.motif || 'Virement' }} · {{ dateLongue(r.dateReglement) }}
                  </span>
                </span>
                <span class="montant chiffres">{{ euros(r.montantCents) }}</span>
                <span class="pastille" [class.pastille-positif]="r.statut === 'confirme'"
                      [class.pastille-accent]="r.statut === 'annonce'">
                  {{ r.statut === 'confirme' ? 'Reçu' : r.statut === 'annonce' ? 'Annoncé' : 'Proposé' }}
                </span>
                @if (r.statut !== 'confirme' && peutConfirmer(r.versId)) {
                  <button class="btn" (click)="confirmer(r.id)" [disabled]="occupe()">J'ai reçu l'argent</button>
                }
              </div>
            }
            <p class="meta" style="margin-top:12px">
              Seul le bénéficiaire confirme avoir reçu : sans cette règle, un débiteur solderait sa
              propre dette d'un clic.
            </p>
          </section>
        }

        @if (d.appels.length) {
          <section class="carte">
            <h2>Appels de fonds</h2>
            @for (a of d.appels; track a.id) {
              <div style="padding:12px 0;border-top:1px solid var(--separateur)">
                <div class="entre">
                  <strong>{{ a.libelle }}</strong>
                  <span class="meta">émis le {{ dateLongue(a.dateAppel) }}, échéance le {{ dateLongue(a.echeance) }}</span>
                </div>
                @for (l of a.lignes; track l.personneId) {
                  <div class="virement" style="border:none;padding:6px 0">
                    <span class="fleche">{{ l.nom }}</span>
                    <span class="montant chiffres">{{ euros(l.montantCents) }}</span>
                    <span class="pastille" [class.pastille-positif]="l.statut === 'confirme'">
                      {{ l.statut === 'confirme' ? 'Réglé' : l.statut === 'annonce' ? 'Annoncé' : 'Attendu' }}
                    </span>
                  </div>
                }
              </div>
            }
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
