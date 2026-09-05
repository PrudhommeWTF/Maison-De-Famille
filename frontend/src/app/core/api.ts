// Le client de l'API.
//
// Écrit sur `fetch` plutôt que sur `HttpClient` : l'application n'a besoin ni
// d'intercepteurs, ni d'observables, ni de la mécanique de RxJS pour appeler une
// vingtaine de routes. Le code qui suit tient sur un écran et se lit d'un trait,
// ce qui compte davantage ici que l'orthodoxie.
//
// Deux responsabilités, et deux seulement :
//
//   1. **Porter le jeton** et le renouveler quand il expire, une seule fois, en
//      sérialisant les appels concurrents pour ne pas faire tourner cinq
//      renouvellements en parallèle et en invalider quatre.
//   2. **Rendre les erreurs lisibles** : le serveur envoie un code stable et un
//      message en français, et c'est ce message qui s'affiche. L'interface
//      n'invente jamais son propre texte d'erreur.
import { Injectable, signal } from '@angular/core';

export interface ErreurApi {
  code: string;
  message: string;
  champs?: Record<string, string>;
  statut: number;
}

export class ErreurAppel extends Error {
  constructor(readonly detail: ErreurApi) { super(detail.message); this.name = 'ErreurAppel'; }
  get code(): string { return this.detail.code; }
  get champs(): Record<string, string> { return this.detail.champs ?? {}; }
}

const CLE_ACCES = 'mdf.acces';
const CLE_RENOUVELLEMENT = 'mdf.renouvellement';

/** L'adresse de l'API, dérivée de la base du document : un seul build sert
 *  à la racine comme derrière un reverse-proxy sur un sous-chemin. */
const BASE = (): string => {
  const base = document.baseURI.replace(/\/+$/, '');
  return `${base}/api`;
};

@Injectable({ providedIn: 'root' })
export class Api {
  /** Passe à vrai dès qu'un jeton existe. Les écrans s'y branchent. */
  readonly connecte = signal(!!localStorage.getItem(CLE_RENOUVELLEMENT));

  private acces = localStorage.getItem(CLE_ACCES) ?? '';
  private renouvellementEnCours: Promise<boolean> | null = null;

  poserSession(acces: string, renouvellement: string): void {
    this.acces = acces;
    localStorage.setItem(CLE_ACCES, acces);
    localStorage.setItem(CLE_RENOUVELLEMENT, renouvellement);
    this.connecte.set(true);
  }

  /** Un jeton d'accès neuf sans changer de session (activation du second facteur). */
  rafraichirAcces(acces: string): void {
    this.acces = acces;
    localStorage.setItem(CLE_ACCES, acces);
  }

  oublierSession(): void {
    this.acces = '';
    localStorage.removeItem(CLE_ACCES);
    localStorage.removeItem(CLE_RENOUVELLEMENT);
    this.connecte.set(false);
  }

  async deconnexion(): Promise<void> {
    const renouvellement = localStorage.getItem(CLE_RENOUVELLEMENT);
    // La déconnexion révoque le jeton côté serveur. Si l'appel échoue (réseau
    // coupé), on oublie quand même la session ici : rester connecté malgré un
    // clic sur « se déconnecter » serait pire.
    if (renouvellement) {
      try { await this.brut('POST', '/auth/deconnexion', { renouvellement }); } catch { /* sans importance */ }
    }
    this.oublierSession();
  }

  get<T>(chemin: string): Promise<T> { return this.appel<T>('GET', chemin); }
  post<T>(chemin: string, corps?: unknown): Promise<T> { return this.appel<T>('POST', chemin, corps ?? {}); }
  patch<T>(chemin: string, corps?: unknown): Promise<T> { return this.appel<T>('PATCH', chemin, corps ?? {}); }

  /** Un téléversement : le corps est le fichier lui-même. */
  televerser<T>(chemin: string, fichier: File): Promise<T> {
    return this.appel<T>('POST', chemin, fichier, { 'x-nom-fichier': nomSur(fichier.name) });
  }

  /** Un téléchargement : rend le contenu et le nom proposé par le serveur. */
  async telecharger(chemin: string): Promise<{ blob: Blob; nom: string }> {
    const r = await fetch(BASE() + chemin, { headers: this.entetes() });
    if (r.status === 401 && await this.renouveler()) return this.telecharger(chemin);
    if (!r.ok) throw await this.erreur(r);
    return { blob: await r.blob(), nom: nomDeReponse(r) };
  }

  private entetes(supplementaires: Record<string, string> = {}): Record<string, string> {
    return { ...(this.acces ? { authorization: `Bearer ${this.acces}` } : {}), ...supplementaires };
  }

  private async brut(methode: string, chemin: string, corps?: unknown): Promise<Response> {
    return fetch(BASE() + chemin, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
  }

  private async appel<T>(
    methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}, reessai = true,
  ): Promise<T> {
    const estFichier = corps instanceof File || corps instanceof Blob;
    let reponse: Response;
    try {
      reponse = await fetch(BASE() + chemin, {
        method: methode,
        headers: this.entetes({
          ...(corps !== undefined && !estFichier ? { 'content-type': 'application/json' } : {}),
          ...entetes,
        }),
        body: corps === undefined ? undefined : estFichier ? (corps as Blob) : JSON.stringify(corps),
      });
    } catch {
      // Une coupure réseau ne produit pas de code HTTP : sans ce cas, l'écran
      // afficherait « undefined » là où il faut dire ce qui se passe.
      throw new ErreurAppel({
        code: 'RESEAU', statut: 0,
        message: 'Le serveur ne répond pas. Vérifiez votre connexion, puis réessayez.',
      });
    }

    if (reponse.status === 401 && reessai && await this.renouveler()) {
      return this.appel<T>(methode, chemin, corps, entetes, false);
    }
    if (!reponse.ok) throw await this.erreur(reponse);
    if (reponse.status === 204) return undefined as T;
    return await reponse.json() as T;
  }

  /**
   * Échange le jeton de renouvellement. Les appels concurrents partagent la
   * même promesse : sans cela, cinq requêtes qui expirent ensemble
   * déclencheraient cinq rotations, et quatre jetons seraient invalidés.
   */
  private renouveler(): Promise<boolean> {
    if (this.renouvellementEnCours) return this.renouvellementEnCours;
    const renouvellement = localStorage.getItem(CLE_RENOUVELLEMENT);
    if (!renouvellement) { this.oublierSession(); return Promise.resolve(false); }

    this.renouvellementEnCours = (async () => {
      try {
        const r = await this.brut('POST', '/auth/renouveler', { renouvellement });
        if (!r.ok) { this.oublierSession(); return false; }
        const j = await r.json() as { acces: string; renouvellement: string };
        this.poserSession(j.acces, j.renouvellement);
        return true;
      } catch {
        return false;
      } finally {
        this.renouvellementEnCours = null;
      }
    })();
    return this.renouvellementEnCours;
  }

  private async erreur(r: Response): Promise<ErreurAppel> {
    let detail: Partial<ErreurApi> = {};
    try { detail = await r.json() as Partial<ErreurApi>; } catch { /* corps vide ou non JSON */ }
    return new ErreurAppel({
      code: detail.code ?? 'PANNE_INTERNE',
      statut: r.status,
      message: detail.message ?? "Une erreur s'est produite.",
      champs: detail.champs,
    });
  }
}

/** Un nom de fichier transportable dans un en-tête : ASCII imprimable seulement. */
function nomSur(nom: string): string {
  return nom.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '').slice(0, 180) || 'fichier';
}

/** Le nom proposé par le serveur, en préférant la forme UTF-8 de la RFC 6266. */
function nomDeReponse(r: Response): string {
  const brut = r.headers.get('content-disposition') ?? '';
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(brut);
  if (utf8) { try { return decodeURIComponent(utf8[1]); } catch { /* mal encodé */ } }
  const simple = /filename="([^"]+)"/i.exec(brut);
  return simple ? simple[1] : 'export';
}
