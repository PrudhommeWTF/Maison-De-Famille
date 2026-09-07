// La vue d'ensemble : ce qui tourne, et faut-il le mettre à jour.
//
// C'est la première section de l'administration, parce que c'est la première
// question qu'on se pose en l'ouvrant. Elle répond à trois choses et pas une de
// plus : quelle version tourne, y en a-t-il une meilleure, et est-ce que le
// service va bien.
//
// **La confirmation par mot de passe reste ici, et nulle part ailleurs.** Ce
// bouton fait exécuter du code en root sur la machine. Deux formulaires de
// confirmation pour la même opération, c'est un de trop, et le second finit
// toujours par être celui qu'on clique sans lire.
import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, ErreurAppel } from '../../core/api';
import type { Etat as EtatModele, Maj, StatutMaj } from '../../core/modeles';

@Component({
  selector: 'app-administration-apercu',
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    pre {
      background: var(--bs-tertiary-bg); border-radius: var(--bs-border-radius);
      padding: 12px 14px; font-size: .78rem; overflow-x: auto; margin: .5rem 0 0;
    }
  `],
  template: `
    <div class="d-flex flex-column gap-3">
      @if (etat(); as e) {
        <section class="card">
          <div class="card-body">
            <div class="eyebrow mb-2">Cette instance</div>
            <div class="d-flex flex-wrap gap-4">
              <div>
                <div class="text-body-secondary small">Version installée</div>
                @if (e.maj.versionConnue) {
                  <div class="fs-4 fw-medium tnum card-title mb-0">{{ e.version }}</div>
                } @else {
                  <!-- « 0.0.0 » n'est pas une version : c'est ce que le service
                       répond quand personne ne la lui a dite. L'annoncer comme un
                       fait faisait proposer une mise à jour vers la version déjà
                       installée. -->
                  <div class="fs-4 fw-medium card-title mb-0 text-primary">Inconnue</div>
                }
              </div>
              <div>
                <div class="text-body-secondary small">Schéma de la base</div>
                <div class="fs-4 fw-medium tnum card-title mb-0">{{ e.schema.applique }} / {{ e.schema.cible }}</div>
              </div>
              <div>
                <div class="text-body-secondary small">Courriels en attente</div>
                <div class="fs-4 fw-medium tnum card-title mb-0"
                     [class.text-primary]="e.courriel.file.enAttente > 0">{{ e.courriel.file.enAttente }}</div>
              </div>
              <div>
                <div class="text-body-secondary small">Dépôt</div>
                <div class="fs-6 fw-medium mt-2">{{ e.maj.depot }}</div>
              </div>
            </div>

            @if (!e.maj.versionConnue) {
              <div class="alert alert-primary mt-3 mb-0 small">
                <strong>Le service ne sait pas quelle version il exécute.</strong>
                Il répond « 0.0.0 », ce qui rend toute comparaison fausse : la dernière version
                publiée paraîtra toujours plus récente, même si c'est celle qui tourne.
                Corrigez en ajoutant <code>MDF_VERSION=</code> suivi de la version réelle dans
                <code>/etc/maison-de-famille/mdf.env</code>, puis
                <code>systemctl restart maison-de-famille</code>. Relancer l'installateur le fait
                aussi, et tout seul.
              </div>
            }
            @if (!e.courriel.relais) {
              <p class="text-body-secondary small mt-3 mb-0">
                Aucun relais de courriel n'est configuré : les notifications s'accumulent sans partir.
                <a routerLink="/administration/courriel">Voir la file d'envoi</a>.
              </p>
            }
          </div>
        </section>

        <section class="card">
          <div class="card-body">
            <div class="eyebrow mb-2">Mises à jour</div>

            @if (majEnCours()) {
              <div class="alert alert-primary mb-0">
                <strong>Mise à jour en cours.</strong>
                {{ statutMaj()?.message || 'Veuillez patienter.' }}
                Le service va redémarrer tout seul ; cette page se remettra à jour.
                Ne l'actualisez pas en boucle, et surtout n'éteignez pas le serveur.
              </div>
            } @else {
              @if (statutMaj(); as st) {
                @if (st.etat === 'echec') { <div class="alert alert-primary">{{ st.message }}</div> }
                @if (st.etat === 'termine') { <div class="alert alert-success">{{ st.message }}</div> }
              }
              @if (erreur()) { <div class="alert alert-primary">{{ erreur() }}</div> }

              <!-- Les deux verrous sont distincts, et l'écran doit dire lequel
                   manque : le réglage autorise l'appel à GitHub, l'assistant
                   root rend l'installation possible. L'un sans l'autre ne sert
                   à rien, et se taire sur le manquant est ce qui donnait
                   l'impression d'un bouton absent sans raison. -->
              @if (!e.maj.verificationAutorisee) {
                <p class="text-body-secondary small mb-2">
                  La vérification des versions est désactivée. C'est un appel réseau sortant, le seul
                  avec le calendrier scolaire, et il ne s'allume pas tout seul.
                </p>
                <a class="btn btn-outline-secondary" routerLink="/administration/reglages"
                   fragment="exploitation">
                  <i class="bi bi-sliders me-1" aria-hidden="true"></i>Activer dans les Réglages
                </a>
              } @else {
                @if (maj(); as m) {
                  @if (!m.versionConnue) {
                    <div class="alert alert-primary">
                      <strong>Dernière version publiée : {{ m.tag }}.</strong>
                      Impossible de dire si elle est plus récente que ce qui tourne ici, la version
                      installée étant inconnue.
                      <a [href]="m.url" target="_blank" rel="noopener noreferrer">Voir les notes de version</a>
                    </div>
                  } @else if (m.misAJourDisponible) {
                    <div class="alert alert-primary">
                      <strong>Version {{ m.tag }} disponible.</strong>
                      @if (m.nom && m.nom !== m.tag) { {{ m.nom }} }
                      <a [href]="m.url" target="_blank" rel="noopener noreferrer">Voir les notes de version</a>
                    </div>
                  } @else {
                    <div class="alert alert-success">
                      Vous êtes à jour : {{ m.installee }} est la dernière version publiée.
                    </div>
                  }
                  @if (m.notes && m.misAJourDisponible) {
                    <pre style="max-height:220px;overflow:auto">{{ m.notes }}</pre>
                  }
                }

                <button class="btn btn-outline-secondary mt-2" (click)="verifier()" [disabled]="occupe()">
                  <i class="bi bi-arrow-repeat me-1" aria-hidden="true"></i>
                  {{ occupe() ? 'Vérification...' : 'Vérifier les mises à jour' }}
                </button>

                @if (maj()?.misAJourDisponible) {
                  @if (maj()!.installationPossible) {
                    <!-- La confirmation par mot de passe, en page et non dans une
                         invite du navigateur : elle doit dire ce qu'elle engage, et
                         une invite native ne met rien en forme. -->
                    <div class="border-top mt-4 pt-3">
                      <h3 class="h6">Installer la version {{ maj()!.tag }}</h3>
                      <p class="text-body-secondary small" style="max-width:640px">
                        Le serveur va télécharger cette version, la recompiler et redémarrer. Comptez
                        une à deux minutes pendant lesquelles l'application ne répondra pas. Une
                        sauvegarde de la base est prise automatiquement avant toute migration.
                      </p>
                      <p class="text-body-secondary small" style="max-width:640px">
                        <strong>Cette opération installe et exécute du code sur votre serveur.</strong>
                        Elle se confirme par votre mot de passe, comme une connexion.
                      </p>
                      <form (ngSubmit)="installer()">
                        <div class="mb-3" style="max-width:340px">
                          <label class="form-label small text-body-secondary" for="maj-mdp">Votre mot de passe</label>
                          <input class="form-control" id="maj-mdp" name="motDePasse" type="password"
                                 autocomplete="current-password" [(ngModel)]="motDePasse" required>
                        </div>
                        <button class="btn btn-primary" type="submit" [disabled]="occupe() || !motDePasse">
                          Installer maintenant
                        </button>
                      </form>
                    </div>
                  } @else {
                    <div class="border-top mt-4 pt-3">
                      <h3 class="h6">L'installation depuis l'interface n'est pas en place</h3>
                      <p class="text-body-secondary small mb-0" style="max-width:640px">
                        Le service tourne sans privilège : il ne peut pas remplacer son propre code,
                        et c'est voulu. L'installation depuis cet écran demande un assistant root,
                        posé par l'installateur uniquement si vous le lui demandez. Relancez-le dans
                        le conteneur avec
                        <code>MAJ_AUTO=true bash /opt/maison-de-famille/deploy/lxc/install.sh</code>,
                        ou mettez à jour à la main en le relançant sans cette variable.
                      </p>
                    </div>
                  }
                }
              }
            }
          </div>
        </section>
      } @else {
        <div class="card"><div class="card-body">
          <p class="text-body-secondary small mb-0">Chargement...</p>
        </div></div>
      }
    </div>
  `,
})
export class AdministrationApercu implements OnDestroy {
  private readonly api = inject(Api);
  readonly etat = signal<EtatModele | null>(null);
  readonly maj = signal<Maj | null>(null);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  motDePasse = '';
  private minuteur: ReturnType<typeof setInterval> | null = null;

  readonly statutMaj = computed<StatutMaj | null>(() => this.etat()?.maj.statut ?? null);
  readonly majEnCours = computed(() => this.statutMaj()?.etat === 'en_cours');

  constructor() { void this.charger(); }

  private async charger(): Promise<void> {
    const e = await this.api.get<EtatModele>('/etat').catch(() => null);
    this.etat.set(e);
    // Pendant une mise à jour, le service s'arrête puis revient : on interroge
    // régulièrement, et un appel qui échoue pendant ce temps est normal. Le
    // service, lui, débloque tout seul un état qui cesse de progresser.
    if (e?.maj.statut.etat === 'en_cours' && !this.minuteur) {
      this.minuteur = setInterval(() => { void this.charger(); }, 5000);
    }
    if (e && e.maj.statut.etat !== 'en_cours' && this.minuteur) {
      clearInterval(this.minuteur);
      this.minuteur = null;
    }
  }

  /**
   * Le sondage de progression ne survit pas à l'écran.
   *
   * L'ancien écran d'état ne le faisait pas : quitter la page pendant une mise à
   * jour laissait un appel toutes les cinq secondes tourner jusqu'au
   * rechargement de l'application.
   */
  ngOnDestroy(): void { if (this.minuteur) clearInterval(this.minuteur); }

  async verifier(): Promise<void> {
    if (this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    try {
      this.maj.set(await this.api.post<Maj>('/systeme/maj/verification', {}));
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : 'La vérification a échoué.');
    } finally {
      this.occupe.set(false);
    }
  }

  async installer(): Promise<void> {
    if (this.occupe() || !this.motDePasse) return;
    this.occupe.set(true);
    this.erreur.set('');
    try {
      await this.api.post('/systeme/maj', { motDePasse: this.motDePasse });
      this.motDePasse = '';
      await this.charger();
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : 'Le lancement de la mise à jour a échoué.');
    } finally {
      this.occupe.set(false);
    }
  }
}
