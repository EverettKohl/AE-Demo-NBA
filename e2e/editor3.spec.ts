import { test, expect } from "@playwright/test";

test("editor3 renders sidebar", async ({ page }) => {
  await page.goto("/editor3");

  await expect(page).toHaveURL(/\/editor3$/);
  await expect(page.getByRole("button", { name: /^Video$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Clips$/i })).toBeVisible();
});
