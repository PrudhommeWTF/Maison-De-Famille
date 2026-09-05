// Mon compte : mot de passe, second facteur, préférences, déconnexion.
//
// L'activation du second facteur est le seul écran de cette application qui
// affiche un secret. Deux précautions y sont prises :
//
//   - les **codes de secours ne sont montrés qu'une fois**, et l'écran le dit
//     clairement avec un bouton pour les imprimer. Un téléphone se perd ;
//   - la session **reste ouverte** après l'activation. Déconnecter à ce moment
//     précis obligerait à attendre le code suivant, trente secondes devant un
//     écran d'erreur, juste après avoir suivi une consigne de sécurité.
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';

@Component({
  selector: 'app-compte',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .secret {
      font-family: ui-monospace, monospace; font-size: 15px; letter-spacing: .08em;
      background: var(--pastille-neutre); padding: 12px 14px; border-radius: 10px; word-break: break-all;
    }
    .secours { columns: 2; column-gap: 20px; font-family: ui-monospace, monospace; font-size: 14px; line-height: 2; }
    @media print {
      .btn, nav, header { display: none !important; }
    }
  `],
  template: `
    <div class="colonne">
      <div>
        <h1>Mon compte</h1>
        <p class="secondaire" style="margin:6px 0 0">
          {{ etat.moi()?.personne?.nom }} · {{ etat.moi()?.personne?.email }}
        </p>
      </div>

      @if (erreur()) { <div class="encart">{{ erreur() }}</div> }
      @if (message()) { <div class="encart-positif">{{ message() }}</div> }

      <section class="carte">
        <h2>Second facteur</h2>
        @if (etat.moi()?.secondFacteur?.actif) {
          <p class="secondaire" style="margin:8px 0 0">
            Le second facteur est actif. Il vous reste
            {{ etat.moi()?.secondFacteur?.codesDeSecoursRestants }} code(s) de secours.
          </p>
          @if (secours().length) {
            <div class="encart" style="margin-top:14px">
              <strong>Imprimez ces codes maintenant : ils ne seront plus jamais affichés.</strong>
              Chacun vaut une connexion, si vous n'avez pas votre téléphone.
            </div>
            <div class="secours" style="margin-top:12px">
              @for (c of secours(); track c) { <div>{{ c }}</div> }
            </div>
            <button class="btn" style="margin-top:14px" (click)="imprimer()">Imprimer</button>
          }
          <div style="margin-top:14px">
            <button class="btn-lien" (click)="desactivation.set(!desactivation())">Désactiver le second facteur</button>
          </div>
          @if (desactivation()) {
            <div class="champ" style="margin-top:12px;max-width:320px">
              <label for="c-mdp-off">Confirmez avec votre mot de passe</label>
              <input id="c-mdp-off" name="mdpOff" type="password" [(ngModel)]="mdpDesactivation" autocomplete="current-password">
              <button class="btn" style="margin-top:10px" (click)="desactiver()" [disabled]="occupe()">Désactiver</button>
            </div>
          }
        } @else if (enrolement()) {
          <p class="secondaire" style="margin:8px 0 12px">
            Ouvrez votre application d'authentification (Google Authenticator, Aegis, Bitwarden...),
            ajoutez un compte, et saisissez ce secret. Puis entrez le code affiché.
          </p>
          <div class="secret">{{ enrolement()!.secretLisible }}</div>
          <div class="champ" style="margin-top:14px;max-width:220px">
            <label for="c-code">Code à six chiffres</label>
            <input id="c-code" name="code" [(ngModel)]="code" inputmode="numeric" placeholder="123456" autocomplete="one-time-code">
          </div>
          <button class="btn btn-primaire" (click)="activer()" [disabled]="occupe()">Activer</button>
        } @else {
          <p class="secondaire" style="margin:8px 0 12px">
            Un code à six chiffres en plus du mot de passe. Cette application publie l'adresse des
            biens, les codes d'accès et les périodes d'inoccupation : c'est ce que protège le second
            facteur.
            @if (etat.moi()?.secondFacteur?.obligatoirePourGerant) {
              <strong>Il est obligatoire pour les gérants sur cette instance.</strong>
            }
          </p>
          <button class="btn btn-primaire" (click)="preparer()" [disabled]="occupe()">Activer le second facteur</button>
        }
      </section>

      <section class="carte">
        <h2>Mot de passe</h2>
        <form (ngSubmit)="changerMotDePasse()" style="margin-top:12px;max-width:360px">
          <div class="champ">
            <label for="c-actuel">Mot de passe actuel</label>
            <input id="c-actuel" name="actuel" type="password" [(ngModel)]="mdp.actuel" autocomplete="current-password" required>
          </div>
          <div class="champ" [class.champ-erreur]="champs()['motDePasse']">
            <label for="c-nouveau">Nouveau mot de passe</label>
            <input id="c-nouveau" name="nouveau" type="password" [(ngModel)]="mdp.nouveau" autocomplete="new-password" required>
            @if (champs()['motDePasse']) { <p class="message-erreur">{{ champs()['motDePasse'] }}</p> }
          </div>
          <p class="meta" style="margin:0 0 12px">
            Changer votre mot de passe ferme toutes vos sessions, y compris celle-ci.
          </p>
          <button class="btn" type="submit" [disabled]="occupe()">Changer</button>
        </form>
      </section>

      <section class="carte">
        <h2>Affichage</h2>
        <label style="display:flex;align-items:center;gap:10px;margin-top:12px;cursor:pointer">
          <input type="checkbox" style="width:auto;min-height:0" [checked]="etat.moi()?.semaineCommenceDimanche"
                 (change)="changerSemaine($event)">
          <span>Commencer la semaine le dimanche dans le calendrier</span>
        </label>
      </section>

      <section class="carte">
        <h2>Session</h2>
        <p class="secondaire" style="margin:8px 0 12px">
          Vous déconnecter ferme cette session sur cet appareil uniquement.
        </p>
        <button class="btn" (click)="deconnecter()">Se déconnecter</button>
      </section>
    </div>
  `,
})
export class Compte {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  readonly enrolement = signal<{ uri: string; secretLisible: string } | null>(null);
  readonly secours = signal<string[]>([]);
  readonly desactivation = signal(false);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');
  readonly champs = signal<Record<string, string>>({});

  code = '';
  mdpDesactivation = '';
  mdp = { actuel: '', nouveau: '' };

  async preparer(): Promise<void> {
    await this.agir(async () => {
      this.enrolement.set(await this.api.post<{ uri: string; secretLisible: string }>('/auth/totp/preparation'));
    });
  }

  async activer(): Promise<void> {
    await this.agir(async () => {
      const r = await this.api.post<{ secours: string[]; acces: string }>('/auth/totp/activation', { code: this.code.trim() });
      // Un jeton neuf, sans la marque de session limitée : l'accès complet
      // revient immédiatement.
      this.api.rafraichirAcces(r.acces);
      this.secours.set(r.secours);
      this.enrolement.set(null);
      this.code = '';
      this.message.set('Second facteur activé.');
      await this.etat.rafraichir();
    });
  }

  async desactiver(): Promise<void> {
    await this.agir(async () => {
      await this.api.post('/auth/totp/desactivation', { motDePasse: this.mdpDesactivation });
      this.mdpDesactivation = '';
      this.desactivation.set(false);
      this.secours.set([]);
      this.message.set('Second facteur désactivé.');
      await this.etat.rafraichir();
    });
  }

  async changerMotDePasse(): Promise<void> {
    await this.agir(async () => {
      await this.api.post('/auth/mot-de-passe', this.mdp);
      this.mdp = { actuel: '', nouveau: '' };
      // Le serveur a révoqué toutes les sessions : rester sur place afficherait
      // des erreurs à chaque clic.
      this.api.oublierSession();
      this.etat.vider();
      await this.router.navigate(['/connexion']);
    });
  }

  async changerSemaine(evt: Event): Promise<void> {
    const valeur = (evt.target as HTMLInputElement).checked;
    await this.agir(async () => {
      await this.api.post('/parametres/personnels', { cle: 'semaineCommenceDimanche', valeur });
      await this.etat.rafraichir();
    });
  }

  async deconnecter(): Promise<void> {
    await this.api.deconnexion();
    this.etat.vider();
    await this.router.navigate(['/connexion']);
  }

  imprimer(): void { window.print(); }

  private async agir(action: () => Promise<void>): Promise<void> {
    if (this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    this.champs.set({});
    try { await action(); }
    catch (e) {
      if (e instanceof ErreurAppel) { this.erreur.set(e.message); this.champs.set(e.champs); }
      else this.erreur.set("L'action a échoué.");
    }
    finally { this.occupe.set(false); }
  }
}
