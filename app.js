"use strict";

const BASELINES = [
  {
    id: "sterile",
    name: "Sterile Vacuum",
    rule: "B2/S",
    density: 0.045,
    settle: 2,
    color: "#77796f"
  },
  {
    id: "chaotic",
    name: "Chaotic Vacuum",
    rule: "B35678/S45678",
    density: 0.43,
    settle: 1,
    color: "#d45d4c"
  },
  {
    id: "crystal",
    name: "Crystalline Vacuum",
    rule: "B3/S12345",
    density: 0.28,
    settle: 18,
    color: "#e1b84d"
  },
  {
    id: "predatory",
    name: "Predatory Vacuum",
    rule: "B37/S23",
    density: 0.21,
    settle: 7,
    color: "#d76f37"
  },
  {
    id: "thin",
    name: "Thin Vacuum",
    rule: "B1/S1",
    density: 0.025,
    settle: 4,
    color: "#8c94a3"
  },
  {
    id: "garden",
    name: "Overfertile Vacuum",
    rule: "B34/S34",
    density: 0.31,
    settle: 8,
    color: "#91c95e"
  }
];

const DAUGHTERS = [
  { id: "observer", name: "Observer Vacuum", rule: "B3/S23", color: "#39b9a7" },
  { id: "highlife", name: "HighLife Vacuum", rule: "B36/S23", color: "#72c45b" },
  { id: "daynight", name: "Day & Night Vacuum", rule: "B3678/S34678", color: "#d6c45d" },
  { id: "coral", name: "Coral Vacuum", rule: "B3/S45678", color: "#e27d60" }
];

const COLLISION_RULE = parseRule("B3678/S235678");
const MAX_GENERATION = 6;
const MAX_ACTIVE_BUBBLES = 96;
const MAX_VACUA = 240;
const TARGET_STEP_MS = 40;
const MAX_STEPS_PER_FRAME = 3;
const UI_UPDATE_MS = 120;

const els = {
  canvas: document.querySelector("#universe"),
  playPause: document.querySelector("#playPause"),
  step: document.querySelector("#step"),
  randomize: document.querySelector("#randomize"),
  clear: document.querySelector("#clear"),
  baselineMode: document.querySelector("#baselineMode"),
  daughterMode: document.querySelector("#daughterMode"),
  wallSpeed: document.querySelector("#wallSpeed"),
  wallTension: document.querySelector("#wallTension"),
  wallRadiation: document.querySelector("#wallRadiation"),
  wallSpeedValue: document.querySelector("#wallSpeedValue"),
  wallTensionValue: document.querySelector("#wallTensionValue"),
  wallRadiationValue: document.querySelector("#wallRadiationValue"),
  tickReadout: document.querySelector("#tickReadout"),
  liveReadout: document.querySelector("#liveReadout"),
  vacuumReadout: document.querySelector("#vacuumReadout"),
  collisionReadout: document.querySelector("#collisionReadout"),
  generationReadout: document.querySelector("#generationReadout"),
  parentRuleReadout: document.querySelector("#parentRuleReadout"),
  childRuleReadout: document.querySelector("#childRuleReadout"),
  toolButtons: Array.from(document.querySelectorAll("[data-tool]"))
};

for (const mode of BASELINES) {
  const option = document.createElement("option");
  option.value = mode.id;
  option.textContent = mode.name;
  els.baselineMode.append(option);
}

for (const mode of DAUGHTERS) {
  const option = document.createElement("option");
  option.value = mode.id;
  option.textContent = mode.name;
  els.daughterMode.append(option);
}

function parseRule(rule) {
  const match = /^B([0-8]*)\/S([0-8]*)$/i.exec(rule.trim());
  if (!match) {
    throw new Error(`Invalid Life-like rule: ${rule}`);
  }

  const birth = new Uint8Array(9);
  const survive = new Uint8Array(9);
  for (const digit of match[1]) birth[Number(digit)] = 1;
  for (const digit of match[2]) survive[Number(digit)] = 1;
  return { birth, survive, label: rule.toUpperCase() };
}

function getMode(list, id) {
  return list.find((mode) => mode.id === id) || list[0];
}

function randomItem(list, random) {
  return list[Math.floor(random() * list.length)];
}

function randomDifferentItem(list, random, currentId) {
  if (list.length < 2) return list[0];
  let next = randomItem(list, random);
  while (next.id === currentId) {
    next = randomItem(list, random);
  }
  return next;
}

function xorshift32(seed) {
  let state = seed || 0x6d2b79f5;
  return function next() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 4294967296);
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const COLORS = {
  background: hexToRgb("#080907"),
  youngFalse: hexToRgb("#f3f0e8"),
  youngTrue: hexToRgb("#f1d06b"),
  youngCollision: hexToRgb("#fff0b0"),
  oldCollision: hexToRgb("#ff8c5a"),
  hotCollision: hexToRgb("#f27050"),
  coolCollision: hexToRgb("#e1b84d"),
  wallGold: hexToRgb("#e1b84d")
};

class Universe {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.ctx.imageSmoothingEnabled = false;
    this.bufferCanvas = document.createElement("canvas");
    this.bufferCtx = this.bufferCanvas.getContext("2d", { alpha: false });
    this.pixelData = null;
    this.modeColors = new Map();
    this.parentMode = getMode(BASELINES, els.baselineMode.value);
    this.childMode = getMode(DAUGHTERS, els.daughterMode.value);
    this.parentRule = parseRule(this.parentMode.rule);
    this.childRule = parseRule(this.childMode.rule);
    this.cellSize = 6;
    this.cols = 0;
    this.rows = 0;
    this.tick = 0;
    this.playing = true;
    this.tool = "nucleate";
    this.pointerDown = false;
    this.bubbles = [];
    this.vacua = [null];
    this.liveCount = 0;
    this.convertedCount = 0;
    this.collisionCount = 0;
    this.maxGeneration = 0;
    this.needsDraw = true;
    this.random = xorshift32(Date.now() | 0);
    this.resize();
    this.seed();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const nextCellSize = rect.width < 720 ? 5 : 6;
    const nextCols = Math.max(36, Math.floor(rect.width / nextCellSize));
    const nextRows = Math.max(28, Math.floor(rect.height / nextCellSize));

    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.cellSize = nextCellSize;
    this.viewWidth = rect.width;
    this.viewHeight = rect.height;
    this.needsDraw = true;

    if (nextCols === this.cols && nextRows === this.rows) {
      return;
    }

    const oldCols = this.cols;
    const oldRows = this.rows;
    const oldCells = this.cells;
    const oldAges = this.ages;
    const oldVacuum = this.vacuum;
    const oldCollision = this.collision;

    this.cols = nextCols;
    this.rows = nextRows;
    const total = this.cols * this.rows;
    this.cells = new Uint8Array(total);
    this.nextCells = new Uint8Array(total);
    this.ages = new Uint8Array(total);
    this.nextAges = new Uint8Array(total);
    this.vacuum = new Uint8Array(total);
    this.wall = new Uint8Array(total);
    this.frontOwner = new Uint8Array(total);
    this.collision = new Uint8Array(total);
    this.bufferCanvas.width = this.cols;
    this.bufferCanvas.height = this.rows;
    this.pixelData = this.bufferCtx.createImageData(this.cols, this.rows);

    if (!oldCells) {
      return;
    }

    const copyCols = Math.min(oldCols, this.cols);
    const copyRows = Math.min(oldRows, this.rows);
    const oldX0 = Math.floor((oldCols - copyCols) / 2);
    const oldY0 = Math.floor((oldRows - copyRows) / 2);
    const newX0 = Math.floor((this.cols - copyCols) / 2);
    const newY0 = Math.floor((this.rows - copyRows) / 2);

    for (let y = 0; y < copyRows; y += 1) {
      for (let x = 0; x < copyCols; x += 1) {
        const oldIndex = (oldY0 + y) * oldCols + oldX0 + x;
        const newIndex = (newY0 + y) * this.cols + newX0 + x;
        this.cells[newIndex] = oldCells[oldIndex];
        this.ages[newIndex] = oldAges[oldIndex];
        this.vacuum[newIndex] = oldVacuum[oldIndex];
        this.collision[newIndex] = oldCollision[oldIndex];
      }
    }
    this.recount();
    this.needsDraw = true;
  }

  setRules(parentMode, childMode) {
    this.parentMode = parentMode;
    this.childMode = childMode;
    this.parentRule = parseRule(parentMode.rule);
    this.childRule = parseRule(childMode.rule);
    this.updateRuleReadouts();
  }

  getColor(color) {
    if (!this.modeColors.has(color)) {
      this.modeColors.set(color, hexToRgb(color));
    }
    return this.modeColors.get(color);
  }

  seed() {
    this.tick = 0;
    this.bubbles = [];
    this.vacua = [null];
    this.vacuum.fill(0);
    this.wall.fill(0);
    this.frontOwner.fill(0);
    this.collision.fill(0);
    this.convertedCount = 0;
    this.collisionCount = 0;
    this.maxGeneration = 0;
    for (let i = 0; i < this.cells.length; i += 1) {
      const alive = this.random() < this.parentMode.density ? 1 : 0;
      this.cells[i] = alive;
      this.ages[i] = alive ? 1 + Math.floor(this.random() * 16) : 0;
    }

    for (let i = 0; i < this.parentMode.settle; i += 1) {
      this.step(false);
    }
    this.tick = 0;
    this.recount();
    this.updateUi();
    this.draw();
  }

  clear() {
    this.tick = 0;
    this.bubbles = [];
    this.vacua = [null];
    this.cells.fill(0);
    this.nextCells.fill(0);
    this.ages.fill(0);
    this.nextAges.fill(0);
    this.vacuum.fill(0);
    this.wall.fill(0);
    this.frontOwner.fill(0);
    this.collision.fill(0);
    this.liveCount = 0;
    this.convertedCount = 0;
    this.collisionCount = 0;
    this.maxGeneration = 0;
    this.updateUi();
    this.draw();
  }

  spawnBubble(gridX, gridY, options = {}) {
    if (this.vacua.length >= MAX_VACUA || this.bubbles.length >= MAX_ACTIVE_BUBBLES) {
      return null;
    }

    const mode = options.mode || randomDifferentItem(DAUGHTERS, this.random, options.parentModeId || this.childMode.id);
    const generation = options.generation || 0;
    const inheritedSpeed = options.parentSpeed || Number(els.wallSpeed.value);
    const inheritedTension = options.parentTension ?? Number(els.wallTension.value);
    const inheritedRadiation = options.parentRadiation ?? Number(els.wallRadiation.value);
    const speed = clamp((options.speed ?? inheritedSpeed) * (0.72 + this.random() * 0.72), 0.35, 2.9);
    const tension = clamp((options.tension ?? inheritedTension) + (this.random() - 0.5) * 0.52, 0, 1);
    const radiation = clamp((options.radiation ?? inheritedRadiation) + (this.random() - 0.5) * 0.34, 0.02, 0.92);
    const vacuumId = this.vacua.length;
    const vacuum = {
      id: vacuumId,
      mode,
      rule: parseRule(mode.rule),
      speed,
      tension,
      radiation,
      color: mode.color,
      generation,
      parentVacuumId: options.parentVacuumId || 0
    };
    this.vacua.push(vacuum);
    this.maxGeneration = Math.max(this.maxGeneration, generation);

    const bubble = {
      vacuumId,
      x: gridX,
      y: gridY,
      radius: 1.5,
      phase: this.random() * Math.PI * 2,
      wobbleA: 5 + this.random() * 7,
      wobbleB: 11 + this.random() * 9,
      speed,
      tension,
      radiation,
      generation,
      parentVacuumId: options.parentVacuumId || 0,
      nextSpawn: this.tick + 10 + Math.floor(this.random() * 24)
    };
    this.bubbles.push(bubble);
    this.needsDraw = true;

    if (options.updateControls !== false) {
      els.daughterMode.value = mode.id;
      els.wallSpeed.value = speed.toFixed(1);
      els.wallTension.value = tension.toFixed(2);
      els.wallRadiation.value = radiation.toFixed(2);
      syncRangeOutputs();
      this.childMode = mode;
      this.childRule = vacuum.rule;
      this.updateRuleReadouts();
    }

    return bubble;
  }

  addBubble(gridX, gridY) {
    const parentMode = randomDifferentItem(BASELINES, this.random, this.parentMode.id);
    this.parentMode = parentMode;
    this.parentRule = parseRule(parentMode.rule);
    els.baselineMode.value = parentMode.id;

    this.spawnBubble(gridX, gridY, {
      generation: 0,
      mode: randomDifferentItem(DAUGHTERS, this.random, this.childMode.id),
      updateControls: true
    });
  }

  paint(gridX, gridY, value) {
    const brush = 2;
    for (let oy = -brush; oy <= brush; oy += 1) {
      for (let ox = -brush; ox <= brush; ox += 1) {
        if (ox * ox + oy * oy > brush * brush) continue;
        const x = gridX + ox;
        const y = gridY + oy;
        if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) continue;
        const index = y * this.cols + x;
        this.cells[index] = value;
        this.ages[index] = value ? 1 : 0;
      }
    }
    this.needsDraw = true;
  }

  expandBubbles() {
    this.wall.fill(0);
    this.frontOwner.fill(0);
    for (let i = 0; i < this.collision.length; i += 1) {
      if (this.collision[i]) this.collision[i] -= 1;
    }
    const farEdge = Math.hypot(this.cols, this.rows) + 18;
    const descendants = [];

    for (const bubble of this.bubbles) {
      const speed = bubble.speed;
      const tension = bubble.tension;
      const wrinkle = (1 - tension) * 9;
      const frontWidth = Math.max(1.4, speed + 1.4);
      bubble.radius += speed;
      bubble.phase += 0.045 + speed * 0.012;
      const maxReach = bubble.radius + wrinkle + 2;
      const maxReachSq = maxReach * maxReach;

      if (
        bubble.generation < MAX_GENERATION &&
        bubble.radius > 9 &&
        this.tick >= bubble.nextSpawn &&
        this.bubbles.length + descendants.length < MAX_ACTIVE_BUBBLES &&
        this.vacua.length + descendants.length < MAX_VACUA
      ) {
        const spawnChance = 0.24 + bubble.radiation * 0.18 + (1 - bubble.tension) * 0.08;
        if (this.random() < spawnChance) {
          const angle = this.random() * Math.PI * 2;
          const distance = bubble.radius * (0.48 + this.random() * 0.48);
          const x = clamp(Math.round(bubble.x + Math.cos(angle) * distance), 0, this.cols - 1);
          const y = clamp(Math.round(bubble.y + Math.sin(angle) * distance), 0, this.rows - 1);
          const parentVacuum = this.vacua[bubble.vacuumId];
          descendants.push({
            x,
            y,
            generation: bubble.generation + 1,
            parentVacuumId: bubble.vacuumId,
            parentModeId: parentVacuum?.mode.id,
            parentSpeed: bubble.speed,
            parentTension: bubble.tension,
            parentRadiation: bubble.radiation
          });
        }
        bubble.nextSpawn = this.tick + 16 + Math.floor(this.random() * 34);
      }

      const minX = Math.max(0, Math.floor(bubble.x - bubble.radius - wrinkle - 3));
      const maxX = Math.min(this.cols - 1, Math.ceil(bubble.x + bubble.radius + wrinkle + 3));
      const minY = Math.max(0, Math.floor(bubble.y - bubble.radius - wrinkle - 3));
      const maxY = Math.min(this.rows - 1, Math.ceil(bubble.y + bubble.radius + wrinkle + 3));

      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const dx = x - bubble.x;
          const dy = y - bubble.y;
          const distSq = dx * dx + dy * dy;
          if (distSq > maxReachSq) continue;
          const dist = Math.sqrt(distSq);

          const angle = Math.atan2(dy, dx);
          const localWrinkle =
            Math.sin(angle * bubble.wobbleA + bubble.phase) * wrinkle * 0.6 +
            Math.sin(angle * bubble.wobbleB - bubble.phase * 0.7) * wrinkle * 0.4;
          const front = bubble.radius + localWrinkle;
          const index = y * this.cols + x;

          if (dist <= front) {
            if (this.vacuum[index] === 0) {
              this.vacuum[index] = bubble.vacuumId;
            } else if (this.vacuum[index] !== bubble.vacuumId && Math.abs(dist - front) <= frontWidth * 2) {
              this.collision[index] = Math.max(this.collision[index], 10);
            }
          }
          if (Math.abs(dist - front) <= frontWidth) {
            this.wall[index] = 1;
            if (this.frontOwner[index] && this.frontOwner[index] !== bubble.vacuumId) {
              this.collision[index] = Math.max(this.collision[index], 12);
            } else {
              this.frontOwner[index] = bubble.vacuumId;
            }
          }
        }
      }
    }

    for (const descendant of descendants) {
      this.spawnBubble(descendant.x, descendant.y, {
        generation: descendant.generation,
        parentVacuumId: descendant.parentVacuumId,
        parentModeId: descendant.parentModeId,
        parentSpeed: descendant.parentSpeed,
        parentTension: descendant.parentTension,
        parentRadiation: descendant.parentRadiation,
        updateControls: false
      });
    }

    this.bubbles = this.bubbles.filter((bubble) => bubble.radius < farEdge);
  }

  step(countTick = true) {
    this.expandBubbles();
    const cols = this.cols;
    const rows = this.rows;
    const cells = this.cells;
    let live = 0;
    let converted = 0;
    let collisions = 0;

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const index = y * cols + x;
        let neighbors = 0;
        if (y > 0) {
          const north = index - cols;
          if (x > 0) neighbors += cells[north - 1];
          neighbors += cells[north];
          if (x + 1 < cols) neighbors += cells[north + 1];
        }
        if (x > 0) neighbors += cells[index - 1];
        if (x + 1 < cols) neighbors += cells[index + 1];
        if (y + 1 < rows) {
          const south = index + cols;
          if (x > 0) neighbors += cells[south - 1];
          neighbors += cells[south];
          if (x + 1 < cols) neighbors += cells[south + 1];
        }

        const alive = cells[index] === 1;
        const vacuum = this.vacua[this.vacuum[index]];
        if (this.collision[index]) collisions += 1;
        const rule = this.collision[index] ? COLLISION_RULE : vacuum?.rule || this.parentRule;
        const frontVacuum = this.vacua[this.frontOwner[index]];
        const radiation = this.collision[index]
          ? 0.94
          : frontVacuum?.radiation || vacuum?.radiation || Number(els.wallRadiation.value);
        let next = alive ? rule.survive[neighbors] : rule.birth[neighbors];

        if (!next && this.wall[index] && this.random() < radiation * 0.028) {
          next = 1;
        }
        if (next && this.wall[index] && this.random() < radiation * 0.01) {
          next = 0;
        }
        if (this.collision[index]) {
          if (!next && neighbors > 0 && neighbors < 8 && this.random() < 0.115) {
            next = 1;
          } else if (next && this.random() < 0.055) {
            next = 0;
          }
        }

        this.nextCells[index] = next;
        this.nextAges[index] = next ? clamp(this.ages[index] + 1, 1, 255) : 0;
        live += next;
        converted += this.vacuum[index] ? 1 : 0;
      }
    }

    [this.cells, this.nextCells] = [this.nextCells, this.cells];
    [this.ages, this.nextAges] = [this.nextAges, this.ages];
    if (countTick) this.tick += 1;
    this.liveCount = live;
    this.convertedCount = converted;
    this.collisionCount = collisions;
    this.needsDraw = true;
  }

  recount() {
    let live = 0;
    let converted = 0;
    let collisions = 0;
    for (let i = 0; i < this.cells.length; i += 1) {
      live += this.cells[i];
      converted += this.vacuum[i] ? 1 : 0;
      collisions += this.collision[i] ? 1 : 0;
    }
    this.liveCount = live;
    this.convertedCount = converted;
    this.collisionCount = collisions;
  }

  draw() {
    const data = this.pixelData.data;
    const background = COLORS.background;

    for (let index = 0, offset = 0; index < this.cells.length; index += 1, offset += 4) {
      const vacuum = this.vacua[this.vacuum[index]];
      const frontVacuum = this.vacua[this.frontOwner[index]];
      let r = background[0];
      let g = background[1];
      let b = background[2];

      if (vacuum) {
        const color = this.getColor(vacuum.color);
        r = r * 0.9 + color[0] * 0.1;
        g = g * 0.9 + color[1] * 0.1;
        b = b * 0.9 + color[2] * 0.1;
      }
      if (this.collision[index]) {
        const color = this.collision[index] > 6 ? COLORS.hotCollision : COLORS.coolCollision;
        const alpha = this.collision[index] > 6 ? 0.72 : 0.42;
        const inverse = 1 - alpha;
        r = r * inverse + color[0] * alpha;
        g = g * inverse + color[1] * alpha;
        b = b * inverse + color[2] * alpha;
      } else if (this.wall[index]) {
        const frontColor = frontVacuum ? this.getColor(frontVacuum.color) : COLORS.wallGold;
        r = r * 0.66 + frontColor[0] * 0.34;
        g = g * 0.66 + frontColor[1] * 0.34;
        b = b * 0.66 + frontColor[2] * 0.34;
        r = r * 0.68 + COLORS.wallGold[0] * 0.32;
        g = g * 0.68 + COLORS.wallGold[1] * 0.32;
        b = b * 0.68 + COLORS.wallGold[2] * 0.32;
      }
      if (this.cells[index]) {
        const age = this.ages[index];
        if (this.collision[index]) {
          const color = age > 18 ? COLORS.oldCollision : COLORS.youngCollision;
          r = color[0];
          g = color[1];
          b = color[2];
        } else if (vacuum) {
          const color = age > 18 ? this.getColor(vacuum.color) : COLORS.youngTrue;
          r = color[0];
          g = color[1];
          b = color[2];
        } else {
          const color = age > 18 ? this.getColor(this.parentMode.color) : COLORS.youngFalse;
          r = color[0];
          g = color[1];
          b = color[2];
        }
      }

      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }

    this.bufferCtx.putImageData(this.pixelData, 0, 0);
    this.ctx.clearRect(0, 0, this.viewWidth, this.viewHeight);
    this.ctx.drawImage(this.bufferCanvas, 0, 0, this.cols, this.rows, 0, 0, this.viewWidth, this.viewHeight);
    this.needsDraw = false;
  }

  updateUi() {
    const total = this.cols * this.rows || 1;
    els.tickReadout.value = `t=${this.tick}`;
    els.liveReadout.value = String(this.liveCount);
    els.vacuumReadout.value = `${Math.round((this.convertedCount / total) * 100)}%`;
    els.collisionReadout.value = String(this.collisionCount);
    els.generationReadout.value = String(this.maxGeneration);
    this.updateRuleReadouts();
  }

  updateRuleReadouts() {
    els.parentRuleReadout.value = this.parentRule.label;
    els.childRuleReadout.value = this.childRule.label;
  }

  canvasToGrid(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / this.cellSize);
    const y = Math.floor((event.clientY - rect.top) / this.cellSize);
    return {
      x: clamp(x, 0, this.cols - 1),
      y: clamp(y, 0, this.rows - 1)
    };
  }

  handlePointer(event) {
    const { x, y } = this.canvasToGrid(event);
    if (this.tool === "nucleate") {
      if (event.type === "pointerdown") this.addBubble(x, y);
      return;
    }
    this.paint(x, y, this.tool === "draw" ? 1 : 0);
  }
}

const universe = new Universe(els.canvas);

window.falseVacuumGarden = {
  stats() {
    let collisions = 0;
    for (const value of universe.collision) {
      if (value) collisions += 1;
    }
    return {
      bubbles: universe.bubbles.length,
      vacua: universe.vacua.length - 1,
      collisions,
      live: universe.liveCount,
      converted: universe.convertedCount,
      collisionCount: universe.collisionCount,
      maxGeneration: universe.maxGeneration,
      childRule: universe.childRule.label
    };
  }
};

function syncRangeOutputs() {
  els.wallSpeedValue.value = Number(els.wallSpeed.value).toFixed(1);
  els.wallTensionValue.value = Number(els.wallTension.value).toFixed(2);
  els.wallRadiationValue.value = Number(els.wallRadiation.value).toFixed(2);
}

function setPlaying(nextPlaying) {
  universe.playing = nextPlaying;
  els.playPause.textContent = nextPlaying ? "Pause" : "Play";
}

els.playPause.addEventListener("click", () => setPlaying(!universe.playing));
els.step.addEventListener("click", () => {
  setPlaying(false);
  universe.step();
  universe.updateUi();
  universe.draw();
});
els.randomize.addEventListener("click", () => universe.seed());
els.clear.addEventListener("click", () => {
  setPlaying(false);
  universe.clear();
});

els.baselineMode.addEventListener("change", () => {
  universe.setRules(getMode(BASELINES, els.baselineMode.value), universe.childMode);
  universe.seed();
});

els.daughterMode.addEventListener("change", () => {
  universe.setRules(universe.parentMode, getMode(DAUGHTERS, els.daughterMode.value));
});

for (const input of [els.wallSpeed, els.wallTension, els.wallRadiation]) {
  input.addEventListener("input", syncRangeOutputs);
}
syncRangeOutputs();

for (const button of els.toolButtons) {
  button.addEventListener("click", () => {
    universe.tool = button.dataset.tool;
    for (const other of els.toolButtons) {
      other.classList.toggle("active", other === button);
    }
  });
}

els.canvas.addEventListener("pointerdown", (event) => {
  universe.pointerDown = true;
  els.canvas.setPointerCapture(event.pointerId);
  universe.handlePointer(event);
});

els.canvas.addEventListener("pointermove", (event) => {
  if (!universe.pointerDown) return;
  universe.handlePointer(event);
});

els.canvas.addEventListener("pointerup", (event) => {
  universe.pointerDown = false;
  if (els.canvas.hasPointerCapture(event.pointerId)) {
    els.canvas.releasePointerCapture(event.pointerId);
  }
});

els.canvas.addEventListener("pointercancel", () => {
  universe.pointerDown = false;
});

window.addEventListener("resize", () => {
  universe.resize();
  universe.draw();
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && event.target === document.body) {
    event.preventDefault();
    setPlaying(!universe.playing);
  }
});

let lastTime = performance.now();
let accumulator = 0;
let lastUiUpdate = 0;

function frame(now) {
  if (document.hidden) {
    lastTime = now;
    requestAnimationFrame(frame);
    return;
  }

  const elapsed = Math.min(160, now - lastTime);
  lastTime = now;
  accumulator += elapsed;
  let stepped = false;

  if (universe.playing) {
    let steps = 0;
    while (accumulator >= TARGET_STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      universe.step();
      accumulator -= TARGET_STEP_MS;
      steps += 1;
      stepped = true;
    }
    if (steps === MAX_STEPS_PER_FRAME && accumulator >= TARGET_STEP_MS) {
      accumulator = TARGET_STEP_MS;
    }
  } else {
    accumulator = 0;
  }

  if (stepped && now - lastUiUpdate >= UI_UPDATE_MS) {
    universe.updateUi();
    lastUiUpdate = now;
  }
  if (universe.needsDraw) {
    universe.draw();
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
