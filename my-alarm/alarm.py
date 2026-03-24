#!/usr/bin/env python3
"""Voice-verified alarm. Only your enrolled voice can dismiss it."""

import argparse
import datetime
import os
import threading
import time

import numpy as np
import sounddevice as sd
import soundfile as sf
import tempfile
import torch
from speechbrain.inference.speaker import SpeakerRecognition

SAMPLE_RATE = 16000
CLIP_DURATION = 3          # seconds to record for each verification attempt
DEFAULT_THRESHOLD = 0.75   # cosine similarity required to dismiss
VOICEPRINT_FILE = "voiceprint.npy"


# ---------------------------------------------------------------------------
# Audio helpers
# ---------------------------------------------------------------------------

def generate_beep(freq=880, duration=0.4, gap=0.15, sample_rate=SAMPLE_RATE):
    """Generate a single beep + silence buffer."""
    t = np.linspace(0, duration, int(sample_rate * duration), False)
    tone = (np.sin(2 * np.pi * freq * t) * 0.85).astype("float32")
    silence = np.zeros(int(sample_rate * gap), dtype="float32")
    return np.concatenate([tone, silence])


def play_alarm(stop_event, pause_event):
    """Loop beeps until stop_event is set. Pauses when pause_event is set."""
    beep = generate_beep()
    while not stop_event.is_set():
        if pause_event.is_set():
            time.sleep(0.05)
            continue
        sd.play(beep, SAMPLE_RATE)
        sd.wait()


def record_clip(duration=CLIP_DURATION):
    audio = sd.rec(
        int(duration * SAMPLE_RATE),
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype="float32",
    )
    sd.wait()
    return audio.flatten()


def get_embedding(model, audio):
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        sf.write(f.name, audio, SAMPLE_RATE)
        tmp_path = f.name
    try:
        waveform, _ = sf.read(tmp_path, dtype="float32")
        tensor = torch.tensor(waveform).unsqueeze(0)
        with torch.no_grad():
            emb = model.encode_batch(tensor)
        return emb.squeeze().numpy()
    finally:
        os.unlink(tmp_path)


def cosine_similarity(a, b):
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


# ---------------------------------------------------------------------------
# Alarm logic
# ---------------------------------------------------------------------------

def wait_until(alarm_time: datetime.time):
    now = datetime.datetime.now()
    target = datetime.datetime.combine(now.date(), alarm_time)
    if target <= now:
        target += datetime.timedelta(days=1)
    wait_secs = (target - now).total_seconds()
    mins, secs = divmod(int(wait_secs), 60)
    hours, mins = divmod(mins, 60)
    print(f"Alarm set for {target.strftime('%H:%M')}  ({hours}h {mins}m away)")
    time.sleep(wait_secs)


def run_alarm(model, voiceprint, threshold):
    print("\n*** ALARM *** — speak to dismiss")
    stop_event = threading.Event()
    pause_event = threading.Event()

    alarm_thread = threading.Thread(
        target=play_alarm, args=(stop_event, pause_event), daemon=True
    )
    alarm_thread.start()

    while not stop_event.is_set():
        # Pause beeping so the mic doesn't pick it up
        pause_event.set()
        sd.stop()
        time.sleep(0.25)

        try:
            audio = record_clip()
        except Exception as e:
            print(f"  Recording error: {e}")
            pause_event.clear()
            continue

        if np.abs(audio).mean() < 0.002:
            print("  (silence — keep speaking)")
            pause_event.clear()
            continue

        emb = get_embedding(model, audio)
        sim = cosine_similarity(emb, voiceprint)
        print(f"  Similarity: {sim:.3f}  (need {threshold})")

        if sim >= threshold:
            stop_event.set()
            print("Voice verified — alarm dismissed.")
        else:
            pause_event.clear()  # resume beeping

    alarm_thread.join(timeout=2)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Voice-verified alarm")
    parser.add_argument("time", help="Alarm time in HH:MM (24-hour)")
    parser.add_argument(
        "--threshold",
        type=float,
        default=DEFAULT_THRESHOLD,
        metavar="T",
        help=f"Cosine similarity threshold to dismiss (default: {DEFAULT_THRESHOLD})",
    )
    args = parser.parse_args()

    try:
        alarm_time = datetime.time.fromisoformat(args.time)
    except ValueError:
        print("Invalid time format. Use HH:MM, e.g. 07:30")
        return

    if not os.path.exists(VOICEPRINT_FILE):
        print(f"No voiceprint found ({VOICEPRINT_FILE}). Run enroll.py first.")
        return

    voiceprint = np.load(VOICEPRINT_FILE)

    print("Loading speaker verification model...")
    model = SpeakerRecognition.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        savedir="pretrained_models/spkrec-ecapa-voxceleb",
    )

    wait_until(alarm_time)
    run_alarm(model, voiceprint, args.threshold)


if __name__ == "__main__":
    main()
