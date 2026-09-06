// L'import du calendrier scolaire.
//
// Ce que ces tests protègent, dans l'ordre d'importance :
//
//   1. **La borne de fin.** Le fichier officiel donne le jour de la reprise, un
//      tableau tenu à la main donne le dernier jour de vacances. Se tromper
//      décale toutes les périodes d'un jour, ce qui ne se voit pas à l'oeil et
//      fait rentrer un enfant la veille.
//   2. **Ce qui doit être écarté** : les lignes qui concernent les enseignants,
//      les jours de rentrée, et les zones hors métropole. Importer la
//      prérentrée des enseignants comme des vacances ferait poser un séjour sur
//      un jour de classe.
//   3. **Le refus de deviner.** Un fichier dont les colonnes ne sont pas
//      reconnues dit lesquelles manquent et lesquelles il a vues.
//   4. **La revérification du retour navigateur.** L'aperçu fait un aller-retour
//      par le client, donc tout est recontrôlé à l'écriture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MOT_DE_PASSE, amorcer, creerCompte, demarrer } from './aide';
import { ouvrirEnMemoire } from '../src/noyau/db';
import { appliquer } from '../src/noyau/migrations';
import { lireCsv } from '../src/noyau/tableau/tableau';
import { FichierIncomprehensible, analyser, nomCourt, relire } from '../src/calendrier/import';
import { anneesCouvertes, periodesEntre, remplacer, resume } from '../src/calendrier/repo';
import { zonesEnVacances } from '../src/calendrier/vacances';

/** `assert.throws` ne rend pas l'erreur : il faut l'attraper pour la lire. */
function erreurDe(action: () => unknown): Error {
  try { action(); } catch (e) { return e as Error; }
  throw new Error('Aucune erreur levée alors qu\'une était attendue.');
}

function base() {
  const db = ouvrirEnMemoire();
  appliquer(db, fs.mkdtempSync(path.join(os.tmpdir(), 'mdf-imp-')));
  return db;
}

/** Un extrait du fichier de l'Éducation nationale, tel qu'il s'exporte en CSV. */
const OFFICIEL = [
  'description;start_date;end_date;location;zones;annee_scolaire;population',
  "Vacances de la Toussaint;2026-10-17T00:00:00+02:00;2026-11-02T00:00:00+01:00;Lyon;Zone A;2026-2027;-",
  "Vacances de la Toussaint;2026-10-17T00:00:00+02:00;2026-11-02T00:00:00+01:00;Rennes;Zone B;2026-2027;-",
  "Vacances de la Toussaint;2026-10-17T00:00:00+02:00;2026-11-02T00:00:00+01:00;Paris;Zone C;2026-2027;-",
  "Vacances d'Hiver;2027-02-06T00:00:00+01:00;2027-02-22T00:00:00+01:00;Lyon;Zone A;2026-2027;Élèves",
  "Vacances d'Hiver;2027-02-13T00:00:00+01:00;2027-03-01T00:00:00+01:00;Rennes;Zone B;2026-2027;Élèves",
  "Vacances d'Hiver;2027-02-20T00:00:00+01:00;2027-03-08T00:00:00+01:00;Paris;Zone C;2026-2027;Élèves",
  'Rentrée scolaire des élèves;2026-09-01T00:00:00+02:00;2026-09-01T00:00:00+02:00;Lyon;Zone A;2026-2027;Élèves',
  'Prérentrée des enseignants;2026-08-31T00:00:00+02:00;2026-08-31T00:00:00+02:00;Lyon;Zone A;2026-2027;Enseignants',
  "Vacances d'Hiver;2027-02-20T00:00:00+01:00;2027-03-08T00:00:00+01:00;Corse;Corse;2026-2027;Élèves",
].join('\n');

/** Le même contenu tenu à la main : dernier jour de vacances, pas jour de reprise. */
const MAISON = [
  'Période;Zone;Début;Fin;Année scolaire',
  'Toussaint;A;17/10/2026;01/11/2026;2026-2027',
  'Toussaint;B;17/10/2026;01/11/2026;2026-2027',
  'Toussaint;C;17/10/2026;01/11/2026;2026-2027',
].join('\n');

test('le fichier officiel est lu, borne de fin comprise', () => {
  const r = analyser(lireCsv(OFFICIEL));
  assert.equal(r.finEstLaReprise, true, 'les fins tombent un lundi : ce sont des reprises');

  const toussaint = r.periodes.filter((p) => p.nom === 'Toussaint');
  assert.equal(toussaint.length, 3);
  assert.equal(toussaint[0].debut, '2026-10-17');
  assert.equal(toussaint[0].fin, '2026-11-01', 'la reprise est le 2, donc le dernier jour est le 1er');
  assert.equal(toussaint[0].anneeScolaire, '2026-2027');

  const hiverA = r.periodes.find((p) => p.nom === 'Hiver' && p.zone === 'A');
  assert.deepEqual([hiverA?.debut, hiverA?.fin], ['2027-02-06', '2027-02-21']);
});

test('un tableau tenu à la main garde ses bornes telles quelles', () => {
  const r = analyser(lireCsv(MAISON));
  assert.equal(r.finEstLaReprise, false, 'une fin le dimanche ne peut pas être une reprise');
  assert.equal(r.periodes.length, 3);
  assert.equal(r.periodes[0].fin, '2026-11-01', 'la date est reprise sans décalage');
});

test('rentrées, enseignants et zones hors métropole sont écartés avec leur raison', () => {
  const r = analyser(lireCsv(OFFICIEL));
  assert.equal(r.periodes.length, 6, 'trois Toussaint et trois Hiver, rien d\'autre');

  const raisons = r.rejets.map((x) => x.raison);
  assert.equal(r.rejets.length, 3);
  assert.ok(raisons.some((x) => /rentrée/i.test(x)), 'la rentrée des élèves est écartée');
  assert.ok(raisons.some((x) => /enseignants/i.test(x)), 'la prérentrée des enseignants est écartée');
  assert.ok(raisons.some((x) => /Corse/.test(x)), 'la Corse est nommée dans le refus');
  // Le numéro de ligne doit permettre de retrouver la ligne dans le tableur.
  for (const rejet of r.rejets) assert.ok(rejet.ligne >= 2 && rejet.ligne <= 10, `ligne ${rejet.ligne}`);
});

test('un fichier aux colonnes inconnues dit ce qui manque et ce qu\'il a vu', () => {
  const e = erreurDe(() => analyser(lireCsv('Machin;Truc\nun;deux')));
  assert.ok(e instanceof FichierIncomprehensible);
  assert.match(e.message, /date de début/);
  assert.match(e.message, /zone/);
  assert.match(e.message, /Machin, Truc/, 'les intitulés réellement lus sont rappelés');
});

test('les préfixes répétitifs sont retirés du nom', () => {
  assert.equal(nomCourt('Vacances de la Toussaint'), 'Toussaint');
  assert.equal(nomCourt("Vacances d'Hiver"), 'Hiver');
  assert.equal(nomCourt('Vacances de Noël'), 'Noël');
  assert.equal(nomCourt("Début des Vacances d'Été"), 'Été');
  assert.equal(nomCourt("Pont de l'Ascension"), "Pont de l'Ascension", 'ce qui n\'est pas un préfixe reste');
  assert.equal(nomCourt('Vacances'), 'Vacances', 'un nom qui se réduirait à rien est gardé entier');
});

test('une ligne aberrante est refusée, pas arrondie', () => {
  const r = analyser(lireCsv([
    'Période;Zone;Début;Fin',
    'Trop longue;A;12/01/2026;12/06/2026',
    'À l\'envers;A;12/06/2026;12/01/2026',
    'Illisible;A;pas une date;12/01/2026',
  ].join('\n')));
  assert.equal(r.periodes.length, 0);
  assert.equal(r.rejets.length, 3);
  assert.match(r.rejets[0].raison, /plus de 80 jours/);
  assert.match(r.rejets[1].raison, /avant le début/);
  assert.match(r.rejets[2].raison, /illisible/);
});

test("l'import remplace l'année qu'il apporte et ne touche à aucune autre", () => {
  const db = base();
  assert.deepEqual(anneesCouvertes(db), ['2025-2026']);

  const { periodes } = analyser(lireCsv(OFFICIEL));
  const premier = remplacer(db, periodes, 'calendrier-officiel.csv', 0);
  assert.deepEqual(premier.annees, ['2026-2027']);
  assert.equal(premier.ecrites, 6);
  assert.equal(premier.remplacees, 0, 'rien à remplacer la première fois');
  assert.deepEqual(anneesCouvertes(db), ['2025-2026', '2026-2027'], '2025-2026 est intacte');

  // Le même fichier une seconde fois ne doit rien dupliquer.
  const second = remplacer(db, periodes, 'calendrier-officiel.csv', 0);
  assert.equal(second.remplacees, 6);
  assert.equal(resume(db).find((a) => a.anneeScolaire === '2026-2027')?.periodes, 6);
});

test("ce qui est importé s'affiche ensuite au calendrier", () => {
  const db = base();
  remplacer(db, analyser(lireCsv(OFFICIEL)).periodes, 'officiel.csv', 0);
  const p = periodesEntre(db, '2027-02-01', '2027-03-15');

  // Le 8 février 2027 : seule la zone A est partie.
  assert.deepEqual(zonesEnVacances('2027-02-08', p), ['A']);
  // Le 15 : A et B.
  assert.deepEqual(zonesEnVacances('2027-02-15', p), ['A', 'B']);
  // Le 22 : A est rentrée le matin même, B et C sont dehors.
  assert.deepEqual(zonesEnVacances('2027-02-22', p), ['B', 'C']);
  // La Toussaint, commune aux trois zones, se regroupe en une seule période.
  const toussaint = periodesEntre(db, '2026-10-20', '2026-10-21');
  assert.deepEqual(toussaint.map((x) => x.zone), [null]);
});

test('ce que renvoie le navigateur est revérifié entièrement', () => {
  const bon = { anneeScolaire: '2026-2027', nom: 'Toussaint', zone: 'A', debut: '2026-10-17', fin: '2026-11-01' };
  assert.equal(relire([bon]).length, 1);

  const refuse = (modif: Record<string, unknown>, attendu: RegExp): void => {
    assert.match(erreurDe(() => relire([{ ...bon, ...modif }])).message, attendu);
  };
  refuse({ anneeScolaire: '2026-2028' }, /année scolaire invalide/);
  refuse({ anneeScolaire: 'DROP TABLE' }, /année scolaire invalide/);
  refuse({ zone: 'D' }, /zone invalide/);
  refuse({ fin: '2026-10-01' }, /dates invalides/);
  refuse({ fin: '2027-10-01' }, /trop longue/);
  refuse({ nom: '   ' }, /nom vide/);
  assert.throws(() => relire([]), /Aucune période/);
  assert.throws(() => relire('des périodes'), /Aucune période/);
});

// ---------------------------------------------------------------------------
// La recette de bout en bout : ce que fait vraiment l'écran Réglages.
// ---------------------------------------------------------------------------

test("depuis Réglages : téléverser, relire l'aperçu, enregistrer", async (t) => {
  const i = await demarrer();
  t.after(() => i.fermer());
  await amorcer(i);

  const avant = await i.get<{ annees: { anneeScolaire: string }[] }>('/api/calendrier/vacances');
  assert.equal(avant.statut, 200);
  assert.deepEqual(avant.corps.annees.map((a) => a.anneeScolaire), ['2025-2026']);

  const apercu = await i.appel<{
    periodes: unknown[]; annees: { anneeScolaire: string; periodes: number }[];
    rejets: unknown[]; finEstLaReprise: boolean; deja: string[]; format: string;
  }>('POST', '/api/calendrier/vacances/analyse?nom=calendrier.csv', Buffer.from(OFFICIEL, 'utf8'));
  assert.equal(apercu.statut, 200, JSON.stringify(apercu.corps));
  assert.equal(apercu.corps.periodes.length, 6);
  assert.equal(apercu.corps.rejets.length, 3);
  assert.equal(apercu.corps.finEstLaReprise, true);
  assert.deepEqual(apercu.corps.annees, [{ anneeScolaire: '2026-2027', periodes: 6 }]);
  assert.deepEqual(apercu.corps.deja, ['2025-2026'], "l'écran doit pouvoir dire ce qui sera remplacé");

  // L'aperçu n'écrit rien : c'est toute la raison de l'étape.
  assert.deepEqual(anneesCouvertes(i.db), ['2025-2026']);

  const ecrit = await i.post<{ annees: string[]; ecrites: number }>('/api/calendrier/vacances', {
    periodes: apercu.corps.periodes, source: 'calendrier.csv',
  });
  assert.equal(ecrit.statut, 200, JSON.stringify(ecrit.corps));
  assert.deepEqual(ecrit.corps.annees, ['2026-2027']);
  assert.equal(ecrit.corps.ecrites, 6);

  // Et le calendrier le voit immédiatement, avertissement compris.
  const reperes = await i.get<{ couvert: boolean; vacances: { nom: string }[] }>(
    '/api/calendrier/reperes?du=2027-02-01&au=2027-02-28');
  assert.equal(reperes.statut, 200);
  assert.equal(reperes.corps.couvert, true, "l'année importée ne doit plus être annoncée comme manquante");
  assert.ok(reperes.corps.vacances.some((v) => v.nom === 'Hiver'));
});

test("un fichier illisible est refusé en français, sans rien écrire", async (t) => {
  const i = await demarrer();
  t.after(() => i.fermer());
  await amorcer(i);

  const r = await i.appel<{ message: string }>(
    'POST', '/api/calendrier/vacances/analyse?nom=courses.csv', Buffer.from('Pain;2\nLait;1', 'utf8'));
  assert.equal(r.statut, 400);
  assert.match(r.corps.message, /ne contient pas de colonne/);
  assert.deepEqual(anneesCouvertes(i.db), ['2025-2026']);

  const vide = await i.appel('POST', '/api/calendrier/vacances/analyse', Buffer.alloc(0));
  assert.equal(vide.statut, 400);
});

test('seul un gérant peut changer le calendrier scolaire', async (t) => {
  const i = await demarrer();
  t.after(() => i.fermer());
  const { bienId, structureId } = await amorcer(i);

  // Marc est rattaché pour de bon : sans cela, le test vérifierait seulement
  // qu'un inconnu se fait refuser, ce qui est bien plus faible.
  const marcId = await creerCompte(i, 'Marc Prudhomme', 'marc@exemple.fr');
  const rattache = await i.post(`/api/structures/${structureId}/roles`,
    { personneId: marcId, role: 'membre_foyer' });
  assert.equal(rattache.statut, 204, JSON.stringify(rattache.corps));
  await i.connexion('marc@exemple.fr', MOT_DE_PASSE);

  // Le témoin du rattachement : sans lui, un 403 plus bas prouverait seulement
  // qu'un inconnu se fait refuser.
  assert.equal((await i.get(`/api/biens/${bienId}`)).statut, 200, 'Marc doit bien voir le bien');
  // Il voit les repères, comme tout le monde : ce ne sont pas des secrets.
  assert.equal((await i.get('/api/calendrier/reperes?du=2026-02-01&au=2026-02-28')).statut, 200);
  // Mais il ne peut ni consulter l'état de l'import, ni écrire.
  assert.equal((await i.get('/api/calendrier/vacances')).statut, 403);
  assert.equal((await i.appel('POST', '/api/calendrier/vacances/analyse', Buffer.from(OFFICIEL))).statut, 403);
  assert.equal((await i.post('/api/calendrier/vacances', { periodes: [] })).statut, 403);
  assert.deepEqual(anneesCouvertes(i.db), ['2025-2026']);
});
