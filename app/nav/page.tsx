import Link from "next/link";

const routes = [
  { href: "/", label: "Home" },
  { href: "/format-builder", label: "Format Builder" },
  { href: "/format-builder-6", label: "Format Builder 6" },
  { href: "/format-builder-v3", label: "Format Builder V3" },
  { href: "/generate-edit", label: "Generate Edit" },
  { href: "/search", label: "Kill Bill Search" },
  { href: "/search2", label: "Kill Bill Search v2" },
  { href: "/quick-edit-3", label: "Quick Edit 3" },
  { href: "/quick-edit-6", label: "Quick Edit 6" },
  { href: "/instant-hub", label: "Instant Hub" },
  { href: "/instant-edit-3", label: "Instant Edit 3" },
  { href: "/editor3", label: "Editor 3" },
  { href: "/nav", label: "Navigation" },
];

export default function NavPage() {
  return (
    <main className="min-h-screen bg-black text-white p-8">
      <h1 className="text-3xl font-bold mb-6">Navigation</h1>
      <p className="mb-6 text-sm text-white/70">
        Quick links to every available page route in this project.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        {routes.map((route) => (
          <Link
            key={route.href}
            href={route.href}
            className="rounded border border-white/20 px-4 py-3 text-lg font-semibold transition hover:border-white hover:bg-white/10"
          >
            {route.label}
          </Link>
        ))}
      </div>
    </main>
  );
}
