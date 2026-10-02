import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const port = process.env.PORT || 3000;

const ROOM_NAME = 'de_dust';
const ROUND_LENGTH = 95;
const BUY_TIME = 15;
const weaponStats = {
  usp: { label: 'USP', damage: 25, cooldown: 240, range: 28, spread: 0.1, price: 200 },
  deagle: { label: 'Deagle', damage: 55, cooldown: 500, range: 32, spread: 0.14, price: 700 },
  rifle: { label: 'AK-47', damage: 30, cooldown: 120, range: 36, spread: 0.18, price: 2700 }
};

const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function getRoom(roomName = ROOM_NAME) {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, {
      players: new Map(),
      round: 1,
      phase: 'buy',
      timer: BUY_TIME,
      scores: { Counter: 0, Terror: 0 },
      active: true
    });
  }
  return rooms.get(roomName);
}

function getSpawnPosition(team, index = 0) {
  if (team === 'Counter') {
    return { x: -16 + (index % 3) * 4, z: -22 + Math.floor(index / 3) * 4 };
  }
  return { x: 16 - (index % 3) * 4, z: 22 - Math.floor(index / 3) * 4 };
}

function createPlayer(id, name = 'Player', team = 'Counter') {
  const spawn = getSpawnPosition(team, 0);
  return {
    id,
    name,
    team,
    x: spawn.x,
    z: spawn.z,
    yaw: 0,
    pitch: 0,
    hp: 100,
    armor: 0,
    money: 800,
    kills: 0,
    deaths: 0,
    weapon: 'usp',
    ammo: 12,
    reserveAmmo: 24,
    isAlive: true,
    aliveSince: Date.now(),
    lastShotAt: 0,
    roundJoined: 1
  };
}

function resetPlayerForRound(player, room) {
  const teamPlayers = Array.from(room.players.values()).filter((entry) => entry.team === player.team);
  const spawnIndex = teamPlayers.filter((entry) => entry.id !== player.id).length;
  const spawn = getSpawnPosition(player.team, spawnIndex);
  player.x = spawn.x;
  player.z = spawn.z;
  player.hp = 100;
  player.armor = 0;
  player.isAlive = true;
  player.weapon = 'usp';
  player.ammo = 12;
  player.reserveAmmo = 24;
  player.lastShotAt = 0;
  player.aliveSince = Date.now();
}

function roomState(room) {
  return {
    round: room.round,
    phase: room.phase,
    timer: room.timer,
    scores: room.scores,
    players: Array.from(room.players.values()).map((player) => ({
      id: player.id,
      name: player.name,
      team: player.team,
      x: player.x,
      z: player.z,
      yaw: player.yaw,
      pitch: player.pitch,
      hp: player.hp,
      armor: player.armor,
      money: player.money,
      kills: player.kills,
      deaths: player.deaths,
      weapon: player.weapon,
      ammo: player.ammo,
      reserveAmmo: player.reserveAmmo,
      isAlive: player.isAlive,
      lastShotAt: player.lastShotAt
    }))
  };
}

function syncRoom(roomName) {
  const room = getRoom(roomName);
  io.to(roomName).emit('gameState', roomState(room));
}

function endRound(roomName, winner) {
  const room = getRoom(roomName);
  room.phase = 'ended';
  room.timer = 4;
  room.scores[winner] += 1;

  for (const player of room.players.values()) {
    player.isAlive = false;
    if (player.team === winner) {
      player.money += 300;
    }
  }

  syncRoom(roomName);

  setTimeout(() => {
    const roundRoom = getRoom(roomName);
    roundRoom.round += 1;
    roundRoom.phase = 'buy';
    roundRoom.timer = BUY_TIME;

    for (const player of roundRoom.players.values()) {
      resetPlayerForRound(player, roundRoom);
      player.money = clamp(player.money + 800, 0, 10000);
      player.deaths = player.deaths || 0;
      player.kills = player.kills || 0;
    }

    syncRoom(roomName);
  }, 4000);
}

function tickRoom(roomName) {
  const room = getRoom(roomName);
  if (!room || !room.active) return;

  if (room.phase === 'buy') {
    room.timer -= 1;
    if (room.timer <= 0) {
      room.phase = 'live';
      room.timer = ROUND_LENGTH;
      for (const player of room.players.values()) {
        player.isAlive = true;
        if (player.hp <= 0) {
          resetPlayerForRound(player, room);
        }
      }
      syncRoom(roomName);
    }
  } else if (room.phase === 'live') {
    room.timer -= 1;
    if (room.timer <= 0) {
      const counterAlive = Array.from(room.players.values()).filter((player) => player.team === 'Counter' && player.isAlive).length;
      const terrorAlive = Array.from(room.players.values()).filter((player) => player.team === 'Terror' && player.isAlive).length;
      const winner = counterAlive === terrorAlive ? null : counterAlive > terrorAlive ? 'Counter' : 'Terror';
      if (winner) endRound(roomName, winner);
      else endRound(roomName, 'Counter');
      return;
    }

    const counterAlive = Array.from(room.players.values()).filter((player) => player.team === 'Counter' && player.isAlive).length;
    const terrorAlive = Array.from(room.players.values()).filter((player) => player.team === 'Terror' && player.isAlive).length;

    if (counterAlive === 0 || terrorAlive === 0) {
      const winner = counterAlive > 0 ? 'Counter' : 'Terror';
      endRound(roomName, winner);
      return;
    }
  }

  syncRoom(roomName);
}

setInterval(() => {
  for (const roomName of rooms.keys()) {
    tickRoom(roomName);
  }
}, 1000);

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ room = ROOM_NAME, name = 'Player', team = 'Counter' } = {}) => {
    const roomData = getRoom(room);
    let player = roomData.players.get(socket.id);

    if (!player) {
      player = createPlayer(socket.id, name, team);
      roomData.players.set(socket.id, player);
    } else {
      player.name = name;
      player.team = team;
    }

    socket.join(room);
    socket.data.room = room;

    if (roomData.phase === 'buy' && player.hp <= 0) {
      resetPlayerForRound(player, roomData);
    }

    syncRoom(room);
  });

  socket.on('chooseTeam', ({ room = ROOM_NAME, team } = {}) => {
    const roomData = getRoom(room);
    const player = roomData.players.get(socket.id);
    if (!player) return;

    player.team = team === 'Terror' ? 'Terror' : 'Counter';
    resetPlayerForRound(player, roomData);
    syncRoom(room);
  });

  socket.on('buy', ({ room = ROOM_NAME, item } = {}) => {
    const roomData = getRoom(room);
    const player = roomData.players.get(socket.id);
    if (!player || roomData.phase !== 'buy') return;

    const stats = weaponStats[item];
    if (!stats) return;

    if (player.money < stats.price) {
      socket.emit('toast', { text: 'Not enough money.' });
      return;
    }

    player.money -= stats.price;
    player.weapon = item;
    player.ammo = item === 'rifle' ? 30 : item === 'deagle' ? 7 : 12;
    player.reserveAmmo = item === 'rifle' ? 90 : item === 'deagle' ? 35 : 24;

    if (item === 'armor') {
      player.armor = 100;
      player.money += 0;
    }

    socket.emit('toast', { text: `${stats.label} purchased.` });
    syncRoom(room);
  });

  socket.on('input', ({ room = ROOM_NAME, x, z, yaw, pitch } = {}) => {
    const roomData = getRoom(room);
    const player = roomData.players.get(socket.id);
    if (!player) return;

    if (Number.isFinite(x)) player.x = x;
    if (Number.isFinite(z)) player.z = z;
    if (Number.isFinite(yaw)) player.yaw = yaw;
    if (Number.isFinite(pitch)) player.pitch = pitch;

    syncRoom(room);
  });

  socket.on('shoot', ({ room = ROOM_NAME, origin, direction } = {}) => {
    const roomData = getRoom(room);
    const shooter = roomData.players.get(socket.id);
    if (!shooter || !shooter.isAlive || roomData.phase !== 'live') return;
    if (!origin || !direction) return;

    const stats = weaponStats[shooter.weapon] || weaponStats.usp;
    const now = Date.now();
    if (now - shooter.lastShotAt < stats.cooldown) return;
    if (shooter.ammo <= 0) {
      socket.emit('toast', { text: 'Reloading...' });
      shooter.ammo = stats.ammo || 12;
      shooter.reserveAmmo = shooter.reserveAmmo || 24;
      return;
    }

    shooter.lastShotAt = now;
    shooter.ammo -= 1;

    let bestTarget = null;
    let bestScore = -Infinity;

    for (const target of roomData.players.values()) {
      if (target.id === socket.id || target.team === shooter.team || !target.isAlive) continue;

      const dx = target.x - origin.x;
      const dz = target.z - origin.z;
      const dist = Math.hypot(dx, dz);
      if (dist > stats.range) continue;

      const dirLen = Math.hypot(direction.x, direction.y, direction.z) || 1;
      const ndx = direction.x / dirLen;
      const ndy = direction.y / dirLen;
      const ndz = direction.z / dirLen;

      const ux = dx / dist;
      const uz = dz / dist;
      const dot = ndx * ux + ndz * uz + ndy * (0 / dist);
      const aimScore = dot + (1 - dist / stats.range) * 0.5;

      if (dot > 0.88 && aimScore > bestScore) {
        bestScore = aimScore;
        bestTarget = target;
      }
    }

    if (!bestTarget) {
      io.to(room).emit('shotResult', { shooterId: socket.id, hit: false, room });
      return;
    }

    let damage = stats.damage;
    const armorAbsorb = Math.min(bestTarget.armor, damage * 0.5);
    bestTarget.armor -= armorAbsorb;
    bestTarget.hp -= damage - armorAbsorb;

    if (bestTarget.hp <= 0) {
      shooter.kills = (shooter.kills || 0) + 1;
      shooter.money += 300;
      bestTarget.deaths = (bestTarget.deaths || 0) + 1;
      bestTarget.isAlive = false;
      bestTarget.hp = 0;
      bestTarget.armor = 0;
      setTimeout(() => {
        const roundRoom = getRoom(room);
        const targetPlayer = roundRoom.players.get(bestTarget.id);
        if (targetPlayer) {
          const teamPlayers = Array.from(roundRoom.players.values()).filter((entry) => entry.team === targetPlayer.team);
          const spawnIndex = teamPlayers.length;
          const spawn = getSpawnPosition(targetPlayer.team, spawnIndex);
          targetPlayer.x = spawn.x;
          targetPlayer.z = spawn.z;
          targetPlayer.hp = 100;
          targetPlayer.armor = 0;
          targetPlayer.isAlive = true;
          targetPlayer.weapon = 'usp';
          targetPlayer.ammo = 12;
          targetPlayer.reserveAmmo = 24;
        }
        syncRoom(room);
      }, 1500);
    }

    io.to(room).emit('shotResult', {
      shooterId: socket.id,
      targetId: bestTarget.id,
      hit: true,
      room,
      damage: Math.round(damage),
      hp: Math.max(0, bestTarget.hp),
      armor: Math.max(0, bestTarget.armor)
    });

    syncRoom(room);
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    if (!room) return;
    const roomData = getRoom(room);
    roomData.players.delete(socket.id);
    syncRoom(room);
  });
});

app.get('/health', (_req, res) => {
  let totalPlayers = 0;
  for (const room of rooms.values()) {
    totalPlayers += room.players.size;
  }
  res.json({ status: 'ok', rooms: rooms.size, players: totalPlayers });
});

server.listen(port, () => {
  console.log(`Counter-style shooter prototype running on http://localhost:${port}`);
});
