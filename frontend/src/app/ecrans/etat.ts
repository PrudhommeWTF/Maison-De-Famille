// L'état du service.
//
// C'est l'écran à ouvrir quand quelque chose ne va pas. Il dit ce qu'aucun
// journal ne montre d'un coup d'oeil : combien de courriels attendent et avec
// quelle erreur exacte du relais, quelle version de schéma est appliquée, et
// combien d'octets traînent sans être cités par la base.
//
// Il porte aussi les commandes shell à lancer sur le serveur : quand
// l'application va mal, c'est là qu'il faut regarder, et l'écran ne suppose pas
// qu'on se souvienne du nom de l'unité systemd.
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { horodatageLisible } from '../core/format';
import type { Etat as EtatModele, Maj, StatutMaj } from '../core/modeles';

@Component({
  selector: 'app-etat',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    /* Les blocs de commande gardent leur fond et défilent seuls : un chemin
       long ne doit pas élargir la page. */
    pre {
      background: var(--bs-tertiary-bg); border-radius: var(--bs-border-radius);
      padding: 12px 14px; font-size: .78rem; overflow-x: auto; margin: .5rem 0 0;
    }
  `],
  template: `
    <div class="d-flex flex-column gap-4">
      <div>
        <h1 class="h2 mb-2">État du service</h1>
        <p class="text-body-secondary mb-0">Ce qu'il faut regarder quand quelque chose ne va pas.</p>
      </div>

      @if (etat(); as e) {
        <div class="row row-cols-1 row-cols-xl-2 g-3">
          <div class="col">
            <section class="card h-100">
              <div class="card-body">
                <div class="eyebrow mb-2">Courriel</div>
                <ul class="list-group list-group-flush">
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">Relais SMTP</span>
                    <span class="fw-medium text-end">{{ e.courriel.relais || 'aucun' }}</span>
                  </li>
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">Expéditeur</span>
                    <span class="fw-medium text-end">{{ e.courriel.adresseExpediteur || 'Non renseigné' }}</span>
                  </li>
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">Adresse publique</span>
                    <span class="fw-medium text-end">{{ e.courriel.adressePublique || 'Non renseignée' }}</span>
                  </li>
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">En attente</span>
                    <span class="fw-medium tnum">{{ e.courriel.file.enAttente }}</span>
                  </li>
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">Abandonnées</span>
                    <span class="fw-medium tnum">{{ e.courriel.file.abandonnees }}</span>
                  </li>
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">Envoyées (24 h)</span>
                    <span class="fw-medium tnum">{{ e.courriel.file.envoyees24h }}</span>
                  </li>
                </ul>

                @if (!e.courriel.relais) {
                  <div class="alert alert-primary mt-3 small">
                    Aucun relais n'est configuré : les notifications s'accumulent sans partir. Définissez
                    <code>MDF_SMTP_HOST</code>, <code>MDF_SMTP_FROM</code> et <code>MDF_PUBLIC_URL</code>,
                    puis redémarrez le service.
                  </div>
                }
                @if (e.courriel.file.dernieresErreurs.length) {
                  <h3 class="h6 mt-4">Dernières erreurs du relais</h3>
                  @for (x of e.courriel.file.dernieresErreurs; track x.cree) {
                    <pre>{{ x.type }} · {{ horodatageLisible(x.cree) }}
{{ x.erreur }}</pre>
                  }
                }
              </div>
            </section>
          </div>

          <div class="col">
            <section class="card h-100">
              <div class="card-body">
                <div class="eyebrow mb-2">Base de données</div>
                <ul class="list-group list-group-flush">
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">Version du service</span>
                    <span class="fw-medium">{{ e.version }}</span>
                  </li>
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">Schéma</span>
                    <span class="fw-medium tnum">{{ e.schema.applique }} / {{ e.schema.cible }}</span>
                  </li>
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">Répertoire de données</span>
                    <span class="fw-medium text-end">{{ e.donnees.repertoire }}</span>
                  </li>
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">Personnes</span>
                    <span class="fw-medium tnum">{{ e.donnees.personnes }}</span>
                  </li>
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">Biens</span>
                    <span class="fw-medium tnum">{{ e.donnees.biens }}</span>
                  </li>
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">Séjours</span>
                    <span class="fw-medium tnum">{{ e.donnees.sejours }}</span>
                  </li>
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">Fichiers</span>
                    <span class="fw-medium tnum">{{ e.donnees.fichiers }}</span>
                  </li>
                  @if (e.donnees.orphelins.nombre) {
                    <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                      <span class="text-body-secondary">Fichiers orphelins</span>
                      <span class="fw-medium tnum">
                        {{ e.donnees.orphelins.nombre }} ({{ ko(e.donnees.orphelins.octets) }})
                      </span>
                    </li>
                  }
                </ul>
              </div>
            </section>
          </div>
        </div>

        <!-- Les mises à jour. La carte se place juste sous la version
             installée, parce que c'est là qu'on se pose la question. -->
        <section class="card">
          <div class="card-body">
            <h2 class="h5 card-title">Mises à jour</h2>

            @if (majEnCours()) {
              <div class="alert alert-primary mb-0">
                <strong>Mise à jour en cours.</strong>
                {{ statutMaj()?.message || 'Veuillez patienter.' }}
                Le service va redémarrer tout seul ; cette page se remettra à jour.
                Ne l'actualisez pas en boucle, et surtout n'éteignez pas le serveur.
              </div>
            } @else {
              <p class="text-body-secondary small">
                Version installée : <strong>{{ e.version }}</strong> · dépôt {{ e.maj.depot }}
              </p>

              @if (statutMaj(); as st) {
                @if (st.etat === 'echec') { <div class="alert alert-primary">{{ st.message }}</div> }
                @if (st.etat === 'termine') { <div class="alert alert-success">{{ st.message }}</div> }
              }
              @if (erreur()) { <div class="alert alert-primary">{{ erreur() }}</div> }

              @if (!e.maj.verificationAutorisee) {
                <p class="text-body-secondary small" style="max-width:640px">
                  La vérification des versions est désactivée. Le réglage
                  « Vérifier les nouvelles versions sur GitHub », dans Réglages, section
                  Exploitation, l'autorise. C'est un appel réseau sortant : ce serveur doit avoir
                  le droit de sortir sur Internet.
                </p>
              } @else {
                @if (maj(); as m) {
                  @if (m.misAJourDisponible) {
                    <div class="alert alert-primary">
                      <strong>Version {{ m.tag }} disponible.</strong>
                      @if (m.nom && m.nom !== m.tag) { {{ m.nom }} }
                      <a [href]="m.url" target="_blank" rel="noopener noreferrer">Voir les notes de version</a>
                    </div>
                    @if (m.notes) { <pre style="max-height:220px;overflow:auto">{{ m.notes }}</pre> }
                    @if (!m.installationPossible) {
                      <p class="text-body-secondary small" style="max-width:640px">
                        L'installation depuis l'interface n'est pas en place sur ce serveur. Mettez à
                        jour à la main, ou relancez l'installateur avec <code>MAJ_AUTO=true</code>.
                      </p>
                    }
                  } @else {
                    <p class="text-body-secondary small">Vous êtes à jour ({{ m.installee }}).</p>
                  }
                }

                <button class="btn btn-outline-secondary mt-2" (click)="verifier()" [disabled]="occupe()">
                  {{ occupe() ? 'Vérification...' : 'Vérifier les mises à jour' }}
                </button>

                <!-- La confirmation par mot de passe, en page et non dans une
                     invite du navigateur : elle doit dire ce qu'elle engage, et
                     une invite native ne met rien en forme. -->
                @if (maj()?.misAJourDisponible && maj()!.installationPossible) {
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
                }
              }
            }
          </div>
        </section>

        <section class="card">
          <div class="card-body">
            <div class="eyebrow mb-2">Migrations appliquées</div>
            <ul class="list-group list-group-flush">
              @for (m of e.schema.migrations; track m.version) {
                <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                  <span class="tnum">{{ m.version }} · {{ m.libelle }}</span>
                  <span class="text-body-secondary text-end" style="font-size:.72rem">
                    {{ horodatageLisible(m.appliqueLe) }} ({{ m.dureeMs }} ms)
                  </span>
                </li>
              }
            </ul>
          </div>
        </section>

        <section class="card">
          <div class="card-body">
            <div class="eyebrow mb-2">Sur le serveur</div>
            <p class="text-body-secondary small">Les commandes utiles, pour ne pas avoir à s'en souvenir.</p>
            <h3 class="h6 mt-3">Suivre le journal</h3>
            <pre>journalctl -f -u maison-de-famille        # LXC
docker compose logs -f                     # Docker</pre>
            <h3 class="h6 mt-3">Sauvegarder</h3>
            <pre>bash /opt/maison-de-famille/deploy/lxc/sauvegarde.sh</pre>
            <h3 class="h6 mt-3">Redémarrer</h3>
            <pre>systemctl restart maison-de-famille</pre>
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
export class EtatSysteme {
  private readonly api = inject(Api);
  readonly etat = signal<EtatModele | null>(null);
  readonly maj = signal<Maj | null>(null);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly horodatageLisible = horodatageLisible;
  motDePasse = '';
  private minuteur: ReturnType<typeof setInterval> | null = null;

  readonly statutMaj = computed<StatutMaj | null>(() => this.etat()?.maj.statut ?? null);
  readonly majEnCours = computed(() => this.statutMaj()?.etat === 'en_cours');

  constructor() {
    void this.charger();
  }

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
      this.erreur.set(e instanceof ErreurAppel ? e.message : 'Le lancement a échoué.');
    } finally {
      this.occupe.set(false);
    }
  }

  ko(octets: number): string {
    return octets > 1048576 ? `${Math.round(octets / 1048576)} Mo` : `${Math.round(octets / 1024)} Ko`;
  }
}
