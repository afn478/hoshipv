#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace iinatan::http {

struct Request {
  std::string method = "GET";
  std::string url;
  std::vector<std::string> headers;
  std::string body;
  int timeout_ms = 8000;
  uint64_t max_bytes = 4 * 1024 * 1024;
};

struct Response {
  long status = 0;
  std::string final_url;
  std::string content_type;
  std::string body;
};

Response perform(const Request& request);
void write_response_json(const Response& response, const std::filesystem::path& output);
const char* version();

}  // namespace iinatan::http
