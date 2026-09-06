# Guides d'utilisation

Cette application sert à tenir une maison de famille à plusieurs : qui vient
quand, qui a payé quoi, qui doit combien, et où sont rangés les papiers.

Vous n'avez rien à installer et rien à savoir de technique. Vous recevez un
lien, vous choisissez un mot de passe, et vous vous en servez depuis un
téléphone, une tablette ou un ordinateur.

## Quel guide est pour vous

Tout le monde commence par le même :

- **[Premiers pas](premiers-pas.md)** : recevoir son invitation, choisir son mot
  de passe, se repérer dans l'écran. **À lire en premier, quel que soit votre
  rôle.**

Ensuite, prenez celui qui correspond à votre situation. En cas de doute,
regardez le tableau plus bas ou demandez à la personne qui gère la maison.

| Votre situation | Votre guide |
| --- | --- |
| Vous gérez la maison : vous arbitrez les séjours, saisissez les dépenses, tenez les papiers | **[Guide du gérant](gerant.md)** |
| Vous possédez une part de la maison (indivision, SCI) sans la gérer | **[Guide du détenteur](detenteur.md)** |
| Votre conjoint possède une part, vous venez en famille | **[Guide du membre de foyer](membre-de-foyer.md)** |
| Vous êtes locataire, ami ou artisan, et vous avez reçu un lien pour un séjour précis | **[Guide de l'invité](invite.md)** |

Pour la personne qui héberge le service sur son serveur, l'installation et les
sauvegardes sont décrites à part : voir [installation.md](../installation.md) et
[sauvegarde-restauration.md](../sauvegarde-restauration.md).

## Comment savoir quel est mon rôle

Le menu de gauche le dit sans qu'on ait à le demander : **il ne montre que ce à
quoi vous avez droit.** Comparez avec le tableau ci-dessous.

- Vous voyez **Personnes et rôles**, **Réglages** et **État du service** en haut
  du menu : vous êtes gérant.
- Vous voyez un groupe **Argent** (Dépenses, Soldes) mais pas les entrées
  ci-dessus : vous êtes détenteur.
- Vous ne voyez **pas** de groupe Argent, mais vous voyez Carnet d'entretien et
  Décisions : vous êtes membre de foyer.
- Vous ne voyez que Calendrier, Fiche du bien et Coffre-fort : vous êtes invité
  pour un séjour.

Une même personne peut être gérante d'une maison et simple membre d'une autre.
Dans ce cas, une barre en haut de l'écran permet de passer de l'une à l'autre, et
le menu change avec elle.

La règle générale, du plus large au plus étroit :

| Rôle | Ce qu'il voit | Ce qu'il modifie |
| --- | --- | --- |
| **Gérant** | Tout, sur les maisons qu'il gère | Tout, sur les maisons qu'il gère |
| **Détenteur** (indivisaire, associé) | Le calendrier, l'argent, l'entretien, les papiers | Ses demandes de séjour, ses votes, ses remboursements |
| **Membre de foyer** | Le calendrier, l'entretien, les papiers. **Pas l'argent** par défaut | Ses demandes de séjour |
| **Invité par lien** | La fiche pratique, et les codes de son séjour | Rien |

## Trois choses qui surprennent au début

**Les nuits, pas les jours.** Un séjour du 14 au 21 fait sept nuits. La nuit
d'arrivée est comptée, la nuit de départ ne l'est pas. Deux familles peuvent
donc se croiser le même jour : l'une part le matin, l'autre arrive le soir.

**Rien ne s'efface.** Une demande refusée, un séjour annulé, une personne qui
quitte l'indivision : tout est archivé avec sa date, jamais supprimé. C'est ce
qui permet de retrouver ce qui s'est passé trois ans plus tard.

**Vos données ne sortent pas.** L'application tourne sur le serveur de la
famille. Elle ne parle à aucun service extérieur, sauf pour envoyer les
courriels de notification si quelqu'un l'a configuré.
