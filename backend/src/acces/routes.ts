// Qui suis-je, et que puis-je voir. Plus l'amorçage de l'instance.
//
// `/api/moi` est la première requête que fait l'application au chargement : elle
// rend l'identité, les biens visibles et le rôle sur chacun. **La barre de
// contexte de la maquette n'affiche que ce que cette route rend** : un bien
// auquel on n'est pas rattaché n'est pas caché à l'écran, il n'arrive jamais
// jusqu'au navigateur.
import { Deps, Routeur } from '../noyau/http';
import { ErreurApp } from '../noyau/erreurs';
import { aujourdhui } from '../noyau/dates';
import { log } from '../noyau/log';
import { lire } from '../noyau/valider';
import { hacher, controlerPolitique } from '../auth/mots-de-passe';
import { parametre, poser } from '../parametres/repo';
import {
  ModeStructure, TypeBien, attribuerRole, creerBien, creerFoyer,
  creerPersonne, creerStructure, instanceAmorcee, personne,
} from '../patrimoine/repo';
import { biensDeLaPortee } from './repo';
import { estGerant } from './roles';
import { compterEnAttente } from '../sejours/repo';

export function routesAcces(deps: Deps): Routeur {
  const r = new Routeur('acces', deps);

  r.get('/moi', { acces: 'authentifie' }, (ctx) => {
    const moi = personne(ctx.db, ctx.personneId);
    const totp = ctx.db.prepare('SELECT totp_secret, totp_recovery FROM personne WHERE id = ?')
      .get(ctx.personneId) as { totp_secret: string | null; totp_recovery: string };
    const biens = biensDeLaPortee(ctx.db, ctx.portee);
    const attente = compterEnAttente(ctx.db, biens.filter((b) => b.role === 'gerant').map((b) => b.id));
    return {
      personne: { id: moi.id, nom: moi.nom, email: moi.email, foyerId: moi.foyerId, foyerNom: moi.foyerNom },
      estGerant: estGerant(ctx.portee),
      // Une session limitée n'a le droit que d'activer son second facteur :
      // l'interface doit le dire clairement plutôt que d'afficher des écrans
      // qui répondront tous 403.
      sessionLimitee: ctx.limite,
      secondFacteur: {
        actif: !!totp.totp_secret,
        obligatoirePourGerant: parametre<boolean>(ctx.db, 'totpObligatoirePourGerant'),
        codesDeSecoursRestants: totp.totp_secret ? (JSON.parse(totp.totp_recovery) as string[]).length : 0,
      },
      instanceNom: parametre<string>(ctx.db, 'instanceNom'),
      semaineCommenceDimanche: parametre<boolean>(ctx.db, 'semaineCommenceDimanche', { personneId: ctx.personneId }),
      biens: biens.map((b) => ({ ...b, demandesEnAttente: attente.get(b.id) ?? 0 })),
    };
  });

  /**
   * L'amorçage. Une instance vide n'a aucun compte, donc personne ne peut se
   * connecter pour en créer un : cette route est le seul moyen de démarrer, et
   * elle se ferme définitivement dès qu'une personne existe.
   */
  r.get('/amorce', { acces: 'public' }, (ctx) => ({ amorcee: instanceAmorcee(ctx.db) }));

  r.post('/amorce', { acces: 'public' }, async (ctx) => {
    if (instanceAmorcee(ctx.db)) {
      throw new ErreurApp('CONFLIT', 'Cette instance est déjà configurée. Connectez-vous.');
    }
    const l = lire(ctx.corps);
    const nom = l.texte('nom', { max: 120 });
    const email = l.texte('email', { max: 200 }).toLowerCase();
    const motDePasse = l.texte('motDePasse', { max: 200, min: 1 });
    const foyerNom = l.texte('foyerNom', { max: 120, defaut: '' });
    const structureMode = l.choix<ModeStructure>('structureMode', ['indivision', 'sci', 'nom_propre']);
    const structureNom = l.texte('structureNom', { max: 120 });
    const bienNom = l.texte('bienNom', { max: 120 });
    const commune = l.texte('commune', { max: 120 });
    const type = l.choix<TypeBien>('type', ['mer', 'montagne', 'campagne', 'ville']);
    const couchages = l.entier('couchages', { min: 1, max: 100 });
    l.fin();
    controlerPolitique(motDePasse);

    const hash = await hacher(motDePasse);
    const resultat = ctx.db.transaction(() => {
      const foyerId = foyerNom ? creerFoyer(ctx.db, foyerNom) : null;
      const personneId = creerPersonne(ctx.db, nom, email, foyerId, hash, null);
      const structureId = creerStructure(ctx.db, structureMode, structureNom, '', personneId);
      const bienId = creerBien(ctx.db, {
        structureId, nom: bienNom, commune, codePostal: '', adresse: '',
        type, couchages, locationActivee: false, notes: '',
      }, personneId);
      attribuerRole(ctx.db, personneId, { structureId }, 'gerant', aujourdhui(), personneId);
      // Aucune détention n'est inventée ici. La répartition réelle porte une
      // date d'effet (une succession, un acte notarié) qu'aucun amorçage ne
      // peut deviner, et une ligne « 100 % au premier compte, à partir
      // d'aujourd'hui » empêcherait ensuite de saisir l'histoire réelle, qui
      // lui est antérieure. Le gérant garde l'accès par son rôle, et saisit la
      // répartition quand il l'a sous les yeux.
      return { personneId, structureId, bienId };
    })();

    log.info(`Instance amorcée : ${nom} gère ${structureNom}, premier bien « ${bienNom} ».`);
    return resultat;
  });

  r.post('/moi/parametres', { acces: 'authentifie' }, (ctx) => {
    const l = lire(ctx.corps);
    const semaineCommenceDimanche = l.booleen('semaineCommenceDimanche');
    l.fin();
    poser(ctx.db, 'semaineCommenceDimanche', semaineCommenceDimanche, { personneId: ctx.personneId }, ctx.personneId);
    return undefined;
  });

  return r;
}
