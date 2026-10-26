"""Gera tokens.css (variáveis CSS + tema do Tailwind v4) a partir de tokens.json e tokens.dark.json.

Uso: python3 build_tokens.py   (rodar de novo sempre que um token mudar)
"""
import json
import pathlib

HERE = pathlib.Path(__file__).parent
light = json.loads((HERE / "tokens.json").read_text())
dark = json.loads((HERE / "tokens.dark.json").read_text())


def colors(tokens, indent="  "):
    return "\n".join(f"{indent}--color-{k}: {v};" for k, v in tokens["color"].items())


t = light
lines = ["/* Gerado por build_tokens.py a partir de tokens.json. Não editar à mão. */", ""]
lines.append("@theme {")
lines.append(colors(light))
lines.append(f"  --font-sans: {t['font']['sans']};")
lines.append(f"  --font-mono: {t['font']['mono']};")
for name, s in t["type"].items():
    lines.append(f"  --text-{name}: {s['size'] / 16:g}rem;")
    lines.append(f"  --text-{name}--line-height: {s['line'] / s['size']:.4g};")
    lines.append(f"  --text-{name}--font-weight: {s['weight']};")
lines.append("  --spacing: 4px;")
for name, r in t["radius"].items():
    lines.append(f"  --radius-{name}: {r}px;")
lines.append(f"  --shadow-pop: {t['shadow']['pop']};")
lines.append(f"  --ease-out: {t['motion']['ease']};")
lines.append(f"  --duration-fast: {t['motion']['fast']};")
lines.append(f"  --duration-base: {t['motion']['base']};")
for name, px in t["layout"]["breakpoints"].items():
    lines.append(f"  --breakpoint-{name}: {px / 16:g}rem;")
lines.append("}")
lines.append("")
lines.append(":root {")
for name in ("sidebar", "header", "chat-min", "chat-default", "content-max"):
    lines.append(f"  --size-{name}: {t['layout'][name]}px;")
lines.append("  color-scheme: light;")
lines.append("}")
lines.append("")
lines.append("@media (prefers-color-scheme: dark) {")
lines.append('  :root:not([data-theme="light"]) {')
lines.append(colors(dark, "    "))
lines.append("    color-scheme: dark;")
lines.append("  }")
lines.append("}")
lines.append("")
lines.append(':root[data-theme="dark"] {')
lines.append(colors(dark))
lines.append("  color-scheme: dark;")
lines.append("}")
lines.append("")

css = "\n".join(lines)
(HERE / "tokens.css").write_text(css)
# Mesmo conteúdo sem @theme, para páginas sem Tailwind (preview.html).
(HERE / "tokens.plain.css").write_text(css.replace("@theme {", ":root {", 1))
print("tokens.css e tokens.plain.css escritos")
