// La fiche du bien.
//
// En tranche 1, elle porte l'identité du bien et sa capacité, qui sert à la
// détection de conflits. Les caractéristiques, le guide d'arrivée, l'inventaire
// et le carnet d'adresses arrivent en tranche 3, avec leur code : une carte
// vide qui promet un contenu à venir ne rend service à personne.
import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ErreurAppel } from '../core/api';
import { Fichiers } from '../core/fichiers';
import { Etat } from '../core/etat';
import type { FicheBien } from '../core/modeles';

interface LigneFiche { id: number; cle: string; valeur: string }
interface Contact {
  id: number; nom: string; role: string; telephone: string; email: string; notes: string;
}

@Component({
  selector: 'app-fiche',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    /* La photo remplit son cadre : Bootstrap pose la proportion, pas le
       recadrage. */
    .photo img { width: 100%; height: 100%; object-fit: cover; }
  `],
  template: `
    <div class="d-flex flex-column gap-4">
      @if (fiche(); as f) {
        <div class="ratio rounded-4 overflow-hidden border bg-body-tertiary photo position-relative"
             style="--bs-aspect-ratio:26%">
          @if (f.bien.photoFichierId) {
            <img [src]="fichiers.image(f.bien.photoFichierId)()" [alt]="'Photo de ' + f.bien.nom">
          } @else {
            <div class="d-flex align-items-center justify-content-center text-body-secondary fs-2">
              <i class="bi bi-image" aria-hidden="true"></i>
            </div>
          }
          @if (etat.estGeranteIci()) {
            <div class="d-flex align-items-end justify-content-end p-3" style="pointer-events:none">
              <label class="btn btn-sm btn-outline-secondary bg-body" style="pointer-events:auto">
                <i class="bi bi-upload me-1" aria-hidden="true"></i>Photo
                <input type="file" accept="image/*" (change)="televerser($event)" hidden>
              </label>
            </div>
          }
        </div>

        <div class="d-flex justify-content-between align-items-end gap-3 flex-wrap">
          <div>
            <h1 class="h2 mb-2">{{ f.bien.nom }}</h1>
            <p class="text-body-secondary mb-0">
              {{ f.bien.adresse || f.bien.commune }}{{ f.bien.codePostal ? ', ' + f.bien.codePostal : '' }}
              · détenu par {{ f.structure.nom }}
            </p>
          </div>
          @if (etat.estGeranteIci()) {
            <button class="btn btn-outline-secondary" (click)="edition.set(!edition())">
              <i class="bi bi-pencil me-1" aria-hidden="true"></i>
              {{ edition() ? 'Fermer' : 'Modifier la fiche' }}
            </button>
          }
        </div>

        @if (erreur()) { <div class="alert alert-primary mb-0">{{ erreur() }}</div> }
        @if (message()) { <div class="alert alert-success mb-0">{{ message() }}</div> }

        @if (edition()) {
          <section class="card">
            <div class="card-body">
              <h2 class="h5 card-title">Modifier la fiche</h2>
              <form class="row g-3" (ngSubmit)="enregistrer()">
                <div class="col-12 col-md-6">
                  <label class="form-label small text-body-secondary" for="f-nom">Nom</label>
                  <input class="form-control" id="f-nom" name="nom" [(ngModel)]="e.nom" required>
                </div>
                <div class="col-12 col-md-4">
                  <label class="form-label small text-body-secondary" for="f-commune">Commune</label>
                  <input class="form-control" id="f-commune" name="commune" [(ngModel)]="e.commune" required>
                </div>
                <div class="col-12 col-md-2">
                  <label class="form-label small text-body-secondary" for="f-cp">Code postal</label>
                  <input class="form-control" id="f-cp" name="codePostal" [(ngModel)]="e.codePostal" maxlength="10">
                </div>
                <div class="col-12">
                  <label class="form-label small text-body-secondary" for="f-adresse">Adresse</label>
                  <input class="form-control" id="f-adresse" name="adresse" [(ngModel)]="e.adresse" maxlength="240">
                </div>
                <div class="col-12 col-md-4">
                  <label class="form-label small text-body-secondary" for="f-couchages">Couchages</label>
                  <input class="form-control" id="f-couchages" name="couchages" type="number" min="1" max="100"
                         [(ngModel)]="e.couchages" required>
                  <div class="form-text">Sert à la détection de dépassement de capacité.</div>
                </div>
                <div class="col-12 col-md-4">
                  <label class="form-label small text-body-secondary" for="f-type">Type</label>
                  <select class="form-select" id="f-type" name="type" [(ngModel)]="e.type">
                    <option value="mer">Bord de mer</option>
                    <option value="montagne">Montagne</option>
                    <option value="campagne">Campagne</option>
                    <option value="ville">Ville</option>
                  </select>
                </div>
                <div class="col-12 col-md-4">
                  <label class="form-label small text-body-secondary" for="f-loc">Location saisonnière</label>
                  <select class="form-select" id="f-loc" name="locationActivee" [(ngModel)]="e.locationActivee">
                    <option [ngValue]="false">Non activée</option>
                    <option [ngValue]="true">Activée</option>
                  </select>
                  <div class="form-text">
                    Ouvre l'écran Location saisonnière sur ce bien : réservations, loyers encaissés
                    et net à répartir. Sans cela, le module n'existe nulle part sur ce bien.
                  </div>
                </div>
                <div class="col-12">
                  <label class="form-label small text-body-secondary" for="f-notes">Notes</label>
                  <textarea class="form-control" id="f-notes" name="notes" rows="3"
                            [(ngModel)]="e.notes" maxlength="1000"></textarea>
                </div>
                <div class="col-12">
                  <button class="btn btn-primary" type="submit" [disabled]="occupe()">Enregistrer</button>
                </div>
              </form>
            </div>
          </section>
        }

        <div class="row row-cols-1 row-cols-md-2 row-cols-xl-3 g-3">
          <div class="col">
            <section class="card h-100">
              <div class="card-body">
                <div class="eyebrow mb-2">Caractéristiques</div>
                <ul class="list-group list-group-flush">
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">Commune</span><span class="fw-medium">{{ f.bien.commune }}</span>
                  </li>
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">Couchages</span>
                    <span class="fw-medium tnum">{{ f.bien.couchages }}</span>
                  </li>
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">Type</span>
                    <span class="fw-medium">{{ typeLisible(f.bien.type) }}</span>
                  </li>
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">Location saisonnière</span>
                    <span class="fw-medium">{{ f.bien.locationActivee ? 'activée' : 'non activée' }}</span>
                  </li>
                </ul>
              </div>
            </section>
          </div>

          <div class="col">
            <section class="card h-100">
              <div class="card-body">
                <div class="eyebrow mb-2">Détention</div>
                <ul class="list-group list-group-flush">
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">Structure</span><span class="fw-medium">{{ f.structure.nom }}</span>
                  </li>
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">Mode</span>
                    <span class="fw-medium">{{ modeLisible(f.structure.mode) }}</span>
                  </li>
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">Règle de décision</span>
                    <span class="fw-medium text-end">{{ f.regleMajorite }}</span>
                  </li>
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">Votre rôle</span>
                    <span class="fw-medium">{{ roleLisible(f.role) }}</span>
                  </li>
                </ul>
                @if (f.structure.notes) {
                  <p class="text-body-secondary small mt-3 mb-0">{{ f.structure.notes }}</p>
                }
              </div>
            </section>
          </div>

          <div class="col">
            <section class="card h-100">
              <div class="card-body d-flex flex-column">
                <div class="eyebrow mb-2">Inventaire</div>
                @if (inventaire().length) {
                  <ul class="list-group list-group-flush flex-grow-1">
                    @for (i of inventaire(); track i.id) {
                      <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                        <span>{{ i.libelle }}</span>
                        <span class="text-body-secondary">{{ i.etat || 'Bon' }}</span>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="text-body-secondary small flex-grow-1">Aucune ligne d'inventaire.</p>
                }
                <button class="btn btn-sm btn-outline-secondary w-100 mt-3" type="button"
                        (click)="casse.set(!casse())">
                  {{ casse() ? 'Fermer' : 'Signaler une casse' }}
                </button>
                @if (casse()) {
                  <form class="row g-2 mt-1" (ngSubmit)="signalerCasse()">
                    <div class="col-12">
                      <input class="form-control" name="klib" [(ngModel)]="fCasseLibelle" aria-label="Ce qui est cassé"
                             placeholder="le matelas de la chambre nord">
                    </div>
                    <div class="col-12">
                      <input class="form-control" name="kdet" [(ngModel)]="fCasseDetail" aria-label="Détail"
                             placeholder="affaissé au milieu">
                    </div>
                    <div class="col-12">
                      <button class="btn btn-primary w-100" type="submit"
                              [disabled]="occupe() || !fCasseLibelle.trim()">Signaler</button>
                    </div>
                  </form>
                  <p class="text-body-secondary small mt-2 mb-0">
                    Le signalement crée une tâche dans le carnet d'entretien et marque la ligne
                    d'inventaire à remplacer.
                  </p>
                }
              </div>
            </section>
          </div>
        </div>

        <section class="card">
          <div class="card-body">
            <div class="eyebrow mb-2">
              <i class="bi bi-signpost-split me-2" aria-hidden="true"></i>Guide d'arrivée
            </div>
            <p class="text-body-secondary small">
              Ce qu'il faut savoir en arrivant. Visible de tous ceux qui séjournent, sans les codes,
              qui vivent au coffre-fort avec leur propre portée.
            </p>
            @if (guide().length) {
              <ul class="list-group list-group-flush">
                @for (g of guide(); track g.id) {
                  <li class="list-group-item d-flex justify-content-between gap-3 px-0 small">
                    <span class="text-body-secondary">{{ g.cle }}</span>
                    <span class="text-end">
                      {{ g.valeur }}
                      @if (peutModifierFiche()) {
                        <button class="btn btn-sm btn-link text-body-secondary p-0 ms-2" type="button"
                                (click)="retirerLigneFiche(g.id)">retirer</button>
                      }
                    </span>
                  </li>
                }
              </ul>
            } @else {
              <p class="text-body-secondary small mb-0">
                Rien pour l'instant. Les clés, l'eau, les poubelles, les voisins, le wifi.
              </p>
            }
            @if (peutModifierFiche()) {
              <form class="row g-2 mt-1" (ngSubmit)="ajouterLigneFiche('guide')">
                <div class="col-12 col-md-3">
                  <input class="form-control" name="gcle" [(ngModel)]="fGuideCle" placeholder="Eau" aria-label="Intitulé">
                </div>
                <div class="col-12 col-md-7">
                  <input class="form-control" name="gval" [(ngModel)]="fGuideValeur" aria-label="Valeur"
                         placeholder="vanne générale sous l'escalier">
                </div>
                <div class="col-12 col-md-2">
                  <button class="btn btn-outline-secondary w-100" type="submit"
                          [disabled]="occupe() || !fGuideCle.trim()">Ajouter</button>
                </div>
              </form>
            }
          </div>
        </section>

        <section class="card">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-center gap-3 mb-2">
              <div class="eyebrow">
                <i class="bi bi-person-lines-fill me-2" aria-hidden="true"></i>Carnet d'adresses
              </div>
              <span class="badge rounded-pill text-bg-light border">{{ contacts().length }}</span>
            </div>
            <p class="text-body-secondary small">
              Artisans, voisins, mairie, urgences. Utile le jour où la chaudière lâche pendant le
              séjour de quelqu'un qui ne connaît pas le plombier.
            </p>
            @if (contacts().length) {
              <ul class="list-group list-group-flush">
                @for (c of contacts(); track c.id) {
                  <li class="list-group-item d-flex gap-3 align-items-center flex-wrap px-0">
                    <span class="badge rounded-pill text-bg-light border fw-normal">{{ libelleRoleContact(c.role) }}</span>
                    <span class="flex-grow-1" style="min-width:150px">
                      <span class="d-block small fw-medium">{{ c.nom }}</span>
                      @if (c.notes) {
                        <span class="d-block text-body-secondary" style="font-size:.72rem">{{ c.notes }}</span>
                      }
                    </span>
                    @if (c.telephone) {
                      <a class="btn btn-sm btn-outline-secondary" [href]="'tel:' + c.telephone">{{ c.telephone }}</a>
                    }
                    @if (c.email) {
                      <a class="btn btn-sm btn-outline-secondary" [href]="'mailto:' + c.email">Courriel</a>
                    }
                    @if (peutModifierContacts()) {
                      <button class="btn btn-sm btn-link text-body-secondary p-0" type="button"
                              (click)="retirerContact(c.id)">retirer</button>
                    }
                  </li>
                }
              </ul>
            } @else {
              <p class="text-body-secondary small mb-0">Aucun contact enregistré.</p>
            }
            @if (peutModifierContacts()) {
              <form class="row g-2 mt-1" (ngSubmit)="ajouterContact()">
                <div class="col-12 col-md-3">
                  <input class="form-control" name="cnom" [(ngModel)]="fContactNom" aria-label="Nom"
                         placeholder="Le Bihan, plombier">
                </div>
                <div class="col-12 col-md-2">
                  <select class="form-select" name="crole" [(ngModel)]="fContactRole" aria-label="Rôle">
                    @for (r of rolesContact(); track r.cle) { <option [value]="r.cle">{{ r.libelle }}</option> }
                  </select>
                </div>
                <div class="col-12 col-md-2">
                  <input class="form-control" name="ctel" [(ngModel)]="fContactTel" aria-label="Téléphone"
                         placeholder="02 98 00 00 00">
                </div>
                <div class="col-12 col-md-3">
                  <input class="form-control" name="cnotes" [(ngModel)]="fContactNotes" aria-label="Notes"
                         placeholder="Connaît la chaudière depuis 2009">
                </div>
                <div class="col-12 col-md-2">
                  <button class="btn btn-outline-secondary w-100" type="submit"
                          [disabled]="occupe() || !fContactNom.trim()">Ajouter</button>
                </div>
              </form>
            }
          </div>
        </section>

        @if (f.bien.notes) {
          <section class="card">
            <div class="card-body">
              <div class="eyebrow mb-2">Notes</div>
              <p class="text-body-secondary small mb-0" style="white-space:pre-wrap">{{ f.bien.notes }}</p>
            </div>
          </section>
        }
      }
    </div>
  `,
})
export class Fiche {
  readonly etat = inject(Etat);
  private readonly api = inject(Api);
  readonly fichiers = inject(Fichiers);

  readonly fiche = signal<FicheBien | null>(null);
  readonly edition = signal(false);
  readonly occupe = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');

  e = {
    nom: '', commune: '', codePostal: '', adresse: '', type: 'mer', couchages: 2,
    locationActivee: false, notes: '',
  };

  // La fiche **compose** : le guide vient du module maison, l'inventaire du
  // module entretien, le carnet d'adresses du module maison. L'écran ne calcule
  // rien et ne connaît l'intérieur d'aucun d'eux, comme le tableau de bord.
  readonly guide = signal<LigneFiche[]>([]);
  readonly peutModifierFiche = signal(false);
  readonly inventaire = signal<{ id: number; libelle: string; etat: string }[]>([]);
  readonly contacts = signal<Contact[]>([]);
  readonly rolesContact = signal<{ cle: string; libelle: string }[]>([]);
  readonly peutModifierContacts = signal(false);
  readonly casse = signal(false);

  fGuideCle = '';
  fGuideValeur = '';
  fCasseLibelle = '';
  fCasseDetail = '';
  fContactNom = '';
  fContactRole = 'artisan';
  fContactTel = '';
  fContactNotes = '';

  readonly libelleRoleContact = (r: string): string =>
    this.rolesContact().find((x) => x.cle === r)?.libelle ?? r;

  constructor() {
    effect(() => { const b = this.etat.bien(); if (b) void this.charger(b.id); });
  }

  private async charger(bienId: number): Promise<void> {
    const [f, fic, inv, con] = await Promise.all([
      this.api.get<FicheBien>(`/biens/${bienId}`).catch(() => null),
      this.api.get<{ guide: LigneFiche[]; peutModifier: boolean }>(`/biens/${bienId}/fiche`)
        .catch(() => null),
      this.api.get<{ id: number; libelle: string; etat: string }[]>(`/biens/${bienId}/inventaire`)
        .catch(() => []),
      // Le carnet d'adresses est réservé aux membres : un invité reçoit un 403,
      // et l'absence de carte est la bonne réponse, pas un message d'erreur.
      this.api.get<{ contacts: Contact[]; roles: { cle: string; libelle: string }[]; peutModifier: boolean }>(
        `/biens/${bienId}/contacts`).catch(() => null),
    ]);
    this.guide.set(fic?.guide ?? []);
    this.peutModifierFiche.set(fic?.peutModifier ?? false);
    this.inventaire.set(inv);
    this.contacts.set(con?.contacts ?? []);
    this.rolesContact.set(con?.roles ?? []);
    this.peutModifierContacts.set(con?.peutModifier ?? false);
    this.fiche.set(f);
    if (f) {
      this.e = {
        nom: f.bien.nom, commune: f.bien.commune, codePostal: f.bien.codePostal,
        adresse: f.bien.adresse, type: f.bien.type, couchages: f.bien.couchages,
        locationActivee: f.bien.locationActivee, notes: f.bien.notes,
      };
    }
  }

  typeLisible(t: string): string {
    return t === 'montagne' ? 'Montagne' : t === 'ville' ? 'Ville' : t === 'campagne' ? 'Campagne' : 'Bord de mer';
  }

  modeLisible(m: string): string {
    return m === 'sci' ? 'SCI' : m === 'nom_propre' ? 'Nom propre' : 'Indivision';
  }

  roleLisible(r: string): string {
    return r === 'gerant' ? 'Gérant' : r === 'detenteur' ? 'Détenteur' : r === 'membre_foyer' ? 'Membre de foyer' : 'Invité';
  }

  async enregistrer(): Promise<void> {
    const b = this.etat.bien();
    if (!b || this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try {
      await this.api.patch(`/biens/${b.id}`, { ...this.e, couchages: Number(this.e.couchages) });
      this.message.set('Fiche enregistrée.');
      this.edition.set(false);
      await this.charger(b.id);
      await this.etat.rafraichir();
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'enregistrement a échoué.");
    } finally {
      this.occupe.set(false);
    }
  }

  async televerser(evt: Event): Promise<void> {
    const b = this.etat.bien();
    const fichier = (evt.target as HTMLInputElement).files?.[0];
    if (!b || !fichier) return;
    this.erreur.set('');
    try {
      await this.api.televerser(`/biens/${b.id}/photo`, fichier);
      await this.charger(b.id);
      this.message.set('Photo enregistrée.');
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "Le téléversement a échoué.");
    }
  }

  private async agir(quoi: () => Promise<string>): Promise<void> {
    const b = this.etat.bien();
    if (!b || this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set('');
    this.message.set('');
    try {
      this.message.set(await quoi());
      await this.charger(b.id);
    } catch (e) {
      this.erreur.set(e instanceof ErreurAppel ? e.message : "L'opération a échoué.");
    } finally {
      this.occupe.set(false);
    }
  }

  ajouterLigneFiche(section: 'caracteristique' | 'guide'): Promise<void> {
    const b = this.etat.bien();
    if (!b || !this.fGuideCle.trim()) return Promise.resolve();
    return this.agir(async () => {
      await this.api.post(`/biens/${b.id}/fiche`, {
        section, cle: this.fGuideCle.trim(), valeur: this.fGuideValeur.trim(),
        ordre: this.guide().length + 1,
      });
      const cle = this.fGuideCle.trim();
      this.fGuideCle = '';
      this.fGuideValeur = '';
      return `« ${cle} » ajouté au guide d'arrivée.`;
    });
  }

  retirerLigneFiche(id: number): Promise<void> {
    const b = this.etat.bien();
    if (!b) return Promise.resolve();
    return this.agir(async () => {
      await this.api.post(`/biens/${b.id}/fiche/${id}/archivage`, {});
      return 'Ligne retirée du guide.';
    });
  }

  signalerCasse(): Promise<void> {
    const b = this.etat.bien();
    if (!b || !this.fCasseLibelle.trim()) return Promise.resolve();
    return this.agir(async () => {
      await this.api.post(`/biens/${b.id}/casse`, {
        libelle: this.fCasseLibelle.trim(), detail: this.fCasseDetail.trim(),
      });
      const quoi = this.fCasseLibelle.trim();
      this.fCasseLibelle = '';
      this.fCasseDetail = '';
      this.casse.set(false);
      return `Casse signalée : une tâche « Remplacer ${quoi} » attend dans le carnet d'entretien.`;
    });
  }

  ajouterContact(): Promise<void> {
    const b = this.etat.bien();
    if (!b || !this.fContactNom.trim()) return Promise.resolve();
    return this.agir(async () => {
      await this.api.post(`/biens/${b.id}/contacts`, {
        nom: this.fContactNom.trim(), role: this.fContactRole,
        telephone: this.fContactTel.trim(), email: '', notes: this.fContactNotes.trim(),
      });
      const nom = this.fContactNom.trim();
      this.fContactNom = '';
      this.fContactTel = '';
      this.fContactNotes = '';
      return `${nom} ajouté au carnet d'adresses.`;
    });
  }

  retirerContact(id: number): Promise<void> {
    const b = this.etat.bien();
    if (!b) return Promise.resolve();
    return this.agir(async () => {
      await this.api.post(`/biens/${b.id}/contacts/${id}/archivage`, {});
      return 'Contact retiré.';
    });
  }
}
