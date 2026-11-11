import { FilesetResolver, FaceLandmarker } from "@mediapipe/tasks-vision";
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// MEDIAPIPE
//let hasPrinted = true;
let faceLandmarker;
let lastVideoTime = -1;
let video, container, camera;
let skinnedMeshes = [];

async function initFaceLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "/static/AvatarAnimation//wasm"
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
  
  if (video && video.currentTime !== lastVideoTime) {
    const result = faceLandmarker.detectForVideo(video, video.currentTime * 1000);
    processResults(result);
    lastVideoTime = video.currentTime;    
  }
  requestAnimationFrame(renderLoop);
}

// let hasPrintedBlendshapes = false;

function processResults(result) {
  if (!result.faceLandmarks || result.faceLandmarks.length === 0) return;

//  if (!hasPrintedBlendshapes && result.facialTransformationMatrixes?.[0]) {
//    console.log("Transformation Matrix:", result.facialTransformationMatrixes?.[0]);
//    hasPrintedBlendshapes = true;
//  }

//  const transformationMatrix = result.facialTransformationMatrixes[0].data
//  if (!hasPrinted) {
//    console.log("MediaPipe Blendshapes: ", result.faceBlendshapes[0].categories.map(c => c.categoryName));
//    const matrix = new THREE.Matrix4().fromArray(transformationMatrix);
//    const pos = new THREE.Vector3();
//    const rot = new THREE.Quaternion();
//    const scl = new THREE.Vector3();
//    matrix.decompose(pos, rot, scl);
//    console.log("MediaPipe Quaternion: ", rot);
//    hasPrinted=true;
//  };

  updateAvatar(result.faceBlendshapes[0], result.facialTransformationMatrixes[0].data);
}

// THREEJS

const loader = new GLTFLoader();
let avatarMesh;

function updateAvatar(faceBlendshapes, headPosition) {
  if (!skinnedMeshes  || skinnedMeshes.length === 0) return;

  const categories = faceBlendshapes?.categories || [];

  skinnedMeshes.forEach(mesh => {
    const dict = mesh.morphTargetDictionary;
    const influences = mesh.morphTargetInfluences;

    // Map Mediapipe blendshape -> RPM morph target
    categories.forEach(({ categoryName, score }) => {
      const index = dict[categoryName];
      if (index !== undefined && !isNaN(score)) {
        influences[index] = score; // MediaPipe already gives 0–1
      }
    });

    const setMorph = (name, value) => {
      const index = dict[name];
      if (index !== undefined && !isNaN(value)) influences[index] = value;
    };

    // Standard ARKit targets from MediaPipe
    Object.entries(faceBlendshapes).forEach(([blendshape, value]) => {
      setMorph(blendshape, value);
    });

    // Head rotation
    if (avatarMesh.skeleton) {
      const headBone = avatarMesh.skeleton.getBoneByName("Head");
      if (headBone) {

        const matrix = new THREE.Matrix4().fromArray(headPosition);

        const pos = new THREE.Vector3();
        const rot = new THREE.Quaternion();
        const scl = new THREE.Vector3();

        matrix.decompose(pos, rot, scl);

        // Freeze vertical head tilt
        const euler = new THREE.Euler().setFromQuaternion(rot, 'XYZ');
        euler.y = -euler.y; // mirror left-right turning
        euler.z = -euler.z; // mirror tilting
//        euler.x = 0; // remove looking up/down
        rot.setFromEuler(euler);

        headBone.quaternion.copy(rot);

      }
    }
  });
}

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
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });


document.addEventListener('DOMContentLoaded', () => {

  console.assert(avatarPath, 'avatarPath must be defined globally');

  // Get DOM elements
  video = document.getElementById("video");
  container = document.getElementById("avatarContainer");
  const width = container.clientWidth;
  const height = container.clientHeight;

  // Camera setup
  camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
  camera.position.set(0, 0.6, 0.35); // FOR HALF BODY
  camera.lookAt(0, 0.6, 0); // FOR HALF BODY
//  camera.position.set(0, 1.6, 0.35); // FOR FULL BODY
//  camera.lookAt(0, 1.7, 0); // FOR FULL BODY
  scene.add(camera);
  scene.background = null; // No background


  // Set up renderer with container dimensions
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  // Load the avatar model
  loader.load(avatarPath, gltf => {
//    console.log("✅ Avatar GLB loaded successfully:", gltf);
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
//        console.log(`✅ Found SkinnedMesh: ${child.name}, morphs: ${Object.keys(child.morphTargetDictionary).length}`);
      }
    });

//    console.log("Available morph targets:", avatarMesh.morphTargetDictionary);
//    console.log("Morph influences:", avatarMesh.morphTargetInfluences);
//    console.log("Morph targets enabled on material?", avatarMesh.material?.morphTargets);
//    console.log("Morph target count:", avatarMesh.morphTargetInfluences?.length);
//    console.log("Geometry has morphAttributes?", avatarMesh.geometry?.morphAttributes);

  }, undefined, error => {
      console.error('Failed to load avatar model:', error);
  });

// Initialize camera, then start tracking once video is ready
  navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
    video.srcObject = stream;

    video.addEventListener('loadeddata', () => {
//      console.log("Camera stream is active");
  
      // START MEDIAPIPE
      initFaceLandmarker();
      
    });
  }).catch(err => {
    console.error("Camera permission denied or unavailable:", err);
  });


  // Animation loop
  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  
  animate();

});

function onResize() {
  if (!container || !camera) return;

  const width = container.clientWidth;
  const height = container.clientHeight || 1; // avoid 0 division

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height, true);
  renderer.render(scene, camera);
}

window.addEventListener('resize', onResize);