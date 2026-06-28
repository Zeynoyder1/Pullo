# RepTrack AI — Pull-Up & Push-Up Counter

A modern AI fitness counter with real-time pose detection. Counts both pull-ups and push-ups automatically using your webcam — no wearables, no installs.

## Tech Stack
- **TensorFlow.js** v4.17 — runs ML in your browser (WebGL accelerated)
- **MoveNet (Thunder)** — Google's fast 17-keypoint pose model
- **Vanilla HTML/CSS/JS** — zero framework, zero build step

## Project Structure
```
reptrack/
├── index.html   ← Full page with hero, tracker UI
├── style.css    ← Glassmorphism dark design, Space Grotesk + DM Sans
├── app.js       ← Pose detection, rep algorithms, ring counter
└── README.md
```

## Running locally

```bash
# Python 3
python -m http.server 8080

# Node.js
npx serve .

# Then open: http://localhost:8080
```

> A local server is required — browsers block camera access on `file://` URLs.

## How each exercise is detected

### Pull-Ups
```
Track elbow angle (shoulder → elbow → wrist)

HANG:  elbow angle > 148° (arms straight)
   ↓
PULL:  elbow angle < threshold (arms bent, chin up)
   ↓
HANG:  elbow angle > 148° again → REP COUNTED ✓
```

### Push-Ups
```
Track elbow angle (shoulder → elbow → wrist)

TOP:    elbow angle > 142° (arms extended, plank position)
   ↓
BOTTOM: elbow angle < 96°  (chest near floor)
   ↓
TOP:    elbow angle > 142° again → REP COUNTED ✓
```

## Sensitivity slider
| Value | Pull-up UP angle | Push-up DOWN angle |
|-------|----------------|--------------------|
| 1 (Strict) | < 70° | < 80° |
| 3 (Default) | < 92° | < 96° |
| 5 (Loose) | < 116° | < 112° |

## Camera tips
- **Pull-ups**: side-on angle, full body visible including arms extended above head
- **Push-ups**: side-on angle, hips and full arms visible
- Good lighting (avoid backlit windows)
- Fitted clothing — baggy sleeves can obscure elbow detection

## Privacy
All inference runs locally via WebGL. No video or data ever leaves your device.
