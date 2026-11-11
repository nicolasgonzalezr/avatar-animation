import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// THREEJS

const loader = new GLTFLoader();
let avatarMesh;
let camera;      
let container;

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
  container = document.getElementById("avatarContainer");
  const width = container.clientWidth;
  const height = container.clientHeight;

  // Camera setup
  camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
  camera.position.set(0, 0.6, 0.35);
  camera.lookAt(0, 0.6, 0);
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
    renderer.render(scene, camera);

  }, undefined, error => {
      console.error('Failed to load avatar model:', error);
  });

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
