// L'aide : les guides d'utilisation, dans l'application.
//
// **Pourquoi ici et pas seulement sur GitHub.** Les guides sont écrits pour la
// famille, et la famille n'ouvre pas GitHub. Une aide qu'il faut aller chercher
// ailleurs n'est pas lue, et la question revient à la personne qui gère, ce que
// l'application est censée éviter.
//
// Le contenu vient de `docs/guides/`, compilé en HTML à la compilation (voir
// `scripts/aide.ts`) : une seule source, lue aussi bien ici que sur le dépôt.
import {
  ChangeDetectionStrategy, Component, ElementRef, effect, inject, signal, viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

interface Fiche { slug: string; titre: string; pourQui: string }
interface Contenu { titre: string; html: string; sommaire: { id: string; texte: string }[] }

@Component({
  selector: 'app-aide',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    /* La colonne des guides suit le défilement, qui est long sur le guide du
       gérant. Au doigt, elle reste au-dessus du texte. */
    @media (min-width: 768px) {
      .cote { position: sticky; top: calc(var(--mdf-entete) + var(--mdf-contexte) + 1rem); max-height: 80vh; overflow-y: auto; }
    }
  `],
  template: `
    <div class="d-flex flex-column gap-4">
      <div>
        <h1 class="h2 mb-2">Aide</h1>
        <p class="text-body-secondary mb-0">
          Les guides d'utilisation, celui qui vous concerne comme les autres.
        </p>
      </div>

      <div class="row g-4">
        <div class="col-12 col-md-4 col-xl-3">
          <nav class="nav nav-pills flex-column gap-1 cote" aria-label="Les guides">
            @for (f of fiches(); track f.slug) {
              <a class="nav-link side-link text-start d-flex gap-3 align-items-start"
                 [routerLink]="['/aide', f.slug]" routerLinkActive="active">
                <i class="bi bi-book text-body-secondary mt-1" aria-hidden="true"></i>
                <span>
                  <span class="d-block">{{ f.titre }}</span>
                  <span class="d-block text-body-secondary lh-sm" style="font-size:.72rem">{{ f.pourQui }}</span>
                </span>
              </a>
            }
          </nav>

          @if (contenu(); as c) {
            @if (c.sommaire.length > 2) {
              <!-- Au doigt, la colonne est empilée au-dessus du texte : vingt
                   entrées de sommaire repousseraient le guide hors de l'écran. -->
              <div class="d-none d-md-block">
                <div class="eyebrow px-2 pt-4 pb-2">Dans ce guide</div>
                <nav class="nav flex-column gap-1" aria-label="Sommaire du guide">
                  @for (e of c.sommaire; track e.id) {
                    <!-- routerLink et non href : une ancre nue se résout sur
                         « <base href="/"> » et renvoyait au tableau de bord. -->
                    <a class="nav-link side-link text-start py-1 small"
                       [routerLink]="['/aide', slug()]" [fragment]="e.id">{{ e.texte }}</a>
                  }
                </nav>
              </div>
            }
          }
        </div>

        <div class="col-12 col-md-8 col-xl-9">
          @if (contenu(); as c) {
            <section class="card">
              <div class="card-body">
                <h2 class="h4 card-title mb-4">{{ c.titre }}</h2>
                <!-- Le HTML vient de nos propres guides, compilés au moment du
                     « build » ; Angular le désinfecte en plus à l'affichage. -->
                <div #guide class="guide" [innerHTML]="c.html" (click)="suivre($event)"></div>
              </div>
            </section>
          } @else if (erreur()) {
            <div class="alert alert-primary">{{ erreur() }}</div>
          } @else {
            <div class="card"><div class="card-body">
              <p class="text-body-secondary small mb-0">Chargement...</p>
            </div></div>
          }
        </div>
      </div>
    </div>
  `,
})
export class Aide {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly fiches = signal<Fiche[]>([]);
  readonly contenu = signal<Contenu | null>(null);
  readonly erreur = signal('');

  /** Le guide demandé, ou la page d'orientation quand l'adresse n'en nomme aucun. */
  readonly slug = toSignal(this.route.paramMap.pipe(map((p) => p.get('slug') ?? 'guides')),
    { initialValue: 'guides' });

  private readonly boite = viewChild<ElementRef<HTMLElement>>('guide');
  private readonly fragment = toSignal(this.route.fragment, { initialValue: null });

  constructor() {
    void fetch('aide/index.json').then((r) => r.json())
      .then((r: { guides: Fiche[] }) => this.fiches.set(r.guides))
      .catch(() => { /* la liste manque : le guide affiché reste lisible */ });

    // Un effet et non un chargement dans le constructeur : le composant est
    // réutilisé d'un guide à l'autre, le constructeur ne repasse pas, et
    // l'écran serait resté sur le premier guide ouvert.
    effect(() => { void this.charger(this.slug()); });

    // Deux choses que le HTML injecté ne peut pas faire tout seul.
    //
    // 1. **Les ancres.** Angular retire les attributs « id » en désinfectant :
    //    les titres arrivaient sans ancre, et le sommaire ne menait nulle part.
    //    On les repose depuis le sommaire, qui est dans le même ordre. Reposer
    //    l'attribut plutôt que désactiver la désinfection : le contenu est le
    //    nôtre, mais l'exception se serait oubliée là pour toujours.
    // 2. **Le défilement.** Le navigateur ne saute pas à une ancre qui
    //    n'existait pas encore au moment de la navigation, et ce contenu
    //    arrive après.
    effect(() => {
      const c = this.contenu();
      const el = this.boite()?.nativeElement;
      if (!c || !el) return;
      el.querySelectorAll('h2').forEach((titre, i) => {
        const e = c.sommaire[i];
        if (e) titre.id = e.id;
      });
      const vise = this.fragment();
      if (vise) requestAnimationFrame(() => el.querySelector(`[id="${vise}"]`)?.scrollIntoView({ block: 'start' }));
    });
  }

  /**
   * Un lien d'un guide vers un autre reste dans l'application.
   *
   * Ces liens vivent dans du HTML injecté : ils ne peuvent pas porter de
   * `routerLink`. Sans cette interception, chaque renvoi entre guides
   * rechargeait l'application entière, ce qui se voit et se sent.
   */
  suivre(evt: Event): void {
    const lien = (evt.target as HTMLElement | null)?.closest('a');
    const href = lien?.getAttribute('href');
    if (!href || !href.startsWith('/aide/')) return;
    evt.preventDefault();
    void this.router.navigateByUrl(href);
  }

  private async charger(slug: string): Promise<void> {
    this.contenu.set(null);
    try {
      const r = await fetch(`aide/${slug}.json`);
      if (!r.ok) throw new Error(String(r.status));
      this.contenu.set(await r.json() as Contenu);
    } catch {
      this.erreur.set("Ce guide n'a pas pu être ouvert. Il a peut-être été renommé.");
    }
  }
}
