# Évolutions après la refonte mobile

La priorité est de rendre évidentes trois actions : trouver un livre, lire confortablement, retrouver sa place. Le parcours actuel reste entièrement local.

## Livré

- Deux pages utiles : bibliothèque personnelle et découverte, avec une navigation basse sur mobile.
- Accueil avec trois suggestions renouvelées au démarrage ou sur demande, historique local et diversité des auteurs.
- Clic sur une couverture prête à lire : ajout à la bibliothèque et ouverture ; reprise sans téléchargement d’une édition compatible déjà présente.
- Focus plus contrasté dans les trois thèmes, y compris les passages surlignés ; couvertures identiques dans les suggestions, Découvrir et Mes livres.
- Sombre et Mot à mot au premier lancement, choix utilisateur conservés dans IndexedDB.
- Mot et commandes stables malgré un contexte de longueur variable ; trois modes accessibles.
- Recherche locale dans l’index officiel Gutenberg ; couvertures cliquables et récupération des EPUB via un relais public, en plus des neuf éditions intégrées.
- Recherche dans les livres personnels et dans le texte d’un livre ouvert.
- Signets, notes, surlignages, export Markdown et téléchargements EPUB original/Focus.
- Migration de la base précédente sans effacer les livres ni les repères.
- Cache français dès installation, autres langues sur consultation et pipeline de publication du serveur en conteneur avec déploiement par webhook configuré.

## Prochaines idées, non implémentées

| Priorité | Évolution                                                                         | Utilité                                                               | Point à vérifier                                                                    |
| -------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| P1       | Sauvegarde/restauration complète dans un fichier ZIP                              | Transférer sa bibliothèque et ses repères entre appareils sans compte | Gros fichiers, validation des archives, doublons, restauration interrompue          |
| P1       | Étendre la sélection lisible en un clic                                           | Réduire le passage par un site externe et l’import manuel             | Droits exacts des éditions, poids sur mobile, disponibilité des fichiers            |
| P1       | Source externe autorisant explicitement une API et les téléchargements navigateur | Ouvrir davantage de résultats directement                             | Autorisation, CORS, catalogue, quotas et stabilité constatés en navigateur          |
| P2       | Sessions de 5, 10 ou 20 minutes                                                   | Proposer un petit objectif à partir du marque-page existant           | Arrêt naturel en fin de section/paragraphe, sans couper arbitrairement une histoire |
| P2       | Collections personnelles simples                                                  | Classer à lire/en cours/terminés sans alourdir l’accueil              | Besoin réel lorsque la bibliothèque grandit                                         |
| P2       | Dictionnaire local et favoris de vocabulaire                                      | Aider à comprendre un mot sans quitter le lecteur                     | Taille des données et licences des dictionnaires                                    |

Pas de résumé automatique ni de score incitant à accélérer dans le périmètre actuel. Pour faire évoluer les modes, observer aussi la compréhension et le confort, avec des lecteurs sur de vrais téléphones. Le thème sombre est un choix initial demandé ; il ne constitue pas une promesse médicale de repos visuel.
