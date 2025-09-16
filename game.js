const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;

// preload leaf image (prefer the final leaf image if available)
const leafImg = new Image();
leafImg.src = 'Assets/final leaf.png';
leafImg.onerror = () => {
  // try webp then jpg fallbacks
  if (leafImg.src.indexOf('final leaf.png') !== -1) leafImg.src = 'Assets/leaf.webp';
  else if (leafImg.src.indexOf('leaf.webp') !== -1) leafImg.src = 'Assets/leaff.jpg';
};

// background is handled by CSS (outside the canvas)

let leaves = [];
// make the basket larger for better visuals; collision box remains centered
let basket = {
  x: WIDTH / 2 - 70,
  y: HEIGHT - 80,
  w: 140,
  h: 34,
  // animation / state
  fullness: 0,
  capacity: 8,
  open: 0, // animated open amount (0..1)
  openTarget: 0,
  handleBounce: 0, // vertical control offset for handle bounce
  handleTilt: 0, // left/right tilt amount for handle
  fullAnimTimer: 0 // frames remaining for 'full' animation
};
let score = 0;
let lives = 3;
let running = false;
// load highscore from localStorage
let highscore = 0;
try {
  const stored = localStorage.getItem('leaf_highscore');
  if (stored) highscore = parseInt(stored, 10) || 0;
} catch (e) {
  // ignore
}
// sound preference
let soundEnabled = true;
try { const s = localStorage.getItem('leaf_sound'); if (s !== null) soundEnabled = s === '1'; } catch (e) {}

// simple confetti particle pool
const confetti = [];
function spawnConfetti(x, y, count = 40) {
  for (let i = 0; i < count; i++) {
    confetti.push({
      x: x + (Math.random() - 0.5) * 40,
      y: y + (Math.random() - 0.5) * 20,
      vx: (Math.random() - 0.5) * 4,
      vy: -2 - Math.random() * 3,
      size: 4 + Math.random() * 6,
      life: 60 + Math.random() * 60,
      color: ['#f59e0b','#ef4444','#f97316','#ffd166'][Math.floor(Math.random()*4)]
    });
  }
}

function updateConfetti() {
  for (let i = confetti.length - 1; i >= 0; i--) {
    const p = confetti[i];
    p.vy += 0.15; // gravity
    p.x += p.vx;
    p.y += p.vy;
    p.life--;
    if (p.life <= 0 || p.y > HEIGHT + 50) confetti.splice(i, 1);
  }
}

function drawConfetti() {
  confetti.forEach(p => {
    ctx.save();
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.size, p.size * 0.6, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  });
}

// setup a tiny beep using Web Audio API
let audioCtx = null;
function playBeep() {
  if (!soundEnabled) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.26);
    o.stop(audioCtx.currentTime + 0.27);
  } catch (e) { /* ignore */ }
}

// two-tone pleasant catch sound
function playCatchSound() {
  if (!soundEnabled) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    const g = audioCtx.createGain();
    g.connect(audioCtx.destination);

    const o1 = audioCtx.createOscillator();
    o1.type = 'triangle';
    o1.frequency.value = 620;
    o1.connect(g);

    const o2 = audioCtx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = 820;
    o2.connect(g);

    // gentle envelope
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.12, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

    o1.start(now);
    o2.start(now + 0.02);
    o1.stop(now + 0.16);
    o2.stop(now + 0.16);
  } catch (e) { /* ignore */ }
}

// low soft thud for misses
function playMissSound() {
  if (!soundEnabled) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = 120;
    o.connect(g);
    g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.14, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    o.start(now);
    o.stop(now + 0.2);
  } catch (e) { /* ignore */ }
}

function Leaf() {
  this.r = Math.random() * 10 + 10;
  this.x = Math.random() * (WIDTH - this.r * 2);
  this.y = -this.r;
  this.color = ["#f59e0b", "#ef4444", "#10b981", "#f97316", "#eab308"][Math.floor(Math.random() * 5)];
  this.vy = 2 + Math.random() * 1.5;
  this.vx = (Math.random() - 0.5) * 1;
  this.t = 0;
  this.rot = (Math.random() - 0.5) * 0.1;

  this.update = function () {
    this.t++;
    this.x += this.vx + Math.sin(this.t / 10) * 0.5;
    this.rot += Math.sin(this.t / 20) * 0.002; // gentle rotation change over time
    this.y += this.vy;
  };

  this.draw = function () {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    // draw an orange leaf using a cached offscreen canvas for consistent color
    const size = Math.max(24, Math.round(this.r * 2));
    const cached = getCachedLeaf(size);
    ctx.drawImage(cached, -size / 2, -size / 2, size, size);
    ctx.restore();
  };
}

// cache for tinted leaf canvases keyed by size
const leafCache = {};
function getCachedLeaf(size) {
  if (leafCache[size]) return leafCache[size];

  const off = document.createElement('canvas');
  off.width = size;
  off.height = size;
  const ox = off.getContext('2d');

  // draw the emoji in black at center
  const fontSize = Math.round(size * 0.9);
  ox.font = `${fontSize}px serif`;
  ox.textAlign = 'center';
  ox.textBaseline = 'middle';
  ox.fillStyle = '#000';
  ox.fillText('🍁', size / 2, size / 2);

  // tint the non-transparent pixels to orange using source-in
  ox.globalCompositeOperation = 'source-in';
  ox.fillStyle = '#f59e0b'; // orange tint
  ox.fillRect(0, 0, size, size);

  leafCache[size] = off;
  return off;
}

function drawBasket() {
  const x = basket.x;
  const y = basket.y;
  const w = basket.w;
  const h = basket.h;

  // animate open and handleBounce
  basket.open += (basket.openTarget - basket.open) * 0.1;
  basket.handleBounce *= 0.85; // decay bounce
  ctx.save();
  // subtle shadow under the basket
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h + 6, w / 2, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // basket body (rounded rectangle)
  ctx.fillStyle = '#6b3f1a'; // slightly darker warm brown
  const r = Math.min(12, Math.round(h / 3));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();

  // rim / top band
  const rimH = Math.max(6, Math.round(h * 0.28));
  ctx.fillStyle = '#553015';
  ctx.fillRect(x, y, w, rimH);

  // handle: an arched metal/wood handle above the basket that bounces on catch
  const handleBaseY = y - Math.round(h * 0.6);
  const handleY = handleBaseY - basket.handleBounce;
  const openOffset = basket.open * 8; // slight visual opening
  // decay the handle tilt toward 0
  basket.handleTilt *= 0.92;
  const tiltRad = (basket.handleTilt * Math.PI) / 180;
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#4a2e1a';
  // draw tilted handle by rotating around center
  ctx.save();
  ctx.translate(x + w / 2, handleY + 6 - openOffset);
  ctx.rotate(tiltRad);
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 8, 0);
  ctx.quadraticCurveTo(0, -24 - openOffset, w / 2 - 8, 0);
  ctx.stroke();
  ctx.restore();

  // small supports attaching handle to basket (animated with open)
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 8, y + rimH / 2 - openOffset / 2);
  ctx.lineTo(x + 8, handleY + 6 - openOffset);
  ctx.moveTo(x + w - 8, y + rimH / 2 - openOffset / 2);
  ctx.lineTo(x + w - 8, handleY + 6 - openOffset);
  ctx.stroke();

  // subtle highlights / weave lines for texture
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  for (let i = 1; i < 5; i++) {
    const xi = x + i * (w / 5);
    ctx.beginPath();
    ctx.moveTo(xi, y + rimH + 2);
    ctx.lineTo(xi - 8, y + h - 6);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  for (let j = 1; j < 3; j++) {
    const yj = y + rimH + j * ((h - rimH) / 3);
    ctx.beginPath();
    ctx.moveTo(x + 6, yj);
    ctx.lineTo(x + w - 6, yj);
    ctx.stroke();
  }

  ctx.restore();

  // draw fullness indicator below the rim (a small progress bar)
  const barW = Math.round(w * 0.6);
  const barH = 6;
  const bx = x + (w - barW) / 2;
  const by = y + rimH + 6;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(bx, by, barW, barH);
  const filled = Math.round((basket.fullness / basket.capacity) * barW);
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(bx, by, filled, barH);
  // if in full animation, draw a glow
  if (basket.fullAnimTimer > 0) {
    basket.fullAnimTimer--;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(255,200,80,0.15)';
    ctx.fillRect(bx - 4, by - 4, barW + 8, barH + 8);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function update() {
  if (!running) return;

  // background is handled by CSS; clear the canvas each frame
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  // update leaves
  for (let i = leaves.length - 1; i >= 0; i--) {
    const leaf = leaves[i];
    leaf.update();
    leaf.draw();

    // collision with basket using an inset collision box (so leaves must be more centered)
    const inset = 10; // pixels inset from sides/top
    const bx = basket.x + inset;
    const bw = basket.w - inset * 2;
    const by = basket.y + inset;
    const bh = basket.h - inset;
    if (
      leaf.x > bx &&
      leaf.x < bx + bw &&
      leaf.y + leaf.r > by &&
      leaf.y - leaf.r < by + bh
    ) {
      leaves.splice(i, 1);
      score++;
      // increment basket fullness and trigger animations
      basket.fullness = Math.min(basket.capacity, basket.fullness + 1);
      basket.openTarget = Math.min(1, basket.fullness / basket.capacity);
      // handle bounce and tilt depending on where the leaf was caught
      const center = bx + bw / 2;
      const offset = (leaf.x - center) / (bw / 2); // -1..1
      basket.handleBounce = 8;
      basket.handleTilt = offset * 12; // tilt angle in degrees
      if (soundEnabled) playCatchSound();
      // if basket is full, trigger a full animation and give a small bonus
      if (basket.fullness >= basket.capacity) {
        basket.fullAnimTimer = 60; // 60 frames of 'full' animation
        score += 2; // bonus points
        basket.fullness = 0; // reset fullness after bonus
        basket.openTarget = 0;
      }
      updateHUD();
      continue;
    }

    // missed
    if (leaf.y > HEIGHT) {
      leaves.splice(i, 1);
      lives--;
      // decay fullness slightly when you miss
      basket.fullness = Math.max(0, basket.fullness - 1);
      basket.openTarget = Math.min(1, basket.fullness / basket.capacity);
      if (soundEnabled) playMissSound();
      updateHUD();
      if (lives <= 0) {
        gameOver();
        return;
      }
    }
  }

  // slow decay of fullness over time (encourage consistent catching)
  if (basket.fullness > 0) {
    basket.fullness = Math.max(0, basket.fullness - 0.001);
    basket.openTarget = Math.min(1, basket.fullness / basket.capacity);
  }

  drawBasket();
  // update and draw confetti at the end so it appears above most elements
  updateConfetti();
  drawConfetti();

  requestAnimationFrame(update);
}

function spawnLeaf() {
  if (!running) return;
  leaves.push(new Leaf());
  setTimeout(spawnLeaf, 800);
}

function updateHUD() {
  document.getElementById("score").textContent = `Score: ${score} | Lives: ${"❤️".repeat(lives)}`;
  // update header highscore display and flash when new
  const hsEl = document.getElementById('highscore');
  if (score > highscore) {
    highscore = score;
    try { localStorage.setItem('leaf_highscore', String(highscore)); } catch (e) {}
    if (hsEl) {
      hsEl.textContent = `Highscore: ${highscore}`;
      hsEl.classList.add('new-highscore');
      setTimeout(() => hsEl.classList.remove('new-highscore'), 1200);
    }
  } else {
    if (hsEl) hsEl.textContent = `Highscore: ${highscore}`;
  }
}

function startGame() {
  score = 0;
  lives = 3;
  leaves = [];
  running = true;
  updateHUD();
  update();
  spawnLeaf();
}

function resetGame() {
  // reset everything to initial state but don't auto-start
  running = false;
  score = 0;
  lives = 3;
  leaves = [];
  basket.fullness = 0;
  basket.open = 0;
  basket.openTarget = 0;
  basket.handleBounce = 0;
  basket.handleTilt = 0;
  basket.fullAnimTimer = 0;
  updateHUD();
  // clear canvas to remove lingering visuals
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
}

function stopGame() {
  running = false;
  ctx.font = "22px Helvetica";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.fillStyle = '#e5e7eb';
  ctx.strokeText("Game Over — Score: " + score, WIDTH / 2, HEIGHT / 2);
  ctx.fillText("Game Over — Score: " + score, WIDTH / 2, HEIGHT / 2);
}

function gameOver() {
  running = false;
  ctx.font = "22px Helvetica";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.fillStyle = '#e5e7eb';
  ctx.strokeText("Game Over — Score: " + score, WIDTH / 2, HEIGHT / 2);
  ctx.fillText("Game Over — Score: " + score, WIDTH / 2, HEIGHT / 2);
}

// controls
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") basket.x -= 20;
  if (e.key === "ArrowRight") basket.x += 20;
  basket.x = Math.max(0, Math.min(WIDTH - basket.w, basket.x));
});

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  basket.x = mouseX - basket.w / 2;
});

// sound toggle button wiring
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('soundToggle');
  if (!btn) return;
  btn.textContent = soundEnabled ? '🔊' : '🔈';
  btn.setAttribute('aria-pressed', soundEnabled ? 'true' : 'false');
  btn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    try { localStorage.setItem('leaf_sound', soundEnabled ? '1' : '0'); } catch (e) {}
    btn.textContent = soundEnabled ? '🔊' : '🔈';
    btn.setAttribute('aria-pressed', soundEnabled ? 'true' : 'false');
  });
});
