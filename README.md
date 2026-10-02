import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';

const socket = io();
const overlay = document.getElementById('overlay');
const joinBtn = document.getElementById('joinBtn');
const nameInput = document.getElementById('nameInput');
const healthNode = document.getElementById('health');
const killsNode = document.getElementById('kills');
const messageNode = document.getElementById('message');

const roomName = 'arena';
const state = {
  selfId: null,
  self: null,
  players: new Map(),
  keys: {},
  yaw: 0,
  pitch: 0,
  lastSent: 0
};

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0f172a');
scene.fog = new THREE.Fog('#0f172a', 24, 70);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);
camera.rotation.order = 'YXZ';
camera.position.set(0, 1.7, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const ambient = new THREE.AmbientLight('#dbeafe', 0.8);
scene.add(ambient);

const sun = new THREE.DirectionalLight('#f8fafc', 1.3);
sun.position.set(12, 22, 8);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshStandardMaterial({ color: '#2f4f3a', roughness: 0.9, metalness: 0.1 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const obstacleMaterial = new THREE.MeshStandardMaterial({ color: '#4b5563', metalness: 0.2, roughness: 0.8 });
const obstacleData = [
  { x: -8, z: -12, w: 8, h: 5, d: 2 },
  { x: 10, z: 8, w: 7, h: 5, d: 2 },
  { x: 0, z: 0, w: 6, h: 4, d: 4 },
  { x: -14, z: 12, w: 3, h: 4, d: 10 },
  { x: 14, z: -9, w: 3, h: 4, d: 12 }
];

const obstacles = [];
for (const block of obstacleData) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(block.w, block.h, block.d), obstacleMaterial);
  mesh.position.set(block.x, block.h / 2, block.z);
  scene.add(mesh);
  obstacles.push(mesh);
}

const playerMeshes = new Map();
const glowingRing = new THREE.Mesh(
  new THREE.TorusGeometry(1.1, 0.08, 12, 48),
  new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.7 })
);
glowingRing.rotation.x = Math.PI / 2;
glowingRing.position.y = 0.05;
scene.add(glowingRing);

function createPlayerMesh(player) {
  const group = new THREE.Group();
  const upper = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.8, 0.7),
    new THREE.MeshStandardMaterial({ color: player.team === 'Allies' ? '#2563eb' : '#ef4444' })
  );
  upper.position.y = 1.1;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 18, 18),
    new THREE.MeshStandardMaterial({ color: '#f5d7b5' })
  );
  head.position.y = 2.2;

  const weapon = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.2, 1.5),
    new THREE.MeshStandardMaterial({ color: '#111827' })
  );
  weapon.position.set(0.7, 1.2, 0.35);

  group.add(upper);
  group.add(head);
  group.add(weapon);

  const label = document.createElement('div');
  label.style.position = 'absolute';
  label.style.pointerEvents = 'none';
  label.style.background = 'rgba(15, 23, 42, 0.6)';
  label.style.border = '1px solid rgba(255,255,255,0.18)';
  label.style.borderRadius = '10px';
  label.style.padding = '4px 8px';
  label.style.fontSize = '12px';
  label.style.color = '#f8fafc';
  label.textContent = player.name;

  const labelSprite = label;
  group.userData.label = labelSprite;
  document.body.appendChild(labelSprite);

  scene.add(group);
  playerMeshes.set(player.id, group);
  return group;
}

function updateLabel(playerMesh, player) {
  const label = playerMesh.userData.label;
  if (!label) return;

  const pos = playerMesh.position.clone();
  pos.y += 2.8;
  const projected = pos.clone().project(camera);
  const x = (projected.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-projected.y * 0.5 + 0.5) * window.innerHeight;
  label.style.left = `${x}px`;
  label.style.top = `${y}px`;
  label.style.transform = 'translate(-50%, -50%)';
  label.style.display = projected.z > 1 ? 'none' : 'block';
}

function removePlayerMesh(id) {
  const mesh = playerMeshes.get(id);
  if (!mesh) return;
  const label = mesh.userData.label;
  if (label) label.remove();
  scene.remove(mesh);
  playerMeshes.delete(id);
}

function syncPlayers(players) {
  const nextIds = new Set(players.map((p) => p.id));

  for (const [id, mesh] of playerMeshes) {
    if (!nextIds.has(id)) removePlayerMesh(id);
  }

  for (const player of players) {
    let mesh = playerMeshes.get(player.id);
    if (!mesh) {
      mesh = createPlayerMesh(player);
    }

    mesh.position.set(player.x, 0, player.z);
    mesh.rotation.y = player.yaw || 0;
    mesh.userData.player = player;

    const visibleName = player.id === state.selfId ? 'YOU' : player.name;
    mesh.userData.label.textContent = visibleName;

    if (player.id === state.selfId) {
      state.self = player;
      healthNode.textContent = `HP: ${Math.max(0, player.hp)}`;
      killsNode.textContent = `K: ${player.kills || 0}`;
    }
  }
}

function setMessage(text) {
  messageNode.textContent = text;
}

joinBtn.addEventListener('click', () => {
  const name = nameInput.value.trim() || 'Ranger';
  overlay.classList.add('hidden');
  socket.emit('joinRoom', { room: roomName, name });
  renderer.domElement.requestPointerLock();
});

socket.on('joined', ({ selfId }) => {
  state.selfId = selfId;
  setMessage('Front line engaged.');
});

socket.on('state', (players) => {
  state.players = new Map(players.map((player) => [player.id, player]));
  syncPlayers(players);
});

socket.on('shotResult', ({ hit, targetName, shooterId, targetId, targetHp, damage }) => {
  if (!hit) return;

  if (shooterId === state.selfId) {
    setMessage(`Hit ${targetName || 'enemy'} for ${damage} damage.`);
  }

  const target = state.players.get(targetId);
  if (target && target.id === state.selfId && targetHp <= 0) {
    setMessage('You were eliminated. Respawning...');
  }
});

function handleKeyChange(event, isDown) {
  state.keys[event.code] = isDown;
}

document.addEventListener('keydown', (event) => handleKeyChange(event, true));
document.addEventListener('keyup', (event) => handleKeyChange(event, false));

document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  state.yaw -= event.movementX * 0.0025;
  state.pitch -= event.movementY * 0.0018;
  state.pitch = Math.max(-1.4, Math.min(1.4, state.pitch));
});

renderer.domElement.addEventListener('mousedown', () => {
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
    return;
  }

  if (!state.self) return;

  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  socket.emit('shoot', {
    room: roomName,
    origin: { x: state.self.x, y: 1.7, z: state.self.z },
    direction: { x: direction.x, y: direction.y, z: direction.z }
  });
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function updateCamera() {
  if (!state.self) {
    camera.position.set(0, 1.7, 10);
    camera.rotation.y = 0;
    camera.rotation.x = 0;
    return;
  }

  camera.position.set(state.self.x, 1.7, state.self.z);
  camera.rotation.y = state.yaw;
  camera.rotation.x = state.pitch;
}

function updateMovement(delta) {
  if (!state.self) return;

  const moveForward = new THREE.Vector3();
  const moveRight = new THREE.Vector3();
  const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw);
  const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw);

  if (state.keys.KeyW) moveForward.add(forward);
  if (state.keys.KeyS) moveForward.sub(forward);
  if (state.keys.KeyD) moveRight.add(right);
  if (state.keys.KeyA) moveRight.sub(right);

  const move = moveForward.clone().add(moveRight).normalize();
  const speed = 9.7;

  if (move.lengthSq() > 0) {
    const nextX = state.self.x + move.x * speed * delta;
    const nextZ = state.self.z + move.z * speed * delta;

    if (Math.abs(nextX) < 28 && Math.abs(nextZ) < 28) {
      state.self.x = nextX;
      state.self.z = nextZ;
    }
  }

  if (state.self.id === state.selfId) {
    const now = performance.now();
    if (now - state.lastSent > 40) {
      socket.emit('input', {
        room: roomName,
        x: state.self.x,
        z: state.self.z,
        yaw: state.yaw,
        pitch: state.pitch
      });
      state.lastSent = now;
    }
  }
}

function animate() {
  requestAnimationFrame(animate);
  const delta = 1 / 60;

  updateMovement(delta);
  updateCamera();

  for (const [id, mesh] of playerMeshes) {
    const player = state.players.get(id);
    if (!player) continue;
    mesh.position.set(player.x, 0, player.z);
    mesh.rotation.y = player.yaw || 0;
    updateLabel(mesh, player);
  }

  const ringPos = state.self ? new THREE.Vector3(state.self.x, 0.05, state.self.z) : new THREE.Vector3(0, 0.05, 0);
  glowingRing.position.copy(ringPos);
  glowingRing.rotation.z = performance.now() * 0.001;

  renderer.render(scene, camera);
}

animate();
