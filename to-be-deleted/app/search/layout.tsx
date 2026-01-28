import "../globals.css";
import Providers from "./Providers";

export const metadata = {
  title: "Search Kill Bill",
  description: "AI-powered search across Kill Bill volumes.",
};

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className="bg-black min-h-screen">{children}</div>
    </Providers>
  );
}
