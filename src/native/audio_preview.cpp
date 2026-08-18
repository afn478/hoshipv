#include "audio_preview.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstring>
#include <stdexcept>
#include <thread>
#include <vector>

#ifdef IINATAN_AUDIO_PREVIEW
#define MA_NO_DECODING
#define MA_NO_ENCODING
#define MA_NO_RESOURCE_MANAGER
#define MINIAUDIO_IMPLEMENTATION
#include <miniaudio.h>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/channel_layout.h>
#include <libavutil/error.h>
#include <libavutil/samplefmt.h>
#include <libswresample/swresample.h>
}
#endif

namespace iinatan::audio {
namespace {

#ifdef IINATAN_AUDIO_PREVIEW
std::string ffmpeg_error(int code) {
  char buffer[AV_ERROR_MAX_STRING_SIZE]{};
  av_strerror(code, buffer, sizeof(buffer));
  return buffer;
}

struct FormatOwner {
  AVFormatContext* value = nullptr;
  ~FormatOwner() { if (value) avformat_close_input(&value); }
};
struct CodecOwner {
  AVCodecContext* value = nullptr;
  ~CodecOwner() { if (value) avcodec_free_context(&value); }
};
struct FrameOwner {
  AVFrame* value = av_frame_alloc();
  ~FrameOwner() { if (value) av_frame_free(&value); }
};
struct PacketOwner {
  AVPacket* value = av_packet_alloc();
  ~PacketOwner() { if (value) av_packet_free(&value); }
};
struct SwrOwner {
  SwrContext* value = nullptr;
  ~SwrOwner() { if (value) swr_free(&value); }
};

std::vector<float> decode(const std::filesystem::path& path) {
  FormatOwner format;
  int status = avformat_open_input(&format.value, path.string().c_str(), nullptr, nullptr);
  if (status < 0) throw std::runtime_error("audio open failed: " + ffmpeg_error(status));
  if ((status = avformat_find_stream_info(format.value, nullptr)) < 0)
    throw std::runtime_error("audio stream inspection failed: " + ffmpeg_error(status));
  const int stream_index = av_find_best_stream(format.value, AVMEDIA_TYPE_AUDIO, -1, -1, nullptr, 0);
  if (stream_index < 0) throw std::runtime_error("audio source has no decodable audio stream");
  AVStream* stream = format.value->streams[stream_index];
  const AVCodec* codec = avcodec_find_decoder(stream->codecpar->codec_id);
  if (!codec) throw std::runtime_error("audio decoder is unavailable");
  CodecOwner decoder;
  decoder.value = avcodec_alloc_context3(codec);
  if (!decoder.value || avcodec_parameters_to_context(decoder.value, stream->codecpar) < 0 || avcodec_open2(decoder.value, codec, nullptr) < 0)
    throw std::runtime_error("could not initialize audio decoder");
  AVChannelLayout stereo = AV_CHANNEL_LAYOUT_STEREO;
  SwrOwner converter;
  status = swr_alloc_set_opts2(&converter.value, &stereo, AV_SAMPLE_FMT_FLT, 48000,
                               &decoder.value->ch_layout, decoder.value->sample_fmt,
                               decoder.value->sample_rate, 0, nullptr);
  if (status < 0 || !converter.value || swr_init(converter.value) < 0)
    throw std::runtime_error("could not initialize audio resampler");
  FrameOwner frame;
  PacketOwner packet;
  if (!frame.value || !packet.value) throw std::runtime_error("could not allocate audio decode buffers");
  std::vector<float> pcm;
  pcm.reserve(48000 * 2 * 10);
  auto drain = [&] {
    while (true) {
      const int received = avcodec_receive_frame(decoder.value, frame.value);
      if (received == AVERROR(EAGAIN) || received == AVERROR_EOF) break;
      if (received < 0) throw std::runtime_error("audio decode failed: " + ffmpeg_error(received));
      const int capacity = av_rescale_rnd(
          swr_get_delay(converter.value, decoder.value->sample_rate) + frame.value->nb_samples,
          48000, decoder.value->sample_rate, AV_ROUND_UP);
      const size_t offset = pcm.size();
      pcm.resize(offset + static_cast<size_t>(capacity) * 2);
      uint8_t* output[] = {reinterpret_cast<uint8_t*>(pcm.data() + offset)};
      const int converted = swr_convert(converter.value, output, capacity,
                                        const_cast<const uint8_t**>(frame.value->extended_data),
                                        frame.value->nb_samples);
      if (converted < 0) throw std::runtime_error("audio resample failed");
      pcm.resize(offset + static_cast<size_t>(converted) * 2);
      if (pcm.size() > 48000ULL * 2 * 120)
        throw std::runtime_error("audio preview exceeds 120 seconds");
      av_frame_unref(frame.value);
    }
  };
  while (av_read_frame(format.value, packet.value) >= 0) {
    if (packet.value->stream_index == stream_index) {
      status = avcodec_send_packet(decoder.value, packet.value);
      if (status < 0 && status != AVERROR(EAGAIN))
        throw std::runtime_error("audio packet failed: " + ffmpeg_error(status));
      drain();
    }
    av_packet_unref(packet.value);
  }
  avcodec_send_packet(decoder.value, nullptr);
  drain();
  if (pcm.empty()) throw std::runtime_error("audio preview decoded no samples");
  return pcm;
}

struct Playback {
  const std::vector<float>* pcm = nullptr;
  std::atomic<size_t> cursor{0};
  std::atomic<bool> complete{false};
};

void callback(ma_device* device, void* output, const void*, ma_uint32 frames) {
  Playback& playback = *static_cast<Playback*>(device->pUserData);
  const size_t available_frames = (playback.pcm->size() - playback.cursor.load()) / 2;
  const size_t copied_frames = std::min<size_t>(frames, available_frames);
  float* destination = static_cast<float*>(output);
  std::memcpy(destination, playback.pcm->data() + playback.cursor.load(), copied_frames * 2 * sizeof(float));
  if (copied_frames < frames)
    std::memset(destination + copied_frames * 2, 0, (frames - copied_frames) * 2 * sizeof(float));
  playback.cursor.fetch_add(copied_frames * 2);
  if (copied_frames < frames || playback.cursor.load() >= playback.pcm->size()) playback.complete = true;
}
#endif

}  // namespace

Probe probe_file(const std::filesystem::path& path) {
#ifndef IINATAN_AUDIO_PREVIEW
  (void)path;
  throw std::runtime_error("audio preview is unavailable");
#else
  const std::vector<float> pcm = decode(path);
  return Probe{pcm.size() / 2, 48000, 2};
#endif
}

void play_file(const std::filesystem::path& path) {
#ifndef IINATAN_AUDIO_PREVIEW
  (void)path;
  throw std::runtime_error("audio preview is unavailable");
#else
  const std::vector<float> pcm = decode(path);
  Playback playback;
  playback.pcm = &pcm;
  ma_device_config config = ma_device_config_init(ma_device_type_playback);
  config.playback.format = ma_format_f32;
  config.playback.channels = 2;
  config.sampleRate = 48000;
  config.dataCallback = callback;
  config.pUserData = &playback;
  ma_device device;
  if (ma_device_init(nullptr, &config, &device) != MA_SUCCESS)
    throw std::runtime_error("could not initialize native audio output");
  if (ma_device_start(&device) != MA_SUCCESS) {
    ma_device_uninit(&device);
    throw std::runtime_error("could not start native audio output");
  }
  while (!playback.complete.load())
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
  ma_device_uninit(&device);
#endif
}

const char* ffmpeg_version() {
#ifdef IINATAN_AUDIO_PREVIEW
  return av_version_info();
#else
  return "unavailable";
#endif
}
const char* output_version() {
#ifdef IINATAN_AUDIO_PREVIEW
  return MA_VERSION_STRING;
#else
  return "unavailable";
#endif
}

}  // namespace iinatan::audio
