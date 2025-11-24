// js/main.js
import { calculateDistance, formatTime } from "./utils.js";
import { initDB, savePathToDB, getPathFromDB, deleteOldPaths } from "./db.js";
import {
  initMapModule,
  updateMapMarker,
  drawPath,
  resetMapLine,
} from "./map.js";

// --- 全域變數 ---
let watchId, timerId;
let isRunning = false,
  hasLocation = false,
  isFirstRunPoint = true;
let totalDistance = 0,
  totalSeconds = 0,
  startTime = 0,
  wakeLock = null;
let currentLat = null,
  currentLng = null;
let lastLat = null,
  lastLng = null;
let pathCoordinates = [];
let rateProfiles = [],
  currentRate = {};
let historyMap = null,
  historyPolyline = null;

// 設定測試碼
const VALID_CODES = ["1234", "TEST"];
const STORAGE_KEY_ACTIVATED = "taxi_is_activated";

// --- 初始化 ---
async function init() {
  await initDB();
  console.log("檢查過期資料...");
  await cleanOldData();

  checkIfActivated();
  initMapModule("map");
  loadRateProfiles(); // 這裡會載入你的新費率
  loadHistory();
}

// 清理邏輯
async function cleanOldData() {
  const daysToKeep = 7;
  const deletedCount = await deleteOldPaths(daysToKeep);
  if (deletedCount > 0) console.log(`已清理 ${deletedCount} 筆過期資料`);

  let history = JSON.parse(localStorage.getItem("taxi_history")) || [];
  const now = Date.now();
  const oneWeekMs = daysToKeep * 24 * 60 * 60 * 1000;
  const newHistory = history.filter((item) => now - item.id < oneWeekMs);
  if (newHistory.length < history.length) {
    localStorage.setItem("taxi_history", JSON.stringify(newHistory));
  }
}

// --- 核心功能 ---
function startMeter() {
  if (!hasLocation || currentLat === null) return alert("尚未取得定位");

  currentRate = rateProfiles.find(
    (r) => r.id === parseInt(document.getElementById("rateSelect").value)
  );

  toggleUI(true);

  pathCoordinates = [];
  resetMapLine();
  totalDistance = 0;

  // 初始化起點
  pathCoordinates.push([currentLat, currentLng]);
  lastLat = currentLat;
  lastLng = currentLng;

  requestWakeLock();
  isRunning = true;
  isFirstRunPoint = false;
  startTime = Date.now();
  timerId = setInterval(updateDisplay, 1000);
}

function stopMeter() {
  isRunning = false;
  clearInterval(timerId);
  releaseWakeLock();
  toggleUI(false);
  updateDisplay();
  const p = calculatePrice();
  saveRecord(p);
  alert(`總金額: $${p}`);
}

// ★★★ 修改重點：顯示費率名稱 ★★★
function toggleUI(running) {
  const s = document.getElementById("settingsArea");
  const start = document.getElementById("startBtn");
  const stop = document.getElementById("stopBtn");
  const reset = document.getElementById("resetBtn");
  const status = document.getElementById("gpsStatus");
  const mult = document.getElementById("multiplier");

  if (running) {
    s.style.pointerEvents = "none";
    s.style.opacity = "0.5";
    start.style.display = "none";
    stop.style.display = "block";
    reset.disabled = true;
    // 修改這裡：加入 currentRate.name
    status.innerText = `🚕 ${currentRate.name} 計費中...`;
    status.className = "status-bar running";
  } else {
    stop.innerText = "已結束";
    stop.disabled = true;
    reset.disabled = false;
    mult.disabled = true;
    status.innerText = "🏁 行程結束";
  }
}

function startGPS() {
  if (!navigator.geolocation) return alert("無 GPS");
  watchId = navigator.geolocation.watchPosition(
    handlePositionUpdate,
    console.warn,
    { enableHighAccuracy: true }
  );
}

function handlePositionUpdate(pos) {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  currentLat = lat;
  currentLng = lng;

  if (!hasLocation) {
    hasLocation = true;
    document.getElementById("gpsStatus").innerText = "✅ GPS 已就緒";
    document.getElementById("gpsStatus").className = "status-bar ready";
    document.getElementById("startBtn").disabled = false;
    document.getElementById("startBtn").innerText = "開始計費";
    updateMapMarker(lat, lng, true);
    return;
  }

  updateMapMarker(lat, lng, isRunning);

  if (isRunning) {
    const dist = calculateDistance(lastLat, lastLng, lat, lng);
    if (dist * 1000 >= 3) {
      totalDistance += dist;
      lastLat = lat;
      lastLng = lng;
      pathCoordinates.push([lat, lng]);
      drawPath(pathCoordinates);
      updateDisplay();
    }
  }
}

function updateDisplay() {
  if (isRunning) totalSeconds = Math.floor((Date.now() - startTime) / 1000);
  document.getElementById("timeDisplay").innerText = formatTime(totalSeconds);
  document.getElementById("distDisplay").innerText = totalDistance.toFixed(2);
  document.getElementById("totalPrice").innerText = calculatePrice();
}

function calculatePrice() {
  const base =
    currentRate.base +
    totalDistance * currentRate.km +
    (totalSeconds / 60) * currentRate.min;
  return (
    base * (parseFloat(document.getElementById("multiplier").value) || 1)
  ).toFixed(2);
}

// --- 輔助功能 ---
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator)
      wakeLock = await navigator.wakeLock.request("screen");
  } catch (e) {}
}
function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

function checkIfActivated() {
  if (localStorage.getItem(STORAGE_KEY_ACTIVATED) === "true") {
    document.getElementById("lockScreen").style.display = "none";
    startGPS();
  } else document.getElementById("lockScreen").style.display = "flex";
}
function checkActivation() {
  if (
    VALID_CODES.includes(
      document.getElementById("activationCode").value.trim().toUpperCase()
    )
  ) {
    localStorage.setItem(STORAGE_KEY_ACTIVATED, "true");
    document.getElementById("lockScreen").style.display = "none";
    startGPS();
  } else {
    document.getElementById("errorMsg").style.display = "block";
  }
}

// ★★★ 修改重點：更新預設費率列表 ★★★
function loadRateProfiles() {
  // 先嘗試從 localStorage 讀取
  let storedRates = localStorage.getItem("taxi_rate_profiles");

  // 如果沒有存過，或者使用者想要強制更新預設值，我們就使用新的列表
  // 這裡我們設定：如果 local storage 是空的，就寫入這 8 組
  if (!storedRates) {
    rateProfiles = [
      { id: 1, name: "50/20/2", base: 50, km: 20, min: 2 },
      { id: 2, name: "70/20/2", base: 70, km: 20, min: 2 },
      { id: 3, name: "80/20/2", base: 80, km: 20, min: 2 },
      { id: 4, name: "85/25/3", base: 85, km: 25, min: 3 },
      { id: 5, name: "90/20/2", base: 90, km: 20, min: 2 },
      { id: 6, name: "100/20/2", base: 100, km: 20, min: 2 },
      { id: 7, name: "120/20/2", base: 120, km: 20, min: 2 },
      { id: 8, name: "130/20/2", base: 130, km: 20, min: 2 },
    ];
    saveRatesToStorage(); // 存入 localStorage
  } else {
    rateProfiles = JSON.parse(storedRates);
  }

  renderRateSelect();
  renderRateList();
}

function saveRatesToStorage() {
  localStorage.setItem("taxi_rate_profiles", JSON.stringify(rateProfiles));
}
function addNewRate() {
  const name = document.getElementById("newRateName").value;
  const base = parseFloat(document.getElementById("newRateBase").value);
  if (!name || isNaN(base)) return alert("請輸入完整資訊");
  rateProfiles.push({
    id: Date.now(),
    name,
    base,
    km: parseFloat(document.getElementById("newRateKm").value),
    min: parseFloat(document.getElementById("newRateMin").value),
  });
  saveRatesToStorage();
  renderRateSelect();
  renderRateList();
  document.getElementById("newRateName").value = "";
}
function deleteRate(id) {
  if (rateProfiles.length <= 1) return alert("最少保留一個");
  if (confirm("刪除?")) {
    rateProfiles = rateProfiles.filter((r) => r.id !== id);
    saveRatesToStorage();
    renderRateSelect();
    renderRateList();
  }
}
function renderRateSelect() {
  const sel = document.getElementById("rateSelect");
  sel.innerHTML = "";
  rateProfiles.forEach((r) => {
    sel.innerHTML += `<option value="${r.id}">${r.name}</option>`;
  });
}
function renderRateList() {
  const list = document.getElementById("rateListDisplay");
  list.innerHTML = "";
  rateProfiles.forEach(
    (r) =>
      (list.innerHTML += `<div class="rate-item"><div>${r.name}</div><div onclick="deleteRate(${r.id})" style="color:red;cursor:pointer">🗑️</div></div>`)
  );
}

function saveRecord(p) {
  const now = new Date();
  const recordId = now.getTime();
  const mult = document.getElementById("multiplier").value;
  const record = {
    id: recordId,
    t: now.toLocaleString("zh-TW", { hour12: false }),
    p: p,
    d: totalDistance.toFixed(2),
    du: document.getElementById("timeDisplay").innerText,
    r: currentRate.name + (mult != 1 ? ` (x${mult})` : ""),
    hasPath: true,
  };
  let h = JSON.parse(localStorage.getItem("taxi_history")) || [];
  h.unshift(record);
  localStorage.setItem("taxi_history", JSON.stringify(h));
  renderHistoryList(h);
  savePathToDB(recordId, pathCoordinates);
}
function loadHistory() {
  renderHistoryList(JSON.parse(localStorage.getItem("taxi_history")) || []);
}
function renderHistoryList(data) {
  const list = document.getElementById("historyList");
  list.innerHTML = "";
  if (data.length === 0) {
    list.innerHTML =
      "<li style='padding:10px;color:#999;text-align:center;'>無紀錄</li>";
    return;
  }
  data.forEach((i) => {
    const mapBtn = `<button class="btn-map-view" onclick="showRoute(${i.id})">🗺️ 查看路線</button>`;
    list.innerHTML += `<li class="history-item"><div class="h-top"><span style="font-weight:bold;">${
      i.t
    }<span class="h-tag">${i.r || "一般"}</span></span><div class="h-price">$${
      i.p
    }</div></div><div style="font-size:13px;color:#666;margin-bottom:5px;">距離: ${
      i.d
    } km | 時間: ${i.du}</div><div class="h-actions">${mapBtn}</div></li>`;
  });
}
function clearHistory() {
  if (confirm("清空所有紀錄？")) {
    localStorage.removeItem("taxi_history");
    deleteOldPaths(0);
    renderHistoryList([]);
  }
}

async function showRoute(id) {
  const history = JSON.parse(localStorage.getItem("taxi_history")) || [];
  const record = history.find((item) => item.id === id);
  if (!record) return;
  document.getElementById("routeModal").style.display = "flex";
  document.getElementById("routeModalInfo").innerText = "正在讀取...";
  try {
    const path = await getPathFromDB(id);
    document.getElementById(
      "routeModalInfo"
    ).innerHTML = `日期：${record.t}<br>耗時：${record.du}<br>車資：<span style="color:#e74c3c;font-weight:bold">$${record.p}</span><br>里程：${record.d} km`;
    setTimeout(() => {
      if (!historyMap) {
        historyMap = L.map("historyMapContainer").setView(
          [25.033, 121.5654],
          13
        );
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(
          historyMap
        );
      } else {
        historyMap.invalidateSize();
      }
      if (historyPolyline) historyMap.removeLayer(historyPolyline);
      if (path && path.length > 0) {
        historyPolyline = L.polyline(path, { color: "red", weight: 5 }).addTo(
          historyMap
        );
        if (path.length === 1) historyMap.setView(path[0], 17);
        else
          historyMap.fitBounds(historyPolyline.getBounds(), {
            padding: [20, 20],
          });
      } else {
        document.getElementById("routeModalInfo").innerHTML += "<br>(無路徑)";
      }
    }, 200);
  } catch (err) {
    alert("讀取失敗");
  }
}

window.startMeter = startMeter;
window.stopMeter = stopMeter;
window.resetMeter = () => location.reload();
window.checkActivation = checkActivation;
window.updateDisplay = updateDisplay;
window.addNewRate = addNewRate;
window.deleteRate = deleteRate;
window.openModal = (id) => (document.getElementById(id).style.display = "flex");
window.closeModal = (id) =>
  (document.getElementById(id).style.display = "none");
window.clearHistory = clearHistory;
window.showRoute = showRoute;

init();
