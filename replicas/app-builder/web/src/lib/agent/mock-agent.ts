import { raffleSite } from "./templates/raffle";
import type { Agent, AgentContext, AgentTools } from "./types";

const COLORS: Record<string, string> = {
  verde: "#15803d",
  azul: "#1d4ed8",
  vermelho: "#b91c1c",
  vermelha: "#b91c1c",
  roxo: "#6d28d9",
  roxa: "#6d28d9",
  laranja: "#c2410c",
  rosa: "#be185d",
  preto: "#111827",
  preta: "#111827",
  amarelo: "#a16207",
  amarela: "#a16207",
};

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_m, sp: string, ch: string) => sp + ch.toUpperCase());

/** "sorteio para Campinas com cadastro" -> "Campinas". */
export function cityFromPrompt(prompt: string): string | null {
  const NOT_A_PLACE = /^(sorteio|sorteios|site|página|pagina|app|um|uma|o|a|os|as|cadastro|participantes)$/i;
  const STOP = /^(com|que|e|onde|para|pra|até|ate|no|na|usando)$/i;
  const words = prompt.split(/\s+/);
  for (let i = 0; i < words.length - 1; i++) {
    if (!/^(para|pra|em|de|da|do)$/i.test(words[i])) continue;
    const name: string[] = [];
    for (const raw of words.slice(i + 1)) {
      const word = raw.replace(/[.,;!?]+$/, "");
      if (STOP.test(word) || !/^\p{L}+$/u.test(word)) break;
      name.push(word);
      if (word !== raw) break;
    }
    // Drop connectors left at the end ("Campos de").
    while (name.length && /^d[aeo]s?$/i.test(name.at(-1)!)) name.pop();
    if (name.length && !NOT_A_PLACE.test(name[0])) return titleCase(name.join(" "));
  }
  return null;
}

/**
 * Stands in for the real AI while there is no API key: builds a raffle site
 * from the first prompt and understands colour changes after that.
 */
export class MockAgent implements Agent {
  private readonly delayMs: number;

  constructor({ delayMs = 300 }: { delayMs?: number } = {}) {
    this.delayMs = delayMs;
  }

  private wait(signal?: AbortSignal) {
    if (!this.delayMs) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, this.delayMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(signal.reason);
      });
    });
  }

  private async say(tools: AgentTools, text: string, signal?: AbortSignal) {
    const words = text.split(/(?<=\s)/);
    for (let i = 0; i < words.length; i += 4) {
      tools.say(words.slice(i, i + 4).join(""));
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs / 6));
      signal?.throwIfAborted();
    }
  }

  async run(ctx: AgentContext, tools: AgentTools) {
    const { text, mode, signal } = ctx;
    const city = cityFromPrompt(text);
    const hasSite = tools.readFile("index.html") !== undefined;

    if (mode === "plan") {
      await this.say(
        tools,
        `Plano para ${city ? `o sorteio de ${city}` : "o seu site"}:\n` +
          "1. Topo com o nome do sorteio e uma contagem regressiva até a data do sorteio.\n" +
          "2. Lista de prêmios.\n" +
          "3. Formulário de cadastro com nome, WhatsApp e bairro.\n" +
          "4. Regras resumidas no rodapé.\n" +
          "Se estiver bom, troque para Construir e mande \"pode construir\".",
        signal,
      );
      return;
    }

    if (!hasSite) {
      const place = city ?? "Sua Cidade";
      await this.say(
        tools,
        `Vou montar uma página única para o sorteio de ${place}: contagem regressiva no topo, os prêmios e o formulário de cadastro.`,
        signal,
      );
      const site = raffleSite(place);
      for (const [path, content] of Object.entries(site)) {
        await this.wait(signal);
        tools.writeFile(path, content);
      }
      tools.setTitle(`Sorteio ${place}`);
      await this.say(
        tools,
        "Pronto. Teste o cadastro no preview. Para mudar a cor dos botões, é só pedir (por exemplo: \"deixa o botão verde\").",
        signal,
      );
      return;
    }

    const colorWord = Object.keys(COLORS).find((c) => new RegExp(`\\b${c}\\b`, "i").test(text));
    const css = tools.readFile("styles.css");
    const current = css?.match(/--primary: (#[0-9a-f]{6});/i);
    if (colorWord && css && current) {
      await this.say(tools, `Trocando a cor principal para ${colorWord}.`, signal);
      await this.wait(signal);
      tools.editFile("styles.css", current[0], `--primary: ${COLORS[colorWord]};`);
      await this.say(tools, " Feito.", signal);
      return;
    }

    await this.say(
      tools,
      "Este é o agente de demonstração: por enquanto ele só sabe criar o site de sorteio e trocar a cor principal. " +
        "Quando a chave da Anthropic for configurada, o agente de verdade faz qualquer mudança.",
      signal,
    );
  }
}
