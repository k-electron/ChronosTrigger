/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Target, Play, RotateCcw, Shield, Zap, Skull, Maximize2 } from 'lucide-react';

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'gameover'>('menu');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [powerupCount, setPowerupCount] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const canvasSizeRef = useRef({ width: 800, height: 600 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // Game Refs (to avoid React state overhead in loop)
  const playerRef = useRef<Player>({
    id: 'player',
    pos: { x: 800 / 2, y: 600 / 2 },
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
  const activeTouches = useRef<Map<number, { start: Vector, current: Vector, time: number, isJoystick: boolean, hasShot?: boolean }>>(new Map());
  const joystick = useRef<{ active: boolean, id: number | null, start: Vector, current: Vector }>({ active: false, id: null, start: { x: 0, y: 0 }, current: { x: 0, y: 0 } });
  const lastTimeRef = useRef<number>(0);
  const spawnTimerRef = useRef<number>(0);
  const currentTimeScaleRef = useRef<number>(MIN_TIME_SCALE);
  const playerLastShotRef = useRef<number>(0);
  const powerupCountRef = useRef<number>(0);
  const frameIdRef = useRef<number>(0);

  const resetGame = useCallback(() => {
    playerRef.current = {
      id: 'player',
      pos: { x: canvasSizeRef.current.width / 2, y: canvasSizeRef.current.height / 2 },
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
    activeTouches.current.clear();
    joystick.current = { active: false, id: null, start: { x: 0, y: 0 }, current: { x: 0, y: 0 } };
    currentTimeScaleRef.current = MIN_TIME_SCALE;
    playerLastShotRef.current = 0;
    setScore(0);
    setPowerupCount(0);
    powerupCountRef.current = 0;
    setGameState('playing');
    lastTimeRef.current = performance.now();
  }, []);

  useEffect(() => {
    const checkMobile = () => {
      const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
      const isMobileDevice = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
      const isMobileResult = isMobileDevice || (window.innerWidth < 768 && navigator.maxTouchPoints > 0);
      setIsMobile(isMobileResult);
      
      const isIOSDevice = /ipad|iphone|ipod/.test(userAgent.toLowerCase()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      setIsIOS(isIOSDevice);
      
      const portrait = window.innerHeight > window.innerWidth;
      setIsPortrait(portrait);
      
      if (isMobileResult) {
        const newSize = { width: window.innerWidth, height: window.innerHeight };
        setCanvasSize(newSize);
        canvasSizeRef.current = newSize;
      } else {
        const newSize = { width: 800, height: 600 };
        setCanvasSize(newSize);
        canvasSizeRef.current = newSize;
      }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (isIOS) {
      if (isPortrait) {
        setIsPaused(true);
      } else {
        setIsPaused(false);
      }
    }
  }, [isIOS, isPortrait]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs = !!document.fullscreenElement || !!(document as any).webkitFullscreenElement;
      setIsFullscreen(isFs);
      if (isMobile && !isIOS) {
        if (!isFs) {
          setIsPaused(true);
        } else {
          setIsPaused(false);
          if (screen.orientation && (screen.orientation as any).lock) {
            (screen.orientation as any).lock('landscape').catch(console.error);
          }
        }
      }
    };

    const handleVisibilityChange = () => {
      const isFs = !!document.fullscreenElement || !!(document as any).webkitFullscreenElement;
      if (document.hidden) {
        setIsPaused(true);
      } else if (!isMobile || isFs || (isIOS && !isPortrait)) {
        setIsPaused(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isMobile]);

  const requestFullscreen = () => {
    if (containerRef.current) {
      if (containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen().catch(console.error);
      } else if ((containerRef.current as any).webkitRequestFullscreen) {
        (containerRef.current as any).webkitRequestFullscreen();
      }
    }
  };

  const spawnEnemy = useCallback(() => {
    const side = Math.floor(Math.random() * 4);
    let x = 0, y = 0;
    if (side === 0) { x = Math.random() * canvasSizeRef.current.width; y = -50; }
    else if (side === 1) { x = canvasSizeRef.current.width + 50; y = Math.random() * canvasSizeRef.current.height; }
    else if (side === 2) { x = Math.random() * canvasSizeRef.current.width; y = canvasSizeRef.current.height + 50; }
    else { x = -50; y = Math.random() * canvasSizeRef.current.height; }

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
    const x = Math.random() * (canvasSizeRef.current.width - 100) + 50;
    const y = Math.random() * (canvasSizeRef.current.height - 100) + 50;
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

    if (gameState !== 'playing' || isPausedRef.current) {
      frameIdRef.current = requestAnimationFrame(update);
      return;
    }

    // 1. Calculate Player Movement
    const move = { x: 0, y: 0 };
    if (keysRef.current['w'] || keysRef.current['ArrowUp']) move.y -= 1;
    if (keysRef.current['s'] || keysRef.current['ArrowDown']) move.y += 1;
    if (keysRef.current['a'] || keysRef.current['ArrowLeft']) move.x -= 1;
    if (keysRef.current['d'] || keysRef.current['ArrowRight']) move.x += 1;

    if (joystick.current.active) {
      const dx = joystick.current.current.x - joystick.current.start.x;
      const dy = joystick.current.current.y - joystick.current.start.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxDist = 50;
      const normalizedDist = Math.min(dist, maxDist) / maxDist;
      
      if (dist > 0) {
        move.x += (dx / dist) * normalizedDist;
        move.y += (dy / dist) * normalizedDist;
      }
    }

    let normMove = { x: 0, y: 0 };
    if (move.x !== 0 || move.y !== 0) {
       const mag = Math.sqrt(move.x * move.x + move.y * move.y);
       if (mag > 1) {
         normMove = { x: move.x / mag, y: move.y / mag };
       } else {
         normMove = { x: move.x, y: move.y };
       }
    }

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
    player.pos.x = Math.max(player.radius, Math.min(canvasSizeRef.current.width - player.radius, player.pos.x));
    player.pos.y = Math.max(player.radius, Math.min(canvasSizeRef.current.height - player.radius, player.pos.y));

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
      handleBlast();
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
    ctx.fillRect(0, 0, canvasSizeRef.current.width, canvasSizeRef.current.height);

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

    // Draw Joystick
    if (joystick.current.active) {
      ctx.save();
      
      // Base circle
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(joystick.current.start.x, joystick.current.start.y, 50, 0, Math.PI * 2);
      ctx.fill();
      
      // Base border
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(joystick.current.start.x, joystick.current.start.y, 50, 0, Math.PI * 2);
      ctx.stroke();
      
      // Thumb
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      const dx = joystick.current.current.x - joystick.current.start.x;
      const dy = joystick.current.current.y - joystick.current.start.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxDist = 50;
      const thumbX = joystick.current.start.x + (dist > 0 ? (dx / dist) * Math.min(dist, maxDist) : 0);
      const thumbY = joystick.current.start.y + (dist > 0 ? (dy / dist) * Math.min(dist, maxDist) : 0);
      
      ctx.arc(thumbX, thumbY, 20, 0, Math.PI * 2);
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

  const handleShoot = useCallback((targetPos?: Vector) => {
    if (gameState !== 'playing') return;
    
    const now = performance.now();
    // Double the cooldown when time is at 5% (MIN_TIME_SCALE)
    const currentCooldown = currentTimeScaleRef.current <= MIN_TIME_SCALE ? PLAYER_SHOOT_COOLDOWN * 2 : PLAYER_SHOOT_COOLDOWN;
    
    // Prevent rapid firing, especially in slow-mo
    // The cooldown is in real-time, effectively limiting shots per second regardless of time scale
    if (now - playerLastShotRef.current < currentCooldown) return;

    const p = playerRef.current;
    const target = targetPos || mousePosRef.current;
    let toMouse = normalize({ x: target.x - p.pos.x, y: target.y - p.pos.y });
    if (toMouse.x === 0 && toMouse.y === 0) toMouse = { x: 1, y: 0 };
    
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

  const handleBlast = useCallback(() => {
    if (powerupCountRef.current >= 3 && !blastRef.current.active) {
      blastRef.current = {
        pos: { ...playerRef.current.pos },
        radius: 0,
        active: true
      };
      powerupCountRef.current = 0;
      setPowerupCount(0);
    }
  }, []);

  const getCanvasPos = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    // Handle object-fit: contain scaling
    const canvasAspect = canvas.width / canvas.height;
    const rectAspect = rect.width / rect.height;
    
    let renderedWidth = rect.width;
    let renderedHeight = rect.height;
    let offsetX = 0;
    let offsetY = 0;
    
    if (canvasAspect > rectAspect) {
      renderedHeight = rect.width / canvasAspect;
      offsetY = (rect.height - renderedHeight) / 2;
    } else {
      renderedWidth = rect.height * canvasAspect;
      offsetX = (rect.width - renderedWidth) / 2;
    }
    
    const scaleX = canvas.width / renderedWidth;
    const scaleY = canvas.height / renderedHeight;
    
    return {
      x: (clientX - rect.left - offsetX) * scaleX,
      y: (clientY - rect.top - offsetY) * scaleY
    };
  };

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (gameState !== 'playing') return;
    e.preventDefault();
    
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const pos = getCanvasPos(touch.clientX, touch.clientY);
      
      const isShootTap = joystick.current.active;
      
      activeTouches.current.set(touch.identifier, { 
        start: pos, 
        current: pos, 
        time: Date.now(), 
        isJoystick: false,
        hasShot: isShootTap
      });
      
      if (isShootTap) {
        handleShoot(pos);
      }
    }
  }, [gameState, handleShoot]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (gameState !== 'playing') return;
    e.preventDefault();
    
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const pos = getCanvasPos(touch.clientX, touch.clientY);
      const touchData = activeTouches.current.get(touch.identifier);
      
      if (touchData) {
        touchData.current = pos;
        
        if (joystick.current.active && joystick.current.id === touch.identifier) {
          joystick.current.current = pos;
        } else if (!joystick.current.active && !touchData.hasShot) {
          const dist = getDistance(touchData.start, pos);
          if (dist > 15) { // Increased threshold for sloppy taps
            joystick.current = { active: true, id: touch.identifier, start: touchData.start, current: pos };
            touchData.isJoystick = true;
          }
        }
      }
    }
  }, [gameState]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (gameState !== 'playing') return;
    e.preventDefault();
    
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const touchData = activeTouches.current.get(touch.identifier);
      
      if (touchData) {
        if (joystick.current.id === touch.identifier) {
          joystick.current.active = false;
          joystick.current.id = null;
        } else if (!touchData.isJoystick && !touchData.hasShot) {
          const dist = getDistance(touchData.start, touchData.current);
          const time = Date.now() - touchData.time;
          // Shoot if it was a quick tap without much movement
          if (dist < 20 && time < 500) {
             const pos = getCanvasPos(touch.clientX, touch.clientY);
             handleShoot(pos);
          }
        }
        activeTouches.current.delete(touch.identifier);
      }
    }
  }, [gameState, handleShoot]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { keysRef.current[e.key.toLowerCase()] = true; };
    const handleKeyUp = (e: KeyboardEvent) => { keysRef.current[e.key.toLowerCase()] = false; };
    const handleMouseMove = (e: MouseEvent) => {
      mousePosRef.current = getCanvasPos(e.clientX, e.clientY);
    };
    const handleMouseDown = () => handleShoot();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
      canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
      canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
      canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    }

    frameIdRef.current = requestAnimationFrame(update);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      if (canvas) {
        canvas.removeEventListener('touchstart', handleTouchStart);
        canvas.removeEventListener('touchmove', handleTouchMove);
        canvas.removeEventListener('touchend', handleTouchEnd);
        canvas.removeEventListener('touchcancel', handleTouchEnd);
      }
      cancelAnimationFrame(frameIdRef.current);
    };
  }, [gameState, handleShoot, handleTouchStart, handleTouchMove, handleTouchEnd]);

  useEffect(() => {
    if (score > highScore) setHighScore(score);
  }, [score, highScore]);

  return (
    <div className="fixed inset-0 bg-neutral-950 flex flex-col items-center justify-center font-sans text-white overflow-hidden">
      <div 
        ref={containerRef}
        className={isFullscreen || isMobile ? "w-full h-full bg-black flex items-center justify-center relative" : "w-full max-w-[800px] relative flex flex-col gap-6 p-8"}
      >
        {/* HUD */}
        <div className={`w-full ${isMobile ? 'absolute top-0 left-0 p-4 z-10 bg-transparent border-none flex flex-col items-start gap-2 pointer-events-none' : 'bg-neutral-900/50 p-4 rounded-xl border border-white/5 flex items-center justify-between'}`}>
          <div className="flex flex-col">
            <div className={`text-[10px] ${isMobile ? 'text-white/70' : 'text-neutral-500'} uppercase tracking-widest mb-1`}>High Score: {highScore}</div>
            <div className="flex items-center gap-3">
              <Target className="w-5 h-5 text-red-500" />
              <span className={`text-3xl font-black tabular-nums tracking-tighter ${isMobile ? 'text-white/90 drop-shadow-md' : ''}`}>{score}</span>
            </div>
          </div>

          <div className={`flex ${isMobile ? 'flex-row items-center' : 'flex-col items-end'} gap-2`}>
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
                className={`text-[10px] text-amber-400 font-black uppercase tracking-widest ${isMobile ? 'drop-shadow-md' : ''}`}
              >
                Blast Ready {isMobile ? '' : '[Space]'}
              </motion.div>
            ) : (
              <div className={`text-[10px] ${isMobile ? 'text-white/70 drop-shadow-md' : 'text-neutral-600'} font-bold uppercase tracking-widest`}>
                Collect {3 - powerupCount} more
              </div>
            )}
          </div>
        </div>

        <div className="relative w-full h-full flex items-center justify-center">
          {/* Game Canvas */}
          <canvas
            ref={canvasRef}
            width={canvasSize.width}
            height={canvasSize.height}
            className={`shadow-2xl bg-white cursor-crosshair ${isFullscreen || isMobile ? 'max-w-full max-h-full object-contain' : 'w-full rounded-lg border border-neutral-800'}`}
            id="game-canvas"
          />

          {/* Mobile Blast Button */}
          {isMobile && gameState === 'playing' && (
            <button 
              className="absolute bottom-8 right-8 w-16 h-16 rounded-full bg-amber-500/80 border-2 border-amber-300 text-white flex items-center justify-center shadow-lg active:scale-95 transition-transform z-50 pointer-events-auto"
              style={{ opacity: powerupCount >= 3 ? 1 : 0.5 }}
              onClick={(e) => {
                e.stopPropagation();
                handleBlast();
              }}
              onTouchStart={(e) => {
                e.stopPropagation();
                handleBlast();
              }}
            >
              <Shield className="w-8 h-8" />
            </button>
          )}

          {/* Overlays */}
          <AnimatePresence>
            {gameState === 'menu' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-lg z-40"
              >
                <motion.h1 
                  initial={{ y: -20 }}
                  animate={{ y: 0 }}
                  className="text-6xl font-black italic tracking-tighter mb-2 text-white text-center"
                >
                  CHRONOS TRIGGER
                </motion.h1>
                <p className="text-neutral-400 mb-8 uppercase tracking-[0.3em] text-sm text-center">Time moves when you move</p>
                
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
                className="absolute inset-0 bg-red-950/90 backdrop-blur-md flex flex-col items-center justify-center rounded-lg z-40"
              >
                <Skull className="w-24 h-24 text-red-500 mb-4" />
                <h2 className="text-5xl font-black italic mb-2 text-white text-center">GAME OVER</h2>
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

            {isMobile && !isFullscreen && !isIOS && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/90 z-50 flex flex-col items-center justify-center p-8 text-center rounded-lg"
              >
                <Maximize2 className="w-16 h-16 text-white mb-6 opacity-50" />
                <h2 className="text-2xl font-bold text-white mb-8">Rotate to Landscape & Play Fullscreen</h2>
                <button 
                  onClick={requestFullscreen}
                  className="px-8 py-4 bg-blue-600 text-white font-black uppercase tracking-widest rounded-lg shadow-lg shadow-blue-500/20 active:scale-95 transition-transform"
                >
                  Play Fullscreen
                </button>
              </motion.div>
            )}

            {isIOS && isPortrait && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/90 z-50 flex flex-col items-center justify-center p-8 text-center rounded-lg"
              >
                <RotateCcw className="w-16 h-16 text-white mb-6 opacity-50" />
                <h2 className="text-2xl font-bold text-white mb-8">Please rotate your device to landscape to play</h2>
              </motion.div>
            )}

            {isPaused && (!isMobile || isFullscreen) && gameState === 'playing' && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/50 z-40 flex items-center justify-center rounded-lg backdrop-blur-sm"
              >
                <h2 className="text-4xl font-black text-white tracking-widest">PAUSED</h2>
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
