#include "window_probe.hpp"

#define NOMINMAX
#include <windows.h>

#include <cstdint>
#include <sstream>

namespace iinatan::native {

namespace {

struct Search {
  DWORD pid;
  HWND requested;
  HWND found;
};

BOOL CALLBACK find_window(HWND window, LPARAM raw) {
  auto& search = *reinterpret_cast<Search*>(raw);
  DWORD owner = 0;
  GetWindowThreadProcessId(window, &owner);
  if (owner != search.pid || !IsWindowVisible(window) || IsIconic(window)) return TRUE;
  if (search.requested && search.requested != window) return TRUE;
  search.found = window;
  return FALSE;
}

}  // namespace

std::string probe_window(int pid, const std::string& requested_window_id) {
  HWND requested = nullptr;
  if (!requested_window_id.empty()) {
    try {
      requested = reinterpret_cast<HWND>(std::stoull(requested_window_id));
    } catch (...) {
      return R"({"ok":false,"reason":"invalid-window-id","backend":"windows"})";
    }
  }
  Search search{static_cast<DWORD>(pid), requested, nullptr};
  EnumWindows(find_window, reinterpret_cast<LPARAM>(&search));
  if (!search.found) return R"({"ok":false,"reason":"window-not-found","backend":"windows"})";
  RECT client{};
  if (!GetClientRect(search.found, &client)) return R"({"ok":false,"reason":"client-rect-unavailable","backend":"windows"})";
  POINT origin{client.left, client.top};
  if (!ClientToScreen(search.found, &origin)) return R"({"ok":false,"reason":"client-origin-unavailable","backend":"windows"})";
  const UINT dpi = GetDpiForWindow(search.found);
  const double desktop_scale = dpi > 0 ? static_cast<double>(dpi) / 96.0 : 1.0;
  std::ostringstream stream;
  const bool foreground = GetForegroundWindow() == search.found;
  stream << R"({"ok":true,"backend":"windows","windowId":)"
         << reinterpret_cast<std::uintptr_t>(search.found)
         << R"(,"content":{"x":)" << origin.x << R"(,"y":)" << origin.y
         << R"(,"width":)" << (client.right - client.left)
         << R"(,"height":)" << (client.bottom - client.top)
         << R"(},"contentSource":"client-area","contentExact":true,"coordinateSpace":"desktop-physical","desktopScale":)"
         << desktop_scale << R"(,"dpi":)" << dpi
         << R"(,"isForeground":)" << (foreground ? "true" : "false") << "}";
  return stream.str();
}

std::string activate_window(int pid, const std::string& requested_window_id) {
  HWND requested = nullptr;
  if (!requested_window_id.empty()) {
    try {
      requested = reinterpret_cast<HWND>(std::stoull(requested_window_id));
    } catch (...) {
      return R"({"ok":false,"reason":"invalid-window-id","backend":"windows"})";
    }
  }
  Search search{static_cast<DWORD>(pid), requested, nullptr};
  EnumWindows(find_window, reinterpret_cast<LPARAM>(&search));
  if (!search.found) return R"({"ok":false,"reason":"window-not-found","backend":"windows"})";
  ShowWindow(search.found, SW_RESTORE);
  const BOOL request_accepted = SetForegroundWindow(search.found);
  const bool foreground = GetForegroundWindow() == search.found;
  std::ostringstream stream;
  stream << R"({"ok":)" << (request_accepted ? "true" : "false")
         << R"(,"backend":"windows","activationRequested":true,"requestAccepted":)"
         << (request_accepted ? "true" : "false")
         << R"(,"foregroundVerified":)" << (foreground ? "true" : "false")
         << R"(,"isForeground":)" << (foreground ? "true" : "false") << "}";
  return stream.str();
}

}  // namespace iinatan::native
