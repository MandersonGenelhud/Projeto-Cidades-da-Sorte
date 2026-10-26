import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// Every test fails on a console error or a 5xx from our own server.
test.beforeEach(async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`page: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`${r.status()} ${r.url()}`);
  });
  (page as Page & { problems: string[] }).problems = problems;
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { problems: string[] }).problems).toEqual([]);
});

/** Drops expected problems, e.g. the browser logging a 404 we asked for. */
function allowProblems(page: Page, pattern: RegExp) {
  const problems = (page as Page & { problems: string[] }).problems;
  problems.splice(0, problems.length, ...problems.filter((p) => !pattern.test(p)));
}

async function expectAccessible(page: Page) {
  // @axe-core/playwright is typed against its own copy of Playwright.
  type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];
  const { violations } = await new AxeBuilder({ page: page as unknown as AxePage })
    .exclude("iframe") // the generated app is the user's, not ours
    .analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

async function createRaffle(page: Page, prompt = "Um site de sorteio para Campinas com cadastro de participantes") {
  await page.goto("/");
  await expect(page.getByRole("radio", { name: /Site de sorteio/ })).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("Descreva o seu app").fill(prompt);
  await page.getByRole("button", { name: "Criar app" }).click();
  await expect(page).toHaveURL(/\/job\/[0-9a-f-]+$/);
}

test("F01: an idea becomes a working raffle site in the preview", async ({ page }) => {
  await page.goto("/");
  await expectAccessible(page);
  await createRaffle(page);

  const chat = page.getByRole("log");
  await expect(chat.getByText("Montando o seu app…")).toBeVisible();
  await expect(chat.getByText("index.html")).toBeVisible();
  await expect(chat.getByText("app.js")).toBeVisible();
  await expect(chat.getByText(/Pronto\. Teste o cadastro/)).toBeVisible();
  await expect(chat.getByText("Montando o seu app…")).toBeHidden();

  await expect(page.getByRole("heading", { level: 1, name: "Sorteio Campinas" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Seus apps" }).locator('a[aria-current="page"]')).toContainText("Sorteio Campinas");

  const app = page.frameLocator('iframe[title="Preview do app"]');
  await expect(app.getByRole("heading", { name: /Concorra a uma moto 0 km em Campinas/ })).toBeVisible();

  // The generated app runs: sign up inside the sandboxed preview.
  await app.getByLabel("Nome completo").fill("Maria Souza");
  await app.getByLabel("WhatsApp").fill("(19) 99999-1234");
  await app.getByLabel("Bairro").fill("Cambuí");
  await app.getByRole("button", { name: "Confirmar cadastro" }).click();
  await expect(app.getByText(/Seu número da sorte é 1001/)).toBeVisible();

  await expectAccessible(page);
});

test("F03: a follow-up message edits the app and the history survives a reload", async ({ page }) => {
  await createRaffle(page);
  await expect(page.getByRole("log").getByText(/Pronto\. Teste o cadastro/)).toBeVisible();
  await expect(page.getByLabel("Peça uma mudança")).toBeEnabled();

  await page.getByLabel("Peça uma mudança").fill("deixa o botão verde");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("log").getByText("Editou")).toBeVisible();
  await expect(page.getByRole("log").getByText(/Feito\./)).toBeVisible();

  await page.getByRole("tab", { name: "Código" }).click();
  await page.getByRole("button", { name: "styles.css" }).click();
  await expect(page.locator("pre code")).toContainText("--primary: #15803d");

  await page.reload();
  await expect(page.getByRole("log").getByText("deixa o botão verde", { exact: true })).toBeVisible();
  await expect(page.getByRole("log").getByText(/Feito\./)).toBeVisible();
});

test("the home screen is ready for another app after creating one", async ({ page }) => {
  await createRaffle(page, "sorteio para Jundiaí");
  await expect(page.getByRole("log").getByText(/Pronto\. Teste o cadastro/)).toBeVisible();
  await page.getByRole("navigation", { name: "Seus apps" }).getByRole("link", { name: "Novo app", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel("Descreva o seu app")).toHaveValue("");
  await page.getByLabel("Descreva o seu app").fill("sorteio para Itu");
  await expect(page.getByRole("button", { name: "Criar app" })).toBeEnabled();
});

test("F02: plan mode proposes a plan without building", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Descreva o seu app").fill("sorteio para Ribeirão Preto");
  await page.getByRole("radio", { name: "Planejar" }).click();
  await page.getByRole("button", { name: "Criar app" }).click();
  await expect(page.getByRole("log").getByText(/Plano para o sorteio de Ribeirão Preto/)).toBeVisible();
  await expect(page.getByRole("log").getByText(/pode construir/)).toBeVisible();
  await expect(page.getByText("O seu app aparece aqui assim que o agente terminar a primeira versão.")).toBeVisible();
});

test("the preview opens in its own sandboxed tab", async ({ page, request }) => {
  await createRaffle(page);
  await expect(page.getByRole("log").getByText(/Pronto\. Teste o cadastro/)).toBeVisible();
  const id = page.url().split("/").at(-1);
  const res = await request.get(`/api/jobs/${id}/preview`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-security-policy"]).toContain("sandbox");
  expect(await res.text()).toContain("<style>");
});

test("jobs can be renamed and deleted from the sidebar", async ({ page }) => {
  await createRaffle(page, "sorteio para Sorocaba");
  const nav = page.getByRole("navigation", { name: "Seus apps" });
  await expect(nav.getByRole("link", { name: /Sorteio Sorocaba/ })).toBeVisible();

  await nav.getByRole("button", { name: "Opções de Sorteio Sorocaba" }).click();
  await page.getByRole("menuitem", { name: "Renomear" }).click();
  await page.getByLabel("Novo nome").fill("Sorocaba de Natal");
  await page.keyboard.press("Enter");
  await expect(nav.getByRole("link", { name: /Sorocaba de Natal/ })).toBeVisible();

  await nav.getByRole("button", { name: "Opções de Sorocaba de Natal" }).click();
  await page.getByRole("menuitem", { name: "Apagar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Apagar app" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(nav.getByRole("link", { name: /Sorocaba de Natal/ })).toHaveCount(0);
});

test("an unknown job shows a way back", async ({ page }) => {
  await page.goto("/job/00000000-0000-0000-0000-000000000000");
  await expect(page.getByRole("heading", { name: "Este app não existe mais" })).toBeVisible();
  await page.getByRole("link", { name: "Criar um app novo" }).click();
  await expect(page).toHaveURL(/\/$/);
  allowProblems(page, /status of 404/);
});

test("@mobile chat and app switch with tabs on a phone", async ({ page }) => {
  await createRaffle(page, "sorteio para Santos");
  await expect(page.getByRole("log").getByText(/Pronto\. Teste o cadastro/)).toBeVisible();
  await page.getByRole("tab", { name: "App" }).click();
  const app = page.frameLocator('iframe[title="Preview do app"]');
  await expect(app.getByRole("heading", { name: /Santos/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await expect(page.getByRole("navigation", { name: "Seus apps" }).locator('a[aria-current="page"]')).toContainText("Sorteio Santos");
});
