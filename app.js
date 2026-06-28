/**
 * RepTrack AI — app.js
 * Supports: Pull-Up detection + Push-Up detection
 *
 * Pull-Up algorithm:
 *   Track elbow angle (shoulder–elbow–wrist).
 *   DOWN = arms extended (angle > 150°)
 *   UP   = elbows bent past threshold (< ~90°)
 *   Rep  = DOWN → UP → DOWN
 *
 * Push-Up algorithm:
 *   Track elbow angle AND hip position relative to shoulders+ankles.
 *   DOWN = elbows bent (angle < ~90°), body close to ground
 *   UP   = arms extended (angle > 150°), body in plank line
 *   Rep  = UP → DOWN → UP
 */

/* ─── SVG gradient for ring ─────────────────────── */
document.body.insertAdjacentHTML('beforeend', `
  <svg id="ring-defs" style="position:absolute;width:0;height:0;overflow:hidden">
    <defs>
      <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#A78BFA"/>
        <stop offset="100%" stop-color="#60A5FA"/>
      </linearGradient>
      <linearGradient id="ringGradPushup" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#FB923C"/>
        <stop offset="100%" stop-color="#FBBF24"/>
      </linearGradient>
    </defs>
  </svg>`);

/* ─── DOM refs ───────────────────────────────────── */
const video       = document.getElementById('video');
const canvas      = document.getElementById('canvas');
const ctx         = canvas.getContext('2d');
const camIdle     = document.getElementById('camIdle');
const hud         = document.getElementById('hud');
const hudDot      = document.getElementById('hudDot');
const hudLabel    = document.getElementById('hudLabel');
const hudMode     = document.getElementById('hudMode');
const flash       = document.getElementById('flash');
const btnStart    = document.getElementById('btnStart');
const btnStop     = document.getElementById('btnStop');
const btnReset    = document.getElementById('btnReset');
const btnNewSet   = document.getElementById('btnNewSet');
const phaseFill   = document.getElementById('phaseFill');
const angleBadge  = document.getElementById('angleBadge');
const guideTip    = document.getElementById('guideTip');
const guideText   = document.getElementById('guideText');
const repCountEl  = document.getElementById('repCount');
const ringProg    = document.getElementById('ringProg');
const setNumEl    = document.getElementById('setNum');
const targetValEl = document.getElementById('targetVal');
const sTotalReps  = document.getElementById('sTotalReps');
const sSets       = document.getElementById('sSets');
const sBest       = document.getElementById('sBest');
const sTime       = document.getElementById('sTime');
const historyEl   = document.getElementById('history');
const sensitivity = document.getElementById('sensitivity');
const loadingOverlay = document.getElementById('loadingOverlay');
const modeBtns    = document.querySelectorAll('.mode-btn');

/* ─── State ──────────────────────────────────────── */
let detector     = null;
let stream       = null;
let animFrame    = null;
let cameraOn     = false;

let mode         = 'pullup';   // 'pullup' | 'pushup'

let repCount     = 0;
let setNumber    = 1;
let totalReps    = 0;
let bestSet      = 0;
let targetReps   = 10;
let setHistory   = [];

let phase        = 'down';     // pullup: 'down'|'up' / pushup: 'up'|'down'
let angleSmoothed = 180;
let lastRepTime  = 0;
const DEBOUNCE   = 900;

let sessionStart  = null;
let timerInterval = null;

const RING_CIRC   = 2 * Math.PI * 80; // r=80 → 502.65

/* ─── Keypoint indices (COCO 17) ────────────────── */
const KP = {
  NOSE:0, L_EYE:1, R_EYE:2, L_EAR:3, R_EAR:4,
  L_SHO:5, R_SHO:6, L_ELB:7, R_ELB:8,
  L_WRI:9, R_WRI:10, L_HIP:11, R_HIP:12,
  L_KNE:13, R_KNE:14, L_ANK:15, R_ANK:16,
};

/* ─── Guides per mode ────────────────────────────── */
const GUIDES = {
  pullup: [
    'Hang from the bar with arms fully extended. Side-on camera angle works best.',
    'Pull until your chin clears the bar, then lower back to full hang.',
    'Keep core tight. Rep is counted on return to full hang position.',
  ],
  pushup: [
    'Start in a plank: hands shoulder-width apart, body in a straight line.',
    'Lower until elbows reach ~90°, then push back up fully.',
    'Keep hips level — don\'t let them sag or pike up.',
  ],
};
let guideIndex = 0;
setInterval(() => {
  guideIndex = (guideIndex + 1) % GUIDES[mode].length;
  guideText.textContent = GUIDES[mode][guideIndex];
}, 6000);

/* ─── Sensitivity maps ───────────────────────────── */
// Pull-up: angle must drop below this to count as "up"
const PULLUP_UP_ANGLE = { 1:70, 2:80, 3:92, 4:104, 5:116 };
const PULLUP_DOWN_ANGLE = 148;

// Push-up: arm must extend above this to count as "up" (top position)
const PUSHUP_UP_ANGLE   = { 1:155, 2:148, 3:142, 4:135, 5:128 };
// Push-up: arm must bend below this to count as "down" (bottom position)
const PUSHUP_DOWN_ANGLE = { 1:80,  2:88,  3:96,  4:104, 5:112 };

/* ─── Angle helper ───────────────────────────────── */
function angleBetween(a, mid, b) {
  const r = Math.atan2(b.y - mid.y, b.x - mid.x) - Math.atan2(a.y - mid.y, a.x - mid.x);
  let deg = Math.abs(r * 180 / Math.PI);
  if (deg > 180) deg = 360 - deg;
  return deg;
}

/* ─── Load model ─────────────────────────────────── */
async function loadModel() {
  loadingOverlay.classList.add('show');
  await tf.ready();
  detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    { modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER, enableSmoothing: true }
  );
  loadingOverlay.classList.remove('show');
}

/* ─── Camera ─────────────────────────────────────── */
async function startCamera() {
  if (!detector) await loadModel();
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false
  });
  video.srcObject = stream;
  await video.play();
  video.addEventListener('loadedmetadata', () => {
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  });

  video.style.display = 'block';
  canvas.style.display = 'block';
  camIdle.style.display = 'none';
  hud.style.display = 'flex';
  btnStop.style.display = 'block';
  btnReset.disabled = false;
  btnNewSet.disabled = false;
  cameraOn = true;
  startTimer();
  setStatus('live', 'Detecting…');
  runLoop();
}

function stopCamera() {
  cancelAnimationFrame(animFrame);
  if (stream) stream.getTracks().forEach(t => t.stop());
  video.style.display = 'none';
  canvas.style.display = 'none';
  camIdle.style.display = 'flex';
  hud.style.display = 'none';
  btnStop.style.display = 'none';
  btnReset.disabled = true;
  btnNewSet.disabled = true;
  cameraOn = false;
  stopTimer();
  setStatus('', 'Stopped');
}

/* ─── Main loop ──────────────────────────────────── */
async function runLoop() {
  if (!cameraOn) return;
  if (video.readyState >= 2) {
    try {
      const poses = await detector.estimatePoses(video);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (poses.length > 0) {
        drawSkeleton(poses[0].keypoints);
        if (mode === 'pullup') processPullup(poses[0].keypoints);
        else                   processPushup(poses[0].keypoints);
      } else {
        setStatus('live', 'No person detected');
      }
    } catch(e) { /* swallow frame errors */ }
  }
  animFrame = requestAnimationFrame(runLoop);
}

/* ─── Pull-up logic ──────────────────────────────── */
function processPullup(kps) {
  const conf = 0.25;
  const ok = i => kps[i]?.score > conf;

  const la = (ok(KP.L_SHO) && ok(KP.L_ELB) && ok(KP.L_WRI))
    ? angleBetween(kps[KP.L_SHO], kps[KP.L_ELB], kps[KP.L_WRI]) : null;
  const ra = (ok(KP.R_SHO) && ok(KP.R_ELB) && ok(KP.R_WRI))
    ? angleBetween(kps[KP.R_SHO], kps[KP.R_ELB], kps[KP.R_WRI]) : null;

  const angle = (la !== null && ra !== null) ? (la+ra)/2 : (la ?? ra);
  if (angle === null) { setStatus('live', 'Arms not visible'); return; }

  angleSmoothed = angleSmoothed * 0.72 + angle * 0.28;

  const upThr   = PULLUP_UP_ANGLE[sensitivity.value];
  const downThr = PULLUP_DOWN_ANGLE;
  const progress = Math.max(0, Math.min(1, (downThr - angleSmoothed) / (downThr - upThr)));

  phaseFill.style.width = (progress * 100) + '%';
  angleBadge.textContent = Math.round(angleSmoothed) + '°';

  if (phase === 'down' && angleSmoothed < upThr) {
    phase = 'up';
    setStatus('live', 'UP — lower back down');
  } else if (phase === 'up' && angleSmoothed > downThr) {
    if (Date.now() - lastRepTime > DEBOUNCE) {
      phase = 'down'; lastRepTime = Date.now();
      countRep();
      setStatus('live', `Rep ${repCount} — keep going!`);
    }
  } else if (phase === 'down') {
    setStatus('live', angleSmoothed > 140 ? 'HANGING — pull up!' : 'Extend arms fully first');
  }
}

/* ─── Push-up logic ──────────────────────────────── */
function processPushup(kps) {
  const conf = 0.22;
  const ok = i => kps[i]?.score > conf;

  // Elbow angle
  const la = (ok(KP.L_SHO) && ok(KP.L_ELB) && ok(KP.L_WRI))
    ? angleBetween(kps[KP.L_SHO], kps[KP.L_ELB], kps[KP.L_WRI]) : null;
  const ra = (ok(KP.R_SHO) && ok(KP.R_ELB) && ok(KP.R_WRI))
    ? angleBetween(kps[KP.R_SHO], kps[KP.R_ELB], kps[KP.R_WRI]) : null;

  const angle = (la !== null && ra !== null) ? (la+ra)/2 : (la ?? ra);
  if (angle === null) { setStatus('live', 'Arms not visible'); return; }

  angleSmoothed = angleSmoothed * 0.72 + angle * 0.28;

  const upThr   = PUSHUP_UP_ANGLE[sensitivity.value];
  const downThr = PUSHUP_DOWN_ANGLE[sensitivity.value];

  // Progress: 0 = arms extended (top), 1 = arms bent (bottom)
  const progress = Math.max(0, Math.min(1, (upThr - angleSmoothed) / (upThr - downThr)));
  phaseFill.style.width = (progress * 100) + '%';
  angleBadge.textContent = Math.round(angleSmoothed) + '°';

  // Push-up rep: starts at top (extended), goes DOWN then back UP
  if (phase === 'up' && angleSmoothed < downThr) {
    phase = 'down';
    setStatus('live', 'DOWN — push back up!');
  } else if (phase === 'down' && angleSmoothed > upThr) {
    if (Date.now() - lastRepTime > DEBOUNCE) {
      phase = 'up'; lastRepTime = Date.now();
      countRep();
      setStatus('live', `Rep ${repCount} — great form!`);
    }
  } else if (phase === 'up') {
    setStatus('live', angleSmoothed > 135 ? 'TOP — lower down!' : 'Extend arms to start');
  }
}

/* ─── Count rep ──────────────────────────────────── */
function countRep() {
  repCount++;
  totalReps++;
  sTotalReps.textContent = totalReps;
  if (repCount > bestSet) { bestSet = repCount; sBest.textContent = bestSet; }

  repCountEl.textContent = repCount;
  repCountEl.classList.remove('bump');
  void repCountEl.offsetWidth;
  repCountEl.classList.add('bump');

  updateRing();

  // Flash
  flash.className = 'flash' + (mode === 'pushup' ? ' pushup-flash' : '');
  void flash.offsetWidth;
  flash.classList.add('pop');
}

/* ─── Ring progress ──────────────────────────────── */
function updateRing() {
  const frac = Math.min(repCount / targetReps, 1);
  const offset = RING_CIRC - frac * RING_CIRC;
  ringProg.style.strokeDashoffset = offset;
  ringProg.setAttribute('stroke', `url(#${mode === 'pushup' ? 'ringGradPushup' : 'ringGrad'})`);
}

/* ─── Draw skeleton ──────────────────────────────── */
function drawSkeleton(kps) {
  const CONNECTIONS = [
    [KP.L_SHO, KP.R_SHO],
    [KP.L_SHO, KP.L_ELB], [KP.L_ELB, KP.L_WRI],
    [KP.R_SHO, KP.R_ELB], [KP.R_ELB, KP.R_WRI],
    [KP.L_SHO, KP.L_HIP], [KP.R_SHO, KP.R_HIP],
    [KP.L_HIP, KP.R_HIP],
    [KP.L_HIP, KP.L_KNE], [KP.L_KNE, KP.L_ANK],
    [KP.R_HIP, KP.R_KNE], [KP.R_KNE, KP.R_ANK],
    [KP.L_EAR, KP.L_SHO], [KP.R_EAR, KP.R_SHO],
  ];

  const mainColor  = mode === 'pushup' ? '#FB923C' : '#A78BFA';
  const jointColor = mode === 'pushup' ? '#FBBF24' : '#60A5FA';
  const conf = 0.25;

  ctx.lineWidth = 2.5;
  CONNECTIONS.forEach(([i, j]) => {
    const a = kps[i], b = kps[j];
    if (a?.score > conf && b?.score > conf) {
      ctx.beginPath();
      ctx.strokeStyle = mainColor;
      ctx.globalAlpha = Math.min(a.score, b.score);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  });
  ctx.globalAlpha = 1;

  kps.forEach(kp => {
    if (kp.score > conf) {
      ctx.beginPath();
      ctx.fillStyle = kp.score > 0.6 ? jointColor : 'rgba(255,255,255,0.25)';
      ctx.arc(kp.x, kp.y, 5, 0, 2 * Math.PI);
      ctx.fill();
    }
  });
}

/* ─── Mode switch ────────────────────────────────── */
function setMode(m) {
  mode = m;
  phase = m === 'pullup' ? 'down' : 'up';
  angleSmoothed = 180;
  resetReps();

  modeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === m);
  });

  const isPush = m === 'pushup';
  hudMode.textContent = isPush ? 'PUSH-UP' : 'PULL-UP';
  hudMode.classList.toggle('pushup', isPush);
  phaseFill.classList.toggle('pushup', isPush);
  repCountEl.classList.toggle('pushup-mode', isPush);
  guideTip.classList.toggle('pushup-tip', isPush);
  guideText.textContent = GUIDES[m][0];
  guideIndex = 0;

  updateRing();
}

/* ─── Reset / new set ────────────────────────────── */
function resetReps() {
  repCount = 0;
  phase = mode === 'pullup' ? 'down' : 'up';
  angleSmoothed = 180;
  repCountEl.textContent = '0';
  phaseFill.style.width = '0%';
  angleBadge.textContent = '—';
  updateRing();
}

function newSet() {
  if (repCount > 0) {
    if (repCount > bestSet) { bestSet = repCount; sBest.textContent = bestSet; }

    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <span class="history-item-label">Set ${setNumber}</span>
      <span class="history-item-mode">${mode === 'pullup' ? '↑' : '↓'}</span>
      <span class="history-item-val ${mode}">${repCount} reps</span>
    `;
    const empty = historyEl.querySelector('.history-empty');
    if (empty) empty.remove();
    historyEl.prepend(item);
    setHistory.push({ mode, reps: repCount });
  }

  setNumber++;
  setNumEl.textContent = setNumber;
  sSets.textContent = setNumber;
  resetReps();
}

/* ─── Target ─────────────────────────────────────── */
document.getElementById('targetPlus').addEventListener('click', () => {
  targetReps = Math.min(targetReps + 1, 99);
  targetValEl.textContent = targetReps;
  updateRing();
});
document.getElementById('targetMinus').addEventListener('click', () => {
  targetReps = Math.max(targetReps - 1, 1);
  targetValEl.textContent = targetReps;
  updateRing();
});

/* ─── Timer ──────────────────────────────────────── */
function startTimer() {
  if (sessionStart) return;
  sessionStart = Date.now();
  timerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - sessionStart) / 1000);
    sTime.textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
  }, 1000);
}
function stopTimer() {
  clearInterval(timerInterval);
  sessionStart = null;
}

/* ─── Status ─────────────────────────────────────── */
function setStatus(type, msg) {
  hudLabel.textContent = msg;
  hudDot.className = 'hud-dot' + (type ? ` ${type}` : '');
}

/* ─── Event listeners ────────────────────────────── */
btnStart.addEventListener('click', async () => {
  try { await startCamera(); }
  catch(err) {
    if (err.name === 'NotAllowedError') {
      alert('Camera access denied. Please allow camera access and try again.');
    } else {
      alert('Could not start camera: ' + err.message);
    }
  }
});

btnStop.addEventListener('click', stopCamera);
btnReset.addEventListener('click', resetReps);
btnNewSet.addEventListener('click', newSet);

modeBtns.forEach(btn => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

/* ─── Init ───────────────────────────────────────── */
updateRing();
