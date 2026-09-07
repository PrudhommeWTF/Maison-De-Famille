// Connexion, amorçage de l'instance, et mot de passe oublié.
//
// C'est le premier écran, et pour une partie de la famille le seul qu'elle verra
// avant de renoncer. Trois exigences le gouvernent :
//
//   - **il dit ce qu'il faut faire**, sans jargon ni écran intermédiaire ;
//   - **le mot de passe oublié est en évidence**, parce que certains se
//     connectent trois fois par an et l'auront oublié à chaque fois ;
//   - **un message d'erreur explique**, il ne se contente pas de rougir un champ.
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';

type Vue = 'connexion' | 'oubli' | 'oubli-envoye' | 'amorce';

@Component({
  selector: 'app-connexion',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    /* La page de connexion n'a pas de cadre : elle centre sa boîte, et rien
       d'autre. Bootstrap n'a pas d'utilitaire pour « au milieu de la fenêtre ». */
    :host { display: grid; place-items: center; min-height: 100vh; }
  `],
  template: `
    <div class="w-100 p-3 pb-5" style="max-width:420px">
      <div class="d-flex align-items-center justify-content-center gap-2 h4 mb-1">
        <i class="bi bi-houses text-primary" aria-hidden="true"></i>Maison de Famille
      </div>
      <p class="text-center text-body-secondary small mb-4">
        Le planning, les séjours et les décisions de la famille, au même endroit.
      </p>

      <div class="card">
        <div class="card-body p-4">
          @switch (vue()) {

            @case ('amorce') {
              <h1 class="h5 card-title">Première installation</h1>
              <p class="text-body-secondary small">
                Cette instance est vierge. Créez le premier compte, qui sera gérant, ainsi que la
                structure et le premier bien. Le reste se saisit ensuite tranquillement.
              </p>
              <form (ngSubmit)="amorcer()">
                <div class="eyebrow mt-4 mb-2">Vous</div>
                <div class="mb-3">
                  <label class="form-label small text-body-secondary" for="a-nom">Votre nom</label>
                  <input class="form-control" [class.is-invalid]="champs()['nom']" id="a-nom" name="nom"
                         [(ngModel)]="f.nom" autocomplete="name" required>
                  @if (champs()['nom']) { <div class="invalid-feedback d-block">{{ champs()['nom'] }}</div> }
                </div>
                <div class="mb-3">
                  <label class="form-label small text-body-secondary" for="a-email">Votre adresse de courriel</label>
                  <input class="form-control" [class.is-invalid]="champs()['email']" id="a-email" name="email"
                         type="email" [(ngModel)]="f.email" autocomplete="username" required>
                  @if (champs()['email']) { <div class="invalid-feedback d-block">{{ champs()['email'] }}</div> }
                </div>
                <div class="mb-3">
                  <label class="form-label small text-body-secondary" for="a-mdp">Mot de passe</label>
                  <input class="form-control" [class.is-invalid]="champs()['motDePasse']" id="a-mdp" name="motDePasse"
                         type="password" [(ngModel)]="f.motDePasse" autocomplete="new-password" required>
                  @if (champs()['motDePasse']) {
                    <div class="invalid-feedback d-block">{{ champs()['motDePasse'] }}</div>
                  } @else {
                    <div class="form-text">
                      Douze caractères au moins. Une phrase dont vous vous souvenez fait un très bon mot de passe.
                    </div>
                  }
                </div>

                <div class="eyebrow mt-4 mb-2">La structure</div>
                <div class="mb-3">
                  <label class="form-label small text-body-secondary" for="a-mode">Mode de détention</label>
                  <select class="form-select" id="a-mode" name="structureMode" [(ngModel)]="f.structureMode">
                    <option value="indivision">Indivision</option>
                    <option value="sci">SCI</option>
                    <option value="nom_propre">Nom propre</option>
                  </select>
                </div>
                <div class="mb-3">
                  <label class="form-label small text-body-secondary" for="a-snom">Nom de la structure</label>
                  <input class="form-control" id="a-snom" name="structureNom" [(ngModel)]="f.structureNom"
                         placeholder="Indivision Kerloc'h" required>
                </div>

                <div class="eyebrow mt-4 mb-2">Le premier bien</div>
                <div class="mb-3">
                  <label class="form-label small text-body-secondary" for="a-bnom">Nom du bien</label>
                  <input class="form-control" id="a-bnom" name="bienNom" [(ngModel)]="f.bienNom"
                         placeholder="Maison de Kerloc'h" required>
                </div>
                <div class="row g-3 mb-3">
                  <div class="col-12 col-sm-6">
                    <label class="form-label small text-body-secondary" for="a-commune">Commune</label>
                    <input class="form-control" id="a-commune" name="commune" [(ngModel)]="f.commune" required>
                  </div>
                  <div class="col-12 col-sm-6">
                    <label class="form-label small text-body-secondary" for="a-type">Type</label>
                    <select class="form-select" id="a-type" name="type" [(ngModel)]="f.type">
                      <option value="mer">Bord de mer</option>
                      <option value="montagne">Montagne</option>
                      <option value="campagne">Campagne</option>
                      <option value="ville">Ville</option>
                    </select>
                  </div>
                </div>
                <div class="mb-3">
                  <label class="form-label small text-body-secondary" for="a-couchages">Couchages</label>
                  <input class="form-control" id="a-couchages" name="couchages" type="number" min="1" max="100"
                         [(ngModel)]="f.couchages" required>
                </div>

                @if (erreur()) { <div class="alert alert-primary">{{ erreur() }}</div> }
                <button class="btn btn-primary w-100" type="submit" [disabled]="occupe()">
                  {{ occupe() ? 'Création en cours...' : 'Créer l\\'instance' }}
                </button>
              </form>
            }

            @case ('oubli') {
              <h1 class="h5 card-title">Mot de passe oublié</h1>
              <p class="text-body-secondary small">
                Indiquez votre adresse de courriel : vous recevrez un lien pour choisir un nouveau mot de passe.
              </p>
              <form (ngSubmit)="demanderLien()">
                <div class="mb-3">
                  <label class="form-label small text-body-secondary" for="o-email">Adresse de courriel</label>
                  <input class="form-control" id="o-email" name="email" type="email" [(ngModel)]="f.email"
                         autocomplete="username" required>
                </div>
                @if (erreur()) { <div class="alert alert-primary">{{ erreur() }}</div> }
                <div class="d-grid gap-2">
                  <button class="btn btn-primary" type="submit" [disabled]="occupe()">Envoyer le lien</button>
                  <button class="btn btn-outline-secondary" type="button"
                          (click)="vue.set('connexion')">Revenir à la connexion</button>
                </div>
              </form>
            }

            @case ('oubli-envoye') {
              <h1 class="h5 card-title">C'est envoyé</h1>
              <!-- Le message ne dit jamais si l'adresse existe : sinon, cet écran
                   permettrait de savoir qui fait partie de la famille. -->
              <p class="text-body-secondary small">
                Si un compte utilise cette adresse, un courriel vient de partir avec un lien valable
                quatre heures. Pensez à regarder dans les indésirables.
              </p>
              <div class="d-grid">
                <button class="btn btn-outline-secondary" type="button"
                        (click)="vue.set('connexion')">Revenir à la connexion</button>
              </div>
            }

            @default {
              <h1 class="h5 card-title">Connexion</h1>
              <p class="text-body-secondary small">Entrez votre adresse de courriel et votre mot de passe.</p>
              <form (ngSubmit)="connecter()">
                <div class="mb-3">
                  <label class="form-label small text-body-secondary" for="c-email">Adresse de courriel</label>
                  <input class="form-control" id="c-email" name="email" type="email" [(ngModel)]="f.email"
                         autocomplete="username" required autofocus>
                </div>
                <div class="mb-3">
                  <label class="form-label small text-body-secondary" for="c-mdp">Mot de passe</label>
                  <input class="form-control" id="c-mdp" name="motDePasse" type="password" [(ngModel)]="f.motDePasse"
                         autocomplete="current-password" required>
                </div>
                @if (codeAttendu()) {
                  <div class="mb-3">
                    <label class="form-label small text-body-secondary" for="c-code">
                      Code de votre application d'authentification
                    </label>
                    <input class="form-control" id="c-code" name="code" [(ngModel)]="f.code" inputmode="numeric"
                           autocomplete="one-time-code" placeholder="123456" autofocus>
                    <div class="form-text">Un code de secours convient aussi.</div>
                  </div>
                }
                @if (erreur()) { <div class="alert alert-primary">{{ erreur() }}</div> }
                <div class="d-grid">
                  <button class="btn btn-primary" type="submit" [disabled]="occupe()">
                    {{ occupe() ? 'Connexion...' : 'Se connecter' }}
                  </button>
                </div>
              </form>
              <button class="btn btn-sm btn-link text-body-secondary p-0 mt-3" type="button"
                      (click)="allerOubli()">J'ai oublié mon mot de passe</button>
            }
          }
        </div>
      </div>
    </div>
  `,
})
export class Connexion {
  private readonly api = inject(Api);
  private readonly etat = inject(Etat);
  private readonly router = inject(Router);

  readonly vue = signal<Vue>('connexion');
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly champs = signal<Record<string, string>>({});
  private readonly codeRequis = signal(false);
  readonly codeAttendu = computed(() => this.codeRequis());

  f = {
    nom: '', email: '', motDePasse: '', code: '',
    structureMode: 'indivision', structureNom: '',
    bienNom: '', commune: '', type: 'mer', couchages: 6,
  };

  constructor() {
    // Une instance vierge n'a aucun compte : proposer un formulaire de connexion
    // serait un mur. On bascule directement sur l'amorçage.
    void this.api.get<{ amorcee: boolean }>('/amorce')
      .then((r) => { if (!r.amorcee) this.vue.set('amorce'); })
      .catch(() => { /* le serveur répondra à la connexion */ });
  }

  allerOubli(): void { this.erreur.set(''); this.vue.set('oubli'); }

  async connecter(): Promise<void> {
    await this.tenter(() => this.ouvrirSession());
  }

  /**
   * L'ouverture de session elle-même, sans l'enveloppe `tenter`.
   *
   * Elle est séparée parce que l'amorçage enchaîne sur elle : appeler
   * `connecter()` depuis `amorcer()` imbriquerait deux `tenter`, et le garde
   * « déjà occupé » du second annulerait silencieusement la connexion. Le
   * compte était bien créé, et l'écran restait sur le formulaire sans un mot.
   */
  private async ouvrirSession(): Promise<void> {
    const r = await this.api.post<{ acces: string; renouvellement: string }>('/auth/connexion', {
      email: this.f.email.trim(), motDePasse: this.f.motDePasse,
      ...(this.f.code ? { code: this.f.code.trim() } : {}),
    });
    this.api.poserSession(r.acces, r.renouvellement);
    await this.etat.charger();
    await this.router.navigate(['/']);
  }

  async demanderLien(): Promise<void> {
    await this.tenter(async () => {
      await this.api.post('/auth/mot-de-passe-oublie', { email: this.f.email.trim() });
      this.vue.set('oubli-envoye');
    });
  }

  async amorcer(): Promise<void> {
    await this.tenter(async () => {
      await this.api.post('/amorce', {
        nom: this.f.nom.trim(), email: this.f.email.trim(), motDePasse: this.f.motDePasse,
        foyerNom: this.f.nom.trim(),
        structureMode: this.f.structureMode, structureNom: this.f.structureNom.trim(),
        bienNom: this.f.bienNom.trim(), commune: this.f.commune.trim(),
        type: this.f.type, couchages: Number(this.f.couchages),
      });
      this.vue.set('connexion');
      await this.ouvrirSession();
    });
  }

  /** Le tronc commun : occupé, erreurs de champ, message lisible. */
  private async tenter(action: () => Promise<void>): Promise<void> {
    if (this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.champs.set({});
    try {
      await action();
    } catch (e) {
      if (e instanceof ErreurAppel) {
        // Le second facteur n'est pas une erreur : c'est une étape de plus.
        if (e.code === 'SECOND_FACTEUR_REQUIS') {
          this.codeRequis.set(true);
          this.erreur.set(this.f.code ? e.message : '');
        } else {
          this.erreur.set(e.message);
          this.champs.set(e.champs);
        }
      } else {
        this.erreur.set("Une erreur inattendue s'est produite.");
      }
    } finally {
      this.occupe.set(false);
    }
  }
}
