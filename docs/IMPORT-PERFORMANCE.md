# Import EPUB : traitement et vérifications

L’import décompresse maintenant le ZIP et prépare les images raster dans un Web Worker. La validation XML et l’assainissement DOMPurify restent dans le document. Des pauses coopératives entre chapitres, phases DOM et groupes de liens/ancrages rendent la main au navigateur. Ce changement ne promet ni un nombre d’images par seconde, ni un temps d’import identique sur tous les appareils.

## Contrat conservé

`importEpub(file, { onProgress })` conserve le format du livre : tous les chapitres assainis, les métadonnées, la couverture, le nombre de mots, l’empreinte et l’archive originale. Le callback facultatif reçoit `{ phase, completed, total, percent, message }` ; les phases sont `opening`, `chapters`, puis `complete`. Les pourcentages décrivent l’avancement des étapes, pas une estimation du temps restant.

Le Worker est arrêté après un succès ou une erreur. Si le navigateur bloque sa création ou son chargement initial, le même moteur ZIP s’exécute localement, avec les mêmes validations. Une archive invalide ou trop volumineuse n’entraîne pas une seconde tentative de décompression. Vite émet le Worker comme un fichier statique, automatiquement inclus dans le précache existant pour GitHub Pages et l’usage hors ligne.

Les protections existantes sont conservées : inspection du répertoire avant décompression, limitation des flux décompressés, validation du `mimetype`, chemins internes sûrs, refus des DRM hors obfuscation standard des polices, nettoyage des scripts, styles et ressources distantes. Les limites restent 30 Mio pour l’archive, 160 Mio annoncés décompressés, 16 Mio par entrée, 4 Mio par document textuel, 5 000 entrées et 1 000 chapitres.

## Observations du 12 septembre 2026

Harnais reproductible :

```sh
npm run build
node scripts/benchmark-import.mjs
```

Le script démarre son propre serveur local sur un port disponible. Il utilise Chromium 153.0.8010.12, trois passages alternés par configuration et un contexte neuf à chaque passage, sans Service Worker. Le profil Pixel 7 est une émulation d’affichage et d’entrées sur la même machine Linux ; ce n’est pas une mesure sur un téléphone physique ni un processeur mobile ralenti.

Le corpus synthétique contient 24 chapitres de 96 paragraphes : 16 158 octets dans le ZIP, 445 861 octets décompressés. Il est très compressible, sans images. Le temps mesuré couvre le changement du champ fichier jusqu’à l’apparition du lecteur, donc aussi la sauvegarde IndexedDB et sa préparation. Les données brutes sont dans [IMPORT-PERFORMANCE.json](IMPORT-PERFORMANCE.json).

| Configuration | Durée médiane | Rappels `requestAnimationFrame` pendant l’opération | Intervalle maximal observé entre rappels |
| --- | ---: | ---: | ---: |
| Desktop Chrome, Worker | 97 ms | 5–6 | 24 ms |
| Desktop Chrome, repli local | 84 ms | 4–5 | 29 ms |
| Pixel 7 émulé, Worker | 96 ms | 5–6 | 21 ms |
| Pixel 7 émulé, repli local | 78 ms | 4–5 | 21 ms |

Sur ce petit ZIP, le lancement du Worker ajoute du temps. Ces observations confirment que l’import rend la main au navigateur ; elles ne démontrent pas une accélération globale, ni la fluidité des EPUB de 10 à 30 Mio. Le repli local bénéficie lui aussi du découpage coopératif. Une comparaison avec l’ancienne version sans ce découpage n’a pas été effectuée.

## Vérifications fonctionnelles

- 34 tests unitaires EPUB : protections ZIP/XML/DRM, progression, repli si le Worker est bloqué, ordre du spine et sommaires EPUB 2/3, images embarquées, notes avec liens de retour, tableaux et imbrication des mises en évidence.
- 9 tests navigateur dédiés, réussis sur Chromium desktop, Chromium Pixel 7 émulé et WebKit iPad émulé : Worker réellement sollicité, disponibilité de la boucle d’événements pendant 24 chapitres, repli local, refus des DRM et arrêt du Worker après erreur.
- L’assertion de disponibilité utilise un minuteur : WebKit sans interface peut suspendre les rappels d’animation, ce qui ne permet pas d’en déduire à lui seul un blocage du traitement.
- Focus réglable conserve espaces, accents et graphèmes. L’export Focus reprend l’intensité et l’option d’ignorer les mots courts. Le round-trip EPUB Focus → import → export Classique retire uniquement les préfixes ajoutés par FastReader, en conservant les mises en gras de l’auteur, métadonnées, images et liens internes.

```sh
npm test -- --run tests/epub.test.js
npx playwright test tests/e2e/epub-worker.spec.js
```

## Limites et suite mesurable

Tous les chapitres sont encore préparés avant l’ouverture du livre : ce n’est pas un chargement différé des chapitres. L’archive originale et les HTML restent conservés pour ne pas modifier le stockage, la recherche et les exports existants. Le Worker garde temporairement sa propre copie des octets ; les images converties en base64 occupent toujours de la mémoire.

DOMParser, DOMPurify et certaines étapes de traitement d’un chapitre restent synchrones. Un très grand chapitre peut encore produire une tâche longue. L’export conserve sa compression ZIP dans le document, avec des pauses entre chapitres.

La prochaine mesure utile est un corpus de vrais EPUB illustrés de 10 à 30 Mio sur iPhone et Android physiques, avec temps total, tâches longues et consommation mémoire. Ces résultats permettront de choisir entre chargement des chapitres à la demande, stockage des images séparé et découpage plus fin du traitement HTML, sans modifier prématurément le contrat de bibliothèque.
