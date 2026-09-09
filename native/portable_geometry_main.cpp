#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>

#include "ass_geometry.hpp"
#include "media_demux.hpp"
#include "worker_protocol.hpp"

namespace fs = std::filesystem;

namespace {

constexpr const char* kWrapperVersion = "portable-ass-geometry-1.0.0";
#ifndef IINATAN_ASS_GEOMETRY_PATCH
#define IINATAN_ASS_GEOMETRY_PATCH "libass-0.17.5-iinatan-unit-ids-v2"
#endif
constexpr size_t kMaxRequestBytes = 4 * 1024 * 1024;

std::string json_quote(const std::string& value) {
  std::string result;
  result.reserve(value.size() + 16);
  for (const unsigned char character : value) {
    switch (character) {
      case '\\': result += "\\\\"; break;
      case '"': result += "\\\""; break;
      case '\b': result += "\\b"; break;
      case '\f': result += "\\f"; break;
      case '\n': result += "\\n"; break;
      case '\r': result += "\\r"; break;
      case '\t': result += "\\t"; break;
      default:
        if (character < 0x20) {
          constexpr char hex[] = "0123456789abcdef";
          result += "\\u00";
          result += hex[(character >> 4) & 0xf];
          result += hex[character & 0xf];
        } else {
          result += static_cast<char>(character);
        }
    }
  }
  return '"' + result + '"';
}

std::string error_json(const std::string& message) {
  return "{\"ok\":false,\"error\":" + json_quote(message) + "}\n";
}

std::string read_file_limited(const fs::path& path) {
  std::error_code error;
  const uintmax_t size = fs::file_size(path, error);
  if (error) throw std::runtime_error("could not inspect geometry request");
  if (size > kMaxRequestBytes)
    throw std::runtime_error("geometry request exceeds the size limit");
  std::ifstream input(path, std::ios::binary);
  if (!input) throw std::runtime_error("could not open geometry request");
  std::ostringstream contents;
  contents << input.rdbuf();
  if (input.bad()) throw std::runtime_error("could not read geometry request");
  return contents.str();
}

std::string architecture_name() {
#if defined(_WIN32) && defined(_M_X64)
  return "x86-64";
#elif defined(__x86_64__) || defined(__amd64__)
  return "x86-64";
#elif defined(__aarch64__) || defined(_M_ARM64)
  return "arm64";
#else
  return "unknown";
#endif
}

void print_version() {
  std::cout
      << "{\"ok\":true,\"name\":\"iinatan-native-geometry\","
      << "\"wrapperVersion\":" << json_quote(kWrapperVersion)
      << ",\"worker\":false,\"fontMetrics\":false,"
      << "\"assGeometry\":{"
      << "\"protocol\":" << iinatan::ass::kAssGeometryProtocol
      << ",\"available\":true,\"patch\":"
      << json_quote(IINATAN_ASS_GEOMETRY_PATCH)
      << ",\"envelopeRects\":true,\"observedPlain\":true,"
      << "\"ffmpeg\":" << json_quote(iinatan::ass::ffmpeg_geometry_version())
      << ",\"libass\":" << json_quote(iinatan::ass::libass_geometry_version())
      << ",\"architecture\":" << json_quote(architecture_name())
      << ",\"fontProvider\":"
#if defined(_WIN32)
      << "\"directwrite\""
#else
      << "\"fontconfig\""
#endif
      << "},\"dictionary\":{\"available\":false},"
      << "\"bitmapOcr\":{\"protocol\":1,\"available\":false}}\n";
}

void run_geometry(int argc, char** argv) {
  if (argc < 3)
    throw std::runtime_error("usage: ass-geometry <request_json_path> [...]");
  iinatan::ass::GeometryService service;
  for (int index = 2; index < argc; ++index) {
    const auto root = iinatan::protocol::Json::parse(
        read_file_limited(fs::u8path(argv[index])));
    if (!iinatan::protocol::is_geometry_request(root))
      throw std::runtime_error("request type must be ass-geometry");
    std::cout
        << service.handle(iinatan::protocol::parse_geometry_request(root)).dump()
        << '\n';
  }
}

}  // namespace

int main(int argc, char** argv) {
  try {
    if (argc < 2)
      throw std::runtime_error("expected command: ass-geometry or version");
    const std::string command = argv[1];
    if (command == "version") print_version();
    else if (command == "ass-geometry") run_geometry(argc, argv);
    else throw std::runtime_error("unknown command: " + command);
    return 0;
  } catch (const std::exception& exception) {
    std::cout << error_json(exception.what());
    return 1;
  }
}
