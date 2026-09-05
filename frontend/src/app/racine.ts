import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** La racine ne fait rien d'autre que porter le routeur : tout le chrome vit
 *  dans `shell/cadre.ts`, qui n'est chargé qu'une fois la session ouverte. */
@Component({
  selector: 'app-racine',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<router-outlet />',
})
export class Racine {}
