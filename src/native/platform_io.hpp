#pragma once

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <string>

namespace iinatan::platform {

struct FileInfo {
  int64_t size = 0;
  int64_t modified_ns = 0;
  uint64_t device = 0;
  uint64_t inode = 0;
  bool regular = false;
};

int open_readonly(const std::filesystem::path& path);
void close_file(int descriptor);
int read_file(int descriptor, uint8_t* buffer, size_t size);
int64_t seek_file(int descriptor, int64_t offset, int origin);
bool file_info(int descriptor, FileInfo& info);
bool path_info(const std::filesystem::path& path, FileInfo& info);
bool process_exists(int pid);
bool atomic_replace(
    const std::filesystem::path& staged,
    const std::filesystem::path& target,
    std::error_code& error);
std::filesystem::path canonical_path(const std::filesystem::path& path);
const char* adapter_name();
bool open_external_url(const std::string& url, std::error_code& error);

}  // namespace iinatan::platform
