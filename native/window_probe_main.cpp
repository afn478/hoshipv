#include "window_probe.hpp"

#include <charconv>
#include <iostream>
#include <string>

namespace {

void usage() {
  std::cerr << "usage: iinatan-window-probe --pid PID [--window-id ID] [--activate]\n";
}

}  // namespace

int main(int argc, char** argv) {
  int pid = 0;
  std::string window_id;
  bool activate = false;
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
    } else if (argument == "--help") {
      usage();
      return 0;
    } else {
      usage();
      return 2;
    }
  }
  if (pid <= 0) {
    usage();
    return 2;
  }
  std::cout << (activate ? iinatan::native::activate_window(pid, window_id) : iinatan::native::probe_window(pid, window_id)) << '\n';
  return 0;
}
