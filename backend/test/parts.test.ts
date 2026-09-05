// Les détentions historisées. C'est le point de modélisation le plus important
// du projet : une répartition passée doit rester juste après un changement de
// quotes-parts, sinon la première contestation détruit la confiance dans l'outil.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChangementImpossible, LigneDetention, anomalies, partsALaDate, preparerChangement, quotePart, quotePartLisible } from '../src/patrimoine/parts';

const HELENE = 1, CLAIRE = 2, THOMAS = 3, JULIEN = 4, ENFANT = 5;

// L'indivision de Kerloc'h : quatre parts égales depuis la succession de 2019.
const INDIVISION: LigneDetention[] = [
  { id: 1, personneId: HELENE, parts: 1, effetDu: '2019-06-01', effetAu: null },
  { id: 2, personneId: CLAIRE, parts: 1, effetDu: '2019-06-01', effetAu: null },
  { id: 3, personneId: THOMAS, parts: 1, effetDu: '2019-06-01', effetAu: null },
  { id: 4, personneId: JULIEN, parts: 1, effetDu: '2019-06-01', effetAu: null },
];

test('une répartition à parts égales se lit sans arrondi', () => {
  const r = partsALaDate(INDIVISION, '2026-09-02');
  assert.equal(r.total, 4);
  assert.deepEqual(quotePart(r, THOMAS), { num: 1, den: 4 });
  assert.equal(quotePartLisible(r, THOMAS), '25 %');
});

test('la SCI se lit en parts sociales, pas en pourcentage arrondi', () => {
  const sci: LigneDetention[] = [
    { id: 1, personneId: THOMAS, parts: 120, effetDu: '2021-03-01', effetAu: null },
    { id: 2, personneId: CLAIRE, parts: 90, effetDu: '2021-03-01', effetAu: null },
    { id: 3, personneId: JULIEN, parts: 90, effetDu: '2021-03-01', effetAu: null },
  ];
  const r = partsALaDate(sci, '2026-09-02');
  assert.equal(r.total, 300);
  assert.deepEqual(quotePart(r, THOMAS), { num: 120, den: 300 });
  assert.equal(quotePartLisible(r, CLAIRE), '30 %');
});

test('avant la date d\'effet, la répartition est vide', () => {
  const r = partsALaDate(INDIVISION, '2019-05-31');
  assert.equal(r.total, 0);
  assert.equal(quotePartLisible(r, HELENE), '0 %');
});

test('la borne de fin est exclue : le jour du changement, ce sont les nouvelles parts', () => {
  const lignes: LigneDetention[] = [
    { id: 1, personneId: HELENE, parts: 1, effetDu: '2019-06-01', effetAu: '2026-03-15' },
    { id: 2, personneId: HELENE, parts: 2, effetDu: '2026-03-15', effetAu: null },
  ];
  assert.equal(partsALaDate(lignes, '2026-03-14').parts.get(HELENE), 1);
  assert.equal(partsALaDate(lignes, '2026-03-15').parts.get(HELENE), 2, 'le jour d\'effet, la nouvelle valeur s\'applique');
});

test('un rachat de parts entre frères et soeurs ne change rien au passé', () => {
  // Julien vend ses parts à Thomas, avec effet au 15 mars 2026.
  const nouvelles = new Map([[HELENE, 1], [CLAIRE, 1], [THOMAS, 2]]);
  const c = preparerChangement(INDIVISION, nouvelles, '2026-03-15', 'Rachat des parts de Julien');

  // Seuls Thomas (dont les parts changent) et Julien (qui sort) sont touchés.
  assert.deepEqual(c.aFermer.map((f) => f.id).sort(), [3, 4]);
  assert.equal(c.aCreer.length, 1);
  assert.deepEqual(c.aCreer[0], { personneId: THOMAS, parts: 2, effetDu: '2026-03-15', effetAu: null, motif: 'Rachat des parts de Julien' });

  // Appliqué, l'historique reste lisible aux deux dates.
  const apres: LigneDetention[] = [
    ...INDIVISION.map((l) => (c.aFermer.some((f) => f.id === l.id) ? { ...l, effetAu: '2026-03-15' } : l)),
    ...c.aCreer.map((l, i) => ({ ...l, id: 100 + i })),
  ];
  const avant = partsALaDate(apres, '2026-02-01');
  assert.equal(avant.total, 4);
  assert.equal(avant.parts.get(JULIEN), 1, 'la taxe foncière de février se répartit encore à quatre');

  const maintenant = partsALaDate(apres, '2026-09-02');
  assert.equal(maintenant.total, 4);
  assert.equal(maintenant.parts.get(JULIEN), undefined, 'Julien est sorti');
  assert.equal(maintenant.parts.get(THOMAS), 2);
});

test('une entrée dans l\'indivision par succession ouvre une ligne sans en écraser', () => {
  const nouvelles = new Map([[HELENE, 1], [CLAIRE, 1], [THOMAS, 1], [JULIEN, 1], [ENFANT, 1]]);
  const c = preparerChangement(INDIVISION, nouvelles, '2027-01-01', 'Entrée de la génération suivante');
  assert.deepEqual(c.aFermer, [], 'personne ne change de parts, donc rien n\'est fermé');
  assert.deepEqual(c.aCreer.map((l) => l.personneId), [ENFANT]);
});

test('un changement rétroactif dans le passé reste possible et daté', () => {
  const c = preparerChangement(INDIVISION, new Map([[HELENE, 2], [CLAIRE, 1], [THOMAS, 1], [JULIEN, 1]]), '2020-01-01', 'Donation');
  assert.deepEqual(c.aFermer.map((f) => f.effetAu), ['2020-01-01']);
  assert.equal(c.aCreer[0].effetDu, '2020-01-01');
});

test('des parts nulles, négatives ou fractionnaires sont refusées', () => {
  for (const mauvais of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () => preparerChangement(INDIVISION, new Map([[HELENE, mauvais]]), '2026-01-01', 'x'),
      ChangementImpossible, `${mauvais} aurait dû être refusé`,
    );
  }
});

test('une répartition vide est refusée', () => {
  // Sans ce garde-fou, « je vide la liste » supprimerait toute la structure
  // d'un geste, sans que rien ne le dise.
  assert.throws(() => preparerChangement(INDIVISION, new Map(), '2026-01-01', 'x'), /ne peut pas être vide/);
});

test('un changement antérieur à une répartition déjà saisie est refusé, en disant quoi faire', () => {
  // Le cas réel : on amorce l'instance aujourd'hui, puis on veut saisir la
  // répartition issue de la succession de 2019. Deviner si la saisie récente
  // doit être remplacée ou conservée produirait un historique faux en silence.
  const lignes: LigneDetention[] = [
    { id: 1, personneId: HELENE, parts: 1, effetDu: '2026-09-05', effetAu: null },
  ];
  assert.throws(
    () => preparerChangement(lignes, new Map([[HELENE, 1], [CLAIRE, 1]]), '2019-06-01', 'Succession'),
    (e: unknown) => e instanceof ChangementImpossible
      && /2026-09-05/.test(e.message) && /date d'effet postérieure/.test(e.message),
  );
});

test('les anomalies attrapent ce que SQLite ne sait pas contraindre', () => {
  assert.deepEqual(anomalies(INDIVISION), [], 'un historique propre ne signale rien');

  const chevauchantes: LigneDetention[] = [
    { id: 1, personneId: HELENE, parts: 1, effetDu: '2019-06-01', effetAu: '2026-03-15' },
    { id: 2, personneId: HELENE, parts: 2, effetDu: '2025-01-01', effetAu: null },
  ];
  const a = anomalies(chevauchantes);
  assert.equal(a.length, 1);
  assert.match(a[0].message, /chevauchent/);

  const jamaisFermee: LigneDetention[] = [
    { id: 1, personneId: CLAIRE, parts: 1, effetDu: '2019-06-01', effetAu: null },
    { id: 2, personneId: CLAIRE, parts: 2, effetDu: '2026-01-01', effetAu: null },
  ];
  assert.equal(anomalies(jamaisFermee).length, 1, 'deux périodes ouvertes se chevauchent forcément');
});

test('deux personnes différentes ne se gênent pas', () => {
  const lignes: LigneDetention[] = [
    { id: 1, personneId: HELENE, parts: 1, effetDu: '2019-06-01', effetAu: null },
    { id: 2, personneId: CLAIRE, parts: 1, effetDu: '2019-06-01', effetAu: null },
  ];
  assert.deepEqual(anomalies(lignes), []);
});
