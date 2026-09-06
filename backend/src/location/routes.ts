// Location saisonnière et souvenirs.
//
// Notes de comportement de la maquette, reprises telles quelles :
//
//   - « La location est activable par bien : seule Kerloc'h l'a activée ici. »
//   - « Les semaines famille sont posées avant l'ouverture à la location ;
//     l'inverse déclenche une alerte. »
//   - « Le loyer net se calcule après déduction des charges directement liées
//     à la location. »
//   - « Un album par séjour, créé automatiquement à la fin du séjour. »
//   - « Tout membre de foyer peut déposer des photos ; seul l'auteur ou la
//     gérante peut supprimer. »
//
// **« Activable par bien » se prend au mot.** Sur un bien dont la location
// n'est pas activée, les routes ne répondent pas 200 avec une liste vide :
// elles refusent, en disant que le module n'est pas activé et où l'activer. Une
// route qui répondrait « rien à voir » laisserait croire qu'il n'y a pas encore
// de réservation, ce qui est faux et différent.
import { Deps, Routeur } from '../noyau/http';
import { aujourdhui, estDate } from '../noyau/dates';
import { etatInvalide, invalide, refuse } from '../noyau/erreurs';
import { log } from '../noyau/log';
import { lire } from '../noyau/valider';
import { parametre } from '../parametres/repo';
import { deposer as deposerFichier } from '../stockage/fichiers';
import { bien } from '../patrimoine/repo';
import type { Db } from '../noyau/db';
import { StatutLocation, alerteSaison, exercice } from './net';
import {
  albums, ajouterPhoto, archiverPhoto, changerStatut, creerAlbum, creerReservation,
  chargesDe, ecrireMot, motsDe, photo, photos, reservations, sejoursFamilleDe,
} from './repo';

const STATUTS: readonly StatutLocation[] = ['a_confirmer', 'acompte', 'solde', 'annule'];

export function routesLocation(deps: Deps): Routeur {
  const r = new Routeur('location', deps);

  /**
   * Le garde du module. Il refuse au lieu de rendre vide : sur un bien de
   * montagne qui n'est pas loué, « aucune réservation » et « la location n'est
   * pas activée ici » ne veulent pas dire la même chose.
   */
  const exigerLocation = (db: Db, bienId: number): void => {
    if (!bien(db, bienId).locationActivee) {
      throw etatInvalide(
        `La location saisonnière n'est pas activée sur ce bien. Un gérant peut l'activer `
        + 'depuis la fiche du bien, si la famille a décidé de le louer.');
    }
  };

  // ---------- Location saisonnière ----------

  r.get('/biens/:bienId/location', { acces: 'bien', role: 'detenteur' }, (ctx) => {
    exigerLocation(ctx.db, ctx.bienId);
    const annee = Number(ctx.req.query.annee ?? aujourdhui().slice(0, 4));
    const res = reservations(ctx.db, ctx.bienId);
    const charges = chargesDe(ctx.db, ctx.bienId, annee);
    return {
      annee,
      exercice: exercice(annee, res, charges),
      reservations: res.filter((x) => estDate(x.arrivee) && Number(x.arrivee.slice(0, 4)) === annee),
      charges,
      alerte: alerteSaison(annee, res, sejoursFamilleDe(ctx.db, ctx.bienId)),
      peutModifier: ctx.portee.biens.get(ctx.bienId) === 'gerant',
    };
  });

  r.post('/biens/:bienId/location/reservations', { acces: 'bien', role: 'gerant' }, (ctx) => {
    exigerLocation(ctx.db, ctx.bienId);
    const l = lire(ctx.corps);
    const locataire = l.texte('locataire', { max: 200 });
    const email = l.texte('email', { max: 200, defaut: '' }).toLowerCase();
    const telephone = l.texte('telephone', { max: 40, defaut: '' });
    const arrivee = l.texte('arrivee', { max: 10 });
    const depart = l.texte('depart', { max: 10 });
    const occupants = l.entier('occupants', { min: 1, max: 100 });
    const loyerCents = l.entier('loyerCents', { min: 0, max: 100_000_000 });
    const acompteCents = l.entier('acompteCents', { min: 0, max: 100_000_000, defaut: 0 });
    const note = l.texte('note', { max: 2000, defaut: '' });
    l.fin();
    if (!estDate(arrivee) || !estDate(depart) || depart <= arrivee) {
      throw invalide('Les dates doivent être au format AAAA-MM-JJ, et le départ après l\'arrivée.');
    }
    if (acompteCents > loyerCents) {
      throw invalide('L\'acompte ne peut pas dépasser le loyer.');
    }
    const b = bien(ctx.db, ctx.bienId);
    if (occupants > b.couchages) {
      throw invalide(
        `${occupants} personnes pour ${b.couchages} couchages. Corrigez, ou augmentez la capacité `
        + 'dans la fiche du bien si elle a changé.');
    }
    // La réservation crée un séjour de nature « location » : c'est lui qui
    // bloque le calendrier et que la détection de conflit voit.
    return creerReservation(ctx.db, ctx.bienId, {
      locataire, email, telephone, arrivee, depart, occupants, loyerCents, acompteCents, note,
    }, ctx.personneId);
  });

  r.post('/biens/:bienId/location/reservations/:reservationId/statut', { acces: 'bien', role: 'gerant' }, (ctx) => {
    exigerLocation(ctx.db, ctx.bienId);
    const l = lire(ctx.corps);
    const statut = l.choix<StatutLocation>('statut', STATUTS);
    const acompteCents = l.entierFacultatif('acompteCents', { min: 0, max: 100_000_000 });
    l.fin();
    changerStatut(ctx.db, ctx.bienId, Number(ctx.req.params.reservationId), statut, acompteCents, ctx.personneId);
    return undefined;
  });

  // ---------- Souvenirs ----------

  /**
   * Les albums d'un bien. Ouvert aux membres de foyer : les souvenirs sont ce
   * que la famille a de plus commun, et les réserver aux détenteurs n'aurait
   * aucun sens. Un invité de passage n'y a en revanche rien à faire.
   */
  r.get('/biens/:bienId/albums', { acces: 'bien', role: 'membre_foyer' }, (ctx) => ({
    albums: albums(ctx.db, ctx.bienId),
    mots: motsDe(ctx.db, ctx.bienId),
  }));

  r.get('/biens/:bienId/albums/:albumId', { acces: 'bien', role: 'membre_foyer' }, (ctx) =>
    photos(ctx.db, ctx.bienId, Number(ctx.req.params.albumId)));

  r.post('/biens/:bienId/albums', { acces: 'bien', role: 'membre_foyer' }, (ctx) => {
    const l = lire(ctx.corps);
    const titre = l.texte('titre', { max: 200 });
    const annee = l.entier('annee', { min: 1900, max: 2200 });
    const sejourId = l.idFacultatif('sejourId');
    l.fin();
    return { id: creerAlbum(ctx.db, ctx.bienId, titre, annee, sejourId, ctx.personneId) };
  });

  /**
   * Déposer une photo. La vignette est fabriquée ici, une fois, au dépôt.
   *
   * **Le corps est le fichier**, en octets bruts, comme la photo de couverture
   * d'un bien et le justificatif d'une structure. Le base64 dans du JSON aurait
   * été plus simple à écrire, mais il gonfle de 33 % : une photo de téléphone de
   * 8 Mo passe à 11 Mo, sans compter la copie en mémoire côté serveur. Le nom et
   * la légende voyagent donc en paramètres de requête, encodés en UTF-8 par le
   * navigateur (un en-tête HTTP ne transporte pas « Été 2026.jpg » correctement).
   *
   * `bienId` vient du chemin, et il est recopié sur la photo : c'est ce qui
   * garantit qu'une photo d'un bien ne peut pas atterrir dans l'album de
   * l'autre, même si l'identifiant d'album envoyé était celui d'ailleurs.
   */
  r.post('/biens/:bienId/albums/:albumId/photos', { acces: 'bien', role: 'membre_foyer' }, (ctx) => {
    const octets = ctx.req.body;
    if (!Buffer.isBuffer(octets) || !octets.length) throw invalide('Aucune photo reçue.');
    const nom = String(ctx.req.query.nom ?? 'photo').slice(0, 255);
    const legende = String(ctx.req.query.legende ?? '').slice(0, 500);
    const d = deposerFichier(ctx.db, octets, nom, ctx.personneId,
      parametre<number>(ctx.db, 'fichierTailleMaxMo'));
    if (!d.fichier.mime.startsWith('image/')) {
      throw invalide('Un album n\'accepte que des images, pas des documents.');
    }
    return ajouterPhoto(ctx.db, ctx.bienId, Number(ctx.req.params.albumId),
      d.fichier, octets, legende, ctx.personneId);
  });

  /**
   * Supprimer une photo : « seul l'auteur ou la gérante peut supprimer ».
   * Le contrôle est ici, pas dans l'exigence de route, parce qu'il dépend de
   * qui a déposé, ce que la garde d'accès ne sait pas.
   */
  r.post('/biens/:bienId/albums/photos/:photoId/archivage', { acces: 'bien', role: 'membre_foyer' }, (ctx) => {
    const p = photo(ctx.db, ctx.bienId, Number(ctx.req.params.photoId));
    const gerant = ctx.portee.biens.get(ctx.bienId) === 'gerant';
    if (!gerant && p.deposePar !== ctx.personneId) {
      throw refuse(
        `Cette photo a été déposée par ${p.deposeParNom ?? 'quelqu\'un d\'autre'}. `
        + 'Seul son auteur ou un gérant peut la retirer.');
    }
    archiverPhoto(ctx.db, ctx.bienId, p.id);
    return undefined;
  });

  /** Le livre d'or : un fil par année. */
  r.post('/biens/:bienId/livre-or', { acces: 'bien', role: 'membre_foyer' }, (ctx) => {
    const l = lire(ctx.corps);
    const texte = l.texte('texte', { max: 4000, min: 1 });
    const signature = l.texte('signature', { max: 120, defaut: '' });
    const annee = l.entier('annee', { min: 1900, max: 2200, defaut: Number(aujourdhui().slice(0, 4)) });
    const sejourId = l.idFacultatif('sejourId');
    l.fin();
    return { id: ecrireMot(ctx.db, ctx.bienId, { texte, signature, annee, sejourId }, ctx.personneId) };
  });

  return r;
}

/**
 * Crée les albums des séjours terminés qui n'en ont pas.
 *
 * « Un album par séjour, créé automatiquement à la fin du séjour » : appelé par
 * le passage quotidien. Idempotent grâce à l'index unique sur `sejour_id`.
 */
export function creerAlbumsDesSejoursFinis(db: Db, jour = aujourdhui()): number {
  const finis = db.prepare(
    `SELECT s.id, s.bien_id AS bienId, s.titre, s.arrivee, s.depart
     FROM sejour s
     LEFT JOIN album a ON a.sejour_id = s.id
     WHERE s.statut = 'valide' AND s.archive_le IS NULL AND s.nature = 'famille'
       AND s.depart <= ? AND s.depart >= ? AND a.id IS NULL`,
  ).all(jour, `${Number(jour.slice(0, 4)) - 1}${jour.slice(4)}`) as
    { id: number; bienId: number; titre: string; arrivee: string; depart: string }[];

  let creees = 0;
  for (const s of finis) {
    const titre = s.titre || `Séjour du ${s.arrivee}`;
    creerAlbum(db, s.bienId, titre, Number(s.arrivee.slice(0, 4)), s.id, null);
    creees++;
  }
  if (creees) log.info(`${creees} album(s) de séjour créé(s).`);
  return creees;
}
