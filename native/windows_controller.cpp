#ifdef _WIN32

#ifndef NOMINMAX
#define NOMINMAX
#endif

#include "windows_controller.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <iomanip>
#include <sstream>
#include <windows.h>
#include <mmsystem.h>

namespace iinatan::windows_controller {
namespace {

constexpr DWORD kReturnAll = JOY_RETURNALL;
constexpr DWORD kPovCentered = 0xffff;

struct AxisRange {
  float minimum = 0.0f;
  float maximum = 65535.0f;
};

std::string json_escape(const std::string& value) {
  std::string result;
  result.reserve(value.size() + 16);
  for (const unsigned char character : value) {
    switch (character) {
      case '\\': result += "\\\\"; break;
      case '"': result += "\\\""; break;
      case '\n': result += "\\n"; break;
      case '\r': result += "\\r"; break;
      case '\t': result += "\\t"; break;
      default: result += static_cast<char>(character); break;
    }
  }
  return result;
}

std::string json_quote(const std::string& value) {
  return '"' + json_escape(value) + '"';
}

AxisRange axis_range(WORD minimum, WORD maximum) {
  if (maximum <= minimum) return {};
  return {static_cast<float>(minimum), static_cast<float>(maximum)};
}

float normalize_axis(DWORD value, AxisRange range) {
  const float midpoint = (range.minimum + range.maximum) * 0.5f;
  const float half_range = (range.maximum - range.minimum) * 0.5f;
  if (half_range <= 0.0f) return 0.0f;
  const float normalized = (static_cast<float>(value) - midpoint) / half_range;
  if (std::fabs(normalized) < 0.08f) return 0.0f;
  return std::max(-1.0f, std::min(1.0f, normalized));
}

void set_pov(Snapshot& snapshot, DWORD pov) {
  if (pov == kPovCentered) return;
  // JOYINFOEX reports POV in hundredths of a degree. Treat diagonal values as
  // both adjacent directions so the canonical button contract remains stable.
  const DWORD normalized = pov % 36000;
  const bool up = normalized <= 4500 || normalized >= 31500;
  const bool right = normalized >= 4500 && normalized <= 13500;
  const bool down = normalized >= 13500 && normalized <= 22500;
  const bool left = normalized >= 22500 && normalized <= 31500;
  snapshot.dpad_up = up;
  snapshot.dpad_right = right;
  snapshot.dpad_down = down;
  snapshot.dpad_left = left;
}

void set_button_bits(Snapshot& snapshot, DWORD buttons) {
  snapshot.primary = (buttons & (DWORD{1} << 0)) != 0;
  snapshot.back = (buttons & (DWORD{1} << 1)) != 0;
  snapshot.square = (buttons & (DWORD{1} << 2)) != 0;
  snapshot.audio = (buttons & (DWORD{1} << 3)) != 0;
  snapshot.left_shoulder = (buttons & (DWORD{1} << 4)) != 0;
  snapshot.right_shoulder = (buttons & (DWORD{1} << 5)) != 0;
  snapshot.left_trigger = (buttons & (DWORD{1} << 6)) != 0;
  snapshot.right_trigger = (buttons & (DWORD{1} << 7)) != 0;
}

}  // namespace

Snapshot sample() {
  Snapshot snapshot;
  const UINT device_count = joyGetNumDevs();
  for (UINT index = 0; index < device_count; ++index) {
    JOYINFOEX info{};
    info.dwSize = sizeof(info);
    info.dwFlags = kReturnAll;
    if (joyGetPosEx(index, &info) != JOYERR_NOERROR) continue;
    JOYCAPS caps{};
    const bool has_caps =
        joyGetDevCaps(index, &caps, sizeof(caps)) == JOYERR_NOERROR;
    snapshot.connected = true;
    snapshot.device_index = index;
    snapshot.id = "winmm-joystick-" + std::to_string(index);
    set_button_bits(snapshot, info.dwButtons);
    set_pov(snapshot, info.dwPOV);
    // WinMM exposes the first two stick axes as X/Y and the next pair as
    // Z/R on DualSense and most DirectInput-compatible HID collections.
    snapshot.left_y = normalize_axis(
        info.dwYpos, has_caps ? axis_range(caps.wYmin, caps.wYmax) : AxisRange{});
    snapshot.right_x = normalize_axis(
        info.dwZpos, has_caps ? axis_range(caps.wZmin, caps.wZmax) : AxisRange{});
    snapshot.right_y = normalize_axis(
        info.dwRpos, has_caps ? axis_range(caps.wRmin, caps.wRmax) : AxisRange{});
    break;
  }
  return snapshot;
}

std::string capability_json() {
  return
      "{\"protocol\":1,\"source\":\"native-hid\",\"enabled\":true,"
      "\"products\":[\"gamepad\"],\"backend\":\"winmm-joystick\"}";
}

std::string snapshot_json(const Snapshot& snapshot) {
  static std::uint64_t sequence = 0;
  const auto updated_at = std::chrono::duration_cast<std::chrono::milliseconds>(
                              std::chrono::system_clock::now().time_since_epoch())
                              .count();
  std::ostringstream output;
  output << std::fixed << std::setprecision(4);
  output << "{\"protocol\":1,\"sequence\":" << ++sequence
         << ",\"updatedAt\":" << updated_at
         << ",\"source\":\"native-hid\",\"connected\":"
         << (snapshot.connected ? "true" : "false")
         << ",\"id\":" << json_quote(snapshot.id)
         << ",\"buttons\":{\"primary\":"
         << (snapshot.primary ? "true" : "false")
         << ",\"back\":" << (snapshot.back ? "true" : "false")
         << ",\"square\":" << (snapshot.square ? "true" : "false")
         << ",\"audio\":" << (snapshot.audio ? "true" : "false")
         << ",\"leftShoulder\":" << (snapshot.left_shoulder ? "true" : "false")
         << ",\"rightShoulder\":" << (snapshot.right_shoulder ? "true" : "false")
         << ",\"leftTrigger\":" << (snapshot.left_trigger ? "true" : "false")
         << ",\"rightTrigger\":" << (snapshot.right_trigger ? "true" : "false")
         << ",\"dpadUp\":" << (snapshot.dpad_up ? "true" : "false")
         << ",\"dpadDown\":" << (snapshot.dpad_down ? "true" : "false")
         << ",\"dpadLeft\":" << (snapshot.dpad_left ? "true" : "false")
         << ",\"dpadRight\":" << (snapshot.dpad_right ? "true" : "false")
         << "},\"axes\":{\"leftY\":" << snapshot.left_y
         << ",\"rightX\":" << snapshot.right_x
         << ",\"rightY\":" << snapshot.right_y << "}}\n";
  return output.str();
}

}  // namespace iinatan::windows_controller

#endif
