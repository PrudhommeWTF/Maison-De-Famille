// La page de configuration, engendrée depuis le registre.
//
// **Aucun champ n'est écrit à la main ici.** L'écran lit la déclaration de
// chaque réglage (type, bornes, options, description) et fabrique le contrôle
// qui va avec. Ajouter un réglage dans `parametres/registre.ts` le fait
// apparaître ici sans que ce fichier soit rouvert : c'est tout l'intérêt du
// registre, et c'est ce que la CI vérifie.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';
import { SECTIONS } from '../core/parametres/registre';
import { COULEURS_ZONE, anneeScolaireDe } from '../core/calendrier';
import type { AnneeVacances, ApercuVacances, ZoneVacances } from '../core/calendrier';
import { aujourdhui, plage } from '../core/format';
import type { Etat as EtatService, Maj, ParametreExpose } from '../core/modeles';

@Component({
  selector: 'app-reglages',
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="d-flex flex-column gap-4">
      <div>
        <h1 class="h2 mb-2">Réglages</h1>
        <p class="text-body-secondary mb-0">
          Chaque réglage dit ce qu'il change et où l'effet se voit. Ceux marqués « bien » sont propres
          au bien ouvert.
        </p>
      </div>

      @if (erreur()) { <div class="alert alert-primary mb-0">{{ erreur() }}</div> }
      @if (message()) { <div class="alert alert-success mb-0">{{ message() }}</div> }

      @for (s of sectionsRemplies(); track s.id) {
        <section class="card">
          <div class="card-body">
            <h2 class="h5 card-title">{{ s.libelle }}</h2>
            <p class="text-body-secondary small">{{ s.description }}</p>

            <ul class="list-group list-group-flush">
              @for (p of parametresDe(s.id); track p.cle) {
                <li class="list-group-item d-flex justify-content-between align-items-start gap-3 flex-wrap px-0 py-3">
                  <div class="flex-grow-1" style="max-width:620px">
                    <div class="small fw-medium d-flex align-items-center gap-2 flex-wrap">
                      {{ p.libelle }}
                      <span class="badge rounded-pill text-bg-light border fw-normal">
                        {{ libellePortee(p.portee) }}
                      </span>
                      @if (!p.parDefaut) {
                        <span class="badge rounded-pill text-primary-emphasis bg-primary-subtle
                                     border border-primary-subtle fw-normal">modifié</span>
                      }
                    </div>
                    <p class="text-body-secondary small mt-1 mb-0">{{ p.description }}</p>
                  </div>

                  <div class="flex-shrink-0" style="min-width:220px">
                    @switch (p.type) {
                      @case ('bool') {
                        <div class="form-check form-switch">
                          <input class="form-check-input" type="checkbox" role="switch"
                                 [attr.id]="'r-' + p.cle" [checked]="p.valeur === true"
                                 (change)="poser(p, $any($event.target).checked)">
                          <label class="form-check-label small" [attr.for]="'r-' + p.cle">
                            {{ p.valeur ? 'Activé' : 'Désactivé' }}
                          </label>
                        </div>
                      }
                      @case ('int') {
                        <input class="form-control" type="number" [min]="p.min ?? 0" [max]="p.max ?? 999"
                               [value]="p.valeur" (change)="poser(p, +$any($event.target).value)"
                               [attr.aria-label]="p.libelle">
                      }
                      @case ('enum') {
                        <select class="form-select" [value]="p.valeur"
                                (change)="poser(p, $any($event.target).value)" [attr.aria-label]="p.libelle">
                          @for (o of p.options ?? []; track o.valeur) {
                            <option [value]="o.valeur">{{ o.libelle }}</option>
                          }
                        </select>
                      }
                      @default {
                        <input class="form-control" type="text" [value]="p.valeur"
                               [attr.maxlength]="p.maxLongueur ?? 200"
                               (change)="poser(p, $any($event.target).value)" [attr.aria-label]="p.libelle">
                      }
                    }
                  </div>
                </li>
              }
            </ul>
          </div>
        </section>
      }

      <!-- Les vacances scolaires sont la seule donnée de référence que
           l'application ne sait pas calculer : elle doit lui être donnée. -->
      <section class="card">
        <div class="card-body">
          <h2 class="h5 card-title">Vacances scolaires</h2>
          <p class="text-body-secondary small">
            Le calendrier fait ressortir les trois zones. Ces dates sont fixées par arrêté et ne se
            déduisent d'aucune règle : elles se mettent à jour une fois par an, en déposant ici le
            fichier officiel. L'application ne va jamais le chercher elle-même, rien ne sort d'ici.
          </p>

          @if (anneeManquante()) {
            <div class="alert alert-primary small">
              L'année scolaire {{ anneeManquante() }} n'est pas renseignée. Le calendrier l'annonce
              plutôt que d'afficher un mois sans vacances qu'on prendrait pour un mois de classe.
            </div>
          }

          @if (annees().length) {
            <div class="table-responsive">
              <table class="table table-hover align-middle mb-0">
                <thead>
                  <tr class="eyebrow">
                    <th scope="col">Année scolaire</th><th scope="col">Périodes</th>
                    <th scope="col">Couvre</th><th scope="col">Origine</th>
                  </tr>
                </thead>
                <tbody>
                  @for (a of annees(); track a.anneeScolaire) {
                    <tr>
                      <td class="small fw-medium">{{ a.anneeScolaire }}</td>
                      <td class="small tnum">{{ a.periodes }}</td>
                      <td class="small text-body-secondary tnum">{{ plage(a.debut, a.fin) }}</td>
                      <td class="small text-body-secondary">
                        {{ a.source }}@if (a.importePar) {, déposé par {{ a.importePar }}}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }

          @if (!apercu()) {
            <div class="d-flex gap-2 flex-wrap align-items-center mt-3">
              <label class="btn btn-outline-secondary mb-0">
                <i class="bi bi-calendar-plus me-1" aria-hidden="true"></i>Déposer un calendrier
                <input type="file" accept=".xlsx,.xls,.csv,.txt,text/csv" hidden
                       [disabled]="occupe()" (change)="analyserCalendrier($event)">
              </label>
              <!-- Le seul appel réseau sortant de l'application. Le bouton
                   n'apparaît que si un gérant l'a autorisé, et il ne fait que
                   remplir l'aperçu : l'enregistrement reste un second clic. -->
              @if (telechargementAutorise()) {
                <button class="btn btn-outline-secondary" (click)="telechargerCalendrier()" [disabled]="occupe()">
                  <i class="bi bi-cloud-arrow-down me-1" aria-hidden="true"></i>Récupérer en ligne
                </button>
              }
            </div>
            <p class="text-body-secondary small mt-2 mb-0" style="max-width:620px">
              Le fichier attendu est le calendrier scolaire publié sur data.education.gouv.fr
              (jeu de données « fr-en-calendrier-scolaire », export CSV). Un tableau tenu à la main
              convient aussi, avec cinq colonnes : période, zone, début, fin, année scolaire.
              @if (telechargementAutorise()) {
                « Récupérer en ligne » va le chercher pour vous : c'est le seul appel réseau
                sortant de l'application, et il n'enregistre rien sans votre confirmation.
              } @else {
                Le réglage « Télécharger le calendrier scolaire » ajoute un bouton qui va le
                chercher pour vous, au prix du seul appel réseau sortant de l'application.
              }
            </p>
          } @else {
            <div class="border-top mt-4 pt-3">
              <div class="d-flex justify-content-between align-items-center gap-3 flex-wrap">
                <h3 class="h6 mb-0">Ce qui a été lu</h3>
                <button class="btn btn-sm btn-outline-secondary" (click)="apercu.set(null)"
                        [disabled]="occupe()">Annuler</button>
              </div>
              <p class="text-body-secondary small mt-2 mb-1">
                {{ apercu()!.source }} · {{ apercu()!.format }} · {{ apercu()!.lues }} lignes lues ·
                {{ apercu()!.periodes.length }} périodes retenues.
              </p>
              <!-- La borne de fin est le seul point où deux fichiers honnêtes
                   peuvent vouloir dire deux choses : on annonce ce qui a été
                   décidé plutôt que de le supposer en silence. -->
              <p class="text-body-secondary small mb-0">
                @if (apercu()!.finEstLaReprise) {
                  Les dates de fin ont été lues comme des jours de reprise des cours : le dernier
                  jour de vacances retenu est la veille.
                } @else {
                  Les dates de fin ont été lues comme le dernier jour de vacances, sans décalage.
                }
              </p>

              <ul class="list-unstyled d-flex flex-column gap-2 small mt-3">
                @for (a of apercu()!.annees; track a.anneeScolaire) {
                  <li>
                    <strong>{{ a.anneeScolaire }}</strong> : {{ a.periodes }} périodes
                    @if (apercu()!.deja.includes(a.anneeScolaire)) {
                      <span class="badge rounded-pill text-primary-emphasis bg-primary-subtle
                                   border border-primary-subtle">remplace l'existant</span>
                    } @else {
                      <span class="badge rounded-pill text-success-emphasis bg-success-subtle
                                   border border-success-subtle">nouvelle</span>
                    }
                  </li>
                }
              </ul>

              <ul class="list-group list-group-flush mt-2 overflow-auto" style="max-height:260px">
                @for (p of apercu()!.periodes; track $index) {
                  <li class="list-group-item d-flex align-items-center gap-3 px-0 py-1 small">
                    <span class="d-inline-block rounded-1 flex-shrink-0" style="width:10px;height:10px"
                          [style.background]="couleurZone(p.zone)" aria-hidden="true"></span>
                    <span style="min-width:120px">{{ p.nom }}</span>
                    <span class="text-body-secondary">zone {{ p.zone }}</span>
                    <span class="text-body-secondary tnum">{{ plage(p.debut, p.fin) }}</span>
                  </li>
                }
              </ul>

              @if (apercu()!.rejets.length) {
                <details class="mt-3">
                  <summary class="small" style="cursor:pointer">
                    {{ apercu()!.rejets.length }} lignes écartées, et pourquoi
                  </summary>
                  <ul class="list-group list-group-flush mt-2 overflow-auto" style="max-height:260px">
                    @for (r of apercu()!.rejets.slice(0, 40); track $index) {
                      <li class="list-group-item d-flex align-items-center gap-3 px-0 py-1 small">
                        <span class="text-body-secondary" style="min-width:80px">ligne {{ r.ligne }}</span>
                        <span>{{ r.raison }}</span>
                      </li>
                    }
                  </ul>
                  @if (apercu()!.rejets.length > 40) {
                    <p class="text-body-secondary small mt-2 mb-0">
                      Les {{ apercu()!.rejets.length - 40 }} autres suivent les mêmes raisons.
                    </p>
                  }
                </details>
              }

              <button class="btn btn-primary mt-3" (click)="enregistrerCalendrier()" [disabled]="occupe()">
                Enregistrer ces {{ apercu()!.periodes.length }} périodes
              </button>
            </div>
          }
        </div>
      </section>

      <!-- Les mises à jour se voient ici aussi, parce que c'est l'écran où
           l'on passe. L'installation, elle, reste au seul endroit où le mot de
           passe est demandé : deux formulaires de confirmation pour la même
           opération, c'est un de trop. -->
      <section class="card">
        <div class="card-body">
          <h2 class="h5 card-title">Mises à jour</h2>
          <p class="text-body-secondary small">
            Version installée : <strong>{{ versionInstallee() }}</strong>.
            @if (!verificationAutorisee()) {
              La vérification est désactivée. Le réglage « Vérifier les nouvelles versions sur
              GitHub », dans la section Exploitation ci-dessus, l'autorise.
            }
          </p>

          @if (verificationAutorisee()) {
            @if (maj(); as m) {
              @if (m.misAJourDisponible) {
                <div class="alert alert-primary">
                  <strong>Version {{ m.tag }} disponible.</strong>
                  @if (m.nom && m.nom !== m.tag) { {{ m.nom }} }
                  <a routerLink="/etat">Installer depuis l'État du service</a>
                </div>
              } @else {
                <p class="text-body-secondary small">Vous êtes à jour.</p>
              }
            }
            <button class="btn btn-outline-secondary" (click)="verifierMaj()" [disabled]="occupe()">
              <i class="bi bi-arrow-repeat me-1" aria-hidden="true"></i>
              {{ occupe() ? 'Vérification...' : 'Vérifier les mises à jour' }}
            </button>
          }
        </div>
      </section>

      <section class="card">
        <div class="card-body">
          <h2 class="h5 card-title">Export</h2>
          <p class="text-body-secondary small">
            Vous n'êtes prisonnier ni d'un tableur ni de cette application. L'export complet contient la
            base et toutes les pièces jointes, et se restaure sur une instance vierge.
          </p>
          <div class="d-flex gap-2 flex-wrap">
            <button class="btn btn-outline-secondary" (click)="exporter('/export/sejours.csv')" [disabled]="occupe()">
              <i class="bi bi-filetype-csv me-1" aria-hidden="true"></i>Séjours en CSV
            </button>
            <button class="btn btn-outline-secondary" (click)="exporter('/export/instance.tar.gz')"
                    [disabled]="occupe()">
              <i class="bi bi-box-arrow-down me-1" aria-hidden="true"></i>Export complet de l'instance
            </button>
          </div>
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
  readonly maj = signal<Maj | null>(null);
  readonly versionInstallee = signal('');
  readonly verificationAutorisee = computed(() =>
    this.instance().find((p) => p.cle === 'majVerification')?.valeur === true);
  readonly erreur = signal('');
  readonly message = signal('');

  readonly tous = computed(() => [...this.instance(), ...this.duBien()]);
  readonly sectionsRemplies = computed(() => SECTIONS.filter((s) => this.parametresDe(s.id).length));

  constructor() {
    effect(() => { const b = this.etat.bien(); void this.charger(b?.id ?? null); });
    void this.chargerVacances();
    void this.api.get<EtatService>('/etat')
      .then((e) => this.versionInstallee.set(e.version))
      .catch(() => this.versionInstallee.set('inconnue'));
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

  /** Le réglage qui commande l'existence même du bouton de téléchargement. */
  readonly telechargementAutorise = computed(() =>
    this.instance().find((p) => p.cle === 'vacancesTelechargement')?.valeur === true);

  async verifierMaj(): Promise<void> {
    if (this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try {
      this.maj.set(await this.api.post<Maj>('/systeme/maj/verification', {}));
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : 'La vérification a échoué.');
    } finally {
      this.occupe.set(false);
    }
  }

  async telechargerCalendrier(): Promise<void> {
    if (this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try {
      this.apercu.set(await this.api.post<ApercuVacances>('/calendrier/vacances/telechargement', {}));
      this.nomFichier = 'data.education.gouv.fr';
    } catch (e) {
      // Le serveur dit déjà quoi faire (portail muet, sortie réseau fermée) :
      // le remplacer ferait perdre la seule information utile.
      this.erreur.set(e instanceof ErreurAppel ? e.message : 'Le téléchargement a échoué.');
    } finally {
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
