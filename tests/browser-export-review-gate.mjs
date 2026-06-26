// Running-product acceptance for export review gate (#179).
// Run: node tests/browser-export-review-gate.mjs
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8767;

function mime(path) {
  const ext = extname(path);
  if (ext === ".html") return "text/html";
  if (ext === ".css") return "text/css";
  if (ext === ".js") return "text/javascript";
  return "application/octet-stream";
}

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const rel = req.url === "/" ? "/index.html" : req.url.split("?")[0];
      const file = join(root, rel.replace(/^\//, ""));
      if (!file.startsWith(root) || !existsSync(file)) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": mime(file) });
      res.end(readFileSync(file));
    });
    server.listen(port, () => resolve(server));
  });
}

async function completeSetup(page) {
  await page.getByRole("button", { name: "Start blank episode" }).click();
  await page.waitForSelector("form.setup-import");
  await page.locator("#f-episodeName").fill("Founders Unfiltered #7");
  await page.locator("#f-sp-0-name").fill("Sam Rivera");
  await page.locator("#f-sp-1-name").fill("Dana Kim");
  await page.locator("#f-sp-2-name").fill("Alex Chen");
  await page.locator(".setup-preset-card").first().click();
  await page.locator(".guided-workspace").waitFor({ state: "visible" });
}

async function polishAudioFromWorkspace(page) {
  await page.locator("#workspace-primary-next, .workspace-checklist-open").filter({ hasText: "Polish audio" }).first().click();
  await page.locator(".audio-step").waitFor();
  await page.locator(".audio-preset-card").first().click();
  await page.getByRole("button", { name: "Apply audio & continue →" }).click();
  await page.locator(".guided-workspace").waitFor({ state: "visible" });
}

async function openExportFromWorkspace(page) {
  await page.locator("#workspace-primary-next, .workspace-checklist-open").filter({ hasText: "Export episode" }).first().click();
}

async function approveContextIfNeeded(page) {
  const fixBtn = page.getByRole("button", { name: "Review context" });
  if (await fixBtn.isVisible()) {
    await fixBtn.click();
    await page.locator(".context-step").waitFor();
    await page.getByRole("button", { name: "Approve context & continue →" }).click();
    await page.locator(".audio-step, .guided-workspace, .publish-review-step").first().waitFor();
  }
}

async function main() {
  const server = await startServer();
  let browser;
  let failed = false;
  const log = (ok, msg) => {
    console.log(`${ok ? "  ok" : " FAIL"} ${msg}`);
    if (!ok) failed = true;
  };

  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });

    await completeSetup(page);
    await polishAudioFromWorkspace(page);
    log(await page.locator(".guided-workspace").isVisible(), "Setup lands in production workspace");

    await openExportFromWorkspace(page);
    await page.locator(".publish-review-step").waitFor();
    log(await page.locator(".publish-review-step").isVisible(), "Skipping to export opens publish review instead of export");
    log(!(await page.locator(".export-step").isVisible()), "Export screen stays hidden before approval");

    await approveContextIfNeeded(page);

    const approveBtn = page.getByRole("button", { name: "Approve for export →" });
    await approveBtn.waitFor({ state: "visible" });
    await approveBtn.click();
    await page.getByRole("button", { name: "Approved for export" }).waitFor();
    log(await page.getByRole("button", { name: "Approved for export" }).isVisible(), "Publish review approval persists on screen");

    await page.getByRole("button", { name: "← Back to workspace" }).click();
    await page.locator(".guided-workspace").waitFor();
    await openExportFromWorkspace(page);
    await page.locator(".export-step").waitFor();
    log(await page.getByRole("button", { name: "Start export →" }).isVisible(), "Approved review unlocks export with Start export");

    await page.getByRole("button", { name: "Start export →" }).click();
    log(await page.getByRole("button", { name: "Done — back to workspace" }).isVisible(), "Export completes after publish review approval");

    await page.screenshot({ path: join(root, "tests", "export-review-gate-export.png"), fullPage: false });
    log(true, "Screenshot saved to tests/export-review-gate-export.png");
  } catch (err) {
    console.error(err);
    failed = true;
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  if (failed) {
    process.exit(1);
  }
  console.log("\nBrowser export review gate: all checks passed.");
}

main();
