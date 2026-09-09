#include "window_probe.hpp"

#define NOMINMAX
#include <dwmapi.h>
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
  if (requested) {
    // BrowserWindow gives us the authoritative HWND.  It can still be in the
    // show transition when this helper runs, so do not discard it merely
    // because IsWindowVisible has not caught up yet.
    DWORD owner = 0;
    GetWindowThreadProcessId(requested, &owner);
    if (IsWindow(requested) && owner == search.pid) search.found = requested;
  } else {
    EnumWindows(find_window, reinterpret_cast<LPARAM>(&search));
  }
  if (!search.found) return R"({"ok":false,"reason":"window-not-found","backend":"windows"})";
  ShowWindow(search.found, SW_SHOW);
  SetWindowPos(
      search.found,
      HWND_TOP,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE);
  HWND foreground_window = GetForegroundWindow();
  const DWORD caller_thread = GetCurrentThreadId();
  const DWORD target_thread = GetWindowThreadProcessId(search.found, nullptr);
  const DWORD foreground_thread =
      foreground_window ? GetWindowThreadProcessId(foreground_window, nullptr) : 0;
  bool caller_attached_foreground = false;
  bool caller_attached_target = false;
  if (caller_thread && foreground_thread && caller_thread != foreground_thread)
    caller_attached_foreground =
      AttachThreadInput(caller_thread, foreground_thread, TRUE) != FALSE;
  if (caller_thread && target_thread && caller_thread != target_thread)
    caller_attached_target = AttachThreadInput(caller_thread, target_thread, TRUE) != FALSE;
  bool target_attached_foreground = false;
  if (target_thread && foreground_thread && target_thread != foreground_thread)
    target_attached_foreground =
        AttachThreadInput(target_thread, foreground_thread, TRUE) != FALSE;
  const BOOL request_accepted = SetForegroundWindow(search.found);
  SetActiveWindow(search.found);
  SetFocus(search.found);
  BringWindowToTop(search.found);
  SetWindowPos(
      search.found,
      HWND_TOP,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE);
  bool foreground = GetForegroundWindow() == search.found;
  for (int attempt = 0; !foreground && attempt < 30; ++attempt) {
    Sleep(10);
    foreground = GetForegroundWindow() == search.found;
  }
  if (target_attached_foreground)
    AttachThreadInput(target_thread, foreground_thread, FALSE);
  if (caller_attached_target) AttachThreadInput(caller_thread, target_thread, FALSE);
  if (caller_attached_foreground)
    AttachThreadInput(caller_thread, foreground_thread, FALSE);
  const bool thread_attached =
      caller_attached_foreground || caller_attached_target || target_attached_foreground;
  std::ostringstream stream;
  stream << R"({"ok":)" << (request_accepted ? "true" : "false")
         << R"(,"backend":"windows","activationRequested":true,"requestAccepted":)"
         << (request_accepted ? "true" : "false")
         << R"(,"foregroundVerified":)" << (foreground ? "true" : "false")
         << R"(,"isForeground":)" << (foreground ? "true" : "false")
         << R"(,"threadInputAttached":)" << (thread_attached ? "true" : "false")
         << "}";
  return stream.str();
}

std::string set_window_bounds(
    int pid,
    const std::string& requested_window_id,
    int x,
    int y,
    int width,
    int height) {
  if (width <= 0 || height <= 0)
    return R"({"ok":false,"reason":"invalid-window-bounds","backend":"windows"})";
  HWND requested = nullptr;
  if (!requested_window_id.empty()) {
    try {
      requested = reinterpret_cast<HWND>(std::stoull(requested_window_id));
    } catch (...) {
      return R"({"ok":false,"reason":"invalid-window-id","backend":"windows"})";
    }
  }
  Search search{static_cast<DWORD>(pid), requested, nullptr};
  if (requested) {
    DWORD owner = 0;
    GetWindowThreadProcessId(requested, &owner);
    if (IsWindow(requested) && (!pid || owner == search.pid)) search.found = requested;
  } else {
    EnumWindows(find_window, reinterpret_cast<LPARAM>(&search));
  }
  if (!search.found) return R"({"ok":false,"reason":"window-not-found","backend":"windows"})";
  ShowWindow(search.found, SW_RESTORE);
  const BOOL moved = SetWindowPos(
      search.found,
      HWND_TOP,
      x,
      y,
      width,
      height,
      SWP_NOACTIVATE | SWP_SHOWWINDOW);
  RECT bounds{};
  const BOOL read = GetWindowRect(search.found, &bounds);
  std::ostringstream stream;
  stream << R"({"ok":)" << (moved && read ? "true" : "false")
         << R"(,"backend":"windows","windowId":)"
         << reinterpret_cast<std::uintptr_t>(search.found)
         << R"(,"bounds":{"x":)" << (read ? bounds.left : 0)
         << R"(,"y":)" << (read ? bounds.top : 0)
         << R"(,"width":)" << (read ? bounds.right - bounds.left : 0)
         << R"(,"height":)" << (read ? bounds.bottom - bounds.top : 0) << "}}";
  return stream.str();
}

std::string disable_window_transitions(const std::string& window_id) {
  HWND window = nullptr;
  try {
    window = reinterpret_cast<HWND>(std::stoull(window_id));
  } catch (...) {
    return R"({"ok":false,"reason":"invalid-window-id","backend":"windows"})";
  }
  if (!window || !IsWindow(window))
    return R"({"ok":false,"reason":"window-not-found","backend":"windows"})";
  BOOL disabled = TRUE;
  const HRESULT result = DwmSetWindowAttribute(
      window, DWMWA_TRANSITIONS_FORCEDISABLED, &disabled, sizeof(disabled));
  BOOL observed = FALSE;
  const HRESULT readback = DwmGetWindowAttribute(
      window, DWMWA_TRANSITIONS_FORCEDISABLED, &observed, sizeof(observed));
  const bool applied = SUCCEEDED(result);
  // Windows accepts this attribute through DwmSetWindowAttribute, but some
  // compositor builds do not expose it through DwmGetWindowAttribute. Treat a
  // successful set as verified in that case and report readback separately.
  const bool readback_available = SUCCEEDED(readback);
  const bool verified = applied && (!readback_available || observed == TRUE);
  std::ostringstream stream;
  stream << R"({"ok":)" << (applied ? "true" : "false")
         << R"(,"backend":"windows","transitionsDisabled":)"
         << (applied ? "true" : "false")
         << R"(,"transitionsVerified":)" << (verified ? "true" : "false")
         << R"(,"readbackAvailable":)" << (readback_available ? "true" : "false")
         << "}";
  return stream.str();
}

}  // namespace iinatan::native
