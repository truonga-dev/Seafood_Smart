#pragma once

// Wi-Fi for the Wokwi simulation.
#define WIFI_SSID "Wokwi-GUEST"
#define WIFI_PASSWORD ""
#define WIFI_CHANNEL 6

// Keep DATABASE_URL without a trailing slash. The firmware appends /ponds/.
#define DATABASE_URL "https://seafood-smart-default-rtdb.asia-southeast1.firebasedatabase.app"
#define DATABASE_SECRET ""

// Optional private settings. Never publish this file or use a real password in
// a publicly shared Wokwi project.
#if __has_include("auth_config.local.h")
#include "auth_config.local.h"
#endif

#ifndef FIREBASE_AUTH_ENABLED
#define FIREBASE_AUTH_ENABLED 0
#endif
#ifndef FIREBASE_WEB_API_KEY
#define FIREBASE_WEB_API_KEY ""
#endif
#ifndef FIREBASE_DEVICE_EMAIL
#define FIREBASE_DEVICE_EMAIL ""
#endif
#ifndef FIREBASE_DEVICE_PASSWORD
#define FIREBASE_DEVICE_PASSWORD ""
#endif
#ifndef FIREBASE_TLS_ROOT_CA
#define FIREBASE_TLS_ROOT_CA ""
#endif

#define POND_ID "pond01"
#define POND_NAME "Ao nuoi so 1"
#define POND_LOCATION "Da Nang, Viet Nam"
#define FIRMWARE_VER "1.0.0"

#define PIN_PH 34
#define PIN_DO 35
#define PIN_TURBIDITY 32
#define PIN_DS18B20 15
#define PIN_TRIG 5
#define PIN_ECHO 18
#define PIN_RELAY_PUMP 26
#define PIN_RELAY_AER 27
#define PIN_SERVO 13
#define PIN_BUZZER 25
#define PIN_LED_OK 33
#define PIN_LED_ALARM 14
#define PIN_BTN_FEED 4
#define PIN_BTN_MODE 16
#define PIN_SDA 21
#define PIN_SCL 22
#define LCD_ADDR 0x27

#define RELAY_ON_LEVEL HIGH
#define RELAY_OFF_LEVEL LOW

#define TANK_SENSOR_HEIGHT_CM 100.0f
#define TANK_MAX_WATER_CM 80.0f
#define PH_RANGE_MAX 14.0f
#define DO_RANGE_MAX 15.0f
#define TURBIDITY_RANGE_MAX 200.0f

#define SENSOR_INTERVAL_MS 1000UL
#define LCD_PAGE_MS 3000UL
#define CONTROL_POLL_MS 3000UL
#define LATEST_INTERVAL_MS 5000UL
#define HISTORY_INTERVAL_MS 20000UL
#define THRESH_POLL_MS 60000UL
#define WIFI_RETRY_MS 10000UL
#define HTTP_TIMEOUT_MS 5000UL
#define FEED_INTERVAL_MS 120000UL
#define FEED_PULSES 3
#define FEED_OPEN_ANGLE 90
#define FEED_CLOSE_ANGLE 0

#define DEF_TEMP_MIN 25.0f
#define DEF_TEMP_MAX 32.0f
#define DEF_PH_MIN 6.5f
#define DEF_PH_MAX 8.5f
#define DEF_DO_ON 5.0f
#define DEF_DO_OFF 6.5f
#define DEF_TURB_MAX 100.0f
#define DEF_LEVEL_LOW 30.0f
#define DEF_LEVEL_HIGH 85.0f
