"use client";

/**
 * The whole application's language and its "dress": the two preferences every
 * page can see at once.
 *
 * Theme ─────────────────────────────────────────────────────────────────────
 * The preference value is one of light | warm | dark | sanctuary | garden |
 * sunset | midnight | system. `system` is the only value that is not a real
 * look — it resolves to light or dark by reading the OS colour scheme, and
 * keeps listening in case the OS scheme changes while the app is open. Whatever
 * the preference is, the resolved leaf (never the word "system") is written to
 * <html data-theme>, which is what globals.css keys its variable overrides on.
 *
 * Language ──────────────────────────────────────────────────────────────────
 * Four languages, keyed by the same display names the backend stores in
 * user_preferences.language (English / Kiswahili / French / Spanish) so the
 * saved value round-trips with no mapping. It is remembered on this browser via
 * localStorage so it survives sign-out, and pushed to the account when one is
 * signed in.
 *
 * The dictionary covers the application chrome — the rail, the header, the
 * mobile sheets, the player — the surfaces that are on every page whatever the
 * content is. Content (hymns, sermons, Bible text, church listings) stays as it
 * was authored; translating stored content would be a data concern, not a UI
 * one.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { updatePreferences } from "@/lib/session-store";

export const LANGUAGES = ["English", "Kiswahili", "French", "Spanish"] as const;
export type Language = (typeof LANGUAGES)[number];

export const THEME_CHOICES = [
  "light",
  "warm",
  "dark",
  "sanctuary",
  "garden",
  "sunset",
  "midnight",
  "system",
] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];
export type ResolvedTheme = Exclude<ThemeChoice, "system">;

const THEME_KEY = "hymnora.theme";
const LANG_KEY = "hymnora.lang";

export const LANGUAGE_CODES: Record<Language, string> = {
  English: "en",
  Kiswahili: "sw",
  French: "fr",
  Spanish: "es",
};

/** How each language names itself — the one label that never translates. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  English: "English",
  Kiswahili: "Kiswahili",
  French: "Français",
  Spanish: "Español",
};

const hebrew = {
  "nav.home": "Home",
  "nav.music": "Music",
  "nav.videos": "Videos",
  "nav.hymns": "Hymns",
  "nav.bible": "Bible",
  "nav.sermons": "Sermons",
  "nav.news": "News",
  "nav.reels": "Reels",
  "nav.churches": "Churches",
  "nav.events": "Events",
  "nav.live": "Live",
  "nav.library": "Library",
  "nav.settings": "Settings",
  "nav.search": "Search",
  "nav.more": "More",
  "nav.newsReels": "News & Reels",
  "group.discover": "Discover",
  "group.yourSpace": "Your space",
  "brand.slogan": "The SDA Digital Platform",
  "header.searchPlaceholder": "Search hymns, sermons, churches, John 3:16…",
  "aria.search": "Search",
  "aria.openNavigation": "Open navigation",
  "aria.closeNavigation": "Close navigation",
  "aria.changeLanguage": "Change language",
  "aria.reminders": "Reminders and settings",
  "aria.mobileNav": "Mobile navigation",
  "aria.primaryNav": "Primary navigation",
  "reminder.title": "Today's gentle reminder",
  "reminder.body": "Make room for stillness before the day asks for your attention.",
  "player.pause": "Pause",
  "player.play": "Play",
  "player.next": "Next",
  "player.previous": "Previous",
  "player.seek": "Seek",
  "player.volume": "Volume",
  "player.mute": "Mute",
  "player.unmute": "Unmute",
  "player.openPlayer": "Open the player",
  "player.minimise": "Minimise the player",
  "player.close": "Close the player",
  "player.nowPlaying": "Now playing",
  "player.openHymn": "Open hymn",
  "player.lyrics": "Lyrics",
  "player.queue": "Queue",
  "player.sleep": "Sleep",
  "player.speed": "Speed",
  "player.saved": "Saved",
  "player.favourite": "Favourite",
  "player.upNext": "Up next · ",
  "player.songs": "songs",
  "player.song": "song",
  "player.manageQueue": "Manage the queue",
  "player.clearQueue": "Clear queue",
  "player.sleepTimer": "Sleep timer",
  "player.left": "left",
  "player.turnOffSleep": "Turn off sleep timer",
  "player.back10": "Back 10 seconds",
  "player.forward10": "Forward 10 seconds",
  "kind.hymn": "Hymn",
  "kind.sermon": "Sermon",
  "settings.appearance": "Appearance",
  "settings.atmosphere": "Reading atmosphere",
  "settings.platformLang": "Platform language",
  "settings.browseHint": "Switching to Kiswahili also sets your default Bible reading to NZK.",
  "settings.themeSystem": "System",
  "settings.themeCanvas": "Canvas",
  "settings.themeWarm": "Warm",
  "settings.themeDusk": "Dusk",
  "settings.themeSanctuary": "Sanctuary",
  "settings.themeGarden": "Garden",
  "settings.themeSunset": "Sunset",
  "settings.themeMidnight": "Midnight",
} as const;

export type MessageKey = keyof typeof hebrew;

const swahili: Record<MessageKey, string> = {
  "nav.home": "Nyumbani",
  "nav.music": "Muziki",
  "nav.videos": "Video",
  "nav.hymns": "Nyimbo",
  "nav.bible": "Biblia",
  "nav.sermons": "Mahubiri",
  "nav.news": "Habari",
  "nav.reels": "Reels",
  "nav.churches": "Makanisa",
  "nav.events": "Matukio",
  "nav.live": "Moja kwa moja",
  "nav.library": "Maktaba",
  "nav.settings": "Mipangilio",
  "nav.search": "Tafuta",
  "nav.more": "Zaidi",
  "nav.newsReels": "Habari na Reels",
  "group.discover": "Gundua",
  "group.yourSpace": "Nafasi yako",
  "brand.slogan": "Jukwaa la Kidijitali la SDA",
  "header.searchPlaceholder": "Tafuta nyimbo, mahubiri, makanisa, Yohana 3:16…",
  "aria.search": "Tafuta",
  "aria.openNavigation": "Fungua urambazaji",
  "aria.closeNavigation": "Funga urambazaji",
  "aria.changeLanguage": "Badilisha lugha",
  "aria.reminders": "Vikumbusho na mipangilio",
  "aria.mobileNav": "Urambazaji wa simu",
  "aria.primaryNav": "Urambazaji mkuu",
  "reminder.title": "Kikumbusho cha leo",
  "reminder.body": "Weka kando wakati wa utulivu kabla ya siku kudai umakini wako.",
  "player.pause": "Sitisha",
  "player.play": "Cheza",
  "player.next": "Inayofuata",
  "player.previous": "Iliyotangulia",
  "player.seek": "Tafuta",
  "player.volume": "Sauti",
  "player.mute": "Nyamazisha",
  "player.unmute": "Rudisha sauti",
  "player.openPlayer": "Fungua mchezaji",
  "player.minimise": "Punguza mchezaji",
  "player.close": "Funga mchezaji",
  "player.nowPlaying": "Inacheza sasa",
  "player.openHymn": "Fungua wimbo",
  "player.lyrics": "Maneno",
  "player.queue": "Orodha",
  "player.sleep": "Lala",
  "player.speed": "Kasi",
  "player.saved": "Imehifadhiwa",
  "player.favourite": "Penda",
  "player.upNext": "Zijazo · ",
  "player.songs": "nyimbo",
  "player.song": "wimbo",
  "player.manageQueue": "Dhibiti orodha",
  "player.clearQueue": "Futa orodha",
  "player.sleepTimer": "Kipima muda cha kulala",
  "player.left": "kimesalia",
  "player.turnOffSleep": "Zima kipima cha kulala",
  "player.back10": "Rudi sekunde 10",
  "player.forward10": "Mbele sekunde 10",
  "kind.hymn": "Wimbo",
  "kind.sermon": "Hubiri",
  "settings.appearance": "Muonekano",
  "settings.atmosphere": "Mazingira ya kusoma",
  "settings.platformLang": "Lugha ya jukwaa",
  "settings.browseHint": "Kubadilisha hadi Kiswahili pia huweka usomaji wako wa Biblia kuwa NZK.",
  "settings.themeSystem": "Mfumo",
  "settings.themeCanvas": "Canvas",
  "settings.themeWarm": "Joto",
  "settings.themeDusk": "Jioni",
  "settings.themeSanctuary": "Patakatifu",
  "settings.themeGarden": "Bustani",
  "settings.themeSunset": "Machweo",
  "settings.themeMidnight": "Usiku wa manane",
};

const french: Record<MessageKey, string> = {
  "nav.home": "Accueil",
  "nav.music": "Musique",
  "nav.videos": "Vidéos",
  "nav.hymns": "Cantiques",
  "nav.bible": "Bible",
  "nav.sermons": "Sermons",
  "nav.news": "Actualités",
  "nav.reels": "Reels",
  "nav.churches": "Églises",
  "nav.events": "Événements",
  "nav.live": "En direct",
  "nav.library": "Bibliothèque",
  "nav.settings": "Paramètres",
  "nav.search": "Rechercher",
  "nav.more": "Plus",
  "nav.newsReels": "Actualités et reels",
  "group.discover": "Découvrir",
  "group.yourSpace": "Votre espace",
  "brand.slogan": "La plateforme numérique SDA",
  "header.searchPlaceholder": "Rechercher cantiques, sermons, églises, Jean 3:16…",
  "aria.search": "Rechercher",
  "aria.openNavigation": "Ouvrir la navigation",
  "aria.closeNavigation": "Fermer la navigation",
  "aria.changeLanguage": "Changer la langue",
  "aria.reminders": "Rappels et paramètres",
  "aria.mobileNav": "Navigation mobile",
  "aria.primaryNav": "Navigation principale",
  "reminder.title": "Le rappel doux du jour",
  "reminder.body": "Faites de la place au calme avant que la journée ne demande votre attention.",
  "player.pause": "Pause",
  "player.play": "Lecture",
  "player.next": "Suivant",
  "player.previous": "Précédent",
  "player.seek": "Rechercher",
  "player.volume": "Volume",
  "player.mute": "Couper le son",
  "player.unmute": "Rétablir le son",
  "player.openPlayer": "Ouvrir le lecteur",
  "player.minimise": "Réduire le lecteur",
  "player.close": "Fermer le lecteur",
  "player.nowPlaying": "En cours de lecture",
  "player.openHymn": "Ouvrir le cantique",
  "player.lyrics": "Paroles",
  "player.queue": "File d'attente",
  "player.sleep": "Minuteur",
  "player.speed": "Vitesse",
  "player.saved": "Enregistré",
  "player.favourite": "Favori",
  "player.upNext": "À suivre · ",
  "player.songs": "titres",
  "player.song": "titre",
  "player.manageQueue": "Gérer la file",
  "player.clearQueue": "Vider la file",
  "player.sleepTimer": "Minuteur de sommeil",
  "player.left": "restant",
  "player.turnOffSleep": "Désactiver le minuteur",
  "player.back10": "Reculer de 10 secondes",
  "player.forward10": "Avancer de 10 secondes",
  "kind.hymn": "Cantique",
  "kind.sermon": "Sermon",
  "settings.appearance": "Apparence",
  "settings.atmosphere": "Ambiance de lecture",
  "settings.platformLang": "Langue de la plateforme",
  "settings.browseHint": "Passer en kiswahili définit aussi votre lecture biblique par défaut en NZK.",
  "settings.themeSystem": "Système",
  "settings.themeCanvas": "Toile",
  "settings.themeWarm": "Chaleureux",
  "settings.themeDusk": "Crépuscule",
  "settings.themeSanctuary": "Sanctuaire",
  "settings.themeGarden": "Jardin",
  "settings.themeSunset": "Coucher de soleil",
  "settings.themeMidnight": "Minuit",
};

const spanish: Record<MessageKey, string> = {
  "nav.home": "Inicio",
  "nav.music": "Música",
  "nav.videos": "Videos",
  "nav.hymns": "Himnos",
  "nav.bible": "Biblia",
  "nav.sermons": "Sermones",
  "nav.news": "Noticias",
  "nav.reels": "Reels",
  "nav.churches": "Iglesias",
  "nav.events": "Eventos",
  "nav.live": "En vivo",
  "nav.library": "Biblioteca",
  "nav.settings": "Ajustes",
  "nav.search": "Buscar",
  "nav.more": "Más",
  "nav.newsReels": "Noticias y reels",
  "group.discover": "Descubrir",
  "group.yourSpace": "Tu espacio",
  "brand.slogan": "La plataforma digital SDA",
  "header.searchPlaceholder": "Buscar himnos, sermones, iglesias, Juan 3:16…",
  "aria.search": "Buscar",
  "aria.openNavigation": "Abrir navegación",
  "aria.closeNavigation": "Cerrar navegación",
  "aria.changeLanguage": "Cambiar idioma",
  "aria.reminders": "Recordatorios y ajustes",
  "aria.mobileNav": "Navegación móvil",
  "aria.primaryNav": "Navegación principal",
  "reminder.title": "El recordatorio suave de hoy",
  "reminder.body": "Haz espacio para la quietud antes de que el día pida tu atención.",
  "player.pause": "Pausa",
  "player.play": "Reproducir",
  "player.next": "Siguiente",
  "player.previous": "Anterior",
  "player.seek": "Buscar",
  "player.volume": "Volumen",
  "player.mute": "Silenciar",
  "player.unmute": "Activar sonido",
  "player.openPlayer": "Abrir el reproductor",
  "player.minimise": "Minimizar reproductor",
  "player.close": "Cerrar reproductor",
  "player.nowPlaying": "Reproduciendo",
  "player.openHymn": "Abrir himno",
  "player.lyrics": "Letra",
  "player.queue": "Cola",
  "player.sleep": "Dormir",
  "player.speed": "Velocidad",
  "player.saved": "Guardado",
  "player.favourite": "Favorito",
  "player.upNext": "A continuación · ",
  "player.songs": "canciones",
  "player.song": "canción",
  "player.manageQueue": "Gestionar la cola",
  "player.clearQueue": "Vaciar la cola",
  "player.sleepTimer": "Temporizador de sueño",
  "player.left": "restante",
  "player.turnOffSleep": "Apagar temporizador",
  "player.back10": "Atrás 10 segundos",
  "player.forward10": "Adelante 10 segundos",
  "kind.hymn": "Himno",
  "kind.sermon": "Sermón",
  "settings.appearance": "Apariencia",
  "settings.atmosphere": "Ambiente de lectura",
  "settings.platformLang": "Idioma de la plataforma",
  "settings.browseHint": "Cambiar a kiswahili también define tu lectura bíblica predeterminada en NZK.",
  "settings.themeSystem": "Sistema",
  "settings.themeCanvas": "Lienzo",
  "settings.themeWarm": "Cálido",
  "settings.themeDusk": "Ocaso",
  "settings.themeSanctuary": "Santuario",
  "settings.themeGarden": "Jardín",
  "settings.themeSunset": "Atardecer",
  "settings.themeMidnight": "Medianoche",
};

export const DICTIONARIES: Record<Language, Record<MessageKey, string>> = {
  English: hebrew,
  Kiswahili: swahili,
  French: french,
  Spanish: spanish,
};

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Preferences simply will not be remembered on this browser. */
  }
}

/** Reads the OS colour scheme. Only meaningful while `system` is chosen. */
function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(choice: ThemeChoice, osDark: boolean): ResolvedTheme {
  if (choice === "system") return osDark ? "dark" : "light";
  return choice;
}

function applyTheme(choice: ThemeChoice): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolveTheme(choice, systemPrefersDark());
}

/**
 * The dress as an external store, built the same way as the session store.
 *
 * `useSyncExternalStore` is the one hook that can serve the server a different
 * answer from the browser without a hydration mismatch: SSR and the hydration
 * pass take `getServerSnapshot` (the platform defaults), then once the tree is
 * live React switches to the localStorage-backed snapshot. That is why the
 * Settings swatches agree with the server HTML on first paint and settle on the
 * visitor's saved choice a moment later — with no setState in an effect, and no
 * visible flash because the inline head script painted that saved choice before
 * hydration began.
 */
type Dress = { language: Language; theme: ThemeChoice };
const DEFAULT_DRESS: Dress = { language: "English", theme: "warm" };
let dressSnapshot: Dress = DEFAULT_DRESS;
let dressLoaded = false;
const dressListeners = new Set<() => void>();

function dressFromStorage(): Dress {
  const storedTheme = readStorage(THEME_KEY);
  const storedLanguage = readStorage(LANG_KEY);
  return {
    theme: (THEME_CHOICES as readonly string[]).includes(storedTheme ?? "") ? (storedTheme as ThemeChoice) : "warm",
    language: (LANGUAGES as readonly string[]).includes(storedLanguage ?? "") ? (storedLanguage as Language) : "English",
  };
}

function getDressSnapshot(): Dress {
  if (!dressLoaded) {
    dressLoaded = true;
    dressSnapshot = dressFromStorage();
  }
  return dressSnapshot;
}

function getDressServerSnapshot(): Dress {
  return DEFAULT_DRESS;
}

function subscribeDress(listener: () => void): () => void {
  dressListeners.add(listener);
  return () => {
    dressListeners.delete(listener);
  };
}

function writeDress(patch: Partial<Dress>): void {
  dressSnapshot = { ...dressSnapshot, ...patch };
  if (patch.theme !== undefined) writeStorage(THEME_KEY, patch.theme);
  if (patch.language !== undefined) writeStorage(LANG_KEY, patch.language);
  dressListeners.forEach((listener) => listener());
}

/** The OS scheme is a second external store: it can change while the app is open. */
let osDarkSnapshot: boolean | null = null;
const osDarkListeners = new Set<() => void>();

function getOsDarkSnapshot(): boolean {
  if (osDarkSnapshot === null) osDarkSnapshot = systemPrefersDark();
  return osDarkSnapshot;
}

function getOsDarkServerSnapshot(): boolean {
  return false;
}

function subscribeOsDark(listener: () => void): () => void {
  osDarkListeners.add(listener);
  return () => {
    osDarkListeners.delete(listener);
  };
}

function refreshOsDark(): void {
  const next = systemPrefersDark();
  if (next === osDarkSnapshot) return;
  osDarkSnapshot = next;
  osDarkListeners.forEach((listener) => listener());
}

type AppCharmContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: MessageKey) => string;
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
  /** The look actually on screen — "system" never appears here. */
  resolvedTheme: ResolvedTheme;
};

const AppCharmContext = createContext<AppCharmContextValue | null>(null);

export function AppCharmProvider({ children }: { children: React.ReactNode }) {
  const dress = useSyncExternalStore(subscribeDress, getDressSnapshot, getDressServerSnapshot);
  const osDark = useSyncExternalStore(subscribeOsDark, getOsDarkSnapshot, getOsDarkServerSnapshot);
  const { language, theme } = dress;
  const mounted = useRef(false);

  // Re-apply on later changes only. On the very first mount the head script has
  // already resolved "system" and set data-theme correctly; painting the default
  // here would overwrite a returning visitor's stored look for a frame.
  useEffect(() => {
    if (!mounted.current) return;
    applyTheme(theme);
  }, [theme, osDark]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => refreshOsDark();
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    if (!mounted.current) return;
    document.documentElement.lang = LANGUAGE_CODES[language];
  }, [language]);

  // Declared last so the effects above see `false` on the first mount (the head
  // script's paint stands) and `true` on the re-render that loads the stored copy.
  useEffect(() => {
    mounted.current = true;
  }, []);

  const setTheme = useCallback(
    (next: ThemeChoice) => {
      writeDress({ theme: next });
      applyTheme(next);
      // Fire-and-forget: the setting applies on this browser regardless, and
      // the account copy is best effort for whoever is signed in.
      void updatePreferences({ theme: next });
    },
    [],
  );

  const setLanguage = useCallback(
    (next: Language) => {
      writeDress({ language: next });
      document.documentElement.lang = LANGUAGE_CODES[next];
      void updatePreferences({ language: next });
    },
    [],
  );

  const t = useCallback((key: MessageKey): string => DICTIONARIES[language][key] ?? hebrew[key] ?? key, [language]);

  const value = useMemo<AppCharmContextValue>(
    () => ({ language, setLanguage, t, theme, setTheme, resolvedTheme: resolveTheme(theme, osDark) }),
    [language, osDark, setLanguage, setTheme, t, theme],
  );

  return <AppCharmContext.Provider value={value}>{children}</AppCharmContext.Provider>;
}

export function useAppCharm(): AppCharmContextValue {
  const context = useContext(AppCharmContext);
  if (!context) throw new Error("useAppCharm must be used within AppCharmProvider");
  return context;
}

/** Theme choice + the resolved look, for places that only care about the dress. */
export function useTheme(): Pick<AppCharmContextValue, "theme" | "resolvedTheme" | "setTheme"> {
  const { theme, resolvedTheme, setTheme } = useAppCharm();
  return { theme, resolvedTheme, setTheme };
}

/** Language plus the translator, for the chrome. */
export function useI18n(): Pick<AppCharmContextValue, "language" | "setLanguage" | "t"> {
  const { language, setLanguage, t } = useAppCharm();
  return { language, setLanguage, t };
}