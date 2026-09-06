// Les captures d'écran des guides, prises sur l'instance de démonstration.
// Chaque image vient de l'application réelle : rien n'est retouché ni maquetté.
// Playwright n'est pas une dépendance du projet : il n'est utile que pour
// réengendrer ces images. On accepte donc une installation globale.
const { chromium } = require(process.env.MDF_PLAYWRIGHT || 'playwright');
const CHROMIUM = process.env.MDF_CHROMIUM || undefined;
const fs = require('fs');
const path = require('path');

const RACINE = 'http://127.0.0.1:8099';
const MDP = 'un-mot-de-passe-qui-tient';
const SORTIE = process.argv[2] || path.join(__dirname, '..', '..', 'docs', 'guides', 'images');
const LIEN_PROCHE = process.argv[3] || '';
const LIEN_LOINTAIN = process.argv[4] || '';
const FICHIER_VACANCES = process.argv[5] || '';

fs.mkdirSync(SORTIE, { recursive: true });

let page;
const faites = [];
const soucis = [];

async function attendre(ms = 900) { await page.waitForTimeout(ms); }

async function aller(chemin) {
  await page.goto(RACINE + chemin, { waitUntil: 'networkidle' });
  await attendre(1100);
}

async function capture(nom, options = {}) {
  const cible = path.join(SORTIE, `${nom}.png`);
  if (options.scrollTo) {
    const l = page.locator(options.scrollTo).first();
    if (await l.count()) { await l.scrollIntoViewIfNeeded(); await attendre(400); }
  }
  await page.screenshot({ path: cible, fullPage: !!options.full });
  const ko = Math.round(fs.statSync(cible).size / 1024);
  faites.push(`${nom} (${ko} ko)`);
}

async function connexion(email) {
  await page.goto(`${RACINE}/connexion`, { waitUntil: 'networkidle' });
  await attendre(700);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', MDP);
  await page.click('button[type=submit]');
  await page.waitForLoadState('networkidle');
  await attendre(1400);
}

async function deconnexion() {
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.context().clearCookies();
}

/**
 * Ouvre un bien depuis la barre de contexte du haut.
 *
 * Sans cela, toutes les adresses `/bien/...` renvoient au tableau de bord : la
 * garde de route exige qu'un bien soit ouvert, et les captures montraient
 * douze fois le même écran.
 */
async function ouvrirBien(nom) {
  const chip = page.locator(`button:has-text("${nom}"), a:has-text("${nom}")`).first();
  if (!(await chip.count())) { soucis.push(`bien introuvable dans la barre : ${nom}`); return false; }
  await chip.click();
  await attendre(1500);
  const ok = await page.locator('a:has-text("Calendrier d\'occupation")').count();
  if (!ok) soucis.push(`le bien « ${nom} » ne s'est pas ouvert`);
  return !!ok;
}

async function cliquer(selecteur, quoi) {
  const l = page.locator(selecteur).first();
  if (!(await l.count())) { soucis.push(`introuvable : ${quoi || selecteur}`); return false; }
  await l.click();
  await attendre(900);
  return true;
}

(async () => {
  const nav = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  page = await ctx.newPage();
  page.on('pageerror', (e) => soucis.push(`erreur JS : ${String(e).slice(0, 160)}`));

  // ---------------------------------------------------------------- Commun
  await page.goto(`${RACINE}/connexion`, { waitUntil: 'networkidle' });
  await attendre(900);
  await capture('commun-connexion');

  await cliquer('a:has-text("oublié"), button:has-text("oublié")', 'lien mot de passe oublié');
  await capture('commun-mot-de-passe-oublie');

  // ---------------------------------------------------------------- Gérante
  await connexion('helene@exemple.fr');
  await capture('gerant-tableau-de-bord');
  await capture('gerant-tableau-de-bord-complet', { full: true });

  await aller('/biens');
  await capture('gerant-biens');

  await aller('/reglages');
  await capture('gerant-reglages', { full: true });
  await capture('gerant-reglages-vacances', { scrollTo: 'h2:has-text("Vacances scolaires")' });
  if (FICHIER_VACANCES) {
    await page.setInputFiles('input[type=file][accept*=csv]', FICHIER_VACANCES);
    await page.waitForSelector('.apercu', { timeout: 15000 }).catch(() => soucis.push('aperçu des vacances absent'));
    await attendre(700);
    await capture('gerant-vacances-apercu', { scrollTo: '.apercu' });
    if (await cliquer('button:has-text("Enregistrer ces")', 'bouton enregistrer les vacances')) {
      await attendre(900);
      await capture('gerant-vacances-enregistre', { scrollTo: 'h2:has-text("Vacances scolaires")' });
    }
  }

  await aller('/import');
  await capture('gerant-import-planning');

  await aller('/etat');
  await capture('gerant-etat', { full: true });

  await aller('/');
  await ouvrirBien("Maison de Kerloc'h");
  await capture('gerant-bien-ouvert');

  // Cet écran a besoin d'un bien ouvert : sans cela il n'affiche ni les rôles
  // ni la section des accès temporaires, et les captures mentent.
  await aller('/personnes');
  await capture('gerant-personnes', { full: true });
  await capture('gerant-acces-temporaires', { scrollTo: 'h2:has-text("Accès"), h3:has-text("Accès")' });

  await aller('/bien/calendrier');
  await capture('gerant-calendrier');

  await aller('/bien/demandes');
  await capture('gerant-demandes', { full: true });

  await aller('/bien/membres');
  await capture('gerant-membres', { full: true });

  await aller('/bien/depenses');
  await capture('gerant-depenses', { full: true });
  if (await cliquer('button:has-text("Saisir une dépense"), button:has-text("Nouvelle dépense"), button:has-text("Ajouter")', 'bouton nouvelle dépense')) {
    await capture('gerant-depense-formulaire', { full: true });
  }

  await aller('/bien/soldes');
  await capture('gerant-soldes', { full: true });

  await aller('/bien/entretien');
  await capture('gerant-entretien', { full: true });

  await aller('/bien/coffre');
  await capture('gerant-coffre', { full: true });

  await aller('/bien/fiche');
  await capture('gerant-fiche', { full: true });

  await aller('/bien/decisions');
  await capture('gerant-decisions', { full: true });

  await aller('/bien/location');
  await capture('gerant-location', { full: true });

  await aller('/bien/souvenirs');
  await capture('gerant-souvenirs');

  await aller('/compte');
  await capture('commun-mon-compte', { full: true });

  // ---------------------------------------------------------------- Détentrice
  await deconnexion();
  await connexion('claire@exemple.fr');
  await capture('detenteur-tableau-de-bord', { full: true });

  await ouvrirBien("Maison de Kerloc'h");
  await aller('/bien/calendrier');
  await capture('detenteur-calendrier');
  if (await cliquer('button:has-text("Demander un séjour")', 'bouton demander un séjour')) {
    await capture('detenteur-demande-sejour', { full: true });
  }

  await aller('/bien/soldes');
  await capture('detenteur-soldes', { full: true });

  await aller('/bien/depenses');
  await capture('detenteur-depenses', { full: true });

  await aller('/bien/decisions');
  await capture('detenteur-decisions', { full: true });

  await aller('/bien/coffre');
  await capture('detenteur-coffre', { full: true });

  // ---------------------------------------------------------------- Membre de foyer
  await deconnexion();
  await connexion('paul@exemple.fr');
  await capture('foyer-tableau-de-bord', { full: true });
  await ouvrirBien("Maison de Kerloc'h");
  await capture('foyer-navigation');
  await aller('/bien/calendrier');
  await capture('foyer-calendrier');
  await aller('/bien/entretien');
  await capture('foyer-entretien', { full: true });
  await aller('/bien/coffre');
  await capture('foyer-coffre', { full: true });

  // ---------------------------------------------------------------- Invité par lien
  if (LIEN_PROCHE) {
    await deconnexion();
    await page.goto(LIEN_PROCHE, { waitUntil: 'networkidle' });
    await attendre(1800);
    await capture('invite-accueil', { full: true });
    await aller('/bien/coffre');
    await capture('invite-coffre', { full: true });
    if (await cliquer('button:has-text("Afficher"), button:has-text("Voir le code")', 'bouton afficher un code')) {
      await capture('invite-code-affiche', { full: true });
    }
    await aller('/bien/fiche');
    await capture('invite-fiche', { full: true });
    await aller('/bien/calendrier');
    await capture('invite-calendrier');
    await aller('/bien/demandes');
    await capture('invite-demandes', { full: true });
  }
  if (LIEN_LOINTAIN) {
    await deconnexion();
    await page.goto(LIEN_LOINTAIN, { waitUntil: 'networkidle' });
    await attendre(1800);
    await aller('/bien/coffre');
    await capture('invite-coffre-trop-tot', { full: true });
  }

  console.log(`CAPTURES (${faites.length}) :\n  ` + faites.join('\n  '));
  if (soucis.length) console.log(`\nSOUCIS :\n  ` + soucis.join('\n  '));
  await nav.close();
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
