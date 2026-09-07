#include "png_writer.hpp"

#include <array>
#include <cstdint>
#include <fstream>
#include <limits>
#include <vector>

namespace iinatan::native {

namespace {

void append_u32_be(std::vector<unsigned char>& output, std::uint32_t value) {
  output.push_back(static_cast<unsigned char>((value >> 24) & 0xff));
  output.push_back(static_cast<unsigned char>((value >> 16) & 0xff));
  output.push_back(static_cast<unsigned char>((value >> 8) & 0xff));
  output.push_back(static_cast<unsigned char>(value & 0xff));
}

const std::array<std::uint32_t, 256>& crc_table() {
  static const std::array<std::uint32_t, 256> table = [] {
    std::array<std::uint32_t, 256> result{};
    for (std::uint32_t index = 0; index < result.size(); ++index) {
      std::uint32_t value = index;
      for (int bit = 0; bit < 8; ++bit)
        value = (value & 1) ? 0xedb88320U ^ (value >> 1) : value >> 1;
      result[index] = value;
    }
    return result;
  }();
  return table;
}

std::uint32_t crc32(const unsigned char* data, std::size_t size) {
  std::uint32_t value = 0xffffffffU;
  const auto& table = crc_table();
  for (std::size_t index = 0; index < size; ++index)
    value = table[(value ^ data[index]) & 0xff] ^ (value >> 8);
  return value ^ 0xffffffffU;
}

std::uint32_t adler32(const unsigned char* data, std::size_t size) {
  constexpr std::uint32_t modulus = 65521;
  std::uint32_t low = 1;
  std::uint32_t high = 0;
  for (std::size_t index = 0; index < size; ++index) {
    low = (low + data[index]) % modulus;
    high = (high + low) % modulus;
  }
  return (high << 16) | low;
}

void append_chunk(std::vector<unsigned char>& output,
                  const char type[4],
                  const std::vector<unsigned char>& payload) {
  append_u32_be(output, static_cast<std::uint32_t>(payload.size()));
  const std::size_t type_offset = output.size();
  output.insert(output.end(), type, type + 4);
  output.insert(output.end(), payload.begin(), payload.end());
  append_u32_be(output, crc32(output.data() + type_offset, 4 + payload.size()));
}

}  // namespace

bool write_rgba_png(const std::string& output_path,
                    int width,
                    int height,
                    const unsigned char* rgba,
                    std::size_t byte_count,
                    std::string& error) {
  if (output_path.empty()) {
    error = "capture-path-empty";
    return false;
  }
  if (width <= 0 || height <= 0 || !rgba) {
    error = "invalid-image-dimensions";
    return false;
  }
  const std::size_t row_bytes = static_cast<std::size_t>(width) * 4;
  if (row_bytes / 4 != static_cast<std::size_t>(width) ||
      static_cast<std::size_t>(height) >
          (std::numeric_limits<std::size_t>::max() / (row_bytes + 1)) ||
      byte_count < row_bytes * static_cast<std::size_t>(height)) {
    error = "image-buffer-size-invalid";
    return false;
  }

  std::vector<unsigned char> scanlines;
  scanlines.reserve((row_bytes + 1) * static_cast<std::size_t>(height));
  for (int row = 0; row < height; ++row) {
    scanlines.push_back(0);
    const auto* source = rgba + (static_cast<std::size_t>(row) * row_bytes);
    scanlines.insert(scanlines.end(), source, source + row_bytes);
  }

  // A zlib stream containing stored DEFLATE blocks avoids adding a runtime
  // compression dependency to the test helper. The captures are bounded and
  // are test artifacts, so compression is not part of the evidence contract.
  std::vector<unsigned char> compressed;
  compressed.reserve(scanlines.size() + 16 + (scanlines.size() / 65535) * 5);
  compressed.push_back(0x78);
  compressed.push_back(0x01);
  std::size_t offset = 0;
  while (offset < scanlines.size()) {
    const std::size_t remaining = scanlines.size() - offset;
    const std::size_t block_size = remaining > 65535 ? 65535 : remaining;
    const bool final = block_size == remaining;
    compressed.push_back(final ? 0x01 : 0x00);
    const auto length = static_cast<std::uint16_t>(block_size);
    compressed.push_back(static_cast<unsigned char>(length & 0xff));
    compressed.push_back(static_cast<unsigned char>((length >> 8) & 0xff));
    const auto inverse = static_cast<std::uint16_t>(~length);
    compressed.push_back(static_cast<unsigned char>(inverse & 0xff));
    compressed.push_back(static_cast<unsigned char>((inverse >> 8) & 0xff));
    compressed.insert(compressed.end(),
                      scanlines.begin() + static_cast<std::ptrdiff_t>(offset),
                      scanlines.begin() + static_cast<std::ptrdiff_t>(offset + block_size));
    offset += block_size;
  }
  append_u32_be(compressed, adler32(scanlines.data(), scanlines.size()));

  std::vector<unsigned char> png{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'};
  std::vector<unsigned char> header;
  append_u32_be(header, static_cast<std::uint32_t>(width));
  append_u32_be(header, static_cast<std::uint32_t>(height));
  header.insert(header.end(), {8, 6, 0, 0, 0});
  append_chunk(png, "IHDR", header);
  append_chunk(png, "IDAT", compressed);
  append_chunk(png, "IEND", {});

  std::ofstream output(output_path, std::ios::binary | std::ios::trunc);
  if (!output) {
    error = "capture-open-failed";
    return false;
  }
  output.write(reinterpret_cast<const char*>(png.data()),
               static_cast<std::streamsize>(png.size()));
  if (!output) {
    error = "capture-write-failed";
    return false;
  }
  return true;
}

}  // namespace iinatan::native
