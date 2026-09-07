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
    :host { display: grid; place-items: center; min-height: 100vh; }
  `],
  template: `
    <div class="w-100 p-3" style="max-width:420px">
      <div class="card">
        <div class="card-body p-4">
          @if (fini()) {
            <h1 class="h5 card-title">Mot de passe enregistré</h1>
            <p class="text-body-secondary small">
              Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.
            </p>
            <div class="d-grid"><a class="btn btn-primary" routerLink="/connexion">Se connecter</a></div>
          } @else if (!jeton) {
            <h1 class="h5 card-title">Lien incomplet</h1>
            <p class="text-body-secondary small">
              Ce lien ne porte pas de jeton. Redemandez-en un depuis l'écran de connexion.
            </p>
            <div class="d-grid"><a class="btn btn-outline-secondary" routerLink="/connexion">Retour</a></div>
          } @else {
            <h1 class="h5 card-title">Choisir un nouveau mot de passe</h1>
            <p class="text-body-secondary small">
              Douze caractères au moins. Une phrase dont vous vous souvenez fait un très bon mot de passe.
            </p>
            <form (ngSubmit)="valider()">
              <div class="mb-3">
                <label class="form-label small text-body-secondary" for="r-mdp">Nouveau mot de passe</label>
                <input class="form-control" [class.is-invalid]="champs()['motDePasse']" id="r-mdp" name="motDePasse"
                       type="password" [(ngModel)]="motDePasse" autocomplete="new-password" required autofocus>
                @if (champs()['motDePasse']) {
                  <div class="invalid-feedback d-block">{{ champs()['motDePasse'] }}</div>
                }
              </div>
              @if (erreur()) {
                <div class="alert alert-primary">
                  {{ erreur() }}
                  <div class="mt-2"><a routerLink="/connexion">Demander un nouveau lien</a></div>
                </div>
              }
              <div class="d-grid">
                <button class="btn btn-primary" type="submit" [disabled]="occupe()">Enregistrer</button>
              </div>
            </form>
          }
        </div>
      </div>
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
