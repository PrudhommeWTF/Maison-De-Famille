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
    .apercu-maj { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--separateur); }
    .kv { display: flex; justify-content: space-between; gap: 14px; padding: 9px 0; border-top: 1px solid var(--separateur); }
    .kv:first-child { border-top: none; }
    .kv .cle { color: var(--encre-3); font-size: 12.5px; }
    pre {
      background: var(--pastille-neutre); border-radius: 10px; padding: 12px 14px;
      font-size: 12.5px; overflow-x: auto; margin: 8px 0 0;
    }
  `],
  template: `
    <div class="colonne">
      <div>
        <h1>État du service</h1>
        <p class="secondaire" style="margin:6px 0 0">Ce qu'il faut regarder quand quelque chose ne va pas.</p>
      </div>

      @if (etat(); as e) {
        <div class="grille" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
          <section class="carte">
            <h2>Courriel</h2>
            <div style="margin-top:10px">
              <div class="kv">
                <span class="cle">Relais SMTP</span>
                <span>{{ e.courriel.relais || 'aucun' }}</span>
              </div>
              <div class="kv"><span class="cle">Expéditeur</span><span>{{ e.courriel.adresseExpediteur || 'Non renseigné' }}</span></div>
              <div class="kv"><span class="cle">Adresse publique</span><span>{{ e.courriel.adressePublique || 'Non renseignée' }}</span></div>
              <div class="kv"><span class="cle">En attente</span><span class="chiffres">{{ e.courriel.file.enAttente }}</span></div>
              <div class="kv"><span class="cle">Abandonnées</span><span class="chiffres">{{ e.courriel.file.abandonnees }}</span></div>
              <div class="kv"><span class="cle">Envoyées (24 h)</span><span class="chiffres">{{ e.courriel.file.envoyees24h }}</span></div>
            </div>

            @if (!e.courriel.relais) {
              <div class="encart" style="margin-top:12px">
                Aucun relais n'est configuré : les notifications s'accumulent sans partir. Définissez
                <code>MDF_SMTP_HOST</code>, <code>MDF_SMTP_FROM</code> et <code>MDF_PUBLIC_URL</code>,
                puis redémarrez le service.
              </div>
            }
            @if (e.courriel.file.dernieresErreurs.length) {
              <h3 style="margin-top:16px">Dernières erreurs du relais</h3>
              @for (x of e.courriel.file.dernieresErreurs; track x.cree) {
                <pre>{{ x.type }} · {{ horodatageLisible(x.cree) }}
{{ x.erreur }}</pre>
              }
            }
          </section>

          <section class="carte">
            <h2>Base de données</h2>
            <div style="margin-top:10px">
              <div class="kv"><span class="cle">Version du service</span><span>{{ e.version }}</span></div>
              <div class="kv">
                <span class="cle">Schéma</span>
                <span class="chiffres">{{ e.schema.applique }} / {{ e.schema.cible }}</span>
              </div>
              <div class="kv"><span class="cle">Répertoire de données</span><span>{{ e.donnees.repertoire }}</span></div>
              <div class="kv"><span class="cle">Personnes</span><span class="chiffres">{{ e.donnees.personnes }}</span></div>
              <div class="kv"><span class="cle">Biens</span><span class="chiffres">{{ e.donnees.biens }}</span></div>
              <div class="kv"><span class="cle">Séjours</span><span class="chiffres">{{ e.donnees.sejours }}</span></div>
              <div class="kv"><span class="cle">Fichiers</span><span class="chiffres">{{ e.donnees.fichiers }}</span></div>
              @if (e.donnees.orphelins.nombre) {
                <div class="kv">
                  <span class="cle">Fichiers orphelins</span>
                  <span class="chiffres">{{ e.donnees.orphelins.nombre }} ({{ ko(e.donnees.orphelins.octets) }})</span>
                </div>
              }
            </div>
          </section>
        </div>

        <!-- Les mises à jour. La carte se place juste sous la version
             installée, parce que c'est là qu'on se pose la question. -->
        <section class="carte">
          <h2>Mises à jour</h2>

          @if (majEnCours()) {
            <div class="encart">
              <strong>Mise à jour en cours.</strong>
              {{ statutMaj()?.message || 'Veuillez patienter.' }}
              Le service va redémarrer tout seul ; cette page se remettra à jour.
              Ne l'actualisez pas en boucle, et surtout n'éteignez pas le serveur.
            </div>
          } @else {
            <p class="secondaire" style="margin:6px 0 12px">
              Version installée : <strong>{{ e.version }}</strong> · dépôt {{ e.maj.depot }}
            </p>

            @if (statutMaj(); as st) {
              @if (st.etat === 'echec') { <div class="encart">{{ st.message }}</div> }
              @if (st.etat === 'termine') { <div class="encart-positif">{{ st.message }}</div> }
            }
            @if (erreur()) { <div class="encart">{{ erreur() }}</div> }

            @if (!e.maj.verificationAutorisee) {
              <p class="secondaire" style="max-width:640px">
                La vérification des versions est désactivée. Le réglage
                « Vérifier les nouvelles versions sur GitHub », dans Réglages, section
                Exploitation, l'autorise. C'est un appel réseau sortant : ce serveur doit avoir
                le droit de sortir sur Internet.
              </p>
            } @else {
              @if (maj(); as m) {
                @if (m.misAJourDisponible) {
                  <div class="encart">
                    <strong>Version {{ m.tag }} disponible.</strong>
                    @if (m.nom && m.nom !== m.tag) { {{ m.nom }} }
                    <a [href]="m.url" target="_blank" rel="noopener noreferrer">Voir les notes de version</a>
                  </div>
                  @if (m.notes) { <pre style="max-height:220px;overflow:auto">{{ m.notes }}</pre> }
                  @if (!m.installationPossible) {
                    <p class="secondaire" style="max-width:640px">
                      L'installation depuis l'interface n'est pas en place sur ce serveur. Mettez à
                      jour à la main, ou relancez l'installateur avec <code>MAJ_AUTO=true</code>.
                    </p>
                  }
                } @else {
                  <p class="secondaire">Vous êtes à jour ({{ m.installee }}).</p>
                }
              }

              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
                <button class="btn" (click)="verifier()" [disabled]="occupe()">
                  {{ occupe() ? 'Vérification...' : 'Vérifier les mises à jour' }}
                </button>
              </div>

              <!-- La confirmation par mot de passe, en page et non dans une
                   invite du navigateur : elle doit dire ce qu'elle engage, et
                   une invite native ne met rien en forme. -->
              @if (maj()?.misAJourDisponible && maj()!.installationPossible) {
                <div class="apercu-maj">
                  <h3 style="margin:0">Installer la version {{ maj()!.tag }}</h3>
                  <p class="secondaire" style="margin:6px 0 0;max-width:640px">
                    Le serveur va télécharger cette version, la recompiler et redémarrer. Comptez
                    une à deux minutes pendant lesquelles l'application ne répondra pas. Une
                    sauvegarde de la base est prise automatiquement avant toute migration.
                  </p>
                  <p class="secondaire" style="margin:8px 0 0;max-width:640px">
                    <strong>Cette opération installe et exécute du code sur votre serveur.</strong>
                    Elle se confirme par votre mot de passe, comme une connexion.
                  </p>
                  <form (ngSubmit)="installer()" style="margin-top:12px">
                    <div class="champ" style="max-width:340px">
                      <label for="maj-mdp">Votre mot de passe</label>
                      <input id="maj-mdp" name="motDePasse" type="password" autocomplete="current-password"
                             [(ngModel)]="motDePasse" required>
                    </div>
                    <button class="btn btn-primaire" type="submit" [disabled]="occupe() || !motDePasse">
                      Installer maintenant
                    </button>
                  </form>
                </div>
              }
            }
          }
        </section>

        <section class="carte">
          <h2>Migrations appliquées</h2>
          <div style="margin-top:10px">
            @for (m of e.schema.migrations; track m.version) {
              <div class="kv">
                <span class="cle chiffres">{{ m.version }} · {{ m.libelle }}</span>
                <span class="meta">{{ horodatageLisible(m.appliqueLe) }} ({{ m.dureeMs }} ms)</span>
              </div>
            }
          </div>
        </section>

        <section class="carte">
          <h2>Sur le serveur</h2>
          <p class="secondaire" style="margin:6px 0 0">Les commandes utiles, pour ne pas avoir à s'en souvenir.</p>
          <h3 style="margin-top:14px">Suivre le journal</h3>
          <pre>journalctl -f -u maison-de-famille        # LXC
docker compose logs -f                     # Docker</pre>
          <h3 style="margin-top:14px">Sauvegarder</h3>
          <pre>bash /opt/maison-de-famille/deploy/lxc/sauvegarde.sh</pre>
          <h3 style="margin-top:14px">Redémarrer</h3>
          <pre>systemctl restart maison-de-famille</pre>
        </section>
      } @else {
        <div class="carte"><p class="vide">Chargement...</p></div>
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
