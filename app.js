"use strict";

const STORAGE_KEY = "gloomEnemies";
const LIBRARY_URL = "data/monsters.json";
const QUICK_DAMAGE = [1, 2, 3, 5, 10];
const ATTRIBUTE_ICONS = new Map([
  ["Flying", "🪽"],
  ["Jump", "🦘"],
  ["Poison", "☠️"],
  ["Wound", "🩸"],
  ["Stun", "💫"],
  ["Disarm", "✋"],
  ["Immobilize", "⛓️"],
  ["Curse", "💀"],
  ["Retaliate", "✊"],
  ["Push", "➡️"],
  ["Pull", "↩️"],
  ["Pierce", "🗡️"],
  ["Target", "🎯"],
  ["Range", "🏹"]
]);

const state = {
  enemies: loadEnemies(),
  monsterLibrary: [],
  monsterByName: new Map(),
  nodes: new Map(),
  pointerDragId: null,
  nativeDragId: null,
  deleteUndo: null
};

normalizeEnemyOrdinals(state.enemies);
saveEnemies();

const elements = {
  form: document.getElementById("enemyForm"),
  name: document.getElementById("nameInput"),
  suggestions: document.getElementById("monsterSuggestions"),
  level: document.getElementById("levelInput"),
  health: document.getElementById("healthInput"),
  shield: document.getElementById("shieldInput"),
  quantity: document.getElementById("quantityInput"),
  list: document.getElementById("enemyList"),
  template: document.getElementById("enemyTemplate"),
  fullscreen: document.getElementById("fullscreenButton"),
  snackbar: document.getElementById("undoSnackbar"),
  snackbarMessage: document.getElementById("undoSnackbarMessage"),
  snackbarUndo: document.getElementById("undoSnackbarUndo")
};

renderList();
loadMonsterLibrary();

elements.form.addEventListener("submit", event => {
  event.preventDefault();
  addEnemies();
});

["input", "change"].forEach(eventName => {
  elements.name.addEventListener(eventName, () => {
    renderMonsterSuggestions();
    fillStatsFromSelection();
  });
});

elements.name.addEventListener("focus", renderMonsterSuggestions);
elements.name.addEventListener("keydown", handleSearchKeydown);
elements.suggestions.addEventListener("pointerdown", event => {
  const button = event.target.closest(".monster-suggestion");
  if (!button) return;
  event.preventDefault();
  selectMonster(button.dataset.monsterName);
});
document.addEventListener("pointerdown", event => {
  if (!event.target.closest(".monster-search")) closeMonsterSuggestions();
});

elements.level.addEventListener("change", fillStatsFromSelection);
elements.fullscreen.addEventListener("click", toggleFullscreen);
elements.snackbarUndo.addEventListener("click", undoDeleteEnemy);

elements.list.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;

  if (button.classList.contains("enemy-group-toggle")) {
    const groupNode = button.closest(".enemy-group");
    if (!groupNode) return;
    toggleEnemyGroupCollapse(groupNode.dataset.groupKey);
    return;
  }

  const enemyNode = button.closest(".enemy");
  const enemy = enemyNode ? findEnemy(enemyNode.dataset.id) : null;
  if (!enemy) return;

  if (button.classList.contains("rank-toggle")) {
    setEnemyElite(enemy, !enemy.elite);
    updateEnemy(enemy);
    saveEnemies();
    return;
  }

  if (button.classList.contains("attack-button")) {
    applyTypedDamage(enemy, enemyNode);
    return;
  }

  if (button.classList.contains("heal-button")) {
    heal(enemy.id, 1);
    return;
  }

  if (button.classList.contains("delete-button")) {
    deleteEnemy(enemy.id);
    return;
  }

  if (button.dataset.damage) {
    applyDamage(enemy.id, Number(button.dataset.damage));
  }
});

elements.list.addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  const input = event.target.closest(".damage-input");
  if (!input) return;
  const enemyNode = input.closest(".enemy");
  const enemy = enemyNode ? findEnemy(enemyNode.dataset.id) : null;
  if (enemy) applyTypedDamage(enemy, enemyNode);
});

elements.list.addEventListener("dragstart", event => {
  const enemyNode = event.target.closest(".enemy");
  if (!enemyNode) return;
  state.nativeDragId = enemyNode.dataset.id;
  enemyNode.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
});

elements.list.addEventListener("dragover", event => {
  const enemyNode = event.target.closest(".enemy");
  if (!enemyNode || !state.nativeDragId) return;
  event.preventDefault();
  markDragTarget(enemyNode);
});

elements.list.addEventListener("drop", event => {
  const targetNode = event.target.closest(".enemy");
  if (!targetNode || !state.nativeDragId) return;
  event.preventDefault();
  reorderEnemy(state.nativeDragId, targetNode.dataset.id);
  clearDragState();
});

elements.list.addEventListener("dragend", clearDragState);

elements.list.addEventListener("pointerdown", event => {
  const handle = event.target.closest(".drag-handle");
  if (!handle) return;

  const enemyNode = handle.closest(".enemy");
  if (!enemyNode) return;

  state.pointerDragId = enemyNode.dataset.id;
  enemyNode.classList.add("dragging");
  handle.setPointerCapture(event.pointerId);
  if (navigator.vibrate) navigator.vibrate(18);
});

elements.list.addEventListener("pointermove", event => {
  if (!state.pointerDragId) return;
  const targetNode = document.elementFromPoint(event.clientX, event.clientY)?.closest(".enemy");
  if (!targetNode || targetNode.dataset.id === state.pointerDragId) return;
  markDragTarget(targetNode);
});

elements.list.addEventListener("pointerup", event => {
  if (!state.pointerDragId) return;
  const targetNode = document.elementFromPoint(event.clientX, event.clientY)?.closest(".enemy");
  if (targetNode) reorderEnemy(state.pointerDragId, targetNode.dataset.id);
  clearDragState();
});

elements.list.addEventListener("pointercancel", clearDragState);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
  });
}

async function loadMonsterLibrary() {
  try {
    const response = await fetch(LIBRARY_URL, { cache: "force-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    state.monsterLibrary = Array.isArray(data.monsters) ? data.monsters : [];
    state.monsterByName = new Map(state.monsterLibrary.map(monster => [normalizeName(monster.name), monster]));
    renderMonsterSuggestions();
    fillStatsFromSelection();
  } catch (error) {
    console.warn("No se pudo cargar la biblioteca de monstruos.", error);
  }
}

function renderMonsterSuggestions() {
  const query = normalizeName(elements.name.value);
  if (!query || state.monsterLibrary.length === 0) {
    closeMonsterSuggestions();
    return;
  }

  const matches = state.monsterLibrary
    .filter(monster => normalizeName(monster.name).includes(query))
    .slice(0, 8);

  if (matches.length === 0) {
    closeMonsterSuggestions();
    return;
  }

  elements.suggestions.replaceChildren(...matches.map((monster, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "monster-suggestion";
    button.dataset.monsterName = monster.name;
    button.id = `monster-suggestion-${index}`;
    button.setAttribute("role", "option");
    button.textContent = monster.name;
    return button;
  }));

  elements.suggestions.classList.add("open");
  elements.name.setAttribute("aria-expanded", "true");
  elements.name.removeAttribute("aria-activedescendant");
}

function closeMonsterSuggestions() {
  elements.suggestions.classList.remove("open");
  elements.name.setAttribute("aria-expanded", "false");
  elements.name.removeAttribute("aria-activedescendant");
}

function selectMonster(monsterName) {
  elements.name.value = monsterName;
  closeMonsterSuggestions();
  fillStatsFromSelection();
}

function handleSearchKeydown(event) {
  if (event.key === "Escape") {
    closeMonsterSuggestions();
    return;
  }

  if (event.key !== "Enter") return;

  const firstSuggestion = elements.suggestions.querySelector(".monster-suggestion");
  const exactMatch = getSelectedMonster();
  if (!exactMatch && firstSuggestion) {
    event.preventDefault();
    selectMonster(firstSuggestion.dataset.monsterName);
  }
}

function fillStatsFromSelection() {
  const monster = getSelectedMonster();
  const stats = monster ? getMonsterStats(monster, false) : null;
  if (!stats || !Number.isFinite(Number(stats.health))) return;

  elements.health.value = stats.health;
  elements.shield.value = stats.shield || 0;
}

function getSelectedMonster() {
  return state.monsterByName.get(normalizeName(elements.name.value));
}

function getMonsterStats(monster, elite = false) {
  const level = elements.level.value;
  const rank = elite ? "elite" : "normal";
  return monster?.levels?.[level]?.[rank] || null;
}

function loadEnemies() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeEnemy);
  } catch {
    return [];
  }
}

function normalizeEnemy(enemy, index) {
  const max = toInt(enemy.max, toInt(enemy.vida, 1));
  const storedGroupOrdinal = toInt(enemy.groupOrdinal, NaN);
  return {
    id: enemy.id || `enemy-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
    nombre: String(enemy.nombre || "Enemigo"),
    groupName: String(enemy.groupName || stripEnemySuffix(enemy.nombre) || enemy.nombre || "Enemigo"),
    vida: clamp(toInt(enemy.vida, max), 0, max),
    max,
    escudo: Math.max(0, toInt(enemy.escudo, 0)),
    elite: Boolean(enemy.elite),
    ordinal: Number.isFinite(storedGroupOrdinal) ? Math.max(1, storedGroupOrdinal) : Math.max(1, toInt(enemy.ordinal, index + 1)),
    groupOrdinal: Number.isFinite(storedGroupOrdinal) ? Math.max(1, storedGroupOrdinal) : null,
    groupCollapsed: Boolean(enemy.groupCollapsed),
    level: enemy.level ?? null,
    monsterId: enemy.monsterId || null,
    libraryStats: enemy.libraryStats && typeof enemy.libraryStats === "object" ? enemy.libraryStats : null
  };
}

function saveEnemies() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.enemies));
}

function addEnemies() {
  const baseName = elements.name.value.trim();
  const health = toInt(elements.health.value, NaN);
  const shield = Math.max(0, toInt(elements.shield.value, 0));
  const quantity = clamp(toInt(elements.quantity.value, 1), 1, 99);
  const selectedMonster = getSelectedMonster();
  const selectedStats = selectedMonster ? getMonsterStats(selectedMonster, false) : null;
  const selectedEliteStats = selectedMonster ? getMonsterStats(selectedMonster, true) : null;

  if (!baseName || !Number.isFinite(health) || health <= 0) return;

  const nextNumbers = getNextEnemyNumbers(baseName, quantity);
  const newEnemies = nextNumbers.map(number => ({
    id: `enemy-${Date.now()}-${number}-${Math.random().toString(36).slice(2)}`,
    nombre: quantity > 1 || hasNumberedEnemy(baseName) ? `${baseName} ${number}` : baseName,
    groupName: baseName,
    vida: health,
    max: health,
    escudo: shield,
    elite: false,
    ordinal: number,
    groupOrdinal: number,
    groupCollapsed: false,
    level: elements.level.value,
    monsterId: selectedMonster?.id || null,
    libraryStats: selectedStats || selectedEliteStats ? {
      normal: selectedStats ? { ...selectedStats } : null,
      elite: selectedEliteStats ? { ...selectedEliteStats } : null
    } : null
  }));

  state.enemies.push(...newEnemies);
  elements.quantity.value = "1";
  closeMonsterSuggestions();
  renderList();
  saveEnemies();
}

function getNextEnemyNumbers(baseName, quantity) {
  const used = new Set();
  const escapedName = escapeRegExp(baseName);
  const numberedName = new RegExp(`^${escapedName}\\s+(\\d+)$`, "i");

  state.enemies.forEach(enemy => {
    if (normalizeName(getEnemyGroupName(enemy)) !== normalizeName(baseName)) return;
    const match = String(enemy.nombre).match(numberedName);
    if (match) {
      used.add(Number(match[1]));
      return;
    }
    const number = toInt(enemy.groupOrdinal ?? enemy.ordinal, NaN);
    if (Number.isFinite(number)) used.add(number);
  });

  const numbers = [];
  let candidate = 1;
  while (numbers.length < quantity) {
    if (!used.has(candidate)) numbers.push(candidate);
    candidate += 1;
  }
  return numbers;
}

function hasNumberedEnemy(baseName) {
  const numberedName = new RegExp(`^${escapeRegExp(baseName)}\\s+\\d+$`, "i");
  return state.enemies.some(enemy => numberedName.test(String(enemy.nombre)));
}

function applyTypedDamage(enemy, enemyNode) {
  const input = enemyNode.querySelector(".damage-input");
  const damage = toInt(input.value, NaN);
  if (!Number.isFinite(damage)) return;
  applyDamage(enemy.id, damage);
  input.value = "";
}

function applyDamage(enemyId, rawDamage) {
  const enemy = findEnemy(enemyId);
  if (!enemy) return;

  const effectiveDamage = Math.max(0, rawDamage - enemy.escudo);
  enemy.vida = Math.max(0, enemy.vida - effectiveDamage);
  updateEnemy(enemy);
  saveEnemies();
}

function heal(enemyId, amount) {
  const enemy = findEnemy(enemyId);
  if (!enemy) return;

  enemy.vida = Math.min(enemy.max, enemy.vida + amount);
  updateEnemy(enemy);
  saveEnemies();
}

function deleteEnemy(enemyId) {
  const index = state.enemies.findIndex(enemy => enemy.id === enemyId);
  const enemy = index >= 0 ? state.enemies[index] : null;
  if (!enemy) return;

  hideDeleteUndoSnackbar();
  const snapshot = cloneEnemy(enemy);
  state.enemies.splice(index, 1);
  renderList();
  saveEnemies();
  showDeleteUndoSnackbar(snapshot, index);
}

function reorderEnemy(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return;

  const from = state.enemies.findIndex(enemy => enemy.id === sourceId);
  const to = state.enemies.findIndex(enemy => enemy.id === targetId);
  if (from < 0 || to < 0) return;

  const [enemy] = state.enemies.splice(from, 1);
  state.enemies.splice(to, 0, enemy);
  renderList();
  saveEnemies();
}

function renderList() {
  const seenIds = new Set();
  const groups = new Map();
  const groupOrder = [];

  state.enemies.forEach(enemy => {
    const groupKey = getEnemyGroupKey(enemy);
    let group = groups.get(groupKey);
    if (!group) {
      group = createEnemyGroupNode(getEnemyGroupTitle(enemy), groupKey, isGroupCollapsed(groupKey));
      group.count = 0;
      groups.set(groupKey, group);
      groupOrder.push(group.node);
    }
    group.count += 1;

    let node = state.nodes.get(enemy.id);
    if (!node) {
      node = createEnemyNode(enemy.id);
      state.nodes.set(enemy.id, node);
    }

    updateEnemy(enemy);
    if (!group.collapsed) group.rows.appendChild(node);
    seenIds.add(enemy.id);
  });

  for (const group of groups.values()) {
    group.header.querySelector(".enemy-group-indicator").textContent = group.collapsed ? "▶" : "▼";
    group.header.querySelector(".enemy-group-title-text").textContent = group.title;
    group.header.querySelector(".enemy-group-count").textContent = `(${group.count})`;
    group.rows.hidden = group.collapsed;
  }

  elements.list.replaceChildren(...groupOrder);

  for (const [id, node] of state.nodes) {
    if (seenIds.has(id)) continue;
    node.remove();
    state.nodes.delete(id);
  }
}

function createEnemyNode(enemyId) {
  const node = elements.template.content.firstElementChild.cloneNode(true);
  node.dataset.id = enemyId;
  node.querySelectorAll(".quick-actions button").forEach((button, index) => {
    button.dataset.damage = QUICK_DAMAGE[index];
  });
  return node;
}

function updateEnemy(enemy) {
  const node = state.nodes.get(enemy.id);
  if (!node) return;

  const eliteToggle = node.querySelector(".rank-toggle");
  const healthClass = getHealthClass(enemy.vida, enemy.max);
  const attributesNode = node.querySelector(".monster-attributes");
  node.classList.toggle("dead", enemy.vida <= 0);
  node.querySelector(".enemy-ordinal").textContent = getOrdinalLabel(enemy.ordinal);
  node.querySelector(".health-value").textContent = String(Math.max(0, enemy.vida));
  node.querySelector(".health-value").className = `health-value ${healthClass}`;
  renderMonsterAttributes(attributesNode, enemy);
  node.querySelector(".shield-value").textContent = String(enemy.escudo);
  if (eliteToggle) {
    eliteToggle.textContent = enemy.elite ? "🟡" : "⚪";
    eliteToggle.classList.toggle("elite", enemy.elite);
    eliteToggle.setAttribute("aria-pressed", enemy.elite ? "true" : "false");
    eliteToggle.setAttribute("aria-label", enemy.elite ? "Marcar como normal" : "Marcar como élite");
    eliteToggle.title = enemy.elite ? "Marcar como normal" : "Marcar como élite";
  }
}

function getHealthClass(current, max) {
  if (current <= 0) return "health-dead";
  const percent = current / Math.max(1, max);
  if (percent > .6) return "health-high";
  if (percent > .3) return "health-mid";
  return "health-low";
}

function findEnemy(enemyId) {
  return state.enemies.find(enemy => enemy.id === enemyId);
}

function createEnemyGroupNode(title, groupKey, collapsed) {
  const node = document.createElement("article");
  node.className = "enemy-group";
  node.dataset.groupKey = groupKey;
  const header = document.createElement("button");
  header.type = "button";
  header.className = "enemy-group-title enemy-group-toggle";
  header.innerHTML = `
    <span class="enemy-group-indicator" aria-hidden="true"></span>
    <span class="enemy-group-title-text"></span>
    <span class="enemy-group-count"></span>
  `;
  header.querySelector(".enemy-group-indicator").textContent = collapsed ? "▶" : "▼";
  header.querySelector(".enemy-group-title-text").textContent = title;
  header.querySelector(".enemy-group-count").textContent = "(0)";

  const rows = document.createElement("div");
  rows.className = "enemy-group-list";

  node.append(header, rows);
  return { node, rows, header, title, collapsed };
}

function setEnemyElite(enemy, elite) {
  const stats = getMonsterStatsForEnemy(enemy, elite);
  const previousMax = Math.max(1, toInt(enemy.max, 1));
  const currentHealth = clamp(toInt(enemy.vida, previousMax), 0, previousMax);
  const damageTaken = Math.max(0, previousMax - currentHealth);

  enemy.elite = Boolean(elite);

  if (!stats) return;

  const nextMax = Math.max(1, toInt(stats.health, previousMax));
  enemy.max = nextMax;
  enemy.escudo = Math.max(0, toInt(stats.shield, 0));
  enemy.vida = clamp(nextMax - damageTaken, 0, nextMax);
}

function getMonsterStatsForEnemy(enemy, elite = enemy?.elite) {
  const storedStats = getStoredMonsterStats(enemy, elite);
  if (storedStats) return storedStats;

  const monster = getMonsterForEnemy(enemy);
  if (!monster) return null;

  const level = String(enemy.level ?? "0");
  const rank = elite ? "elite" : "normal";
  return monster?.levels?.[level]?.[rank] || null;
}

function getStoredMonsterStats(enemy, elite) {
  const stats = enemy?.libraryStats;
  if (!stats || typeof stats !== "object") return null;

  if ("normal" in stats || "elite" in stats) {
    const storedStats = elite ? stats.elite : stats.normal;
    return storedStats && typeof storedStats === "object" ? storedStats : null;
  }

  return Number.isFinite(Number(stats.health)) ? stats : null;
}

function renderMonsterAttributes(target, enemy) {
  if (!target) return;

  const stats = getMonsterStatsForEnemy(enemy, enemy.elite);
  const attributes = Array.isArray(stats?.attributes) ? stats.attributes : [];
  const fragments = [];

  for (const attribute of attributes) {
    for (const parsed of parseMonsterAttributes(attribute)) {
      const icon = ATTRIBUTE_ICONS.get(parsed.name);
      if (!icon) continue;

      const span = document.createElement("span");
      span.className = "monster-attribute";
      span.textContent = parsed.value ? `${icon}${parsed.value}` : icon;
      fragments.push(span);
    }
  }

  target.replaceChildren(...fragments);
  target.hidden = fragments.length === 0;
}

function parseMonsterAttributes(attribute) {
  const value = String(attribute || "").trim();
  if (!value) return [];

  return value
    .split(/[;,]/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const match = item.match(/^([A-Za-z]+)(?:\s+(\d+))?$/);
      if (match) return { name: match[1], value: match[2] || "" };

      const spaceIndex = item.indexOf(" ");
      if (spaceIndex < 0) return { name: item, value: "" };
      return { name: item.slice(0, spaceIndex), value: item.slice(spaceIndex + 1).trim() };
    });
}

function getMonsterForEnemy(enemy) {
  if (!enemy) return null;

  if (enemy.monsterId) {
    const byId = state.monsterLibrary.find(monster => monster.id === enemy.monsterId);
    if (byId) return byId;
  }

  const baseName = stripEnemySuffix(enemy.nombre);
  if (!baseName) return null;

  return state.monsterByName.get(normalizeName(baseName)) || null;
}

function normalizeName(name) {
  return String(name).trim().toLocaleLowerCase("es");
}

function getEnemyGroupName(enemy) {
  return String(enemy?.groupName || stripEnemySuffix(enemy?.nombre) || enemy?.nombre || "Enemigo").trim();
}

function getEnemyGroupKey(enemy) {
  return normalizeName(getEnemyGroupName(enemy));
}

function getEnemyGroupTitle(enemy) {
  return getEnemyGroupName(enemy);
}

function isGroupCollapsed(groupKey) {
  return state.enemies.some(enemy => getEnemyGroupKey(enemy) === groupKey && Boolean(enemy.groupCollapsed));
}

function setGroupCollapsed(groupKey, collapsed) {
  state.enemies.forEach(enemy => {
    if (getEnemyGroupKey(enemy) === groupKey) enemy.groupCollapsed = Boolean(collapsed);
  });
}

function toggleEnemyGroupCollapse(groupKey) {
  const nextCollapsed = !isGroupCollapsed(groupKey);
  setGroupCollapsed(groupKey, nextCollapsed);
  renderList();
  saveEnemies();
}

function getOrdinalLabel(ordinal) {
  return toCircledNumber(ordinal);
}

function normalizeEnemyOrdinals(enemies) {
  const nextByGroup = new Map();

  enemies.forEach(enemy => {
    const groupKey = getEnemyGroupKey(enemy);
    const current = nextByGroup.get(groupKey) || 0;
    const ordinal = Number.isFinite(toInt(enemy.groupOrdinal, NaN))
      ? Math.max(1, toInt(enemy.groupOrdinal, 1))
      : current + 1;
    enemy.groupOrdinal = ordinal;
    enemy.ordinal = ordinal;
    nextByGroup.set(groupKey, ordinal);
  });
}

function toCircledNumber(value) {
  const circled = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳"];
  const number = Math.max(1, toInt(value, 1));
  return circled[number - 1] || String(number);
}

function stripEnemySuffix(name) {
  return String(name).replace(/\s+\d+$/, "").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function markDragTarget(node) {
  document.querySelectorAll(".drag-over").forEach(item => item.classList.remove("drag-over"));
  node.classList.add("drag-over");
}

function clearDragState() {
  state.pointerDragId = null;
  state.nativeDragId = null;
  document.querySelectorAll(".dragging, .drag-over").forEach(item => {
    item.classList.remove("dragging", "drag-over");
  });
}

function showDeleteUndoSnackbar(enemySnapshot, index) {
  if (!enemySnapshot) return;

  elements.snackbarMessage.textContent = `${enemySnapshot.nombre} eliminado`;
  elements.snackbarUndo.dataset.id = enemySnapshot.id;
  elements.snackbar.classList.add("visible");

  const timer = window.setTimeout(() => {
    if (state.deleteUndo?.enemy?.id !== enemySnapshot.id) return;
    hideDeleteUndoSnackbar();
  }, 3000);

  state.deleteUndo = {
    enemy: enemySnapshot,
    index,
    timer
  };
}

function undoDeleteEnemy() {
  const pending = state.deleteUndo;
  if (!pending) return;

  clearTimeout(pending.timer);
  const index = clamp(pending.index, 0, state.enemies.length);
  state.enemies.splice(index, 0, cloneEnemy(pending.enemy));
  hideDeleteUndoSnackbar();
  renderList();
  saveEnemies();
}

function hideDeleteUndoSnackbar() {
  if (state.deleteUndo?.timer) {
    clearTimeout(state.deleteUndo.timer);
  }
  state.deleteUndo = null;
  elements.snackbar.classList.remove("visible");
  elements.snackbarUndo.dataset.id = "";
  elements.snackbarMessage.textContent = "";
}

function cloneEnemy(enemy) {
  if (typeof structuredClone === "function") {
    return structuredClone(enemy);
  }
  return JSON.parse(JSON.stringify(enemy));
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch {
    console.warn("No se pudo activar la pantalla completa.");
  }
}
