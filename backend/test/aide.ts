// L'échafaudage des tests de bout en bout.
//
// Chaque test démarre une instance complète : base migrée dans un répertoire
// temporaire, serveur Express sur un port libre, et un client qui parle
// exactement comme le fera l'application Angular. Rien n'est simulé côté
// serveur : ce qui passe ici passera en production.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { ouvrir } from '../src/noyau/db';
import { construireApp } from '../src/server';
import { Config } from '../src/noyau/config';
import { Deps } from '../src/noyau/http';
import { initialiser } from '../src/stockage/fichiers';

export interface Reponse<T = unknown> { statut: number; corps: T }

export class Instance {
  private acces = '';
  renouvellement = '';

  constructor(
    readonly deps: Deps,
    private readonly serveur: Server,
    readonly url: string,
    private readonly dossier: string,
  ) {}

  get db(): Deps['db'] { return this.deps.db; }

  async appel<T = unknown>(
    methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {},
  ): Promise<Reponse<T>> {
    const r = await fetch(this.url + chemin, {
      method: methode,
      headers: {
        ...(corps !== undefined && !Buffer.isBuffer(corps) ? { 'content-type': 'application/json' } : {}),
        ...(this.acces ? { authorization: `Bearer ${this.acces}` } : {}),
        ...entetes,
      },
      body: corps === undefined ? undefined : Buffer.isBuffer(corps) ? corps : JSON.stringify(corps),
    });
    const texte = await r.text();
    let parse: unknown = texte;
    try { parse = texte ? JSON.parse(texte) : null; } catch { /* CSV, archive : texte brut */ }
    return { statut: r.status, corps: parse as T };
  }

  get<T = unknown>(chemin: string): Promise<Reponse<T>> { return this.appel<T>('GET', chemin); }
  post<T = unknown>(chemin: string, corps?: unknown): Promise<Reponse<T>> { return this.appel<T>('POST', chemin, corps ?? {}); }
  patch<T = unknown>(chemin: string, corps?: unknown): Promise<Reponse<T>> { return this.appel<T>('PATCH', chemin, corps ?? {}); }

  /** Ouvre une session et retient le jeton pour les appels suivants. */
  async connexion(email: string, motDePasse: string): Promise<Reponse<{ acces: string; renouvellement: string }>> {
    const r = await this.post<{ acces: string; renouvellement: string }>('/api/auth/connexion', { email, motDePasse });
    if (r.statut === 200) { this.acces = r.corps.acces; this.renouvellement = r.corps.renouvellement; }
    return r;
  }

  deconnecte(): void { this.acces = ''; }

  /** Prend un jeton d'accès obtenu autrement que par la connexion, un lien
   *  temporaire par exemple. */
  utiliserJeton(acces: string): void { this.acces = acces; }
  /** L'en-tête d'autorisation courant, pour un appel direct (téléchargement binaire). */
  get entetesAuth(): Record<string, string> { return this.acces ? { authorization: `Bearer ${this.acces}` } : {}; }
  /** Se faire passer pour quelqu'un d'autre, sans repasser par la connexion. */
  poserJeton(jeton: string): void { this.acces = jeton; }

  async fermer(): Promise<void> {
    await new Promise<void>((res) => this.serveur.close(() => res()));
    this.deps.db.close();
    fs.rmSync(this.dossier, { recursive: true, force: true });
  }
}

export async function demarrer(surcharges: Partial<Config> = {}): Promise<Instance> {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'mdf-test-'));
  const config: Config = {
    production: false, port: 0, host: '127.0.0.1', dataDir: dossier,
    dbPath: path.join(dossier, 'maison.db'), staticDir: null, baseHref: '/',
    jwtSecret: 'secret-de-test-suffisamment-long-pour-passer',
    // Coffre verrouillé par défaut : les tests qui manipulent des codes
    // fournissent leur clé, et les autres vérifient au passage que l'absence de
    // clé n'empêche rien d'autre de fonctionner.
    cleCoffre: null,
    publicUrl: 'https://maison.test', smtp: null, version: '0.0.0-test',
    // Aucun assistant root en test : c'est l'état d'une installation ordinaire,
    // et les tests qui veulent le bouton de mise à jour le disent.
    majAuto: false,
    ...surcharges,
  };
  const db = ouvrir(config.dbPath, config.dataDir);
  initialiser(config.dataDir);
  const deps: Deps = { db, config };
  const app = construireApp(deps);
  const serveur = await new Promise<Server>((res) => {
    const s = app.listen(0, () => res(s));
  });
  const port = (serveur.address() as AddressInfo).port;
  return new Instance(deps, serveur, `http://127.0.0.1:${port}`, dossier);
}

export const MOT_DE_PASSE = 'un-mot-de-passe-qui-tient';

/** L'amorçage type : Hélène, gérante de l'indivision de Kerloc'h. */
export async function amorcer(i: Instance): Promise<{ personneId: number; structureId: number; bienId: number }> {
  const r = await i.post<{ personneId: number; structureId: number; bienId: number }>('/api/amorce', {
    nom: 'Hélène Prudhomme', email: 'helene@exemple.fr', motDePasse: MOT_DE_PASSE,
    foyerNom: 'Hélène', structureMode: 'indivision', structureNom: "Indivision Kerloc'h",
    bienNom: "Maison de Kerloc'h", commune: 'Crozon', type: 'mer', couchages: 8,
  });
  if (r.statut !== 200) throw new Error(`Amorçage impossible : ${JSON.stringify(r.corps)}`);
  await i.connexion('helene@exemple.fr', MOT_DE_PASSE);
  return r.corps;
}

/** Crée une personne avec un mot de passe utilisable, sans passer par le courriel. */
export async function creerCompte(
  i: Instance, nom: string, email: string, foyerId: number | null = null,
): Promise<number> {
  const r = await i.post<{ id: number }>('/api/personnes', { nom, email, foyerId });
  if (r.statut !== 200) throw new Error(`Création impossible : ${JSON.stringify(r.corps)}`);
  const { hacher } = await import('../src/auth/mots-de-passe');
  i.db.prepare('UPDATE personne SET mot_de_passe_hash = ? WHERE id = ?').run(await hacher(MOT_DE_PASSE), r.corps.id);
  return r.corps.id;
}
