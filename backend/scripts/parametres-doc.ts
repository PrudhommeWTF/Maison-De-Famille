// docs/parametres.md, engendré depuis le registre.
//
// La documentation d'un réglage est écrite une fois, dans sa déclaration. Ce
// script la met en page, et la CI vérifie que le fichier versionné est à jour :
// impossible d'ajouter un réglage et d'oublier de le documenter.
//
//   cd backend && npm run docs:parametres
import { REGISTRE, SECTIONS } from '../src/parametres/registre';

const PORTEES: Record<string, string> = {
  deploiement: 'Serveur', instance: 'Instance', structure: 'Structure', bien: 'Bien', personnel: 'Personnel',
};

const defautLisible = (v: boolean | number | string): string =>
  typeof v === 'boolean' ? (v ? 'Oui' : 'Non') : `\`${String(v)}\``;

const lignes: string[] = [
  '# Réglages',
  '',
  'Engendré depuis `backend/src/parametres/registre.ts`. Ne pas modifier à la main :',
  'régénérer avec `cd backend && npm run docs:parametres`.',
  '',
  'La portée dit qui écrit le réglage et sur quoi il s\'applique :',
  '',
  '| Portée | Qui écrit | Sur quoi |',
  '| --- | --- | --- |',
  '| Serveur | variable d\'environnement | tout le service, en lecture seule dans l\'interface |',
  '| Instance | un gérant | toute la famille |',
  '| Structure | un gérant | une indivision ou une SCI |',
  '| Bien | le gérant du bien | un seul bien |',
  '| Personnel | chacun pour soi | soi-même uniquement |',
  '',
];

for (const s of SECTIONS) {
  const reglages = REGISTRE.filter((d) => d.section === s.id);
  if (!reglages.length) continue;
  lignes.push(`## ${s.libelle}`, '', s.description, '');
  for (const d of reglages) {
    lignes.push(`### ${d.libelle}`, '');
    lignes.push(`- **Clé** : \`${d.cle}\``);
    lignes.push(`- **Portée** : ${PORTEES[d.portee] ?? d.portee}`);
    lignes.push(`- **Par défaut** : ${defautLisible(d.defaut)}`);
    if (d.type === 'int') lignes.push(`- **Bornes** : de ${d.min} à ${d.max}`);
    if (d.options) lignes.push(`- **Valeurs** : ${d.options.map((o) => `${o.libelle} (\`${o.valeur}\`)`).join(', ')}`);
    lignes.push('', d.description, '');
  }
}

process.stdout.write(lignes.join('\n'));
