// Le coffre-fort : documents versionnés et codes chiffrés.
//
// Notes de comportement de la maquette, reprises telles quelles :
//
//   - « Deux natures d'éléments : documents versionnés et codes chiffrés. »
//   - « La portée détermine qui voit quoi : indivisaires seuls, tous les
//     membres, ou locataire pendant son séjour. »
//   - « L'affichage d'un code est journalisé avec l'auteur et l'horodatage. »
//   - « Export complet des documents en une archive, à tout moment, sans
//     verrouillage. »
//
// **La règle qui commande tout ce fichier** vient du brief : « Un code d'accès
// affiché à quelqu'un dont le séjour est terminé est une faille. » Elle est
// appliquée par `coffre/portee.ts`, testée seule, et rien ici ne la contourne :
// aucune route ne rend une valeur de code sans passer par `afficherCode`, qui
// vérifie la portée et journalise dans la même transaction.
import { Deps, Routeur } from '../noyau/http';
import { aujourdhui } from '../noyau/dates';
import { etatInvalide } from '../noyau/erreurs';
import { lire } from '../noyau/valider';
import { parametre } from '../parametres/repo';
import { deposer as deposerFichier } from '../stockage/fichiers';
import { CodeIllisible, CoffreVerrouille, disponible, ouvrir } from './chiffrement';
import { LIBELLE_PORTEE, PORTEES, PorteeElement, RoleSurBien } from './portee';
import type { Fenetre } from './portee';
import {
  affichages, afficherCode, ajouterVersion, archiverCode, archiverDocument, changerPorteeDocument,
  codes, creerCode, creerDocument, demandeur, document, documents, modifierCode, versions,
} from './repo';

export function routesCoffre(deps: Deps): Routeur {
  const r = new Routeur('coffre', deps);

  // Ouvert une fois : dériver la clé à chaque requête coûterait un SHA-256 pour
  // rien, et une clé qui change en cours de route serait un bug, pas un cas.
  const coffre = ouvrir(deps.config.cleCoffre);

  /** La fenêtre autour du séjour, réglable et lue une fois par requête. */
  const fenetre = (db: Parameters<typeof parametre>[0]): Fenetre => ({
    avant: parametre<number>(db, 'codesAvantSejourJours'),
    apres: parametre<number>(db, 'codesApresSejourJours'),
  });

  const roleIci = (ctx: { portee: { biens: Map<number, string> }; bienId: number }): RoleSurBien =>
    (ctx.portee.biens.get(ctx.bienId) ?? 'invite') as RoleSurBien;

  /**
   * Le coffre d'un bien. Documents et codes, filtrés **en SQL** sur les portées
   * visibles : ce qui n'est pas visible n'est pas lu, et pas seulement pas
   * affiché.
   */
  r.get('/biens/:bienId/coffre', { acces: 'bien', role: 'invite' }, (ctx) => {
    const d = demandeur(ctx.db, ctx.bienId, ctx.personneId, roleIci(ctx));
    const jour = aujourdhui();
    const f = fenetre(ctx.db);
    return {
      documents: documents(ctx.db, ctx.bienId, d, jour, f),
      codes: codes(ctx.db, ctx.bienId, d, jour, f),
      // L'écran doit pouvoir dire « le coffre est verrouillé » plutôt que
      // laisser un bouton qui échouera.
      coffreDisponible: disponible(coffre),
      portees: PORTEES.map((p) => ({ cle: p, libelle: LIBELLE_PORTEE[p] })),
      peutDeposer: roleIci(ctx) === 'gerant',
    };
  });

  r.get('/biens/:bienId/coffre/documents/:documentId', { acces: 'bien', role: 'invite' }, (ctx) => {
    const d = demandeur(ctx.db, ctx.bienId, ctx.personneId, roleIci(ctx));
    const id = Number(ctx.req.params.documentId);
    const doc = document(ctx.db, ctx.bienId, id, d, aujourdhui(), fenetre(ctx.db));
    return { document: doc, versions: versions(ctx.db, id) };
  });

  r.post('/biens/:bienId/coffre/fichier', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const nom = l.texte('nom', { max: 255 });
    const contenu = l.texte('contenu', { max: 30_000_000 });
    l.fin();
    const d = deposerFichier(ctx.db, Buffer.from(contenu, 'base64'), nom, ctx.personneId,
      parametre<number>(ctx.db, 'fichierTailleMaxMo'));
    return { id: d.fichier.id, mime: d.fichier.mime, taille: d.fichier.taille };
  });

  r.post('/biens/:bienId/coffre/documents', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const nom = l.texte('nom', { max: 200 });
    const portee = l.choix<PorteeElement>('portee', PORTEES);
    const note = l.texte('note', { max: 1000, defaut: '' });
    const fichierId = l.texte('fichierId', { max: 64 });
    l.fin();
    return { id: creerDocument(ctx.db, ctx.bienId, { nom, portee, note, fichierId }, ctx.personneId) };
  });

  /** Déposer à nouveau ajoute une version, il n'écrase jamais. */
  r.post('/biens/:bienId/coffre/documents/:documentId/version', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const fichierId = l.texte('fichierId', { max: 64 });
    const note = l.texte('note', { max: 1000, defaut: '' });
    l.fin();
    return { version: ajouterVersion(ctx.db, ctx.bienId, Number(ctx.req.params.documentId), fichierId, note, ctx.personneId) };
  });

  r.post('/biens/:bienId/coffre/documents/:documentId/portee', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const portee = l.choix<PorteeElement>('portee', PORTEES);
    l.fin();
    changerPorteeDocument(ctx.db, ctx.bienId, Number(ctx.req.params.documentId), portee, ctx.personneId);
    return undefined;
  });

  r.post('/biens/:bienId/coffre/documents/:documentId/archivage', { acces: 'bien', role: 'gerant' }, (ctx) => {
    archiverDocument(ctx.db, ctx.bienId, Number(ctx.req.params.documentId));
    return undefined;
  });

  // ---------- Codes ----------

  r.post('/biens/:bienId/coffre/codes', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const libelle = l.texte('libelle', { max: 200 });
    const valeur = l.texte('valeur', { max: 500, min: 1 });
    const portee = l.choix<PorteeElement>('portee', PORTEES);
    const note = l.texte('note', { max: 1000, defaut: '' });
    l.fin();
    try {
      return { id: creerCode(ctx.db, coffre, ctx.bienId, { libelle, valeur, portee, note }, ctx.personneId) };
    } catch (e) {
      if (e instanceof CoffreVerrouille) throw etatInvalide(e.message);
      throw e;
    }
  });

  r.post('/biens/:bienId/coffre/codes/:codeId', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const libelle = l.texte('libelle', { max: 200 });
    // Vide veut dire « ne change pas la valeur » : rouvrir l'écran pour changer
    // seulement la portée ne doit pas obliger à ressaisir le code.
    const valeur = l.texte('valeur', { max: 500, defaut: '' });
    const portee = l.choix<PorteeElement>('portee', PORTEES);
    const note = l.texte('note', { max: 1000, defaut: '' });
    l.fin();
    try {
      modifierCode(ctx.db, coffre, ctx.bienId, Number(ctx.req.params.codeId),
        { libelle, valeur: valeur || null, portee, note }, ctx.personneId);
    } catch (e) {
      if (e instanceof CoffreVerrouille) throw etatInvalide(e.message);
      throw e;
    }
    return undefined;
  });

  /**
   * Afficher un code. **C'est la seule route qui rend une valeur en clair**, et
   * elle journalise dans la même transaction que la lecture. Verbe POST, et pas
   * GET, précisément parce qu'elle écrit : un GET journalisé serait rejoué par
   * un préchargement de navigateur et polluerait la trace.
   */
  r.post('/biens/:bienId/coffre/codes/:codeId/affichage', { acces: 'bien', role: 'invite' }, (ctx) => {
    const d = demandeur(ctx.db, ctx.bienId, ctx.personneId, roleIci(ctx));
    try {
      return afficherCode(ctx.db, coffre, ctx.bienId, Number(ctx.req.params.codeId), d,
        ctx.personneId, ctx.ip, aujourdhui(), fenetre(ctx.db));
    } catch (e) {
      if (e instanceof CoffreVerrouille || e instanceof CodeIllisible) throw etatInvalide(e.message);
      throw e;
    }
  });

  /** « Qui a vu ce code, et quand. » Réservé au gérant : c'est un journal. */
  r.get('/biens/:bienId/coffre/codes/:codeId/affichages', { acces: 'bien', role: 'gerant' }, (ctx) =>
    affichages(ctx.db, ctx.bienId, Number(ctx.req.params.codeId)));

  r.post('/biens/:bienId/coffre/codes/:codeId/archivage', { acces: 'bien', role: 'gerant' }, (ctx) => {
    archiverCode(ctx.db, ctx.bienId, Number(ctx.req.params.codeId));
    return undefined;
  });

  return r;
}
