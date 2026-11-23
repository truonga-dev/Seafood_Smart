/*
 * =====================================================================
 *  SMART AQUACULTURE FARM  -  ESP32 + Wokwi + Firebase Realtime Database
 * ---------------------------------------------------------------------
 *  Cam bien : DS18B20 (nhiet do), pH, DO, do duc (bien tro mo phong),
 *             HC-SR04 (muc nuoc)
 *  Chap hanh: Relay may bom, Relay quat oxy, Servo cho an,
 *             Buzzer + LED canh bao, LCD 16x2 I2C
 *  Mang     : WiFi -> Firebase RTDB (REST API qua HTTPS)
 *
 *  Cay du lieu Firebase:
 *   /ponds/<POND_ID>/info        thong tin thiet bi
 *   /ponds/<POND_ID>/latest      so lieu moi nhat (ghi de moi 5 s)
 *   /ponds/<POND_ID>/history/*   lich su (them moi moi 20 s)
 *   /ponds/<POND_ID>/alerts/*    nhat ky canh bao
 *   /ponds/<POND_ID>/control     lenh tu App: mode, pump, aerator, feedNow
 *   /ponds/<POND_ID>/thresholds  nguong canh bao chinh tu App
 *
 *  Tu dong hoa chay LOCAL: mat mang van bom/sục oxy/canh bao binh thuong.
 * =====================================================================
 */
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <LiquidCrystal_I2C.h>
#include <ESP32Servo.h>
#include <time.h>
#include "config.h"

// ===================== Canh bao (bitmask) =====================
enum AlertBit : uint16_t {
  A_TEMP_HIGH = 1 << 0,
  A_TEMP_LOW  = 1 << 1,
  A_PH_LOW    = 1 << 2,
  A_PH_HIGH   = 1 << 3,
  A_DO_LOW    = 1 << 4,
  A_TURBID    = 1 << 5,
  A_LEVEL_LOW = 1 << 6,
  A_SENSOR    = 1 << 7
};
const char* const ALERT_TEXT[8] = {
  "Nhiệt độ nước quá cao", "Nhiệt độ nước quá thấp", "pH quá thấp", "pH quá cao",
  "Oxy hòa tan thấp", "Nước đục", "Mực nước thấp", "Lỗi cảm biến"
};

// ===================== Kieu du lieu =====================
struct Readings {
  float temp = 28.0f, ph = 7.0f, doMgL = 6.0f, turb = 20.0f;
  float distCm = 40.0f, levelPct = 75.0f;
};
struct Thresholds {
  float tempMin = DEF_TEMP_MIN, tempMax = DEF_TEMP_MAX;
  float phMin = DEF_PH_MIN, phMax = DEF_PH_MAX;
  float doOn = DEF_DO_ON, doOff = DEF_DO_OFF;
  float turbMax = DEF_TURB_MAX;
  float levelLow = DEF_LEVEL_LOW, levelHigh = DEF_LEVEL_HIGH;
};
struct Control {
  bool autoMode = true;
  bool pump = false;
  bool aerator = false;
};
struct Btn { uint8_t pin; bool last; unsigned long t; };

// ===================== Doi tuong toan cuc =====================
OneWire oneWire(PIN_DS18B20);
DallasTemperature ds18(&oneWire);
LiquidCrystal_I2C lcd(LCD_ADDR, 16, 2);
Servo feeder;
WiFiClientSecure secureClient;

Readings r;
Thresholds th;
Control ctl;
Btn btnFeed{PIN_BTN_FEED, HIGH, 0};
Btn btnMode{PIN_BTN_MODE, HIGH, 0};

bool pumpOn = false, aeratorOn = false;
bool sensorFault = false;
bool fbOk = false;
bool syncModeToCloud = false;
bool firebaseBootstrapPending = true;
// Keep the current app request consumed until Firebase confirms its reset.
bool feedResetPending = false;
uint16_t alertMask = 0, lastAlertMask = 0;
uint32_t feedCount = 0;
unsigned long lastFeedMs = 0;
uint8_t lcdPage = 0;

unsigned long tSensor = 0, tLcd = 0, tControl = 0, tLatest = 0, tHistory = 0;
unsigned long tThresh = 0, tWifi = 0, tBeep = 0, tAutoFeed = 0;

#if FIREBASE_AUTH_ENABLED
String firebaseIdToken;
String firebaseRefreshToken;
unsigned long firebaseTokenIssuedAt = 0;
unsigned long firebaseTokenLifetimeMs = 0;
unsigned long lastAuthAttempt = 0;
bool authAttempted = false;
const unsigned long AUTH_RETRY_MS = 30000UL;

String formEncode(const String& value) {
  const char* hex = "0123456789ABCDEF";
  String result;
  for (size_t i = 0; i < value.length(); i++) {
    unsigned char c = (unsigned char)value[i];
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~') {
      result += (char)c;
    } else {
      result += '%';
      result += hex[c >> 4];
      result += hex[c & 15];
    }
  }
  return result;
}

bool storeAuthTokens(const String& body, bool refresh) {
  JsonDocument doc;
  if (deserializeJson(doc, body)) return false;
  const char* id = refresh ? doc["id_token"] : doc["idToken"];
  const char* refreshToken = refresh ? doc["refresh_token"] : doc["refreshToken"];
  const char* expires = refresh ? doc["expires_in"] : doc["expiresIn"];
  if (!id || !*id || !refreshToken || !*refreshToken || !expires) return false;
  unsigned long seconds = strtoul(expires, nullptr, 10);
  if (seconds < 2 || seconds > 86400UL) return false;
  firebaseIdToken = id;
  firebaseRefreshToken = refreshToken;
  firebaseTokenIssuedAt = millis();
  firebaseTokenLifetimeMs = (seconds > 120 ? seconds - 60 : seconds / 2) * 1000UL;
  return true;
}

bool requestAuthToken(bool refresh) {
  String url = refresh
    ? "https://securetoken.googleapis.com/v1/token?key="
    : "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=";
  url += FIREBASE_WEB_API_KEY;
  String body;
  if (refresh) {
    body = "grant_type=refresh_token&refresh_token=" + formEncode(firebaseRefreshToken);
  } else {
    JsonDocument doc;
    doc["email"] = FIREBASE_DEVICE_EMAIL;
    doc["password"] = FIREBASE_DEVICE_PASSWORD;
    doc["returnSecureToken"] = true;
    serializeJson(doc, body);
  }
  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(secureClient, url)) return false;
  http.addHeader("Content-Type", refresh ? "application/x-www-form-urlencoded" : "application/json");
  int code = http.POST(body);
  String response = code >= 200 && code < 300 ? http.getString() : "";
  http.end();
  if (refresh && code == 400) firebaseRefreshToken = "";
  if (code < 200 || code >= 300) {
    Serial.printf("[AUTH] Firebase authentication failed, HTTP %d\n", code);
    return false;
  }
  return storeAuthTokens(response, refresh);
}

bool ensureFirebaseAuth() {
  if (firebaseIdToken.length() && millis() - firebaseTokenIssuedAt < firebaseTokenLifetimeMs) return true;
  if (authAttempted && millis() - lastAuthAttempt < AUTH_RETRY_MS) return false;
  authAttempted = true;
  lastAuthAttempt = millis();
  if (!strlen(FIREBASE_WEB_API_KEY) || !strlen(FIREBASE_DEVICE_EMAIL) ||
      !strlen(FIREBASE_DEVICE_PASSWORD) || !strlen(FIREBASE_TLS_ROOT_CA)) {
    Serial.println("[AUTH] Missing device credentials or TLS root CA");
    return false;
  }
  if (time(nullptr) < 1609459200) {
    Serial.println("[AUTH] Waiting for NTP before TLS authentication");
    return false;
  }
  bool refresh = firebaseRefreshToken.length() > 0;
  if (requestAuthToken(refresh)) {
    // Bootstrap may have run before NTP or authentication was ready.
    firebaseBootstrapPending = true;
    Serial.println("[AUTH] Firebase device authenticated");
    return true;
  }
  return false;
}
#endif

// ===================== Tien ich =====================
float adcAvg(uint8_t pin) {
  uint32_t sum = 0;
  for (int i = 0; i < 16; i++) sum += analogRead(pin);
  return sum / 16.0f;
}

float adcToRange(uint8_t pin, float maxVal) {
  return adcAvg(pin) / 4095.0f * maxVal;
}

float readDistanceCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  unsigned long us = pulseIn(PIN_ECHO, HIGH, 30000UL);
  if (us == 0) return -1.0f;
  return us * 0.0343f / 2.0f;
}

void setPump(bool on) {
  pumpOn = on;
  digitalWrite(PIN_RELAY_PUMP, on ? RELAY_ON_LEVEL : RELAY_OFF_LEVEL);
}
void setAerator(bool on) {
  aeratorOn = on;
  digitalWrite(PIN_RELAY_AER, on ? RELAY_ON_LEVEL : RELAY_OFF_LEVEL);
}

void lcdLine(uint8_t row, const char* s) {
  char buf[17];
  snprintf(buf, sizeof(buf), "%-16s", s);
  lcd.setCursor(0, row);
  lcd.print(buf);
}

// ===================== Firebase REST =====================
// Tra ve ma HTTP (200..204 = OK), am neu loi mang.
int fbRequest(const char* method, const String& path, const String& body = "", String* out = nullptr) {
  if (WiFi.status() != WL_CONNECTED) return -1;

#if FIREBASE_AUTH_ENABLED
  if (!ensureFirebaseAuth()) return -3;
#endif
  String url = String(DATABASE_URL) + "/ponds/" + POND_ID + path + ".json";
  bool isGet = (strcmp(method, "GET") == 0);
  String q = "";
#if FIREBASE_AUTH_ENABLED
  q += String("auth=") + firebaseIdToken;
#else
  if (strlen(DATABASE_SECRET)) q += String("auth=") + DATABASE_SECRET;
#endif
  if (!isGet) {                       // ghi: khong can phan hoi, nhe hon
    if (q.length()) q += "&";
    q += "print=silent";
  }
  if (q.length()) url += "?" + q;

  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(secureClient, url)) return -2;
  http.addHeader("Content-Type", "application/json");

  int code = isGet ? http.GET() : http.sendRequest(method, body);
  if (out && code > 0) *out = http.getString();
  http.end();
#if FIREBASE_AUTH_ENABLED
  if (code == 401) {
    firebaseIdToken = "";
    authAttempted = false;
  }
#endif
  return code;
}

bool httpOk(int code) { return code >= 200 && code < 300; }

// ===================== Cam bien & canh bao =====================
void readSensors() {
  sensorFault = false;

  ds18.requestTemperatures();
  float t = ds18.getTempCByIndex(0);
  if (t == DEVICE_DISCONNECTED_C || t < -50.0f) sensorFault = true;
  else r.temp = t;

  r.ph    = adcToRange(PIN_PH, PH_RANGE_MAX);
  r.doMgL = adcToRange(PIN_DO, DO_RANGE_MAX);
  r.turb  = adcToRange(PIN_TURBIDITY, TURBIDITY_RANGE_MAX);

  float d = readDistanceCm();
  if (d < 0) {
    sensorFault = true;
  } else {
    r.distCm = d;
    float levelCm = constrain(TANK_SENSOR_HEIGHT_CM - d, 0.0f, TANK_MAX_WATER_CM);
    r.levelPct = levelCm / TANK_MAX_WATER_CM * 100.0f;
  }
}

void evaluateAlerts() {
  uint16_t m = 0;
  if (r.temp > th.tempMax) m |= A_TEMP_HIGH;
  if (r.temp < th.tempMin) m |= A_TEMP_LOW;
  if (r.ph < th.phMin)     m |= A_PH_LOW;
  if (r.ph > th.phMax)     m |= A_PH_HIGH;
  if (r.doMgL < th.doOn - 1.0f) m |= A_DO_LOW;   // DO nguy hiem: thap hon nguong bat quat 1 mg/L
  if (r.turb > th.turbMax) m |= A_TURBID;
  if (r.levelPct < th.levelLow) m |= A_LEVEL_LOW;
  if (sensorFault) m |= A_SENSOR;
  alertMask = m;
}

// ===================== Dieu khien thiet bi =====================
void applyOutputs() {
  bool wantPump = pumpOn, wantAer = aeratorOn;

  if (ctl.autoMode) {
    // May bom cap nuoc: hysteresis theo muc nuoc
    if (r.levelPct < th.levelLow) wantPump = true;
    else if (r.levelPct > th.levelHigh) wantPump = false;

    // Quat oxy: bat khi DO thap hoac nuoc qua nong
    if (r.doMgL < th.doOn || r.temp > th.tempMax) wantAer = true;
    else if (r.doMgL > th.doOff && r.temp <= th.tempMax - 0.5f) wantAer = false;
  } else {
    wantPump = ctl.pump;
    wantAer  = ctl.aerator;
  }

  // An toan: chong tran be, luon uu tien hon moi lenh
  if (r.levelPct >= 98.0f) wantPump = false;

  if (wantPump != pumpOn) setPump(wantPump);
  if (wantAer != aeratorOn) setAerator(wantAer);
}

void feedFish(const char* source) {
  Serial.printf("[FEED] source=%s\n", source);
  if (r.doMgL < th.doOn - 1.0f) {
    Serial.println("[FEED] Tu choi: oxy hoa tan qua thap");
    lcdLine(0, "Khong cho an");
    lcdLine(1, "Oxy qua thap");
    return;
  }
  lcdLine(0, "Dang cho an...");
  lcdLine(1, source);
  for (int i = 0; i < FEED_PULSES; i++) {
    feeder.write(FEED_OPEN_ANGLE);
    delay(450);
    feeder.write(FEED_CLOSE_ANGLE);
    delay(450);
  }
  feedCount++;
  lastFeedMs = millis();
  tAutoFeed = millis();
}

void updateAlarmOutputs(unsigned long now) {
  bool alarm = (alertMask != 0);
  digitalWrite(PIN_LED_OK, alarm ? LOW : HIGH);
  digitalWrite(PIN_LED_ALARM, alarm ? (((now / 300) % 2) ? HIGH : LOW) : LOW);
  if (alarm && now - tBeep >= 1500) {
    tBeep = now;
    tone(PIN_BUZZER, 2200, 200);
  }
}

void handleButtons() {
  bool s = digitalRead(btnFeed.pin);
  if (s != btnFeed.last && millis() - btnFeed.t > 50) {
    btnFeed.t = millis();
    btnFeed.last = s;
    if (s == LOW) feedFish("Nut bam");
  }
  s = digitalRead(btnMode.pin);
  if (s != btnMode.last && millis() - btnMode.t > 50) {
    btnMode.t = millis();
    btnMode.last = s;
    if (s == LOW) {
      ctl.autoMode = !ctl.autoMode;
      if (!ctl.autoMode) { ctl.pump = pumpOn; ctl.aerator = aeratorOn; }
      syncModeToCloud = true;
      Serial.printf("[MODE] %s (nut bam)\n", ctl.autoMode ? "AUTO" : "MANUAL");
    }
  }
}

// ===================== LCD =====================
void updateLcd() {
  char b[24];
  switch (lcdPage) {
    case 0:
      snprintf(b, sizeof(b), "T:%4.1fC pH:%4.1f", r.temp, r.ph);
      lcdLine(0, b);
      snprintf(b, sizeof(b), "DO:%4.1f Tu:%3.0f", r.doMgL, r.turb);
      lcdLine(1, b);
      break;
    case 1:
      snprintf(b, sizeof(b), "Muc nuoc: %3.0f%%", r.levelPct);
      lcdLine(0, b);
      snprintf(b, sizeof(b), "P:%s A:%s %s", pumpOn ? "ON " : "OFF", aeratorOn ? "ON " : "OFF",
               ctl.autoMode ? "AUTO" : "MAN");
      lcdLine(1, b);
      break;
    default:
      snprintf(b, sizeof(b), "WiFi:%s FB:%s", WiFi.status() == WL_CONNECTED ? "OK" : "--", fbOk ? "OK" : "--");
      lcdLine(0, b);
      if (alertMask) {
        snprintf(b, sizeof(b), "CANH BAO! (%d)", __builtin_popcount(alertMask));
      } else {
        snprintf(b, sizeof(b), "Binh thuong F:%lu", (unsigned long)feedCount);
      }
      lcdLine(1, b);
      break;
  }
  lcdPage = (lcdPage + 1) % 3;
}

// ===================== Payload JSON =====================
void fillTelemetry(JsonDocument& doc) {
  doc["temp"]       = roundf(r.temp * 10) / 10.0f;
  doc["ph"]         = roundf(r.ph * 100) / 100.0f;
  doc["do"]         = roundf(r.doMgL * 10) / 10.0f;
  doc["turbidity"]  = roundf(r.turb * 10) / 10.0f;
  doc["waterLevel"] = roundf(r.levelPct * 10) / 10.0f;
  doc["distance"]   = roundf(r.distCm * 10) / 10.0f;
  doc["pump"]       = pumpOn;
  doc["aerator"]    = aeratorOn;
  doc["mode"]       = ctl.autoMode ? "auto" : "manual";
  doc["status"]     = alertMask ? "warning" : "ok";
  doc["alertMask"]  = alertMask;
  JsonArray arr = doc["alerts"].to<JsonArray>();
  for (int i = 0; i < 8; i++) if (alertMask & (1 << i)) arr.add(ALERT_TEXT[i]);
  doc["feedCount"]  = feedCount;
  if (feedCount > 0) doc["lastFeedSecAgo"] = (millis() - lastFeedMs) / 1000;
  doc["rssi"]       = WiFi.RSSI();
  doc["uptime"]     = millis() / 1000;
  doc["ts"][".sv"]  = "timestamp";          // Firebase tu gan thoi gian server
}

bool pushLatest() {
  tLatest = millis();
  JsonDocument doc;
  fillTelemetry(doc);
  String body;
  serializeJson(doc, body);
  int c = fbRequest("PUT", "/latest", body);
  fbOk = httpOk(c);
  Serial.printf("[FB] PUT /latest -> %d\n", c);
  return fbOk;
}

bool pushHistory() {
  tHistory = millis();
  JsonDocument doc;
  fillTelemetry(doc);
  String body;
  serializeJson(doc, body);
  int c = fbRequest("POST", "/history", body);
  fbOk = httpOk(c);
  Serial.printf("[FB] POST /history -> %d\n", c);
  return fbOk;
}

void pushAlertIfNeeded() {
  uint16_t newBits = alertMask & ~lastAlertMask;
  if (newBits == 0) {                 // chi them canh bao moi, bo qua khi dang giam
    lastAlertMask = alertMask;
    return;
  }
  JsonDocument doc;
  JsonArray types = doc["types"].to<JsonArray>();
  String msg = "";
  for (int i = 0; i < 8; i++) {
    if (newBits & (1 << i)) {
      types.add(ALERT_TEXT[i]);
      if (msg.length()) msg += "; ";
      msg += ALERT_TEXT[i];
    }
  }
  doc["message"]    = msg;
  doc["temp"]       = roundf(r.temp * 10) / 10.0f;
  doc["ph"]         = roundf(r.ph * 100) / 100.0f;
  doc["do"]         = roundf(r.doMgL * 10) / 10.0f;
  doc["turbidity"]  = roundf(r.turb * 10) / 10.0f;
  doc["waterLevel"] = roundf(r.levelPct * 10) / 10.0f;
  doc["ts"][".sv"]  = "timestamp";
  String body;
  serializeJson(doc, body);
  int c = fbRequest("POST", "/alerts", body);
  Serial.printf("[FB] POST /alerts -> %d  (%s)\n", c, msg.c_str());
  if (httpOk(c)) lastAlertMask = alertMask;   // that bai thi thu lai o vong sau
}

// ===================== Doc lenh & nguong tu Firebase =====================
void pollControl() {
  tControl = millis();
  String body;
  int c = fbRequest("GET", "/control", "", &body);
  fbOk = httpOk(c);
  if (!fbOk || body == "null" || body.length() == 0) return;

  JsonDocument doc;
  if (deserializeJson(doc, body)) return;

  const char* mode = doc["mode"] | "auto";
  ctl.autoMode = (strcmp(mode, "manual") != 0);
  ctl.pump     = doc["pump"] | false;
  ctl.aerator  = doc["aerator"] | false;

  bool feedRequested = doc["feedNow"] | false;
  if (!feedRequested) {
    feedResetPending = false;
    return;
  }

  if (!feedResetPending) {
    feedResetPending = true;
    feedFish("App/Firebase");
  }

  int resetCode = fbRequest("PATCH", "/control", "{\"feedNow\":false}");
  if (httpOk(resetCode)) {
    feedResetPending = false;
  } else {
    Serial.printf("[FEED] Chua xoa duoc lenh, se thu lai: %d\n", resetCode);
  }
}

void pollThresholds() {
  tThresh = millis();
  String body;
  int c = fbRequest("GET", "/thresholds", "", &body);
  if (!httpOk(c) || body == "null" || body.length() == 0) return;
  JsonDocument doc;
  if (deserializeJson(doc, body)) return;
  th.tempMin   = doc["tempMin"]   | th.tempMin;
  th.tempMax   = doc["tempMax"]   | th.tempMax;
  th.phMin     = doc["phMin"]     | th.phMin;
  th.phMax     = doc["phMax"]     | th.phMax;
  th.doOn      = doc["doOn"]      | th.doOn;
  th.doOff     = doc["doOff"]     | th.doOff;
  th.turbMax   = doc["turbMax"]   | th.turbMax;
  th.levelLow  = doc["levelLow"]  | th.levelLow;
  th.levelHigh = doc["levelHigh"] | th.levelHigh;
  Serial.println("[FB] Da cap nhat nguong tu Firebase");
}

void syncModeNow() {
  JsonDocument doc;
  doc["mode"]    = ctl.autoMode ? "auto" : "manual";
  doc["pump"]    = ctl.pump;
  doc["aerator"] = ctl.aerator;
  String body;
  serializeJson(doc, body);
  if (httpOk(fbRequest("PATCH", "/control", body))) syncModeToCloud = false;
}

// Tao du lieu mac dinh neu database con trong
void bootstrapDatabase() {
  JsonDocument info;
  info["name"]     = POND_NAME;
  info["location"] = POND_LOCATION;
  info["firmware"] = FIRMWARE_VER;
  info["deviceId"] = WiFi.macAddress();
  String body;
  serializeJson(info, body);
  fbRequest("PATCH", "/info", body);

  String out;
  int c = fbRequest("GET", "/control", "", &out);
  if (httpOk(c) && out == "null") {
    fbRequest("PUT", "/control",
              "{\"mode\":\"auto\",\"pump\":false,\"aerator\":false,\"feedNow\":false}");
  }
  c = fbRequest("GET", "/thresholds", "", &out);
  if (httpOk(c) && out == "null") {
    JsonDocument t;
    t["tempMin"] = th.tempMin;   t["tempMax"] = th.tempMax;
    t["phMin"]   = th.phMin;     t["phMax"]   = th.phMax;
    t["doOn"]    = th.doOn;      t["doOff"]   = th.doOff;
    t["turbMax"] = th.turbMax;
    t["levelLow"] = th.levelLow; t["levelHigh"] = th.levelHigh;
    String tb;
    serializeJson(t, tb);
    fbRequest("PUT", "/thresholds", tb);
  }
}

// ===================== WiFi =====================
void onWifiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_CONNECTED:
      Serial.println("\n[WiFi] Da ket noi toi AP");
      break;
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      Serial.print("\n[WiFi] Da nhan IP: ");
      Serial.println(WiFi.localIP());
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      Serial.printf("\n[WiFi] Mat ket noi, ma ly do = %d\n", info.wifi_sta_disconnected.reason);
      break;
    default:
      break;
  }
}

void connectWifi() {
  lcdLine(0, "Ket noi WiFi...");
  lcdLine(1, WIFI_SSID);
  WiFi.onEvent(onWifiEvent);
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  Serial.printf("[WiFi] Dang ket noi \"%s\" kenh %d ...\n", WIFI_SSID, WIFI_CHANNEL);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD, WIFI_CHANNEL);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 30000UL) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.printf("[WiFi] status = %d (3 = da ket noi)\n", (int)WiFi.status());
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WiFi] IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("[WiFi] Khong ket noi duoc - chay che do OFFLINE");
  }
}

void maintainWifi(unsigned long now) {
  if (WiFi.status() == WL_CONNECTED) return;
  fbOk = false;
  firebaseBootstrapPending = true;
  if (now - tWifi >= WIFI_RETRY_MS) {
    tWifi = now;
    Serial.println("[WiFi] Dang cho tu dong ket noi lai...");
  }
}

// ===================== SETUP =====================
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== SMART AQUACULTURE FARM ===");

  pinMode(PIN_RELAY_PUMP, OUTPUT);
  pinMode(PIN_RELAY_AER, OUTPUT);
  setPump(false);
  setAerator(false);
  pinMode(PIN_LED_OK, OUTPUT);
  pinMode(PIN_LED_ALARM, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_BTN_FEED, INPUT_PULLUP);
  pinMode(PIN_BTN_MODE, INPUT_PULLUP);
  analogReadResolution(12);

  Wire.begin(PIN_SDA, PIN_SCL);
  lcd.init();
  lcd.backlight();
  lcdLine(0, "Smart Aquaculture");
  lcdLine(1, "Khoi dong...");

  ds18.begin();
  ds18.setResolution(10);

  ESP32PWM::allocateTimer(0);
  feeder.setPeriodHertz(50);
  feeder.attach(PIN_SERVO, 500, 2400);
  feeder.write(FEED_CLOSE_ANGLE);

  // Bao hieu khoi dong
  digitalWrite(PIN_LED_OK, HIGH);
  digitalWrite(PIN_LED_ALARM, HIGH);
  tone(PIN_BUZZER, 1800, 150);
  delay(400);

#if FIREBASE_AUTH_ENABLED
  // Verify TLS for every authenticated request. NTP supplies certificate time.
  secureClient.setCACert(FIREBASE_TLS_ROOT_CA);
#else
  secureClient.setInsecure();   // Demo only: TLS certificate validation disabled.
#endif
  connectWifi();
#if FIREBASE_AUTH_ENABLED
  configTime(0, 0, "pool.ntp.org", "time.google.com");
#endif

  readSensors();
  evaluateAlerts();

  unsigned long now = millis();
  tSensor = tLcd = tControl = tLatest = tHistory = tThresh = tAutoFeed = now;
}

// ===================== LOOP =====================
void loop() {
  unsigned long now = millis();

  handleButtons();

  // --- Doc cam bien + tu dong hoa (LOCAL, khong phu thuoc mang) ---
  if (now - tSensor >= SENSOR_INTERVAL_MS) {
    tSensor = now;
    readSensors();
    evaluateAlerts();
    applyOutputs();
    if (ctl.autoMode && now - tAutoFeed >= FEED_INTERVAL_MS && !(alertMask & A_DO_LOW)) {
      feedFish("Lich tu dong");   // khong cho an khi oxy qua thap
    }
  }

  updateAlarmOutputs(now);

  if (now - tLcd >= LCD_PAGE_MS) {
    tLcd = now;
    updateLcd();
  }

  // --- Dong bo Firebase ---
  maintainWifi(now);
  if (WiFi.status() == WL_CONNECTED) {
    if (firebaseBootstrapPending) {
      lcdLine(0, "Ket noi Firebase");
      lcdLine(1, "Dang khoi tao...");
      bootstrapDatabase();
      pollThresholds();
      if (syncModeToCloud) syncModeNow();
      if (!syncModeToCloud) pollControl();
      pushLatest();
      firebaseBootstrapPending = false;
      return;
    }
    if (syncModeToCloud) syncModeNow();
    else if (now - tControl >= CONTROL_POLL_MS) pollControl();

    if (alertMask != lastAlertMask) pushAlertIfNeeded();
    if (now - tLatest >= LATEST_INTERVAL_MS) pushLatest();
    if (now - tHistory >= HISTORY_INTERVAL_MS) pushHistory();
    if (now - tThresh >= THRESH_POLL_MS) pollThresholds();
  }
}
