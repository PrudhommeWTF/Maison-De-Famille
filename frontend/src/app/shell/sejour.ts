// L'entrée par un lien temporaire.
//
// L'écran que voit un locataire ou un invité qui clique sur le lien reçu. Il
// n'a pas de compte, pas de mot de passe, et n'en aura pas : le jeton du lien
// est son seul titre d'accès.
//
// **Il ne demande rien.** Ni nom, ni adresse, ni mot de passe : tout est déjà
// dans le lien, et chaque champ ajouté ici serait un obstacle de plus devant
// quelqu'un qui arrive un vendredi soir avec une valise dans une main. Le seul
// cas où il parle, c'est quand le lien ne vaut plus, et il dit alors quoi faire.
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api, ErreurAppel } from '../core/api';
import { Etat } from '../core/etat';

@Component({
  selector: 'app-sejour',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    /* La page d'entrée n'a pas de cadre : elle centre sa boîte, et rien
       d'autre. Bootstrap n'a pas d'utilitaire pour « au milieu de la fenêtre ». */
    :host { display: grid; place-items: center; min-height: 100vh; }
  `],
  template: `
    <div class="w-100 p-3 pb-5" style="max-width:420px">
      <div class="d-flex align-items-center justify-content-center gap-2 h4 mb-4">
        <i class="bi bi-houses text-primary" aria-hidden="true"></i>Maison de Famille
      </div>
      <div class="card">
        <div class="card-body p-4">
          @if (erreur()) {
            <h1 class="h5 card-title">Ce lien n'est plus valable</h1>
            <p class="text-body-secondary small mb-0">{{ erreur() }}</p>
          } @else {
            <h1 class="h5 card-title">Bienvenue</h1>
            <p class="text-body-secondary small mb-0">
              Ouverture de votre accès{{ libelle() ? ', ' + libelle() : '' }}...
            </p>
          }
        </div>
      </div>
    </div>
  `,
})
export class EntreeSejour {
  private readonly api = inject(Api);
  private readonly etat = inject(Etat);
  private readonly router = inject(Router);

  readonly erreur = signal('');
  readonly libelle = signal('');

  constructor() { void this.entrer(); }

  private async entrer(): Promise<void> {
    const jeton = new URLSearchParams(window.location.search).get('jeton') ?? '';
    if (!jeton) {
      this.erreur.set(
        "L'adresse ne porte pas de jeton. Ouvrez le lien complet tel qu'il vous a été envoyé, "
        + 'sans le recopier à la main.');
      return;
    }
    try {
      const r = await this.api.post<{ acces: string; renouvellement: string; libelle: string }>(
        '/auth/lien', { jeton });
      this.libelle.set(r.libelle);
      this.api.poserSession(r.acces, r.renouvellement);
      await this.etat.charger();
      // Le calendrier plutôt que le tableau de bord : ce qui intéresse un
      // locataire, ce sont ses dates et le coffre-fort, pas la trésorerie de
      // l'indivision, qu'il ne verra jamais.
      await this.router.navigate(['/bien/calendrier'], { replaceUrl: true });
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message
        : "Ce lien n'a pas pu être ouvert. Demandez-en un nouveau à la personne qui vous l'a envoyé.");
    }
  }
}
