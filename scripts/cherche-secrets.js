#!/usr/bin/env node
// Recherche de secrets avant qu'ils n'entrent dans l'historique Git.
//
// Un secret arrivé dans l'historique est compromis même retiré au commit
// suivant : le seul moment où l'attraper est avant qu'il n'y entre. Ce contrôle
// est donc bloquant en CI, et volontairement grossier : mieux vaut un faux
// positif à écarter à la main qu'un secret publié.
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const IGNORES = new Set(['node_modules', '.git', 'dist', 'data', '.angular', 'coverage']);

/** Ce qu'on cherche. Chaque motif dit ce qu'il attrape, pour trier vite. */
const MOTIFS = [
  { nom: 'clé privée', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { nom: 'jeton GitHub', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { nom: 'clé AWS', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { nom: 'jeton Slack', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { nom: 'mot de passe SMTP en dur', re: /MDF_SMTP_PASS\s*=\s*["'][^"'\s]{4,}/ },
  { nom: 'secret JWT en dur', re: /MDF_JWT_SECRET\s*=\s*["'][^"'\s]{8,}/ },
];

/** Les fichiers où un exemple est attendu : ils sont lus, mais tolérants. */
const EXEMPLES = /(\.example|\.sample|README|deploy\/|docs\/)/;

const problemes = [];

function parcourir(dossier) {
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    if (IGNORES.has(e.name)) continue;
    const complet = path.join(dossier, e.name);
    if (e.isDirectory()) { parcourir(complet); continue; }
    if (!/\.(ts|js|json|ya?ml|sh|md|env|conf|html|css)$/.test(e.name) && e.name !== '.env') continue;
    const relatif = path.relative(RACINE, complet);

    let texte;
    try { texte = fs.readFileSync(complet, 'utf8'); } catch { continue; }
    if (texte.length > 2_000_000) continue;

    texte.split('\n').forEach((ligne, i) => {
      for (const m of MOTIFS) {
        if (!m.re.test(ligne)) continue;
        // Un exemple explicitement marqué reste admis : « changez-moi » n'est
        // pas un secret, et refuser la documentation la ferait disparaître.
        if (EXEMPLES.test(relatif) && /changez|exemple|example|votre|à remplacer|xxx|\.\.\./i.test(ligne)) continue;
        problemes.push(`${relatif}:${i + 1} : ${m.nom}`);
      }
    });
  }
}

parcourir(RACINE);

if (problemes.length) {
  console.error('Des secrets semblent présents dans le dépôt :');
  for (const p of problemes) console.error('  ' + p);
  console.error('');
  console.error("Retirez-les AVANT de committer. Un secret entré dans l'historique est compromis,");
  console.error('même supprimé ensuite : il faut alors le révoquer, pas seulement l\'effacer.');
  process.exit(1);
}
console.log('Aucun secret détecté.');
