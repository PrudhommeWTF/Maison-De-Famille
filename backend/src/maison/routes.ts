// La fiche du bien et son carnet d'adresses.
//
// Note de comportement de la maquette : « Un bien porte ses caractéristiques,
// son guide d'arrivée, son inventaire et sa capacité, utilisée par la détection
// de conflit », et « le guide d'arrivée est visible des membres de foyer et des
// locataires pendant leur séjour ».
//
// **Le carnet d'adresses** est la seule fonction du service de référence que le
// brief n'avait pas listée et qui méritait d'être reprise. Cinq champs, pas un
// de plus. Il sert le jour où la chaudière lâche pendant le séjour de quelqu'un
// qui ne connaît pas le plombier : ce jour-là, chercher le numéro dans les
// messages de sa mère est exactement ce que l'application doit éviter.
//
// La portée du carnet est « membres » : un invité de passage n'a pas besoin du
// numéro du notaire, mais un membre de foyer qui garde la maison en a besoin
// tout de suite, sans demander à personne.
import { Deps, Routeur } from '../noyau/http';
import { horodatage } from '../noyau/dates';
import { introuvable } from '../noyau/erreurs';
import { lire } from '../noyau/valider';

export type RoleContact = 'artisan' | 'voisin' | 'mairie' | 'urgence' | 'autre';
const ROLES: readonly RoleContact[] = ['artisan', 'voisin', 'mairie', 'urgence', 'autre'];

export const LIBELLE_ROLE: Record<RoleContact, string> = {
  artisan: 'Artisan', voisin: 'Voisin', mairie: 'Mairie et services',
  urgence: 'Urgence', autre: 'Autre',
};

type Section = 'caracteristique' | 'guide';
const SECTIONS: readonly Section[] = ['caracteristique', 'guide'];

export function routesMaison(deps: Deps): Routeur {
  const r = new Routeur('maison', deps);

  /**
   * La fiche complète : caractéristiques et guide d'arrivée.
   *
   * Ouverte aux invités, contrairement au reste : un locataire qui arrive à
   * vingt-deux heures a besoin de savoir où est la vanne d'eau. Ce que la fiche
   * ne contient jamais, ce sont les codes, qui vivent au coffre-fort avec leur
   * propre portée et leur propre journal.
   */
  r.get('/biens/:bienId/fiche', { acces: 'bien', role: 'invite' }, (ctx) => {
    const lignes = ctx.db.prepare(
      `SELECT id, section, cle, valeur, ordre FROM fiche_ligne
       WHERE bien_id = ? AND archive_le IS NULL ORDER BY section, ordre, id`,
    ).all(ctx.bienId) as { id: number; section: Section; cle: string; valeur: string; ordre: number }[];
    return {
      caracteristiques: lignes.filter((l) => l.section === 'caracteristique'),
      guide: lignes.filter((l) => l.section === 'guide'),
      peutModifier: ctx.portee.biens.get(ctx.bienId) === 'gerant',
    };
  });

  r.post('/biens/:bienId/fiche', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const section = l.choix<Section>('section', SECTIONS);
    const cle = l.texte('cle', { max: 100 });
    const valeur = l.texte('valeur', { max: 2000, defaut: '' });
    const ordre = l.entierFacultatif('ordre', { min: 0, max: 9999 });
    l.fin();
    return { id: Number(ctx.db.prepare(
      'INSERT INTO fiche_ligne (bien_id, section, cle, valeur, ordre, cree_le) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(ctx.bienId, section, cle, valeur, ordre ?? 0, horodatage()).lastInsertRowid) };
  });

  r.post('/biens/:bienId/fiche/:ligneId', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const cle = l.texte('cle', { max: 100 });
    const valeur = l.texte('valeur', { max: 2000, defaut: '' });
    l.fin();
    const id = Number(ctx.req.params.ligneId);
    const existe = ctx.db.prepare('SELECT id FROM fiche_ligne WHERE id = ? AND bien_id = ? AND archive_le IS NULL')
      .get(id, ctx.bienId);
    if (!existe) throw introuvable('Cette ligne de fiche');
    ctx.db.prepare('UPDATE fiche_ligne SET cle = ?, valeur = ? WHERE id = ?').run(cle, valeur, id);
    return undefined;
  });

  r.post('/biens/:bienId/fiche/:ligneId/archivage', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const id = Number(ctx.req.params.ligneId);
    const existe = ctx.db.prepare('SELECT id FROM fiche_ligne WHERE id = ? AND bien_id = ? AND archive_le IS NULL')
      .get(id, ctx.bienId);
    if (!existe) throw introuvable('Cette ligne de fiche');
    ctx.db.prepare('UPDATE fiche_ligne SET archive_le = ? WHERE id = ?').run(horodatage(), id);
    return undefined;
  });

  // ---------- Carnet d'adresses ----------

  r.get('/biens/:bienId/contacts', { acces: 'bien', role: 'membre_foyer' }, (ctx) => ({
    contacts: ctx.db.prepare(
      `SELECT id, nom, role, telephone, email, notes FROM contact
       WHERE bien_id = ? AND archive_le IS NULL
       ORDER BY CASE role WHEN 'urgence' THEN 0 WHEN 'artisan' THEN 1 WHEN 'voisin' THEN 2
                          WHEN 'mairie' THEN 3 ELSE 4 END, nom`,
    ).all(ctx.bienId),
    roles: ROLES.map((x) => ({ cle: x, libelle: LIBELLE_ROLE[x] })),
    peutModifier: ctx.portee.biens.get(ctx.bienId) === 'gerant',
  }));

  r.post('/biens/:bienId/contacts', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const nom = l.texte('nom', { max: 200 });
    const role = l.choix<RoleContact>('role', ROLES);
    const telephone = l.texte('telephone', { max: 40, defaut: '' });
    const email = l.texte('email', { max: 200, defaut: '' });
    const notes = l.texte('notes', { max: 2000, defaut: '' });
    l.fin();
    return { id: Number(ctx.db.prepare(
      `INSERT INTO contact (bien_id, nom, role, telephone, email, notes, cree_le, cree_par)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(ctx.bienId, nom, role, telephone, email, notes, horodatage(), ctx.personneId).lastInsertRowid) };
  });

  r.post('/biens/:bienId/contacts/:contactId', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const l = lire(ctx.corps);
    const nom = l.texte('nom', { max: 200 });
    const role = l.choix<RoleContact>('role', ROLES);
    const telephone = l.texte('telephone', { max: 40, defaut: '' });
    const email = l.texte('email', { max: 200, defaut: '' });
    const notes = l.texte('notes', { max: 2000, defaut: '' });
    l.fin();
    const id = Number(ctx.req.params.contactId);
    const existe = ctx.db.prepare('SELECT id FROM contact WHERE id = ? AND bien_id = ? AND archive_le IS NULL')
      .get(id, ctx.bienId);
    if (!existe) throw introuvable('Ce contact');
    ctx.db.prepare('UPDATE contact SET nom = ?, role = ?, telephone = ?, email = ?, notes = ? WHERE id = ?')
      .run(nom, role, telephone, email, notes, id);
    return undefined;
  });

  r.post('/biens/:bienId/contacts/:contactId/archivage', { acces: 'bien', role: 'gerant' }, (ctx) => {
    const id = Number(ctx.req.params.contactId);
    const existe = ctx.db.prepare('SELECT id FROM contact WHERE id = ? AND bien_id = ? AND archive_le IS NULL')
      .get(id, ctx.bienId);
    if (!existe) throw introuvable('Ce contact');
    ctx.db.prepare('UPDATE contact SET archive_le = ? WHERE id = ?').run(horodatage(), id);
    return undefined;
  });

  return r;
}
