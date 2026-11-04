// NODE ESP32 + SHT30/SHT31 + RA-01 (SX1278, 433 MHz)
// Protocol: SID=XXXXXXXX,SEQ=0,T=28.45,H=65.20
// Each new session starts with SEQ=0. Press RESET on Node or send 'r' in Serial Monitor.

#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <LoRa.h>
#include <Adafruit_SHT31.h>
#include <math.h>

// Pinout matches SoDoChan.docx
constexpr uint8_t PIN_LORA_SCK  = 18;
constexpr uint8_t PIN_LORA_MISO = 19;
constexpr uint8_t PIN_LORA_MOSI = 23;
constexpr uint8_t PIN_LORA_NSS  = 5;
constexpr uint8_t PIN_LORA_RST  = 14;
constexpr uint8_t PIN_LORA_DIO0 = 26;
constexpr uint8_t PIN_I2C_SDA   = 21;
constexpr uint8_t PIN_I2C_SCL   = 22;

constexpr long LORA_FREQ_HZ        = 433000000L;
constexpr int LORA_SF              = 7;
constexpr long LORA_BW_HZ          = 125000L;
constexpr int LORA_CR_DENOMINATOR  = 5;  // 4/5
constexpr int LORA_TX_POWER_DBM    = 17;
constexpr uint8_t LORA_SYNC_WORD   = 0x12;
constexpr uint32_t SEND_INTERVAL_MS = 2000;

Adafruit_SHT31 sht = Adafruit_SHT31();
uint32_t sessionId = 0;
uint32_t nextSequence = 0;
uint32_t nextSendAt = 0;

void newSession() {
  sessionId = esp_random();  // New ID prevents mixing results after Node resets
  nextSequence = 0;
  nextSendAt = millis() + 1000;
  Serial.printf("\n[SESSION NEW] SID=%08lX; first SEQ=0\n", (unsigned long)sessionId);
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("NODE ESP32 -> LoRa 433 MHz");

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  if (!sht.begin(0x44)) {  // If your sensor uses address 0x45, change here.
    Serial.println("ERROR: SHT30 not detected at I2C 0x44.");
    while (true) delay(1000);
  }

  SPI.begin(PIN_LORA_SCK, PIN_LORA_MISO, PIN_LORA_MOSI, PIN_LORA_NSS);
  LoRa.setPins(PIN_LORA_NSS, PIN_LORA_RST, PIN_LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ_HZ)) {
    Serial.println("ERROR: RA-01 could not start.");
    while (true) delay(1000);
  }
  LoRa.setSpreadingFactor(LORA_SF);
  LoRa.setSignalBandwidth(LORA_BW_HZ);
  LoRa.setCodingRate4(LORA_CR_DENOMINATOR);
  LoRa.setTxPower(LORA_TX_POWER_DBM);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.enableCrc();  // Must be enabled on both sides.

  newSession();
  Serial.println("Type r + Send in Serial Monitor to start a NEW measurement session.");
}

void transmitMeasurement() {
  const float temperature = sht.readTemperature();
  const float humidity = sht.readHumidity();

  if (!isfinite(temperature) || !isfinite(humidity) || humidity < 0 || humidity > 100) {
    Serial.println("SHT30 invalid reading, skipping transmission (SEQ unchanged).");
    return;
  }

  char payload[96];
  int n = snprintf(payload, sizeof(payload),
                   "SID=%08lX,SEQ=%lu,T=%.2f,H=%.2f",
                   (unsigned long)sessionId,
                   (unsigned long)nextSequence,
                   temperature, humidity);
  if (n <= 0 || n >= (int)sizeof(payload)) {
    Serial.println("ERROR: payload too long.");
    return;
  }

  if (LoRa.beginPacket() != 1) {
    Serial.println("ERROR: cannot begin LoRa packet.");
    return;
  }
  LoRa.print(payload);
  int txResult = LoRa.endPacket();  // 1 means radio completed TX; NOT proof of reception.
  if (txResult == 1) {
    Serial.print("[TX] ");
    Serial.println(payload);
    nextSequence++;  // Count each completed RF transmission (no automatic retransmit).
  } else {
    Serial.println("ERROR: LoRa transmission failed.");
  }
}

void loop() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == 'r' || c == 'R') newSession();
  }

  const uint32_t now = millis();
  if ((int32_t)(now - nextSendAt) >= 0) {
    nextSendAt = now + SEND_INTERVAL_MS;
    transmitMeasurement();
  }
  delay(5);
}
