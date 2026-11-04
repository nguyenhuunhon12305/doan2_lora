// GATEWAY ESP32 + RA-01 -> Firebase RTDB -> existing web dashboard
// RX task has NO HTTP operations. The loop sends an atomic multi-path PATCH.
// Protocol from the companion Node: SID=XXXXXXXX,SEQ=0,T=28.45,H=65.20

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <LoRa.h>
#include <time.h>
#include <math.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>

// ------------------ SETTINGS TO EDIT ------------------
const char* WIFI_SSID = "DIEN_TEN_WIFI";
const char* WIFI_PASSWORD = "DIEN_MAT_KHAU";
const char* FIREBASE_HOST = "https://smart-air-system-132aa-default-rtdb.firebaseio.com";
const char* FIREBASE_AUTH = "";  // Supply a valid credential if Firebase rules require it.
const char* FIREBASE_PATH = "lora_monitor";
const char* NODE_ID = "NODE_01";
// ------- RSSI DISTANCE ESTIMATION (NOT A DISTANCE SENSOR) -------
// CALIBRATION STEP 1: Put TX and RX 1 m apart and record the mean RSSI
// from 20-30 received packets. Replace -45.0 with YOUR measured value.
constexpr float RSSI_AT_1M_DBM = -45.0f;  // EXAMPLE ONLY, not calibrated
// CALIBRATION STEP 2: Estimate propagation exponent using measurements
// at a second known distance, or start with 2.5 and tune against reality.
constexpr float PATH_LOSS_EXPONENT = 2.5f; // EXAMPLE ONLY
constexpr float RSSI_SMOOTHING_ALPHA = 0.25f; // 0..1, 1=no smoothing
constexpr bool DISTANCE_IS_CALIBRATED = false; // set true AFTER calibration
// For scientific experiments, record physically measured distance separately.
// ---------------------------------------------------------------
constexpr bool ENABLE_FIREBASE = true; // false = receive-only PDR diagnostic test
constexpr bool CLEAR_CURRENT_ON_GATEWAY_BOOT = false; // Keep last dashboard value on reboot

// Pinout from SoDoChan.docx
constexpr uint8_t PIN_LORA_SCK  = 18;
constexpr uint8_t PIN_LORA_MISO = 19;
constexpr uint8_t PIN_LORA_MOSI = 23;
constexpr uint8_t PIN_LORA_NSS  = 5;
constexpr uint8_t PIN_LORA_RST  = 14;
constexpr uint8_t PIN_LORA_DIO0 = 26;

// Must match Node (also change both boards together).
constexpr long LORA_FREQ_HZ       = 433000000L;
constexpr int LORA_SF             = 7;
constexpr long LORA_BW_HZ         = 125000L;
constexpr int LORA_CR_DENOMINATOR = 5;
constexpr int LORA_TX_POWER_DBM   = 17;  // Metadata of NODE TX power.
constexpr uint8_t LORA_SYNC_WORD  = 0x12;
constexpr uint32_t NODE_INTERVAL_MS = 2000;

// Queue stores packets safely while HTTPS is busy; still finite (see README).
struct RxFrame {
  char payload[96];
  int16_t rssi;
  float snr;
};

QueueHandle_t rxQueue = nullptr;
constexpr uint16_t RX_QUEUE_LENGTH = 80;
WiFiClientSecure tlsClient;

char activeSid[9] = "";
uint32_t highestSeq = 0;
uint32_t packetsReceived = 0;
bool sessionActive = false;
float smoothedRssiDbm = NAN;

float estimateDistanceFromRssi(int16_t rawRssiDbm) {
  // Exponential moving average reduces flicker from packet-to-packet RSSI noise.
  if (!isfinite(smoothedRssiDbm)) {
    smoothedRssiDbm = (float)rawRssiDbm;
  } else {
    smoothedRssiDbm = RSSI_SMOOTHING_ALPHA * (float)rawRssiDbm
                    + (1.0f - RSSI_SMOOTHING_ALPHA) * smoothedRssiDbm;
  }
  // Log-distance model: d = 10 ^ ((RSSI(1m)-RSSI(d))/(10*n)) meters.
  return powf(10.0f,
              (RSSI_AT_1M_DBM - smoothedRssiDbm) /
              (10.0f * PATH_LOSS_EXPONENT));
}

uint32_t nextWiFiAttemptAt = 0;
uint32_t nextUploadAttemptAt = 0;
bool pendingUpload = false;
bool bootClearAttempted = false;
String pendingJson;
String pendingHistoryKey;

void wifiTick() {
  if (WiFi.status() == WL_CONNECTED) return;
  if ((int32_t)(millis() - nextWiFiAttemptAt) < 0) return;
  nextWiFiAttemptAt = millis() + 10000;
  Serial.println("[WiFi] Connecting/reconnecting...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD); // Do not block LoRa RX.
}

String firebaseUrl(const char* suffix = "") {
  String url = String(FIREBASE_HOST) + "/" + FIREBASE_PATH;
  if (suffix && suffix[0]) url += String("/") + suffix;
  url += ".json";
  if (strlen(FIREBASE_AUTH)) url += String("?auth=") + FIREBASE_AUTH;
  return url;
}

bool firebaseRequest(const char* method, const char* suffix, const String& json) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.setConnectTimeout(3500);
  http.setTimeout(5000);
  if (!http.begin(tlsClient, firebaseUrl(suffix))) return false;
  http.addHeader("Content-Type", "application/json");
  int code = http.sendRequest(method, json);
  bool ok = code >= 200 && code < 300;
  if (!ok) Serial.printf("[Firebase] %s failed, HTTP=%d\n", method, code);
  http.end();
  return ok;
}

// Validate exactly SID=8 hex digits, SEQ=unsigned integer, T=float, H=float.
bool parsePayload(const char* p, char sid[9], uint32_t& seq, float& t, float& h) {
  char sidTmp[9] = {0};
  unsigned long value = 0;
  int consumed = -1;
  int found = sscanf(p, "SID=%8[0-9a-fA-F],SEQ=%lu,T=%f,H=%f%n",
                     sidTmp, &value, &t, &h, &consumed);
  if (found != 4 || consumed < 0 || (size_t)consumed != strlen(p)) return false;
  if (strlen(sidTmp) != 8 || !isfinite(t) || !isfinite(h)) return false;
  if (t < -40.0f || t > 125.0f || h < 0.0f || h > 100.0f) return false;
  for (int i = 0; i < 8; ++i) sid[i] = (char)toupper((unsigned char)sidTmp[i]);
  sid[8] = '\0';
  seq = (uint32_t)value;
  return true;
}

bool countNewPacket(const char* sid, uint32_t seq) {
  if (!sessionActive || strcmp(activeSid, sid) != 0) {
    strcpy(activeSid, sid);
    smoothedRssiDbm = NAN; // New session, new RSSI filter
    highestSeq = seq;
    packetsReceived = 1;
    sessionActive = true;
    Serial.printf("\n[SESSION NEW] SID=%s, first received SEQ=%lu\n",
                  activeSid, (unsigned long)seq);
    return true;
  }
  if (seq <= highestSeq) {
    Serial.printf("[SKIP] duplicate/out-of-order SEQ=%lu (highest=%lu)\n",
                  (unsigned long)seq, (unsigned long)highestSeq);
    return false;
  }
  highestSeq = seq;
  packetsReceived++;
  return true;
}

String makeRecord(const RxFrame& frame, const char* sid, uint32_t seq, float t, float h, float estimatedDistanceM) {
  // The count is exact up to the highest received SEQ, assuming Node starts at 0.
  // Trailing lost packets aren't detectable until another packet arrives.
  const uint64_t sent = (uint64_t)highestSeq + 1ULL;
  float pdr = sent > 0 ? (100.0 * (double)packetsReceived / (double)sent) : 0.0f;
  if (pdr > 100.0f) pdr = 100.0f;
  const float loss = 100.0f - pdr;
  const char* status = pdr >= 95.0f ? "LINK OK" : (pdr >= 80.0f ? "LINK WEAK" : "LINK POOR");

  String result;
  result.reserve(520);
  result += "{\"nodeId\":\""; result += NODE_ID; result += "\",";
  result += "\"sessionId\":\""; result += sid; result += "\",";
  result += "\"sequence\":"; result += String((unsigned long)seq); result += ",";
  result += "\"temperature\":"; result += String(t, 2); result += ",";
  result += "\"humidity\":"; result += String(h, 2); result += ",";
  result += "\"rssi\":"; result += String(frame.rssi); result += ",";
  result += "\"snr\":"; result += String(frame.snr, 2); result += ",";
  char sentBuf[24];
  snprintf(sentBuf, sizeof(sentBuf), "%llu", (unsigned long long)sent);
  result += "\"packetsSent\":"; result += sentBuf; result += ",";
  result += "\"packetsReceived\":"; result += String((unsigned long)packetsReceived); result += ",";
  result += "\"pdr\":"; result += String(pdr, 2); result += ",";
  result += "\"packetLoss\":"; result += String(loss, 2); result += ",";
  // 'distance' stays numeric to work with the EXISTING dashboard.
  // It is an RSSI estimate, NOT a physically measured distance.
  result += "\"distance\":"; result += String(estimatedDistanceM, 2); result += ",";
  result += "\"distanceMethod\":\"RSSI_ESTIMATE\",";
  result += "\"distanceCalibrated\":";
  result += DISTANCE_IS_CALIBRATED ? "true," : "false,";
  result += "\"rssiFiltered\":"; result += String(smoothedRssiDbm, 2); result += ",";
  result += "\"sf\":"; result += String(LORA_SF); result += ",";
  result += "\"bw\":"; result += String(LORA_BW_HZ / 1000); result += ",";
  result += "\"cr\":\"4/"; result += String(LORA_CR_DENOMINATOR); result += "\",";
  result += "\"txPower\":"; result += String(LORA_TX_POWER_DBM); result += ",";
  result += "\"frequency\":"; result += String(LORA_FREQ_HZ / 1000000); result += ",";
  result += "\"interval\":"; result += String((unsigned long)NODE_INTERVAL_MS); result += ",";
  result += "\"status\":\""; result += status; result += "\"";

  const time_t now = time(nullptr);
  if (now > 1600000000) {
    struct tm timeinfo;
    localtime_r(&now, &timeinfo);
    char stamp[24];
    strftime(stamp, sizeof(stamp), "%Y-%m-%d %H:%M:%S", &timeinfo);
    result += ",\"timestamp\":\""; result += stamp; result += "\"";
    result += ",\"timeMillis\":";
    char epochBuf[24];
    snprintf(epochBuf, sizeof(epochBuf), "%llu", (unsigned long long)now * 1000ULL);
    result += epochBuf;
  }
  result += "}";
  return result;
}

void prepareFrame(const RxFrame& frame) {
  char sid[9];
  uint32_t seq = 0;
  float t = NAN, h = NAN;
  if (!parsePayload(frame.payload, sid, seq, t, h)) {
    Serial.print("[RX INVALID] "); Serial.println(frame.payload);
    return;
  }
  if (!countNewPacket(sid, seq)) return;

  const uint64_t sent = (uint64_t)highestSeq + 1ULL;
  const float pdr = sent > 0 ? 100.0f * packetsReceived / (double)sent : 0.0f;
  Serial.printf("[RX] SID=%s SEQ=%lu RSSI=%d SNR=%.1f RX=%lu SENT~=%llu PDR=%.2f%% LOSS=%.2f%%\n",
                sid, (unsigned long)seq, frame.rssi, frame.snr,
                (unsigned long)packetsReceived, (unsigned long long)sent, pdr, 100.0f-pdr);

  const float estimatedDistanceM = estimateDistanceFromRssi(frame.rssi);
  Serial.printf("[DISTANCE ESTIMATE] raw RSSI=%d dBm, filtered=%.1f dBm, d~=%.2f m%s\n",
                frame.rssi, smoothedRssiDbm, estimatedDistanceM,
                DISTANCE_IS_CALIBRATED ? "" : " (NOT CALIBRATED)");
  pendingJson = makeRecord(frame, sid, seq, t, h, estimatedDistanceM);
  // No push key: retrying this PATCH writes the same history record, no duplicate.
  char key[50];
  snprintf(key, sizeof(key), "%s_%010lu", sid, (unsigned long)seq);
  pendingHistoryKey = key;
  pendingUpload = ENABLE_FIREBASE;
}

void radioRxTask(void* unused) {
  (void)unused;
  for (;;) {
    int packetSize = LoRa.parsePacket();
    if (packetSize > 0) {
      RxFrame frame = {};
      size_t n = 0;
      while (LoRa.available() > 0) {
        int b = LoRa.read();
        if (n + 1 < sizeof(frame.payload)) frame.payload[n++] = (char)b;
      }
      frame.payload[n] = '\0';
      frame.rssi = (int16_t)LoRa.packetRssi();
      frame.snr = LoRa.packetSnr();
      if (n == (size_t)packetSize && xQueueSend(rxQueue, &frame, 0) != pdTRUE) {
        Serial.println("[OVERFLOW] RX queue full: one valid radio packet not processed!");
      }
    }
    vTaskDelay(1); // Keeps receiver independent of blocking HTTPS calls.
  }
}

void setup() {
  Serial.begin(115200);
  delay(600);
  Serial.println("GATEWAY LoRa -> Firebase -> Web (session aware + RSSI distance estimate)");
  if (!DISTANCE_IS_CALIBRATED) {
    Serial.println("[WARN] Distance is an UNCALIBRATED RSSI estimate; NOT actual range.");
  }

  rxQueue = xQueueCreate(RX_QUEUE_LENGTH, sizeof(RxFrame));
  if (!rxQueue) { Serial.println("FATAL: RX queue allocation failed"); while (true) delay(1000); }

  SPI.begin(PIN_LORA_SCK, PIN_LORA_MISO, PIN_LORA_MOSI, PIN_LORA_NSS);
  LoRa.setPins(PIN_LORA_NSS, PIN_LORA_RST, PIN_LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ_HZ)) { Serial.println("FATAL: RA-01 failed"); while (true) delay(1000); }
  LoRa.setSpreadingFactor(LORA_SF);
  LoRa.setSignalBandwidth(LORA_BW_HZ);
  LoRa.setCodingRate4(LORA_CR_DENOMINATOR);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.enableCrc();

  // Core 1 also hosts Arduino loop (lower priority). No other task uses LoRa/SPI.
  BaseType_t taskOk = xTaskCreatePinnedToCore(radioRxTask, "LoRa_RX", 4096,
                                             nullptr, 3, nullptr, 1);
  if (taskOk != pdPASS) { Serial.println("FATAL: Cannot create LoRa RX task"); while (true) delay(1000); }
  Serial.println("LoRa receiver started. Start Node AFTER Gateway for SEQ=0 on screen.");

  if (ENABLE_FIREBASE) {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    wifiTick();
    configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");
    // PROTOTYPE ONLY: disables TLS certificate verification. See README.
    tlsClient.setInsecure();
  }
}

void loop() {
  if (ENABLE_FIREBASE) wifiTick();

  // Old current in Firebase is stale after reboot; clear it ONCE when connected.
  if (ENABLE_FIREBASE && CLEAR_CURRENT_ON_GATEWAY_BOOT && !bootClearAttempted &&
      WiFi.status() == WL_CONNECTED) {
    bootClearAttempted = true;
    firebaseRequest("PUT", "current", "null");
  }

  if (!pendingUpload) {
    RxFrame frame;
    if (xQueueReceive(rxQueue, &frame, 0) == pdTRUE) prepareFrame(frame);
  }

  if (pendingUpload && WiFi.status() == WL_CONNECTED &&
      (int32_t)(millis() - nextUploadAttemptAt) >= 0) {
    // Firebase REST PATCH supports slash-separated multi-path keys.
    // Update current and history/<sid_seq> in ONE request; preserve all other history.
    String body;
    body.reserve(pendingJson.length()*2 + 100);
    body += "{\"current\":"; body += pendingJson;
    body += ",\"history/"; body += pendingHistoryKey; body += "\":";
    body += pendingJson; body += "}";

    const uint32_t started = millis();
    bool ok = firebaseRequest("PATCH", "", body);
    Serial.printf("[Firebase] %s in %lu ms; queue=%u\n", ok?"OK":"FAIL",
                  (unsigned long)(millis()-started), (unsigned)uxQueueMessagesWaiting(rxQueue));
    if (ok) {
      pendingUpload = false;
      pendingJson = "";
      pendingHistoryKey = "";
      nextUploadAttemptAt = 0;
    } else {
      nextUploadAttemptAt = millis() + 3000; // Retry same record (idempotent key).
    }
  }
  delay(1);
}
