// Les deux captures de l'écran de mise à jour.
//
// Montrer une version disponible suppose qu'il en existe une plus récente que
// celle qui tourne, ce qui n'arrive pas sur une instance neuve. Seule la
// **réponse de la vérification** est simulée, au niveau du navigateur : le
// composant, la route du serveur, la vérification du mot de passe et le dépôt
// du fichier déclencheur restent réels.
// Playwright n'est pas une dépendance du projet : il n'est utile que pour
// réengendrer ces images. On accepte donc une installation globale.
const { chromium } = require(process.env.MDF_PLAYWRIGHT || 'playwright');
const CHROMIUM = process.env.MDF_CHROMIUM || undefined;
const RACINE = 'http://127.0.0.1:8099';
const MDP = 'un-mot-de-passe-qui-tient';
const SORTIE = process.argv[2] || require('path').join(__dirname, '..', '..', 'docs', 'guides', 'images');

const MAJ = {
  installee: '0.0.0', derniere: '0.1.0', tag: 'v0.1.0',
  nom: 'Carnet d\'entretien et coffre-fort',
  notes: '- Le carnet d\'entretien engendre ses tâches récurrentes\n'
    + '- Les codes du coffre-fort sont chiffrés au repos\n'
    + '- Correction : le calendrier ne servait plus de page blanche après une mise à jour',
  url: 'https://github.com/PrudhommeWTF/Maison-De-Famille/releases/tag/v0.1.0',
  publieeLe: '2026-09-01T10:00:00Z',
  misAJourDisponible: true, installationPossible: true,
};

(async () => {
  const nav = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const page = await (await nav.newContext({ viewport: { width: 1280, height: 860 } })).newPage();

  await page.goto(`${RACINE}/connexion`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', 'helene@exemple.fr');
  await page.fill('input[type=password]', MDP);
  await page.click('button[type=submit]');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1400);

  // Le réglage se pose par l'interface, comme un gérant le ferait.
  await page.goto(`${RACINE}/reglages`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.locator('#r-majVerification').check();
  await page.waitForTimeout(900);

  // La seule simulation : ce que la vérification rend.
  await page.route('**/api/systeme/maj/verification', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MAJ) }));

  await page.goto(`${RACINE}/etat`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /Vérifier les mises à jour/ }).click();
  await page.waitForTimeout(1200);
  // Aucun défilement avant la photo : une capture pleine page pose les barres
  // collantes là où le défilement les a laissées, et `window.scrollTo` ne
  // suffit pas à les remettre en haut.
  await page.screenshot({ path: `${SORTIE}/gerant-maj-disponible.png`, fullPage: true });

  // L'installation elle-même est réelle : le mot de passe est vérifié par le
  // serveur, qui dépose son fichier déclencheur et passe en « en cours ».
  await page.locator('#maj-mdp').scrollIntoViewIfNeeded();
  await page.fill('#maj-mdp', MDP);
  await page.getByRole('button', { name: 'Installer maintenant' }).click();
  await page.waitForTimeout(1500);
  // Le rechargement remet la page en haut, et l'état « en cours » vient du
  // serveur : il survit au rechargement, contrairement au défilement.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SORTIE}/gerant-maj-en-cours.png`, fullPage: true });

  await nav.close();
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
