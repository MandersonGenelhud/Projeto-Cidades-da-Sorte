"""Serviço de voz da Migra (roda só dentro da VPS, sem expor porta para a internet).

  POST /transcribe?language=pt   corpo = áudio (ogg/opus do WhatsApp)  ->  {"text": "..."}      (faster-whisper, local)
  POST /speak                    {"text": "...", "voice": "pf_dora"}   ->  áudio ogg/opus         (kokoro-onnx, local)
  GET  /health

Os modelos são baixados uma vez, na primeira chamada, e ficam no volume /models.
Nenhum áudio sai da VPS.
"""
import os
import subprocess
import tempfile
import threading
import urllib.request

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

MODELS = os.environ.get("MODELS_DIR", "/models")
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")  # tiny, base, small, medium (small é um bom equilíbrio no processador)
KOKORO_BASE = os.environ.get(
    "KOKORO_BASE_URL",
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0",
)
# Modelo completo (~310 MB): voz mais limpa e natural que a versão compacta int8 (~88 MB, KOKORO_MODEL_FILE=kokoro-v1.0.int8.onnx).
KOKORO_MODEL = os.environ.get("KOKORO_MODEL_FILE", "kokoro-v1.0.onnx")
SPEED = float(os.environ.get("VOICE_SPEED", "0.96"))  # um pouco mais calma que o padrão: soa menos apressada
PAUSE_S = 0.28  # respiro entre as frases
KOKORO_VOICES = "voices-v1.0.bin"
VOICES = {"pf_dora", "pm_alex", "pm_santa"}  # português do Brasil
MAX_AUDIO = 12 * 1024 * 1024
MAX_TEXT = 600
# Ajuda o reconhecimento das palavras do caixa (nomes de moedas, despesas).
PROMPT = "Registro de gastos e entradas da empresa Migra Paraguai: reais, dólares, guaranis, aluguel, anúncios, certidões, comissão."

app = FastAPI(title="Voz da Migra")
_lock = threading.Lock()
_whisper = None
_kokoro = None


def whisper():
    global _whisper
    with _lock:
        if _whisper is None:
            from faster_whisper import WhisperModel

            _whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8", download_root=os.path.join(MODELS, "whisper"))
        return _whisper


def _fetch(name):
    path = os.path.join(MODELS, "kokoro", name)
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.part"
        urllib.request.urlretrieve(f"{KOKORO_BASE}/{name}", tmp)
        os.replace(tmp, path)
    return path


def kokoro():
    global _kokoro
    with _lock:
        if _kokoro is None:
            from kokoro_onnx import Kokoro

            _kokoro = Kokoro(_fetch(KOKORO_MODEL), _fetch(KOKORO_VOICES))
        return _kokoro


def to_opus(samples, sample_rate):
    """Converte as amostras da voz em OGG/Opus mono (formato de mensagem de voz do WhatsApp)."""
    import numpy as np

    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    proc = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "s16le", "-ar", str(sample_rate), "-ac", "1", "-i", "pipe:0", "-c:a", "libopus", "-b:a", "48k", "-application", "audio", "-f", "ogg", "pipe:1"],
        input=pcm,
        capture_output=True,
        timeout=60,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError(proc.stderr.decode("utf-8", "ignore")[:200] or "ffmpeg falhou")
    return proc.stdout


def _transcribe(data, language):
    with tempfile.NamedTemporaryFile(suffix=".ogg") as f:
        f.write(data)
        f.flush()
        segments, _info = whisper().transcribe(f.name, language=language, beam_size=1, vad_filter=True, initial_prompt=PROMPT)
        return " ".join(s.text.strip() for s in segments).strip()


def _speak(text, voice):
    import re

    import numpy as np

    # Frase por frase, com um pequeno respiro entre elas: o ritmo fica de conversa, não de leitura corrida.
    parts = [p.strip() for p in re.split(r"(?<=[.!?:;])\s+|\n+", text) if p.strip()] or [text]
    chunks, rate = [], 24000
    for part in parts:
        samples, rate = kokoro().create(part, voice=voice, speed=SPEED, lang="pt-br")
        chunks.append(samples)
        chunks.append(np.zeros(int(rate * PAUSE_S), dtype=samples.dtype))
    return to_opus(np.concatenate(chunks[:-1]), rate)


class Speak(BaseModel):
    text: str
    voice: str = "pf_dora"


@app.get("/health")
def health():
    return {"ok": True, "whisper": WHISPER_MODEL, "voices": sorted(VOICES)}


@app.post("/transcribe")
async def transcribe(request: Request, language: str = "pt"):
    data = await request.body()
    if not data or len(data) > MAX_AUDIO:
        raise HTTPException(400, "Áudio vazio ou grande demais")
    try:
        text = await run_in_threadpool(_transcribe, data, language if language.isalpha() and len(language) <= 3 else "pt")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"Transcrição falhou: {e}") from e
    return {"text": text}


@app.post("/speak")
async def speak(body: Speak):
    text = body.text.strip()[:MAX_TEXT]
    if not text:
        raise HTTPException(400, "Texto vazio")
    voice = body.voice if body.voice in VOICES else "pf_dora"
    try:
        audio = await run_in_threadpool(_speak, text, voice)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"Voz falhou: {e}") from e
    return Response(content=audio, media_type="audio/ogg")
