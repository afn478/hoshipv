#pragma once

#include <string>

namespace iinatan::native {

std::string probe_window(int pid, const std::string& window_id);
std::string activate_window(int pid, const std::string& window_id);
std::string set_window_bounds(
    int pid,
    const std::string& window_id,
    int x,
    int y,
    int width,
    int height);
std::string disable_window_transitions(const std::string& window_id);

}  // namespace iinatan::native
