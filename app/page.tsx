import Image from "next/image";
import Link from "next/link";

import { navLinks, NavLink } from "@/components/navLinks";

export const metadata = {
  title: "Kill Bill Hub",
};

export default function HomeDemoPage() {
  const featuredHrefs = ["/search", "/editor3"];
  const accentClasses = [
    "from-amber-500/15 via-orange-500/10 to-transparent",
    "from-pink-500/15 via-rose-500/10 to-transparent",
    "from-blue-500/15 via-cyan-500/10 to-transparent",
    "from-emerald-500/15 via-teal-500/10 to-transparent",
  ];

  const featuredLinks = featuredHrefs
    .map((href) => navLinks.find((link) => link.href === href))
    .filter(Boolean) as NavLink[];

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
              <div className="flex flex-col md:flex-row gap-5 md:gap-7 items-start md:items-stretch md:min-h-[300px]">
                <div className="shrink-0 md:h-full">
                  <div className="relative w-24 sm:w-32 md:w-40 lg:w-48 aspect-2/3 min-h-[240px] md:min-h-[300px] md:h-full rounded-lg overflow-hidden shadow-2xl bg-transparent">
                    <Image
                      src="/Poster.png"
                      alt="Kill Bill: The Whole Bloody Affair poster"
                      fill
                      className="object-contain"
                      priority
                      sizes="(max-width: 640px) 120px, (max-width: 768px) 144px, (max-width: 1024px) 176px, 208px"
                    />
                  </div>
                </div>

                <div className="flex-1 max-w-3xl">
                  <div className="relative h-full min-h-[240px] md:min-h-[300px] overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
                    <div className="absolute inset-0 bg-linear-to-br from-white/6 via-white/2 to-transparent" aria-hidden="true" />
                    <div className="absolute -top-16 -right-10 h-48 w-48 rounded-full bg-amber-400/10 blur-3xl" aria-hidden="true" />
                    <div className="absolute -bottom-20 -left-10 h-52 w-52 rounded-full bg-rose-400/10 blur-3xl" aria-hidden="true" />
                    <div className="relative h-full flex flex-col justify-center p-4 sm:p-5 lg:p-6 space-y-3.5">
                      <div className="space-y-3">
                        <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl xl:text-4xl 2xl:text-5xl font-bold text-white drop-shadow-lg leading-tight whitespace-normal wrap-break-word">
                          Kill Bill: The Whole Bloody Affair
                        </h1>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs sm:text-sm md:text-base">
                          <span className="px-3 py-1 rounded-full bg-white/10 border border-white/10 text-white/90">
                            2025
                          </span>
                          <span className="px-3 py-1 rounded-full bg-white/10 border border-white/10 text-white/90">
                            Only in Theatres Dec 5
                          </span>
                          <span className="px-3 py-1 rounded-full bg-white/10 border border-white/10 text-white/90">
                            Lionsgate
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {featuredLinks.map(({ href, label }, index) => (
                          <Link
                            key={href}
                            href={href}
                            className="group relative overflow-hidden rounded-xl border border-white/15 bg-white/5 p-4 flex items-center justify-between gap-2 transition duration-200 ease-out hover:-translate-y-0.5 hover:border-white/60 hover:shadow-[0_12px_32px_-18px_rgba(255,255,255,0.6)]"
                          >
                            <div
                              className={`absolute inset-0 bg-linear-to-br ${accentClasses[index % accentClasses.length]} opacity-60 group-hover:opacity-100 transition duration-200`}
                              aria-hidden="true"
                            />
                            <div className="relative flex items-center justify-between w-full">
                              <span className="text-base sm:text-lg font-semibold text-white leading-tight">
                                {label}
                              </span>
                              <span className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-white/30 bg-white/10 text-white transition duration-200 group-hover:bg-white/20 group-hover:border-white group-hover:translate-x-0.5">
                                →
                              </span>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}