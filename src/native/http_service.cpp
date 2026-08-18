#include "http_service.hpp"

#include <algorithm>
#include <fstream>
#include <stdexcept>

#ifdef IINATAN_HTTP
#include <curl/curl.h>
#endif

#include "worker_protocol.hpp"

namespace iinatan::http {
namespace {

bool allowed_url(const std::string& url) {
  return url.rfind("https://", 0) == 0 || url.rfind("http://", 0) == 0;
}

#ifdef IINATAN_HTTP
struct Sink {
  std::string body;
  uint64_t limit = 0;
  bool exceeded = false;
};

size_t write_body(char* data, size_t size, size_t count, void* opaque) {
  Sink& sink = *static_cast<Sink*>(opaque);
  const size_t bytes = size * count;
  if (bytes > sink.limit || sink.body.size() > sink.limit - bytes) {
    sink.exceeded = true;
    return 0;
  }
  sink.body.append(data, bytes);
  return bytes;
}
#endif

}  // namespace

Response perform(const Request& request) {
#ifndef IINATAN_HTTP
  throw std::runtime_error("HTTP support is unavailable");
#else
  if (!allowed_url(request.url))
    throw std::runtime_error("HTTP URL must use http or https");
  if (request.timeout_ms < 100 || request.timeout_ms > 120000 ||
      request.max_bytes == 0 || request.max_bytes > 512ULL * 1024 * 1024)
    throw std::runtime_error("invalid HTTP limits");
  CURL* curl = curl_easy_init();
  if (!curl) throw std::runtime_error("could not initialize libcurl");
  Sink sink{{}, request.max_bytes, false};
  curl_slist* headers = nullptr;
  for (const std::string& header : request.headers)
    headers = curl_slist_append(headers, header.c_str());
  curl_easy_setopt(curl, CURLOPT_URL, request.url.c_str());
  curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, request.method.c_str());
  curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
  curl_easy_setopt(curl, CURLOPT_MAXREDIRS, 5L);
  curl_easy_setopt(curl, CURLOPT_PROTOCOLS_STR, "http,https");
  curl_easy_setopt(curl, CURLOPT_REDIR_PROTOCOLS_STR, "http,https");
  curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, std::min(5000, request.timeout_ms));
  curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, request.timeout_ms);
  curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
  curl_easy_setopt(curl, CURLOPT_USERAGENT, "iinatan/3");
  curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_body);
  curl_easy_setopt(curl, CURLOPT_WRITEDATA, &sink);
  if (headers) curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
  if (!request.body.empty()) {
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, request.body.data());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE_LARGE, static_cast<curl_off_t>(request.body.size()));
  }
  const CURLcode result = curl_easy_perform(curl);
  long status = 0;
  char* final_url = nullptr;
  char* content_type = nullptr;
  curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
  curl_easy_getinfo(curl, CURLINFO_EFFECTIVE_URL, &final_url);
  curl_easy_getinfo(curl, CURLINFO_CONTENT_TYPE, &content_type);
  const std::string effective_url = final_url ? final_url : request.url;
  const std::string effective_content_type = content_type ? content_type : "";
  if (headers) curl_slist_free_all(headers);
  curl_easy_cleanup(curl);
  if (sink.exceeded) throw std::runtime_error("HTTP response exceeded size limit");
  if (result != CURLE_OK) throw std::runtime_error(std::string("HTTP request failed: ") + curl_easy_strerror(result));
  if (request.url.rfind("https://", 0) == 0 &&
      effective_url.rfind("https://", 0) != 0)
    throw std::runtime_error("HTTPS request redirected to an insecure URL");
  if (status < 200 || status >= 300)
    throw std::runtime_error("HTTP request returned status " + std::to_string(status));
  return Response{
      status, effective_url, effective_content_type, std::move(sink.body)};
#endif
}

void write_response_json(const Response& response, const std::filesystem::path& output) {
  protocol::Json body = protocol::Json::Object{
      {"status", static_cast<int64_t>(response.status)},
      {"finalUrl", response.final_url},
      {"contentType", response.content_type},
      {"body", response.body}};
  std::filesystem::create_directories(output.parent_path());
  std::filesystem::path temporary = output;
  temporary += ".tmp";
  std::ofstream stream(temporary, std::ios::binary | std::ios::trunc);
  if (!stream) throw std::runtime_error("could not create HTTP response file");
  stream << body.dump() << '\n';
  stream.close();
  std::error_code error;
  std::filesystem::rename(temporary, output, error);
  if (error) {
    std::filesystem::remove(output, error);
    error.clear();
    std::filesystem::rename(temporary, output, error);
  }
  if (error) throw std::runtime_error("could not commit HTTP response file");
}

const char* version() {
#ifdef IINATAN_HTTP
  return LIBCURL_VERSION;
#else
  return "unavailable";
#endif
}

}  // namespace iinatan::http
