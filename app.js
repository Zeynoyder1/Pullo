/**
 * PULLFORCE AI — app.js
 * Pull-up counter using TensorFlow.js MoveNet pose detection
 *
 * Algorithm:
 *   - Track the Y-position of WRISTS and SHOULDERS relative to the NOSE
 *   - A rep = full hang (arms extended) → chin above hands → return to hang
 *   - Elbow angle is the primary signal:
 *       DOWN phase: elbows ~straight (angle > threshold)
 *       UP   phase: elbows bent, nose at or above wrists
 */

/* ── DOM References ─────────────────────────────── */
const video          = document.getElementById('videoFeed');
const canvas         = document.getElementById('poseCanvas');
const ctx            = canvas.getContext('2d');
const repCountEl     = document.getElementById('repCount');
const phaseFill      = document.getElementById('phaseFill');
const phaseText      = document.getElementById('phaseText');
const overlayStatus  = document.getElementById('overlayStatus');
const statusDot      = document.getElementById('statusDot');
const statusLabel    = document.getElementById('statusLabel');
const repFlash       = document.getElementById('repFlash');
const placeholder    = document.getElementById('cameraPlaceholder');
const modelLoading   = document.getElementById('modelLoading');
const loadingBar     = document.getElementById('loadingBarFill');
const btnCamera      = document.getElementById('btnCamera');
const btnReset       = document.getElementById('btnReset');
const btnNewSet      = document.getElementById('btnNewSet');
const sensitivitySlider = document.getElementById('sensitivitySlider');
const totalRepsEl    = document.getElementById('totalReps');
const totalSetsEl    = document.getElementById('totalSets');
const bestSetEl      = document.getElementById('bestSet');
const elapsedTimeEl  = document.getElementById('elapsedTime');
const historyList    = document.getElementById('historyList');
const setNumberEl    = document.getElementById('setNumber');

/* ── State ──────────────────────────────────────── */
let detector     = null;
let animFrame    = null;
let cameraOn     = false;
let stream       = null;

let repCount     = 0;
let setNumber    = 1;
let totalReps    = 0;
let bestSet      = 0;
let setHistory   = [];
let sessionStart = null;
let timerInterval = null;

// Phase tracking
let phase        = 'down';   // 'down' | 'going-up' | 'up' | 'going-down'
let elbowAngleSmoothed = 180;
let lastRepTime  = 0;        // debounce (ms)
const REP_DEBOUNCE = 800;

/* ── Sensitivity map ────────────────────────────── */
// Maps slider 1-5 → elbow angle threshold for UP detection
const SENSITIVITY_MAP = {
  1: 75,  // strict  — must nearly fully curl
  2: 85,
  3: 95,  // default — forgiving
  4: 105,
  5: 118, // loose   — partial curl counts
};
const DOWN_ANGLE = 155; // considered "hanging" (arms extended)

/* ── Keypoint indices (MoveNet / COCO 17) ───────── */
const KP = {
  NOSE:          0,
  LEFT_EYE:      1,
  RIGHT_EYE:     2,
  LEFT_EAR:      3,
  RIGHT_EAR:     4,
  LEFT_SHOULDER: 5,
  RIGHT_SHOULDER:6,
  LEFT_ELBOW:    7,
  RIGHT_ELBOW:   8,
  LEFT_WRIST:    9,
  RIGHT_WRIST:  10,
  LEFT_HIP:     11,
  RIGHT_HIP:    12,
  LEFT_KNEE:    13,
  RIGHT_KNEE:   14,
  LEFT_ANKLE:   15,
  RIGHT_ANKLE:  16,
};

/* ── Utility: angle between three points ────────── */
function angleBetween(a, mid, b) {
  const radians =
    Math.atan2(b.y - mid.y, b.x - mid.x) -
    Math.atan2(a.y - mid.y, a.x - mid.x);
  let angle = Math.abs((radians * 180) / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return angle;
}

/* ── Load model ─────────────────────────────────── */
async function loadModel() {
  modelLoading.classList.add('visible');
  try {
    await tf.ready();
    detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      {
        modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
        enableSmoothing: true,
      }
    );
    console.log('✅ MoveNet loaded');
  } catch (err) {
    console.error('Model load failed:', err);
    setStatus('error', 'Model failed to load');
  } finally {
    modelLoading.classList.remove('visible');
  }
}

/* ── Camera toggle ──────────────────────────────── */
async function toggleCamera() {
  if (cameraOn) {
    stopCamera();
  } else {
    await startCamera();
  }
}

async function startCamera() {
  if (!detector) {
    setStatus('', 'Loading AI model…');
    await loadModel();
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    // Show video + canvas
    placeholder.style.display = 'none';
    video.style.display = 'block';
    canvas.style.display = 'block';

    // Sync canvas size to video
    video.addEventListener('loadedmetadata', () => {
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
    });

    cameraOn = true;
    btnCamera.textContent = 'Stop Camera';
    btnCamera.classList.add('active');
    btnReset.disabled  = false;
    btnNewSet.disabled = false;

    setStatus('live', 'Detecting pose…');
    startSessionTimer();
    runDetection();
  } catch (err) {
    console.error('Camera error:', err);
    if (err.name === 'NotAllowedError') {
      setStatus('error', 'Camera access denied');
      alert('Please allow camera access and reload the page.');
    } else {
      setStatus('error', 'Camera unavailable');
    }
  }
}

function stopCamera() {
  cancelAnimationFrame(animFrame);
  if (stream) stream.getTracks().forEach(t => t.stop());
  video.style.display = 'none';
  canvas.style.display = 'none';
  placeholder.style.display = 'flex';
  cameraOn = false;
  btnCamera.textContent = 'Enable Camera';
  btnCamera.classList.remove('active');
  setStatus('', 'Camera off');
  stopSessionTimer();
}

/* ── Main detection loop ────────────────────────── */
async function runDetection() {
  if (!cameraOn) return;

  if (video.readyState >= 2) {
    try {
      const poses = await detector.estimatePoses(video);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (poses.length > 0) {
        const pose = poses[0];
        drawSkeleton(pose.keypoints);
        processPose(pose.keypoints);
      } else {
        setStatus('live', 'No person detected');
        phaseText.textContent = '—';
      }
    } catch (err) {
      console.warn('Detection error:', err);
    }
  }

  animFrame = requestAnimationFrame(runDetection);
}

/* ── Rep logic ──────────────────────────────────── */
function processPose(keypoints) {
  const conf = 0.25; // minimum keypoint confidence

  const get = (idx) => keypoints[idx];
  const ok  = (kp)  => kp && kp.score > conf;

  // Prefer whichever side has higher confidence
  const leftElbowAngle  = ok(get(KP.LEFT_SHOULDER)) && ok(get(KP.LEFT_ELBOW)) && ok(get(KP.LEFT_WRIST))
    ? angleBetween(get(KP.LEFT_SHOULDER), get(KP.LEFT_ELBOW), get(KP.LEFT_WRIST)) : null;

  const rightElbowAngle = ok(get(KP.RIGHT_SHOULDER)) && ok(get(KP.RIGHT_ELBOW)) && ok(get(KP.RIGHT_WRIST))
    ? angleBetween(get(KP.RIGHT_SHOULDER), get(KP.RIGHT_ELBOW), get(KP.RIGHT_WRIST)) : null;

  // Use average or whichever is available
  let elbowAngle = null;
  if (leftElbowAngle !== null && rightElbowAngle !== null) {
    elbowAngle = (leftElbowAngle + rightElbowAngle) / 2;
  } else if (leftElbowAngle !== null) {
    elbowAngle = leftElbowAngle;
  } else if (rightElbowAngle !== null) {
    elbowAngle = rightElbowAngle;
  }

  if (elbowAngle === null) {
    setStatus('live', 'Arms not visible');
    return;
  }

  // Smooth angle
  elbowAngleSmoothed = elbowAngleSmoothed * 0.7 + elbowAngle * 0.3;

  const upAngle   = SENSITIVITY_MAP[parseInt(sensitivitySlider.value)];
  const progress  = Math.max(0, Math.min(1, (DOWN_ANGLE - elbowAngleSmoothed) / (DOWN_ANGLE - upAngle)));

  // Update phase bar
  phaseFill.style.width = (progress * 100) + '%';
  phaseText.textContent = Math.round(elbowAngleSmoothed) + '°';

  // State machine
  const now = Date.now();

  if (phase === 'down' && elbowAngleSmoothed > DOWN_ANGLE) {
    // Confirmed hanging position
    setStatus('live', 'HANGING — pull up!');
  }

  if (phase === 'down' && elbowAngleSmoothed < upAngle) {
    phase = 'up';
    setStatus('live', 'UP — come back down');
  }

  if (phase === 'up' && elbowAngleSmoothed > DOWN_ANGLE) {
    if (now - lastRepTime > REP_DEBOUNCE) {
      phase = 'down';
      lastRepTime = now;
      countRep();
    }
  }
}

/* ── Count a rep ─────────────────────────────────── */
function countRep() {
  repCount++;
  totalReps++;

  // Update displays
  repCountEl.textContent = repCount;
  totalRepsEl.textContent = totalReps;
  if (repCount > bestSet) {
    bestSet = repCount;
    bestSetEl.textContent = bestSet;
  }

  // Animate counter
  repCountEl.classList.remove('bump');
  void repCountEl.offsetWidth; // reflow
  repCountEl.classList.add('bump');

  // Flash overlay
  repFlash.classList.remove('show');
  void repFlash.offsetWidth;
  repFlash.classList.add('show');

  setStatus('live', `Rep ${repCount} — keep going!`);
}

/* ── Draw skeleton ───────────────────────────────── */
function drawSkeleton(keypoints) {
  const connections = [
    [KP.LEFT_SHOULDER,  KP.RIGHT_SHOULDER],
    [KP.LEFT_SHOULDER,  KP.LEFT_ELBOW],
    [KP.LEFT_ELBOW,     KP.LEFT_WRIST],
    [KP.RIGHT_SHOULDER, KP.RIGHT_ELBOW],
    [KP.RIGHT_ELBOW,    KP.RIGHT_WRIST],
    [KP.LEFT_SHOULDER,  KP.LEFT_HIP],
    [KP.RIGHT_SHOULDER, KP.RIGHT_HIP],
    [KP.LEFT_HIP,       KP.RIGHT_HIP],
    [KP.LEFT_HIP,       KP.LEFT_KNEE],
    [KP.RIGHT_HIP,      KP.RIGHT_KNEE],
    [KP.LEFT_KNEE,      KP.LEFT_ANKLE],
    [KP.RIGHT_KNEE,     KP.RIGHT_ANKLE],
    [KP.LEFT_EAR,       KP.LEFT_SHOULDER],
    [KP.RIGHT_EAR,      KP.RIGHT_SHOULDER],
  ];

  const LIME   = '#C8FF00';
  const FADED  = 'rgba(200,255,0,0.3)';
  const conf   = 0.25;

  // Lines
  ctx.lineWidth = 2.5;
  connections.forEach(([i, j]) => {
    const a = keypoints[i], b = keypoints[j];
    if (a?.score > conf && b?.score > conf) {
      ctx.beginPath();
      ctx.strokeStyle = LIME;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  });

  // Points
  keypoints.forEach((kp) => {
    if (kp.score > conf) {
      ctx.beginPath();
      ctx.fillStyle = kp.score > 0.6 ? LIME : FADED;
      ctx.arc(kp.x, kp.y, 4, 0, 2 * Math.PI);
      ctx.fill();
    }
  });
}

/* ── Status helper ───────────────────────────────── */
function setStatus(type, message) {
  statusLabel.textContent = message;
  statusDot.className = 'status-dot';
  if (type) statusDot.classList.add(type);
}

/* ── Reset current set ───────────────────────────── */
function resetReps() {
  repCount = 0;
  phase = 'down';
  elbowAngleSmoothed = 180;
  repCountEl.textContent = '0';
  phaseFill.style.width = '0%';
  phaseText.textContent = '—';
}

/* ── New set ─────────────────────────────────────── */
function newSet() {
  if (repCount > 0) {
    // Log completed set
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <span class="history-item-label">Set ${setNumber}</span>
      <span class="history-item-val">${repCount} reps</span>
    `;
    // Remove empty message
    const empty = historyList.querySelector('.history-empty');
    if (empty) empty.remove();
    historyList.prepend(item);

    if (repCount > bestSet) {
      bestSet = repCount;
      bestSetEl.textContent = bestSet;
    }
    setHistory.push(repCount);
  }

  setNumber++;
  setNumberEl.textContent = setNumber;
  totalSetsEl.textContent = setNumber;
  resetReps();
}

/* ── Session timer ───────────────────────────────── */
function startSessionTimer() {
  if (sessionStart) return;
  sessionStart = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    elapsedTimeEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  }, 1000);
}

function stopSessionTimer() {
  clearInterval(timerInterval);
}

/* ── Event listeners ─────────────────────────────── */
btnCamera.addEventListener('click', toggleCamera);
btnReset.addEventListener('click', resetReps);
btnNewSet.addEventListener('click', newSet);

/* Smooth scroll for "Start Counting" button */
document.querySelectorAll('a[href="#tracker"]').forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('tracker').scrollIntoView({ behavior: 'smooth' });
  });
});

/* ── On load: pre-load model ─────────────────────── */
window.addEventListener('load', () => {
  // Defer model loading until camera is requested (saves bandwidth)
  console.log('PullForce AI ready. Click "Enable Camera" to begin.');
});
