// firebase.js - Đọc/ghi Firebase theo cấu trúc <firebasePath>/{current,history,control}.

function buildFirebaseUrl(path) {
  const baseUrl = firebaseHost.replace(/\/$/, "");
  const cleanPath = path.replace(/^\/+/, "");
  let url = `${baseUrl}/${cleanPath}.json`;
  if (firebaseAuth && firebaseAuth.trim() !== "") {
    url += `?auth=${encodeURIComponent(firebaseAuth)}`;
  }
  return url;
}

async function fetchJson(path) {
  const response = await fetch(buildFirebaseUrl(path), { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  setConnectionOK();
  return await response.json();
}

async function patchJson(path, payload) {
  const response = await fetch(buildFirebaseUrl(path), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  setConnectionOK();
  return await response.json();
}

async function fetchCurrentData() { return fetchJson(`${firebasePath}/current`); }
async function fetchHistoryDataFromFirebase() { return fetchJson(`${firebasePath}/history`); }
async function fetchControlData() { return fetchJson(`${firebasePath}/control`); }
async function updateControlData(data) { return patchJson(`${firebasePath}/control`, data); }

async function testFirebaseConnection() {
  try {
    await fetchJson(firebasePath);
    showToast("success", "Kết nối Firebase thành công.");
  } catch (error) {
    setConnectionLost();
    showToast("danger", `Không kết nối được Firebase: ${error.message}`);
  }
}

function setConnectionOK() {
  const status = document.getElementById("connectionStatus");
  if (!status) return;
  status.innerHTML = '<i class="fas fa-plug me-1"></i>Firebase OK';
  status.className = "badge bg-success rounded-pill px-3 py-2";
}

function setConnectionLost() {
  const status = document.getElementById("connectionStatus");
  if (!status) return;
  status.innerHTML = '<i class="fas fa-triangle-exclamation me-1"></i>Mất kết nối';
  status.className = "badge bg-danger rounded-pill px-3 py-2";
}
