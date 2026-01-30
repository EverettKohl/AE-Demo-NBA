import { isMaterializeAllowed } from "@/app/api/generate-edit/materializeGuard";

describe("isMaterializeAllowed", () => {
  it("allows when GE_ENABLE_MATERIALIZE is true regardless of env", () => {
    expect(
      isMaterializeAllowed({ GE_ENABLE_MATERIALIZE: "true", VERCEL: "1", NODE_ENV: "production" })
    ).toBe(true);
  });

  it("denies on Vercel/prod by default", () => {
    expect(isMaterializeAllowed({ VERCEL: "1", NODE_ENV: "production" })).toBe(false);
    expect(isMaterializeAllowed({ NODE_ENV: "production" })).toBe(false);
  });

  it("allows on non-prod self-host when flag is not set", () => {
    expect(isMaterializeAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(isMaterializeAllowed({})).toBe(true);
  });
});
