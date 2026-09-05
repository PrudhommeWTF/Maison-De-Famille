// Les seuils de majorité, cas par cas.
//
// C'est l'un des cinq sujets que le brief désigne nommément : « 2/3 en
// indivision, unanimité pour un acte de disposition, quorum de SCI, aucun vote
// en nom propre. Cas limites : exactement le seuil, une abstention, un
// détenteur sorti pendant le scrutin. »
//
// Le cas qui compte le plus est **exactement le seuil**, parce que c'est celui
// qu'on contestera : une comparaison en virgule flottante s'y trompe, et une
// décision de vente d'une maison de famille ne se joue pas à un arrondi près.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScrutinImpossible, depouiller, enCours, issueCertaine, seuilEnVoix } from '../src/decisions/majorite';
import type { Regle, Voix } from '../src/decisions/majorite';

const DEUX_TIERS: Regle = {
  acte: 'gestion_courante', libelle: 'Deux tiers pour la gestion courante',
  base: 'parts', seuilNum: 2, seuilDen: 3, voteRequis: true,
};
const UNANIMITE: Regle = {
  acte: 'disposition', libelle: 'Unanimité pour vendre ou hypothéquer',
  base: 'parts', seuilNum: 1, seuilDen: 1, voteRequis: true,
};
const SANS_VOTE: Regle = {
  acte: 'decision_proprietaire', libelle: 'Décision du propriétaire, sans vote',
  base: 'parts', seuilNum: 1, seuilDen: 1, voteRequis: false,
};

const v = (id: number, poids: number, sens: Voix['sens']): Voix => ({ personneId: id, poids, sens });

test('deux tiers : quatre indivisaires à parts égales', () => {
  // 4 x 25 parts. Deux tiers de 100 valent 67 : il faut trois voix sur quatre.
  const trois = depouiller(DEUX_TIERS, [
    v(1, 25, 'pour'), v(2, 25, 'pour'), v(3, 25, 'pour'), v(4, 25, 'contre'),
  ]);
  assert.equal(trois.requis, 67);
  assert.equal(trois.pour, 75);
  assert.equal(trois.adopte, true);

  const deux = depouiller(DEUX_TIERS, [
    v(1, 25, 'pour'), v(2, 25, 'pour'), v(3, 25, 'contre'), v(4, 25, 'contre'),
  ]);
  assert.equal(deux.adopte, false);
  assert.equal(deux.manque, 17);
});

test('exactement le seuil : 2/3 de 300 parts vaut 200, et 200 suffisent', () => {
  const pile = depouiller(DEUX_TIERS, [v(1, 200, 'pour'), v(2, 100, 'contre')]);
  assert.equal(pile.requis, 200);
  assert.equal(pile.pour, 200);
  assert.equal(pile.adopte, true, 'le seuil atteint exactement doit passer');

  const juste_en_dessous = depouiller(DEUX_TIERS, [v(1, 199, 'pour'), v(2, 101, 'contre')]);
  assert.equal(juste_en_dessous.adopte, false, 'une part de moins ne passe pas');
  assert.equal(juste_en_dessous.manque, 1);
});

test('le seuil s\'arrondit au supérieur, jamais à l\'inférieur', () => {
  // 2/3 de 100 vaut 66,67 : il faut 67, pas 66.
  assert.equal(seuilEnVoix(100, 2, 3), 67);
  const soixanteSix = depouiller(DEUX_TIERS, [v(1, 66, 'pour'), v(2, 34, 'contre')]);
  assert.equal(soixanteSix.adopte, false, '66 % est en dessous de deux tiers');
  const soixanteSept = depouiller(DEUX_TIERS, [v(1, 67, 'pour'), v(2, 33, 'contre')]);
  assert.equal(soixanteSept.adopte, true);
});

test('une abstention compte dans le corps électoral, pas hors de lui', () => {
  // Trois pour, un abstenu : 75 pour sur 100, au-dessus des deux tiers.
  const passe = depouiller(DEUX_TIERS, [
    v(1, 25, 'pour'), v(2, 25, 'pour'), v(3, 25, 'pour'), v(4, 25, null),
  ]);
  assert.equal(passe.abstention, 25);
  assert.equal(passe.adopte, true);

  // Deux pour, deux abstenus : 50 sur 100, sous le seuil, alors que les voix
  // exprimées seraient unanimes. C'est le point du module, et il est voulu.
  const bloque = depouiller(DEUX_TIERS, [
    v(1, 25, 'pour'), v(2, 25, 'pour'), v(3, 25, null), v(4, 25, 'abstention'),
  ]);
  assert.equal(bloque.exprime, 50);
  assert.equal(bloque.adopte, false,
    'le seuil porte sur les droits détenus, pas sur les voix exprimées');
  assert.match(bloque.explication, /abstention comptent dans le corps électoral/);
});

test('unanimité : une seule voix contre suffit à rejeter', () => {
  const tous = depouiller(UNANIMITE, [v(1, 25, 'pour'), v(2, 25, 'pour'), v(3, 50, 'pour')]);
  assert.equal(tous.adopte, true);

  const une = depouiller(UNANIMITE, [v(1, 25, 'pour'), v(2, 25, 'pour'), v(3, 50, 'contre')]);
  assert.equal(une.adopte, false);

  // Et une abstention bloque tout autant : vendre une maison de famille demande
  // que tout le monde le dise, pas que personne ne s'y oppose.
  const abstenu = depouiller(UNANIMITE, [v(1, 25, 'pour'), v(2, 25, 'pour'), v(3, 50, null)]);
  assert.equal(abstenu.adopte, false);
  assert.equal(abstenu.manque, 50);
});

test('un détenteur sorti pendant le scrutin garde le poids figé à l\'ouverture', () => {
  // Le module ne connaît que les voix qu'on lui donne : c'est le dépôt qui les
  // fige. Ce test vérifie la conséquence : le total reste celui de l'ouverture,
  // même si la personne n'existe plus dans l'indivision au dépouillement.
  const ouverture = [v(1, 25, 'pour'), v(2, 25, 'pour'), v(3, 25, 'pour'), v(4, 25, 'contre')];
  const d = depouiller(DEUX_TIERS, ouverture);
  assert.equal(d.total, 100, 'le corps électoral est celui de l\'ouverture');
  assert.equal(d.adopte, true);
  assert.match(d.explication, /figées à l'ouverture du scrutin/);
});

test('quorum de SCI : sous le quorum, le scrutin est sans effet', () => {
  const assemblee: Regle = {
    acte: 'assemblee_ordinaire', libelle: 'Majorité des parts en assemblée ordinaire',
    base: 'parts', seuilNum: 1, seuilDen: 2, quorumNum: 1, quorumDen: 2, voteRequis: true,
  };
  // 150 sur 300 exprimées : le quorum de moitié est atteint tout juste.
  const juste = depouiller(assemblee, [v(1, 150, 'pour'), v(2, 100, null), v(3, 50, null)]);
  assert.equal(juste.quorumRequis, 150);
  assert.equal(juste.quorumAtteint, true);
  assert.equal(juste.adopte, true);

  // 100 exprimées seulement : sans effet, même si tous les votants sont pour.
  const insuffisant = depouiller(assemblee, [v(1, 100, 'pour'), v(2, 100, null), v(3, 100, null)]);
  assert.equal(insuffisant.quorumAtteint, false);
  assert.equal(insuffisant.adopte, false);
  assert.match(insuffisant.explication, /quorum n'est pas atteint/);
});

test('base « tetes » : chacun pèse une voix, quelles que soient ses parts', () => {
  const parTete: Regle = { ...DEUX_TIERS, base: 'tetes' };
  // Le gros porteur est seul contre trois petits : il perd.
  const d = depouiller(parTete, [
    v(1, 970, 'contre'), v(2, 10, 'pour'), v(3, 10, 'pour'), v(4, 10, 'pour'),
  ]);
  assert.equal(d.total, 4);
  assert.equal(d.pour, 3);
  assert.equal(d.requis, 3);
  assert.equal(d.adopte, true);
  assert.match(d.explication, /des voix/);
});

test('un acte sans vote refuse d\'être dépouillé, et dit quoi faire', () => {
  assert.throws(() => depouiller(SANS_VOTE, [v(1, 100, 'pour')]), (e: Error) => {
    assert.ok(e instanceof ScrutinImpossible);
    assert.match(e.message, /sans scrutin/, 'le message doit dire ce qui remplace le vote');
    return true;
  });
});

test('un scrutin sans électeur est refusé, avec la marche à suivre', () => {
  assert.throws(() => depouiller(DEUX_TIERS, []), (e: Error) => {
    assert.match(e.message, /répartition des parts/);
    return true;
  });
});

test('un seuil mal formé est refusé plutôt que calculé de travers', () => {
  assert.throws(() => seuilEnVoix(100, 2, 0), ScrutinImpossible);
  assert.throws(() => seuilEnVoix(100, 0, 3), ScrutinImpossible);
});

test('la phrase affichée pendant le scrutin dit ce qui manque', () => {
  const phrase = enCours(DEUX_TIERS, [
    v(1, 25, 'pour'), v(2, 25, 'pour'), v(3, 25, null), v(4, 25, null),
  ], 25);
  assert.match(phrase, /Votre voix pèse 25 % des droits/);
  assert.match(phrase, /Il manque 17 parts/);
  assert.match(phrase, /2 personnes n'ont pas encore voté/);

  const atteint = enCours(DEUX_TIERS, [v(1, 70, 'pour'), v(2, 30, 'contre')], null);
  assert.match(atteint, /Le seuil est atteint/);
  assert.ok(!/Votre voix/.test(atteint), 'un observateur sans droit de vote ne lit pas son poids');
});

test('l\'issue est certaine quand plus aucun vote ne peut la changer', () => {
  // Le seuil est atteint : inutile d'attendre.
  assert.equal(issueCertaine(DEUX_TIERS, [v(1, 70, 'pour'), v(2, 30, null)]), true);
  // Le seuil est devenu inatteignable même si tous les indécis votaient pour.
  assert.equal(issueCertaine(DEUX_TIERS, [v(1, 40, 'contre'), v(2, 30, 'contre'), v(3, 30, null)]), true);
  // Il reste du jeu : on attend.
  assert.equal(issueCertaine(DEUX_TIERS, [v(1, 50, 'pour'), v(2, 30, null), v(3, 20, null)]), false);
});

test('l\'explication se relit dix ans après sans le code sous les yeux', () => {
  const d = depouiller(DEUX_TIERS, [
    v(1, 25, 'pour'), v(2, 25, 'pour'), v(3, 25, 'pour'), v(4, 25, 'contre'),
  ]);
  for (const attendu of [/Règle appliquée/, /Corps électoral/, /Pour : 75/, /Seuil à atteindre : 67/, /Résultat : adopté/]) {
    assert.match(d.explication, attendu);
  }
});

test('l\'accord se fait au singulier comme au pluriel', () => {
  // « Il manque 1 parts » se lit mal dans un texte qu'on relira pour défendre
  // une décision contestée.
  const une = depouiller(DEUX_TIERS, [v(1, 66, 'pour'), v(2, 34, 'contre')]);
  assert.equal(une.manque, 1);
  assert.match(une.explication, /Il manque 1 part pour/);
  const plusieurs = depouiller(DEUX_TIERS, [v(1, 50, 'pour'), v(2, 50, 'contre')]);
  assert.match(plusieurs.explication, /Il manque 17 parts pour/);
  assert.match(enCours(DEUX_TIERS, [v(1, 66, 'pour'), v(2, 34, null)], 66), /Il manque 1 part /);
});
