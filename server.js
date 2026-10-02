import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server);

const port = process.env.PORT || 3000;
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));

const randomBetween = (min, max) => Math.random() * (max - min) + min;

function getRoom(roomName) {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, new Map());
  }
  return rooms.get(roomName);
}

function serializeRoom(roomName) {
  const room = getRoom(roomName);
  return Array.from(room.values()).map((player) => ({
    id: player.id,
    name: player.name,
    x: player.x,
    z: player.z,
    y: player.y,
    yaw: player.yaw,
    pitch: player.pitch,
    hp: player.hp,
    kills: player.kills,
    deaths: player.deaths,
    team: player.team,
    isAlive: player.isAlive
  }));
}

function createPlayer(id, name) {
  const team = Math.random() > 0.5 ? 'Allies' : 'Axis';
  return {
    id,
    name: name || 'Soldier',
    x: randomBetween(-18, 18),
    z: randomBetween(-18, 18),
    y: 1.7,
    yaw: 0,
    pitch: 0,
    hp: 100,
    kills: 0,
    deaths: 0,
    team,
    isAlive: true
  };
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ room = 'arena', name = 'Soldier' } = {}) => {
    const roomPlayers = getRoom(room);
    if (!roomPlayers.has(socket.id)) {
      roomPlayers.set(socket.id, createPlayer(socket.id, name));
    }

    socket.join(room);
    socket.data.room = room;

    socket.emit('joined', {
      room,
      selfId: socket.id
    });

    io.to(room).emit('state', serializeRoom(room));
  });

  socket.on('input', ({ room = 'arena', x, z, yaw = 0, pitch = 0 } = {}) => {
    const roomPlayers = getRoom(room);
    const player = roomPlayers.get(socket.id);
    if (!player) return;

    player.x = Number.isFinite(x) ? x : player.x;
    player.z = Number.isFinite(z) ? z : player.z;
    player.yaw = Number.isFinite(yaw) ? yaw : player.yaw;
    player.pitch = Number.isFinite(pitch) ? pitch : player.pitch;

    io.to(room).emit('state', serializeRoom(room));
  });

  socket.on('shoot', ({ room = 'arena', origin, direction } = {}) => {
    const roomPlayers = getRoom(room);
    const shooter = roomPlayers.get(socket.id);
    if (!shooter || !shooter.isAlive) return;

    if (!origin || !direction) return;

    let bestTarget = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const [id, target] of roomPlayers) {
      if (id === socket.id || !target.isAlive) continue;

      const dx = target.x - origin.x;
      const dy = target.y - origin.y;
      const dz = target.z - origin.z;
      const dist = Math.hypot(dx, dy, dz);

      if (dist > 24) continue;

      const normDir = Math.hypot(direction.x, direction.y, direction.z) || 1;
      const nx = direction.x / normDir;
      const ny = direction.y / normDir;
      const nz = direction.z / normDir;

      const ux = dx / dist;
      const uy = dy / dist;
      const uz = dz / dist;

      const dot = nx * ux + ny * uy + nz * uz;
      if (dot > 0.9 && dist < bestDistance) {
        bestDistance = dist;
        bestTarget = target;
      }
    }

    if (!bestTarget) {
      socket.emit('shotResult', { hit: false, shooterId: socket.id });
      return;
    }

    const damage = 35;
    bestTarget.hp -= damage;

    if (bestTarget.hp <= 0) {
      shooter.kills = (shooter.kills || 0) + 1;
      bestTarget.deaths = (bestTarget.deaths || 0) + 1;
      bestTarget.hp = 100;
      bestTarget.x = randomBetween(-18, 18);
      bestTarget.z = randomBetween(-18, 18);
      bestTarget.isAlive = true;
      bestTarget.yaw = 0;
      bestTarget.pitch = 0;
    }

    io.to(room).emit('shotResult', {
      hit: true,
      shooterId: socket.id,
      targetId: bestTarget.id,
      damage,
      targetHp: bestTarget.hp,
      targetName: bestTarget.name,
      room
    });

    io.to(room).emit('state', serializeRoom(room));
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    if (!room) return;

    const roomPlayers = getRoom(room);
    if (roomPlayers.has(socket.id)) {
      roomPlayers.delete(socket.id);
      io.to(room).emit('state', serializeRoom(room));
    }
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', players: Array.from(rooms.values()).reduce((total, room) => total + room.size, 0) });
});

server.listen(port, () => {
  console.log(`WW2 shooter server is running on http://localhost:${port}`);
});
