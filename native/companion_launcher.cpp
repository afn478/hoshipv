#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

#include <windows.h>
#include <shellapi.h>

#include <string>

#include "payload-tag.h"

namespace {

constexpr wchar_t kPayloadPrefix[] = L"iinatan-companion-payload-";
constexpr wchar_t kPayloadSuffix[] = L".exe";
constexpr wchar_t kPayloadMutex[] = L"Local\\iinatan-companion-payload-v1";

std::wstring payloadPath() {
  wchar_t temporaryDirectory[MAX_PATH]{};
  const DWORD length = GetTempPathW(MAX_PATH, temporaryDirectory);
  if (length == 0 || length >= MAX_PATH) return {};
  return std::wstring(temporaryDirectory) + kPayloadPrefix +
         IINATAN_PAYLOAD_TAG + kPayloadSuffix;
}

std::wstring quoteArgument(const wchar_t* value) {
  const std::wstring input = value ? value : L"";
  bool needsQuotes = input.empty();
  for (const wchar_t character : input) {
    if (character == L' ' || character == L'\t' || character == L'"') {
      needsQuotes = true;
      break;
    }
  }
  if (!needsQuotes) return input;

  std::wstring result = L"\"";
  size_t backslashes = 0;
  for (const wchar_t character : input) {
    if (character == L'\\') {
      ++backslashes;
      continue;
    }
    if (character == L'"') {
      result.append(backslashes * 2 + 1, L'\\');
      result += L'"';
      backslashes = 0;
      continue;
    }
    result.append(backslashes, L'\\');
    backslashes = 0;
    result += character;
  }
  result.append(backslashes * 2, L'\\');
  result += L'"';
  return result;
}

bool writePayload(const std::wstring& destination) {
  HRSRC resource = FindResourceW(nullptr, MAKEINTRESOURCEW(1), RT_RCDATA);
  if (!resource) return false;
  HGLOBAL loaded = LoadResource(nullptr, resource);
  const auto* bytes = static_cast<const unsigned char*>(LockResource(loaded));
  const DWORD resourceSize = SizeofResource(nullptr, resource);
  if (!loaded || !bytes || resourceSize == 0) return false;

  WIN32_FILE_ATTRIBUTE_DATA existing{};
  if (GetFileAttributesExW(destination.c_str(), GetFileExInfoStandard, &existing)) {
    const ULARGE_INTEGER size{
        existing.nFileSizeLow,
        existing.nFileSizeHigh,
    };
    if (size.QuadPart == resourceSize) return true;
  }

  const std::wstring temporary = destination + L".tmp-" +
                                  std::to_wstring(GetCurrentProcessId());
  HANDLE file = CreateFileW(
      temporary.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
      FILE_ATTRIBUTE_TEMPORARY, nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;

  DWORD written = 0;
  bool success = true;
  DWORD offset = 0;
  while (offset < resourceSize) {
    const DWORD requested =
        (resourceSize - offset < 1024 * 1024) ? resourceSize - offset
                                               : 1024 * 1024;
    if (!WriteFile(file, bytes + offset, requested, &written, nullptr) ||
        written != requested) {
      success = false;
      break;
    }
    offset += written;
  }
  if (success) success = FlushFileBuffers(file) != FALSE;
  CloseHandle(file);
  if (!success) {
    DeleteFileW(temporary.c_str());
    return false;
  }

  success = MoveFileExW(
                temporary.c_str(), destination.c_str(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) != FALSE;
  if (!success) DeleteFileW(temporary.c_str());
  return success;
}

int launchPayload(int argc, wchar_t** argv, const std::wstring& executable) {
  std::wstring commandLine = quoteArgument(executable.c_str());
  for (int index = 1; index < argc; ++index) {
    commandLine += L" ";
    commandLine += quoteArgument(argv[index]);
  }

  SECURITY_ATTRIBUTES securityAttributes{};
  securityAttributes.nLength = sizeof(securityAttributes);
  securityAttributes.bInheritHandle = TRUE;
  HANDLE standardInput = CreateFileW(
      L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
      &securityAttributes, OPEN_EXISTING, 0, nullptr);
  HANDLE outputReader = nullptr;
  HANDLE standardOutput = nullptr;
  HANDLE errorReader = nullptr;
  HANDLE standardError = nullptr;
  const BOOL outputPipe = CreatePipe(
      &outputReader, &standardOutput, &securityAttributes, 0);
  const BOOL errorPipe = CreatePipe(
      &errorReader, &standardError, &securityAttributes, 0);
  if (outputPipe) SetHandleInformation(outputReader, HANDLE_FLAG_INHERIT, 0);
  if (errorPipe) SetHandleInformation(errorReader, HANDLE_FLAG_INHERIT, 0);
  if (standardInput == INVALID_HANDLE_VALUE ||
      !outputPipe || !errorPipe) {
    if (standardInput != INVALID_HANDLE_VALUE) CloseHandle(standardInput);
    if (outputReader) CloseHandle(outputReader);
    if (standardOutput) CloseHandle(standardOutput);
    if (errorReader) CloseHandle(errorReader);
    if (standardError) CloseHandle(standardError);
    return 1;
  }

  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESHOWWINDOW | STARTF_USESTDHANDLES;
  startup.wShowWindow = SW_HIDE;
  startup.hStdInput = standardInput;
  startup.hStdOutput = standardOutput;
  startup.hStdError = standardError;
  PROCESS_INFORMATION process{};
  const BOOL started = CreateProcessW(
      executable.c_str(), commandLine.data(), nullptr, nullptr, TRUE,
      CREATE_UNICODE_ENVIRONMENT, nullptr, nullptr,
      &startup, &process);
  CloseHandle(standardInput);
  CloseHandle(standardOutput);
  CloseHandle(standardError);
  if (!started) {
    CloseHandle(outputReader);
    CloseHandle(errorReader);
    return 1;
  }

  WaitForSingleObject(process.hProcess, INFINITE);
  DWORD exitCode = 1;
  GetExitCodeProcess(process.hProcess, &exitCode);
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  CloseHandle(outputReader);
  CloseHandle(errorReader);
  return static_cast<int>(exitCode);
}

}  // namespace

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
  int argc = 0;
  wchar_t** argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (!argv || argc == 0) return 1;

  const std::wstring destination = payloadPath();
  if (destination.empty()) {
    LocalFree(argv);
    return 1;
  }

  HANDLE mutex = CreateMutexW(nullptr, FALSE, kPayloadMutex);
  if (!mutex) {
    LocalFree(argv);
    return 1;
  }
  const DWORD waitResult = WaitForSingleObject(mutex, INFINITE);
  const bool payloadReady =
      waitResult == WAIT_OBJECT_0 || waitResult == WAIT_ABANDONED;
  const bool written = payloadReady && writePayload(destination);
  ReleaseMutex(mutex);
  CloseHandle(mutex);
  if (!written) {
    LocalFree(argv);
    return 1;
  }

  const int result = launchPayload(argc, argv, destination);
  LocalFree(argv);
  return result;
}
