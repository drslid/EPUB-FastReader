# Améliorations et prochaines décisions

Les sept premiers chantiers validés ont maintenant une implémentation dans le code. Leur état détaillé, les tests ciblés et les limites figurent dans [EVOLUTION-LECTURE.md](EVOLUTION-LECTURE.md). Cela ne constitue pas une annonce de déploiement public.

## Chantiers implémentés

| Priorité validée | Fonctionnalités présentes | Limites à conserver visibles |
| --- | --- | --- |
| 1. Mot à mot sur téléphone | Cadence Souple/Régulière, pauses selon ponctuation et longueur, phrase précédente, Wake Lock facultatif | Refus du système possibles ; aucun gain de compréhension promis |
| 2. Sauvegarde complète | ZIP des livres/repères/préférences, restauration avec fusion, estimation et protection facultative du stockage | 500 livres et 250 Mio par ZIP ; transfert manuel, pas de synchronisation entre appareils |
| 3. Réglages et aperçu | Profils, aperçu immédiat, interligne, largeur, intensité Focus et exclusion des mots courts | Familles de polices système ; pas de promesse liée à la dyslexie |
| 4. Navigation et accessibilité | Accès direct au sommaire, focus des panneaux, raccourcis documentés, préférence de réduction des mouvements | Parcours sur appareils physiques et lecteurs d’écran à poursuivre |
| 5. Prise en main | Accueil distinct, suggestions, démo et explications facultatives des trois modes | La démo ne remplit plus la bibliothèque |
| 6. PWA compréhensible | Nouvelle version signalée, sauvegarde avant mise à jour, report possible | Première visite connectée requise pour installer le cache |
| 7. Import et compatibilité | Worker ZIP, progression, pauses entre traitements, tests de structures EPUB complexes | DOM encore sur le fil principal ; tous les chapitres sont préparés à l’import |

Les ajustements de parcours demandés sont également présents : titres/auteurs complets sur les couvertures, descriptions plus discrètes, boutons distincts de téléchargement et de lecture, exports Classique/Focus depuis la bibliothèque et suggestions déplacées sur l’accueil.

## Prochaines améliorations à décider

| Ordre proposé | Sujet | Première étape utile |
| --- | --- | --- |
| 1 | **Sources supplémentaires** | Comparer catalogue français, droits, couvertures, métadonnées et téléchargement réel depuis l’hébergement retenu. **Validation commune avant toute intégration.** |
| 2 | Sélection éditoriale plus variée | Proposer davantage de nouvelles, romans courts, autrices et thèmes ; contrôler chaque édition recommandée et sa provenance. |
| 3 | Lecture vocale naturelle | Faire écouter les voix françaises de Kokoro et Piper, puis mesurer téléchargement des modèles, mémoire et latence sur téléphone. Aucun moteur n’est intégré pour l’instant. |
| 4 | Sessions de 5, 10 ou 20 minutes | Reprendre la position actuelle et proposer une pause en fin de paragraphe ; présenter les durées comme des estimations. |
| 5 | « À lire plus tard » et import multiple | Distinguer les références enregistrées des EPUB réellement téléchargés ; éviter les doublons à l’import. |
| 6 | Chargement des chapitres à la demande | Mesurer les cas qui restent lents avant de refondre le stockage et le lecteur ; cibler d’abord les très grands chapitres. |

**Point d’hébergement à régler :** le relais Gutenberg fonctionne dans la version Node/Docker. Il n’est pas activé à distance pour le build GitHub Pages actuel. Les neuf EPUB intégrés s’ouvrent directement ; les autres résultats proposent encore un accès à la source et un import manuel si l’ouverture directe est impossible. Afficher un bouton **Lire** ne supprime pas cette restriction technique.

Wikisource, Standard Ebooks ou d’autres catalogues peuvent faire partie de la comparaison future. Leur présence dans cette liste ne vaut ni validation des droits de toutes leurs éditions ni validation de leur compatibilité avec l’ouverture en un clic. Les informations déjà recueillies sont conservées dans [SOURCES.md](SOURCES.md).

Les architectures OPFS/SQLite, la synchronisation cloud et les comptes restent hors de ce premier incrément : le fonctionnement local et la sauvegarde transférable répondent au besoin actuel. L’audio et toute nouvelle source feront l’objet d’un choix explicite après essai.
