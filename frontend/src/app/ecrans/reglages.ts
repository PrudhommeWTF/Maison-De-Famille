// La page de configuration, engendrée depuis le registre.
//
// **Aucun champ n'est écrit à la main ici.** L'écran lit la déclaration de
// chaque réglage (type, bornes, options, description) et fabrique le contrôle
// qui va avec. Ajouter un réglage dans `parametres/registre.ts` le fait
// apparaître ici sans que ce fichier soit rouvert : c'est tout l'intérêt du
// registre, et c'est ce que la CI vérifie.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import { SECTIONS } from '../core/parametres/registre';
import { COULEURS_ZONE, anneeScolaireDe } from '../core/calendrier';
import type { AnneeVacances, ApercuVacances, ZoneVacances } from '../core/calendrier';
import { aujourdhui, plage } from '../core/format';
import type { ParametreExpose } from '../core/modeles';

@Component({
  selector: 'app-reglages',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .reglage { padding: 16px 0; border-top: 1px solid var(--separateur); }
    .reglage:first-of-type { border-top: none; padding-top: 6px; }
    .reglage .titre { display: flex; align-items: center; gap: 10px; justify-content: space-between; flex-wrap: wrap; }
    .reglage .libelle { font-size: 14px; }
    .reglage .desc { font-size: 12.5px; color: var(--encre-3); margin: 5px 0 0; max-width: 620px; }
    .controle { min-width: 200px; }
    .interrupteur { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; }
    .interrupteur input { width: auto; min-height: 0; }
    .portee { font-size: 11px; }
    .annees { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 4px; }
    .annees th { text-align: left; font-weight: 500; font-size: 12px; color: var(--encre-3); padding: 6px 10px 6px 0; }
    .annees td { padding: 7px 10px 7px 0; border-top: 1px solid var(--separateur); }
    .apercu { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--separateur); }
    .annonces { list-style: none; padding: 0; margin: 12px 0 0; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
    .liste { margin-top: 10px; max-height: 260px; overflow-y: auto; }
    .periode { display: flex; align-items: center; gap: 10px; font-size: 13px; padding: 5px 0; border-top: 1px solid var(--separateur); }
    .periode .nom { min-width: 120px; }
    .puce { width: 10px; height: 10px; border-radius: 3px; flex: none; }
  `],
  template: `
    <div class="colonne">
      <div>
        <h1>Réglages</h1>
        <p class="secondaire" style="margin:6px 0 0">
          Chaque réglage dit ce qu'il change et où l'effet se voit. Ceux marqués « bien » sont propres
          au bien ouvert.
        </p>
      </div>

      @if (erreur()) { <div class="encart">{{ erreur() }}</div> }
      @if (message()) { <div class="encart-positif">{{ message() }}</div> }

      @for (s of sectionsRemplies(); track s.id) {
        <section class="carte">
          <h2>{{ s.libelle }}</h2>
          <p class="secondaire" style="margin:4px 0 8px">{{ s.description }}</p>

          @for (p of parametresDe(s.id); track p.cle) {
            <div class="reglage">
              <div class="titre">
                <div>
                  <div class="libelle">
                    {{ p.libelle }}
                    <span class="pastille portee">{{ libellePortee(p.portee) }}</span>
                    @if (!p.parDefaut) { <span class="pastille portee pastille-accent">modifié</span> }
                  </div>
                  <p class="desc">{{ p.description }}</p>
                </div>

                <div class="controle">
                  @switch (p.type) {
                    @case ('bool') {
                      <label class="interrupteur">
                        <input type="checkbox" [checked]="p.valeur === true" (change)="poser(p, $any($event.target).checked)">
                        <span>{{ p.valeur ? 'Activé' : 'Désactivé' }}</span>
                      </label>
                    }
                    @case ('int') {
                      <input type="number" [min]="p.min ?? 0" [max]="p.max ?? 999" [value]="p.valeur"
                             (change)="poser(p, +$any($event.target).value)" [attr.aria-label]="p.libelle">
                    }
                    @case ('enum') {
                      <select [value]="p.valeur" (change)="poser(p, $any($event.target).value)" [attr.aria-label]="p.libelle">
                        @for (o of p.options ?? []; track o.valeur) { <option [value]="o.valeur">{{ o.libelle }}</option> }
                      </select>
                    }
                    @default {
                      <input type="text" [value]="p.valeur" [attr.maxlength]="p.maxLongueur ?? 200"
                             (change)="poser(p, $any($event.target).value)" [attr.aria-label]="p.libelle">
                    }
                  }
                </div>
              </div>
            </div>
          }
        </section>
      }

      <!-- Les vacances scolaires sont la seule donnée de référence que
           l'application ne sait pas calculer : elle doit lui être donnée. -->
      <section class="carte">
        <h2>Vacances scolaires</h2>
        <p class="secondaire" style="margin:6px 0 14px">
          Le calendrier fait ressortir les trois zones. Ces dates sont fixées par arrêté et ne se
          déduisent d'aucune règle : elles se mettent à jour une fois par an, en déposant ici le
          fichier officiel. L'application ne va jamais le chercher elle-même, rien ne sort d'ici.
        </p>

        @if (anneeManquante()) {
          <div class="encart">
            L'année scolaire {{ anneeManquante() }} n'est pas renseignée. Le calendrier l'annonce
            plutôt que d'afficher un mois sans vacances qu'on prendrait pour un mois de classe.
          </div>
        }

        @if (annees().length) {
          <table class="annees">
            <thead>
              <tr><th>Année scolaire</th><th>Périodes</th><th>Couvre</th><th>Origine</th></tr>
            </thead>
            <tbody>
              @for (a of annees(); track a.anneeScolaire) {
                <tr>
                  <td><strong>{{ a.anneeScolaire }}</strong></td>
                  <td>{{ a.periodes }}</td>
                  <td class="secondaire">{{ plage(a.debut, a.fin) }}</td>
                  <td class="secondaire">
                    <span>{{ a.source }}</span>@if (a.importePar) {<span>, déposé par {{ a.importePar }}</span>}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }

        @if (!apercu()) {
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px">
            <label class="btn" style="cursor:pointer">
              <i class="bi bi-calendar-plus" aria-hidden="true"></i> Déposer un calendrier
              <input type="file" accept=".xlsx,.xls,.csv,.txt,text/csv" style="display:none"
                     [disabled]="occupe()" (change)="analyserCalendrier($event)">
            </label>
          </div>
          <p class="secondaire" style="margin:8px 0 0;max-width:620px">
            Le fichier attendu est le calendrier scolaire publié sur data.education.gouv.fr
            (jeu de données « fr-en-calendrier-scolaire », export CSV). Un tableau tenu à la main
            convient aussi, avec cinq colonnes : période, zone, début, fin, année scolaire.
          </p>
        } @else {
          <div class="apercu">
            <div class="entre">
              <h3 style="margin:0">Ce qui a été lu</h3>
              <button class="btn" (click)="apercu.set(null)" [disabled]="occupe()">Annuler</button>
            </div>
            <p class="secondaire" style="margin:6px 0 0">
              {{ apercu()!.format }} · {{ apercu()!.lues }} lignes lues ·
              {{ apercu()!.periodes.length }} périodes retenues.
            </p>
            <!-- La borne de fin est le seul point où deux fichiers honnêtes
                 peuvent vouloir dire deux choses : on annonce ce qui a été
                 décidé plutôt que de le supposer en silence. -->
            <p class="secondaire" style="margin:4px 0 0">
              @if (apercu()!.finEstLaReprise) {
                Les dates de fin ont été lues comme des jours de reprise des cours : le dernier
                jour de vacances retenu est la veille.
              } @else {
                Les dates de fin ont été lues comme le dernier jour de vacances, sans décalage.
              }
            </p>

            <ul class="annonces">
              @for (a of apercu()!.annees; track a.anneeScolaire) {
                <li>
                  <strong>{{ a.anneeScolaire }}</strong> : {{ a.periodes }} périodes
                  @if (apercu()!.deja.includes(a.anneeScolaire)) {
                    <span class="pastille pastille-accent">remplace l'existant</span>
                  } @else {
                    <span class="pastille pastille-positif">nouvelle</span>
                  }
                </li>
              }
            </ul>

            <div class="liste">
              @for (p of apercu()!.periodes; track $index) {
                <div class="periode">
                  <span class="puce" [style.background]="couleurZone(p.zone)" aria-hidden="true"></span>
                  <span class="nom">{{ p.nom }}</span>
                  <span class="secondaire">zone {{ p.zone }}</span>
                  <span class="secondaire">{{ plage(p.debut, p.fin) }}</span>
                </div>
              }
            </div>

            @if (apercu()!.rejets.length) {
              <details style="margin-top:12px">
                <summary>{{ apercu()!.rejets.length }} lignes écartées, et pourquoi</summary>
                <div class="liste">
                  @for (r of apercu()!.rejets.slice(0, 40); track $index) {
                    <div class="periode">
                      <span class="secondaire">ligne {{ r.ligne }}</span>
                      <span class="nom">{{ r.raison }}</span>
                    </div>
                  }
                </div>
                @if (apercu()!.rejets.length > 40) {
                  <p class="secondaire" style="margin:6px 0 0">
                    Les {{ apercu()!.rejets.length - 40 }} autres suivent les mêmes raisons.
                  </p>
                }
              </details>
            }

            <button class="btn btn-primaire" style="margin-top:14px"
                    (click)="enregistrerCalendrier()" [disabled]="occupe()">
              Enregistrer ces {{ apercu()!.periodes.length }} périodes
            </button>
          </div>
        }
      </section>

      <section class="carte">
        <h2>Export</h2>
        <p class="secondaire" style="margin:6px 0 14px">
          Vous n'êtes prisonnier ni d'un tableur ni de cette application. L'export complet contient la
          base et toutes les pièces jointes, et se restaure sur une instance vierge.
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" (click)="exporter('/export/sejours.csv')" [disabled]="occupe()">
            <i class="bi bi-filetype-csv" aria-hidden="true"></i> Séjours en CSV
          </button>
          <button class="btn" (click)="exporter('/export/instance.tar.gz')" [disabled]="occupe()">
            <i class="bi bi-box-arrow-down" aria-hidden="true"></i> Export complet de l'instance
          </button>
        </div>
      </section>
    </div>
  `,
})
export class Reglages {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);

  readonly instance = signal<ParametreExpose[]>([]);
  readonly duBien = signal<ParametreExpose[]>([]);
  readonly occupe = signal(false);
  readonly annees = signal<AnneeVacances[]>([]);
  readonly apercu = signal<ApercuVacances | null>(null);
  private nomFichier = '';
  readonly erreur = signal('');
  readonly message = signal('');

  readonly tous = computed(() => [...this.instance(), ...this.duBien()]);
  readonly sectionsRemplies = computed(() => SECTIONS.filter((s) => this.parametresDe(s.id).length));

  constructor() {
    effect(() => { const b = this.etat.bien(); void this.charger(b?.id ?? null); });
    void this.chargerVacances();
  }

  private async charger(bienId: number | null): Promise<void> {
    const [g, b] = await Promise.all([
      this.api.get<{ parametres: ParametreExpose[] }>('/parametres').catch(() => ({ parametres: [] })),
      bienId ? this.api.get<ParametreExpose[]>(`/biens/${bienId}/parametres`).catch(() => []) : Promise.resolve([]),
    ]);
    // Les réglages personnels ont leur place dans « Mon compte » : les répéter
    // ici ferait douter de l'endroit où l'on agit.
    this.instance.set(g.parametres.filter((p) => p.portee === 'instance'));
    // `/biens/:id/parametres` rend le registre entier vu depuis ce bien, donc
    // les réglages d'instance en font partie. Sans ce filtre, chacun s'affiche
    // deux fois, et on ne sait plus lequel des deux interrupteurs on actionne.
    this.duBien.set(b.filter((p) => p.portee === 'bien'));
  }

  parametresDe(section: string): ParametreExpose[] {
    return this.tous().filter((p) => p.section === section);
  }

  libellePortee(p: string): string {
    return p === 'bien' ? 'ce bien' : p === 'structure' ? 'structure' : p === 'personnel' ? 'vous' : 'instance';
  }

  async poser(p: ParametreExpose, valeur: unknown): Promise<void> {
    if (this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    const b = this.etat.bien();
    try {
      if (p.portee === 'bien' && b) await this.api.post(`/biens/${b.id}/parametres`, { cle: p.cle, valeur });
      else await this.api.post('/parametres', { cle: p.cle, valeur });
      this.message.set(`« ${p.libelle} » enregistré.`);
      await this.charger(b?.id ?? null);
      await this.etat.rafraichir();
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'enregistrement a échoué.");
      await this.charger(b?.id ?? null);
    } finally {
      this.occupe.set(false);
    }
  }

  private async chargerVacances(): Promise<void> {
    const r = await this.api.get<{ annees: AnneeVacances[] }>('/calendrier/vacances').catch(() => ({ annees: [] }));
    this.annees.set(r.annees);
  }

  /**
   * L'année scolaire en cours, si elle manque à l'appel.
   *
   * C'est la seule qui compte vraiment : une famille pose ses séjours pour
   * l'année qui vient, et un calendrier muet sur février est un piège.
   */
  readonly anneeManquante = computed(() => {
    const courante = anneeScolaireDe(aujourdhui());
    return this.annees().some((a) => a.anneeScolaire === courante) ? '' : courante;
  });

  plage = plage;
  couleurZone = (z: ZoneVacances): string => COULEURS_ZONE[z];

  async analyserCalendrier(evt: Event): Promise<void> {
    const input = evt.target as HTMLInputElement;
    const fichier = input.files?.[0];
    if (!fichier || this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try {
      this.apercu.set(await this.api.deposer<ApercuVacances>('/calendrier/vacances/analyse', fichier));
      this.nomFichier = fichier.name.slice(0, 200);
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "Ce fichier n'a pas pu être lu.");
    } finally {
      // Sans cela, redéposer le même fichier après une correction ne
      // déclencherait aucun évènement et donnerait l'impression d'un bouton mort.
      input.value = '';
      this.occupe.set(false);
    }
  }

  async enregistrerCalendrier(): Promise<void> {
    const a = this.apercu();
    if (!a || this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    try {
      const r = await this.api.post<{ annees: string[]; ecrites: number }>(
        '/calendrier/vacances', { periodes: a.periodes, source: this.nomFichier });
      this.message.set(`${r.ecrites} périodes enregistrées pour ${r.annees.join(', ')}.`);
      this.apercu.set(null);
      await this.chargerVacances();
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'enregistrement a échoué.");
    } finally {
      this.occupe.set(false);
    }
  }

  async exporter(chemin: string): Promise<void> {
    this.occupe.set(true);
    this.erreur.set('');
    try {
      const { blob, nom } = await this.api.telecharger(chemin);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nom;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'export a échoué.");
    } finally {
      this.occupe.set(false);
    }
  }
}
