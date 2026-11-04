let currentHistoryData = [];
let currentSort = { column: "time", direction: "desc" };
let smoothingEnabled = false;
let currentChartMode = "3h";
let customStartTime = null;
let customEndTime = null;

function setChartMode(mode, start = null, end = null) {
  currentChartMode = mode;
  customStartTime = start;
  customEndTime = end;
}

function numberOrNaN(value) {
  if (value === "" || value === null || value === undefined) return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeTimestamp(record) {
  let timeMillis = numberOrNaN(record.timeMillis ?? record.epoch ?? record.unix);
  if (Number.isFinite(timeMillis)) {
    if (timeMillis < 100000000000) timeMillis *= 1000;
  } else {
    const raw = record.timestamp ?? record.time ?? record.datetime ?? "";
    timeMillis = raw ? new Date(String(raw).replace(" ", "T")).getTime() : NaN;
  }
  if (!Number.isFinite(timeMillis)) timeMillis = Date.now();
  const timestamp = record.timestamp || record.time || moment(timeMillis).format("YYYY-MM-DD HH:mm:ss");
  return { timestamp, timeMillis };
}

function normalizeRecord(record, key = "") {
  if (!record || typeof record !== "object") return null;

  const sent = numberOrNaN(record.packetsSent ?? record.sentCount ?? record.txCount ?? record.sent);
  const received = numberOrNaN(record.packetsReceived ?? record.receivedCount ?? record.rxCount ?? record.received);
  let pdr = numberOrNaN(record.pdr ?? record.PDR);
  let packetLoss = numberOrNaN(record.packetLoss ?? record.loss ?? record.packet_loss);

  if (!Number.isFinite(pdr) && Number.isFinite(sent) && sent > 0 && Number.isFinite(received)) {
    pdr = Math.max(0, Math.min(100, received / sent * 100));
  }
  if (!Number.isFinite(packetLoss) && Number.isFinite(pdr)) packetLoss = 100 - pdr;
  if (!Number.isFinite(pdr) && Number.isFinite(packetLoss)) pdr = 100 - packetLoss;

  const { timestamp, timeMillis } = normalizeTimestamp(record);
  return {
    id: key,
    nodeId: record.nodeId ?? record.node_id ?? record.node ?? "NODE_01",
    sequence: numberOrNaN(record.sequence ?? record.seq ?? record.packetId ?? record.packet_id),
    temperature: numberOrNaN(record.temperature ?? record.temp),
    humidity: numberOrNaN(record.humidity ?? record.humi),
    rssi: numberOrNaN(record.rssi ?? record.RSSI),
    snr: numberOrNaN(record.snr ?? record.SNR),
    pdr,
    packetLoss,
    packetsSent: sent,
    packetsReceived: received,
    distance: numberOrNaN(record.distance ?? record.distanceM ?? record.distance_m),
    sf: numberOrNaN(record.sf ?? record.spreadingFactor),
    bw: numberOrNaN(record.bw ?? record.bandwidth),
    cr: record.cr ?? record.codingRate ?? "",
    txPower: numberOrNaN(record.txPower ?? record.tx_power ?? record.power),
    frequency: numberOrNaN(record.frequency ?? record.freq),
    interval: numberOrNaN(record.interval ?? record.sendInterval ?? record.send_interval),
    status: record.status ?? record.linkStatus ?? "",
    timestamp,
    timeMillis
  };
}

function recordsFromFirebase(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((item, i) => normalizeRecord(item, String(i))).filter(Boolean);
  return Object.entries(raw).map(([key, value]) => normalizeRecord(value, key)).filter(Boolean);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function displayCurrent(record) {
  if (!record) return;
  setText("currentRssi", `${formatNumber(record.rssi, 1)} dBm`);
  setText("currentSnr", `${formatNumber(record.snr, 1)} dB`);
  setText("currentPdr", `${formatNumber(record.pdr, 1)} %`);
  setText("currentPacketLoss", `${formatNumber(record.packetLoss, 1)} %`);
  setText("currentNodeId", record.nodeId || "--");
  setText("currentSequence", Number.isFinite(record.sequence) ? record.sequence : "--");
  setText("currentDistance", `${formatNumber(record.distance, 0)} m`);
  setText("currentTemp", `${formatNumber(record.temperature, 1)} °C`);
  setText("currentHumidity", `${formatNumber(record.humidity, 1)} %`);
  setText("currentPackets", `${Number.isFinite(record.packetsSent) ? record.packetsSent : "--"} / ${Number.isFinite(record.packetsReceived) ? record.packetsReceived : "--"}`);
  setText("currentTimestamp", record.timestamp || "--");
  setText("currentLinkStatus", record.status || linkQualityLabel(record.pdr));
  const linkStatusEl = document.getElementById("currentLinkStatus");
  if (linkStatusEl) {
    linkStatusEl.classList.remove("quality-good", "quality-medium", "quality-poor");
    if (Number.isFinite(record.pdr)) {
      linkStatusEl.classList.add(record.pdr >= 95 ? "quality-good" : record.pdr >= 80 ? "quality-medium" : "quality-poor");
    }
  }
  setText("currentSf", Number.isFinite(record.sf) ? `SF${record.sf}` : "--");
  setText("currentBw", Number.isFinite(record.bw) ? `${record.bw} kHz` : "-- kHz");
  setText("currentCr", record.cr || "--");
  setText("currentTxPower", Number.isFinite(record.txPower) ? `${record.txPower} dBm` : "-- dBm");
  setText("currentFrequency", Number.isFinite(record.frequency) ? `${record.frequency} MHz` : "-- MHz");
  setText("currentInterval", Number.isFinite(record.interval) ? `${record.interval} ms` : "-- ms");
}

async function loadCurrentData(hours = 3) {
  setChartMode(hours === 6 ? "6h" : "3h");
  try {
    const current = await fetchCurrentData();
    if (current) displayCurrent(normalizeRecord(current));
    const end = Date.now();
    await loadDataForChart(end - hours * 3600 * 1000, end, false);
  } catch (error) {
    console.error("Lỗi tải dữ liệu hiện tại:", error);
    setConnectionLost();
  }
}

async function loadDataForChart(startTime, endTime, setCustom = false) {
  try {
    const raw = await fetchHistoryDataFromFirebase();
    let records = recordsFromFirebase(raw)
      .filter(r => r.timeMillis >= startTime && r.timeMillis <= endTime)
      .sort((a, b) => a.timeMillis - b.timeMillis);

    const labels = records.map(r => moment(r.timeMillis).format("DD/MM HH:mm"));
    let rssi = records.map(r => r.rssi);
    let snr = records.map(r => r.snr);
    let pdr = records.map(r => r.pdr);
    let loss = records.map(r => r.packetLoss);

    if (smoothingEnabled) {
      rssi = smoothArray(rssi);
      snr = smoothArray(snr);
      pdr = smoothArray(pdr);
      loss = smoothArray(loss);
    }
    renderCharts(labels, rssi, snr, pdr, loss);
    if (setCustom) setChartMode("custom", startTime, endTime);
  } catch (error) {
    console.error("Lỗi tải biểu đồ:", error);
  }
}

async function loadCustomRange() {
  const start = new Date(document.getElementById("customStart").value).getTime();
  const end = new Date(document.getElementById("customEnd").value).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    showToast("warning", "Khoảng thời gian không hợp lệ.");
    return;
  }
  await loadDataForChart(start, end, true);
}

async function loadHistoryData() {
  const start = new Date(document.getElementById("startDateTime").value).getTime();
  const end = new Date(document.getElementById("endDateTime").value).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    showToast("warning", "Khoảng thời gian không hợp lệ.");
    return;
  }
  try {
    const raw = await fetchHistoryDataFromFirebase();
    currentHistoryData = recordsFromFirebase(raw).filter(r => r.timeMillis >= start && r.timeMillis <= end);
    sortHistory(currentSort.column, currentSort.direction);
    updateHistorySummary();
  } catch (error) {
    console.error("Lỗi tải lịch sử:", error);
    showToast("danger", "Không tải được dữ liệu lịch sử.");
  }
}

function displayHistoryTable(records) {
  const tbody = document.getElementById("historyTableBody");
  if (!tbody) return;
  if (!records.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="text-center py-4 text-muted">Không có dữ liệu trong khoảng đã chọn.</td></tr>';
    return;
  }
  tbody.innerHTML = records.map(r => `
    <tr>
      <td>${moment(r.timeMillis).format("YYYY-MM-DD HH:mm:ss")}</td>
      <td>${r.nodeId || "--"}</td>
      <td>${Number.isFinite(r.sequence) ? r.sequence : "--"}</td>
      <td>${formatNumber(r.distance, 0)}</td>
      <td>${formatNumber(r.rssi, 1)}</td>
      <td>${formatNumber(r.snr, 1)}</td>
      <td>${formatNumber(r.pdr, 1)}</td>
      <td>${formatNumber(r.packetLoss, 1)}</td>
      <td>${Number.isFinite(r.sf) ? `SF${r.sf}` : "--"}</td>
      <td>${Number.isFinite(r.bw) ? `${r.bw} kHz` : "--"}</td>
      <td>${r.cr || "--"}</td>
      <td>${Number.isFinite(r.txPower) ? `${r.txPower} dBm` : "--"}</td>
    </tr>`).join("");
}

function comparableValue(record, column) {
  const map = {
    time: record.timeMillis, nodeId: record.nodeId, sequence: record.sequence,
    distance: record.distance, rssi: record.rssi, snr: record.snr,
    pdr: record.pdr, packetLoss: record.packetLoss
  };
  return map[column];
}

function sortHistory(column, direction) {
  currentSort = { column, direction };
  currentHistoryData.sort((a, b) => {
    const av = comparableValue(a, column);
    const bv = comparableValue(b, column);
    if (typeof av === "string" || typeof bv === "string") {
      return direction === "asc" ? String(av ?? "").localeCompare(String(bv ?? "")) : String(bv ?? "").localeCompare(String(av ?? ""));
    }
    const aNum = Number.isFinite(av) ? av : -Infinity;
    const bNum = Number.isFinite(bv) ? bv : -Infinity;
    return direction === "asc" ? aNum - bNum : bNum - aNum;
  });
  displayHistoryTable(currentHistoryData);
  updateSortIcons(column, direction);
}

function initSortHandlers() {
  document.querySelectorAll("#historyTable th[data-sort-key]").forEach(th => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      const column = th.dataset.sortKey;
      const direction = currentSort.column === column && currentSort.direction === "asc" ? "desc" : "asc";
      sortHistory(column, direction);
    });
  });
}

function updateSortIcons(activeColumn, direction) {
  document.querySelectorAll("#historyTable th[data-sort-key]").forEach(th => {
    const icon = th.querySelector("i");
    if (!icon) return;
    icon.className = th.dataset.sortKey === activeColumn
      ? (direction === "asc" ? "fas fa-sort-up ms-1" : "fas fa-sort-down ms-1")
      : "fas fa-sort ms-1";
  });
}

function updateHistorySummary() {
  const el = document.getElementById("historySummary");
  if (!el) return;
  if (!currentHistoryData.length) {
    el.textContent = "Không có dữ liệu";
    return;
  }
  const validPdr = currentHistoryData.map(r => r.pdr).filter(Number.isFinite);
  const avgPdr = validPdr.length ? validPdr.reduce((a, b) => a + b, 0) / validPdr.length : NaN;
  el.textContent = `${currentHistoryData.length} bản ghi${Number.isFinite(avgPdr) ? ` • PDR trung bình ${avgPdr.toFixed(1)}%` : ""}`;
}

function exportToExcel() {
  if (!currentHistoryData.length) {
    showToast("warning", "Không có dữ liệu để xuất.");
    return;
  }
  const data = currentHistoryData.map(r => ({
    "Thời gian": moment(r.timeMillis).format("YYYY-MM-DD HH:mm:ss"),
    "Node ID": r.nodeId,
    "Sequence": Number.isFinite(r.sequence) ? r.sequence : "",
    "Khoảng cách (m)": Number.isFinite(r.distance) ? r.distance : "",
    "Nhiệt độ (°C)": Number.isFinite(r.temperature) ? r.temperature : "",
    "Độ ẩm (%)": Number.isFinite(r.humidity) ? r.humidity : "",
    "RSSI (dBm)": Number.isFinite(r.rssi) ? r.rssi : "",
    "SNR (dB)": Number.isFinite(r.snr) ? r.snr : "",
    "Gói gửi": Number.isFinite(r.packetsSent) ? r.packetsSent : "",
    "Gói nhận": Number.isFinite(r.packetsReceived) ? r.packetsReceived : "",
    "PDR (%)": Number.isFinite(r.pdr) ? r.pdr : "",
    "Packet Loss (%)": Number.isFinite(r.packetLoss) ? r.packetLoss : "",
    "SF": Number.isFinite(r.sf) ? r.sf : "",
    "BW (kHz)": Number.isFinite(r.bw) ? r.bw : "",
    "CR": r.cr,
    "TX Power (dBm)": Number.isFinite(r.txPower) ? r.txPower : "",
    "Frequency (MHz)": Number.isFinite(r.frequency) ? r.frequency : ""
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "LoRa measurements");
  XLSX.writeFile(wb, `lora_measurements_${moment().format("YYYYMMDD_HHmm")}.xlsx`);
}

async function loadControlSettings() {
  try {
    const c = await fetchControlData();
    if (!c) return;
    document.getElementById("nodeIdInput").value = c.nodeId ?? "NODE_01";
    document.getElementById("frequencyInput").value = c.frequency ?? 433;
    document.getElementById("sfSelect").value = String(c.sf ?? 7);
    document.getElementById("bwSelect").value = String(c.bw ?? 125);
    document.getElementById("crSelect").value = c.cr ?? "4/5";
    document.getElementById("txPowerInput").value = c.txPower ?? 17;
    document.getElementById("intervalInput").value = c.interval ?? 5000;
    document.getElementById("distanceInput").value = c.distance ?? 0;
  } catch (error) {
    console.warn("Chưa tải được cấu hình LoRa:", error);
  }
}

async function saveControlSettings() {
  const payload = {
    nodeId: document.getElementById("nodeIdInput").value.trim() || "NODE_01",
    frequency: Number(document.getElementById("frequencyInput").value),
    sf: Number(document.getElementById("sfSelect").value),
    bw: Number(document.getElementById("bwSelect").value),
    cr: document.getElementById("crSelect").value,
    txPower: Number(document.getElementById("txPowerInput").value),
    interval: Number(document.getElementById("intervalInput").value),
    distance: Number(document.getElementById("distanceInput").value),
    updatedAt: new Date().toISOString()
  };
  try {
    await updateControlData(payload);
    showToast("success", "Đã lưu cấu hình LoRa lên Firebase.");
  } catch (error) {
    setConnectionLost();
    showToast("danger", "Không thể lưu cấu hình LoRa.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadConfigFromStorage();
  document.getElementById("firebaseHost").value = firebaseHost;
  document.getElementById("firebaseAuth").value = firebaseAuth;
  document.getElementById("firebasePath").value = firebasePath;
  setDefaultHistoryTimes();
  setDefaultCustomTimes();

  document.getElementById("historyForm").addEventListener("submit", event => {
    event.preventDefault();
    loadHistoryData();
  });
  document.getElementById("configForm").addEventListener("submit", event => {
    event.preventDefault();
    if (saveConfig()) {
      showToast("success", "Đã lưu cấu hình Firebase.");
      loadCurrentData(3);
      loadControlSettings();
    }
  });
  document.getElementById("exportExcelBtn").addEventListener("click", exportToExcel);
  document.getElementById("smoothToggle").addEventListener("change", event => {
    smoothingEnabled = event.target.checked;
    if (currentChartMode === "custom" && customStartTime && customEndTime) {
      loadDataForChart(customStartTime, customEndTime, true);
    } else {
      loadCurrentData(currentChartMode === "6h" ? 6 : 3);
    }
  });

  initSortHandlers();
  loadCurrentData(3);
  loadControlSettings();

  setInterval(() => {
    const currentTab = document.getElementById("current-tab");
    if (!currentTab.classList.contains("active") || currentChartMode === "custom") return;
    loadCurrentData(currentChartMode === "6h" ? 6 : 3);
  }, 30000);
});
