// plugins/8b8/shim/arduino_shim.h
//
// The Arduino and AVR surface the 8b8 firmware compiles against, for a
// freestanding WebAssembly build.
//
// It is the same idea as the 8bit8asterd emulator's own shim, and deliberately
// not a copy of it: that one is a host program and leans on std::string,
// std::deque and snprintf for its serial and MIDI queues. A JigDAW module is
// linked with no libc and no C++ runtime, because docs/module-abi.md requires
// it to instantiate with no imports, and because AGENTS.md forbids allocating
// inside process(). Every queue here is a fixed array sized at compile time.
//
// Only what the firmware actually touches is provided. Register writes never
// reach these pins: the firmware's AY_EMULATOR seam hands them to the chip
// model before any bus decoding happens.
#pragma once

#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdlib.h>

// ---------------------------------------------------------------------------
// PROGMEM. One address space here, so these are all no-ops.
// ---------------------------------------------------------------------------
#define PROGMEM
#define pgm_read_byte(addr)  (*(const uint8_t  *)(addr))
#define pgm_read_word(addr)  (*(const uint16_t *)(addr))
#define memcpy_P             memcpy
#define F(s)                 (s)

// ---------------------------------------------------------------------------
// Pins. The firmware resolves each pin to a port register and a bitmask once
// at startup, so a "port" here is one byte and the mask is always 1.
// ---------------------------------------------------------------------------
typedef uint8_t byte;

#define HIGH 1
#define LOW  0
#define OUTPUT 1
#define INPUT  0
#define INPUT_PULLUP 2

extern uint8_t emuPins[32];

inline uint8_t digitalPinToPort (uint8_t pin) { return pin; }
inline uint8_t digitalPinToBitMask (uint8_t) { return 1; }
inline volatile uint8_t *portOutputRegister (uint8_t port) { return &emuPins[port & 31]; }
inline void pinMode (uint8_t, uint8_t) {}
inline void digitalWrite (uint8_t pin, uint8_t v) { emuPins[pin & 31] = v ? 1 : 0; }
inline int digitalRead (uint8_t pin) { return emuPins[pin & 31]; }

static const uint8_t A0 = 18, A1 = 19, A2 = 20, A3 = 21, A4 = 22, A5 = 23;

template <typename T> T constrain (T v, T lo, T hi) { return v < lo ? lo : (v > hi ? hi : v); }

// ---------------------------------------------------------------------------
// Time. The module owns the clock and advances it as it renders, so the
// firmware's 100Hz tick and the Warp Zone's microsecond tick keep the
// behaviour they have on hardware.
// ---------------------------------------------------------------------------
extern uint64_t emuMicros;
inline unsigned long micros () { return (unsigned long)emuMicros; }
inline unsigned long millis () { return (unsigned long)(emuMicros / 1000ULL); }
inline void delay (unsigned long ms) { emuMicros += (uint64_t)ms * 1000ULL; }

// ---------------------------------------------------------------------------
// AVR registers. The firmware configures Timer1 for the 1MHz chip clock,
// which the chip model applies directly, so these only need somewhere to live.
// ---------------------------------------------------------------------------
extern uint8_t TCCR1A, TCCR1B, TCCR1C, TIMSK0, TIMSK1, SREG;
extern uint16_t OCR1A, TCNT1;
extern uint8_t OCR1AH, OCR1AL;
#define WGM10 0
#define WGM11 1
#define WGM12 3
#define WGM13 4
#define CS10  0
#define CS11  1
#define CS12  2
#define COM1A0 6
#define COM1A1 7
#define OCIE1A 1
inline void cli () {}
inline void sei () {}

// ---------------------------------------------------------------------------
// EEPROM. A plain array, never persisted.
//
// A plugin's state belongs in the project graph, which docs/project-format.md
// calls jig:ParameterSetting, so there is nothing for the firmware's SAVE
// command to write to and nothing for its loader to find. It reads 0xFF, fails
// its layout check, and boots on the generated defaults, which is exactly what
// a fresh board does.
// ---------------------------------------------------------------------------
extern uint8_t emuEeprom[1024];
struct EEPROMClass {
  uint8_t read (int a) { return emuEeprom[a & 1023]; }
  void write (int a, uint8_t v) { emuEeprom[a & 1023] = v; }
  void update (int a, uint8_t v) { if (emuEeprom[a & 1023] != v) emuEeprom[a & 1023] = v; }
};
extern EEPROMClass EEPROM;

// ---------------------------------------------------------------------------
// Serial. A sink, and the one place this shim differs from the emulator's in
// a way that matters.
//
// The firmware is built with DEBUG defined, so it prints a line for every MIDI
// message it receives, and with its parameter protocol always on, so it prints
// its whole layout at startup. Both would be a formatting call inside the
// audio callback. Discarding costs nothing and the compiler removes it.
//
// available() returning zero is what makes pollSerialControl() a no-op, so the
// serial command parser is present in the source and unreachable in this
// build. Parameters arrive through jig_set_param.
// ---------------------------------------------------------------------------
#define DEC 10
#define HEX 16

class NullSerial {
public:
  void begin (unsigned long) {}
  int available () { return 0; }
  int read () { return -1; }

  void print (const char *) {}
  void print (char) {}
  void print (int, int = DEC) {}
  void print (long, int = DEC) {}
  void print (unsigned, int = DEC) {}
  void print (unsigned long, int = DEC) {}
  void print (uint8_t, int = DEC) {}

  void println () {}
  void println (const char *) {}
  void println (char) {}
  template <typename T> void println (T, int = DEC) {}
};

extern NullSerial Serial;
extern NullSerial Serial1;
typedef NullSerial HardwareSerial;
