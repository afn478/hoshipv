#pragma once

#include <cstddef>
#include <string>

namespace iinatan::native {

bool write_rgba_png(const std::string& output_path,
                    int width,
                    int height,
                    const unsigned char* rgba,
                    std::size_t byte_count,
                    std::string& error);

}  // namespace iinatan::native
