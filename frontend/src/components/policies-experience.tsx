"use client";

/**
 * Terms, privacy, and what the site actually stores.
 *
 * These are linked from the sign-in page, so they are part of the deal rather
 * than a document nobody opens. The wording is deliberately concrete: it names
 * the things this codebase really does — a token in localStorage, note drafts
 * kept on the device, videos embedded from YouTube, push subscriptions on a
 * server — because a privacy page that describes a different product is worse
 * than no privacy page at all.
 */

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Check, Cookie, FileText, LockKeyhole, ShieldCheck, Users } from "lucide-react";

type Policy = { id: string; label: string; icon: typeof FileText; blurb: string; sections: { heading: string; body: string[] }[] };

const POLICIES: Policy[] = [
  {
    id: "terms",
    label: "Terms of use",
    icon: FileText,
    blurb: "What you agree to when you use Hymnora SDA.",
    sections: [
      {
        heading: "What this platform is",
        body: [
          "Hymnora SDA is a digital home for Seventh-day Adventist media and community: music, hymns, sermons, Bible reading, church listings, events, news and short-form video. It is built and run for the church, not as a commercial product.",
          "Accounts are free. There is no paid tier, no card, and nothing on this site is for sale.",
        ],
      },
      {
        heading: "Your account",
        body: [
          "You are responsible for what happens under your account: keep your password to yourself, and tell us if you think someone else has it. One account per person is the intent — creating many accounts to inflate a like count or a comment thread works against the community this is for.",
          "You can close your account at any time from Settings. Closing it removes your profile and your notes.",
        ],
      },
      {
        heading: "What you post",
        body: [
          "Notes, comments and anything else you write stays yours. By posting it here you allow us to store it and show it to other people on this platform — that is what a comment is.",
          "Do not post material you do not have the right to share, and do not post material that is hateful toward anyone. Comments and notes that abuse people are removed.",
        ],
      },
      {
        heading: "Media we host or embed",
        body: [
          "Music and video are played from YouTube. The video is requested from YouTube by your browser, which means YouTube sees your request under its own privacy policy — this is stated here rather than left for you to discover.",
          "Album art, church photos and news images are served from this site or from the source that supplied them.",
        ],
      },
      {
        heading: "Availability",
        body: [
          "The platform is offered as it is. We aim for it to be dependable and we fix what breaks, but there is no service-level promise, and features can change as the platform grows.",
        ],
      },
    ],
  },
  {
    id: "privacy",
    label: "Privacy",
    icon: ShieldCheck,
    blurb: "What is collected, why, and how to have it removed.",
    sections: [
      {
        heading: "What an account holds",
        body: [
          "Your email address, first and last name, an optional display name, bio, home church, city, country and language. Your password is hashed and the plain version is never stored.",
          "Your library — favourites, notes, highlights and reading history — is stored against your account so it follows you between devices. It is not visible to anyone but you.",
        ],
      },
      {
        heading: "What stays on your device",
        body: [
          "Session tokens, your volume and playback preferences, and drafts of notes you have not saved yet are kept in this browser's local storage. Clearing site data signs you out and removes the unsaved drafts.",
          "Nothing on this list is sent anywhere while you type it. A note draft becomes a server record only when you save it.",
        ],
      },
      {
        heading: "Who can see what",
        body: [
          "Your name and profile photo appear beside things you post publicly. Your email address never appears publicly, and it is not shown to other members.",
          "Church and event listings are public information about organisations, published with their knowledge.",
        ],
      },
      {
        heading: "Third parties",
        body: [
          "YouTube receives the request for every video played here, and its own policies then apply. Push notifications are delivered through a web push service that sees only the encrypted subscription it sends and the notification content.",
          "We do not sell data, and we do not run third-party advertising trackers on this site.",
        ],
      },
      {
        heading: "Your choices",
        body: [
          "Ask for a copy of your data, correct anything wrong, or have the account deleted. Write to the church media team and it will be done; deletion removes the account, its notes and its history.",
        ],
      },
    ],
  },
  {
    id: "cookies",
    label: "Cookies & storage",
    icon: Cookie,
    blurb: "The handful of things this site stores in your browser.",
    sections: [
      {
        heading: "What is stored",
        body: [
          "A session token, so you stay signed in between visits. A refresh token, so you are not asked for your password every time the short-lived one expires. Volume, theme and the position of the notepad.",
          "Push notification subscriptions, for as long as reminders are switched on.",
        ],
      },
      {
        heading: "Advertising and analytics",
        body: [
          "There are none. No advertising cookies, no cross-site trackers, no third-party analytics script on this site. That is why the list above is this short.",
        ],
      },
      {
        heading: "Removing them",
        body: [
          "Clearing site data in your browser removes all of it at once: you are signed out, preferences are back to their defaults, and unsaved note drafts are gone. Preferences can be changed at any time from Settings without losing anything.",
        ],
      },
    ],
  },
  {
    id: "safety",
    label: "Community",
    icon: Users,
    blurb: "How the church is looked after here.",
    sections: [
      {
        heading: "Reporting",
        body: [
          "Every comment, note and profile can be reported. Reports go to the church media team, who can remove content and, in repeated cases, suspend an account.",
        ],
      },
      {
        heading: "Modest expectations",
        body: [
          "This is a church platform, and it is moderated as one. Content that is unkind, political campaigning, commercial spam, or material that sexualises minors is removed without discussion.",
        ],
      },
    ],
  },
];

export function PoliciesExperience() {
  const [active, setActive] = useState(POLICIES[0].id);
  const policy = POLICIES.find((item) => item.id === active) ?? POLICIES[0];
  const ActiveIcon = policy.icon;

  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas">
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 size-[480px] rounded-full bg-gold-soft/45 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-52 right-0 size-[520px] rounded-full bg-sage-soft/50 blur-3xl" />

      <div className="relative mx-auto max-w-[1080px] px-5 py-8 sm:px-8 lg:py-14">
        <Link href="/" className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink-muted transition hover:text-ink">
          <ArrowLeft size={15} /> Back to Hymnora
        </Link>

        <div className="mt-8 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-ink-fill font-display text-xl font-semibold text-gold-light">H</span>
          <div>
            <h1 className="font-display text-[30px] font-semibold tracking-[-0.02em] sm:text-[36px]">Policies</h1>
            <p className="mt-0.5 text-[13.5px] text-ink-muted">
              What you agree to, what is kept, and how to have it removed. Written to be read.
            </p>
          </div>
        </div>

        <div className="mt-10 grid gap-7 lg:grid-cols-[248px_1fr] lg:gap-10">
          <nav className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0" aria-label="Policies">
            {POLICIES.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === active;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActive(item.id)}
                  aria-current={isActive ? "true" : undefined}
                  className={`flex shrink-0 items-center gap-2.5 rounded-2xl border px-4 py-3 text-left transition ${
                    isActive
                      ? "border-gold/45 bg-surface text-ink shadow-soft"
                      : "border-line/70 bg-surface/60 text-ink-muted hover:border-line hover:text-ink"
                  }`}
                >
                  <Icon size={17} className={isActive ? "text-gold" : ""} />
                  <span className="whitespace-nowrap text-[13.5px] font-semibold">{item.label}</span>
                </button>
              );
            })}

            <div className="mt-2 hidden rounded-2xl border border-line/70 bg-surface/60 p-4 lg:block">
              <p className="flex items-center gap-2 text-[12px] font-semibold text-sage">
                <LockKeyhole size={14} /> No ad trackers
              </p>
              <p className="mt-1.5 text-[12px] leading-5 text-ink-muted">
                The whole list of what this site stores is three lines long, and it is on the cookies page.
              </p>
            </div>
          </nav>

          <article className="rounded-[26px] border border-line bg-surface p-6 shadow-soft sm:p-9">
            <header className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gold-soft text-ink">
                <ActiveIcon size={19} />
              </span>
              <div>
                <h2 className="font-display text-[24px] font-semibold tracking-[-0.01em]">{policy.label}</h2>
                <p className="mt-1 text-[13.5px] text-ink-muted">{policy.blurb}</p>
              </div>
            </header>

            <div className="mt-8 space-y-8">
              {policy.sections.map((section) => (
                <section key={section.heading}>
                  <h3 className="font-display text-[17px] font-semibold tracking-[-0.01em]">{section.heading}</h3>
                  <div className="mt-2.5 space-y-3">
                    {section.body.map((line) => (
                      <p key={line} className="text-[14px] leading-6 text-ink-soft">
                        {line}
                      </p>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <footer className="mt-9 rounded-2xl border border-line bg-canvas p-5">
              <p className="flex items-start gap-2.5 text-[13px] leading-5 text-ink-muted">
                <Check size={15} className="mt-0.5 shrink-0 text-sage" />
                <span>
                  Hymnora SDA is run by the church, for the church. Something here unclear or wrong? Write to the media team
                  and it will be fixed and this page will say so.
                </span>
              </p>
            </footer>
          </article>
        </div>
      </div>
    </div>
  );
}
