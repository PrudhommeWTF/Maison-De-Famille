// Les en-têtes de sécurité, et le piège qu'ils ont tendu.
//
// Ce fichier existe à cause d'un défaut réel, trouvé à la première mise en
// service sur une vraie machine : l'application affichait une **page blanche**
// sur son adresse réseau, et fonctionnait parfaitement sur « localhost ».
//
// La cause : helmet **fusionne ses directives par défaut** avec celles qu'on
// lui donne, et ses défauts contiennent `upgrade-insecure-requests`. Le
// navigateur réécrivait donc chaque ressource en https, sur un serveur qui ne
// parle qu'en clair. Aucun script ne chargeait.
//
// Ce qui l'a rendu invisible pendant cinq tranches : les navigateurs exemptent
// « localhost » de cette réécriture, et toutes les recettes tapaient
// 127.0.0.1. Un test qui lit l'en-tête ne se laisse pas berner par ça.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer } from './aide';

/** La politique de sécurité de contenu, découpée en directives. */
async function csp(): Promise<Map<string, string>> {
  const i = await demarrer();
  try {
    const r = await fetch(`${i.url}/api/sante`);
    const brut = r.headers.get('content-security-policy') ?? '';
    assert.ok(brut, 'aucune politique de sécurité de contenu n\'est émise');
    return new Map(brut.split(';').map((d) => {
      const [cle, ...reste] = d.trim().split(/\s+/);
      return [cle, reste.join(' ')];
    }));
  } finally { await i.fermer(); }
}

test('la politique ne réécrit pas les ressources en https', async () => {
  const d = await csp();
  assert.ok(!d.has('upgrade-insecure-requests'),
    'upgrade-insecure-requests rend l\'application inutilisable sur une instance '
    + 'servie en clair : le navigateur demande des ressources en https à un serveur '
    + 'qui n\'en sert pas, et la page reste blanche. C\'est au reverse-proxy de '
    + 'rediriger vers https, pas à cette directive.');
});

test('la politique reste fermée sur tout le reste', async () => {
  const d = await csp();
  const attendu: Record<string, string> = {
    'default-src': "'self'",
    'script-src': "'self'",
    'connect-src': "'self'",
    'font-src': "'self'",
    'object-src': "'none'",
    'frame-ancestors': "'none'",
    'base-uri': "'self'",
    'form-action': "'self'",
    // Vient des défauts de helmet, et on le garde : c'est lui qui interdit les
    // gestionnaires en ligne, dont l'absence est une hypothèse du projet.
    'script-src-attr': "'none'",
  };
  for (const [cle, valeur] of Object.entries(attendu)) {
    assert.equal(d.get(cle), valeur, `la directive ${cle} a changé`);
  }
  // Aucune source extérieure nulle part : l'application ne charge rien du
  // dehors, et le brief l'exige.
  for (const [cle, valeur] of d) {
    assert.ok(!/https?:\/\//.test(valeur),
      `la directive ${cle} autorise une origine extérieure : ${valeur}`);
  }
});
