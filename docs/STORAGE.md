# Espace personnel local

FastReader utilise IndexedDB, sans compte utilisateur ni synchronisation distante. Une seule bibliothèque rassemble les EPUB importés et ceux ouverts depuis la sélection ou la recherche Gutenberg. Le fichier téléchargé devient un livre local avant l’ouverture du lecteur.

## Base `fastreader`, version 2

| Collection    | Clé           | Contenu                                                                                       |
| ------------- | ------------- | --------------------------------------------------------------------------------------------- |
| `books`       | `id`          | Métadonnées, chapitres nettoyés, couverture intégrée, provenance et octets de l’EPUB original |
| `positions`   | `id` du livre | Chapitre, position textuelle, progression, signets, surlignages et notes                      |
| `preferences` | `reader`      | Thème, mode de lecture, police, taille et vitesse                                             |
| `preferences` | `suggestions` | Identifiants du dernier groupe de livres proposé, pour renouveler l’accueil                   |

L’identité d’un EPUB utilise l’empreinte de son fichier lorsqu’elle est disponible. Réimporter le même EPUB met à jour le livre sans créer de doublon ni supprimer les repères. Supprimer un livre retire sa ligne et sa position dans une même transaction ; les autres livres restent intacts.

Les positions sont validées avant ouverture pour supporter des données anciennes ou endommagées. Les repères référencent le texte et son contexte plutôt qu’un numéro de page dépendant de l’écran.

Un livre ouvert depuis le catalogue conserve aussi `source.presentation` : version, clé de couverture stable, titre, auteur et éventuelle image du catalogue. Cette présentation est utilisée dans Mes livres ; elle n’écrase ni les métadonnées EPUB ni `book.cover`, l’image extraite de l’archive. Le catalogue courant permet de retrouver les anciens livres sans cette présentation, par identifiant canonique, identifiant de livre, identifiant de sélection ou URL Gutenberg. Cette compatibilité ne nécessite pas de nouvelle version de la base. Les EPUB personnels sans provenance conservent leur image intégrée.

Les suggestions ne chargent que les métadonnées du catalogue intégré. Consulter l’accueil n’ajoute aucun EPUB à la bibliothèque ; cliquer sur une suggestion importe le livre puis l’ouvre. L’historique reste local, sans profil de goûts distant. Une navigation ou un changement de thème ne remplace pas les suggestions en cours.

## Migration

L’ouverture de la version 2 crée seulement la collection `preferences` manquante. Les collections `books` et `positions` de la version 1 restent en place. L’ancienne connexion est fermée lors d’un changement de version ; fermer les autres onglets si le navigateur signale que la migration est bloquée.

Au premier lancement de cette refonte, les préférences de police et de cadence de localStorage sont transférées vers IndexedDB. Le thème initial devient sombre et le mode initial Mot à mot, conformément au nouveau parcours. Un choix ultérieur de thème ou de mode est mémorisé et n’est plus réinitialisé. La clé historique localStorage est retirée après une écriture réussie.

## Disponibilité et export

Les EPUB restent utilisables hors connexion après leur enregistrement. La progression est sauvegardée lors des actions de lecture, des pauses, des changements de page et périodiquement en Mot à mot. Une fermeture brutale du système peut interrompre une transaction ; aucune base de navigateur n’est une garantie de sauvegarde externe.

Le lecteur propose le téléchargement des octets originaux et l’export Focus. Les notes et signets peuvent être exportés en Markdown. Une restauration globale de bibliothèque n’est pas encore proposée.

Les index de livres publics et les fichiers de l’application sont distincts des données personnelles : le service worker les garde dans Cache Storage. Le catalogue français et les neuf EPUB de la sélection sont installés avec l’application ; les autres langues sont mises en cache lorsqu’elles sont consultées.

Le relais HTTP reçoit uniquement l’identifiant Gutenberg du livre public à télécharger. Il récupère une édition originale auprès des miroirs autorisés et utilise un cache mémoire temporaire de fichiers publics, limité à 64 Mio avec une validité de six heures. Il ne possède ni base de comptes ni stockage de positions, de notes ou d’EPUB personnels. Les téléchargements Gutenberg passent ensuite dans IndexedDB comme les autres livres ; les positions de lecture et les recherches restent locales.

Effacer les données du site, changer d’origine, de navigateur ou d’appareil ne conserve pas automatiquement la bibliothèque. Une lecture sur téléphone et une lecture sur PC sont indépendantes. Aucune donnée personnelle n’est envoyée à un service de compte.

En cas de stockage indisponible ou plein, l’application explique que l’enregistrement a échoué et conserve autant que possible la lecture en mémoire dans l’onglet. Elle n’annonce pas une sauvegarde durable réussie.
