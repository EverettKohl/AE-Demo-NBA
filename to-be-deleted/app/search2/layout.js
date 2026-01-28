import "../globals.css";
import Providers2 from "./Providers2";

export const metadata = {
  title: "Search v2",
  description: "AI-powered search across Kill Bill volumes (v2).",
};

export default function SearchLayout({ children }) {
  return (
    <Providers2>
      <div className="bg-black min-h-screen">{children}</div>
    </Providers2>
  );
}
