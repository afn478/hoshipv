#pragma once

#include <filesystem>
#include <cstddef>

namespace iinatan::audio {

struct Probe {
  size_t frames = 0;
  int sample_rate = 48000;
  int channels = 2;
};

Probe probe_file(const std::filesystem::path& path);
void play_file(const std::filesystem::path& path);
const char* ffmpeg_version();
const char* output_version();

}  // namespace iinatan::audio
