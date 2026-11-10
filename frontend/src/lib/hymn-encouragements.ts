/**
 * Words for the rotating card at the top of the hymns page.
 *
 * Everything about that card lives here: the messages, the colour each one
 * paints the card, and how long a message stays up. To change what the card
 * says, edit this file — no component changes needed.
 *
 * `tone` holds real Tailwind class names rather than token names on purpose:
 * Tailwind only emits classes it can see as complete strings, so a colour
 * cannot be looked up dynamically.
 */
export type QuoteTone = {
  /** Background of the card. */
  card: string;
  /** The small uppercase line above the headline. */
  eyebrow: string;
  /** The supporting line under the headline. */
  body: string;
  /** The two decorative circles. */
  deco: string;
};

export type Encouragement = {
  eyebrow: string;
  title: string;
  body: string;
  tone: QuoteTone;
};

/** Shared styling for the decorative circles, tinted per tone. */
const deco = "border-white/10";

export const ENCOURAGEMENTS: Encouragement[] = [
  {
    eyebrow: "A song for the in-between",
    title: "Let the next verse be a place to breathe.",
    body: "Find a tune, follow a theme, or simply wander until something finds you.",
    tone: { card: "bg-sage", eyebrow: "text-gold-light", body: "text-white/65", deco },
  },
  {
    eyebrow: "Sing it the way you learned it",
    title: "Some songs survive the singing.",
    body: "Two hundred years on, a congregation still rises on the same first line.",
    tone: { card: "bg-[#2f4433]", eyebrow: "text-gold-light", body: "text-white/65", deco },
  },
  {
    eyebrow: "Twenty-three languages, one hymnal",
    title: "Every language carries a whole world.",
    body: "Dholuo, Abagusii, Kikuyu, Kiswahili, English and more — pick yours and begin there.",
    tone: { card: "bg-[#2f5150]", eyebrow: "text-gold-light", body: "text-white/70", deco },
  },
  {
    eyebrow: "Take your time",
    title: "No verse is going anywhere.",
    body: "The hymnal will wait. So will the people you are singing it for.",
    tone: { card: "bg-ink", eyebrow: "text-gold-light", body: "text-white/60", deco },
  },
  {
    eyebrow: "For the quiet morning",
    title: "Faith is often just a habit of returning.",
    body: "Come back to the same words until they hold you instead of the other way round.",
    tone: { card: "bg-[#3c4a63]", eyebrow: "text-gold-light", body: "text-white/70", deco },
  },
  {
    eyebrow: "Sung in a hundred tongues",
    title: "The tune travels further than the words.",
    body: "You may not know every word, and you will still know the song.",
    tone: { card: "bg-terracotta", eyebrow: "text-gold-light", body: "text-white/75", deco },
  },
  {
    eyebrow: "A place to begin",
    title: "Start with the hymn you remember.",
    body: "The one your grandmother sang. The one you hummed without knowing why.",
    tone: { card: "bg-[#5b4632]", eyebrow: "text-gold-light", body: "text-white/70", deco },
  },
  {
    eyebrow: "When the road is long",
    title: "Sing the second verse as well.",
    body: "Most of what needs saying is said a little further in.",
    tone: { card: "bg-[#5b3a4a]", eyebrow: "text-gold-light", body: "text-white/70", deco },
  },
  {
    eyebrow: "For the whole family",
    title: "Let the children learn it by heart.",
    body: "One day they will sing it back to you, and you will not remember the words either.",
    tone: { card: "bg-[#7a5c1f]", eyebrow: "text-gold-light", body: "text-white/75", deco },
  },
  {
    eyebrow: "Come as you are",
    title: "An off-key hour is still a holy hour.",
    body: "Nobody has ever sung these songs perfectly. That was never the point.",
    tone: { card: "bg-[#39616b]", eyebrow: "text-gold-light", body: "text-white/70", deco },
  },
];

/** How long a message stays on the card before the words and colour change. */
export const ROTATE_MS = 90 * 1000;
