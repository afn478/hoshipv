#include "desktop_test.hpp"

#include <charconv>
#include <iostream>
#include <string>

namespace {

void usage() {
  std::cerr << "usage: iinatan-desktop-test --capture PATH\n"
            << "       iinatan-desktop-test --request-post-event\n"
            << "       iinatan-desktop-test --activate PID\n"
            << "       iinatan-desktop-test --activate-shortcut PID MODIFIER KEY\n"
            << "       iinatan-desktop-test --move X Y\n"
            << "       iinatan-desktop-test --click X Y [left|right]\n"
            << "       iinatan-desktop-test --scroll X Y DELTA_Y\n"
            << "       iinatan-desktop-test --drag START_X START_Y END_X END_Y\n"
            << "       iinatan-desktop-test --key KEY\n"
            << "       iinatan-desktop-test --shortcut MODIFIER KEY\n"
            << "       iinatan-desktop-test --type TEXT\n";
}

bool number(const char* value, double& result) {
  try {
    result = std::stod(value);
    return true;
  } catch (...) {
    return false;
  }
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    usage();
    return 2;
  }
  const std::string command(argv[1]);
  if (command == "--capture" && argc == 3) {
    std::cout << iinatan::native::capture_desktop(argv[2]) << '\n';
    return 0;
  }
  if (command == "--request-post-event" && argc == 2) {
    std::cout << iinatan::native::request_post_event_access() << '\n';
    return 0;
  }
  if (command == "--activate" && argc == 3) {
    try {
      const int pid = std::stoi(argv[2]);
      std::cout << iinatan::native::activate_process(pid) << '\n';
      return 0;
    } catch (...) {
      usage();
      return 2;
    }
  }
  if (command == "--activate-shortcut" && argc == 5) {
    try {
      const int pid = std::stoi(argv[2]);
      const std::string activation = iinatan::native::activate_process(pid);
      if (activation.find(R"("foregroundVerified":true)") == std::string::npos) {
        std::cout << activation << '\n';
        return 0;
      }
      std::cout << iinatan::native::press_shortcut(argv[3], argv[4]) << '\n';
      return 0;
    } catch (...) {
      usage();
      return 2;
    }
  }
  if (command == "--move" && argc == 4) {
    double x = 0;
    double y = 0;
    if (!number(argv[2], x) || !number(argv[3], y)) {
      usage();
      return 2;
    }
    std::cout << iinatan::native::move_pointer(x, y) << '\n';
    return 0;
  }
  if (command == "--click" && (argc == 4 || argc == 5)) {
    double x = 0;
    double y = 0;
    if (!number(argv[2], x) || !number(argv[3], y)) {
      usage();
      return 2;
    }
    int button = 0;
    if (argc == 5) {
      const std::string value(argv[4]);
      if (value == "right") button = 1;
      else if (value != "left") {
        usage();
        return 2;
      }
    }
    std::cout << iinatan::native::click_pointer(x, y, button) << '\n';
    return 0;
  }
  if (command == "--scroll" && argc == 5) {
    double x = 0;
    double y = 0;
    double delta_y = 0;
    if (!number(argv[2], x) || !number(argv[3], y) || !number(argv[4], delta_y)) {
      usage();
      return 2;
    }
    std::cout << iinatan::native::scroll_pointer(x, y, delta_y) << '\n';
    return 0;
  }
  if (command == "--drag" && argc == 6) {
    double start_x = 0;
    double start_y = 0;
    double end_x = 0;
    double end_y = 0;
    if (!number(argv[2], start_x) || !number(argv[3], start_y) ||
        !number(argv[4], end_x) || !number(argv[5], end_y)) {
      usage();
      return 2;
    }
    std::cout << iinatan::native::drag_pointer(start_x, start_y, end_x, end_y) << '\n';
    return 0;
  }
  if (command == "--key" && argc == 3) {
    std::cout << iinatan::native::press_key(argv[2]) << '\n';
    return 0;
  }
  if (command == "--shortcut" && argc == 4) {
    std::cout << iinatan::native::press_shortcut(argv[2], argv[3]) << '\n';
    return 0;
  }
  if (command == "--type" && argc == 3) {
    std::cout << iinatan::native::type_text(argv[2]) << '\n';
    return 0;
  }
  usage();
  return 2;
}
