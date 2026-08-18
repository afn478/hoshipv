#include "platform_io.hpp"

#ifndef _WIN32

#include <cerrno>
#include <csignal>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

namespace iinatan::platform {

namespace {
void assign_info(const struct stat& status, FileInfo& info) {
  info.size = static_cast<int64_t>(status.st_size);
  info.device = static_cast<uint64_t>(status.st_dev);
  info.inode = static_cast<uint64_t>(status.st_ino);
#if defined(__APPLE__)
  info.modified_ns = static_cast<int64_t>(status.st_mtimespec.tv_sec) *
          1000000000LL +
      status.st_mtimespec.tv_nsec;
#else
  info.modified_ns = static_cast<int64_t>(status.st_mtim.tv_sec) *
          1000000000LL +
      status.st_mtim.tv_nsec;
#endif
  info.regular = S_ISREG(status.st_mode);
}
}  // namespace

int open_readonly(const std::filesystem::path& path) {
  int flags = O_RDONLY;
#ifdef O_CLOEXEC
  flags |= O_CLOEXEC;
#endif
#ifdef O_NOFOLLOW
  flags |= O_NOFOLLOW;
#endif
  return ::open(path.c_str(), flags);
}

void close_file(int descriptor) { ::close(descriptor); }

int read_file(int descriptor, uint8_t* buffer, size_t size) {
  const ssize_t count = ::read(descriptor, buffer, size);
  return count > static_cast<ssize_t>(INT32_MAX)
      ? INT32_MAX
      : static_cast<int>(count);
}

int64_t seek_file(int descriptor, int64_t offset, int origin) {
  const off_t result = ::lseek(descriptor, static_cast<off_t>(offset), origin);
  return result < 0 ? -1 : static_cast<int64_t>(result);
}

bool file_info(int descriptor, FileInfo& info) {
  struct stat status {};
  if (::fstat(descriptor, &status) != 0) return false;
  assign_info(status, info);
  return true;
}

bool path_info(const std::filesystem::path& path, FileInfo& info) {
  struct stat status {};
  if (::stat(path.c_str(), &status) != 0) return false;
  assign_info(status, info);
  return true;
}

bool process_exists(int pid) {
  if (pid <= 0) return true;
  if (::kill(static_cast<pid_t>(pid), 0) == 0) return true;
  return errno == EPERM;
}

bool atomic_replace(
    const std::filesystem::path& staged,
    const std::filesystem::path& target,
    std::error_code& error) {
  std::filesystem::rename(staged, target, error);
  return !error;
}

std::filesystem::path canonical_path(const std::filesystem::path& path) {
  return std::filesystem::canonical(path);
}

const char* adapter_name() { return "posix"; }

}  // namespace iinatan::platform

#endif
