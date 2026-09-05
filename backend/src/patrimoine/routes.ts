// Structures, biens, détentions, personnes et foyers.
//
// Toutes les routes qui portent sur un bien passent par `/api/biens/:bienId/…`,
// et toutes celles qui portent sur une structure par
// `/api/structures/:structureId/…`. Ce n'est pas une préférence d'esthétique :
// c'est ce qui permet à la garde d'accès de s'appliquer **mécaniquement**, sur
// le paramètre d'URL, sans qu'un gestionnaire ait à y penser. Une route qui
// désignerait un bien autrement échapperait à la garde, et la CI la refuse.
import { Deps, Routeur } from '../noyau/http';
import { aujourdhui } from '../noyau/dates';
import { invalide } from '../noyau/erreurs';
import { log } from '../noyau/log';
import { lire } from '../noyau/valider';
import { parametre } from '../parametres/repo';
import { deposer } from '../stockage/fichiers';
import { partsALaDate } from './parts';
import {
  ModeStructure, TypeBien, VOCABULAIRE, archiverBien, attribuerRole, bien, changerDetentions,
  creerBien, creerFoyer, creerPersonne, creerStructure, detentionsDe, detenteursALaDate,
  foyers, modifierBien, personnes, regleCourante, reglesDe, structure,
} from './repo';

const MODES: readonly ModeStructure[] = ['indivision', 'sci', 'nom_propre'];
const TYPES: readonly TypeBien[] = ['mer', 'montagne', 'campagne', 'ville'];

export function routesPatrimoine(deps: Deps): Routeur {
  const r = new Routeur('patrimoine', deps);

  // ---------- Biens ----------

  /** La fiche d'un bien, avec le vocabulaire et la règle de sa structure. */
  r.get('/biens/:bienId', { acces: 'bien', role: 'invite' }, (ctx) => {
    const b = bien(ctx.db, ctx.bienId);
    const s = structure(ctx.db, b.structureId);
    const role = ctx.portee.biens.get(ctx.bienId);
    return {
      bien: b,
      structure: { id: s.id, mode: s.mode, nom: s.nom, notes: s.notes },
      vocabulaire: VOCABULAIRE[s.mode],
      regleMajorite: regleCourante(ctx.db, s.id),
      role,
    };
  });

  /**
   * Créer un bien, et s'il le faut sa structure. Le créateur devient gérant de
   * la structure qu'il crée : sans cela, il perdrait l'accès au bien qu'il vient
   * de créer, ce qui est le genre de surprise qu'on ne veut pas à trois heures
   * du matin.
   */
  r.post('/biens', { acces: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const structureId = l.idFacultatif('structureId');
    const structureMode = structureId ? 'indivision' : l.choix<ModeStructure>('structureMode', MODES);
    const structureNom = structureId ? '' : l.texte('structureNom', { max: 120 });
    const nom = l.texte('nom', { max: 120 });
    const commune = l.texte('commune', { max: 120 });
    const codePostal = l.texte('codePostal', { max: 10, defaut: '' });
    const adresse = l.texte('adresse', { max: 240, defaut: '' });
    const type = l.choix<TypeBien>('type', TYPES);
    const couchages = l.entier('couchages', { min: 1, max: 100 });
    const locationActivee = l.booleen('locationActivee');
    const notes = l.texte('notes', { max: 1000, defaut: '' });
    l.fin();

    if (structureId && ctx.portee.structures.get(structureId) !== 'gerant') {
      throw invalide('Vous ne gérez pas cette structure.');
    }

    return ctx.db.transaction(() => {
      let sid = structureId;
      if (!sid) {
        sid = creerStructure(ctx.db, structureMode, structureNom, notes, ctx.personneId);
        // Le créateur devient gérant, et rien d'autre : la répartition des parts
        // se saisit avec sa vraie date d'effet, elle ne se devine pas.
        attribuerRole(ctx.db, ctx.personneId, { structureId: sid }, 'gerant', aujourdhui(), ctx.personneId);
      }
      const bienId = creerBien(ctx.db, {
        structureId: sid, nom, commune, codePostal, adresse, type, couchages, locationActivee, notes,
      }, ctx.personneId);
      log.info(`Bien « ${nom} » créé (${bienId}) dans la structure ${sid}.`);
      return { bienId, structureId: sid };
    })();
  });

  r.patch('/biens/:bienId', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const actuel = bien(ctx.db, ctx.bienId);
    const modifie = {
      nom: l.texte('nom', { max: 120, defaut: actuel.nom }),
      commune: l.texte('commune', { max: 120, defaut: actuel.commune }),
      codePostal: l.texte('codePostal', { max: 10, defaut: actuel.codePostal }),
      adresse: l.texte('adresse', { max: 240, defaut: actuel.adresse }),
      type: l.choix<TypeBien>('type', TYPES, { defaut: actuel.type }),
      couchages: l.entier('couchages', { min: 1, max: 100, defaut: actuel.couchages }),
      locationActivee: l.booleen('locationActivee', actuel.locationActivee),
      notes: l.texte('notes', { max: 1000, defaut: actuel.notes }),
    };
    l.fin();
    modifierBien(ctx.db, ctx.bienId, modifie);
    return bien(ctx.db, ctx.bienId);
  });

  /**
   * Retirer un bien l'archive. Rien n'est effacé : séjours et documents restent
   * consultables en lecture seule, et l'action est réversible. C'est le
   * comportement en deux temps de la maquette, et il vaut mieux que n'importe
   * quelle boîte de dialogue de confirmation.
   */
  r.post('/biens/:bienId/archivage', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const archiver = lire(ctx.corps).booleen('archiver', true);
    archiverBien(ctx.db, ctx.bienId, archiver);
    log.info(`Bien ${ctx.bienId} ${archiver ? 'archivé' : 'réactivé'} par la personne ${ctx.personneId}.`);
    return undefined;
  });

  /**
   * La photo du bien. Le corps de la requête est le fichier brut : cela évite
   * une dépendance de plus pour analyser du multipart, et le navigateur sait
   * envoyer un objet File tel quel.
   */
  r.post('/biens/:bienId/photo', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const contenu = ctx.req.body;
    if (!Buffer.isBuffer(contenu)) throw invalide('Aucun fichier reçu.');
    const nom = String(ctx.req.headers['x-nom-fichier'] || 'photo').slice(0, 200);
    const d = deposer(ctx.db, contenu, nom, ctx.personneId, parametre<number>(ctx.db, 'fichierTailleMaxMo'));
    if (!d.fichier.mime.startsWith('image/')) throw invalide('Une image est attendue.');
    modifierBien(ctx.db, ctx.bienId, { photoFichierId: d.fichier.id });
    return { fichierId: d.fichier.id };
  });

  // ---------- Structures et détentions ----------

  r.get('/structures/:structureId', { acces: 'structure', role: 'membre_foyer' }, (ctx) => {
    const s = structure(ctx.db, ctx.structureId);
    const role = ctx.portee.structures.get(ctx.structureId);
    // Le conjoint d'un indivisaire voit qui compose l'indivision, mais pas la
    // répartition chiffrée des parts tant que le réglage ne l'autorise pas :
    // c'est une information patrimoniale, d'où le défaut prudent.
    const voitParts = role !== 'membre_foyer' || parametre<boolean>(ctx.db, 'membreFoyerVoitParts');
    const detenteurs = detenteursALaDate(ctx.db, ctx.structureId, aujourdhui());
    return {
      structure: s,
      vocabulaire: VOCABULAIRE[s.mode],
      regles: reglesDe(ctx.db, ctx.structureId),
      detenteurs: detenteurs.map((d) => voitParts ? d : { ...d, parts: 0, total: 0, quotePart: '' }),
      partsVisibles: voitParts,
    };
  });

  /** L'historique complet des détentions : qui détenait quoi, et depuis quand. */
  r.get('/structures/:structureId/detentions', { acces: 'structure', role: 'detenteur' }, (ctx) => {
    const lignes = detentionsDe(ctx.db, ctx.structureId);
    const noms = new Map((personnes(ctx.db)).map((p) => [p.id, p.nom]));
    return {
      lignes: lignes.map((l) => ({ ...l, nom: noms.get(l.personneId) ?? 'Personne retirée' })),
      actuelle: [...partsALaDate(lignes, aujourdhui()).parts].map(([personneId, parts]) => ({
        personneId, nom: noms.get(personneId) ?? '', parts,
      })),
    };
  });

  /**
   * Changer la répartition, avec une date d'effet.
   *
   * Rien n'est écrasé : les lignes en vigueur sont fermées à cette date et de
   * nouvelles sont ouvertes. Une dépense antérieure garde donc la ventilation
   * calculée avec les parts d'alors, et c'est exactement ce qu'on veut le jour
   * où une succession change tout.
   */
  r.post('/structures/:structureId/detentions', { acces: 'structure', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const dateEffet = l.date('dateEffet');
    const motif = l.texte('motif', { max: 240 });
    l.fin();

    const brut = (ctx.corps as { parts?: unknown }).parts;
    if (!Array.isArray(brut) || !brut.length) {
      throw invalide('Indiquez au moins une personne et ses parts.', { parts: 'Répartition vide.' });
    }
    const nouvelles = new Map<number, number>();
    for (const ligne of brut as { personneId?: unknown; parts?: unknown }[]) {
      const pid = Number(ligne.personneId), parts = Number(ligne.parts);
      if (!Number.isInteger(pid) || pid <= 0) throw invalide('Une personne de la répartition est invalide.');
      if (!Number.isInteger(parts) || parts <= 0) {
        throw invalide('Les parts doivent être des nombres entiers strictement positifs. Pour retirer quelqu\'un, ne l\'inscrivez pas dans la nouvelle répartition.');
      }
      if (nouvelles.has(pid)) throw invalide('Une même personne apparaît deux fois dans la répartition.');
      nouvelles.set(pid, parts);
    }

    changerDetentions(ctx.db, ctx.structureId, nouvelles, dateEffet, motif, ctx.personneId);
    log.info(`Détentions de la structure ${ctx.structureId} modifiées au ${dateEffet} par la personne ${ctx.personneId} : ${motif}`);
    return undefined;
  });

  // ---------- Personnes et foyers ----------

  r.get('/personnes', { acces: 'gerant' }, (ctx) => personnes(ctx.db));
  r.get('/foyers', { acces: 'gerant' }, (ctx) => foyers(ctx.db));

  r.post('/foyers', { acces: 'gerant' }, (ctx) => {
    const nom = lire(ctx.corps).texte('nom', { max: 120 });
    return { id: creerFoyer(ctx.db, nom) };
  });

  /**
   * Créer une personne. Le mot de passe n'est pas saisi ici : la personne le
   * choisit elle-même par le lien « mot de passe oublié », ce qui évite qu'un
   * gérant connaisse le mot de passe de quelqu'un d'autre.
   */
  r.post('/personnes', { acces: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const nom = l.texte('nom', { max: 120 });
    const email = l.texte('email', { max: 200, defaut: '' }).toLowerCase();
    const foyerId = l.idFacultatif('foyerId');
    l.fin();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
      throw invalide('Cette adresse de courriel ne semble pas valide.', { email: 'Adresse invalide.' });
    }
    const id = creerPersonne(ctx.db, nom, email || null, foyerId, null, ctx.personneId);
    log.info(`Personne « ${nom} » créée (${id}) par la personne ${ctx.personneId}.`);
    return { id };
  });

  /** Attribuer un rôle sur une structure. La détention suffit pour être détenteur. */
  r.post('/structures/:structureId/roles', { acces: 'structure', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const personneId = l.entier('personneId', { min: 1 });
    const role = l.choix('role', ['gerant', 'detenteur', 'membre_foyer', 'invite'] as const);
    l.fin();
    if (role === 'gerant') {
      // Une instance dont le seul gérant perd son accès n'a plus de porte
      // d'entrée. Le contrôle inverse (retirer le dernier gérant) vit au même
      // endroit quand cette route saura retirer un rôle.
      log.info(`Rôle gérant attribué à la personne ${personneId} sur la structure ${ctx.structureId}.`);
    }
    attribuerRole(ctx.db, personneId, { structureId: ctx.structureId }, role, aujourdhui(), ctx.personneId);
    return undefined;
  });

  return r;
}
