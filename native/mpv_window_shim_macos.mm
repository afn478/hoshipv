#include "mpv-cplugin-api.h"

#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>

#include <fcntl.h>
#include <unistd.h>

#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <sstream>
#include <string>

namespace {

constexpr unsigned long kMinimumClientApi = (2UL << 16) | 5UL;
constexpr double kPollSeconds = 0.1;

struct ContentGeometry {
  bool valid = false;
  int64_t window_id = 0;
  double x = 0;
  double y = 0;
  double width = 0;
  double height = 0;
  bool foreground = false;
  bool fullscreen = false;
};

std::string session_directory() {
  const char* value = std::getenv("IINATAN_SESSION_DIR");
  return value ? std::string(value) : std::string();
}

std::string geometry_path(const std::string& directory, pid_t pid) {
  std::ostringstream path;
  path << directory << "/" << pid << ".geometry.json";
  return path.str();
}

bool write_all(int descriptor, const std::string& value) {
  size_t offset = 0;
  while (offset < value.size()) {
    const ssize_t written = write(descriptor, value.data() + offset, value.size() - offset);
    if (written <= 0) return false;
    offset += static_cast<size_t>(written);
  }
  return true;
}

bool write_atomic(const std::string& target, const std::string& value) {
  const std::string temporary = target + ".next";
  const int descriptor = open(temporary.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
  if (descriptor < 0) return false;
  const bool written = write_all(descriptor, value) && fsync(descriptor) == 0;
  const int close_result = close(descriptor);
  if (!written || close_result != 0) {
    unlink(temporary.c_str());
    return false;
  }
  if (rename(temporary.c_str(), target.c_str()) != 0) {
    unlink(temporary.c_str());
    return false;
  }
  return true;
}

bool finite_geometry(const ContentGeometry& geometry) {
  return geometry.valid && geometry.width > 0 && geometry.height > 0 &&
         std::isfinite(geometry.x) && std::isfinite(geometry.y) &&
         std::isfinite(geometry.width) && std::isfinite(geometry.height);
}

bool same_geometry(const ContentGeometry& left, const ContentGeometry& right) {
  constexpr double kCoordinateTolerance = 0.01;
  return left.valid == right.valid && left.window_id == right.window_id &&
         left.foreground == right.foreground && left.fullscreen == right.fullscreen &&
         std::abs(left.x - right.x) < kCoordinateTolerance &&
         std::abs(left.y - right.y) < kCoordinateTolerance &&
         std::abs(left.width - right.width) < kCoordinateTolerance &&
         std::abs(left.height - right.height) < kCoordinateTolerance;
}

bool appkit_geometry(ContentGeometry& result) {
  __block ContentGeometry captured;
  dispatch_sync(dispatch_get_main_queue(), ^{
    NSWindow* selected_window = nil;
    CGFloat selected_area = 0;
    for (NSWindow* candidate in NSApplication.sharedApplication.windows) {
      if (!candidate.isVisible || !candidate.contentView) continue;
      const CGFloat area = NSWidth(candidate.contentView.bounds) *
                           NSHeight(candidate.contentView.bounds);
      if (candidate.isKeyWindow || area > selected_area) {
        selected_window = candidate;
        selected_area = area;
        if (candidate.isKeyWindow) break;
      }
    }
    NSWindow* window = selected_window;
    if (!window) return;

    const NSRect screen_rect = [window convertRectToScreen:window.contentView.bounds];
    const NSPoint center = NSMakePoint(NSMidX(screen_rect), NSMidY(screen_rect));
    NSScreen* selected_screen = nil;
    for (NSScreen* screen in NSScreen.screens) {
      if (NSPointInRect(center, screen.frame)) {
        selected_screen = screen;
        break;
      }
    }
    if (!selected_screen) selected_screen = NSScreen.mainScreen;
    if (!selected_screen) return;

    NSNumber* screen_number = selected_screen.deviceDescription[NSDeviceDescriptionKey(@"NSScreenNumber")];
    if (!screen_number) return;
    const CGDirectDisplayID display = static_cast<CGDirectDisplayID>(screen_number.unsignedIntValue);
    const CGRect quartz_frame = CGDisplayBounds(display);
    const NSRect appkit_frame = selected_screen.frame;

    captured.valid = true;
    captured.window_id = static_cast<int64_t>(window.windowNumber);
    captured.x = quartz_frame.origin.x + (NSMinX(screen_rect) - NSMinX(appkit_frame));
    captured.y = quartz_frame.origin.y +
                 (NSMaxY(appkit_frame) - NSMaxY(screen_rect));
    captured.width = NSWidth(screen_rect);
    captured.height = NSHeight(screen_rect);
    captured.foreground = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == getpid();
    captured.fullscreen = (window.styleMask & NSWindowStyleMaskFullScreen) != 0;
  });
  if (!finite_geometry(captured)) return false;
  result = captured;
  return true;
}

std::string geometry_json(const ContentGeometry& geometry, pid_t pid) {
  std::ostringstream stream;
  stream << R"({"protocol":1,"pid":)" << pid << R"(,"windowId":)"
         << geometry.window_id << R"(,"content":{"x":)" << geometry.x
         << R"(,"y":)" << geometry.y << R"(,"width":)" << geometry.width
         << R"(,"height":)" << geometry.height
         << R"(},"contentSource":"appkit-content-view","contentExact":true,"isForeground":)"
         << (geometry.foreground ? "true" : "false")
         << R"(,"fullscreenObserved":)"
         << (geometry.fullscreen ? "true" : "false")
         << R"(,"fullscreenEvidence":"appkit-window-style-mask"})" << '\n';
  return stream.str();
}

void remove_geometry_file(const std::string& path) {
  if (!path.empty()) unlink(path.c_str());
}

}  // namespace

extern "C" int mpv_open_cplugin(mpv_handle* handle) {
  if (!handle || mpv_client_api_version() < kMinimumClientApi) return -1;
  const std::string directory = session_directory();
  if (directory.empty()) return -1;

  const pid_t pid = getpid();
  const std::string path = geometry_path(directory, pid);
  mpv_event* initial_event = mpv_wait_event(handle, 0);
  if (initial_event && initial_event->event_id == MPV_EVENT_SHUTDOWN) return 0;
  ContentGeometry previous_geometry;
  bool sidecar_present = false;
  while (true) {
    mpv_event* event = mpv_wait_event(handle, kPollSeconds);
    if (event && event->event_id == MPV_EVENT_SHUTDOWN) break;
    ContentGeometry geometry;
    const bool geometry_available = appkit_geometry(geometry);
    if (geometry_available &&
        (!sidecar_present || !same_geometry(previous_geometry, geometry))) {
      if (write_atomic(path, geometry_json(geometry, pid))) {
        previous_geometry = geometry;
        sidecar_present = true;
      }
    } else if (!finite_geometry(geometry) && sidecar_present) {
      remove_geometry_file(path);
      sidecar_present = false;
    }
  }

  remove_geometry_file(path);
  return 0;
}
