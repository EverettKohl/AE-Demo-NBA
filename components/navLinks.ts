export type NavLink = {
  href: string;
  label: string;
  category?: string;
};

export const navLinks: NavLink[] = [
  { href: "/", label: "Home" },
  { href: "/search", label: "Kill Bill Search" },
  { href: "/search3", label: "Search 3" },
  { href: "/format-builder", label: "Format Builder" },
  { href: "/format-builder-v3", label: "Format Builder V3" },
  { href: "/format-builder-6", label: "Format Builder 6", category: "Testing" },
  { href: "/generate-edit", label: "Generate Edit" },
  { href: "/quick-edit-3", label: "Quick Edit 3" },
  { href: "/quick-edit-6", label: "Quick Edit 6", category: "Testing" },
  { href: "/instant-edit-3", label: "Instant Edit 3" },
  { href: "/instant-hub", label: "Instant Hub" },
  { href: "/editor3", label: "Editor 3" },
  { href: "/demo", label: "Demo Gallery" },
  { href: "/nav", label: "Navigation" },
];
