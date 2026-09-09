#include <algorithm>
#include <chrono>
#include <cctype>
#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <signal.h>
#include <sys/types.h>
#include <unistd.h>
#endif

#include "hoshidicts/deinflector.hpp"
#include "hoshidicts/importer.hpp"
#include "hoshidicts/lookup.hpp"
#include "hoshidicts/query.hpp"
#include "worker_protocol.hpp"
#ifdef _WIN32
#include "windows_controller.hpp"
#endif

namespace fs = std::filesystem;

namespace {

constexpr const char* kWrapperVersion = "portable-1.0.0";
constexpr const char* kHoshidictsRevision =
    "a28d82eb0f169b8ceff79e8c99ffe0b96709ab27";
constexpr size_t kMaxRequestBytes = 4 * 1024 * 1024;
constexpr size_t kMaxResponseBytes = 8 * 1024 * 1024;

std::string json_escape(const std::string& value) {
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
  return result;
}

std::string json_quote(const std::string& value) {
  return '"' + json_escape(value) + '"';
}

std::string error_json(const std::string& message) {
  return "{\"ok\":false,\"error\":" + json_quote(message) + "}\n";
}

void print_error(const std::string& message) { std::cout << error_json(message); }

std::string read_file(const fs::path& path) {
  std::ifstream input(path, std::ios::binary);
  if (!input) throw std::runtime_error("could not open " + path.string());
  std::ostringstream contents;
  contents << input.rdbuf();
  if (input.bad()) throw std::runtime_error("could not read " + path.string());
  return contents.str();
}

std::string read_file_limited(const fs::path& path, size_t maximum) {
  std::error_code error;
  const uintmax_t size = fs::file_size(path, error);
  if (error) throw std::runtime_error("could not inspect " + path.string());
  if (size > maximum)
    throw std::runtime_error("request file exceeds the size limit");
  return read_file(path);
}

void write_file_atomic(const fs::path& path, const std::string& body) {
  fs::create_directories(path.parent_path());
  fs::path temporary = path;
  temporary += ".tmp";
  {
    std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
    if (!output) throw std::runtime_error("could not open " + temporary.string());
    output << body;
    output.flush();
    if (!output) throw std::runtime_error("could not write " + temporary.string());
  }
  std::error_code error;
  fs::rename(temporary, path, error);
  if (error) {
    fs::remove(path, error);
    fs::rename(temporary, path, error);
  }
  if (error) throw std::runtime_error("could not publish " + path.string());
}

bool process_exists(int pid) {
  if (pid <= 0) return true;
#ifdef _WIN32
  HANDLE handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE,
                              static_cast<DWORD>(pid));
  if (!handle) return GetLastError() == ERROR_ACCESS_DENIED;
  DWORD status = 0;
  const bool exists = GetExitCodeProcess(handle, &status) &&
                      status == STILL_ACTIVE;
  CloseHandle(handle);
  return exists;
#else
  if (::kill(static_cast<pid_t>(pid), 0) == 0) return true;
  return errno == EPERM;
#endif
}

bool valid_request_id(const std::string& value) {
  if (value.empty() || value.size() > 160) return false;
  return std::all_of(value.begin(), value.end(), [](unsigned char character) {
    return std::isalnum(character) || character == '-' || character == '_' ||
           character == '.' || character == ':';
  });
}

int to_int(const std::string& value, int fallback) {
  try {
    return std::stoi(value);
  } catch (...) {
    return fallback;
  }
}

std::string utf8_prefix(const std::string& value, size_t max_bytes) {
  std::string result;
  result.reserve(std::min(max_bytes, value.size()));
  for (size_t index = 0; index < value.size();) {
    const unsigned char lead = static_cast<unsigned char>(value[index]);
    size_t width = 1;
    if ((lead & 0x80) == 0) width = 1;
    else if ((lead & 0xe0) == 0xc0) width = 2;
    else if ((lead & 0xf0) == 0xe0) width = 3;
    else if ((lead & 0xf8) == 0xf0) width = 4;
    if (index + width > value.size() || result.size() + width > max_bytes)
      break;
    result.append(value, index, width);
    index += width;
  }
  if (result.size() < value.size()) result += "…";
  return result;
}

std::string compact_glossary(const std::string& value) {
  const size_t first = value.find_first_not_of(" \t\r\n");
  if (first != std::string::npos &&
      (value[first] == '[' || value[first] == '{'))
    return value;
  return utf8_prefix(value, 2000);
}

void append_pitch_positions(
    std::ostringstream& output, const std::vector<Pitch>& pitches) {
  output << '[';
  for (size_t index = 0; index < pitches.size(); ++index) {
    if (index) output << ',';
    output << pitches[index].position;
  }
  output << ']';
}

void append_term_metadata(
    std::ostringstream& output, const TermResult& term) {
  output << ",\"frequencies\":[";
  for (size_t index = 0; index < term.frequencies.size(); ++index) {
    const auto& entry = term.frequencies[index];
    if (index) output << ',';
    output << "{\"dict\":" << json_quote(entry.dict_name)
           << ",\"frequencies\":[";
    for (size_t frequency = 0; frequency < entry.frequencies.size(); ++frequency) {
      if (frequency) output << ',';
      const auto& value = entry.frequencies[frequency];
      output << "{\"value\":" << value.value
             << ",\"displayValue\":" << json_quote(value.display_value)
             << '}';
    }
    output << "]}";
  }
  output << "],\"pitches\":[";
  for (size_t index = 0; index < term.pitches.size(); ++index) {
    const auto& entry = term.pitches[index];
    if (index) output << ',';
    output << "{\"dict\":" << json_quote(entry.dict_name)
           << ",\"positions\":";
    append_pitch_positions(output, entry.pitches);
    output << ",\"transcriptions\":[";
    for (size_t transcription = 0;
         transcription < entry.transcriptions.size(); ++transcription) {
      if (transcription) output << ',';
      output << json_quote(entry.transcriptions[transcription]);
    }
    output << "]}";
  }
  output << ']';
}

void append_glossaries(
    std::ostringstream& output, const TermResult& term, int max_glossaries) {
  output << "\"glossaries\":[";
  const size_t limit = std::min<size_t>(
      term.glossaries.size(), static_cast<size_t>(std::max(1, max_glossaries)));
  for (size_t index = 0; index < limit; ++index) {
    if (index) output << ',';
    const auto& glossary = term.glossaries[index];
    output << "{\"dict\":" << json_quote(glossary.dict_name)
           << ",\"glossary\":" << json_quote(compact_glossary(glossary.glossary))
           << ",\"definitionTags\":" << json_quote(glossary.definition_tags)
           << ",\"termTags\":" << json_quote(glossary.term_tags) << '}';
  }
  output << ']';
}

void append_term(
    std::ostringstream& output, const TermResult& term,
    const std::string& matched, const std::string& deinflected,
    int preprocessor_steps, int max_glossaries) {
  output << "{\"matched\":" << json_quote(matched)
         << ",\"deinflected\":" << json_quote(deinflected)
         << ",\"preprocessorSteps\":" << preprocessor_steps
         << ",\"trace\":[],\"term\":{\"expression\":"
         << json_quote(term.expression) << ",\"reading\":"
         << json_quote(term.reading) << ",\"rules\":"
         << json_quote(term.rules) << ',';
  append_glossaries(output, term, max_glossaries);
  append_term_metadata(output, term);
  output << "}}";
}

void add_all_dictionary_types(
    DictionaryQuery& query, const std::vector<std::string>& paths) {
  for (const auto& path : paths) {
    query.add_term_dict(path);
    query.add_freq_dict(path);
    query.add_pitch_dict(path);
  }
}

std::vector<size_t> utf8_prefix_end_offsets(
    const std::string& value, size_t max_chars) {
  std::vector<size_t> offsets;
  for (size_t index = 0; index < value.size() && offsets.size() < max_chars;) {
    const unsigned char lead = static_cast<unsigned char>(value[index]);
    size_t width = 1;
    if ((lead & 0x80) == 0) width = 1;
    else if ((lead & 0xe0) == 0xc0) width = 2;
    else if ((lead & 0xf0) == 0xe0) width = 3;
    else if ((lead & 0xf8) == 0xf0) width = 4;
    if (index + width > value.size()) break;
    index += width;
    offsets.push_back(index);
  }
  return offsets;
}

std::string lookup_to_json(
    Lookup& lookup, const std::string& text, int max_results,
    int scan_length, int max_glossaries) {
  const auto results = lookup.lookup(
      text, max_results, static_cast<size_t>(std::max(1, scan_length)));
  std::ostringstream output;
  output << "{\"ok\":true,\"lookupString\":" << json_quote(text)
         << ",\"scanLength\":" << scan_length
         << ",\"resultCount\":" << results.size() << ",\"results\":[";
  for (size_t index = 0; index < results.size(); ++index) {
    if (index) output << ',';
    const auto& result = results[index];
    append_term(output, result.term, result.matched, result.deinflected,
                result.preprocessor_steps, max_glossaries);
  }
  output << "]}\n";
  return output.str();
}

std::string exact_lookup_to_json(
    DictionaryQuery& query, const std::string& text, int max_results,
    int max_glossaries) {
  auto terms = query.query(text);
  if (terms.size() > static_cast<size_t>(max_results))
    terms.resize(static_cast<size_t>(std::max(1, max_results)));
  std::ostringstream output;
  output << "{\"ok\":true,\"lookupString\":" << json_quote(text)
         << ",\"scanLength\":0,\"mode\":\"exact\",\"resultCount\":"
         << terms.size() << ",\"results\":[";
  for (size_t index = 0; index < terms.size(); ++index) {
    if (index) output << ',';
    append_term(output, terms[index], text, text, 0, max_glossaries);
  }
  output << "]}\n";
  return output.str();
}

std::string prefix_lookup_to_json(
    DictionaryQuery& query, const std::string& text, int max_results,
    int scan_length, int max_glossaries) {
  const auto offsets = utf8_prefix_end_offsets(
      text, static_cast<size_t>(std::max(1, scan_length)));
  std::string matched;
  std::vector<TermResult> terms;
  for (size_t index = offsets.size(); index > 0; --index) {
    const std::string candidate = text.substr(0, offsets[index - 1]);
    auto found = query.query(candidate);
    if (!found.empty()) {
      matched = candidate;
      terms = std::move(found);
      break;
    }
  }
  if (terms.size() > static_cast<size_t>(max_results))
    terms.resize(static_cast<size_t>(std::max(1, max_results)));
  std::ostringstream output;
  output << "{\"ok\":true,\"lookupString\":" << json_quote(text)
         << ",\"scanLength\":" << scan_length
         << ",\"mode\":\"prefix\",\"resultCount\":" << terms.size()
         << ",\"results\":[";
  for (size_t index = 0; index < terms.size(); ++index) {
    if (index) output << ',';
    append_term(output, terms[index], matched, matched, 0, max_glossaries);
  }
  output << "]}\n";
  return output.str();
}

std::string field_string(
    const iinatan::protocol::Json& object, const std::string& key,
    const std::string& fallback = "") {
  const auto* value = object.find(key);
  return value ? value->string_or(fallback) : fallback;
}

int field_int(
    const iinatan::protocol::Json& object, const std::string& key,
    int fallback) {
  const auto* value = object.find(key);
  return value ? static_cast<int>(value->integer_or(fallback)) : fallback;
}

struct WorkerConfig {
  std::string fingerprint;
  std::vector<std::string> dictionaries;
};

std::string controller_capability_json() {
#ifdef _WIN32
  return iinatan::windows_controller::capability_json();
#else
  return "{\"protocol\":1,\"source\":\"browser-gamepad\",\"enabled\":false,"
         "\"products\":[\"gamepad\"],\"backend\":\"browser-api\"}";
#endif
}

WorkerConfig read_worker_config(const fs::path& path) {
  WorkerConfig config;
  std::ifstream input(path);
  std::string line;
  while (std::getline(input, line)) {
    const size_t separator = line.find('\t');
    if (separator == std::string::npos) continue;
    const std::string key = line.substr(0, separator);
    const std::string value = line.substr(separator + 1);
    if (key == "fingerprint") config.fingerprint = value;
    else if (key == "dict" && !value.empty()) config.dictionaries.push_back(value);
  }
  return config;
}

void print_import_result(const ImportResult& result) {
  const auto& counts = result.summary.counts;
  const auto meta = [&counts](const std::string& key) {
    const auto found = counts.termMeta.find(key);
    return found == counts.termMeta.end() ? size_t(0) : found->second;
  };
  std::cout << "{\"ok\":" << (result.success ? "true" : "false")
            << ",\"title\":" << json_quote(result.title)
            << ",\"term_count\":" << counts.terms.total
            << ",\"meta_count\":" << meta("total")
            << ",\"freq_count\":" << meta("freq")
            << ",\"pitch_count\":" << meta("pitch") + meta("ipa")
            << ",\"media_count\":" << counts.media.total
            << ",\"tag_count\":" << counts.tagMeta.total
            << ",\"errors\":[";
  if (!result.error.empty()) std::cout << json_quote(result.error);
  std::cout << ']';
  if (!result.success && !result.error.empty())
    std::cout << ",\"error\":" << json_quote(result.error);
  std::cout << "}\n";
}

void command_import(int argc, char** argv) {
  if (argc < 4)
    throw std::runtime_error("usage: import <zip_path> <output_dir> [--low-ram]");
  bool low_ram = true;
  for (int index = 4; index < argc; ++index) {
    const std::string argument = argv[index];
    if (argument == "--normal-ram") low_ram = false;
    if (argument == "--low-ram") low_ram = true;
  }
  const ImportResult result = dictionary_importer::import(
      argv[2], argv[3], low_ram);
  print_import_result(result);
  if (!result.success) throw std::runtime_error("dictionary import failed");
}

std::vector<std::string> parse_dictionary_paths(
    int argc, char** argv, std::string& text, int& max_results,
    int& scan_length, int& max_glossaries, std::string& mode) {
  std::vector<std::string> paths;
  max_results = 8;
  scan_length = 24;
  max_glossaries = 4;
  mode = "yomitan-japanese";
  for (int index = 2; index < argc; ++index) {
    const std::string argument = argv[index];
    if (argument == "--max-results" && index + 1 < argc)
      max_results = std::max(1, to_int(argv[++index], max_results));
    else if (argument == "--scan-length" && index + 1 < argc)
      scan_length = std::max(1, to_int(argv[++index], scan_length));
    else if (argument == "--max-glossaries" && index + 1 < argc)
      max_glossaries = std::max(1, to_int(argv[++index], max_glossaries));
    else if (argument == "--mode" && index + 1 < argc)
      mode = argv[++index];
    else if (argument == "--" && index + 1 < argc) {
      text = argv[++index];
      break;
    } else {
      paths.push_back(argument);
    }
  }
  return paths;
}

void command_lookup(int argc, char** argv) {
  std::string text;
  int max_results = 8;
  int scan_length = 24;
  int max_glossaries = 4;
  std::string mode;
  const auto paths = parse_dictionary_paths(
      argc, argv, text, max_results, scan_length, max_glossaries, mode);
  if (paths.empty() || text.empty())
    throw std::runtime_error("lookup requires dictionary paths and text");
  DictionaryQuery query;
  add_all_dictionary_types(query, paths);
  if (mode == "exact") {
    std::cout << exact_lookup_to_json(query, text, max_results, max_glossaries);
    return;
  }
  if (mode == "prefix") {
    std::cout << prefix_lookup_to_json(
        query, text, max_results, scan_length, max_glossaries);
    return;
  }
  Deinflector deinflector;
  Lookup lookup(query, deinflector);
  std::cout << lookup_to_json(
      lookup, text, max_results, scan_length, max_glossaries);
}

std::string lookup_request(
    DictionaryQuery& query, Lookup& lookup,
    const iinatan::protocol::Json& request) {
  const std::string text = field_string(request, "text");
  if (text.empty()) throw std::runtime_error("lookup request did not include text");
  const int max_results = std::max(1, field_int(request, "maxResults", 8));
  const int scan_length = std::max(1, field_int(request, "scanLength", 24));
  const int max_glossaries =
      std::max(1, field_int(request, "maxGlossaries", 4));
  const std::string mode = field_string(request, "mode", "yomitan-japanese");
  if (mode == "exact")
    return exact_lookup_to_json(query, text, max_results, max_glossaries);
  if (mode == "prefix")
    return prefix_lookup_to_json(
        query, text, max_results, scan_length, max_glossaries);
  return lookup_to_json(lookup, text, max_results, scan_length, max_glossaries);
}

void command_worker(int argc, char** argv) {
  if (argc < 3)
    throw std::runtime_error(
        "usage: worker <worker_dir> [--sleep-ms n] [--owner-pid pid]");
  const fs::path root = argv[2];
  int sleep_ms = 2;
  int owner_pid = 0;
  bool controller_enabled = false;
  for (int index = 3; index < argc; ++index) {
    const std::string argument = argv[index];
    if (argument == "--sleep-ms" && index + 1 < argc)
      sleep_ms = std::max(1, to_int(argv[++index], sleep_ms));
    else if (argument == "--owner-pid" && index + 1 < argc)
      owner_pid = std::max(0, to_int(argv[++index], 0));
    else if (argument == "--controller-enabled" && index + 1 < argc)
      controller_enabled = argv[++index] == std::string("true") ||
                           argv[index] == std::string("1");
  }
  const fs::path queue = root / "queue";
  const fs::path responses = root / "responses";
  const fs::path state = root / "state";
  const fs::path stop = root / "stop";
  fs::create_directories(queue);
  fs::create_directories(responses);
  fs::create_directories(state);
  std::error_code error;
  fs::remove(state / "ready.json", error);
  const WorkerConfig config = read_worker_config(root / "config.tsv");
  if (config.dictionaries.empty())
    throw std::runtime_error("worker config has no dictionaries");

  DictionaryQuery query;
  add_all_dictionary_types(query, config.dictionaries);
  Deinflector deinflector;
  Lookup lookup(query, deinflector);
  write_file_atomic(
      state / "ready.json",
      "{\"ok\":true,\"worker\":true,\"wrapperVersion\":" +
          json_quote(kWrapperVersion) + ",\"fingerprint\":" +
          json_quote(config.fingerprint) + ",\"dictCount\":" +
          std::to_string(config.dictionaries.size()) +
          ",\"hoshidictsRevision\":" +
          json_quote(kHoshidictsRevision) +
          ",\"controller\":" + controller_capability_json() +
          ",\"assGeometry\":{\"protocol\":1,\"available\":false,\"reason\":\"portable-dictionary-worker\"},\"fontMetrics\":false,\"bitmapOcr\":{\"protocol\":1,\"available\":false}}\n");

  const int active_sleep_ms = std::max(1, sleep_ms);
  const int idle_sleep_ms = std::max(active_sleep_ms, 16);
  int current_sleep_ms = active_sleep_ms;
  if (controller_enabled) {
#ifdef _WIN32
    write_file_atomic(
        state / "controller.json",
        iinatan::windows_controller::snapshot_json(
            iinatan::windows_controller::sample()));
#endif
  }
  auto owner_check = std::chrono::steady_clock::now() + std::chrono::seconds(1);
  while (!fs::exists(stop)) {
    if (owner_pid > 0 && std::chrono::steady_clock::now() >= owner_check) {
      if (!process_exists(owner_pid)) break;
      owner_check = std::chrono::steady_clock::now() + std::chrono::seconds(1);
    }
    std::vector<fs::path> requests;
    for (const auto& entry : fs::directory_iterator(queue, error)) {
      if (error) break;
      if (entry.is_regular_file(error) && entry.path().extension() == ".json")
        requests.push_back(entry.path());
    }
    std::sort(requests.begin(), requests.end());
    for (const auto& request_path : requests) {
      const std::string request_id = request_path.stem().string();
      if (!valid_request_id(request_id)) {
        fs::remove(request_path, error);
        continue;
      }
      const fs::path response_path = responses / (request_id + ".json");
      const fs::path committed_path = queue / (request_id + ".request");
      try {
        const fs::path body_path = fs::exists(committed_path)
                                       ? committed_path
                                       : request_path;
        const auto parsed = iinatan::protocol::Json::parse(
            read_file_limited(body_path, kMaxRequestBytes));
        if (!parsed.is_object()) throw std::runtime_error("lookup request must be an object");
        const std::string provided_id = field_string(parsed, "requestId");
        if (!provided_id.empty() && provided_id != request_id)
          throw std::runtime_error("requestId must match the queue filename");
        const std::string output = lookup_request(query, lookup, parsed);
        if (output.size() > kMaxResponseBytes)
          throw std::runtime_error("lookup response exceeds the size limit");
        write_file_atomic(response_path, output);
      } catch (const std::exception& exception) {
        write_file_atomic(response_path, error_json(exception.what()));
      }
      fs::remove(request_path, error);
      fs::remove(committed_path, error);
    }
#ifdef _WIN32
    if (controller_enabled)
      write_file_atomic(
          state / "controller.json",
          iinatan::windows_controller::snapshot_json(
              iinatan::windows_controller::sample()));
#endif
    current_sleep_ms = requests.empty()
                           ? std::min(idle_sleep_ms, current_sleep_ms * 2)
                           : active_sleep_ms;
    std::this_thread::sleep_for(std::chrono::milliseconds(current_sleep_ms));
  }
}

void command_version() {
  std::cout
      << "{\"ok\":true,\"name\":\"iina-hoshi-dicts\",\"backend\":\"Manhhao/hoshidicts\",\"wrapperVersion\":"
      << json_quote(kWrapperVersion)
      << ",\"hoshidictsRevision\":" << json_quote(kHoshidictsRevision)
      << ",\"worker\":true,\"serve\":false,\"fontMetrics\":false,\"controller\":"
      << controller_capability_json()
      << ",\"assGeometry\":{\"protocol\":1,\"available\":false,\"reason\":\"portable-dictionary-worker\"},\"bitmapOcr\":{\"protocol\":1,\"available\":false}}\n";
}

void command_controller_state() {
#ifdef _WIN32
  std::cout << iinatan::windows_controller::snapshot_json(
      iinatan::windows_controller::sample());
#else
  throw std::runtime_error("Windows controller backend is unavailable");
#endif
}

}  // namespace

int main(int argc, char** argv) {
  try {
    if (argc < 2)
      throw std::runtime_error(
          "expected command: import, lookup, worker, or version");
    const std::string command = argv[1];
    if (command == "import") command_import(argc, argv);
    else if (command == "lookup") command_lookup(argc, argv);
    else if (command == "worker") command_worker(argc, argv);
    else if (command == "version") command_version();
    else if (command == "controller-state") command_controller_state();
    else throw std::runtime_error("unknown command: " + command);
    return 0;
  } catch (const std::exception& exception) {
    print_error(exception.what());
    return 1;
  }
}
