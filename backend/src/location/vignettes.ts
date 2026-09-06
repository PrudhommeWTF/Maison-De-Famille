// Les vignettes des albums, engendrées côté serveur.
//
// **Pourquoi ce n'est pas facultatif.** Un album de vingt photos de téléphone
// pèse cent méga-octets. Ouvert sur un portable au fond d'une vallée, il ne
// s'affiche jamais, et la famille cesse de déposer des photos. Une vignette de
// quatre-vingts kilo-octets change complètement l'usage.
//
// **Le choix de la dépendance, dit franchement.** Le réflexe serait `sharp`,
// qui est excellent et rapide. C'est aussi trente méga-octets de binaires
// natifs, qui se recompilent parfois, et qui échouent d'une façon très
// désagréable à comprendre dans un conteneur LXC minimal, un dimanche soir.
// Le brief demande explicitement de ne pas ajouter de dépendance lourde, et
// surtout de pouvoir dépanner l'application à trois heures du matin.
//
// On prend donc deux bibliothèques **purement JavaScript**, sans aucune
// dépendance transitive et sans code natif : `jpeg-js` (76 Ko) pour décoder et
// réencoder le JPEG, `pngjs` (650 Ko) pour décoder le PNG. Elles sont plus
// lentes que `sharp`, d'un ordre de grandeur. C'est sans importance : une
// vignette se fabrique **une fois, au dépôt**, et jamais à l'affichage.
//
// **Ce qui n'a pas de vignette, et pourquoi.** WEBP et GIF n'ont pas de
// décodeur purement JavaScript qui soit petit. Ces fichiers sont servis tels
// quels, et l'écran s'en accommode. Plutôt que d'ajouter deux dépendances pour
// un cas rare, l'application le dit et passe.
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { log } from '../noyau/log';

/** Le côté le plus long d'une vignette, en pixels. */
export const COTE_VIGNETTE = 420;

/** La qualité de réencodage. 72 est le point où l'oeil ne voit plus la perte. */
const QUALITE = 72;

/**
 * Au-delà, on ne décode pas : une image de 12 000 par 12 000 pixels réclame
 * 576 Mo rien qu'en mémoire tampon, et une seule suffirait à faire tomber le
 * service. C'est la même prudence que le garde anti-bombe de l'import ZIP.
 */
const PIXELS_MAX = 40_000_000;

export interface Image {
  largeur: number;
  hauteur: number;
  /** RGBA, quatre octets par pixel. */
  donnees: Buffer;
}

export class VignetteImpossible extends Error {}

function decoder(contenu: Buffer, mime: string): Image | null {
  try {
    if (mime === 'image/jpeg') {
      const b = jpeg.decode(contenu, { useTArray: true, maxMemoryUsageInMB: 512 });
      if (b.width * b.height > PIXELS_MAX) throw new VignetteImpossible('Image trop grande.');
      return { largeur: b.width, hauteur: b.height, donnees: Buffer.from(b.data) };
    }
    if (mime === 'image/png') {
      const p = PNG.sync.read(contenu);
      if (p.width * p.height > PIXELS_MAX) throw new VignetteImpossible('Image trop grande.');
      return { largeur: p.width, hauteur: p.height, donnees: Buffer.from(p.data) };
    }
  } catch (e) {
    // Une image que la bibliothèque refuse de lire n'est pas une panne du
    // service : la photo est déposée quand même, elle n'aura pas de vignette.
    log.debug(`Décodage impossible pour une vignette (${mime}) : ${e instanceof Error ? e.message : e}`);
  }
  return null;
}

/**
 * Réduction par moyenne de boîte.
 *
 * Le voisin le plus proche serait deux lignes de moins et donnerait un résultat
 * crénelé, très visible sur les photos de bord de mer où les mâts et les
 * ardoises produisent du moiré. La moyenne coûte quelques millisecondes de plus
 * et rend une image propre, ce qui est le seul but de l'opération.
 */
export function reduire(src: Image, cote = COTE_VIGNETTE): Image {
  const facteur = Math.max(src.largeur, src.hauteur) / cote;
  if (facteur <= 1) return src;
  const largeur = Math.max(1, Math.round(src.largeur / facteur));
  const hauteur = Math.max(1, Math.round(src.hauteur / facteur));
  const out = Buffer.alloc(largeur * hauteur * 4);

  for (let y = 0; y < hauteur; y++) {
    const y0 = Math.floor((y * src.hauteur) / hauteur);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * src.hauteur) / hauteur));
    for (let x = 0; x < largeur; x++) {
      const x0 = Math.floor((x * src.largeur) / largeur);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * src.largeur) / largeur));
      let r = 0, v = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        let i = (sy * src.largeur + x0) * 4;
        for (let sx = x0; sx < x1; sx++, i += 4) {
          r += src.donnees[i]; v += src.donnees[i + 1]; b += src.donnees[i + 2]; a += src.donnees[i + 3];
          n++;
        }
      }
      const j = (y * largeur + x) * 4;
      out[j] = Math.round(r / n);
      out[j + 1] = Math.round(v / n);
      out[j + 2] = Math.round(b / n);
      out[j + 3] = Math.round(a / n);
    }
  }
  return { largeur, hauteur, donnees: out };
}

export interface Vignette { contenu: Buffer; mime: string; largeur: number; hauteur: number }

/**
 * Fabrique la vignette d'une image, ou rend null quand ce n'est pas possible.
 *
 * **Ne lève jamais.** Une photo dont la vignette échoue doit être déposée quand
 * même : perdre le souvenir parce que la miniature a raté serait absurde.
 */
export function fabriquer(contenu: Buffer, mime: string, cote = COTE_VIGNETTE): Vignette | null {
  const src = decoder(contenu, mime);
  if (!src) return null;
  try {
    const petite = reduire(src, cote);
    // Toujours du JPEG en sortie, même depuis un PNG : sur une photo, le JPEG
    // est cinq à dix fois plus petit, et c'est tout l'intérêt de l'opération.
    const encode = jpeg.encode(
      { data: petite.donnees, width: petite.largeur, height: petite.hauteur }, QUALITE);
    return {
      contenu: Buffer.from(encode.data), mime: 'image/jpeg',
      largeur: petite.largeur, hauteur: petite.hauteur,
    };
  } catch (e) {
    log.debug(`Encodage de vignette impossible : ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** Les types dont on sait faire une vignette. Sert à l'écran et aux messages. */
export const VIGNETTABLE: readonly string[] = ['image/jpeg', 'image/png'];
