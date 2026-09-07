#pragma once

#include <string>

namespace iinatan::native {

std::string capture_desktop(const std::string& output_path);
std::string request_post_event_access();
std::string move_pointer(double x, double y);
std::string click_pointer(double x, double y, int button);
std::string scroll_pointer(double x, double y, double delta_y);
std::string drag_pointer(double start_x, double start_y, double end_x, double end_y);
std::string press_key(const std::string& key);

}  // namespace iinatan::native
