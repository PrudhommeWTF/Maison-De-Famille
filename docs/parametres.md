# Réglages

Engendré depuis `backend/src/parametres/registre.ts`. Ne pas modifier à la main :
régénérer avec `cd backend && npm run docs:parametres`.

La portée dit qui écrit le réglage et sur quoi il s'applique :

| Portée | Qui écrit | Sur quoi |
| --- | --- | --- |
| Serveur | variable d'environnement | tout le service, en lecture seule dans l'interface |
| Instance | un gérant | toute la famille |
| Structure | un gérant | une indivision ou une SCI |
| Bien | le gérant du bien | un seul bien |
| Personnel | chacun pour soi | soi-même uniquement |

## Général

Identité de l'instance et affichage.

### Nom de l'instance

- **Clé** : `instanceNom`
- **Portée** : Instance
- **Par défaut** : `Maison de Famille`

Apparaît dans l'objet des courriels et dans l'en-tête de l'application. Utile quand plusieurs familles hébergent la même application sur le même réseau.

### Jours fériés d'Alsace-Moselle

- **Clé** : `feriesAlsaceMoselle`
- **Portée** : Instance
- **Par défaut** : Non

Ajoute le Vendredi saint et le 26 décembre, fériés dans le Bas-Rhin, le Haut-Rhin et la Moselle. À laisser éteint ailleurs : afficher deux fériés qui n'en sont pas ferait rater un jour de travail.

### Télécharger le calendrier scolaire depuis data.education.gouv.fr

- **Clé** : `vacancesTelechargement`
- **Portée** : Instance
- **Par défaut** : Non

Ajoute un bouton qui va chercher le calendrier officiel en ligne, au lieu de le déposer à la main. C'est le seul appel réseau sortant de l'application en dehors du relais de courriel : il faut que ce serveur ait le droit de sortir sur Internet, et l'instance signale alors son existence au portail. Rien n'est enregistré sans qu'un gérant relise l'aperçu.

### Commencer la semaine le dimanche

- **Clé** : `semaineCommenceDimanche`
- **Portée** : Personnel
- **Par défaut** : Non

Change la première colonne de la grille du calendrier. Chacun règle le sien, cela n'affecte personne d'autre.

## Séjours

Calendrier, conflits, capacité et quotas.

### Refuser une demande qui dépasse les couchages

- **Clé** : `capaciteBloquante`
- **Portée** : Bien
- **Par défaut** : Non

Quand ce réglage est actif, une demande dont le nombre d'occupants dépasse la capacité du bien ne peut pas être envoyée. Sinon elle part avec un avertissement, et la gérante tranche.

### Signaler le dépassement de quota

- **Clé** : `quotaAvertissement`
- **Portée** : Bien
- **Par défaut** : Oui

Affiche un avertissement quand un foyer demande plus de nuits que son quota de la saison. Le quota reste indicatif : la gérante peut toujours valider, et le dépassement est enregistré dans le journal.

## Sécurité

Second facteur et visibilité des informations sensibles.

### Second facteur obligatoire pour les gérants

- **Clé** : `totpObligatoirePourGerant`
- **Portée** : Instance
- **Par défaut** : Non

Un gérant qui n'a pas activé le second facteur ne peut plus se connecter tant qu'il ne l'a pas fait. À n'activer qu'une fois que chaque gérant a imprimé ses codes de secours : sans cela, vous vous verrouillez dehors.

### Les membres de foyer voient les dépenses

- **Clé** : `membreFoyerVoitDepenses`
- **Portée** : Instance
- **Par défaut** : Non

Quand ce réglage est inactif, le conjoint d'un indivisaire ne voit ni la liste des dépenses ni les soldes des autres foyers. Le défaut est prudent : sinon un conjoint découvrirait le montant de la taxe foncière avant l'indivisaire concerné.

### Les membres de foyer voient les quotes-parts

- **Clé** : `membreFoyerVoitParts`
- **Portée** : Instance
- **Par défaut** : Non

Quand ce réglage est inactif, le conjoint d'un indivisaire voit qui compose l'indivision mais pas la répartition chiffrée des parts. C'est une information patrimoniale, d'où le défaut prudent.

### Jours d'avance sur un code de séjour

- **Clé** : `codesAvantSejourJours`
- **Portée** : Instance
- **Par défaut** : `2`
- **Bornes** : de 0 à 30

Combien de jours avant l'arrivée un code de portée « pendant le séjour » devient visible. On prépare un départ à l'avance, et un code reçu la veille au soir ne sert à rien quand on roule de nuit. Zéro ferme la fenêtre jusqu'au jour d'arrivée.

### Jours de grâce après un départ

- **Clé** : `codesApresSejourJours`
- **Portée** : Instance
- **Par défaut** : `0`
- **Bornes** : de 0 à 30

Combien de jours après le départ un code de portée « pendant le séjour » reste visible. Zéro par défaut, et c'est le point : un code d'accès affiché à quelqu'un dont le séjour est terminé est une faille. Le jour du départ lui-même reste toujours ouvert, il faut bien refermer derrière soi.

## Courriel

Envoi des notifications et reprise en cas de panne.

### Envoyer les notifications par courriel

- **Clé** : `notificationsActives`
- **Portée** : Instance
- **Par défaut** : Oui

Interrupteur général. Désactivé, les notifications continuent d'être enregistrées mais ne partent pas : utile pendant une reprise de données pour ne pas inonder la famille.

### Tentatives avant abandon

- **Clé** : `notificationsTentativesMax`
- **Portée** : Instance
- **Par défaut** : `5`
- **Bornes** : de 1 à 20

Nombre d'essais d'envoi avant qu'une notification soit marquée abandonnée. Chaque échec double l'attente avant l'essai suivant. Une notification abandonnée reste visible dans l'écran d'état, avec l'erreur exacte du relais.

## Fichiers

Photos et pièces jointes.

### Taille maximale d'un fichier (Mo)

- **Clé** : `fichierTailleMaxMo`
- **Portée** : Instance
- **Par défaut** : `15`
- **Bornes** : de 1 à 100

S'applique aux photos et aux pièces jointes. Une photo de téléphone récente pèse entre 3 et 8 Mo. Monter cette valeur consomme l'espace disque du conteneur.

## Exploitation

Journalisation et diagnostic.

### Vérifier les nouvelles versions sur GitHub

- **Clé** : `majVerification`
- **Portée** : Instance
- **Par défaut** : Non

Ajoute à l'écran « État du service » un bouton qui demande à GitHub s'il existe une version plus récente. C'est un appel réseau sortant : il faut que ce serveur ait le droit de sortir sur Internet. Rien ne s'installe tout seul, et l'installation demande en plus votre mot de passe.

### Niveau de journalisation

- **Clé** : `journalNiveau`
- **Portée** : Instance
- **Par défaut** : `info`
- **Valeurs** : Erreurs seulement (`erreur`), Normal (`info`), Détaillé (`debug`)

Prend effet immédiatement, sans redémarrage : « journalctl -f -u maison-de-famille » change de verbosité pendant qu'on le regarde. « debug » est bavard, à n'allumer que pour comprendre un cas précis.
