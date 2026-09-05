// L'écran atteint depuis le lien reçu par courriel.
//
// Le jeton voyage dans l'adresse. Il ne sert qu'une fois et expire en quatre
// heures : un lien périmé doit le dire clairement et proposer d'en demander un
// nouveau, plutôt que de laisser la personne devant un formulaire qui échoue.
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, ErreurAppel } from '../core/api';

@Component({
  selector: 'app-reinitialisation',
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: grid; place-items: center; min-height: 100vh; padding: 24px 16px; }
    .carte { width: 100%; max-width: 420px; padding: 24px; }
    h1 { font-size: 20px; margin-bottom: 10px; }
    .aide { color: var(--encre-3); font-size: 12.5px; margin: 0 0 18px; }
    .actions { display: flex; flex-direction: column; gap: 10px; margin-top: 18px; }
  `],
  template: `
    <div class="carte">
      @if (fini()) {
        <h1>Mot de passe enregistré</h1>
        <p class="aide">Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.</p>
        <div class="actions"><a class="btn btn-primaire" routerLink="/connexion">Se connecter</a></div>
      } @else if (!jeton) {
        <h1>Lien incomplet</h1>
        <p class="aide">Ce lien ne porte pas de jeton. Redemandez-en un depuis l'écran de connexion.</p>
        <div class="actions"><a class="btn" routerLink="/connexion">Retour</a></div>
      } @else {
        <h1>Choisir un nouveau mot de passe</h1>
        <p class="aide">Douze caractères au moins. Une phrase dont vous vous souvenez fait un très bon mot de passe.</p>
        <form (ngSubmit)="valider()">
          <div class="champ" [class.champ-erreur]="champs()['motDePasse']">
            <label for="r-mdp">Nouveau mot de passe</label>
            <input id="r-mdp" name="motDePasse" type="password" [(ngModel)]="motDePasse" autocomplete="new-password" required autofocus>
            @if (champs()['motDePasse']) { <p class="message-erreur">{{ champs()['motDePasse'] }}</p> }
          </div>
          @if (erreur()) {
            <div class="encart">
              {{ erreur() }}
              <div style="margin-top:8px"><a routerLink="/connexion">Demander un nouveau lien</a></div>
            </div>
          }
          <div class="actions">
            <button class="btn btn-primaire" type="submit" [disabled]="occupe()">Enregistrer</button>
          </div>
        </form>
      }
    </div>
  `,
})
export class Reinitialisation {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  readonly jeton = inject(ActivatedRoute).snapshot.queryParamMap.get('jeton') ?? '';

  motDePasse = '';
  readonly occupe = signal(false);
  readonly fini = signal(false);
  readonly erreur = signal('');
  readonly champs = signal<Record<string, string>>({});

  async valider(): Promise<void> {
    if (this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.champs.set({});
    try {
      await this.api.post('/auth/mot-de-passe-reinitialiser', { jeton: this.jeton, motDePasse: this.motDePasse });
      this.fini.set(true);
      // L'adresse porte le jeton : on la nettoie pour qu'il ne reste pas dans
      // l'historique du navigateur ni dans un partage d'écran.
      void this.router.navigate([], { queryParams: {} });
    } catch (e) {
      if (e instanceof ErreurAppel) { this.erreur.set(e.message); this.champs.set(e.champs); }
      else this.erreur.set("Une erreur inattendue s'est produite.");
    } finally {
      this.occupe.set(false);
    }
  }
}
