#include "window_probe.hpp"

#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>

#include <sstream>
#include <unistd.h>

namespace iinatan::native {

namespace {

bool number_value(CFDictionaryRef dictionary, const void* key, int64_t& value) {
  const auto* raw = static_cast<CFNumberRef>(CFDictionaryGetValue(dictionary, key));
  return raw && CFNumberGetValue(raw, kCFNumberSInt64Type, &value);
}

std::string json_number(double value) {
  std::ostringstream stream;
  stream << value;
  return stream.str();
}

}  // namespace

std::string activate_window(int pid, const std::string& requested_window_id) {
  if (!requested_window_id.empty()) {
    CFArrayRef windows = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
    if (!windows) return R"({"ok":false,"reason":"window-list-unavailable","backend":"macos"})";
    bool found = false;
    auto find_window = [&](CFArrayRef candidates) {
      const CFIndex count = CFArrayGetCount(candidates);
      for (CFIndex index = 0; index < count; ++index) {
        const auto* window = static_cast<CFDictionaryRef>(CFArrayGetValueAtIndex(candidates, index));
        int64_t owner_pid = 0;
        int64_t window_number = 0;
        if (number_value(window, kCGWindowOwnerPID, owner_pid) && owner_pid == pid &&
            number_value(window, kCGWindowNumber, window_number) &&
            requested_window_id == std::to_string(window_number)) {
          return true;
        }
      }
      return false;
    };
    found = find_window(windows);
    CFRelease(windows);
    if (!found) {
      windows = CGWindowListCopyWindowInfo(kCGWindowListOptionAll, kCGNullWindowID);
      if (windows) {
        found = find_window(windows);
        CFRelease(windows);
      }
    }
    if (!found) return R"({"ok":false,"reason":"window-not-found","backend":"macos"})";
  }
  NSRunningApplication* application = [NSRunningApplication runningApplicationWithProcessIdentifier:static_cast<pid_t>(pid)];
  if (!application) return R"({"ok":false,"reason":"process-not-found","backend":"macos"})";
  // Cooperative activation is the supported path on macOS 14 and later. When
  // the caller supplied an identity-checked window number, ask AppKit to
  // bring that process's windows forward as well; this matters when two
  // independent mpv processes are open at the same time. Do not use the
  // deprecated "ignore other apps" flag as a global focus escape hatch.
  const NSApplicationActivationOptions activation_options =
      requested_window_id.empty() ? 0 : NSApplicationActivateAllWindows;
  NSRunningApplication* source_application = NSRunningApplication.currentApplication;
  const pid_t parent_pid = getppid();
  if (parent_pid > 0 && parent_pid != pid) {
    NSRunningApplication* parent_application =
        [NSRunningApplication runningApplicationWithProcessIdentifier:parent_pid];
    if (parent_application) source_application = parent_application;
  }
  BOOL activated_from_application = NO;
  BOOL activated_direct = NO;
  if (@available(macOS 14.0, *)) {
    activated_from_application =
        [application activateFromApplication:source_application
                                      options:activation_options];
    if (!activated_from_application)
      activated_direct = [application activateWithOptions:activation_options];
  } else {
    activated_direct = [application activateWithOptions:activation_options];
  }
  auto wait_for_foreground = [&]() {
    const NSDate* deadline = [NSDate dateWithTimeIntervalSinceNow:2.0];
    while ([deadline timeIntervalSinceNow] > 0) {
      if (NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == pid)
        return true;
      NSDate* next = [NSDate dateWithTimeIntervalSinceNow:0.05];
      [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:next];
    }
    return NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == pid;
  };
  bool foreground = wait_for_foreground();
  if (!foreground && !activated_direct) {
    // A cooperative request can be accepted without actually transferring
    // foreground ownership. Only then use the ordinary direct activation
    // request that was already the fallback for a rejected cooperative call.
    activated_direct = [application activateWithOptions:activation_options];
    foreground = wait_for_foreground();
  }
  const BOOL activated = activated_from_application || activated_direct;
  const pid_t foreground_pid = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
  const bool display_asleep = CGDisplayIsAsleep(CGMainDisplayID()) != 0;
  foreground = foreground || foreground_pid == pid;
  std::ostringstream stream;
  stream << R"({"ok":)" << (activated ? "true" : "false")
         << R"(,"backend":"macos","activated":)" << (activated ? "true" : "false")
         << R"(,"activationRequested":true,"requestAccepted":)"
         << (activated ? "true" : "false")
         << R"(,"activationFromApplication":)"
         << (activated_from_application ? "true" : "false")
         << R"(,"activationDirect":)" << (activated_direct ? "true" : "false")
         << R"(,"activationSourcePid":)"
         << (source_application ? source_application.processIdentifier : 0)
         << R"(,"foregroundVerified":)" << (foreground ? "true" : "false")
         << R"(,"isForeground":)" << (foreground ? "true" : "false")
         << R"(,"targetActive":)" << (application.active ? "true" : "false")
         << R"(,"targetFinishedLaunching":)"
         << (application.finishedLaunching ? "true" : "false")
         << R"(,"targetActivationPolicy":)"
         << static_cast<int>(application.activationPolicy)
         << R"(,"displayAsleep":)" << (display_asleep ? "true" : "false")
         << R"(,"targetPid":)" << pid << R"(,"foregroundPid":)" << foreground_pid << "}";
  return stream.str();
}

std::string probe_window(int pid, const std::string& requested_window_id) {
  CFArrayRef windows = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
  if (!windows) return R"({"ok":false,"reason":"window-list-unavailable","backend":"macos"})";

  std::string result = R"({"ok":false,"reason":"window-not-found","backend":"macos"})";
  const pid_t foreground_pid = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
  const bool display_asleep = CGDisplayIsAsleep(CGMainDisplayID()) != 0;
  auto scan_windows = [&](CFArrayRef candidates, bool on_screen) {
    const CFIndex count = CFArrayGetCount(candidates);
    for (CFIndex index = 0; index < count; ++index) {
      const auto* window = static_cast<CFDictionaryRef>(CFArrayGetValueAtIndex(candidates, index));
      int64_t owner_pid = 0;
      int64_t window_number = 0;
      if (!number_value(window, kCGWindowOwnerPID, owner_pid) || owner_pid != pid ||
          !number_value(window, kCGWindowNumber, window_number))
        continue;
      if (!requested_window_id.empty() && requested_window_id != std::to_string(window_number)) continue;
      const auto* bounds = static_cast<CFDictionaryRef>(CFDictionaryGetValue(window, kCGWindowBounds));
      CGRect frame{};
      if (!bounds || !CGRectMakeWithDictionaryRepresentation(bounds, &frame)) continue;
      int64_t layer = 0;
      number_value(window, kCGWindowLayer, layer);
      // An identity-checked AppKit window may be floating/always-on-top and
      // therefore have a non-zero CoreGraphics layer. Keep the unqualified
      // scan conservative, but do not discard an explicitly requested window.
      if (layer != 0 && requested_window_id.empty()) continue;
      std::ostringstream stream;
      stream << R"({"ok":true,"backend":"macos","windowId":)" << window_number
             << R"(,"content":{"x":)" << json_number(frame.origin.x)
             << R"(,"y":)" << json_number(frame.origin.y)
             << R"(,"width":)" << json_number(frame.size.width)
             << R"(,"height":)" << json_number(frame.size.height)
             << R"(},"contentSource":"window-frame","contentExact":false,"isForeground":)"
             << (owner_pid == foreground_pid ? "true" : "false")
             << R"(,"displayAsleep":)" << (display_asleep ? "true" : "false")
             << R"(,"displayVisible":)" << (on_screen ? "true" : "false") << "}";
      result = stream.str();
      return true;
    }
    return false;
  };
  const bool found_on_screen = scan_windows(windows, true);
  CFRelease(windows);
  if (!found_on_screen) {
    windows = CGWindowListCopyWindowInfo(kCGWindowListOptionAll, kCGNullWindowID);
    if (windows) {
      scan_windows(windows, false);
      CFRelease(windows);
    }
  }
  return result;
}

}  // namespace iinatan::native
