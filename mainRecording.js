import { FilesetResolver, FaceLandmarker } from "@mediapipe/tasks-vision";
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// --- Recording buffers (built lazily on first frame) ---
let FaceLog = null;             // will become { key: Float32Array(...) }
let FaceOrder = null;           // stable list of blendshape names (from 1st frame)
let FaceCols = null;            // parallel array of references to FaceLog[key]
let FaceLogIdx = 0;             // current write index
const FaceLogBuffer = 60; // Number of frames to store in the circular buffer

//let t0 = performance.now() * 0.001;                  // first-frame timestamp (ms)
//let elapsed=null;

let t0 = null;         // set on first frame
let elapsed = 0;       // seconds since start (video time)
let FirstLog = true;
let isProcessing = false;



// MEDIAPIPE

let faceLandmarker;
let lastVideoTime = -1;
let video, container;
let skinnedMeshes = [];

async function initFaceLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "/static/AvatarAnimation/wasm"
  );

  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "/static/AvatarAnimation/models/face_landmarker.task"
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  renderLoop();
}

 function renderLoop() {

  if (video && video.currentTime !== lastVideoTime && !isProcessing) {
    isProcessing = true;

    const tVideo = video.currentTime;

    const result = faceLandmarker.detectForVideo(video, tVideo * 1000);
    processResults(result, tVideo);

    lastVideoTime = tVideo;
    isProcessing = false;
  }
  
   requestAnimationFrame(renderLoop);
 }

function processResults(result) {
  if (!result.faceLandmarks || result.faceLandmarks.length === 0) return;
  
  const tVideo = video.currentTime;     // seconds
  if (t0 === null) t0 = tVideo;
  elapsed = tVideo - t0;

  const categories = result.faceBlendshapes[0].categories;

  // Lazily build all buffers from the *first* frame we see
  if (!FaceCols) {
    FaceOrder = categories.map(c => c.categoryName);

    // Build FaceLog with one Array per key discovered
    FaceLog = Object.fromEntries(
      FaceOrder.map(name => [name, new Array(FaceLogBuffer).fill(0)])
    );

    // Always include timing & head rotation channels
    FaceLog.timestamp = new Array(FaceLogBuffer).fill(0);
    FaceLog.w = new Array(FaceLogBuffer).fill(0);
    FaceLog.x = new Array(FaceLogBuffer).fill(0);
    FaceLog.y = new Array(FaceLogBuffer).fill(0);
    FaceLog.z = new Array(FaceLogBuffer).fill(0);

    // Create direct references for fast writes
    FaceCols = FaceOrder.map(name => FaceLog[name]);

    // Handy debug: confirm exactly what we built
    console.log("✅ FaceLog initialized with keys:", FaceOrder.length + 5, { FaceOrder, FaceLogBuffer });
  }

  // timestamp in seconds
  FaceLog.timestamp[FaceLogIdx] = elapsed; // in seconds

  // Map current frame’s scores by name → value
  const scoreByName = Object.create(null);
  for (let k = 0; k < categories.length; k++) {
    const c = categories[k];
    scoreByName[c.categoryName] = c.score || 0;
  }

  // Write each column in the fixed first-frame order
  for (let j = 0; j < FaceCols.length; j++) {
    const name = FaceOrder[j];
    FaceCols[j][FaceLogIdx] = scoreByName[name] ?? 0;  // no undefined writes
  }

  // store quaternion
  const matrix = new THREE.Matrix4().fromArray(result.facialTransformationMatrixes[0].data);
  const pos = new THREE.Vector3(), rot = new THREE.Quaternion(), scl = new THREE.Vector3();
  matrix.decompose(pos, rot, scl);
  FaceLog.w[FaceLogIdx] = rot.w;
  FaceLog.x[FaceLogIdx] = rot.x;
  FaceLog.y[FaceLogIdx] = rot.y;
  FaceLog.z[FaceLogIdx] = rot.z;

  FaceLogIdx = (FaceLogIdx + 1) % FaceLogBuffer;

  if (FaceLogIdx === 0 && !FirstLog) {

    globalThis.FaceLog = FaceLog;
    globalThis.FaceLogTrigger = true;

  };

  FirstLog = false;
}

// THREEJS

const loader = new GLTFLoader();
let avatarMesh;

// Create the Three.js scene and camera
const scene = new THREE.Scene();

// Ambient light (soft general light)
const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(ambientLight);

// Directional light (frontal illumination)
const directionalLight = new THREE.DirectionalLight(0xffffff, 2.5);
directionalLight.position.set(0, 2, 2.5); // light coming from camera direction
scene.add(directionalLight);

// Create and configure the renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true});

document.addEventListener('DOMContentLoaded', () => {

  console.assert(avatarPath, 'avatarPath must be defined globally');

  // Get DOM elements
  video = document.getElementById("video");
  container = document.getElementById("avatarContainer");
  const width = container.clientWidth;
  const height = container.clientHeight;

  // Camera setup
  const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
  camera.position.set(0, 0.6, 0.35);
  camera.lookAt(0, 0.6, 0);
  scene.add(camera);
  scene.background = null; // No background

  // Set up renderer with container dimensions
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  // Load the avatar model
  loader.load(avatarPath, gltf => {
    console.log("✅ Avatar GLB loaded successfully:", gltf);
    avatarMesh = gltf.scene;
    scene.add(avatarMesh);

    avatarMesh.traverse(child => {
      if (child.isSkinnedMesh && child.morphTargetDictionary) {
        avatarMesh = child;
      }
    });

    skinnedMeshes = [];
    gltf.scene.traverse(child => {
      if (child.isSkinnedMesh && child.morphTargetDictionary) {
        skinnedMeshes.push(child);
        child.material.morphTargets = true;
        child.material.needsUpdate = true;
        console.log(`✅ Found SkinnedMesh: ${child.name}, morphs: ${Object.keys(child.morphTargetDictionary).length}`);
      }
    });

    console.log("Available morph targets:", avatarMesh.morphTargetDictionary);
    console.log("Morph influences:", avatarMesh.morphTargetInfluences);
    console.log("Morph targets enabled on material?", avatarMesh.material?.morphTargets);
    console.log("Morph target count:", avatarMesh.morphTargetInfluences?.length);
    console.log("Geometry has morphAttributes?", avatarMesh.geometry?.morphAttributes);
    renderer.render(scene, camera);

  }, undefined, error => {
      console.error('Failed to load avatar model:', error);
  });

// Initialize camera, then start tracking once video is ready
  navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
    video.srcObject = stream;

    video.addEventListener('loadeddata', () => {
      console.log("Camera stream is active");
  
      // START MEDIAPIPE
      initFaceLandmarker();
      
    });
  }).catch(err => {
    console.error("Camera permission denied or unavailable:", err);
  });

});
