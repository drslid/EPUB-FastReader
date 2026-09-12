// Source settings and search status. The French source strings are the fallback locale.
const rows = [
  ["Original", "Original", "Original", "Originale", "Original", "Original"],
  ["Pour cette édition, téléchargez l’EPUB original afin de conserver les conditions de la source.", "For this edition, download the original EPUB to preserve the source’s terms.", "Para esta edición, descarga el EPUB original para conservar las condiciones de la fuente.", "Per questa edizione, scarica l’EPUB originale per preservare le condizioni della fonte.", "Lade für diese Ausgabe das Original-EPUB herunter, damit die Bedingungen der Quelle erhalten bleiben.", "Para esta edição, descarrega o EPUB original para preservar as condições da fonte."],
  [
    "Paramètres",
    "Settings",
    "Ajustes",
    "Impostazioni",
    "Einstellungen",
    "Definições"
  ],
  [
    "Sources de livres",
    "Book sources",
    "Fuentes de libros",
    "Fonti dei libri",
    "Buchquellen",
    "Fontes de livros"
  ],
  [
    "Fermer",
    "Close",
    "Cerrar",
    "Chiudi",
    "Schließen",
    "Fechar"
  ],
  [
    "La pastille indique si la source est accessible depuis FastReader. La disponibilité d’un livre peut varier.",
    "The indicator shows whether FastReader can access the source. Individual books may not always be available.",
    "El indicador muestra si FastReader puede acceder a la fuente. La disponibilidad de cada libro puede variar.",
    "L’indicatore mostra se la fonte è accessibile da FastReader. La disponibilità dei singoli libri può variare.",
    "Der Punkt zeigt, ob FastReader auf die Quelle zugreifen kann. Einzelne Bücher sind möglicherweise nicht immer verfügbar.",
    "O indicador mostra se o FastReader consegue aceder à fonte. A disponibilidade de cada livro pode variar."
  ],
  [
    "Disponibilité des sources",
    "Source availability",
    "Disponibilidad de las fuentes",
    "Disponibilità delle fonti",
    "Verfügbarkeit der Quellen",
    "Disponibilidade das fontes"
  ],
  [
    "Vérifier à nouveau",
    "Check again",
    "Volver a comprobar",
    "Verifica di nuovo",
    "Erneut prüfen",
    "Verificar novamente"
  ],
  [
    "Vos livres, notes et repères restent sur cet appareil. Les recherches externes sont transmises aux catalogues concernés et, si nécessaire, à notre service de connexion.",
    "Your books, notes and bookmarks stay on this device. External searches are sent to the relevant catalogues and, when needed, to our connection service.",
    "Tus libros, notas y marcadores permanecen en este dispositivo. Las búsquedas externas se envían a los catálogos correspondientes y, cuando es necesario, a nuestro servicio de conexión.",
    "Libri, note e segnalibri restano su questo dispositivo. Le ricerche esterne vengono inviate ai cataloghi interessati e, quando necessario, al nostro servizio di connessione.",
    "Deine Bücher, Notizen und Lesezeichen bleiben auf diesem Gerät. Externe Suchanfragen werden an die jeweiligen Kataloge und bei Bedarf an unseren Verbindungsdienst gesendet.",
    "Os teus livros, notas e marcadores ficam neste dispositivo. As pesquisas externas são enviadas para os catálogos correspondentes e, quando necessário, para o nosso serviço de ligação."
  ],
  [
    "Les droits varient selon votre pays. Téléchargez uniquement des livres du domaine public ou pour lesquels vous avez l’autorisation requise.",
    "Rights vary by country. Only download books that are in the public domain or that you have permission to download.",
    "Los derechos varían según el país. Descarga únicamente libros de dominio público o para los que tengas la autorización necesaria.",
    "I diritti variano a seconda del paese. Scarica solo libri di pubblico dominio o per i quali hai l’autorizzazione necessaria.",
    "Die Rechte unterscheiden sich je nach Land. Lade nur gemeinfreie Bücher oder Bücher mit der erforderlichen Erlaubnis herunter.",
    "Os direitos variam consoante o país. Descarrega apenas livros de domínio público ou para os quais tens a autorização necessária."
  ],
  [
    "Annuaire externe de disponibilité de bibliothèques. Vérifiez les droits de chaque fichier avant de l’importer.",
    "An external directory showing library availability. Check the rights for each file before importing it.",
    "Directorio externo sobre la disponibilidad de bibliotecas. Comprueba los derechos de cada archivo antes de importarlo.",
    "Un elenco esterno sulla disponibilità delle biblioteche. Verifica i diritti di ogni file prima di importarlo.",
    "Ein externes Verzeichnis zur Erreichbarkeit von Bibliotheken. Prüfe die Rechte jeder Datei, bevor du sie importierst.",
    "Um diretório externo sobre a disponibilidade de bibliotecas. Verifica os direitos de cada ficheiro antes de o importares."
  ],
  [
    "Sélection FastReader",
    "FastReader selection",
    "Selección FastReader",
    "Selezione FastReader",
    "FastReader-Auswahl",
    "Seleção FastReader"
  ],
  [
    "Livres intégrés",
    "Included books",
    "Libros incluidos",
    "Libri inclusi",
    "Mitgelieferte Bücher",
    "Livros incluídos"
  ],
  [
    "Catalogue multilingue",
    "Multilingual catalogue",
    "Catálogo multilingüe",
    "Catalogo multilingue",
    "Mehrsprachiger Katalog",
    "Catálogo multilingue"
  ],
  [
    "Livres en anglais",
    "Books in English",
    "Libros en inglés",
    "Libri in inglese",
    "Bücher auf Englisch",
    "Livros em inglês"
  ],
  [
    "Livres en français",
    "Books in French",
    "Libros en francés",
    "Libri in francese",
    "Bücher auf Französisch",
    "Livros em francês"
  ],
  [
    "Accès direct non intégré",
    "Direct access is not integrated",
    "Acceso directo no integrado",
    "Accesso diretto non integrato",
    "Direkter Zugriff nicht integriert",
    "Acesso direto não integrado"
  ],
  [
    "L’accès automatisé à la recherche et aux EPUB n’a pas pu être vérifié.",
    "Automated access to search and EPUB files could not be verified.",
    "No se ha podido verificar el acceso automatizado a la búsqueda y a los archivos EPUB.",
    "Non è stato possibile verificare l’accesso automatico alla ricerca e ai file EPUB.",
    "Der automatische Zugriff auf die Suche und EPUB-Dateien konnte nicht bestätigt werden.",
    "Não foi possível verificar o acesso automático à pesquisa e aos ficheiros EPUB."
  ],
  [
    "Disponible",
    "Available",
    "Disponible",
    "Disponibile",
    "Verfügbar",
    "Disponível"
  ],
  [
    "Indisponible",
    "Unavailable",
    "No disponible",
    "Non disponibile",
    "Nicht verfügbar",
    "Indisponível"
  ],
  [
    "Vérification…",
    "Checking…",
    "Comprobando…",
    "Verifica…",
    "Wird geprüft…",
    "A verificar…"
  ],
  [
    "Vérification des sources…",
    "Checking sources…",
    "Comprobando las fuentes…",
    "Verifica delle fonti…",
    "Quellen werden geprüft…",
    "A verificar as fontes…"
  ],
  [
    "Vérification terminée. Aucun EPUB n’a été téléchargé.",
    "Check complete. No EPUB files were downloaded.",
    "Comprobación terminada. No se ha descargado ningún EPUB.",
    "Verifica completata. Nessun file EPUB è stato scaricato.",
    "Prüfung abgeschlossen. Es wurden keine EPUB-Dateien heruntergeladen.",
    "Verificação concluída. Nenhum EPUB foi descarregado."
  ],
  [
    "D’autres sources poursuivent la recherche… Vous pouvez déjà ouvrir un résultat.",
    "Other sources are still searching… You can already open a result.",
    "Otras fuentes siguen buscando… Ya puedes abrir un resultado.",
    "Altre fonti stanno ancora cercando… Puoi già aprire un risultato.",
    "Andere Quellen suchen noch… Du kannst bereits ein Ergebnis öffnen.",
    "Outras fontes ainda estão a pesquisar… Já podes abrir um resultado."
  ],
  [
    "Les livres intégrés restent accessibles.",
    "The included books remain available.",
    "Los libros incluidos siguen disponibles.",
    "I libri inclusi restano disponibili.",
    "Die mitgelieferten Bücher bleiben verfügbar.",
    "Os livros incluídos continuam disponíveis."
  ],
  [
    "Source",
    "Source",
    "Fuente",
    "Fonte",
    "Quelle",
    "Fonte"
  ],
  [
    "Import personnel",
    "Personal import",
    "Importación personal",
    "Importazione personale",
    "Eigener Import",
    "Importação pessoal"
  ]
];

export default Object.fromEntries(["en", "es", "it", "de", "pt"].map((language, index) => [
  language, Object.fromEntries(rows.map(([source, ...translations]) => [source, translations[index]])),
]));
