// La portée des documents et des codes, cas par cas.
//
// C'est le test que le brief demande nommément : « un code de portée séjour la
// veille, pendant, le lendemain, et après ». Il est exhaustif parce que la
// phrase qui le commande l'est : « un code d'accès affiché à quelqu'un dont le
// séjour est terminé est une faille ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FENETRE_PAR_DEFAUT, PORTEES, couvre, decaler, peutVoir, porteesAttribuables,
  porteesVisibles, refus,
} from '../src/coffre/portee';
import type { Demandeur, RoleSurBien } from '../src/coffre/portee';

const SEJOUR = { arrivee: '2026-07-11', depart: '2026-07-19' };
const qui = (role: RoleSurBien, sejours = [SEJOUR]): Demandeur => ({ role, sejours });

test('la matrice des portées, rôle par rôle, hors séjour', () => {
  const loin = '2026-01-01';
  const attendu: Record<RoleSurBien, Record<string, boolean>> = {
    gerant: { gerant: true, detenteur: true, membres: true, sejour: true },
    detenteur: { gerant: false, detenteur: true, membres: true, sejour: true },
    membre_foyer: { gerant: false, detenteur: false, membres: true, sejour: false },
    invite: { gerant: false, detenteur: false, membres: false, sejour: false },
  };
  for (const [role, lignes] of Object.entries(attendu)) {
    for (const p of PORTEES) {
      assert.equal(peutVoir(p, qui(role as RoleSurBien), loin), lignes[p],
        `${role} et la portée ${p}, hors période de séjour`);
    }
  }
});

test('un code de portée séjour : la veille, pendant, le jour du départ, le lendemain', () => {
  const membre = qui('membre_foyer');
  const cas: [string, boolean, string][] = [
    ['2026-07-08', false, 'trois jours avant : trop tôt, la fenêtre ouvre à deux jours'],
    ['2026-07-09', true, "deux jours avant : on prépare son départ, le code sert"],
    ['2026-07-10', true, 'la veille'],
    ['2026-07-11', true, "le jour d'arrivée"],
    ['2026-07-15', true, 'en plein séjour'],
    ['2026-07-18', true, 'la dernière nuit'],
    ['2026-07-19', true, 'le jour du départ : il faut refermer derrière soi'],
    ['2026-07-20', false, 'le lendemain du départ : la faille que le brief nomme'],
    ['2026-08-01', false, 'bien après'],
  ];
  for (const [jour, attendu, pourquoi] of cas) {
    assert.equal(peutVoir('sejour', membre, jour), attendu, `${jour} : ${pourquoi}`);
  }
});

test('un invité suit exactement la même fenêtre', () => {
  const invite = qui('invite');
  assert.equal(peutVoir('sejour', invite, '2026-07-15'), true);
  assert.equal(peutVoir('sejour', invite, '2026-07-20'), false);
  // Et il ne voit rien d'autre, jamais, même pendant son séjour.
  for (const p of ['gerant', 'detenteur', 'membres'] as const) {
    assert.equal(peutVoir(p, invite, '2026-07-15'), false,
      `un invité ne doit pas voir la portée ${p}, même présent`);
  }
});

test('un gérant et un détenteur voient le code hors de toute période', () => {
  for (const role of ['gerant', 'detenteur'] as const) {
    assert.equal(peutVoir('sejour', qui(role, []), '2026-01-01'), true,
      `${role} sans aucun séjour doit voir le code : la maison est la sienne`);
  }
});

test('un membre de foyer sans séjour ne voit aucun code de séjour', () => {
  assert.equal(peutVoir('sejour', qui('membre_foyer', []), '2026-07-15'), false);
});

test('plusieurs séjours : le bon jour dans le bon séjour', () => {
  const deux = qui('membre_foyer', [
    { arrivee: '2026-02-14', depart: '2026-02-21' },
    { arrivee: '2026-07-11', depart: '2026-07-19' },
  ]);
  assert.equal(peutVoir('sejour', deux, '2026-02-16'), true);
  assert.equal(peutVoir('sejour', deux, '2026-04-01'), false, 'entre les deux séjours, rien');
  assert.equal(peutVoir('sejour', deux, '2026-07-15'), true);
});

test('un séjour d\'une nuit ouvre bien la fenêtre', () => {
  const court = qui('membre_foyer', [{ arrivee: '2026-07-11', depart: '2026-07-12' }]);
  assert.equal(peutVoir('sejour', court, '2026-07-11'), true);
  assert.equal(peutVoir('sejour', court, '2026-07-12'), true, 'le jour du départ compte');
  assert.equal(peutVoir('sejour', court, '2026-07-13'), false);
});

test('une rotation le même jour : chacun voit le code le jour de la bascule', () => {
  const partant = qui('membre_foyer', [{ arrivee: '2026-07-04', depart: '2026-07-11' }]);
  const arrivant = qui('membre_foyer', [{ arrivee: '2026-07-11', depart: '2026-07-18' }]);
  assert.equal(peutVoir('sejour', partant, '2026-07-11'), true, 'il doit pouvoir refermer');
  assert.equal(peutVoir('sejour', arrivant, '2026-07-11'), true, 'il doit pouvoir ouvrir');
  assert.equal(peutVoir('sejour', partant, '2026-07-12'), false);
});

test('un séjour à cheval sur le changement d\'année', () => {
  const nouvelAn = qui('membre_foyer', [{ arrivee: '2026-12-28', depart: '2027-01-04' }]);
  assert.equal(peutVoir('sejour', nouvelAn, '2026-12-31'), true);
  assert.equal(peutVoir('sejour', nouvelAn, '2027-01-02'), true);
  assert.equal(peutVoir('sejour', nouvelAn, '2027-01-04'), true);
  assert.equal(peutVoir('sejour', nouvelAn, '2027-01-05'), false);
  // La fenêtre d'avance traverse aussi la bascule de mois.
  assert.equal(peutVoir('sejour', nouvelAn, '2026-12-26'), true);
  assert.equal(peutVoir('sejour', nouvelAn, '2026-12-25'), false);
});

test('la fenêtre est configurable, et zéro jour après reste le défaut', () => {
  assert.deepEqual(FENETRE_PAR_DEFAUT, { avant: 2, apres: 0 });
  const membre = qui('membre_foyer');
  assert.equal(peutVoir('sejour', membre, '2026-07-20', { avant: 2, apres: 1 }), true);
  assert.equal(peutVoir('sejour', membre, '2026-07-21', { avant: 2, apres: 1 }), false);
  assert.equal(peutVoir('sejour', membre, '2026-07-09', { avant: 0, apres: 0 }), false);
  assert.equal(peutVoir('sejour', membre, '2026-07-11', { avant: 0, apres: 0 }), true);
});

test('une date invalide ne couvre rien plutôt que de tout ouvrir', () => {
  assert.equal(couvre(SEJOUR, 'pas-une-date'), false);
  assert.equal(couvre({ arrivee: '', depart: '' }, '2026-07-15'), false);
  assert.equal(peutVoir('sejour', qui('membre_foyer'), ''), false);
});

test('une portée inconnue se ferme au lieu de s\'ouvrir', () => {
  // Le jour où le schéma gagnera une portée, le défaut doit refuser.
  assert.equal(peutVoir('coffre_du_notaire' as never, qui('gerant'), '2026-07-15'), false);
});

test('decaler franchit les mois, les années et les bissextiles', () => {
  assert.equal(decaler('2026-07-11', -2), '2026-07-09');
  assert.equal(decaler('2026-03-01', -1), '2026-02-28');
  assert.equal(decaler('2024-03-01', -1), '2024-02-29', '2024 est bissextile');
  assert.equal(decaler('2026-12-31', 1), '2027-01-01');
});

test('porteesVisibles rend exactement ce que peutVoir accorde', () => {
  for (const role of ['gerant', 'detenteur', 'membre_foyer', 'invite'] as const) {
    for (const jour of ['2026-07-15', '2026-07-20']) {
      const liste = porteesVisibles(qui(role), jour);
      assert.deepEqual(liste, PORTEES.filter((p) => peutVoir(p, qui(role), jour)),
        `${role} le ${jour}`);
    }
  }
});

test('seul un gérant attribue une portée', () => {
  assert.deepEqual(porteesAttribuables('gerant'), [...PORTEES]);
  for (const role of ['detenteur', 'membre_foyer', 'invite'] as const) {
    assert.deepEqual(porteesAttribuables(role), []);
  }
});

test('le refus dit pourquoi sans révéler ce qu\'il cache', () => {
  const avec = refus('sejour', qui('membre_foyer'));
  assert.match(avec, /autour de votre séjour/);
  const sans = refus('sejour', qui('membre_foyer', []));
  assert.match(sans, /qui séjournent/);
  for (const p of PORTEES) {
    const m = refus(p, qui('invite'));
    assert.ok(m.length > 20 && !/introuvable|n'existe pas/i.test(m),
      `le message de la portée ${p} doit expliquer, pas nier l'existence`);
  }
});
