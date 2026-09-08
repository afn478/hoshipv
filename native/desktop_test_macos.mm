#include "desktop_test.hpp"

#import <ApplicationServices/ApplicationServices.h>
#import <Cocoa/Cocoa.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreServices/CoreServices.h>
#import <ImageIO/ImageIO.h>

#include <cmath>
#include <chrono>
#include <dlfcn.h>
#include <sstream>
#include <thread>
#include <vector>

namespace iinatan::native {

namespace {

std::string json_escape(const std::string& value) {
  std::string escaped;
  escaped.reserve(value.size() + 8);
  for (const char character : value) {
    if (character == '\\' || character == '"') escaped.push_back('\\');
    if (character == '\n') {
      escaped += "\\n";
    } else if (character == '\r') {
      escaped += "\\r";
    } else {
      escaped.push_back(character);
    }
  }
  return escaped;
}

bool finite_point(double x, double y) {
  return std::isfinite(x) && std::isfinite(y);
}

bool accessibility_trusted() {
  return AXIsProcessTrusted() == true;
}

std::string input_status(const char* operation, bool trusted) {
  const bool post_event_trusted = CGPreflightPostEventAccess() == true;
  std::ostringstream stream;
  stream << R"({"ok":true,"backend":"macos-test-input","operation":")"
         << operation << R"(","accessibilityTrusted":)"
         << (trusted ? "true" : "false") << R"(,"postEventTrusted":)"
         << (post_event_trusted ? "true" : "false") << "}";
  return stream.str();
}

CGKeyCode key_code(const std::string& key) {
  if (key == "escape") return 53;
  if (key == "return") return 36;
  if (key == "space") return 49;
  if (key == "tab") return 48;
  if (key == "delete") return 51;
  if (key == "left") return 123;
  if (key == "right") return 124;
  if (key == "down") return 125;
  if (key == "up") return 126;
  if (key == "home") return 115;
  if (key == "end") return 119;
  if (key == "comma") return 43;
  return UINT16_MAX;
}

CGEventFlags shortcut_flags(const std::string& modifier) {
  if (modifier == "command" || modifier == "cmd") return kCGEventFlagMaskCommand;
  if (modifier == "control" || modifier == "ctrl") return kCGEventFlagMaskControl;
  if (modifier == "option" || modifier == "alt") return kCGEventFlagMaskAlternate;
  if (modifier == "shift") return kCGEventFlagMaskShift;
  return 0;
}

struct TextKey {
  CGKeyCode code = UINT16_MAX;
  CGEventFlags flags = 0;
};

bool ascii_text_key(UniChar character, TextKey& key) {
  static constexpr CGKeyCode letters[] = {
      0, 11, 8, 2, 14, 3, 5, 4, 34, 38, 40, 37, 46,
      45, 31, 35, 12, 15, 1, 17, 32, 9, 13, 7, 16, 6,
  };
  static constexpr CGKeyCode digits[] = {18, 19, 20, 21, 23,
                                         22, 26, 28, 25, 29};
  key = {};
  if (character >= 'a' && character <= 'z') {
    key.code = letters[character - 'a'];
    return true;
  }
  if (character >= 'A' && character <= 'Z') {
    key.code = letters[character - 'A'];
    key.flags = kCGEventFlagMaskShift;
    return true;
  }
  if (character >= '0' && character <= '9') {
    key.code = digits[character - '0'];
    return true;
  }
  switch (character) {
    case ' ':
      key.code = 49;
      return true;
    case '-':
      key.code = 27;
      return true;
    case '_':
      key.code = 27;
      key.flags = kCGEventFlagMaskShift;
      return true;
    case '=':
      key.code = 24;
      return true;
    case '+':
      key.code = 24;
      key.flags = kCGEventFlagMaskShift;
      return true;
    case '[':
      key.code = 33;
      return true;
    case '{':
      key.code = 33;
      key.flags = kCGEventFlagMaskShift;
      return true;
    case ']':
      key.code = 30;
      return true;
    case '}':
      key.code = 30;
      key.flags = kCGEventFlagMaskShift;
      return true;
    case '\\':
      key.code = 42;
      return true;
    case '|':
      key.code = 42;
      key.flags = kCGEventFlagMaskShift;
      return true;
    case ';':
      key.code = 41;
      return true;
    case ':':
      key.code = 41;
      key.flags = kCGEventFlagMaskShift;
      return true;
    case '\'':
      key.code = 39;
      return true;
    case '"':
      key.code = 39;
      key.flags = kCGEventFlagMaskShift;
      return true;
    case ',':
      key.code = 43;
      return true;
    case '<':
      key.code = 43;
      key.flags = kCGEventFlagMaskShift;
      return true;
    case '.':
      key.code = 47;
      return true;
    case '>':
      key.code = 47;
      key.flags = kCGEventFlagMaskShift;
      return true;
    case '/':
      key.code = 44;
      return true;
    case '?':
      key.code = 44;
      key.flags = kCGEventFlagMaskShift;
      return true;
    case '`':
      key.code = 50;
      return true;
    case '~':
      key.code = 50;
      key.flags = kCGEventFlagMaskShift;
      return true;
    case '!':
      key.code = 18;
      key.flags = kCGEventFlagMaskShift;
      return true;
    case '@':
      key.code = 19;
      key.flags = kCGEventFlagMaskShift;
      return true;
    case '#':
      key.code = 20;
      key.flags = kCGEventFlagMaskShift;
      return true;
    case '$':
      key.code = 21;
      key.flags = kCGEventFlagMaskShift;
      return true;
    case '%':
      key.code = 23;
      key.flags = kCGEventFlagMaskShift;
      return true;
    case '^':
      key.code = 22;
      key.flags = kCGEventFlagMaskShift;
      return true;
    case '&':
      key.code = 26;
      key.flags = kCGEventFlagMaskShift;
      return true;
    case '*':
      key.code = 28;
      key.flags = kCGEventFlagMaskShift;
      return true;
    case '(':
      key.code = 25;
      key.flags = kCGEventFlagMaskShift;
      return true;
    case ')':
      key.code = 29;
      key.flags = kCGEventFlagMaskShift;
      return true;
    default:
      return false;
  }
}

}  // namespace

std::string request_post_event_access() {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    [NSApp activateIgnoringOtherApps:YES];

    CGRequestPostEventAccess();
    const NSDate* deadline = [NSDate dateWithTimeIntervalSinceNow:10.0];
    while (CGPreflightPostEventAccess() == false && [deadline timeIntervalSinceNow] > 0) {
      NSDate* next = [NSDate dateWithTimeIntervalSinceNow:0.25];
      [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:next];
    }

    const bool accessibility = AXIsProcessTrusted() == true;
    const bool post_event = CGPreflightPostEventAccess() == true;
    std::ostringstream stream;
    stream << R"({"ok":true,"backend":"macos-test-input","operation":"request-post-event","accessibilityTrusted":)"
           << (accessibility ? "true" : "false") << R"(,"postEventTrusted":)"
           << (post_event ? "true" : "false") << "}"
           << '\n';
    return stream.str();
  }
}

std::string activate_process(int pid) {
  if (pid <= 0)
    return R"({"ok":false,"reason":"invalid-process-id","backend":"macos"})";
  NSRunningApplication* application =
      [NSRunningApplication runningApplicationWithProcessIdentifier:static_cast<pid_t>(pid)];
  if (!application)
    return R"({"ok":false,"reason":"process-not-found","backend":"macos"})";
  const BOOL activated = [application activateWithOptions:NSApplicationActivateAllWindows];
  bool foreground = false;
  const NSDate* deadline = [NSDate dateWithTimeIntervalSinceNow:2.0];
  while ([deadline timeIntervalSinceNow] > 0) {
    foreground =
        NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == application.processIdentifier;
    if (foreground) break;
    NSDate* next = [NSDate dateWithTimeIntervalSinceNow:0.05];
    [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:next];
  }
  std::ostringstream stream;
  stream << R"({"ok":)" << (activated ? "true" : "false")
         << R"(,"backend":"macos","operation":"activate","pid":)" << pid
         << R"(,"foregroundVerified":)" << (foreground ? "true" : "false")
         << R"(,"isForeground":)" << (foreground ? "true" : "false") << "}";
  return stream.str();
}

std::string capture_desktop(const std::string& output_path) {
  return capture_desktop_at(output_path, NAN, NAN);
}

std::string capture_desktop_at(const std::string& output_path, double x, double y) {
  if (output_path.empty())
    return R"({"ok":false,"reason":"capture-path-empty","backend":"macos"})";
  CGDirectDisplayID display = CGMainDisplayID();
  if (finite_point(x, y)) {
    CGDirectDisplayID matching_displays[1] = {};
    uint32_t matching_count = 0;
    if (CGGetDisplaysWithPoint(
            CGPointMake(x, y), 1, matching_displays, &matching_count) == kCGErrorSuccess &&
        matching_count > 0) {
      display = matching_displays[0];
    }
  }
  const CGRect bounds = CGDisplayBounds(display);
  using CaptureFunction = CGImageRef (*)(
      CGRect, CGWindowListOption, CGWindowID, CGWindowImageOption);
  const auto capture = reinterpret_cast<CaptureFunction>(
      dlsym(RTLD_DEFAULT, "CGWindowListCreateImage"));
  if (!capture)
    return R"({"ok":false,"reason":"display-capture-api-unavailable","backend":"macos"})";
  CGImageRef image =
      capture(bounds, kCGWindowListOptionOnScreenOnly, kCGNullWindowID, kCGWindowImageDefault);
  if (!image)
    return R"({"ok":false,"reason":"display-capture-unavailable","backend":"macos"})";

  CFURLRef url = CFURLCreateFromFileSystemRepresentation(
      kCFAllocatorDefault,
      reinterpret_cast<const UInt8*>(output_path.c_str()),
      output_path.size(),
      false);
  CGImageDestinationRef destination =
      url ? CGImageDestinationCreateWithURL(url, CFSTR("public.png"), 1, nullptr) : nullptr;
  const bool created = destination != nullptr;
  if (created) CGImageDestinationAddImage(destination, image, nullptr);
  const bool finalized = created && CGImageDestinationFinalize(destination);
  if (destination) CFRelease(destination);
  if (url) CFRelease(url);
  const size_t width = CGImageGetWidth(image);
  const size_t height = CGImageGetHeight(image);
  const double scale_x = bounds.size.width > 0
                             ? static_cast<double>(width) / bounds.size.width
                             : 1.0;
  const double scale_y = bounds.size.height > 0
                             ? static_cast<double>(height) / bounds.size.height
                             : 1.0;
  CGImageRelease(image);
  if (!finalized)
    return R"({"ok":false,"reason":"capture-write-failed","backend":"macos"})";

  std::ostringstream stream;
  stream << R"({"ok":true,"backend":"macos","path":")"
         << json_escape(output_path) << R"(","display":)" << display
         << R"(,"origin":{"x":)" << bounds.origin.x * scale_x
         << R"(,"y":)" << bounds.origin.y * scale_y << R"(},"scale":)" << scale_x
         << R"(,"width":)" << width << R"(,"height":)" << height << "}"
         << '\n';
  return stream.str();
}

std::string move_pointer(double x, double y) {
  if (!finite_point(x, y))
    return R"({"ok":false,"reason":"invalid-pointer-coordinate","backend":"macos"})";
  CGEventRef event = CGEventCreateMouseEvent(
      nullptr, kCGEventMouseMoved, CGPointMake(x, y), kCGMouseButtonLeft);
  if (!event)
    return R"({"ok":false,"reason":"mouse-event-create-failed","backend":"macos"})";
  CGEventPost(kCGHIDEventTap, event);
  CFRelease(event);
  return input_status("move", accessibility_trusted());
}

std::string click_pointer(double x, double y, int button) {
  if (!finite_point(x, y) || (button != 0 && button != 1))
    return R"({"ok":false,"reason":"invalid-click","backend":"macos"})";
  const CGMouseButton mouse_button = button == 0 ? kCGMouseButtonLeft : kCGMouseButtonRight;
  const CGEventType down = button == 0 ? kCGEventLeftMouseDown : kCGEventRightMouseDown;
  const CGEventType up = button == 0 ? kCGEventLeftMouseUp : kCGEventRightMouseUp;
  CGEventRef press = CGEventCreateMouseEvent(nullptr, down, CGPointMake(x, y), mouse_button);
  CGEventRef release = CGEventCreateMouseEvent(nullptr, up, CGPointMake(x, y), mouse_button);
  if (!press || !release) {
    if (press) CFRelease(press);
    if (release) CFRelease(release);
    return R"({"ok":false,"reason":"mouse-event-create-failed","backend":"macos"})";
  }
  CGEventPost(kCGHIDEventTap, press);
  CGEventPost(kCGHIDEventTap, release);
  CFRelease(press);
  CFRelease(release);
  return input_status(button == 0 ? "left-click" : "right-click", accessibility_trusted());
}

std::string scroll_pointer(double x, double y, double delta_y) {
  if (!finite_point(x, y) || !std::isfinite(delta_y) || delta_y == 0)
    return R"({"ok":false,"reason":"invalid-scroll","backend":"macos"})";
  CGEventRef scroll = CGEventCreateScrollWheelEvent(
      nullptr,
      kCGScrollEventUnitPixel,
      2,
      static_cast<int32_t>(std::lround(delta_y)),
      0);
  if (!scroll)
    return R"({"ok":false,"reason":"scroll-event-create-failed","backend":"macos"})";
  CGEventSetLocation(scroll, CGPointMake(x, y));
  CGEventPost(kCGHIDEventTap, scroll);
  CFRelease(scroll);
  return input_status("scroll", accessibility_trusted());
}

std::string drag_pointer(double start_x, double start_y, double end_x, double end_y) {
  if (!finite_point(start_x, start_y) || !finite_point(end_x, end_y))
    return R"({"ok":false,"reason":"invalid-drag","backend":"macos"})";
  CGEventRef move_to_start = CGEventCreateMouseEvent(
      nullptr,
      kCGEventMouseMoved,
      CGPointMake(start_x, start_y),
      kCGMouseButtonLeft);
  if (!move_to_start)
    return R"({"ok":false,"reason":"mouse-event-create-failed","backend":"macos"})";
  CGEventSetFlags(move_to_start, kCGEventFlagMaskNonCoalesced);
  CGEventPost(kCGHIDEventTap, move_to_start);
  CFRelease(move_to_start);
  std::this_thread::sleep_for(std::chrono::milliseconds(24));

  CGEventRef press = CGEventCreateMouseEvent(
      nullptr,
      kCGEventLeftMouseDown,
      CGPointMake(start_x, start_y),
      kCGMouseButtonLeft);
  if (!press)
    return R"({"ok":false,"reason":"mouse-event-create-failed","backend":"macos"})";
  CGEventPost(kCGHIDEventTap, press);
  const int64_t event_number = CGEventGetIntegerValueField(press, kCGMouseEventNumber);
  CFRelease(press);

  auto release_drag = [&](double x, double y) {
    CGEventRef release = CGEventCreateMouseEvent(
        nullptr,
        kCGEventLeftMouseUp,
        CGPointMake(x, y),
        kCGMouseButtonLeft);
    if (!release) return false;
    CGEventSetIntegerValueField(release, kCGMouseEventNumber, event_number);
    CGEventSetIntegerValueField(release, kCGMouseEventClickState, 1);
    CGEventSetFlags(release, kCGEventFlagMaskNonCoalesced);
    CGEventPost(kCGHIDEventTap, release);
    CFRelease(release);
    return true;
  };

  constexpr int steps = 16;
  double previous_x = start_x;
  double previous_y = start_y;
  for (int index = 1; index <= steps; index++) {
    const double fraction = static_cast<double>(index) / steps;
    const double x = start_x + (end_x - start_x) * fraction;
    const double y = start_y + (end_y - start_y) * fraction;
    CGEventRef move = CGEventCreateMouseEvent(
        nullptr,
        kCGEventLeftMouseDragged,
        CGPointMake(x, y),
        kCGMouseButtonLeft);
    if (!move) {
      release_drag(x, y);
      return R"({"ok":false,"reason":"mouse-drag-event-create-failed","backend":"macos"})";
    }
    CGEventSetIntegerValueField(move, kCGMouseEventNumber, event_number);
    CGEventSetIntegerValueField(
        move, kCGMouseEventDeltaX, static_cast<int64_t>(std::lround(x - previous_x)));
    CGEventSetIntegerValueField(
        move, kCGMouseEventDeltaY, static_cast<int64_t>(std::lround(y - previous_y)));
    CGEventSetFlags(move, kCGEventFlagMaskNonCoalesced);
    CGEventPost(kCGHIDEventTap, move);
    CFRelease(move);
    previous_x = x;
    previous_y = y;
    std::this_thread::sleep_for(std::chrono::milliseconds(8));
  }

  if (!release_drag(end_x, end_y))
    return R"({"ok":false,"reason":"mouse-event-create-failed","backend":"macos"})";
  return input_status("drag", accessibility_trusted());
}

std::string press_key(const std::string& key) {
  const CGKeyCode code = key_code(key);
  if (code == UINT16_MAX)
    return R"({"ok":false,"reason":"unsupported-key","backend":"macos"})";
  CGEventRef down = CGEventCreateKeyboardEvent(nullptr, code, true);
  CGEventRef up = CGEventCreateKeyboardEvent(nullptr, code, false);
  if (!down || !up) {
    if (down) CFRelease(down);
    if (up) CFRelease(up);
    return R"({"ok":false,"reason":"keyboard-event-create-failed","backend":"macos"})";
  }
  CGEventPost(kCGHIDEventTap, down);
  CGEventPost(kCGHIDEventTap, up);
  CFRelease(down);
  CFRelease(up);
  return input_status(key.c_str(), accessibility_trusted());
}

std::string press_shortcut(const std::string& modifier, const std::string& key) {
  const CGKeyCode code = key_code(key);
  const CGEventFlags flags = shortcut_flags(modifier);
  if (code == UINT16_MAX || flags == 0)
    return R"({"ok":false,"reason":"unsupported-shortcut","backend":"macos"})";
  CGEventRef down = CGEventCreateKeyboardEvent(nullptr, code, true);
  CGEventRef up = CGEventCreateKeyboardEvent(nullptr, code, false);
  if (!down || !up) {
    if (down) CFRelease(down);
    if (up) CFRelease(up);
    return R"({"ok":false,"reason":"keyboard-event-create-failed","backend":"macos"})";
  }
  CGEventSetFlags(down, flags);
  CGEventSetFlags(up, flags);
  CGEventPost(kCGHIDEventTap, down);
  CGEventPost(kCGHIDEventTap, up);
  CFRelease(down);
  CFRelease(up);
  return input_status("shortcut", accessibility_trusted());
}

std::string type_text(const std::string& text) {
  if (text.empty() || text.size() > 4096)
    return R"({"ok":false,"reason":"invalid-text","backend":"macos"})";
  @autoreleasepool {
    NSString* string = [[NSString alloc]
        initWithBytes:text.data()
               length:text.size()
             encoding:NSUTF8StringEncoding];
    if (!string)
      return R"({"ok":false,"reason":"invalid-utf8-text","backend":"macos"})";
    const NSUInteger length = [string length];
    std::vector<UniChar> characters(length);
    [string getCharacters:characters.data() range:NSMakeRange(0, length)];
    for (NSUInteger index = 0; index < length;) {
      NSUInteger count = 1;
      if (index + 1 < length &&
          CFStringIsSurrogateHighCharacter(characters[index]) &&
          CFStringIsSurrogateLowCharacter(characters[index + 1]))
        count = 2;
      TextKey text_key;
      const bool has_ascii_key =
          count == 1 && ascii_text_key(characters[index], text_key);
      const CGKeyCode code = has_ascii_key ? text_key.code : 0;
      CGEventRef down = CGEventCreateKeyboardEvent(nullptr, code, true);
      CGEventRef up = CGEventCreateKeyboardEvent(nullptr, code, false);
      if (!down || !up) {
        if (down) CFRelease(down);
        if (up) CFRelease(up);
        return R"({"ok":false,"reason":"keyboard-event-create-failed","backend":"macos"})";
      }
      if (has_ascii_key) {
        CGEventSetFlags(down, text_key.flags);
        CGEventSetFlags(up, text_key.flags);
      } else {
        CGEventKeyboardSetUnicodeString(down, count, characters.data() + index);
      }
      CGEventPost(kCGHIDEventTap, down);
      CGEventPost(kCGHIDEventTap, up);
      CFRelease(down);
      CFRelease(up);
      index += count;
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    return input_status("type", accessibility_trusted());
  }
}

}  // namespace iinatan::native
