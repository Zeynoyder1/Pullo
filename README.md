# PullForce AI — Pull-Up Counter

An AI-powered pull-up counter that uses your webcam and real-time pose detection to count reps automatically — no wearables, no apps.

## Tech Stack

- **TensorFlow.js** v4.17 — runs ML in the browser
- **MoveNet (Thunder)** — Google's fast, accurate single-person pose model
- **Vanilla JS + HTML + CSS** — zero framework dependencies
- **No backend required** — 100% client-side

## Project Structure

```
pullup-counter/
├── index.html     ← Full page: hero, how-it-works, tracker UI
├── style.css      ← Design system (dark, lime accent, Bebas Neue display)
├── app.js         ← All logic: pose detection, rep counting, timers
└── README.md
```

## How to Run

### Option A — Simple (no install needed)
Open `index.html` directly in Chrome or Firefox.
> ⚠️ Camera access requires HTTPS or localhost. If opening a local file doesn't work, use Option B.

### Option B — Local dev server (recommended)
```bash
# Python 3
python -m http.server 8080

# Node.js
npx serve .

# Then open:  http://localhost:8080
```

### Option C — Deploy anywhere static
Upload all three files to GitHub Pages, Netlify, Vercel, or any static host. That's it.

---

## How the Rep Counter Works

```
MoveNet detects 17 keypoints per frame at ~30fps

↓

Elbow angle = angleBetween(shoulder, elbow, wrist)
Both arms averaged for stability

↓

State machine:
  HANG (arms straight, angle > 155°)
      ↓
  PULL (elbow angle < threshold based on sensitivity)
      ↓
  RETURN (arms straight again → REP COUNTED ✓)

↓

Debounce: 800ms minimum between reps (prevents double-counts)
```

### Sensitivity Slider
| Setting | Elbow angle threshold | Meaning |
|---------|----------------------|---------|
| 1 (Strict) | 75° | Must nearly fully curl — chin clearly above bar |
| 3 (Default) | 95° | Balanced — standard pull-up form |
| 5 (Loose) | 118° | Counts partial reps / mobility-limited users |

---

## Camera Setup Tips

- Mount phone/webcam to the **side** so your full torso is visible
- Ensure good lighting — backlit windows reduce accuracy
- Wear fitted clothing (baggy sleeves can obscure elbows)
- Stand ~2–3m from camera so your full range of motion is visible

---

## Features

- ✅ Real-time skeleton overlay (lime green)
- ✅ Elbow angle progress bar
- ✅ Rep flash animation
- ✅ Set tracking + history log
- ✅ Session timer
- ✅ Best set tracker
- ✅ Adjustable detection sensitivity
- ✅ Privacy-first: no video leaves your device
- ✅ Fully responsive (mobile-friendly)

---

## Customization

### Change the detection model to LIGHTNING (faster, less accurate)
In `app.js`, find:
```js
modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
```
Change to:
```js
modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
```

### Adjust angle thresholds
In `app.js`:
```js
const SENSITIVITY_MAP = { 1: 75, 2: 85, 3: 95, 4: 105, 5: 118 };
const DOWN_ANGLE = 155; // "hanging" position
```

### Add audio feedback
In the `countRep()` function, add:
```js
const beep = new AudioContext();
const osc = beep.createOscillator();
osc.connect(beep.destination);
osc.frequency.value = 880;
osc.start(); osc.stop(beep.currentTime + 0.1);
```

---

## Browser Support

| Browser | Support |
|---------|---------|
| Chrome 90+ | ✅ Full |
| Firefox 88+ | ✅ Full |
| Safari 15+ | ✅ Full |
| Edge 90+ | ✅ Full |
| Mobile Chrome | ✅ Good |
| Mobile Safari | ⚠️ Works, slower |

---

## Privacy

All pose detection runs entirely in your browser using WebGL acceleration.
No video, images, or keypoint data are ever transmitted anywhere.
