/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Target, Play, RotateCcw, Shield, Zap, Skull } from 'lucide-react';

// --- Types ---

interface Vector {
  x: number;
  y: number;
}

interface Entity {
  id: string;
  pos: Vector;
  vel: Vector;
  radius: number;
  color: string;
}

interface Player extends Entity {
  hp: number;
  maxHp: number;
  speed: number;
}

interface Enemy extends Entity {
  hp: number;
  type: 'grunt' | 'sniper' | 'charger';
  lastShot: number;
  shootCooldown: number;
  isSuper?: boolean;
}

interface Bullet extends Entity {
  owner: 'player' | 'enemy';
  damage: number;
  life: number;
}

interface Powerup extends Entity {
  life: number;
}

interface Blast {
  pos: Vector;
  radius: number;
  active: boolean;
}

interface Particle extends Entity {
  life: number;
  maxLife: number;
  opacity: number;
}

// --- Constants ---

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PLAYER_RADIUS = 12;
const ENEMY_RADIUS = 12;
const POWERUP_RADIUS = 10;
const BULLET_RADIUS = 4;
const BULLET_SPEED = 400;
const PLAYER_MAX_SPEED = 200;
const MIN_TIME_SCALE = 0.05;
const MAX_TIME_SCALE = 1.0;
const INITIAL_ENEMY_SPAWN_RATE = 1600; // ms
const PLAYER_SHOOT_COOLDOWN = 500; // ms (real time)
const BLAST_MAX_RADIUS = 400;
const BLAST_SPEED = 600; // pixels per second (scaled by time)

// --- Difficulty Knobs ---
const DIFFICULTY_RATE_SCALE = 500;
const DIFFICULTY_RATE_EXPONENT = 1.3;
const DIFFICULTY_COUNT_SCALE = 700;
const DIFFICULTY_COUNT_EXPONENT = 1.2;
const SUPER_ENEMY_CHANCE = 0.08;
const POWERUP_SPAWN_CHANCE = 0.2;
const SUPER_ENEMY_HP = 2;
const SUPER_ENEMY_COOLDOWN_DIVIDER = 3;

// --- Utils ---

const getDistance = (v1: Vector, v2: Vector) => Math.sqrt((v1.x - v2.x) ** 2 + (v1.y - v2.y) ** 2);
const normalize = (v: Vector) => {
  const mag = Math.sqrt(v.x * v.x + v.y * v.y);
  return mag === 0 ? { x: 0, y: 0 } : { x: v.x / mag, y: v.y / mag };
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'gameover'>('menu');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [powerupCount, setPowerupCount] = useState(0);

  // Game Refs (to avoid React state overhead in loop)
  const playerRef = useRef<Player>({
    id: 'player',
    pos: { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 },
    vel: { x: 0, y: 0 },
    radius: PLAYER_RADIUS,
    color: '#3b82f6', // Blue
    hp: 1,
    maxHp: 1,
    speed: PLAYER_MAX_SPEED,
  });

  const enemiesRef = useRef<Enemy[]>([]);
  const bulletsRef = useRef<Bullet[]>([]);
  const powerupsRef = useRef<Powerup[]>([]);
  const blastRef = useRef<Blast>({ pos: { x: 0, y: 0 }, radius: 0, active: false });
  const particlesRef = useRef<Particle[]>([]);
  const keysRef = useRef<Record<string, boolean>>({});
  const mousePosRef = useRef<Vector>({ x: 0, y: 0 });
  const lastTimeRef = useRef<number>(0);
  const spawnTimerRef = useRef<number>(0);
  const currentTimeScaleRef = useRef<number>(MIN_TIME_SCALE);
  const playerLastShotRef = useRef<number>(0);
  const powerupCountRef = useRef<number>(0);
  const frameIdRef = useRef<number>(0);

  const resetGame = useCallback(() => {
    playerRef.current = {
      id: 'player',
      pos: { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 },
      vel: { x: 0, y: 0 },
      radius: PLAYER_RADIUS,
      color: '#3b82f6',
      hp: 1,
      maxHp: 1,
      speed: PLAYER_MAX_SPEED,
    };
    enemiesRef.current = [];
    bulletsRef.current = [];
    powerupsRef.current = [];
    blastRef.current = { pos: { x: 0, y: 0 }, radius: 0, active: false };
    particlesRef.current = [];
    currentTimeScaleRef.current = MIN_TIME_SCALE;
    playerLastShotRef.current = 0;
    setScore(0);
    setPowerupCount(0);
    powerupCountRef.current = 0;
    setGameState('playing');
    lastTimeRef.current = performance.now();
  }, []);

  const spawnEnemy = useCallback(() => {
    const side = Math.floor(Math.random() * 4);
    let x = 0, y = 0;
    if (side === 0) { x = Math.random() * CANVAS_WIDTH; y = -50; }
    else if (side === 1) { x = CANVAS_WIDTH + 50; y = Math.random() * CANVAS_HEIGHT; }
    else if (side === 2) { x = Math.random() * CANVAS_WIDTH; y = CANVAS_HEIGHT + 50; }
    else { x = -50; y = Math.random() * CANVAS_HEIGHT; }

    const isSuper = Math.random() < SUPER_ENEMY_CHANCE;
    const types: Enemy['type'][] = ['grunt', 'sniper', 'charger'];
    const type = types[Math.floor(Math.random() * types.length)];
    
    let shootCooldown = type === 'sniper' ? 3000 : 1500;
    if (isSuper) shootCooldown /= SUPER_ENEMY_COOLDOWN_DIVIDER;

    enemiesRef.current.push({
      id: Math.random().toString(36),
      pos: { x, y },
      vel: { x: 0, y: 0 },
      radius: ENEMY_RADIUS,
      color: isSuper ? '#a855f7' : '#ef4444', // Purple vs Red
      hp: isSuper ? SUPER_ENEMY_HP : 1,
      type,
      lastShot: 0,
      shootCooldown,
      isSuper,
    });
  }, []);

  const spawnPowerup = useCallback(() => {
    const x = Math.random() * (CANVAS_WIDTH - 100) + 50;
    const y = Math.random() * (CANVAS_HEIGHT - 100) + 50;
    powerupsRef.current.push({
      id: Math.random().toString(36),
      pos: { x, y },
      vel: { x: 0, y: 0 },
      radius: POWERUP_RADIUS,
      color: '#fbbf24', // Amber/Gold
      life: 10,
    });
  }, []);

  const createExplosion = (pos: Vector, color: string, count: number = 8) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 100 + 50;
      particlesRef.current.push({
        id: Math.random().toString(36),
        pos: { ...pos },
        vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        radius: Math.random() * 3 + 1,
        color,
        life: 1,
        maxLife: 1,
        opacity: 1,
      });
    }
  };

  const update = (time: number) => {
    const dt = (time - lastTimeRef.current) / 1000;
    lastTimeRef.current = time;

    if (gameState !== 'playing') return;

    // 1. Calculate Player Movement
    const move = { x: 0, y: 0 };
    if (keysRef.current['w'] || keysRef.current['ArrowUp']) move.y -= 1;
    if (keysRef.current['s'] || keysRef.current['ArrowDown']) move.y += 1;
    if (keysRef.current['a'] || keysRef.current['ArrowLeft']) move.x -= 1;
    if (keysRef.current['d'] || keysRef.current['ArrowRight']) move.x += 1;

    const normMove = normalize(move);
    const player = playerRef.current;
    
    // Instant velocity for target time calculation
    const currentVel = {
      x: normMove.x * player.speed,
      y: normMove.y * player.speed
    };
    
    const speedRatio = Math.sqrt(currentVel.x ** 2 + currentVel.y ** 2) / player.speed;
    const targetTimeScale = MIN_TIME_SCALE + (MAX_TIME_SCALE - MIN_TIME_SCALE) * speedRatio;

    // Analog time scale transition (500ms duration)
    const transitionSpeed = 2.0; // Change per second
    if (currentTimeScaleRef.current < targetTimeScale) {
      currentTimeScaleRef.current = Math.min(targetTimeScale, currentTimeScaleRef.current + dt * transitionSpeed);
    } else if (currentTimeScaleRef.current > targetTimeScale) {
      currentTimeScaleRef.current = Math.max(targetTimeScale, currentTimeScaleRef.current - dt * transitionSpeed);
    }
    const timeScale = currentTimeScaleRef.current;

    player.pos.x += currentVel.x * dt;
    player.pos.y += currentVel.y * dt;

    // Bound player
    player.pos.x = Math.max(player.radius, Math.min(CANVAS_WIDTH - player.radius, player.pos.x));
    player.pos.y = Math.max(player.radius, Math.min(CANVAS_HEIGHT - player.radius, player.pos.y));

    // 2. Update World (Scaled by timeScale)
    const worldDt = dt * timeScale;

    // Handle Blast
    if (blastRef.current.active) {
      blastRef.current.radius += BLAST_SPEED * worldDt;
      if (blastRef.current.radius > BLAST_MAX_RADIUS) {
        blastRef.current.active = false;
        blastRef.current.radius = 0;
      }
    }

    // Spawn Enemies (Increasing difficulty - RAMPED UP)
    const difficultyMultiplier = 1 + Math.pow(score / DIFFICULTY_RATE_SCALE, DIFFICULTY_RATE_EXPONENT);
    const currentSpawnRate = INITIAL_ENEMY_SPAWN_RATE / difficultyMultiplier;
    
    spawnTimerRef.current += dt * timeScale * 1000;
    if (spawnTimerRef.current > currentSpawnRate) {
      const spawnCount = Math.floor(1 + Math.pow(score / DIFFICULTY_COUNT_SCALE, DIFFICULTY_COUNT_EXPONENT));
      for (let i = 0; i < spawnCount; i++) {
        spawnEnemy();
      }
      // Occasionally spawn powerup
      if (Math.random() < POWERUP_SPAWN_CHANCE) spawnPowerup();
      spawnTimerRef.current = 0;
    }

    // Update Enemies
    enemiesRef.current.forEach(enemy => {
      const toPlayer = normalize({ x: player.pos.x - enemy.pos.x, y: player.pos.y - enemy.pos.y });
      let enemySpeed = 80;
      if (enemy.type === 'charger') enemySpeed = 150;
      if (enemy.type === 'sniper') enemySpeed = 40;

      enemy.pos.x += toPlayer.x * enemySpeed * worldDt;
      enemy.pos.y += toPlayer.y * enemySpeed * worldDt;

      // Blast collision
      if (blastRef.current.active) {
        const dist = getDistance(blastRef.current.pos, enemy.pos);
        if (Math.abs(dist - blastRef.current.radius) < 20) {
          enemy.hp = 0;
          createExplosion(enemy.pos, enemy.color);
          setScore(s => s + 100);
        }
      }

      // Shooting
      enemy.lastShot += worldDt * 1000;
      if (enemy.lastShot > enemy.shootCooldown) {
        const bulletVel = normalize({ x: player.pos.x - enemy.pos.x, y: player.pos.y - enemy.pos.y });
        bulletsRef.current.push({
          id: Math.random().toString(36),
          pos: { ...enemy.pos },
          vel: { x: bulletVel.x * BULLET_SPEED, y: bulletVel.y * BULLET_SPEED },
          radius: BULLET_RADIUS,
          color: '#ef4444',
          owner: 'enemy',
          damage: 1,
          life: 5,
        });
        enemy.lastShot = 0;
      }
    });

    // Update Bullets
    bulletsRef.current.forEach(bullet => {
      bullet.pos.x += bullet.vel.x * worldDt;
      bullet.pos.y += bullet.vel.y * worldDt;
      bullet.life -= worldDt;
    });
    bulletsRef.current = bulletsRef.current.filter(b => b.life > 0);

    // Update Powerups
    powerupsRef.current.forEach(p => {
      p.life -= worldDt;
      if (getDistance(p.pos, player.pos) < p.radius + player.radius) {
        p.life = 0;
        const newCount = Math.min(3, powerupCountRef.current + 1);
        powerupCountRef.current = newCount;
        setPowerupCount(newCount);
        createExplosion(p.pos, p.color, 15);
      }
    });
    powerupsRef.current = powerupsRef.current.filter(p => p.life > 0);

    // Update Particles
    particlesRef.current.forEach(p => {
      p.pos.x += p.vel.x * worldDt;
      p.pos.y += p.vel.y * worldDt;
      p.life -= worldDt;
      p.opacity = p.life / p.maxLife;
    });
    particlesRef.current = particlesRef.current.filter(p => p.life > 0);

    // 3. Collisions
    // Bullet vs Enemy
    bulletsRef.current.forEach((bullet) => {
      if (bullet.owner === 'player') {
        enemiesRef.current.forEach((enemy) => {
          if (getDistance(bullet.pos, enemy.pos) < bullet.radius + enemy.radius) {
            enemy.hp -= bullet.damage;
            bullet.life = 0;
            if (enemy.hp <= 0) {
              createExplosion(enemy.pos, enemy.color);
              setScore(s => s + 100);
            }
          }
        });
      } else {
        // Bullet vs Player
        if (getDistance(bullet.pos, player.pos) < bullet.radius + player.radius) {
          player.hp -= bullet.damage;
          bullet.life = 0;
          if (player.hp <= 0) {
            setGameState('gameover');
            createExplosion(player.pos, player.color, 20);
          }
        }
      }
    });

    enemiesRef.current = enemiesRef.current.filter(e => e.hp > 0);

    // Enemy vs Player
    enemiesRef.current.forEach(enemy => {
      if (getDistance(enemy.pos, player.pos) < enemy.radius + player.radius) {
        setGameState('gameover');
        createExplosion(player.pos, player.color, 20);
      }
    });

    // Handle Space Blast
    if (keysRef.current[' '] && powerupCountRef.current >= 3 && !blastRef.current.active) {
      blastRef.current = {
        pos: { ...player.pos },
        radius: 0,
        active: true
      };
      powerupCountRef.current = 0;
      setPowerupCount(0);
    }

    draw(timeScale);
    frameIdRef.current = requestAnimationFrame(update);
  };

  const draw = (timeScale: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.fillStyle = '#f3f4f6'; // Light gray
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw Blast
    if (blastRef.current.active) {
      ctx.save();
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(blastRef.current.pos.x, blastRef.current.pos.y, blastRef.current.radius, 0, Math.PI * 2);
      ctx.stroke();
      
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = '#3b82f6';
      ctx.fill();
      ctx.restore();
    }

    // Draw Particles
    particlesRef.current.forEach(p => {
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    // Draw Powerups
    powerupsRef.current.forEach(p => {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, p.radius + Math.sin(performance.now() / 200) * 2, 0, Math.PI * 2);
      ctx.fill();
      // Glow
      ctx.shadowBlur = 10;
      ctx.shadowColor = p.color;
      ctx.stroke();
      ctx.shadowBlur = 0;
    });

    // Draw Bullets
    bulletsRef.current.forEach(b => {
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.pos.x, b.pos.y, b.radius, 0, Math.PI * 2);
      ctx.fill();
      // Trail
      ctx.strokeStyle = b.color;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.moveTo(b.pos.x, b.pos.y);
      ctx.lineTo(b.pos.x - b.vel.x * 0.05, b.pos.y - b.vel.y * 0.05);
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    });

    // Draw Enemies
    enemiesRef.current.forEach(e => {
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(e.pos.x, e.pos.y, e.radius, 0, Math.PI * 2);
      ctx.fill();
      // Eye/Direction
      const toPlayer = normalize({ x: playerRef.current.pos.x - e.pos.x, y: playerRef.current.pos.y - e.pos.y });
      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.arc(e.pos.x + toPlayer.x * 6, e.pos.y + toPlayer.y * 6, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw Player
    const p = playerRef.current;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.pos.x, p.pos.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Aim line
    const toMouse = normalize({ x: mousePosRef.current.x - p.pos.x, y: mousePosRef.current.y - p.pos.y });
    ctx.strokeStyle = p.color;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(p.pos.x, p.pos.y);
    ctx.lineTo(p.pos.x + toMouse.x * 50, p.pos.y + toMouse.y * 50);
    ctx.stroke();
    ctx.setLineDash([]);

    // Time Scale Indicator
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`TIME: ${(timeScale * 100).toFixed(0)}%`, 20, 30);
  };

  const handleShoot = useCallback(() => {
    if (gameState !== 'playing') return;
    
    const now = performance.now();
    // Double the cooldown when time is at 5% (MIN_TIME_SCALE)
    const currentCooldown = currentTimeScaleRef.current <= MIN_TIME_SCALE ? PLAYER_SHOOT_COOLDOWN * 2 : PLAYER_SHOOT_COOLDOWN;
    
    // Prevent rapid firing, especially in slow-mo
    // The cooldown is in real-time, effectively limiting shots per second regardless of time scale
    if (now - playerLastShotRef.current < currentCooldown) return;

    const p = playerRef.current;
    const toMouse = normalize({ x: mousePosRef.current.x - p.pos.x, y: mousePosRef.current.y - p.pos.y });
    
    bulletsRef.current.push({
      id: Math.random().toString(36),
      pos: { ...p.pos },
      vel: { x: toMouse.x * BULLET_SPEED * 1.5, y: toMouse.y * BULLET_SPEED * 1.5 },
      radius: BULLET_RADIUS,
      color: '#3b82f6',
      owner: 'player',
      damage: 1,
      life: 3,
    });

    playerLastShotRef.current = now;
  }, [gameState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { keysRef.current[e.key.toLowerCase()] = true; };
    const handleKeyUp = (e: KeyboardEvent) => { keysRef.current[e.key.toLowerCase()] = false; };
    const handleMouseMove = (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      mousePosRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    };
    const handleMouseDown = () => handleShoot();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);

    frameIdRef.current = requestAnimationFrame(update);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      cancelAnimationFrame(frameIdRef.current);
    };
  }, [gameState, handleShoot]);

  useEffect(() => {
    if (score > highScore) setHighScore(score);
  }, [score, highScore]);

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center font-sans text-white overflow-hidden p-8">
      <div className="w-full max-w-[800px] flex flex-col gap-6">
        {/* HUD (Outside playable area) */}
        <div className="flex items-center justify-between w-full bg-neutral-900/50 backdrop-blur-md p-4 rounded-xl border border-white/5">
          <div className="flex flex-col">
            <div className="text-[10px] text-neutral-500 uppercase tracking-widest mb-1">High Score: {highScore}</div>
            <div className="flex items-center gap-3">
              <Target className="w-5 h-5 text-red-500" />
              <span className="text-3xl font-black tabular-nums tracking-tighter">{score}</span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  animate={{ 
                    backgroundColor: i < powerupCount ? '#fbbf24' : 'rgba(255,255,255,0.1)',
                    scale: i < powerupCount ? [1, 1.2, 1] : 1,
                    boxShadow: i < powerupCount ? '0 0 15px rgba(251, 191, 36, 0.3)' : 'none'
                  }}
                  className="w-10 h-2.5 rounded-full border border-white/5"
                />
              ))}
            </div>
            {powerupCount >= 3 ? (
              <motion.div 
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ repeat: Infinity, duration: 1 }}
                className="text-[10px] text-amber-400 font-black uppercase tracking-widest"
              >
                Blast Ready [Space]
              </motion.div>
            ) : (
              <div className="text-[10px] text-neutral-600 font-bold uppercase tracking-widest">
                Collect {3 - powerupCount} more
              </div>
            )}
          </div>
        </div>

        <div className="relative">
          {/* Game Canvas */}
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="rounded-lg shadow-2xl border border-neutral-800 bg-white cursor-crosshair"
            id="game-canvas"
          />

          {/* Overlays */}
          <AnimatePresence>
            {gameState === 'menu' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-lg"
              >
                <motion.h1 
                  initial={{ y: -20 }}
                  animate={{ y: 0 }}
                  className="text-6xl font-black italic tracking-tighter mb-2 text-white"
                >
                  CHRONOS TRIGGER
                </motion.h1>
                <p className="text-neutral-400 mb-8 uppercase tracking-[0.3em] text-sm">Time moves when you move</p>
                
                <button
                  onClick={resetGame}
                  className="group relative px-12 py-4 bg-white text-black font-black uppercase tracking-widest rounded-none hover:scale-105 transition-transform"
                >
                  <div className="absolute -inset-1 bg-blue-500 blur opacity-25 group-hover:opacity-50 transition-opacity" />
                  <span className="relative flex items-center gap-2">
                    <Play className="w-5 h-5 fill-current" />
                    Start
                  </span>
                </button>
              </motion.div>
            )}

            {gameState === 'gameover' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-red-950/90 backdrop-blur-md flex flex-col items-center justify-center rounded-lg"
              >
                <Skull className="w-24 h-24 text-red-500 mb-4" />
                <h2 className="text-5xl font-black italic mb-2 text-white">GAME OVER</h2>
                <div className="text-2xl font-bold mb-8 text-red-200">FINAL SCORE: {score}</div>
                
                <button
                  onClick={resetGame}
                  className="flex items-center gap-2 px-8 py-4 bg-white text-black font-black uppercase tracking-widest hover:bg-neutral-200 transition-colors"
                >
                  <RotateCcw className="w-5 h-5" />
                  Restart
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Instructions UI (Outside playable area) */}
        <div className="flex justify-center gap-12 text-neutral-500 py-4">
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-xl border border-white/10 flex items-center justify-center bg-white/5">
              <Zap className="w-5 h-5 text-blue-400" />
            </div>
            <span className="text-[10px] uppercase font-bold tracking-widest">WASD to Move</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-xl border border-white/10 flex items-center justify-center bg-white/5">
              <Target className="w-5 h-5 text-red-400" />
            </div>
            <span className="text-[10px] uppercase font-bold tracking-widest">Click to Shoot</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-xl border border-white/10 flex items-center justify-center bg-white/5">
              <Shield className="w-5 h-5 text-amber-400" />
            </div>
            <span className="text-[10px] uppercase font-bold tracking-widest">Space for Blast</span>
          </div>
        </div>
      </div>
    </div>
  );
}
