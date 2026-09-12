// Public landing-page copy only. Books, notes and reading positions never enter metadata.
export const DEFAULT_SITE_URL = "https://drslid.github.io/EPUB-FastReader/";
export const SEO_LANGUAGES = {
  fr: {
    name: "Français", flag: "🇫🇷", ogLocale: "fr_FR", file: "index.html",
    title: "FastReader — Lecture rapide EPUB gratuite, à votre rythme",
    description: "Avancez dans vos livres avec FastReader, le lecteur EPUB gratuit : lecture rapide mot à mot, Focus et Classique. Sur mobile, tablette et PC, sans compte.",
    heading: "Lisez plus vite. Allez au bout de vos livres.",
    intro: "Faites avancer votre pile à lire avec la lecture rapide Mot à mot. Choisissez votre cadence, découvrez un livre ou importez votre EPUB sur téléphone, tablette et ordinateur.",
    features: [
      ["La lecture rapide, à votre rythme", "Affichez un mot à la fois, réglez la vitesse et revenez à la phrase précédente quand vous le souhaitez. Passez à Focus ou Classique à tout moment."],
      ["Vos livres, toujours à portée de main", "Retrouvez vos livres, marque-pages et notes sans créer de compte. Exportez une sauvegarde pour conserver votre bibliothèque."],
      ["Un confort qui vous ressemble", "Ajustez le thème, la taille du texte, l’interligne et l’intensité Focus avec un aperçu immédiat."],
      ["Lire même sans connexion", "Installez FastReader et retrouvez hors ligne les livres déjà importés. Une connexion reste nécessaire pour découvrir et télécharger de nouveaux livres."],
    ],
    import: "Importer un EPUB", discover: "Découvrir des livres", languages: "Langue", skip: "Aller au contenu",
    noScript: "Activez JavaScript pour ouvrir vos EPUB dans FastReader. Vos fichiers sont lus et conservés sur votre appareil.",
  },
  en: {
    name: "English", flag: "🇬🇧", ogLocale: "en_GB", file: "en.html",
    title: "FastReader — Free EPUB speed reader, at your own pace",
    description: "Make progress through your books with FastReader, the free EPUB speed reader. Word by word, Focus and Classic on phone, tablet and desktop. No account needed.",
    heading: "Read faster. Finish the books you start.",
    intro: "Make progress through your reading list with Word by word speed reading. Set your pace, discover a book or import an EPUB on your phone, tablet or computer.",
    features: [
      ["Speed reading, at your own pace", "Display one word at a time, adjust the speed and return to the previous sentence whenever you need to. Switch to Focus or Classic at any time."],
      ["Your books, ready when you are", "Keep your books, bookmarks and notes without creating an account. Export a backup to preserve your library."],
      ["Comfort that suits you", "Adjust the theme, text size, line spacing and Focus intensity with an instant preview."],
      ["Read offline too", "Install FastReader and read previously imported books offline. Discovering and downloading new books still requires a connection."],
    ],
    import: "Import an EPUB", discover: "Discover books", languages: "Language", skip: "Skip to content",
    noScript: "Enable JavaScript to open EPUBs in FastReader. Your files are read and stored on your device.",
  },
  es: {
    name: "Español", flag: "🇪🇸", ogLocale: "es_ES", file: "es.html",
    title: "FastReader — Lectura rápida EPUB gratis, a tu ritmo",
    description: "Avanza en tus libros con FastReader, el lector EPUB gratuito: lectura rápida palabra a palabra, Focus y Clásico. En móvil, tableta y ordenador, sin cuenta.",
    heading: "Lee más rápido. Termina los libros que empiezas.",
    intro: "Avanza en tu lista de lecturas con la lectura rápida Palabra a palabra. Ajusta tu ritmo, descubre un libro o importa tu EPUB en el móvil, la tableta o el ordenador.",
    features: [
      ["Lectura rápida, a tu ritmo", "Muestra una palabra cada vez, ajusta la velocidad y vuelve a la frase anterior cuando lo necesites. Cambia a Focus o Clásico en cualquier momento."],
      ["Tus libros, siempre a mano", "Guarda tus libros, marcadores y notas sin crear una cuenta. Exporta una copia de seguridad para conservar tu biblioteca."],
      ["Comodidad a tu medida", "Ajusta el tema, el tamaño del texto, el interlineado y la intensidad de Focus con una vista previa inmediata."],
      ["Lee también sin conexión", "Instala FastReader y lee sin conexión los libros ya importados. Para descubrir y descargar libros nuevos necesitas conexión."],
    ],
    import: "Importar un EPUB", discover: "Descubrir libros", languages: "Idioma", skip: "Saltar al contenido",
    noScript: "Activa JavaScript para abrir EPUB en FastReader. Tus archivos se leen y guardan en tu dispositivo.",
  },
  it: {
    name: "Italiano", flag: "🇮🇹", ogLocale: "it_IT", file: "it.html",
    title: "FastReader — Lettura veloce EPUB gratis, al tuo ritmo",
    description: "Avanza nei tuoi libri con FastReader, il lettore EPUB gratuito: lettura veloce parola per parola, Focus e Classico. Su telefono, tablet e PC, senza account.",
    heading: "Leggi più velocemente. Finisci i libri che inizi.",
    intro: "Avanza nella tua lista di letture con la lettura veloce Parola per parola. Scegli il ritmo, scopri un libro o importa il tuo EPUB su telefono, tablet e computer.",
    features: [
      ["Lettura veloce, al tuo ritmo", "Visualizza una parola alla volta, regola la velocità e torna alla frase precedente quando vuoi. Passa a Focus o Classico in qualsiasi momento."],
      ["I tuoi libri, sempre a portata di mano", "Conserva libri, segnalibri e note senza creare un account. Esporta un backup per conservare la tua biblioteca."],
      ["Il comfort che preferisci", "Regola tema, dimensione del testo, interlinea e intensità Focus con un’anteprima immediata."],
      ["Leggi anche offline", "Installa FastReader e leggi offline i libri già importati. Per scoprire e scaricare nuovi libri serve una connessione."],
    ],
    import: "Importa un EPUB", discover: "Scopri i libri", languages: "Lingua", skip: "Vai al contenuto",
    noScript: "Attiva JavaScript per aprire gli EPUB in FastReader. I file vengono letti e conservati sul tuo dispositivo.",
  },
  de: {
    name: "Deutsch", flag: "🇩🇪", ogLocale: "de_DE", file: "de.html",
    title: "FastReader — Kostenloser EPUB-Schnellleser in deinem Tempo",
    description: "Komm mit deinen Büchern voran: FastReader bietet kostenloses EPUB-Schnelllesen Wort für Wort, Focus und Klassisch. Auf Handy, Tablet und PC, ohne Konto.",
    heading: "Lies schneller. Lies deine Bücher zu Ende.",
    intro: "Komm mit deiner Leseliste voran und lies schneller mit Wort für Wort. Wähle dein Tempo, entdecke ein Buch oder importiere dein EPUB auf Handy, Tablet und Computer.",
    features: [
      ["Schneller lesen, in deinem Tempo", "Zeige ein Wort nach dem anderen, passe das Tempo an und springe bei Bedarf zum vorherigen Satz zurück. Wechsle jederzeit zu Focus oder Klassisch."],
      ["Deine Bücher, jederzeit griffbereit", "Bewahre Bücher, Lesezeichen und Notizen auf, ohne ein Konto anzulegen. Exportiere eine Sicherung, um deine Bibliothek zu erhalten."],
      ["Lesekomfort nach deinen Wünschen", "Passe Design, Textgröße, Zeilenabstand und Focus-Stärke mit einer sofortigen Vorschau an."],
      ["Auch offline lesen", "Installiere FastReader und lies bereits importierte Bücher offline. Zum Entdecken und Herunterladen neuer Bücher brauchst du eine Verbindung."],
    ],
    import: "EPUB importieren", discover: "Bücher entdecken", languages: "Sprache", skip: "Zum Inhalt springen",
    noScript: "Aktiviere JavaScript, um EPUBs in FastReader zu öffnen. Deine Dateien werden auf deinem Gerät gelesen und gespeichert.",
  },
  pt: {
    name: "Português", flag: "🇵🇹", ogLocale: "pt_PT", file: "pt.html",
    title: "FastReader — Leitura rápida EPUB grátis, ao teu ritmo",
    description: "Avança nos teus livros com o FastReader, o leitor EPUB gratuito: leitura rápida palavra a palavra, Focus e Clássico. No telemóvel, tablet e PC, sem conta.",
    heading: "Lê mais depressa. Termina os livros que começas.",
    intro: "Avança na tua lista de leituras com a leitura rápida Palavra a palavra. Escolhe o ritmo, descobre um livro ou importa o teu EPUB no telemóvel, tablet ou computador.",
    features: [
      ["Leitura rápida, ao teu ritmo", "Apresenta uma palavra de cada vez, ajusta a velocidade e regressa à frase anterior quando precisares. Muda para Focus ou Clássico a qualquer momento."],
      ["Os teus livros, sempre à mão", "Guarda livros, marcadores e notas sem criar uma conta. Exporta uma cópia de segurança para preservar a tua biblioteca."],
      ["Conforto à tua medida", "Ajusta o tema, o tamanho do texto, o espaçamento entre linhas e a intensidade do Focus com uma pré-visualização imediata."],
      ["Lê também sem ligação", "Instala o FastReader e lê offline os livros já importados. Para descobrir e descarregar novos livros, é necessária uma ligação."],
    ],
    import: "Importar um EPUB", discover: "Descobrir livros", languages: "Idioma", skip: "Saltar para o conteúdo",
    noScript: "Ativa o JavaScript para abrir EPUB no FastReader. Os teus ficheiros são lidos e guardados no teu dispositivo.",
  },
};

export function normalizeSiteUrl(value = DEFAULT_SITE_URL) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("VITE_SITE_URL must be an absolute HTTP(S) URL without credentials, query or fragment.");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

export function languageUrl(language, siteUrl = DEFAULT_SITE_URL) {
  return new URL(language === "fr" ? "./" : SEO_LANGUAGES[language]?.file || "./", normalizeSiteUrl(siteUrl)).href;
}

export function languageFromPath(pathname = "/") {
  return /\/(en|es|it|de|pt)\.html$/.exec(pathname)?.[1] || "fr";
}

export function applicationSchema(language, siteUrl = DEFAULT_SITE_URL) {
  const data = SEO_LANGUAGES[language] || SEO_LANGUAGES.fr;
  return {
    "@context": "https://schema.org", "@type": "WebApplication",
    name: "FastReader", url: languageUrl(language, siteUrl), description: data.description,
    inLanguage: language, applicationCategory: "EducationalApplication",
    operatingSystem: "Web", isAccessibleForFree: true,
    featureList: data.features.map(([title]) => title),
  };
}
