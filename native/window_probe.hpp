#pragma once

#include <string>

namespace iinatan::native {

std::string probe_window(int pid, const std::string& window_id);
std::string activate_window(int pid, const std::string& window_id);

}  // namespace iinatan::native
