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
    :host { display: block; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px 60px; }
    .boite { width: 100%; max-width: 420px; }
    .marque {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      font-family: var(--titre); font-size: 21px; font-weight: 500; margin-bottom: 6px;
    }
    .marque i { color: var(--accent); }
    .sous { text-align: center; color: var(--encre-3); font-size: 13px; margin: 0 0 22px; }
    .carte { padding: 24px; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .aide { color: var(--encre-3); font-size: 12.5px; margin: 0 0 18px; }
    .actions { display: flex; flex-direction: column; gap: 10px; margin-top: 18px; }
    .liens { display: flex; justify-content: space-between; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
    fieldset { border: none; padding: 0; margin: 0 0 4px; }
    legend { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .1em; color: var(--libelle-section); padding: 0; margin-bottom: 10px; }
    .deux { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 480px) { .deux { grid-template-columns: 1fr; } }
  `],
  template: `
    <div class="boite">
      <div class="marque"><i class="bi bi-houses" aria-hidden="true"></i> Maison de Famille</div>
      <p class="sous">Le planning, les séjours et les décisions de la famille, au même endroit.</p>

      <div class="carte">
        @switch (vue()) {

          @case ('amorce') {
            <h1>Première installation</h1>
            <p class="aide">
              Cette instance est vierge. Créez le premier compte, qui sera gérant, ainsi que la
              structure et le premier bien. Le reste se saisit ensuite tranquillement.
            </p>
            <form (ngSubmit)="amorcer()">
              <fieldset>
                <legend>Vous</legend>
                <div class="champ" [class.champ-erreur]="champs()['nom']">
                  <label for="a-nom">Votre nom</label>
                  <input id="a-nom" name="nom" [(ngModel)]="f.nom" autocomplete="name" required>
                  @if (champs()['nom']) { <p class="message-erreur">{{ champs()['nom'] }}</p> }
                </div>
                <div class="champ" [class.champ-erreur]="champs()['email']">
                  <label for="a-email">Votre adresse de courriel</label>
                  <input id="a-email" name="email" type="email" [(ngModel)]="f.email" autocomplete="username" required>
                  @if (champs()['email']) { <p class="message-erreur">{{ champs()['email'] }}</p> }
                </div>
                <div class="champ" [class.champ-erreur]="champs()['motDePasse']">
                  <label for="a-mdp">Mot de passe</label>
                  <input id="a-mdp" name="motDePasse" type="password" [(ngModel)]="f.motDePasse" autocomplete="new-password" required>
                  @if (champs()['motDePasse']) { <p class="message-erreur">{{ champs()['motDePasse'] }}</p> }
                  @else { <p class="aide" style="margin:4px 0 0">Douze caractères au moins. Une phrase dont vous vous souvenez fait un très bon mot de passe.</p> }
                </div>
              </fieldset>

              <fieldset>
                <legend>La structure</legend>
                <div class="champ">
                  <label for="a-mode">Mode de détention</label>
                  <select id="a-mode" name="structureMode" [(ngModel)]="f.structureMode">
                    <option value="indivision">Indivision</option>
                    <option value="sci">SCI</option>
                    <option value="nom_propre">Nom propre</option>
                  </select>
                </div>
                <div class="champ">
                  <label for="a-snom">Nom de la structure</label>
                  <input id="a-snom" name="structureNom" [(ngModel)]="f.structureNom" placeholder="Indivision Kerloc'h" required>
                </div>
              </fieldset>

              <fieldset>
                <legend>Le premier bien</legend>
                <div class="champ">
                  <label for="a-bnom">Nom du bien</label>
                  <input id="a-bnom" name="bienNom" [(ngModel)]="f.bienNom" placeholder="Maison de Kerloc'h" required>
                </div>
                <div class="deux">
                  <div class="champ">
                    <label for="a-commune">Commune</label>
                    <input id="a-commune" name="commune" [(ngModel)]="f.commune" required>
                  </div>
                  <div class="champ">
                    <label for="a-type">Type</label>
                    <select id="a-type" name="type" [(ngModel)]="f.type">
                      <option value="mer">Bord de mer</option>
                      <option value="montagne">Montagne</option>
                      <option value="campagne">Campagne</option>
                      <option value="ville">Ville</option>
                    </select>
                  </div>
                </div>
                <div class="champ">
                  <label for="a-couchages">Couchages</label>
                  <input id="a-couchages" name="couchages" type="number" min="1" max="100" [(ngModel)]="f.couchages" required>
                </div>
              </fieldset>

              @if (erreur()) { <div class="encart">{{ erreur() }}</div> }
              <div class="actions">
                <button class="btn btn-primaire" type="submit" [disabled]="occupe()">
                  {{ occupe() ? 'Création en cours...' : 'Créer l\\'instance' }}
                </button>
              </div>
            </form>
          }

          @case ('oubli') {
            <h1>Mot de passe oublié</h1>
            <p class="aide">Indiquez votre adresse de courriel : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
            <form (ngSubmit)="demanderLien()">
              <div class="champ">
                <label for="o-email">Adresse de courriel</label>
                <input id="o-email" name="email" type="email" [(ngModel)]="f.email" autocomplete="username" required>
              </div>
              @if (erreur()) { <div class="encart">{{ erreur() }}</div> }
              <div class="actions">
                <button class="btn btn-primaire" type="submit" [disabled]="occupe()">Envoyer le lien</button>
                <button class="btn" type="button" (click)="vue.set('connexion')">Revenir à la connexion</button>
              </div>
            </form>
          }

          @case ('oubli-envoye') {
            <h1>C'est envoyé</h1>
            <!-- Le message ne dit jamais si l'adresse existe : sinon, cet écran
                 permettrait de savoir qui fait partie de la famille. -->
            <p class="aide">
              Si un compte utilise cette adresse, un courriel vient de partir avec un lien valable
              quatre heures. Pensez à regarder dans les indésirables.
            </p>
            <div class="actions">
              <button class="btn" type="button" (click)="vue.set('connexion')">Revenir à la connexion</button>
            </div>
          }

          @default {
            <h1>Connexion</h1>
            <p class="aide">Entrez votre adresse de courriel et votre mot de passe.</p>
            <form (ngSubmit)="connecter()">
              <div class="champ">
                <label for="c-email">Adresse de courriel</label>
                <input id="c-email" name="email" type="email" [(ngModel)]="f.email" autocomplete="username" required autofocus>
              </div>
              <div class="champ">
                <label for="c-mdp">Mot de passe</label>
                <input id="c-mdp" name="motDePasse" type="password" [(ngModel)]="f.motDePasse" autocomplete="current-password" required>
              </div>
              @if (codeAttendu()) {
                <div class="champ">
                  <label for="c-code">Code de votre application d'authentification</label>
                  <input id="c-code" name="code" [(ngModel)]="f.code" inputmode="numeric" autocomplete="one-time-code"
                         placeholder="123456" autofocus>
                  <p class="aide" style="margin:4px 0 0">Un code de secours convient aussi.</p>
                </div>
              }
              @if (erreur()) { <div class="encart">{{ erreur() }}</div> }
              <div class="actions">
                <button class="btn btn-primaire" type="submit" [disabled]="occupe()">
                  {{ occupe() ? 'Connexion...' : 'Se connecter' }}
                </button>
              </div>
            </form>
            <div class="liens">
              <button class="btn-lien" type="button" (click)="allerOubli()">J'ai oublié mon mot de passe</button>
            </div>
          }
        }
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
