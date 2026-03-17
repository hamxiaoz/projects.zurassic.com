# flow-break on Raspberry Pi

## Goal
Run flow-break on a Raspberry Pi with a USB camera.

## Summary
The app will likely work but performance depends heavily on Pi model. The bottleneck is TensorFlow.js model inference (COCO-SSD + MediaPipe Hands) running in Chromium.

## What helps
- Camera input is only 320×240 — very low resolution
- Person detection runs once per second (not every frame)
- MediaPipe Hands uses the `lite` model variant
- Everything runs in-browser (just open Chromium), no server needed
- USB cameras work fine — app uses standard `getUserMedia` API

## The bottleneck: TF.js on Pi
- TF.js uses WebGL for GPU acceleration — Pi's GPU is weak and WebGL support in Chromium on Pi is inconsistent
- Without WebGL, TF.js falls back to CPU (WASM backend), which is significantly slower
- On older Pis, inference could take 2–5+ seconds per frame, breaking the 1-second detection loop

## Pi compatibility by model
| Pi Model | Verdict |
|---|---|
| Pi 5 | Probably fine — fast CPU, decent WebGL |
| Pi 4 (4GB) | Likely usable, may be sluggish |
| Pi 3B+ | Borderline — CPU-only TF.js will be slow |
| Pi 2 / older | Too slow |

## Next steps to investigate
- Confirm which Pi model is available
- Test if Chromium on that Pi supports WebGL (`chrome://gpu`)
- If WebGL is missing/software-rendered, consider forcing TF.js WASM backend explicitly
- May want to tune detection intervals upward if inference is slow (e.g. detect every 2–3s instead of 1s)
