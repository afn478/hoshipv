#include "platform_io.hpp"

#ifdef _WIN32

#define NOMINMAX
#include <fcntl.h>
#include <io.h>
#include <windows.h>

namespace iinatan::platform {

namespace {
void assign_info(const struct _stat64& status, FileInfo& info) {
  info.size = status.st_size;
  info.modified_ns = static_cast<int64_t>(status.st_mtime) * 1000000000LL;
  info.device = static_cast<uint64_t>(status.st_dev);
  info.inode = static_cast<uint64_t>(status.st_ino);
  info.regular = (status.st_mode & _S_IFMT) == _S_IFREG;
}
}  // namespace

int open_readonly(const std::filesystem::path& path) {
  return ::_wopen(path.c_str(), _O_BINARY | _O_RDONLY | _O_NOINHERIT);
}

void close_file(int descriptor) { ::_close(descriptor); }

int read_file(int descriptor, uint8_t* buffer, size_t size) {
  const unsigned bounded = static_cast<unsigned>(
      size > static_cast<size_t>(INT32_MAX) ? INT32_MAX : size);
  return ::_read(descriptor, buffer, bounded);
}

int64_t seek_file(int descriptor, int64_t offset, int origin) {
  return ::_lseeki64(descriptor, offset, origin);
}

bool file_info(int descriptor, FileInfo& info) {
  struct _stat64 status {};
  if (::_fstat64(descriptor, &status) != 0) return false;
  assign_info(status, info);
  return true;
}

bool path_info(const std::filesystem::path& path, FileInfo& info) {
  struct _stat64 status {};
  if (::_wstat64(path.c_str(), &status) != 0) return false;
  assign_info(status, info);
  return true;
}

bool process_exists(int pid) {
  if (pid <= 0) return true;
  HANDLE process = OpenProcess(SYNCHRONIZE, FALSE, static_cast<DWORD>(pid));
  if (!process) return GetLastError() == ERROR_ACCESS_DENIED;
  const DWORD wait = WaitForSingleObject(process, 0);
  CloseHandle(process);
  return wait == WAIT_TIMEOUT;
}

bool atomic_replace(
    const std::filesystem::path& staged,
    const std::filesystem::path& target,
    std::error_code& error) {
  if (MoveFileExW(
          staged.c_str(), target.c_str(),
          MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
    error.clear();
    return true;
  }
  error = std::error_code(
      static_cast<int>(GetLastError()), std::system_category());
  return false;
}

std::filesystem::path canonical_path(const std::filesystem::path& path) {
  return std::filesystem::canonical(path);
}

const char* adapter_name() { return "windows"; }

}  // namespace iinatan::platform

#endif
