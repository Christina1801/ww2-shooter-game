import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';

const socket = io();
const overlay = document.getElementById('overlay');
const joinBtn = document.getElementById('joinBtn');
const nameInput = document.getElementById('nameInput');
const teamSelect = document.getElementById('teamSelect');

const gameState = {
  selfId: null,
  room: 'de_dust',
  players: new Map(),
  gameState: {},
  keys: {},
  yaw: 0,
  pitch: 0,
  lastInputSent: 0,
  selectedWeapon: 'usp',
  money: 800
};

// Three.js setup
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a0e27');
scene.fog = new THREE.Fog('#0a0e27', 60, 120);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
camera.rotation.order = 'YXZ';
camera.position.set(0, 1.7, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// Lighting
const ambient = new THREE.AmbientLight('#e0e7ff', 0.7);
scene.add(ambient);

const sun = new THREE.DirectionalLight('#fbbf24', 1.2);
sun.position.set(30, 40, 20);
sun.castShadow = true;
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.far = 100;
sun.shadow.camera.left = -50;
sun.shadow.camera.right = 50;
sun.shadow.camera.top = 50;
sun.shadow.camera.bottom = -50;
scene.add(sun);

// Map geometry
const groundMaterial = new THREE.MeshStandardMaterial({ color: '#3b4c5c', roughness: 0.95, metalness: 0 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Walls and obstacles
const wallMaterial = new THREE.MeshStandardMaterial({ color: '#5a6b7a', roughness: 0.8, metalness: 0.1 });

const obstacles = [
  { pos: [-25, 2, 0], size: [3, 4, 15] },
  { pos: [25, 2, 0], size: [3, 4, 15] },
  { pos: [0, 2, -28], size: [20, 4, 3] },
  { pos: [0, 2, 28], size: [20, 4, 3] },
  { pos: [-12, 2, -15], size: [8, 3, 8] },
  { pos: [12, 2, 15], size: [8, 3, 8] }
];

for (const obs of obstacles) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...obs.size), wallMaterial);
  mesh.position.set(...obs.pos);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// Player meshes
const playerMeshes = new Map();

function createPlayerMesh(player) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 1.8, 0.5),
    new THREE.MeshStandardMaterial({ color: player.team === 'Counter' ? '#3b82f6' : '#ef4444', roughness: 0.6 })
  );
  body.position.y = 1;
  body.castShadow = true;
  body.receiveShadow = true;

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 16, 16),
    new THREE.MeshStandardMaterial({ color: '#e8b68e', roughness: 0.5 })
  );
  head.position.y = 2.1;
  head.castShadow = true;
  head.receiveShadow = true;

  const weapon = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.15, 1.2),
    new THREE.MeshStandardMaterial({ color: '#1f2937', roughness: 0.3, metalness: 0.7 })
  );
  weapon.position.set(0.5, 1.1, 0.4);
  weapon.castShadow = true;

  group.add(body);
  group.add(head);
  group.add(weapon);
  group.userData.player = player;

  scene.add(group);
  playerMeshes.set(player.id, group);
  return group;
}

function updatePlayers(players) {
  const nextIds = new Set(players.map((p) => p.id));

  for (const [id, mesh] of playerMeshes) {
    if (!nextIds.has(id)) {
      scene.remove(mesh);
      playerMeshes.delete(id);
    }
  }

  for (const player of players) {
    let mesh = playerMeshes.get(player.id);
    if (!mesh) {
      mesh = createPlayerMesh(player);
    }

    mesh.position.set(player.x, 0, player.z);
    mesh.rotation.y = player.yaw || 0;
    mesh.userData.player = player;

    if (player.id === gameState.selfId) {
      gameState.money = player.money;
      document.getElementById('health').textContent = `HP: ${Math.max(0, player.hp)}`;
      document.getElementById('money').textContent = `$${player.money}`;
      document.getElementById('ammo').textContent = `${player.ammo} / ${player.reserveAmmo}`;
      document.getElementById('weapon').textContent = player.weapon.toUpperCase();
    }
  }
}

// HUD and UI
function updateHUD() {
  const hudContainer = document.getElementById('hudContainer');
  if (!hudContainer) {
    const container = document.createElement('div');
    container.id = 'hudContainer';
    container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
      z-index: 10;
    `;
    document.body.appendChild(container);
  }
}

// Join game
joinBtn.addEventListener('click', () => {
  const name = nameInput.value.trim() || 'Player';
  const team = teamSelect.value || 'Counter';
  overlay.classList.add('hidden');
  socket.emit('joinRoom', { room: gameState.room, name, team });
  updateHUD();
  renderer.domElement.requestPointerLock();
});

// Socket events
socket.on('joined', ({ selfId }) => {
  gameState.selfId = selfId;
  console.log('Joined as:', selfId);
});

socket.on('gameState', (state) => {
  gameState.gameState = state;
  document.getElementById('timer').textContent = `${state.timer}s`;
  document.getElementById('phase').textContent = state.phase.toUpperCase();
  document.getElementById('round').textContent = `R${state.round}`;
  document.getElementById('scoreT').textContent = `${state.scores.Terror}`;
  document.getElementById('scoreCT').textContent = `${state.scores.Counter}`;
  updatePlayers(state.players);
});

socket.on('shotResult', (result) => {
  if (result.hit) {
    const message = result.shooterId === gameState.selfId 
      ? `HIT! ${result.damage} DMG`
      : 'TOOK DAMAGE!';
    showMessage(message);
  }
});

socket.on('toast', (data) => {
  showMessage(data.text);
});

function showMessage(text) {
  const message = document.getElementById('message');
  message.textContent = text;
  message.style.display = 'block';
  setTimeout(() => {
    message.style.display = 'none';
  }, 2000);
}

// Input handling
document.addEventListener('keydown', (e) => {
  gameState.keys[e.code] = true;
  if (e.code === 'KeyE') {
    socket.emit('reload', { room: gameState.room });
  }
});

document.addEventListener('keyup', (e) => {
  gameState.keys[e.code] = false;
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  gameState.yaw -= e.movementX * 0.002;
  gameState.pitch -= e.movementY * 0.002;
  gameState.pitch = Math.max(-1.5, Math.min(1.5, gameState.pitch));
});

renderer.domElement.addEventListener('mousedown', () => {
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
    return;
  }

  const self = gameState.gameState.players?.find((p) => p.id === gameState.selfId);
  if (!self || !self.isAlive) return;

  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  socket.emit('shoot', {
    room: gameState.room,
    origin: { x: self.x, y: 1.7, z: self.z },
    direction: { x: direction.x, y: direction.y, z: direction.z }
  });
});

// Buy menu
function showBuyMenu() {
  const self = gameState.gameState.players?.find((p) => p.id === gameState.selfId);
  if (!self || gameState.gameState.phase !== 'buy') return;

  const menu = document.getElementById('buyMenu');
  menu.style.display = 'block';
  menu.innerHTML = `
    <div class="buy-panel">
      <h3>BUY PHASE (${gameState.gameState.timer}s)</h3>
      <div class="buy-items">
        <button class="buy-btn" data-weapon="usp">USP ($200)</button>
        <button class="buy-btn" data-weapon="deagle">DEAGLE ($700)</button>
        <button class="buy-btn" data-weapon="rifle">AK-47 ($2700)</button>
      </div>
      <p>Money: $${self.money}</p>
    </div>
  `;

  document.querySelectorAll('.buy-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const weapon = btn.getAttribute('data-weapon');
      socket.emit('buy', { room: gameState.room, item: weapon });
    });
  });
}

// Camera update
function updateCamera() {
  const self = gameState.gameState.players?.find((p) => p.id === gameState.selfId);
  if (!self) return;

  camera.position.set(self.x, 1.7, self.z);
  camera.rotation.y = gameState.yaw;
  camera.rotation.x = gameState.pitch;
}

// Movement
function updateMovement(delta) {
  const self = gameState.gameState.players?.find((p) => p.id === gameState.selfId);
  if (!self) return;

  const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), gameState.yaw);
  const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), gameState.yaw);

  let move = new THREE.Vector3();
  if (gameState.keys.KeyW) move.add(forward);
  if (gameState.keys.KeyS) move.sub(forward);
  if (gameState.keys.KeyD) move.add(right);
  if (gameState.keys.KeyA) move.sub(right);

  const speed = 8;
  if (move.lengthSq() > 0) {
    move.normalize();
    const nextX = self.x + move.x * speed * delta;
    const nextZ = self.z + move.z * speed * delta;

    if (Math.abs(nextX) < 38 && Math.abs(nextZ) < 38) {
      socket.emit('input', {
        room: gameState.room,
        x: nextX,
        z: nextZ,
        yaw: gameState.yaw,
        pitch: gameState.pitch
      });
    }
  } else {
    socket.emit('input', {
      room: gameState.room,
      x: self.x,
      z: self.z,
      yaw: gameState.yaw,
      pitch: gameState.pitch
    });
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Main loop
function animate() {
  requestAnimationFrame(animate);

  if (gameState.gameState.phase === 'buy') {
    showBuyMenu();
  } else {
    const buyMenu = document.getElementById('buyMenu');
    if (buyMenu) buyMenu.style.display = 'none';
  }

  updateMovement(1 / 60);
  updateCamera();
  renderer.render(scene, camera);
}

animate();
