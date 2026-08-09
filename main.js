const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaec6cf);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 1, 2000);
camera.position.set(300, 300, 300);

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas') });
renderer.setSize(window.innerWidth, window.innerHeight);

// Controls
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Light
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(100, 200, 100);
scene.add(light);

// Ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(2000, 2000),
  new THREE.MeshBasicMaterial({ color: 0x88aa88 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Load masterplan image (for verification)
const texture = new THREE.TextureLoader().load('assets/plan-2d.png');
const planMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(800, 400),
  new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.5 })
);
planMesh.rotation.x = -Math.PI / 2;
scene.add(planMesh);

let isPlanView = false;

function togglePlanView() {
  isPlanView = !isPlanView;

  if (isPlanView) {
    camera.position.set(0, 600, 0);
    camera.lookAt(0, 0, 0);
  } else {
    camera.position.set(300, 300, 300);
  }
}

// Load JSON + build scene
fetch('data/masterplan.json')
  .then(res => res.json())
  .then(data => {

    // Fields
    data.fields.forEach(f => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(f.width, f.height),
        new THREE.MeshBasicMaterial({ color: 0x3c8d2f })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(f.position[0], 1, f.position[1]);
      scene.add(mesh);
    });

    // Buildings
    data.buildings.forEach(b => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(b.width, 20, b.height),
        new THREE.MeshStandardMaterial({ color: 0xd9a066 })
      );
      mesh.position.set(b.position[0], 10, b.position[1]);
      scene.add(mesh);
    });

    // Roads
    data.roads.forEach(r => {
      const points = r.points.map(p => new THREE.Vector3(p[0], 0.1, p[1]));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: 0x000000 })
      );
      scene.add(line);
    });

  });

// Animate
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
