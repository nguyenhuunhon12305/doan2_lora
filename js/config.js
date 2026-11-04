// config.js - Cấu hình Firebase cho dashboard đo chất lượng liên kết LoRa.

const DEFAULT_FIREBASE_HOST = "https://smart-air-system-132aa-default-rtdb.firebaseio.com/";
const DEFAULT_FIREBASE_AUTH = "";
const DEFAULT_FIREBASE_PATH = "lora_monitor";

let firebaseHost = DEFAULT_FIREBASE_HOST;
let firebaseAuth = DEFAULT_FIREBASE_AUTH;
let firebasePath = DEFAULT_FIREBASE_PATH;

function loadConfigFromStorage() {
  const storedHost = localStorage.getItem("firebaseHost");
  const storedAuth = localStorage.getItem("firebaseAuth");
  const storedPath = localStorage.getItem("firebasePath");
  if (storedHost) firebaseHost = storedHost;
  if (storedAuth !== null) firebaseAuth = storedAuth;
  if (storedPath) firebasePath = storedPath;
}

function saveConfig() {
  const host = document.getElementById("firebaseHost").value.trim();
  const auth = document.getElementById("firebaseAuth").value.trim();
  const path = document.getElementById("firebasePath").value.trim();
  if (!host) {
    showToast("warning", "Vui lòng nhập Firebase Host.");
    return false;
  }
  firebaseHost = host.endsWith("/") ? host : host + "/";
  firebaseAuth = auth;
  firebasePath = path || DEFAULT_FIREBASE_PATH;
  localStorage.setItem("firebaseHost", firebaseHost);
  localStorage.setItem("firebaseAuth", firebaseAuth);
  localStorage.setItem("firebasePath", firebasePath);
  return true;
}

function resetToDefaultConfig() {
  firebaseHost = DEFAULT_FIREBASE_HOST;
  firebaseAuth = DEFAULT_FIREBASE_AUTH;
  firebasePath = DEFAULT_FIREBASE_PATH;
  localStorage.setItem("firebaseHost", firebaseHost);
  localStorage.setItem("firebaseAuth", firebaseAuth);
  localStorage.setItem("firebasePath", firebasePath);
  document.getElementById("firebaseHost").value = firebaseHost;
  document.getElementById("firebaseAuth").value = firebaseAuth;
  document.getElementById("firebasePath").value = firebasePath;
  showToast("info", "Đã khôi phục cấu hình mặc định.");
}
