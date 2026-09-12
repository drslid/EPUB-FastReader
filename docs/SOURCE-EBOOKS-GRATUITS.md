# Ebooks libres et gratuits : intégration EPUB

Vérification réelle du 12 septembre 2026. La source a été explicitement demandée par l’utilisateur. Le plugin utilise son [catalogue OPDS](https://www.ebooksgratuits.com/opds/) et son [descripteur OpenSearch](https://www.ebooksgratuits.com/opds/opensearch.xml), proposés aux logiciels de lecture par le site. Il n’aspire pas la page HTML des résultats.

## Parcours et contrat

- Plugin `ebooks-gratuits`, identifiant stable `ebooks-gratuits-637`, identité d’édition `ebooks-gratuits:637`.
- Recherche par titre français : `/api/sources/ebooks-gratuits/search?query=Candide&page=1`. Le serveur construit exclusivement l’URL officielle `opds/feed.php?mode=search&query=Candide&page=0`. La pagination OPDS commence à zéro ; celle de FastReader commence à un.
- Le serveur transmet le XML borné à 2 Mio. Le navigateur le lit avec DOMParser, refuse DTD/entités et conserve uniquement les notices dotées d’une acquisition EPUB autorisée. Une notice PDF seule n’obtient aucun bouton de lecture. Le total OPDS peut inclure d’autres formats : il est alors indiqué comme approximatif.
- Acquisition : `/api/books/ebooks-gratuits/637.epub`. Le serveur construit `newsendbook.php?id=637&format=epub`, autorise une seule redirection HTTPS interne vers `/epub/nom.epub`, contrôle taille et archive, puis renvoie les octets originaux. Aucune URL fournie par une notice ou par le navigateur ne devient une destination de relais.
- Recherche limitée à 60 secondes côté serveur / 65 secondes côté navigateur. La recherche de cette source reste indépendante des autres résultats. Annuler une recherche interrompt son téléchargement. Les erreurs réseau et les refus de la source ne deviennent pas de faux résultats vides.

L’OPDS testé ne contient pas de couverture pour Candide : FastReader utilise sa couverture typographique avant l’import, puis la couverture contenue dans l’EPUB. Le plugin ne télécharge pas les livres pour fabriquer les vignettes d’une recherche. La source et le lien de l’édition accompagnent chaque résultat.

## Preuves exécutées

| Essai réel | Résultat |
| --- | --- |
| Recherche officielle `Candide` | HTTP 200, 2 937 octets XML, une notice EPUB ; 0,69 s au premier contrôle |
| Recherche officielle `les` | 813 notices annoncées, 100 entrées sur la première page, lien suivant avec `page=1` |
| Nouveau handler Node, Candide 637 | HTTP 200, EPUB original de 1 530 924 octets, 4,89 s |
| Import du fichier obtenu avec le lecteur réel dans Chromium | *Candide ou l’optimisme*, Voltaire, 38 sections, 31 930 mots, couverture présente |
| Stockage du même livre | Archive originale de 1 530 924 octets conservée dans IndexedDB ; livre présent après rechargement de la bibliothèque ; aucune erreur JavaScript |
| Runtime Cloudflare Workerd local, nouveau handler | Recherche 200 en 0,66 s ; EPUB 200 en 2,87 s ; CORS limité à `https://drslid.github.io` ; origine étrangère 403 |
| Relais Cloudflare publié, Chromium mobile sur l’origine Pages | Recherche Candide et EPUB 637 réels : HTTP 200 ; clic Lire → Mot à mot / Sépia → IndexedDB, original de 1 530 924 octets ; bibliothèque après rechargement puis réouverture hors connexion |

Ces mesures vérifient cette édition et ces requêtes, pas l’intégralité du catalogue ni une garantie de délai. Les endpoints officiels n’émettent pas d’autorisation CORS : le relais configuré est nécessaire sur GitHub Pages.

La dernière preuve a servi uniquement les fichiers du build `dist-pages` local sous l’origine `https://drslid.github.io`, avec un profil Chromium Pixel 7 neuf et les Service Workers désactivés. Toutes les recherches, acquisitions et images externes utilisaient les véritables serveurs publics, sans simulation d’API. Elle confirme le client et le relais publiés ensemble, sans prétendre vérifier à cette étape la version statique déjà déployée sur Pages. Le JSON réseau et les captures de cette exécution sont conservés dans `/tmp/fastreader-source-browser-proof/`.

## Conditions et limites

La [notice d’utilisation](https://www.ebooksgratuits.com/notice_util.php) impose des téléchargements successifs et au plus 50 livres par jour ; une rafale de plus de cinq par minute peut provoquer un blocage. Le relais applique **une acquisition ELG à la fois**, au moins **12,1 secondes entre deux débuts**, au maximum **50 tentatives sur 24 heures glissantes**, avec cache temporaire. Une réponse 401, 403 ou 429 crée une pause commune ; aucune tentative de contournement ni d’autre hôte n’est utilisée. Le déploiement Worker utilise un Durable Object unique et persiste les horodatages de réservation afin de conserver ces limites après redémarrage et entre régions. Le handler Node seul garde ses limites en mémoire ; un déploiement Node répliqué doit fournir un coordinateur `reserveDownload` partagé et persistant.

Les [droits dépendent du pays du lecteur et de l’édition](https://www.ebooksgratuits.com/droitaut.php). Certaines éditions partenaires contiennent des ajouts éditoriaux ou des restrictions de modification. Le catalogue ne fournit pas une licence de dérivation par notice. Les livres de ce plugin déclarent donc `canExportFocus: false` et `canExportClassic: false` : seule la restitution de **l’archive originale**, avec crédits et conditions intacts, est proposée tant que les droits de transformation de cette édition ne sont pas vérifiés. L’affichage local des modes de lecture reste disponible.

## Vérification automatique

`tests/ebooks-gratuits.test.js` couvre l’OPDS, le filtre EPUB, la pagination, les titres longs, l’identité des éditions, les URL, le délai et l’annulation. `tests/ebooks-gratuits-server.test.js` couvre le relais, CORS, redirections, quotas, fichier invalide, limites de taille, refus d’accès, sérialisation, recherche pendant un téléchargement et middleware HTTP Node. `tests/source-worker.test.js` vérifie l’état des sources, le pont Gutenberg et la persistance des quotas du Worker. Les tests automatiques utilisent des réponses contrôlées et ne sollicitent pas les serveurs de livres.
