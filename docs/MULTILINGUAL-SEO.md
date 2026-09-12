# Langues et référencement

FastReader dispose de six documents publics : français à la racine, anglais dans `en.html`, espagnol dans `es.html`, italien dans `it.html`, allemand dans `de.html` et portugais dans `pt.html`. Les noms de langues accompagnent les drapeaux ; un drapeau seul ne définit pas une langue. La langue de l’interface ne traduit pas le contenu des livres.

Les drapeaux sont des SVG locaux issus de [flag-icons](https://github.com/lipis/flag-icons), avec leur licence MIT dans `public/flags/NOTICE.txt`. Ils ne dépendent pas des polices emoji de l’appareil et restent disponibles hors ligne.

Le sélecteur est disponible dans l’en-tête et dans les réglages du lecteur. Le choix est conservé dans IndexedDB, inclus dans les sauvegardes et retrouvé à l’entrée du site. Une URL localisée explicite est prioritaire. Le lien français utilise temporairement `?lang=fr` pour fonctionner aussi dans un nouvel onglet malgré une préférence différente ; ce paramètre est retiré au démarrage, avec une canonique toujours à la racine.

Les aides, erreurs, notifications, réglages, descriptions éditoriales et trois chapitres de démonstration sont traduits. Les titres, auteurs, chapitres EPUB et notes personnelles restent dans leur langue originale. Le filtre « Langue du livre » est indépendant du sélecteur d’interface et propose aussi italien et portugais.

Les dictionnaires `src/locales/main.js`, `views.js` et `system.js` utilisent les phrases françaises comme clés et des paramètres nommés (`{count}`, `{title}`, etc.). `demo.js` contient les éditions traduites de la démonstration. Les dictionnaires forment un fichier JavaScript distinct, disponible hors ligne. Toute nouvelle chaîne visible doit être ajoutée aux cinq traductions ; les tests vérifient leur présence et la conservation des paramètres. La fonction `t()` ne nettoie pas le HTML : les valeurs utilisateur doivent être échappées au rendu.

## Pages que les moteurs peuvent consulter

Chaque document contient, avant l’exécution de JavaScript, un titre, une description, un seul titre principal et une présentation traduite des fonctions existantes. Ce contenu reste visible avec JavaScript désactivé. JavaScript monte ensuite le lecteur habituel. Il n’y a pas de version spéciale destinée uniquement aux robots.

Les documents déclarent leur langue HTML, une URL canonique propre, les six variantes `hreflang` réciproques et `x-default` vers la racine française. Les métadonnées Open Graph et Twitter sont traduites ; l’image est l’icône existante. Le JSON-LD décrit une application Web gratuite, sans note, avis, résultat commercial ou promesse de vitesse inventés.

Le sitemap ne contient que les six pages publiques. Les fichiers importés, recherches, titres personnels, notes et positions de lecture ne sont jamais ajoutés au HTML généré, au sitemap ou au JSON-LD. Les fragments de navigation ne créent pas de pages publiques supplémentaires. Aucun compte de suivi, pixel ou outil d’analyse n’est ajouté.

## Déploiement

Les deux commandes `npm run build` et `npm run build:pages` génèrent les six documents, les six manifestes et `sitemap.xml`. La génération précède le calcul de version du Service Worker : les documents traduits et leurs fichiers JavaScript/CSS appartiennent à une même version hors ligne. Toutes les langues partagent l’identité, la portée PWA et le stockage de l’application. Le manifeste de chaque langue définit une URL de démarrage correspondante.

La valeur par défaut de l’URL publique est `https://drslid.github.io/EPUB-FastReader/`. Pour un domaine différent, définir `VITE_SITE_URL` au moment de la compilation, par exemple :

```sh
VITE_SITE_URL=https://lecture.example/ npm run build
```

Cette URL doit être absolue, sans identifiants, paramètres ni fragment. Elle doit désigner l’emplacement réel publié. L’URL est utilisée par les canoniques, le sitemap, les métadonnées sociales et le JSON-LD. Les ressources applicatives restent relatives pour fonctionner sous un chemin de projet GitHub Pages.

Un `robots.txt` ne fait autorité qu’à la racine de l’origine. Le projet GitHub Pages ne contrôle pas `https://drslid.github.io/robots.txt` : aucun faux fichier d’autorité n’est généré sous `/EPUB-FastReader/`. Pour une compilation avec `VITE_SITE_URL` à la racine d’un domaine, le build génère un `robots.txt` qui référence le sitemap. Le sitemap de production peut être soumis dans une propriété Search Console vérifiée par le propriétaire ; cette soumission n’a pas été effectuée par l’application et l’indexation ne peut pas être garantie.

## Validation

La campagne locale du 12 septembre 2026 passe **409 tests unitaires** et **255 scénarios navigateur distincts** sur les profils ordinateur Chromium, téléphone Chromium et tablette WebKit. Après remplacement des drapeaux emoji par des SVG locaux, les **18 scénarios langue/SEO concernés ont été rejoués avec succès** ; ils sont inclus dans les 255. Les profils mobiles sont des émulations, complétées par une inspection visuelle des captures.

Les contrôles couvrent les six langues sur l’accueil, la bibliothèque, la recherche, le lecteur, les réglages, l’aide d’installation, la sauvegarde et les erreurs d’import. Le changement de langue conserve le texte EPUB, les signets et la position. Le choix persiste au rechargement, fonctionne dans un nouvel onglet et respecte l’historique du navigateur. Les mises en page ont été vérifiées à 320 px, y compris les libellés allemands longs. Les tests de sauvegarde vérifient aussi la traduction de la modale après restauration des préférences.

`tests/seo.test.js` et `tests/seo-generation.test.js` vérifient les six traductions pré-rendues, la réciprocité des variantes, les canoniques, les métadonnées, l’absence de données privées, les fichiers produits, les drapeaux SVG et le changement d’URL de déploiement. Leurs 14 tests passent.

`tests/e2e/seo.spec.js` vérifie les véritables documents de production sans JavaScript, leurs ressources et manifestes, le type XML du sitemap et la navigation hors ligne entre les six langues avec un seul Service Worker. Les 6 scénarios passent avec les profils ordinateur Chromium, téléphone Chromium et tablette WebKit. Pour le hors ligne, un serveur de production isolé est arrêté et une requête non mise en cache doit échouer avant la navigation ; cela évite un problème de l’émulation réseau de WebKit et prouve que le serveur ne fournit plus les documents.

`npm run test:pages` vérifie aussi les six documents, leurs canoniques, les liens de langues, leurs manifestes et le sitemap sous `/EPUB-FastReader/`. Les neuf contrôles complets passent avec la compilation Pages. Le pipeline exécute ces contrôles avant publication. `FASTREADER_PAGES_URL=https://drslid.github.io/EPUB-FastReader/ npm run test:pages` permet de les répéter sur le site publié dans un profil isolé.

## Références

- [Google Search Central : versions linguistiques et liens réciproques](https://developers.google.com/search/docs/specialty/international/localized-versions).
- [Google Search Central : URL distincte pour chaque langue](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites).
- [Google Search Central : emplacement du fichier robots.txt](https://developers.google.com/search/docs/crawling-indexing/robots/create-robots-txt).
