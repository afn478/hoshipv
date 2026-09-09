#include "window_probe.hpp"

#include <charconv>
#include <iostream>
#include <string>

namespace {

void usage() {
  std::cerr << "usage: iinatan-window-probe --pid PID [--window-id ID] [--activate]\n"
            << "       iinatan-window-probe --pid PID [--window-id ID] --set-bounds X Y WIDTH HEIGHT\n"
            << "       iinatan-window-probe --window-id ID --disable-transitions\n";
}

}  // namespace

int main(int argc, char** argv) {
  int pid = 0;
  std::string window_id;
  bool activate = false;
  bool disable_transitions = false;
  bool set_bounds = false;
  int bounds[4]{};
  for (int index = 1; index < argc; ++index) {
    const std::string argument(argv[index]);
    if (argument == "--pid" && index + 1 < argc) {
      const auto* begin = argv[++index];
      const auto* end = begin + std::string(begin).size();
      const auto result = std::from_chars(begin, end, pid);
      if (result.ec != std::errc() || pid <= 0) {
        usage();
        return 2;
      }
    } else if (argument == "--window-id" && index + 1 < argc) {
      window_id = argv[++index];
    } else if (argument == "--activate") {
      activate = true;
    } else if (argument == "--set-bounds" && index + 4 < argc) {
      for (int bound = 0; bound < 4; ++bound) {
        const auto* begin = argv[++index];
        const auto* end = begin + std::string(begin).size();
        const auto result = std::from_chars(begin, end, bounds[bound]);
        if (result.ec != std::errc()) {
          usage();
          return 2;
        }
      }
      set_bounds = true;
    } else if (argument == "--disable-transitions") {
      disable_transitions = true;
    } else if (argument == "--help") {
      usage();
      return 0;
    } else {
      usage();
      return 2;
    }
  }
  if (disable_transitions) {
    if (window_id.empty()) {
      usage();
      return 2;
    }
    std::cout << iinatan::native::disable_window_transitions(window_id) << '\n';
    return 0;
  }
  if (set_bounds) {
    if (pid <= 0 && window_id.empty()) {
      usage();
      return 2;
    }
    std::cout << iinatan::native::set_window_bounds(
                     pid, window_id, bounds[0], bounds[1], bounds[2], bounds[3])
              << '\n';
    return 0;
  }
  if (pid <= 0) {
    usage();
    return 2;
  }
  std::cout << (activate ? iinatan::native::activate_window(pid, window_id) : iinatan::native::probe_window(pid, window_id)) << '\n';
  return 0;
}
