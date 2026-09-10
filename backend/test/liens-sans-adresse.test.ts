// Ce que rendent les liens quand l'adresse publique n'est pas déclarée.
//
// **Pourquoi ce test existe.** Sur l'instance de la famille, `MDF_PUBLIC_URL`
// était vide : le lien d'invitation sortait en chemin nu, et l'ouverture d'un
// accès temporaire était refusée tout court. Le serveur ne peut pas deviner le
// domaine (il n'a que l'en-tête « Host », que n'importe quel appelant écrit
// comme il veut), mais il ne doit pas non plus bloquer : c'est le navigateur de
// la gérante qui complète le lien, et lui sait sur quelle adresse elle est.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Instance, amorcer, creerCompte, demarrer } from './aide';

const jourDecale = (n: number): string =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Une instance dont l'adresse publique n'est pas renseignée. */
const sansAdresse = (): Promise<Instance> => demarrer({ publicUrl: null });

test("le lien d'invitation sort en chemin, jamais vide", async () => {
  const i = await sansAdresse();
  try {
    await amorcer(i);
    const id = await creerCompte(i, 'Claire Prudhomme', 'claire@exemple.fr');
    const r = await i.post<{ lien: string | null }>(`/api/personnes/${id}/invitation`, { afficherLien: true });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    assert.ok(r.corps.lien, 'un lien doit être rendu');
    assert.match(r.corps.lien, /^\/reinitialiser\?jeton=/,
      'un chemin absolu que le navigateur complète, pas une adresse inventée');
  } finally { await i.fermer(); }
});

test("ouvrir un accès temporaire n'est plus refusé faute d'adresse publique", async () => {
  const i = await sansAdresse();
  try {
    const base = await amorcer(i);
    const r = await i.post<{ lien: string }>(`/api/biens/${base.bienId}/acces`, {
      libelle: 'Famille Berger, locataires', email: '', expireLe: jourDecale(10),
    });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    assert.match(r.corps.lien, /^\/sejour\?jeton=/);
  } finally { await i.fermer(); }
});

test("l'adresse publique, quand elle est déclarée, fait foi", async () => {
  const i = await demarrer({ publicUrl: 'https://maison.exemple.fr' });
  try {
    const base = await amorcer(i);
    const r = await i.post<{ lien: string }>(`/api/biens/${base.bienId}/acces`, {
      libelle: 'Famille Berger', email: '', expireLe: jourDecale(10),
    });
    assert.match(r.corps.lien, /^https:\/\/maison\.exemple\.fr\/sejour\?jeton=/);
  } finally { await i.fermer(); }
});
