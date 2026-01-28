import { test, expect } from "@playwright/test";

test("home loads and links to editor3", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: /open editor 3/i })).toBeVisible();
});
