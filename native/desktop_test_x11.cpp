#include "desktop_test.hpp"

#include "png_writer.hpp"

#include <X11/Xlib.h>
#include <X11/keysym.h>
#include <X11/Xutil.h>
#include <X11/extensions/XTest.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <sstream>
#include <string>
#include <thread>
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

Display* open_display(bool& xtest_available) {
  xtest_available = false;
  Display* display = XOpenDisplay(nullptr);
  if (!display) return nullptr;
  int event_base = 0;
  int error_base = 0;
  int major = 0;
  int minor = 0;
  xtest_available = XTestQueryExtension(
      display, &event_base, &error_base, &major, &minor) != 0;
  if (!xtest_available) {
    XCloseDisplay(display);
    return nullptr;
  }
  return display;
}

std::string input_status(const char* operation) {
  std::ostringstream stream;
  stream << R"({"ok":true,"backend":"x11-test-input","operation":")"
         << operation
         << R"(","nativeInputReady":true,"permissionModel":"x11-display-server"})";
  return stream.str();
}

bool move_to(Display* display, double x, double y) {
  return XTestFakeMotionEvent(
             display, -1, static_cast<int>(std::lround(x)), static_cast<int>(std::lround(y)),
             CurrentTime) != 0;
}

KeyCode key_code(Display* display, const std::string& key) {
  KeySym symbol = NoSymbol;
  if (key == "escape") symbol = XK_Escape;
  else if (key == "return") symbol = XK_Return;
  else if (key == "space") symbol = XK_space;
  else if (key == "tab") symbol = XK_Tab;
  if (symbol == NoSymbol) return 0;
  return XKeysymToKeycode(display, symbol);
}

unsigned char component(unsigned long pixel, unsigned long mask) {
  if (!mask) return 0;
  int shift = 0;
  while (((mask >> shift) & 1U) == 0U) ++shift;
  const unsigned long value = (pixel & mask) >> shift;
  const unsigned long maximum = mask >> shift;
  return static_cast<unsigned char>(maximum
                                        ? std::lround((255.0 * value) / maximum)
                                        : 0);
}

}  // namespace

std::string request_post_event_access() {
  bool xtest_available = false;
  Display* display = open_display(xtest_available);
  if (!display)
    return R"({"ok":false,"backend":"x11-test-input","operation":"request-post-event","nativeInputReady":false,"reason":"x11-xtest-unavailable"})";
  XCloseDisplay(display);
  return R"({"ok":true,"backend":"x11-test-input","operation":"request-post-event","nativeInputReady":true,"permissionModel":"x11-display-server"})";
}

std::string capture_desktop(const std::string& output_path) {
  bool xtest_available = false;
  Display* display = open_display(xtest_available);
  if (!display)
    return R"({"ok":false,"reason":"x11-display-or-xtest-unavailable","backend":"x11"})";
  const int screen = DefaultScreen(display);
  const int width = DisplayWidth(display, screen);
  const int height = DisplayHeight(display, screen);
  XImage* image = XGetImage(
      display, RootWindow(display, screen), 0, 0, static_cast<unsigned int>(width),
      static_cast<unsigned int>(height), AllPlanes, ZPixmap);
  if (!image) {
    XCloseDisplay(display);
    return R"({"ok":false,"reason":"x11-capture-unavailable","backend":"x11"})";
  }
  std::vector<unsigned char> pixels(
      static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4);
  for (int y = 0; y < height; ++y) {
    for (int x = 0; x < width; ++x) {
      const unsigned long pixel = XGetPixel(image, x, y);
      const std::size_t offset =
          (static_cast<std::size_t>(y) * static_cast<std::size_t>(width) +
           static_cast<std::size_t>(x)) * 4;
      pixels[offset] = component(pixel, image->red_mask);
      pixels[offset + 1] = component(pixel, image->green_mask);
      pixels[offset + 2] = component(pixel, image->blue_mask);
      pixels[offset + 3] = 255;
    }
  }
  XDestroyImage(image);
  XCloseDisplay(display);
  std::string error;
  if (!write_rgba_png(output_path, width, height, pixels.data(), pixels.size(), error))
    return "{\"ok\":false,\"reason\":\"" + json_escape(error) +
           "\",\"backend\":\"x11\"}";
  std::ostringstream stream;
  stream << R"({"ok":true,"backend":"x11","path":")" << json_escape(output_path)
         << R"(","origin":{"x":0,"y":0},"width":)" << width
         << R"(,"height":)" << height << "}";
  return stream.str();
}

std::string capture_desktop_at(const std::string& output_path, double, double) {
  return capture_desktop(output_path);
}

std::string move_pointer(double x, double y) {
  if (!finite_point(x, y))
    return R"({"ok":false,"reason":"invalid-pointer-coordinate","backend":"x11"})";
  bool xtest_available = false;
  Display* display = open_display(xtest_available);
  if (!display)
    return R"({"ok":false,"reason":"x11-xtest-unavailable","backend":"x11"})";
  const bool moved = move_to(display, x, y);
  XFlush(display);
  XCloseDisplay(display);
  return moved ? input_status("move")
               : R"({"ok":false,"reason":"x11-motion-failed","backend":"x11"})";
}

std::string click_pointer(double x, double y, int button) {
  if (!finite_point(x, y) || (button != 0 && button != 1))
    return R"({"ok":false,"reason":"invalid-click","backend":"x11"})";
  bool xtest_available = false;
  Display* display = open_display(xtest_available);
  if (!display)
    return R"({"ok":false,"reason":"x11-xtest-unavailable","backend":"x11"})";
  const unsigned int x11_button = button == 0 ? 1U : 3U;
  const bool moved = move_to(display, x, y);
  const bool pressed = moved && XTestFakeButtonEvent(display, x11_button, True, CurrentTime);
  const bool released = pressed && XTestFakeButtonEvent(display, x11_button, False, CurrentTime);
  XFlush(display);
  XCloseDisplay(display);
  return released ? input_status(button == 0 ? "left-click" : "right-click")
                  : R"({"ok":false,"reason":"x11-click-failed","backend":"x11"})";
}

std::string scroll_pointer(double x, double y, double delta_y) {
  if (!finite_point(x, y) || !std::isfinite(delta_y) || delta_y == 0)
    return R"({"ok":false,"reason":"invalid-scroll","backend":"x11"})";
  bool xtest_available = false;
  Display* display = open_display(xtest_available);
  if (!display)
    return R"({"ok":false,"reason":"x11-xtest-unavailable","backend":"x11"})";
  const unsigned int button = delta_y < 0 ? 5U : 4U;
  const int count = std::max(1, std::min(32, static_cast<int>(std::ceil(std::abs(delta_y) / 120.0))));
  bool succeeded = move_to(display, x, y);
  for (int index = 0; succeeded && index < count; ++index) {
    succeeded = XTestFakeButtonEvent(display, button, True, CurrentTime) != 0;
    succeeded = succeeded && XTestFakeButtonEvent(display, button, False, CurrentTime) != 0;
  }
  XFlush(display);
  XCloseDisplay(display);
  return succeeded ? input_status("scroll")
                   : R"({"ok":false,"reason":"x11-scroll-failed","backend":"x11"})";
}

std::string drag_pointer(double start_x, double start_y, double end_x, double end_y) {
  if (!finite_point(start_x, start_y) || !finite_point(end_x, end_y))
    return R"({"ok":false,"reason":"invalid-drag","backend":"x11"})";
  bool xtest_available = false;
  Display* display = open_display(xtest_available);
  if (!display)
    return R"({"ok":false,"reason":"x11-xtest-unavailable","backend":"x11"})";
  bool succeeded = move_to(display, start_x, start_y);
  succeeded = succeeded && XTestFakeButtonEvent(display, 1, True, CurrentTime) != 0;
  constexpr int steps = 16;
  for (int index = 1; succeeded && index <= steps; ++index) {
    const double fraction = static_cast<double>(index) / steps;
    succeeded = move_to(display,
                        start_x + (end_x - start_x) * fraction,
                        start_y + (end_y - start_y) * fraction);
    XFlush(display);
    std::this_thread::sleep_for(std::chrono::milliseconds(8));
  }
  const bool released = XTestFakeButtonEvent(display, 1, False, CurrentTime) != 0;
  XFlush(display);
  XCloseDisplay(display);
  return (succeeded && released) ? input_status("drag")
                                  : R"({"ok":false,"reason":"x11-drag-failed","backend":"x11"})";
}

std::string press_key(const std::string& key) {
  bool xtest_available = false;
  Display* display = open_display(xtest_available);
  if (!display)
    return R"({"ok":false,"reason":"x11-xtest-unavailable","backend":"x11"})";
  const KeyCode code = key_code(display, key);
  if (!code) {
    XCloseDisplay(display);
    return R"({"ok":false,"reason":"unsupported-key","backend":"x11"})";
  }
  const bool pressed = XTestFakeKeyEvent(display, code, True, CurrentTime) != 0;
  const bool released = pressed && XTestFakeKeyEvent(display, code, False, CurrentTime) != 0;
  XFlush(display);
  XCloseDisplay(display);
  return released ? input_status(key.c_str())
                  : R"({"ok":false,"reason":"x11-key-failed","backend":"x11"})";
}

std::string press_shortcut(const std::string&, const std::string&) {
  return R"({"ok":false,"reason":"shortcut-not-implemented","backend":"x11"})";
}

std::string type_text(const std::string&) {
  return R"({"ok":false,"reason":"type-not-implemented","backend":"x11"})";
}

std::string activate_process(int) {
  return R"({"ok":false,"reason":"process-activation-not-implemented","backend":"x11"})";
}

}  // namespace iinatan::native
