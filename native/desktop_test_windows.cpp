#include "desktop_test.hpp"

#include "png_writer.hpp"

#define NOMINMAX
#include <windows.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <sstream>
#include <string>
#include <vector>

namespace iinatan::native {

namespace {

std::string json_escape(const std::string& value) {
  std::string escaped;
  escaped.reserve(value.size() + 8);
  for (const char character : value) {
    if (character == '\\' || character == '"') escaped.push_back('\\');
    if (character == '\n') escaped += "\\n";
    else if (character == '\r') escaped += "\\r";
    else escaped.push_back(character);
  }
  return escaped;
}

bool finite_point(double x, double y) {
  return std::isfinite(x) && std::isfinite(y);
}

std::string input_status(const char* operation) {
  std::ostringstream stream;
  stream << R"({"ok":true,"backend":"win32-test-input","operation":")"
         << operation
         << R"(","nativeInputReady":true,"permissionModel":"win32-sendinput"})";
  return stream.str();
}

bool set_pointer(double x, double y) {
  return SetCursorPos(static_cast<int>(std::lround(x)), static_cast<int>(std::lround(y))) != 0;
}

bool send_mouse(DWORD flags, DWORD data = 0) {
  INPUT input{};
  input.type = INPUT_MOUSE;
  input.mi.dwFlags = flags;
  input.mi.mouseData = data;
  return SendInput(1, &input, sizeof(input)) == 1;
}

WORD key_code(const std::string& key) {
  if (key == "escape") return VK_ESCAPE;
  if (key == "return") return VK_RETURN;
  if (key == "space") return VK_SPACE;
  if (key == "tab") return VK_TAB;
  return 0;
}

}  // namespace

std::string request_post_event_access() {
  return R"({"ok":true,"backend":"win32-test-input","operation":"request-post-event","nativeInputReady":true,"permissionModel":"win32-sendinput"})";
}

std::string capture_desktop(const std::string& output_path) {
  const int origin_x = GetSystemMetrics(SM_XVIRTUALSCREEN);
  const int origin_y = GetSystemMetrics(SM_YVIRTUALSCREEN);
  const int width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
  const int height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
  if (width <= 0 || height <= 0)
    return R"({"ok":false,"reason":"virtual-desktop-unavailable","backend":"win32"})";
  HDC screen = GetDC(nullptr);
  HDC memory = screen ? CreateCompatibleDC(screen) : nullptr;
  HBITMAP bitmap = memory ? CreateCompatibleBitmap(screen, width, height) : nullptr;
  if (!screen || !memory || !bitmap) {
    if (bitmap) DeleteObject(bitmap);
    if (memory) DeleteDC(memory);
    if (screen) ReleaseDC(nullptr, screen);
    return R"({"ok":false,"reason":"desktop-capture-allocation-failed","backend":"win32"})";
  }
  HGDIOBJ previous = SelectObject(memory, bitmap);
  const bool copied = BitBlt(memory, 0, 0, width, height, screen, origin_x, origin_y,
                             SRCCOPY | CAPTUREBLT) != 0;
  BITMAPINFO info{};
  info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  info.bmiHeader.biWidth = width;
  info.bmiHeader.biHeight = -height;
  info.bmiHeader.biPlanes = 1;
  info.bmiHeader.biBitCount = 32;
  info.bmiHeader.biCompression = BI_RGB;
  std::vector<unsigned char> bgra(static_cast<std::size_t>(width) * height * 4);
  SelectObject(memory, previous);
  const int rows = copied
                       ? GetDIBits(memory, bitmap, 0, static_cast<UINT>(height), bgra.data(),
                                   &info, DIB_RGB_COLORS)
                       : 0;
  DeleteObject(bitmap);
  DeleteDC(memory);
  ReleaseDC(nullptr, screen);
  if (rows != height)
    return R"({"ok":false,"reason":"desktop-capture-read-failed","backend":"win32"})";
  for (std::size_t offset = 0; offset < bgra.size(); offset += 4) {
    std::swap(bgra[offset], bgra[offset + 2]);
    bgra[offset + 3] = 255;
  }
  std::string error;
  if (!write_rgba_png(output_path, width, height, bgra.data(), bgra.size(), error))
    return "{\"ok\":false,\"reason\":\"" + json_escape(error) +
           "\",\"backend\":\"win32\"}";
  std::ostringstream stream;
  stream << R"({"ok":true,"backend":"win32","path":")" << json_escape(output_path)
         << R"(","origin":{"x":)" << origin_x << R"(,"y":)" << origin_y
         << R"(},"width":)" << width << R"(,"height":)" << height << "}";
  return stream.str();
}

std::string move_pointer(double x, double y) {
  if (!finite_point(x, y))
    return R"({"ok":false,"reason":"invalid-pointer-coordinate","backend":"win32"})";
  return set_pointer(x, y) ? input_status("move")
                            : R"({"ok":false,"reason":"win32-motion-failed","backend":"win32"})";
}

std::string click_pointer(double x, double y, int button) {
  if (!finite_point(x, y) || (button != 0 && button != 1))
    return R"({"ok":false,"reason":"invalid-click","backend":"win32"})";
  const DWORD down = button == 0 ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_RIGHTDOWN;
  const DWORD up = button == 0 ? MOUSEEVENTF_LEFTUP : MOUSEEVENTF_RIGHTUP;
  const bool succeeded = set_pointer(x, y) && send_mouse(down) && send_mouse(up);
  return succeeded ? input_status(button == 0 ? "left-click" : "right-click")
                   : R"({"ok":false,"reason":"win32-click-failed","backend":"win32"})";
}

std::string scroll_pointer(double x, double y, double delta_y) {
  if (!finite_point(x, y) || !std::isfinite(delta_y) || delta_y == 0)
    return R"({"ok":false,"reason":"invalid-scroll","backend":"win32"})";
  const LONG amount = static_cast<LONG>(std::clamp(
      std::lround(delta_y),
      static_cast<long long>(-WHEEL_DELTA * 32),
      static_cast<long long>(WHEEL_DELTA * 32)));
  return set_pointer(x, y) && send_mouse(MOUSEEVENTF_WHEEL, static_cast<DWORD>(amount))
             ? input_status("scroll")
             : R"({"ok":false,"reason":"win32-scroll-failed","backend":"win32"})";
}

std::string drag_pointer(double start_x, double start_y, double end_x, double end_y) {
  if (!finite_point(start_x, start_y) || !finite_point(end_x, end_y))
    return R"({"ok":false,"reason":"invalid-drag","backend":"win32"})";
  if (!set_pointer(start_x, start_y) || !send_mouse(MOUSEEVENTF_LEFTDOWN))
    return R"({"ok":false,"reason":"win32-drag-start-failed","backend":"win32"})";
  constexpr int steps = 16;
  bool succeeded = true;
  for (int index = 1; index <= steps; ++index) {
    const double fraction = static_cast<double>(index) / steps;
    succeeded = set_pointer(start_x + (end_x - start_x) * fraction,
                            start_y + (end_y - start_y) * fraction);
    if (!succeeded) break;
    Sleep(8);
  }
  const bool released = send_mouse(MOUSEEVENTF_LEFTUP);
  return succeeded && released ? input_status("drag")
                               : R"({"ok":false,"reason":"win32-drag-failed","backend":"win32"})";
}

std::string press_key(const std::string& key) {
  const WORD code = key_code(key);
  if (!code)
    return R"({"ok":false,"reason":"unsupported-key","backend":"win32"})";
  INPUT inputs[2]{};
  inputs[0].type = INPUT_KEYBOARD;
  inputs[0].ki.wVk = code;
  inputs[1].type = INPUT_KEYBOARD;
  inputs[1].ki.wVk = code;
  inputs[1].ki.dwFlags = KEYEVENTF_KEYUP;
  return SendInput(2, inputs, sizeof(INPUT)) == 2
             ? input_status(key.c_str())
             : R"({"ok":false,"reason":"win32-key-failed","backend":"win32"})";
}

}  // namespace iinatan::native
