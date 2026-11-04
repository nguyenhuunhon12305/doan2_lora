function showToast(type, message) {
  const toast = document.createElement("div");
  toast.className = `alert alert-${type} position-fixed top-0 end-0 m-3 shadow`;
  toast.style.zIndex = "9999";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function formatDateTimeLocal(date) {
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function setDefaultHistoryTimes() {
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 3600 * 1000);
  document.getElementById("startDateTime").value = formatDateTimeLocal(start);
  document.getElementById("endDateTime").value = formatDateTimeLocal(end);
}

function setDefaultCustomTimes() {
  const end = new Date();
  const start = new Date(end.getTime() - 3 * 3600 * 1000);
  document.getElementById("customStart").value = formatDateTimeLocal(start);
  document.getElementById("customEnd").value = formatDateTimeLocal(end);
}

function formatNumber(value, digits = 1, fallback = "--") {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : fallback;
}

function linkQualityLabel(pdr) {
  if (!Number.isFinite(pdr)) return "--";
  if (pdr >= 95) return "Ổn định";
  if (pdr >= 80) return "Trung bình";
  return "Kém ổn định";
}
