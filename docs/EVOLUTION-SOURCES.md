# Lecture rapide, recherche en liste et nouvelles sources — 12 septembre 2026

| Page ou parcours | Comportement livré | Vérification |
| --- | --- | --- |
| Accueil | « Lisez plus vite. Allez au bout de vos livres. » ; démonstration immédiate et modes Mot à mot, Focus, Classique | Six langues, mobile et ordinateur, métadonnées et contenu sans JavaScript |
| Navigation | Suppression du bandeau « Enregistré sur cet appareil » et de la signature du pied de page | Affichage, clavier et navigation conservés |
| Recherche | Toutes les langues par défaut, livres personnels en tête, une ligne par résultat avec couverture, titre entier, auteur, source et actions | Recherche anglaise sans filtre, rechargement, titres longs, alignement des lignes, retours tardifs et affichage à 320 px |
| Découvrir | Sélection visuelle conservée ; filtres Faded Page et epubBooks ajoutés ; recherche anglaise indépendante des autres sources | Résultats progressifs, panne isolée, annulation et acquisition |
| Ma bibliothèque | Un seul bouton « Télécharger l’EPUB », sans menu ; fichier Classique directement téléchargé | Lecture Focus puis export sans préfixes, archive en base intacte, réimport, aucun doublon |
| Lecteur | Un seul téléchargement Classique ; progression et réglages conservés | EPUB exporté valide, sommaire, images et emphase de l’auteur préservés |
| Couvertures | Illustration Faded Page embarquée réutilisée ; illustration différente d’epubBooks récupérée et conservée localement | Image présente avant téléchargement, identique après import, réouverture hors ligne ; une panne de couverture n’empêche pas de lire |
| Paramètres | Deux nouvelles sources avec disponibilité textuelle et pastille ; provenance et droits territoriaux | Contrôle sans téléchargement de livre, six langues, clavier et contrastes |
| README et SEO | README anglais pour les lecteurs, capture réelle, mode d’emploi, sauvegardes ; titres et descriptions centrés sur la lecture rapide | Six pages statiques, canonical, hreflang, Open Graph et données structurées |

Les éditions dont la source demande de conserver l’archive sont téléchargées intactes : elles restent des EPUB classiques, sans ajout de mise en évidence FastReader. Le menu Original/Focus a disparu ; les archives originales restent disponibles dans les sauvegardes.

## Sources réellement essayées

- **Faded Page** : *Jane: A Story of Jamaica*, 296 961 octets, 28 chapitres. Recherche par titre en anglais, droits du domaine public au Canada à vérifier selon son pays. Illustration identique à celle de l’EPUB.
- **epubBooks** : *Frankenstein*, 270 697 octets, 31 chapitres. La recherche publique renvoie ses meilleurs résultats, pas un catalogue intégral paginé. Couverture de recherche conservée, différente de celle de l’archive.
- **Z-Library.sk** : le navigateur testé a reçu HTTP 517 « Access Denied | DiamWall ». Aucun accès de recherche/acquisition vérifiable ; la source reste indiquée indisponible. Ce constat ne prétend pas décrire tous les réseaux ou régions.

Les parcours publics Faded Page et epubBooks n’exigent pas de compte. Le relais utilise uniquement la session anonyme temporaire émise par la source pour cette acquisition. Les livres, positions et annotations personnels restent dans le navigateur. Aucun cookie utilisateur n’est transmis aux catalogues.

Le relais Cloudflare public a renvoyé HTTP 200 pour les deux recherches, les deux EPUB et la couverture epubBooks. L’interface est publiée par GitHub Actions après ses contrôles. Aucun gain chiffré ni bénéfice de compréhension garanti n’est annoncé.

[Validation](VALIDATION.md) · [Audit Faded Page](SOURCE-FADEDPAGE-AUDIT.md) · [Audit epubBooks](SOURCE-EPUBBOOKS-AUDIT.md) · [Audit Z-Library](SOURCE-ZLIBRARY-AUDIT.md) · [Service Cloudflare](SOURCE-RELAY-DEPLOYMENT.md)
