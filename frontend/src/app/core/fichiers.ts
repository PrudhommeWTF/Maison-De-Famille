// L'accès aux fichiers, côté écran.
//
// **Pourquoi ce service existe.** La route `/api/fichiers/:id` exige un jeton,
// comme toutes les autres : c'est le seul chemin vers les octets, et le
// répertoire de données n'est pas exposé par le serveur web. Or un
// `<img src="/api/fichiers/...">` n'envoie aucun en-tête d'autorisation : le
// navigateur demande l'image tout seul, reçoit 401, et affiche une icône
// cassée. C'est exactement ce qui se passait sur la photo de couverture d'un
// bien et sur les pièces jointes du coffre.
//
// Trois solutions étaient possibles. Passer le jeton en paramètre d'adresse le
// dépose dans l'historique du navigateur et dans les journaux du serveur.
// Poser un cookie de session rouvre la question du CSRF pour un seul usage.
// Reste la troisième, retenue ici : **aller chercher les octets avec le jeton**,
// comme n'importe quel appel, et en faire une adresse locale `blob:`. Aucune
// nouvelle voie d'authentification, rien de nouveau à protéger.
//
// Le coût est la mémoire : une adresse `blob:` retient ses octets tant qu'on ne
// la libère pas. Le cache est donc borné, et les plus anciennes entrées sont
// libérées quand il déborde.
import { Injectable, Signal, inject, signal } from '@angular/core';
import { Api } from './api';

/** Au-delà, on libère les plus anciennes. Un album tient largement dessous. */
const MAX_EN_CACHE = 240;

@Injectable({ providedIn: 'root' })
export class Fichiers {
  private readonly api = inject(Api);
  private readonly cache = new Map<string, ReturnType<typeof signal<string>>>();

  /**
   * L'adresse locale des octets d'un fichier.
   *
   * Rend un signal vide puis renseigné : le gabarit s'affiche tout de suite avec
   * son cadre, et l'image apparaît quand elle arrive. Appelable dans un gabarit
   * sans crainte, la même clé rend toujours le même signal.
   */
  image(id: string | null): Signal<string> {
    if (!id) return signal('').asReadonly();
    const connu = this.cache.get(id);
    if (connu) return connu.asReadonly();

    const s = signal('');
    this.cache.set(id, s);
    this.limiter();
    void this.api.telecharger(`/fichiers/${id}`)
      .then((r) => s.set(URL.createObjectURL(r.blob)))
      // Une image refusée ou disparue laisse le cadre vide : l'écran ne doit
      // pas tomber parce qu'une photo manque.
      .catch(() => s.set(''));
    return s.asReadonly();
  }

  /** Télécharger un fichier sous son vrai nom, sans quitter l'application. */
  async ouvrir(id: string, nomPropose = ''): Promise<void> {
    const r = await this.api.telecharger(`/fichiers/${id}`);
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomPropose || r.nom;
    a.click();
    // Libérée au tour suivant : le clic doit avoir eu le temps de partir.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  private limiter(): void {
    while (this.cache.size > MAX_EN_CACHE) {
      const [cle, s] = this.cache.entries().next().value as [string, { (): string }];
      const v = s();
      if (v) URL.revokeObjectURL(v);
      this.cache.delete(cle);
    }
  }
}
