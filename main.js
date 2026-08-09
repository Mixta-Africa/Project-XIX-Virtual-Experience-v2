// ===== GLOBALS =====
let isPlanView = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaec6cf);

// Camera
const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 1, 5000);
camera.position.set(400, 400, 400);
camera.lookAt(0, 0, 0);

// Renderer
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas'), antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Light
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(200, 300, 200);
scene.add(light);

// Ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(5000, 5000),
  new THREE.MeshBasicMaterial({ color: 0x88aa88 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// ===== AUTO PLAN SETUP =====

// 🔥 You can tweak this ONE number only
const PLAN_SCALE = 1.5;

// Load plan image
const texture = new THREE.TextureLoader().load('assets/plan-2d.png', () => {
  console.log("Plan loaded");
});

const planMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(1000 * PLAN_SCALE, 600 * PLAN_SCALE),
  new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.7
  })
);

planMesh.rotation.x = -Math.PI / 2;
scene.add(planMesh);

// ===== AUTO CONTENT (NO JSON NEEDED) =====

// Main polo field (centered automatically)
const polo = new THREE.Mesh(
  new THREE.PlaneGeometry(300, 180),
  new THREE.MeshBasicMaterial({ color: 0x2e7d32 })
);
polo.rotation.x = -Math.PI / 2;
scene.add(polo);

// Training field (rough placement)
const training = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 140),
  new THREE.MeshBasicMaterial({ color: 0x388e3c })
);
training.rotation.x = -Math.PI / 2;
training.position.set(-350, 0, 0);
scene.add(training);

// Clubhouse block
const clubhouse = new THREE.Mesh(
  new THREE.BoxGeometry(80, 30, 50),
  new THREE.MeshStandardMaterial({ color: 0xd9a066 })
);
clubhouse.position.set(0, 15, -150);
scene.add(clubhouse);

// ===== DEBUG MARKERS (KEY FEATURE) =====

function addMarker(x, z, color = 0xff0000) {
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(5),
    new THREE.MeshBasicMaterial({ color })
  );
  marker.position.set(x, 5, z);
  scene.add(marker);
}

// Add center marker
addMarker(0, 0, 0xff0000);

// ===== TOGGLE VIEW =====

window.togglePlanView = function () {
  isPlanView = !isPlanView;

  if (isPlanView) {
    camera.position.set(0, 1200, 0);
    camera.lookAt(0, 0, 0);
  } else {
    camera.position.set(400, 400, 400);
  }
};

// ===== RESIZE =====
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ===== LOOP =====
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
