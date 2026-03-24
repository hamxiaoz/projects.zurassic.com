#!/usr/bin/env python3
"""Enroll your voice to create a voiceprint used to dismiss the alarm."""

import os
import numpy as np
import sounddevice as sd
import soundfile as sf
import tempfile
import torch
from speechbrain.inference.speaker import SpeakerRecognition

SAMPLE_RATE = 16000
CLIP_DURATION = 5   # seconds per clip
NUM_CLIPS = 5
VOICEPRINT_FILE = "voiceprint.npy"


def record_clip(duration=CLIP_DURATION):
    print(f"  Recording {duration}s — speak naturally (count, read, describe anything)...")
    audio = sd.rec(
        int(duration * SAMPLE_RATE),
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype="float32",
    )
    sd.wait()
    return audio.flatten()


def get_embedding(model, audio):
    # Save to a temp wav so SpeechBrain can read it cleanly
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        sf.write(f.name, audio, SAMPLE_RATE)
        tmp_path = f.name
    try:
        waveform, _ = sf.read(tmp_path, dtype="float32")
        tensor = torch.tensor(waveform).unsqueeze(0)  # [1, time]
        with torch.no_grad():
            emb = model.encode_batch(tensor)           # [1, 1, 192]
        return emb.squeeze().numpy()                   # [192]
    finally:
        os.unlink(tmp_path)


def main():
    print("Loading speaker verification model (downloads ~80MB on first run)...")
    model = SpeakerRecognition.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        savedir="pretrained_models/spkrec-ecapa-voxceleb",
    )

    print(f"\nYou will record {NUM_CLIPS} clips of {CLIP_DURATION}s each.")
    print("Speak in your normal voice — the model handles pitch and tone variation.\n")

    embeddings = []
    for i in range(NUM_CLIPS):
        input(f"Clip {i + 1}/{NUM_CLIPS}: press Enter when ready, then speak...")
        audio = record_clip()

        # Basic silence check
        if np.abs(audio).mean() < 0.002:
            print("  Too quiet — please try again.")
            continue

        emb = get_embedding(model, audio)
        embeddings.append(emb)
        print("  Captured.\n")

    if len(embeddings) < 3:
        print("Not enough clips recorded. Please run again.")
        return

    voiceprint = np.mean(embeddings, axis=0)
    np.save(VOICEPRINT_FILE, voiceprint)
    print(f"Voiceprint saved to {VOICEPRINT_FILE}  ({len(embeddings)} clips averaged)")
    print("Run alarm.py to set an alarm.")


if __name__ == "__main__":
    main()
