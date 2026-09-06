// Le taux d'occupation d'une saison, cas par cas.
//
// Deux pièges attendaient ce calcul, et ce fichier existe surtout pour eux :
// un séjour à cheval sur la fin de saison, et deux séjours qui se chevauchent.
// Les deux font dépasser cent pour cent quand on additionne naïvement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nuitsDansLaFenetre, saisonDe, taux } from '../src/sejours/occupation';

test('la saison suit le type du bien, pas le calendrier', () => {
  assert.deepEqual(saisonDe('mer', 2026),
    { libelle: 'Occupation été', debut: '2026-06-01', fin: '2026-09-30' });
  // L'hiver est à cheval sur deux années civiles, et se rattache à celle de
  // son mois de janvier : « la saison 2026 » commence en décembre 2025.
  assert.deepEqual(saisonDe('montagne', 2026),
    { libelle: 'Occupation hiver', debut: '2025-12-01', fin: '2026-03-31' });
  assert.equal(saisonDe('ville', 2026).libelle, 'Occupation annuelle');
});

test('un séjour hors saison ne compte pas', () => {
  const s = saisonDe('mer', 2026);
  assert.equal(nuitsDansLaFenetre({ arrivee: '2026-02-01', depart: '2026-02-08' }, s), 0);
});

test('un séjour à cheval n\'apporte que sa partie dans la saison', () => {
  const s = saisonDe('mer', 2026);
  // Du 27 septembre au 4 octobre : sept nuits, dont quatre seulement en saison
  // (27, 28, 29, 30). Sans cette coupe, une quinzaine de fin de saison ferait
  // dépasser cent pour cent.
  assert.equal(nuitsDansLaFenetre({ arrivee: '2026-09-27', depart: '2026-10-04' }, s), 4);
  // Et de l'autre côté : arrivée le 29 mai, la nuit du 31 mai compte, pas avant.
  assert.equal(nuitsDansLaFenetre({ arrivee: '2026-05-29', depart: '2026-06-03' }, s), 2);
});

test('la nuit de départ est exclue, celle d\'arrivée incluse', () => {
  const s = saisonDe('mer', 2026);
  assert.equal(nuitsDansLaFenetre({ arrivee: '2026-07-04', depart: '2026-07-11' }, s), 7);
  // Une rotation le même jour n'occupe aucune nuit.
  assert.equal(nuitsDansLaFenetre({ arrivee: '2026-07-04', depart: '2026-07-04' }, s), 0);
});

test('deux séjours qui se chevauchent ne comptent la nuit qu\'une fois', () => {
  // Deux familles la même semaine, c'est une semaine occupée, pas deux.
  const t = taux('mer', 2026, [
    { arrivee: '2026-07-04', depart: '2026-07-11' },
    { arrivee: '2026-07-06', depart: '2026-07-13' },
  ]);
  assert.equal(t.nuitsOccupees, 9, 'du 4 au 13 exclu, soit neuf nuits distinctes');
});

test('la saison d\'été compte cent vingt-deux nuits, et le taux s\'en déduit', () => {
  const vide = taux('mer', 2026, []);
  assert.equal(vide.nuitsSaison, 122, 'juin 30 + juillet 31 + août 31 + septembre 30');
  assert.equal(vide.pourcent, 0);

  const plein = taux('mer', 2026, [{ arrivee: '2026-06-01', depart: '2026-10-01' }]);
  assert.equal(plein.pourcent, 100, 'toute la saison occupée');

  const moitie = taux('mer', 2026, [{ arrivee: '2026-06-01', depart: '2026-08-01' }]);
  assert.equal(moitie.nuitsOccupees, 61);
  assert.equal(moitie.pourcent, 50);
});

test('un bien de montagne se juge sur son hiver', () => {
  // Deux semaines en février : la saison hivernale compte 121 nuits
  // (décembre 31 + janvier 31 + février 28 + mars 31).
  const t = taux('montagne', 2026, [{ arrivee: '2026-02-07', depart: '2026-02-21' }]);
  assert.equal(t.nuitsSaison, 121);
  assert.equal(t.nuitsOccupees, 14);
  assert.equal(t.libelle, 'Occupation hiver');
  // Le même séjour compté sur l'été de la mer ne donnerait rien : c'est tout
  // l'intérêt de faire dépendre la saison du type de bien.
  assert.equal(taux('mer', 2026, [{ arrivee: '2026-02-07', depart: '2026-02-21' }]).nuitsOccupees, 0);
});
