import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

let experimental, sessionID, playerID, roundNum, roundStart, matchType;

let TriggerStart, TriggerRise, TriggerHold, TriggerFade;
let RiseInt, HoldInt, FadeInt;
let TriggerPeak;

const baseSmile = 0.15;
let smileValue = baseSmile;
let spontSmile = baseSmile;
let mimicSmile = 0;

let mimicryIntensity = 1;
const intensityLower = 0.6;
const intensityUpper = 1;

const inverseTargetFps = 1/32; // Seconds in the numerator, expected fps in the denominator. Determines length of the buffer.
let lastLog = 0;

function RandomTrunc(sd, halfRange) {
  // Mean Zero Triangular distribution, sd=1 gives [-2.45, 2.45]
  if (sd) {
    return sd * Math.sqrt(6) * (Math.random() - Math.random())
    // Range to each side grows with sqrt(6)~2.45 * sd
  } else if (halfRange) {
    return (halfRange / Math.sqrt(6)) * (Math.random() - Math.random())
    // sd grows with halfRange / 2.45
  }
}

function TriggerSmile() {
  
  RiseInt = 0.75 + RandomTrunc(undefined, 0.25);
  HoldInt = 2 + RandomTrunc(undefined, 0.75);
  FadeInt = 3 + RandomTrunc(undefined, 1);

  TriggerStart = performance.now() * 0.001; // seconds
  TriggerRise = TriggerStart + RiseInt;
  TriggerHold = TriggerRise + HoldInt;
  TriggerFade = TriggerHold + FadeInt;

  TriggerPeak = 0.2 + 0.2 * Math.random(); // MEAN 0.3, RANGE (2, 4) SOFT SMILE
}

function interpolateTrigger (t) {
  if (!TriggerStart){
    return baseSmile;
  }

  if (t > TriggerFade) {
    return baseSmile;

  } else if (t < TriggerRise) {
    const alpha = clampValue(((t - TriggerStart) / RiseInt));
    return (1-alpha) * baseSmile + alpha * TriggerPeak;

  } else if (t <= TriggerHold) {
    return TriggerPeak;

  } else { // If t <= TriggerFade
    const alpha = clampValue(((TriggerFade - t) / FadeInt));
    return (1-alpha) * baseSmile + alpha * TriggerPeak;
  }
}

// Exponential Moving Average (EM A)
let EMA = 0;
const tauFast = 0.65; // Seconds
const tauSlow = 3.5;
let AlphaFast, AlphaSlow; // EMA updating parameters
let MimicryThreshold = 0.0; // Smile threshold for mimicry onset

// Ornstein Uhlenbeck
let OU = 1;                // current OU value
const mu = 1;              // mean
let theta = 0.01, sigma = 0.05;
const BoundOU = 0.3;      // bound

// minimal Gaussian
function randn(){ const u=Math.random(); const v=Math.random(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }

function updateEMA(time) {
  const dt = time - lastLog;
  lastLog = time;

  // UPDATE RESPONSIVENESS VARIABILITY, OU PROCESS
  OU += theta*(mu - OU) + sigma*randn();
  if (OU >  mu + BoundOU) OU =  mu + BoundOU;
  if (OU < mu - BoundOU) OU = mu - BoundOU;

  // UPDATE INTENSITY VARIABILITY, BOUNDED RANDOM WALK
  mimicryIntensity += 0.05*(0.5 - Math.random()); 
  if (mimicryIntensity > intensityUpper) mimicryIntensity = intensityUpper;
  if (mimicryIntensity < intensityLower) mimicryIntensity = intensityLower;

  // UPDATE EMA PARAMETERS, 
  AlphaFast = 1 - Math.exp(-dt / tauFast);
  AlphaSlow = 1 - Math.exp(-dt / tauSlow);
}

let blinkSchedule = null; 
let BlinkSched    = null;   
let EyeLog = null;    // Float32Array with all numbers
let HeadLog = null;    // Float32Array with all numbers
let EyeOrder = [];    // ["eyeBlinkLeft", "jawOpen", ...]
let Time = null;
let nCols = 0;               // order.length
let nFrames = 0;             // EyeLog.length / nCols
let t0 = 0, t1 = 0, dur = 0;

let headBone = null;
let skinnedMeshes = [];
let morphMaps = [];

async function loadLivelinessData(headerPath, eyePath, blinkPath, headPath, timePath) {
  const EyeHeader      = await (await fetch(headerPath)).json();          // 1) get column names
  const EyeRaw      = await (await fetch(eyePath)).arrayBuffer();     // 2) get raw bytes
  const BlinkRaw       = await (await fetch(blinkPath)).arrayBuffer();     // 2) get raw bytes
  const HeadRaw    = await (await fetch(headPath)).arrayBuffer();
  const TimeRaw        = await (await fetch(timePath)).arrayBuffer();

  EyeLog           = new Float32Array(EyeRaw);                // 3) view as floats
  BlinkSched       = new Float32Array(BlinkRaw);                // 3) view as floats
  HeadLog          = new Float32Array(HeadRaw);                // 3) view as floats
  Time             = new Float32Array(TimeRaw);
  EyeOrder         = EyeHeader.order;                         // 4) save names
  nCols            = EyeOrder.length;                                   // 5) columns = names count
  nFrames          = (EyeLog.length / nCols) | 0;                       // 6) total frames (rows)
  // precompute constants for logical ring playback
  t0  = Time[0];
  t1  = Time[nFrames - 1];
  dur = t1 - t0;
}

// Helpers
function wrapBufferIndex(idx) { return (idx + bufferSize) % bufferSize; }
function clampValue(x) { return Math.min(1, Math.max(x, 0)); }

const blinkCloseInterval = 0.10;    // 100 ms fast close
const blinkHoldInterval = 0.04;     // 40 ms hold
const blinkOpenInterval  = 0.16;    // 160 ms slower open

function scheduleIndex(schedule, t) {
  return schedule.findLastIndex(v => v < t);   // last index with value < t (i.e., t - 1)
}

function blinkValueAt(t) {

  const currentBlink = scheduleIndex(blinkSchedule.start, t)

//  if (t < debugLogDuration) {
//    console.log("Current Blink Index", currentBlink);
//  }

  if (currentBlink < 0 || t > blinkSchedule.open[currentBlink]) {
    return 0; 
  } else if (t <= blinkSchedule.close[currentBlink]) {
    return ((t - blinkSchedule.start[currentBlink]) / blinkCloseInterval); // Return blink value (percentage) for closing interval
  } else if (t <= blinkSchedule.hold[currentBlink]) {
    return 1;
  } else {
    return (1 - ((t - blinkSchedule.hold[currentBlink]) / blinkOpenInterval)); // Return blink value for opening interval
  }
  
}

// CONNECT WEBSOCKET FUNCTION
let ws;


function connectWebSocket() {
  const scheme = self.location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${scheme}://localhost:8001/ws`);
  
  ws.onopen = () => {
    console.log("✅ Worker WebSocket connected");
    const message = {
      session: sessionID,
      player: playerID,
      roundNum: roundNum,
      roundStart: roundStart,
      matchType: matchType
    };
    ws.send(JSON.stringify(message));
  };

  ws.onmessage = (event) => {
    let preds;
    try {
      preds = JSON.parse(event.data);
    } catch (err) {
      console.error("❌ JSON parse failed:", event.data, err);
      return;
    }
    try {
      const now = performance.now() * 0.001;
      ws.send(JSON.stringify({ Smile: smileValue, EMA: mimicSmile, Spont: spontSmile }));
      updateMimicryBuffer(experimental ? Number(preds["Happy"] ?? 0) : 0, now);
    } catch (err) {
      console.error("❌ Error processing inference message:", preds, err);
    }
  };

  ws.onclose = () => {
    console.warn("❌ WebSocket disconnected. Reconnecting in 2s...");
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = (err) => {
    console.error("WebSocket error:", err);
    ws.close();
  };
}

let smileBlendshapes = {
  eyeBlinkLeft: 0,
  eyeBlinkRight: 0,
  eyeSquintRight: 0,
  eyeSquintLeft: 0,
  jawOpen: 0,
  mouthSmileRight: 0,
  mouthSmileLeft: 0,
  browInnerUp: 0,
};

// Mimicry Buffer Parameters
const bufferSize = 1/inverseTargetFps * 3; // 3 seconds at the specified fps
const mimicryBuffer = {
  smile: new Float32Array(bufferSize).fill(0), // Raw DDAMFN inference
  EMA: new Float32Array(bufferSize).fill(0), // Exponential Moving Average
  timestamp: new Float32Array(bufferSize).fill(0),
  inverseDuration: new Float32Array(bufferSize).fill(0)
};
let bufferIndex = 0;
let lastSampleIndex = 0;

const mimicryLatency = 0.5; // 500ms
let segmentStartIndex = 0;
let segmentEndIndex = 1;

function updateMimicryBuffer(smile, time) {
  mimicryBuffer.smile[bufferIndex] = smile;
  mimicryBuffer.timestamp[bufferIndex] = time;
  const previousBufferIndex = wrapBufferIndex(bufferIndex - 1);
  const deltaTime = time - mimicryBuffer.timestamp[previousBufferIndex]
  mimicryBuffer.inverseDuration[previousBufferIndex] = 1 / Math.max(deltaTime, 1e-6); // Store it as division to avoid division on the fly

  updateEMA(time);

  if (smile > MimicryThreshold) {
    const FastEMA = EMA + OU * AlphaFast * (Math.min(smile * mimicryIntensity, 1) - EMA); // PUT INTENSITY VARIABILITY INSIDE THE EMA SO CHANGES GET SMOOTHED
    const SlowEMA = EMA + OU * AlphaSlow * (Math.min(smile * mimicryIntensity, 1) - EMA);
    EMA = Math.max(FastEMA, SlowEMA);
    mimicryBuffer.EMA[bufferIndex] = EMA;
  } else {
    const FastEMA = EMA + OU * AlphaFast * (Math.min(smile * mimicryIntensity, 1) - EMA) * 0.9;
    const SlowEMA = EMA + OU * AlphaSlow * (Math.min(smile * mimicryIntensity, 1) - EMA) * 0.9;
    EMA = Math.max(FastEMA, SlowEMA);
    mimicryBuffer.EMA[bufferIndex] = EMA;
  }

  lastSampleIndex = bufferIndex; // GUARD LAST KNOWN VALUE

  bufferIndex = wrapBufferIndex(bufferIndex + 1);
}

function interpolateMimicry(t) {

  // Latency adjusted time
  const displayTime = t - mimicryLatency;

  // Catch up if we've gone past the last known sample
  if (displayTime >= mimicryBuffer.timestamp[lastSampleIndex]) {
    updateMimicryBuffer(0, t);
  }

  // Advance segment if needed
  while (displayTime >= mimicryBuffer.timestamp[segmentEndIndex]) {
    segmentStartIndex = segmentEndIndex;
    segmentEndIndex   = wrapBufferIndex(segmentEndIndex + 1);
  }
  
  // Alpha gets the percentage of the interval remaining to ease in the next value
  let alpha = (displayTime - mimicryBuffer.timestamp[segmentStartIndex]) * mimicryBuffer.inverseDuration[segmentStartIndex] // Multiply because we have the inverse denominator
  alpha = clampValue(alpha);
  return (1-alpha)*mimicryBuffer.EMA[segmentStartIndex] + alpha*mimicryBuffer.EMA[segmentEndIndex];
}

// THREEJS

const loader = new GLTFLoader();

function updateLiveliness(t) {

  const timeIdx = scheduleIndex(Time, t);

  // Update eye blendshapes
  const base = timeIdx * nCols;
  for (const { dict, infl } of morphMaps) {
    for (let c = 0; c < nCols; c++) {
      const name = EyeOrder[c];
      const index = dict[name];
      if (index !== undefined) infl[index] = EyeLog[base + c];
    }
  }

  // Update head quaternion
  if (headBone) {
    const qBase = timeIdx * 4;
    headBone.quaternion.set(
      HeadLog[qBase], 
      HeadLog[qBase + 1], 
      HeadLog[qBase + 2], 
      HeadLog[qBase + 3]
    );            
  };
}

function updateSmile(blendshapes) {
  for (const { dict, infl } of morphMaps) {
    for (const [key, value] of Object.entries(blendshapes)) {
      const index = dict[key];
      if (index !== undefined) infl[index] = value;
    }
  }
}

// --- Render loop (use your existing animate, adapted for time-based updates) ---
function animate() {
  const tNow = performance.now() * 0.001;

  const tRel = ((tNow - t0) % dur + dur) % dur + t0; // <-- wrap into [t0, t1)

  // Compute blink closure over this frame's interval
  const blinkValue = blinkValueAt(tRel) || 0;
//    if (tNow < debugLogDuration) {
//      console.log("Blink Value", blinkValue);
//    }
  mimicSmile = interpolateMimicry(tNow);
  spontSmile = interpolateTrigger(tNow);
  smileValue = Math.max(mimicSmile, spontSmile, baseSmile);

  const smileSq    = smileValue**2;
  const smileFth   = smileValue**4;

  smileBlendshapes.eyeBlinkLeft   = blinkValue;
  smileBlendshapes.eyeBlinkRight  = blinkValue;
  smileBlendshapes.eyeSquintRight = 0.8 * smileSq;
  smileBlendshapes.eyeSquintLeft  = 0.8 * smileSq;
  smileBlendshapes.jawOpen        = 0.15 * smileFth;
  smileBlendshapes.mouthSmileRight= 0.8 * smileValue;
  smileBlendshapes.mouthSmileLeft = 0.8 * smileValue;
  smileBlendshapes.browInnerUp    = 0.075 * smileValue;

  updateLiveliness(tRel);
  updateSmile(smileBlendshapes);
  renderer.render(scene, camera);
  self.requestAnimationFrame(animate);
}

// 1) Promise wrapper for GLTFLoader.load
function loadAvatarAsync(avatarPath) {
  return new Promise((resolve, reject) => {
    loader.load(
      avatarPath,
      (gltf) => {
        // your existing success setup:
        const avatarRoot = gltf.scene;
        scene.add(avatarRoot);

        skinnedMeshes = [];
        avatarRoot.traverse((child) => {
          if (child.isSkinnedMesh && child.morphTargetDictionary) {
            skinnedMeshes.push(child);
            child.material.morphTargets = true;
            child.material.needsUpdate = true;
          }
        });

        morphMaps = skinnedMeshes.map((mesh) => ({
          mesh,
          dict: mesh.morphTargetDictionary,
          infl: mesh.morphTargetInfluences,
        }));

        headBone = null;
        for (const m of skinnedMeshes) {
          const b = m.skeleton?.getBoneByName("Head");
          if (b) { headBone = b; break; }
        }

        resolve(); // avatar ready
      },
      undefined,
      reject
    );
  });
}

// Create the Three.js scene and camera
const scene = new THREE.Scene();
scene.background = null; // No background
//scene.background = new THREE.Color(0xffffff); // White background

// Ambient light (soft general light)
const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(ambientLight);

// Directional light (frontal illumination)
const directionalLight = new THREE.DirectionalLight(0xffffff, 2.5);
directionalLight.position.set(0, 2, 2.5); // light coming from camera direction
scene.add(directionalLight);

let renderer, camera;

async function InitCanvas(data) {

  const {
    canvas, 
    width, 
    height, 
    dpr, 
    avatarPath,
    headerPath,
    eyePath,
    blinkPath,
    headPath,
    timePath,
    exper,
    sess,
    play,
    rNum,
    rStart,
    mType,
  } = data;

  experimental = exper;
  //console.log("Treatment assignment: ", experimental, "Type: ", typeof experimental, "Is Truthy: ", !!experimental)
  sessionID = sess;
  playerID = play;
  roundNum = rNum;
  roundStart = rStart;
  matchType = mType;

  // Create and configure the renderer
  renderer = new THREE.WebGLRenderer({
    canvas: canvas,   // canvas you receive from main
    antialias: false,
    precision: 'lowp',
    alpha: true,
    powerPreference: 'low-power',
    depth: true,
    preserveDrawingBuffer: false,
    logarithmicDepthBuffer: false,
  });

  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false);
  
  // Camera setup
  camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
  camera.position.set(0, 0.6, 0.35);
  camera.lookAt(0, 0.6, 0);

  // Load the avatar model
  // 🚀 await both loads
  await loadAvatarAsync(avatarPath);
  await loadLivelinessData(headerPath, eyePath, blinkPath, headPath, timePath);

  // OPEN CONNECTION TO BACK END, WAIT FOR THE AVATAR TO RENDER BEFORE CONSUMING THE CPU
  connectWebSocket(); // WE NEED THE INIT DATA FOR THE WS HANDSHAKE

/*
  // --- isolated GL info check (no collisions) ---
  (function __printGlInfo__(r) {
    try {
      const ctx = r.getContext(); // uses same context
      const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
      const vendor = dbg ? ctx.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : ctx.getParameter(ctx.VENDOR);
      const rendererName = dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER);
      console.log("🖥️ WebGL Info:", { vendor, renderer: rendererName });
    } catch (err) {
      console.error("GL info probe failed:", err);
    }
  })(renderer);
*/

  const blinkStart = BlinkSched;
  const blinkClose = blinkStart.map(s => s + blinkCloseInterval);
  const blinkHold = blinkClose.map(s => s + blinkHoldInterval);
  const blinkOpen  = blinkHold.map(s => s + blinkOpenInterval);

  blinkSchedule = {
    start: blinkStart,
    close: blinkClose,
    hold: blinkHold,
    open: blinkOpen
  };

  // START ANIMATION LOOP
  animate();
}

function onResize(data) {

  const width = data.containerWidth;
  const height = data.containerHeight || 1; // avoid 0 division
  
  if (!camera || !width || !height) return;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setPixelRatio(data.dpr);
  renderer.setSize(width, height, false);
  
  renderer.render(scene, camera);
}

self.onmessage = (e) => {

  if (e.data.trigger) {
    TriggerSmile();
//    console.log("✅ Smile trigger received by worker")
    return;

  } else if (e.data.canvas) {
    InitCanvas(e.data);
//    console.log("✅ Init message received by worker")
    return;

  } else if (e.data.resize) {
    onResize(e.data);
//    console.log("✅ Resize message received by worker")
    return;
  }

}

