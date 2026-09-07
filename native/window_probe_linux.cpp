#include "window_probe.hpp"

#ifdef IINATAN_HAS_X11
#include <X11/Xatom.h>
#include <X11/Xlib.h>
#endif

#include <cstdint>
#include <cstring>
#include <limits>
#include <sstream>

namespace iinatan::native {

#ifdef IINATAN_HAS_X11

namespace {

// Xlib exposes format-32 property data as an array of unsigned long values,
// even on LP64 systems where the X11 protocol value itself is only 32 bits.
// Read through that documented representation, then narrow explicitly so a
// malformed property cannot become a native window or process identifier.
bool xlib_format32_at(const unsigned char* data, unsigned long index, uint32_t& value) {
  unsigned long storage = 0;
  std::memcpy(&storage, data + (index * sizeof(storage)), sizeof(storage));
  if (storage > std::numeric_limits<uint32_t>::max()) return false;
  value = static_cast<uint32_t>(storage);
  return true;
}

bool property_u32(Display* display, Window window, Atom atom, Atom expected_type,
                  uint32_t& value) {
  Atom actual_type{};
  int actual_format{};
  unsigned long item_count{};
  unsigned long bytes_after{};
  unsigned char* data = nullptr;
  const int status = XGetWindowProperty(display, window, atom, 0, 1, False,
                                        expected_type, &actual_type, &actual_format,
                                        &item_count, &bytes_after, &data);
  const bool valid = status == Success && data && item_count >= 1 &&
                     actual_type == expected_type && actual_format == 32;
  if (!valid) {
    if (data) XFree(data);
    return false;
  }
  const bool read = xlib_format32_at(data, 0, value);
  XFree(data);
  return read;
}

bool property_pid(Display* display, Window window, Atom atom, int& pid) {
  uint32_t value = 0;
  if (!property_u32(display, window, atom, XA_CARDINAL, value) ||
      value > static_cast<uint32_t>(std::numeric_limits<int>::max())) {
    return false;
  }
  pid = static_cast<int>(value);
  return true;
}

bool property_window(Display* display, Window window, Atom atom, Window& value) {
  uint32_t raw = 0;
  if (!property_u32(display, window, atom, XA_WINDOW, raw)) return false;
  value = static_cast<Window>(raw);
  return true;
}

enum class WindowLookupResult {
  kFound,
  kNotFound,
  kClientListUnavailable,
};

WindowLookupResult find_window(Display* display, Window root, Atom client_list, Atom net_pid,
                               int pid, const std::string& requested_window_id,
                               Window& found) {
  Atom actual_type{};
  int actual_format{};
  unsigned long count{};
  unsigned long bytes_after{};
  unsigned char* data = nullptr;
  const int status = XGetWindowProperty(display, root, client_list, 0, 4096, False,
                                        XA_WINDOW, &actual_type, &actual_format, &count,
                                        &bytes_after, &data);
  const bool valid = status == Success && actual_type == XA_WINDOW && actual_format == 32 &&
                     bytes_after == 0 && (count == 0 || data);
  if (!valid) {
    if (data) XFree(data);
    return WindowLookupResult::kClientListUnavailable;
  }

  const auto* windows = data;
  for (unsigned long index = 0; index < count; ++index) {
    uint32_t raw_window = 0;
    if (!xlib_format32_at(windows, index, raw_window)) continue;
    const Window candidate = static_cast<Window>(raw_window);
    int candidate_pid = 0;
    if (!property_pid(display, candidate, net_pid, candidate_pid) || candidate_pid != pid) {
      continue;
    }
    if (!requested_window_id.empty() && requested_window_id != std::to_string(candidate)) {
      continue;
    }
    found = candidate;
    XFree(data);
    return WindowLookupResult::kFound;
  }
  XFree(data);
  return WindowLookupResult::kNotFound;
}

}  // namespace

#endif

std::string activate_window(int pid, const std::string& requested_window_id) {
#ifndef IINATAN_HAS_X11
  (void)pid;
  (void)requested_window_id;
  return R"({"ok":false,"reason":"x11-helper-not-built","backend":"linux"})";
#else
  Display* display = XOpenDisplay(nullptr);
  if (!display) return R"({"ok":false,"reason":"x11-display-unavailable","backend":"linux"})";
  const Window root = DefaultRootWindow(display);
  const Atom client_list = XInternAtom(display, "_NET_CLIENT_LIST", True);
  const Atom net_pid = XInternAtom(display, "_NET_WM_PID", True);
  const Atom active_window = XInternAtom(display, "_NET_ACTIVE_WINDOW", True);
  if (!client_list || !net_pid || !active_window) {
    XCloseDisplay(display);
    return R"({"ok":false,"reason":"ewmh-unavailable","backend":"linux"})";
  }
  Window found = 0;
  const WindowLookupResult lookup = find_window(display, root, client_list, net_pid, pid,
                                                requested_window_id, found);
  if (lookup == WindowLookupResult::kClientListUnavailable) {
    XCloseDisplay(display);
    return R"({"ok":false,"reason":"client-list-unavailable","backend":"linux"})";
  }
  if (lookup == WindowLookupResult::kNotFound) {
    XCloseDisplay(display);
    return R"({"ok":false,"reason":"window-not-found","backend":"linux"})";
  }
  XEvent event{};
  event.xclient.type = ClientMessage;
  event.xclient.window = found;
  event.xclient.message_type = active_window;
  event.xclient.format = 32;
  event.xclient.data.l[0] = 1;
  event.xclient.data.l[1] = CurrentTime;
  event.xclient.data.l[2] = 0;
  event.xclient.data.l[3] = 0;
  event.xclient.data.l[4] = 0;
  const int sent = XSendEvent(display, root, False, SubstructureRedirectMask | SubstructureNotifyMask, &event);
  XRaiseWindow(display, found);
  XFlush(display);
  XCloseDisplay(display);
  return sent ? R"({"ok":true,"backend":"linux-x11","activationRequested":true,"requestAccepted":true,"foregroundVerified":false})" : R"({"ok":false,"reason":"activation-request-failed","backend":"linux-x11","activationRequested":false,"requestAccepted":false,"foregroundVerified":false})";
#endif
}

std::string probe_window(int pid, const std::string& requested_window_id) {
#ifndef IINATAN_HAS_X11
  (void)pid;
  (void)requested_window_id;
  return R"({"ok":false,"reason":"x11-helper-not-built","backend":"linux"})";
#else
  Display* display = XOpenDisplay(nullptr);
  if (!display) return R"({"ok":false,"reason":"x11-display-unavailable","backend":"linux"})";
  const Window root = DefaultRootWindow(display);
  const Atom client_list = XInternAtom(display, "_NET_CLIENT_LIST", True);
  const Atom net_pid = XInternAtom(display, "_NET_WM_PID", True);
  const Atom active_window = XInternAtom(display, "_NET_ACTIVE_WINDOW", True);
  if (!client_list || !net_pid || !active_window) {
    XCloseDisplay(display);
    return R"({"ok":false,"reason":"ewmh-unavailable","backend":"linux"})";
  }
  Window found = 0;
  const WindowLookupResult lookup = find_window(display, root, client_list, net_pid, pid,
                                                requested_window_id, found);
  if (lookup == WindowLookupResult::kClientListUnavailable) {
    XCloseDisplay(display);
    return R"({"ok":false,"reason":"client-list-unavailable","backend":"linux"})";
  }
  if (lookup == WindowLookupResult::kNotFound) {
    XCloseDisplay(display);
    return R"({"ok":false,"reason":"window-not-found","backend":"linux"})";
  }
  XWindowAttributes attributes{};
  if (!XGetWindowAttributes(display, found, &attributes)) {
    XCloseDisplay(display);
    return R"({"ok":false,"reason":"window-attributes-unavailable","backend":"linux"})";
  }
  Window child{};
  int x = 0;
  int y = 0;
  XTranslateCoordinates(display, found, root, 0, 0, &x, &y, &child);
  Window active = 0;
  const bool foreground = property_window(display, root, active_window, active) && active == found;
  std::ostringstream stream;
  stream << R"({"ok":true,"backend":"linux-x11","windowId":)" << found
         << R"(,"content":{"x":)" << x << R"(,"y":)" << y
         << R"(,"width":)" << attributes.width << R"(,"height":)" << attributes.height
         << R"(},"contentSource":"x11-window","contentExact":false,"coordinateSpace":"desktop-physical","desktopScale":1,"isForeground":)"
         << (foreground ? "true" : "false") << "}";
  XCloseDisplay(display);
  return stream.str();
#endif
}

}  // namespace iinatan::native
