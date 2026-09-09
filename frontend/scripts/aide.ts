// Compile les guides Markdown en HTML, une fois, à la compilation.
//
// **Pourquoi à la compilation et non dans le navigateur.** Rendre du Markdown
// côté client obligerait à embarquer une bibliothèque de rendu dans
// l'application, à la charger chez chaque personne, et à injecter du HTML
// fabriqué à l'exécution. Ici, `marked` est une dépendance de développement :
// elle ne part jamais dans le navigateur, qui ne reçoit que du HTML déjà prêt.
//
// **Les guides ne sont pas recopiés.** La source reste `docs/guides/`, lue
// aussi bien sur GitHub que dans l'application. Une seconde copie aurait
// divergé, et c'est toujours celle que personne ne relit qui reste affichée.
//
// Lancé par `npm run build` et `npm start` (voir `prebuild` et `prestart`) :
// il n'y a rien à penser à faire, et une capture ajoutée à un guide se retrouve
// dans l'application à la compilation suivante.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { marked } from 'marked';
import { GUIDES, preparer, titreDu } from '../src/app/core/aide/guides';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '..', '..');
// Dans l'image Docker, l'étape de compilation du frontend reçoit les guides à
// côté d'elle : le dépôt entier n'y est pas.
const SOURCES = [path.join(RACINE, 'docs', 'guides'), path.join(RACINE, 'frontend', 'docs-guides')];
const SORTIE = path.join(RACINE, 'frontend', 'public', 'aide');

const source = SOURCES.find((d) => fs.existsSync(d));
if (!source) {
  console.error(`[aide] Guides introuvables. Cherché dans :\n  ${SOURCES.join('\n  ')}`);
  process.exit(1);
}

fs.rmSync(SORTIE, { recursive: true, force: true });
fs.mkdirSync(path.join(SORTIE, 'images'), { recursive: true });

const index: { slug: string; titre: string; pourQui: string }[] = [];
const imagesUtilisees = new Set<string>();

for (const guide of GUIDES) {
  const chemin = path.join(source, guide.fichier);
  if (!fs.existsSync(chemin)) {
    console.error(`[aide] ${guide.fichier} est déclaré dans GUIDES mais absent de ${source}.`);
    process.exit(1);
  }
  const md = fs.readFileSync(chemin, 'utf8');
  for (const m of md.matchAll(/!\[[^\]]*\]\((?:\.\/)?images\/([^)]+)\)/g)) imagesUtilisees.add(m[1]);

  const brut = marked.parse(md, { async: false }) as string;
  const { html, sommaire } = preparer(brut, guide.slug);
  fs.writeFileSync(
    path.join(SORTIE, `${guide.slug}.json`),
    JSON.stringify({ titre: titreDu(guide, brut), html, sommaire }),
  );
  index.push({ slug: guide.slug, titre: guide.titre, pourQui: guide.pourQui });
}

// Seules les images réellement citées sont copiées : le dossier en compte une
// cinquantaine, dont celles des documents qui ne sont pas publiés ici.
let copiees = 0;
for (const nom of imagesUtilisees) {
  const de = path.join(source, 'images', nom);
  if (!fs.existsSync(de)) {
    console.error(`[aide] Image citée mais absente : images/${nom}`);
    process.exit(1);
  }
  fs.copyFileSync(de, path.join(SORTIE, 'images', nom));
  copiees++;
}

fs.writeFileSync(path.join(SORTIE, 'index.json'), JSON.stringify({ guides: index }));
console.log(`[aide] ${GUIDES.length} guides et ${copiees} images compilés dans public/aide.`);
