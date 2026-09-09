#pragma once

#ifdef _WIN32

#include <string>

namespace iinatan::windows_controller {

struct Snapshot {
  bool connected = false;
  unsigned int device_index = 0;
  std::string id;
  bool primary = false;
  bool back = false;
  bool square = false;
  bool audio = false;
  bool left_shoulder = false;
  bool right_shoulder = false;
  bool left_trigger = false;
  bool right_trigger = false;
  bool dpad_up = false;
  bool dpad_down = false;
  bool dpad_left = false;
  bool dpad_right = false;
  float left_y = 0.0f;
  float right_x = 0.0f;
  float right_y = 0.0f;
};

// WinMM's legacy joystick facade is present on supported Windows desktop
// installations and exposes the same HID game-controller collection that the
// browser Gamepad API would otherwise need to discover after activation.
// Keep this adapter deliberately small: the rest of the application consumes
// the versioned native-HID snapshot contract.
Snapshot sample();
std::string capability_json();
std::string snapshot_json(const Snapshot& snapshot);

}  // namespace iinatan::windows_controller

#endif
