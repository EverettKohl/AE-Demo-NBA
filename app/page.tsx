import Image from "next/image";
import Link from "next/link";

import { navLinks, NavLink } from "@/components/navLinks";

export const metadata = {
  title: "Kill Bill Hub",
};

type Category = {
  title: string;
  hint: string;
  items: string[];
};

export default function HomeDemoPage() {
  const toolLinks = navLinks;
  const navLookup = Object.fromEntries(
    toolLinks.map((link) => [link.href, link])
  ) as Record<string, NavLink>;

  const baseCategories: Category[] = [
    {
      title: "Popular",
      hint: "Fast access to the most-used tools.",
      items: [
        "/search",
        "/format-builder",
        "/format-builder-v3",
        "/format-builder-6",
        "/quick-edit-3",
        "/quick-edit-6",
        "/instant-edit-3",
        "/instant-hub",
        "/editor3",
      ],
    },
    {
      title: "Video Generator",
      hint: "Generation and builder workflows end-to-end.",
      items: ["/generate-edit", "/format-builder", "/format-builder-6"],
    },
  ];

  const usedHrefs = new Set(baseCategories.flatMap(({ items }) => items));
  const otherItems = toolLinks
    .map(({ href }) => href)
    .filter((href) => !usedHrefs.has(href));

  const categories: Category[] = [
    ...baseCategories,
    otherItems.length
      ? {
          title: "Other",
          hint: "Everything else in the hub.",
          items: otherItems,
        }
      : null,
  ].filter(Boolean) as Category[];

  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <main className="flex-1 w-full">
        <div className="relative w-full h-[60vh] md:h-[70vh] lg:h-[80vh] overflow-hidden">
          <div className="absolute inset-0 w-full h-full">
            <Image
              src="/Banner.jpg"
              alt="Kill Bill: The Whole Bloody Affair banner"
              fill
              className="object-cover"
              priority
            />
            <div className="absolute inset-0 bg-linear-to-t from-black via-black/60 via-30% to-transparent" />
            <div className="absolute inset-0 bg-linear-to-r from-black via-black/40 via-20% to-transparent" />
            <div className="absolute inset-0 bg-linear-to-b from-black/20 to-transparent" />
          </div>

          <div className="relative z-10 h-full flex items-end">
            <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8 md:pb-12 lg:pb-16">
              <div className="flex flex-col md:flex-row gap-6 md:gap-8 items-start">
                <div className="shrink-0">
                  <div className="relative w-24 h-36 sm:w-32 sm:h-48 md:w-40 md:h-60 lg:w-48 lg:h-72 rounded-lg overflow-hidden shadow-2xl bg-black">
                    <Image
                      src="/Poster.png"
                      alt="Kill Bill: The Whole Bloody Affair poster"
                      fill
                      className="object-contain"
                      priority
                      sizes="(max-width: 640px) 96px, (max-width: 768px) 128px, (max-width: 1024px) 160px, 192px"
                    />
                  </div>
                </div>

                <div className="flex-1 max-w-3xl">
                  <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-3 text-white drop-shadow-lg">
                    Kill Bill: The Whole Bloody Affair
                  </h1>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-4 text-xs sm:text-sm md:text-base">
                    <span className="text-white/90 font-medium">2025</span>
                    <span className="text-white/70">•</span>
                    <span className="text-white/90">Only in Theatres Dec 5</span>
                    <span className="text-white/70">•</span>
                    <span className="text-white/90">Lionsgate</span>
                  </div>
                  <p className="text-sm sm:text-base md:text-lg text-white/85 mb-4 max-w-2xl leading-relaxed">
                    Experience Quentin Tarantino&apos;s uncut revenge saga exactly as intended. The Bride&apos;s relentless path through the Deadly Viper Assassination Squad unfolds in one sweeping, blood-soaked epic that fuses grindhouse flair with balletic action. Jump to any experience below to explore, build, or search the film.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10">
          <div className="bg-gray-950/70 border border-gray-800/80 rounded-2xl p-5 sm:p-7 shadow-2xl backdrop-blur-md space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="space-y-1">
                <p className="text-xs sm:text-sm font-semibold text-white uppercase tracking-[0.2em]">
                  Navigation
                </p>
                <h2 className="text-xl sm:text-2xl font-bold text-white">
                  Explore the hub
                </h2>
              </div>
            </div>

            <div className="space-y-5">
              {categories.map(({ title, hint, items }) => {
                const links = items.map((href) => navLookup[href]).filter(Boolean);
                if (!links.length) return null;

                return (
                  <div key={title} className="space-y-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="space-y-0.5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/80">
                          {title}
                        </p>
                        <p className="text-xs text-white/70">{hint}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                      {links.map(({ href, label }, index) => {
                        const accents = [
                          "from-amber-500/15 via-orange-500/10 to-transparent",
                          "from-pink-500/15 via-rose-500/10 to-transparent",
                          "from-blue-500/15 via-cyan-500/10 to-transparent",
                          "from-emerald-500/15 via-teal-500/10 to-transparent",
                        ];

                        return (
                          <Link
                            key={href}
                            href={href}
                            className={`group relative overflow-hidden rounded-lg border border-gray-800/70 bg-gray-900/70 p-3 sm:p-4 flex items-center justify-between gap-2 transition duration-200 ease-out hover:-translate-y-0.5 hover:border-white/70 hover:shadow-[0_10px_28px_-16px_rgba(255,255,255,0.55)]`}
                          >
                            <div
                              className={`absolute inset-0 bg-linear-to-br ${accents[index % accents.length]} opacity-50 group-hover:opacity-100 transition duration-200`}
                              aria-hidden="true"
                            />
                            <div className="relative flex items-center justify-between w-full">
                              <span className="text-base sm:text-lg font-semibold text-white leading-tight">
                                {label}
                              </span>
                              <span className="inline-flex items-center justify-center h-8 w-8 rounded-full border border-white/30 bg-white/10 text-white transition duration-200 group-hover:bg-white/20 group-hover:border-white group-hover:translate-x-0.5">
                                →
                              </span>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}