"use strict";

const STORAGE_KEYS = {
    settings: "mrsToolsRouletteSettingsV1",
    equalSpacing: "mrsToolsRouletteEqualSpacingV1",
    history: "mrsToolsRouletteHistoryV1",
    currentResult: "mrsToolsRouletteCurrentResultV1"
};

const MIN_SEGMENTS = 2;
const MAX_SEGMENTS = 12;
const AUTO_STOP_MS = 10000;
const TAU = Math.PI * 2;
const POINTER_ANGLE = -Math.PI / 2;
const MAX_HISTORY = 100;

const SEGMENT_COLORS = [
    "#ef6a45",
    "#f3a33c",
    "#e0bf45",
    "#6db07f",
    "#46a9a6",
    "#438fb8",
    "#596fba",
    "#8065b4",
    "#a65b9d",
    "#c75e75",
    "#ba7448",
    "#758f58"
];

const DEFAULT_SEGMENTS = [
    { id: createId(), label: "項目1", weight: 1 },
    { id: createId(), label: "項目2", weight: 1 },
    { id: createId(), label: "項目3", weight: 1 },
    { id: createId(), label: "項目4", weight: 1 },
    { id: createId(), label: "項目5", weight: 1 },
    { id: createId(), label: "項目6", weight: 1 }
];

const canvas = document.getElementById("wheelCanvas");
const ctx = canvas.getContext("2d");
const wheelWrap = document.getElementById("wheelWrap");
const spinBtn = document.getElementById("spinBtn");
const settingsBtn = document.getElementById("settingsBtn");
const resultValue = document.getElementById("resultValue");
const historyList = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");

const settingsModal = document.getElementById("settingsModal");
const segmentList = document.getElementById("segmentList");
const segmentCount = document.getElementById("segmentCount");
const addSegmentBtn = document.getElementById("addSegmentBtn");
const equalSpacingToggle = document.getElementById("equalSpacingToggle");
const settingsError = document.getElementById("settingsError");
const settingsCancelBtn = document.getElementById("settingsCancelBtn");
const settingsSaveBtn = document.getElementById("settingsSaveBtn");

const confirmModal = document.getElementById("confirmModal");
const confirmCancelBtn = document.getElementById("confirmCancelBtn");
const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");

let segments = loadSegments();
let equalSpacing = loadBoolean(STORAGE_KEYS.equalSpacing, false);
let draftSegments = [];
let draftEqualSpacing = false;
let history = loadHistory();
let currentResult = loadCurrentResult();
let rotation = 0;
let spinState = "idle";
let animationFrameId = null;
let autoStopTimerId = null;
let lastFrameTime = 0;
let spinVelocity = 0;

initialize();

function initialize() {
    renderResult();
    renderHistory();
    resizeCanvas();
    bindEvents();

    if ("ResizeObserver" in window) {
        const observer = new ResizeObserver(resizeCanvas);
        observer.observe(wheelWrap);
    } else {
        window.addEventListener("resize", resizeCanvas);
    }
}

function bindEvents() {
    spinBtn.addEventListener("click", handleSpinButton);
    settingsBtn.addEventListener("click", openSettings);
    settingsCancelBtn.addEventListener("click", closeSettings);
    settingsSaveBtn.addEventListener("click", saveSettings);
    addSegmentBtn.addEventListener("click", addSegment);
    equalSpacingToggle.addEventListener("change", () => {
        draftEqualSpacing = equalSpacingToggle.checked;
        draftSegments = draftSegments.map(segment => ({
            ...segment,
            weight: isValidWeight(segment.weight) ? Number(segment.weight) : 1
        }));
        renderSettingsRows();
    });
    clearHistoryBtn.addEventListener("click", () => {
        if (history.length > 0) openModal(confirmModal);
    });
    confirmCancelBtn.addEventListener("click", () => closeModal(confirmModal));
    confirmDeleteBtn.addEventListener("click", clearAllHistory);

    settingsModal.addEventListener("click", event => {
        if (event.target === settingsModal) closeSettings();
    });
    confirmModal.addEventListener("click", event => {
        if (event.target === confirmModal) closeModal(confirmModal);
    });

    document.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;
        if (!confirmModal.hidden) closeModal(confirmModal);
        else if (!settingsModal.hidden) closeSettings();
    });
}

function resizeCanvas() {
    const rect = wheelWrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    drawWheel();
}

function drawWheel() {
    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.min(width, height) / dpr;
    const radius = size / 2 - 7;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(rotation);

    const totalWeight = getTotalWeight(segments, equalSpacing);
    let startAngle = 0;
    segments.forEach((segment, index) => {
        const sliceAngle = TAU * getSegmentWeight(segment, equalSpacing) / totalWeight;
        const endAngle = startAngle + sliceAngle;
        const color = SEGMENT_COLORS[index % SEGMENT_COLORS.length];

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, radius, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "rgba(255,255,255,0.82)";
        ctx.stroke();

        drawSegmentLabel(segment.label, startAngle + sliceAngle / 2, radius, sliceAngle, size);
        startAngle = endAngle;
    });

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#303030";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, Math.max(11, size * 0.037), 0, TAU);
    ctx.fillStyle = "#252525";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#5a5a5a";
    ctx.stroke();
    ctx.restore();
}

function drawSegmentLabel(label, angle, radius, sliceAngle, size) {
    ctx.save();
    ctx.rotate(angle);
    ctx.translate(radius * 0.62, 0);

    const segmentAngle = normalizeAngle(angle);
    if (segmentAngle > Math.PI / 2 && segmentAngle < Math.PI * 1.5) {
        ctx.rotate(Math.PI);
    }

    const availableArc = Math.max(28, radius * sliceAngle * 0.7);
    const maxWidth = Math.min(radius * 0.52, availableArc);
    const baseFontSize = Math.max(12, Math.min(18, size * 0.047));
    let fontSize = baseFontSize;
    const safeLabel = label.trim() || "未入力";

    ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif`;
    while (ctx.measureText(safeLabel).width > maxWidth && fontSize > 10) {
        fontSize -= 1;
        ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif`;
    }

    const fittedLabel = ellipsizeCanvasText(safeLabel, maxWidth);
    ctx.fillStyle = "#151515";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(fittedLabel, 0, 0);
    ctx.restore();
}

function ellipsizeCanvasText(text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;

    let shortened = text;
    while (shortened.length > 1 && ctx.measureText(`${shortened}…`).width > maxWidth) {
        shortened = shortened.slice(0, -1);
    }
    return `${shortened}…`;
}

function handleSpinButton() {
    if (spinState === "idle") startSpin();
    else if (spinState === "spinning") stopSpin();
}

function startSpin() {
    archiveCurrentResult();
    spinState = "spinning";
    spinVelocity = 0.011 + Math.random() * 0.0025;
    lastFrameTime = performance.now();
    updateSpinControls();
    resultValue.textContent = "回転中…";
    resultValue.classList.remove("has-result");

    autoStopTimerId = window.setTimeout(() => {
        if (spinState === "spinning") stopSpin();
    }, AUTO_STOP_MS);

    animationFrameId = requestAnimationFrame(animateContinuousSpin);
}

function animateContinuousSpin(now) {
    if (spinState !== "spinning") return;

    const deltaTime = Math.min(now - lastFrameTime, 40);
    lastFrameTime = now;
    rotation += spinVelocity * deltaTime;
    if (rotation > TAU * 1000) rotation %= TAU;
    drawWheel();
    animationFrameId = requestAnimationFrame(animateContinuousSpin);
}

function stopSpin() {
    if (spinState !== "spinning") return;

    spinState = "stopping";
    updateSpinControls();
    window.clearTimeout(autoStopTimerId);
    cancelAnimationFrame(animationFrameId);

    const landingAngle = Math.random() * TAU;
    const desiredRotation = normalizeAngle(POINTER_ANGLE - landingAngle);
    const currentNormalized = normalizeAngle(rotation);
    const alignmentDelta = normalizeAngle(desiredRotation - currentNormalized);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const extraTurns = reducedMotion ? 1 : 2;
    const travelDistance = alignmentDelta + TAU * extraTurns;
    const initialVelocity = spinVelocity;
    const duration = 2 * travelDistance / initialVelocity;
    const startRotation = rotation;
    const startTime = performance.now();

    function animateStop(now) {
        const elapsed = Math.min(now - startTime, duration);
        const deceleration = initialVelocity / duration;
        rotation = startRotation
            + initialVelocity * elapsed
            - deceleration * elapsed * elapsed / 2;
        drawWheel();

        if (elapsed < duration) {
            animationFrameId = requestAnimationFrame(animateStop);
            return;
        }

        rotation = normalizeAngle(startRotation + travelDistance);
        drawWheel();
        finishSpin();
    }

    animationFrameId = requestAnimationFrame(animateStop);
}

function finishSpin() {
    const selected = getSelectedSegment();
    currentResult = {
        id: createId(),
        label: selected.label,
        color: SEGMENT_COLORS[selected.index % SEGMENT_COLORS.length],
        timestamp: Date.now()
    };

    saveJson(STORAGE_KEYS.currentResult, currentResult);
    spinState = "idle";
    updateSpinControls();
    renderResult();
}

function getSelectedSegment() {
    const wheelAngleAtPointer = normalizeAngle(POINTER_ANGLE - rotation);
    const totalWeight = getTotalWeight(segments, equalSpacing);
    let cursor = 0;

    for (let index = 0; index < segments.length; index += 1) {
        cursor += TAU * getSegmentWeight(segments[index], equalSpacing) / totalWeight;
        if (wheelAngleAtPointer < cursor || index === segments.length - 1) {
            return { ...segments[index], index };
        }
    }

    return { ...segments[segments.length - 1], index: segments.length - 1 };
}

function updateSpinControls() {
    const isSpinning = spinState === "spinning";
    const isStopping = spinState === "stopping";
    spinBtn.classList.toggle("is-spinning", isSpinning || isStopping);
    spinBtn.classList.toggle("is-stopping", isStopping);
    spinBtn.setAttribute("aria-label", isSpinning ? "ルーレットをストップ" : isStopping ? "停止中" : "ルーレットをスタート");
    settingsBtn.disabled = spinState !== "idle";
}

function archiveCurrentResult() {
    if (!currentResult) return;

    history.unshift(currentResult);
    history = history.slice(0, MAX_HISTORY);
    currentResult = null;
    saveJson(STORAGE_KEYS.history, history);
    removeStoredValue(STORAGE_KEYS.currentResult);
    renderHistory();
}

function renderResult() {
    if (!currentResult || typeof currentResult.label !== "string") {
        resultValue.textContent = "STARTを押してください";
        resultValue.classList.remove("has-result");
        return;
    }

    resultValue.textContent = currentResult.label;
    resultValue.classList.add("has-result");
}

function renderHistory() {
    historyList.replaceChildren();
    clearHistoryBtn.disabled = history.length === 0;

    if (history.length === 0) {
        const empty = document.createElement("li");
        empty.className = "history-empty";
        empty.textContent = "まだ履歴がありません";
        historyList.append(empty);
        return;
    }

    history.forEach(item => {
        const row = document.createElement("li");
        row.className = "history-item";

        const marker = document.createElement("span");
        marker.className = "history-marker";
        marker.style.setProperty("--marker-color", sanitizeColor(item.color));
        marker.setAttribute("aria-hidden", "true");

        const main = document.createElement("div");
        main.className = "history-main";

        const value = document.createElement("span");
        value.className = "history-value";
        value.textContent = typeof item.label === "string" ? item.label : "不明な結果";

        const time = document.createElement("time");
        time.className = "history-time";
        time.dateTime = new Date(item.timestamp).toISOString();
        time.textContent = formatTimestamp(item.timestamp);

        const deleteButton = document.createElement("button");
        deleteButton.className = "delete-history-btn";
        deleteButton.type = "button";
        deleteButton.setAttribute("aria-label", `${value.textContent}を履歴から削除`);
        deleteButton.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M7 6V4.8C7 3.81 7.81 3 8.8 3h6.4c.99 0 1.8.81 1.8 1.8V6h3v2h-1.2l-.75 11.2A2 2 0 0 1 16.06 21H7.94a2 2 0 0 1-1.99-1.8L5.2 8H4V6h3Zm2 0h6V5H9v1Zm-1.8 2 .74 11h8.12l.74-11H7.2ZM10 10h1.5v7H10v-7Zm2.5 0H14v7h-1.5v-7Z"/></svg>`;
        deleteButton.addEventListener("click", () => deleteHistoryItem(item.id));

        main.append(value, time);
        row.append(marker, main, deleteButton);
        historyList.append(row);
    });
}

function deleteHistoryItem(id) {
    history = history.filter(item => item.id !== id);
    saveJson(STORAGE_KEYS.history, history);
    renderHistory();
}

function clearAllHistory() {
    history = [];
    saveJson(STORAGE_KEYS.history, history);
    renderHistory();
    closeModal(confirmModal);
}

function openSettings() {
    if (spinState !== "idle") return;
    draftSegments = segments.map(segment => ({ ...segment }));
    draftEqualSpacing = equalSpacing;
    equalSpacingToggle.checked = draftEqualSpacing;
    renderSettingsRows();
    openModal(settingsModal);
}

function closeSettings() {
    draftSegments = [];
    draftEqualSpacing = equalSpacing;
    closeModal(settingsModal);
}

function renderSettingsRows() {
    segmentList.replaceChildren();

    draftSegments.forEach((segment, index) => {
        const row = document.createElement("div");
        row.className = "segment-row";
        row.style.setProperty("--segment-color", SEGMENT_COLORS[index % SEGMENT_COLORS.length]);

        const nameWrap = document.createElement("div");
        nameWrap.className = "segment-name-wrap";

        const nameInput = document.createElement("input");
        nameInput.className = "segment-input segment-name";
        nameInput.type = "text";
        nameInput.value = segment.label;
        nameInput.maxLength = 30;
        nameInput.autocomplete = "off";
        nameInput.setAttribute("aria-label", `項目${index + 1}の内容`);
        nameInput.addEventListener("input", event => {
            segment.label = event.target.value;
            updateSettingsValidation();
        });
        nameWrap.append(nameInput);

        const weightInput = document.createElement("input");
        weightInput.className = "segment-input segment-weight";
        weightInput.type = "number";
        weightInput.inputMode = "numeric";
        weightInput.min = "1";
        weightInput.max = "999";
        weightInput.step = "1";
        weightInput.value = String(segment.weight);
        weightInput.disabled = draftEqualSpacing;
        weightInput.setAttribute("aria-label", `項目${index + 1}の比率`);
        weightInput.addEventListener("input", event => {
            const raw = event.target.value;
            segment.weight = raw === "" ? 0 : Number(raw);
            updateSettingsValidation();
        });

        const share = document.createElement("span");
        share.className = "segment-share";
        share.dataset.shareIndex = String(index);

        const removeButton = document.createElement("button");
        removeButton.className = "remove-segment-btn";
        removeButton.type = "button";
        removeButton.disabled = draftSegments.length <= MIN_SEGMENTS;
        removeButton.setAttribute("aria-label", `項目${index + 1}を削除`);
        removeButton.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M7 6V4.8C7 3.81 7.81 3 8.8 3h6.4c.99 0 1.8.81 1.8 1.8V6h3v2h-1.2l-.75 11.2A2 2 0 0 1 16.06 21H7.94a2 2 0 0 1-1.99-1.8L5.2 8H4V6h3Zm2 0h6V5H9v1Zm-1.8 2 .74 11h8.12l.74-11H7.2Z"/></svg>`;
        removeButton.addEventListener("click", () => removeSegment(segment.id));

        row.append(nameWrap, weightInput, share, removeButton);
        segmentList.append(row);
    });

    updateSettingsValidation();
}

function addSegment() {
    if (draftSegments.length >= MAX_SEGMENTS) return;

    const validWeights = draftSegments
        .map(segment => Number(segment.weight))
        .filter(isValidWeight);
    const averageWeight = validWeights.length > 0
        ? Math.max(1, Math.min(999, Math.round(validWeights.reduce((sum, value) => sum + value, 0) / validWeights.length)))
        : 1;

    draftSegments.push({
        id: createId(),
        label: `項目${draftSegments.length + 1}`,
        weight: averageWeight
    });
    renderSettingsRows();
    focusLastSegmentName();
}

function removeSegment(id) {
    if (draftSegments.length <= MIN_SEGMENTS) return;

    draftSegments = draftSegments.filter(segment => segment.id !== id);
    renderSettingsRows();
}

function focusLastSegmentName() {
    requestAnimationFrame(() => {
        const inputs = segmentList.querySelectorAll(".segment-name");
        const lastInput = inputs[inputs.length - 1];
        if (lastInput) {
            lastInput.focus({ preventScroll: true });
            lastInput.select();
        }
    });
}

function updateSettingsValidation() {
    const hasEmptyLabel = draftSegments.some(segment => !segment.label.trim());
    const hasInvalidWeight = draftSegments.some(segment => !isValidWeight(segment.weight));
    const isValid = !hasEmptyLabel && !hasInvalidWeight;

    segmentCount.textContent = String(draftSegments.length);
    equalSpacingToggle.checked = draftEqualSpacing;
    addSegmentBtn.disabled = draftSegments.length >= MAX_SEGMENTS;
    settingsSaveBtn.disabled = !isValid;
    updateShareDisplays();

    if (hasEmptyLabel) settingsError.textContent = "内容を入力してください";
    else if (hasInvalidWeight) settingsError.textContent = "比率は1〜999の整数で入力してください";
    else settingsError.textContent = "";
}

function updateShareDisplays() {
    const totalWeight = getTotalWeight(draftSegments, draftEqualSpacing);
    segmentList.querySelectorAll(".segment-share").forEach(element => {
        const index = Number(element.dataset.shareIndex);
        const segment = draftSegments[index];
        const share = segment
            ? getSegmentWeight(segment, draftEqualSpacing) / totalWeight * 100
            : 0;
        element.textContent = formatPercentage(share);
    });
}

function saveSettings() {
    updateSettingsValidation();
    if (settingsSaveBtn.disabled) return;

    const effectiveWeights = draftEqualSpacing
        ? draftSegments.map(() => 1)
        : draftSegments.map(segment => Number(segment.weight));
    const compatiblePercentages = scaleToTotal(effectiveWeights, 100);

    segments = draftSegments.map((segment, index) => ({
        id: segment.id,
        label: segment.label.trim(),
        weight: Number(segment.weight),
        percentage: compatiblePercentages[index]
    }));
    equalSpacing = draftEqualSpacing;
    saveJson(STORAGE_KEYS.settings, segments);
    saveJson(STORAGE_KEYS.equalSpacing, equalSpacing);
    rotation = 0;
    drawWheel();
    closeSettings();
}

function scaleToTotal(values, targetTotal) {
    if (values.length === 0) return [];

    const safeValues = values.map(value => Math.max(0, Number(value) || 0));
    const sourceTotal = safeValues.reduce((sum, value) => sum + value, 0);
    if (sourceTotal <= 0) {
        return distributeEvenly(values.length, targetTotal);
    }

    const exactValues = safeValues.map(value => value / sourceTotal * targetTotal);
    const result = exactValues.map(value => Math.max(1, Math.floor(value)));
    let difference = targetTotal - result.reduce((sum, value) => sum + value, 0);

    const order = exactValues
        .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
        .sort((a, b) => b.remainder - a.remainder);

    let cursor = 0;
    while (difference > 0) {
        result[order[cursor % order.length].index] += 1;
        difference -= 1;
        cursor += 1;
    }

    cursor = order.length - 1;
    while (difference < 0) {
        const targetIndex = order[cursor % order.length].index;
        if (result[targetIndex] > 1) {
            result[targetIndex] -= 1;
            difference += 1;
        }
        cursor = cursor > 0 ? cursor - 1 : order.length - 1;
    }

    return result;
}

function distributeEvenly(count, total) {
    const base = Math.floor(total / count);
    const remainder = total - base * count;
    return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function getSegmentWeight(segment, useEqualSpacing) {
    if (useEqualSpacing) return 1;
    const weight = Number(segment?.weight);
    return isValidWeight(weight) ? weight : 0;
}

function getTotalWeight(segmentItems, useEqualSpacing) {
    if (useEqualSpacing) return Math.max(1, segmentItems.length);
    const total = segmentItems.reduce((sum, segment) => (
        sum + getSegmentWeight(segment, false)
    ), 0);
    return total > 0 ? total : 1;
}

function isValidWeight(value) {
    const numericValue = Number(value);
    return Number.isInteger(numericValue) && numericValue >= 1 && numericValue <= 999;
}

function formatPercentage(value) {
    return `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(value)}%`;
}

function openModal(modal) {
    modal.hidden = false;
    document.body.style.overflow = "hidden";
}

function closeModal(modal) {
    modal.hidden = true;
    if (settingsModal.hidden && confirmModal.hidden) {
        document.body.style.overflow = "";
    }
}

function loadSegments() {
    const saved = loadArray(STORAGE_KEYS.settings);
    if (!isValidSegments(saved)) {
        return DEFAULT_SEGMENTS.map(segment => ({ ...segment }));
    }
    const weights = saved.map(segment => Number(segment.weight ?? segment.percentage));
    const compatiblePercentages = scaleToTotal(weights, 100);
    return saved.map((segment, index) => ({
        id: typeof segment.id === "string" ? segment.id : createId(),
        label: segment.label.trim(),
        weight: weights[index],
        percentage: compatiblePercentages[index]
    }));
}

function loadHistory() {
    return loadArray(STORAGE_KEYS.history)
        .filter(item => (
            item &&
            typeof item.id === "string" &&
            typeof item.label === "string" &&
            Number.isFinite(Number(item.timestamp))
        ))
        .slice(0, MAX_HISTORY)
        .map(item => ({
            id: item.id,
            label: item.label,
            color: sanitizeColor(item.color),
            timestamp: Number(item.timestamp)
        }));
}

function loadCurrentResult() {
    const value = loadObject(STORAGE_KEYS.currentResult);
    if (
        !value ||
        typeof value.id !== "string" ||
        typeof value.label !== "string" ||
        !Number.isFinite(Number(value.timestamp))
    ) {
        return null;
    }

    return {
        id: value.id,
        label: value.label,
        color: sanitizeColor(value.color),
        timestamp: Number(value.timestamp)
    };
}

function isValidSegments(value) {
    if (!Array.isArray(value) || value.length < MIN_SEGMENTS || value.length > MAX_SEGMENTS) return false;
    return value.every(segment => (
        segment &&
        typeof segment.label === "string" &&
        segment.label.trim() &&
        isValidWeight(segment.weight ?? segment.percentage)
    ));
}

function loadBoolean(key, fallback) {
    const value = loadJson(key);
    return typeof value === "boolean" ? value : fallback;
}

function loadArray(key) {
    const value = loadJson(key);
    return Array.isArray(value) ? value.filter(Boolean) : [];
}

function loadObject(key) {
    const value = loadJson(key);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function loadJson(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn(`保存データを読み込めませんでした: ${key}`, error);
        return null;
    }
}

function saveJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn(`データを保存できませんでした: ${key}`, error);
    }
}

function removeStoredValue(key) {
    try {
        localStorage.removeItem(key);
    } catch (error) {
        console.warn(`保存データを削除できませんでした: ${key}`, error);
    }
}

function normalizeAngle(angle) {
    return ((angle % TAU) + TAU) % TAU;
}

function createId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function sanitizeColor(color) {
    return typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color) ? color : SEGMENT_COLORS[0];
}

function formatTimestamp(timestamp) {
    const date = new Date(Number(timestamp));
    if (Number.isNaN(date.getTime())) return "日時不明";
    return new Intl.DateTimeFormat("ja-JP", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);
}
