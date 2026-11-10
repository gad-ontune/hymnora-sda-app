/**
 * Bible content loaded from the HelloAO API (bible.helloao.org).
 *
 * The HelloAO API exposes translations, books, chapters, commentaries
 * and datasets as JSON endpoints. This module proxies them so the
 * frontend talks to `/api/bible/...` instead of calling HelloAO directly.
 */

// global fetch available

const BASE = "https://bible.helloao.org";

export interface HelloAOTranslation {
  id: string;
  name: string;
  website: string;
  licenseUrl: string;
  shortName: string;
  englishName: string;
  language: string;
  textDirection: "ltr" | "rtl";
  sha256: string;
  availableFormats: string[];
  listOfBooksApiLink: string;
  completeTranslationApiLink: string;
  simpleCompleteTranslationApiLink: string;
  /** The language's own name for itself, e.g. "Oromoo" for Oromo. */
  languageName?: string;
  /** The English name for the language, e.g. "Oromo". */
  languageEnglishName?: string;
  numberOfBooks: number;
  totalNumberOfChapters: number;
  totalNumberOfVerses: number;
}

export interface HelloAOBook {
  id: string;
  translationId: string;
  name: string;
  commonName: string;
  title: string;
  order: number;
  numberOfChapters: number;
  sha256: string;
  firstChapterNumber: number;
  firstChapterApiLink: string;
  lastChapterNumber: number;
  lastChapterApiLink: string;
  totalNumberOfVerses: number;
}

export interface HelloAOChapter {
  translation: Record<string, unknown>;
  book: Record<string, unknown>;
  chapter: Record<string, unknown>;
  thisChapterLink: string;
  thisChapterReference: Record<string, unknown>;
  thisChapterAudioLinks: Record<string, unknown>;
  nextChapterApiLink: string | null;
  nextChapterReference: Record<string, unknown> | null;
  previousChapterApiLink: string | null;
  previousChapterReference: Record<string, unknown> | null;
  numberOfVerses: number;
}

export interface HelloAOCommentary {
  id: string;
  name: string;
  website: string;
  licenseUrl: string;
  englishName: string;
  language: string;
  textDirection: string;
}

export interface HelloAODataset {
  id: string;
  name: string;
  website: string;
  licenseUrl: string;
  englishName: string;
  language: string;
  textDirection: string;
  listOfBooksApiLink: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`HelloAO ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchTranslations(): Promise<HelloAOTranslation[]> {
  const d = await get<{ translations: HelloAOTranslation[] }>("/api/available_translations.json");
  return d.translations;
}

export async function fetchBooks(translation: string): Promise<{ translation: HelloAOTranslation; books: HelloAOBook[] }> {
  return get(`/api/${translation}/books.json`);
}

export async function fetchChapter(translation: string, book: string, chapter: number): Promise<HelloAOChapter> {
  return get(`/api/${translation}/${book}/${chapter}.json`);
}

/**
 * A whole translation in one request, via `complete.json`. This is what makes
 * local seeding practical: pulling a Bible chapter by chapter is 1,189 requests
 * per translation, whereas this is one ~6 MB response.
 */
export async function fetchCompleteTranslation(translation: string): Promise<unknown> {
  return get(`/api/${translation}/complete.json`);
}

export async function fetchCommentaries(): Promise<{ commentaries: HelloAOCommentary[] }> {
  return get("/api/available_commentaries.json");
}

export async function fetchCommentaryBooks(commentary: string): Promise<{ commentary: HelloAOCommentary; books: HelloAOBook[] }> {
  return get(`/api/c/${commentary}/books.json`);
}

export async function fetchCommentaryChapter(commentary: string, book: string, chapter: number): Promise<HelloAOChapter> {
  return get(`/api/c/${commentary}/${book}/${chapter}.json`);
}

export async function fetchDatasets(): Promise<{ datasets: HelloAODataset[] }> {
  return get("/api/available_datasets.json");
}

export async function fetchDatasetBooks(dataset: string): Promise<{ dataset: HelloAODataset; books: HelloAOBook[] }> {
  return get(`/api/d/${dataset}/books.json`);
}

export async function fetchDatasetChapter(dataset: string, book: string, chapter: number): Promise<HelloAOChapter> {
  return get(`/api/d/${dataset}/${book}/${chapter}.json`);
}
