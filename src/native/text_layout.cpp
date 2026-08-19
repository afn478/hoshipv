#include "text_layout.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iterator>
#include <limits>
#include <sstream>
#include <string>
#include <vector>

#ifdef IINATAN_ASS_GEOMETRY
#include <ass/ass.h>
#include <utf8proc.h>
#endif

namespace iinatan::layout {
using protocol::Json;

namespace {

const Json* field(const Json& object, const char* name) {
  return object.is_object() ? object.find(name) : nullptr;
}

Json failure(const std::string& request_id, const std::string& reason) {
  return Json::Object{{"ok", false},
                      {"protocol", kTextLayoutProtocol},
                      {"requestId", request_id},
                      {"reason", reason}};
}

#ifdef IINATAN_ASS_GEOMETRY
struct Scalar {
  int32_t codepoint = 0;
  int utf8_start = 0;
  int utf8_end = 0;
  int scalar_start = 0;
  int scalar_end = 0;
  int utf16_start = 0;
  int utf16_end = 0;
};

struct Cluster {
  int scalar_start = 0;
  int scalar_end = 0;
  int utf8_start = 0;
  int utf8_end = 0;
  int utf16_start = 0;
  int utf16_end = 0;
};

bool decode(const std::string& text, std::vector<Scalar>& scalars) {
  int utf16 = 0;
  for (size_t offset = 0; offset < text.size();) {
    int32_t codepoint = 0;
    const auto length = utf8proc_iterate(
        reinterpret_cast<const utf8proc_uint8_t*>(text.data() + offset),
        static_cast<utf8proc_ssize_t>(text.size() - offset), &codepoint);
    if (length <= 0) return false;
    const int scalar_index = static_cast<int>(scalars.size());
    scalars.push_back(Scalar{
        codepoint, static_cast<int>(offset), static_cast<int>(offset + length),
        scalar_index, scalar_index + 1, utf16,
        utf16 + (codepoint > 0xffff ? 2 : 1)});
    utf16 = scalars.back().utf16_end;
    offset += static_cast<size_t>(length);
  }
  return true;
}

std::vector<Cluster> graphemes(const std::vector<Scalar>& scalars) {
  std::vector<Cluster> output;
  if (scalars.empty()) return output;
  int state = 0;
  size_t start = 0;
  for (size_t index = 1; index <= scalars.size(); ++index) {
    const bool boundary = index == scalars.size() ||
        utf8proc_grapheme_break_stateful(
            scalars[index - 1].codepoint, scalars[index].codepoint, &state);
    if (!boundary) continue;
    output.push_back(Cluster{
        scalars[start].scalar_start, scalars[index - 1].scalar_end,
        scalars[start].utf8_start, scalars[index - 1].utf8_end,
        scalars[start].utf16_start, scalars[index - 1].utf16_end});
    start = index;
  }
  return output;
}

std::string ass_escape(const std::string& text) {
  std::string output;
  output.reserve(text.size() + 16);
  for (char character : text) {
    if (character == '\\') output += "\\\\";
    else if (character == '{') output += "\\{";
    else if (character == '}') output += "\\}";
    else if (character == '\n') output += "\\N";
    else if (character != '\r') output += character;
  }
  return output;
}

std::string ass_document(
    const std::string& text, const std::string& family, double size,
    int weight, bool italic, double spacing, double play_res_width,
    double play_res_height, int alignment, double margin_x, double margin_y) {
  std::ostringstream out;
  out << "[Script Info]\nScriptType: v4.00+\nPlayResX: " << play_res_width
      << "\nPlayResY: " << play_res_height
      << "\nWrapStyle: 0\nScaledBorderAndShadow: yes\n"
      << "[V4+ Styles]\n"
      << "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
         "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
         "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
         "Alignment, MarginL, MarginR, MarginV, Encoding\n"
      << "Style: Default," << family << ',' << size
      << ",&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,"
      << (weight >= 600 ? -1 : 0) << ',' << (italic ? -1 : 0)
      << ",0,0,100,100," << spacing
      << ",0,1,0,0," << alignment << ',' << margin_x << ',' << margin_x
      << ',' << margin_y << ",1\n"
      << "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, "
         "MarginV, Effect, Text\n"
      << "Dialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,"
      << ass_escape(text) << "\n";
  return out.str();
}
#endif

}  // namespace

bool is_text_layout_request(const Json& request) {
  const Json* type = field(request, "type");
  return type && type->is_string() && type->string() == "text-layout";
}

struct TextLayoutService::State {
#ifdef IINATAN_ASS_GEOMETRY
  ASS_Library* library = nullptr;
  ASS_Renderer* renderer = nullptr;
  std::string fallback_path;

  State() {
    library = ass_library_init();
    if (library) renderer = ass_renderer_init(library);
  }
  ~State() {
    if (renderer) ass_renderer_done(renderer);
    if (library) ass_library_done(library);
  }
#endif
};

TextLayoutService::TextLayoutService() : state_(std::make_unique<State>()) {}
TextLayoutService::~TextLayoutService() = default;

Json TextLayoutService::capability() const {
  return Json::Object{{"protocol", kTextLayoutProtocol},
#ifdef IINATAN_ASS_GEOMETRY
                      {"available", state_->library && state_->renderer},
                      {"shaper", "libass-harfbuzz-freetype"},
                      {"graphemes", "utf8proc-uax29"}};
#else
                      {"available", false},
                      {"shaper", "unavailable"},
                      {"graphemes", "unavailable"}};
#endif
}

Json TextLayoutService::handle(const Json& request) {
  const Json* id_value = field(request, "requestId");
  const std::string request_id =
      id_value && id_value->is_string() ? id_value->string() : "";
  if (!is_text_layout_request(request))
    return failure(request_id, "invalid-text-layout-type");
  const Json* protocol = field(request, "protocol");
  if (!protocol || !protocol->is_number() || protocol->integer() != 1)
    return failure(request_id, "unsupported-text-layout-protocol");
#ifndef IINATAN_ASS_GEOMETRY
  return failure(request_id, "text-layout-unavailable");
#else
  if (!state_->library || !state_->renderer)
    return failure(request_id, "text-layout-unavailable");
  const Json* text_value = field(request, "text");
  const Json* font_value = field(request, "font");
  if (!text_value || !text_value->is_string() || !font_value ||
      !font_value->is_object())
    return failure(request_id, "invalid-text-layout-request");
  const std::string& text = text_value->string();
  if (text.size() > 256 * 1024)
    return failure(request_id, "text-layout-input-limit");
  std::vector<Scalar> scalars;
  if (!decode(text, scalars)) return failure(request_id, "invalid-utf8");
  const std::vector<Cluster> clusters = graphemes(scalars);
  if (clusters.size() > 256)
    return failure(request_id, "text-layout-cluster-limit");
  const Json* fallback_value = field(request, "fallbackFontPath");
  if (fallback_value && fallback_value->is_string() &&
      fallback_value->string() != state_->fallback_path) {
    const std::filesystem::path fallback = fallback_value->string();
    std::error_code error;
    const auto bytes = std::filesystem::file_size(fallback, error);
    if (error || bytes == 0 || bytes > 64 * 1024 * 1024)
      return failure(request_id, "fallback-font-unavailable");
    std::ifstream input(fallback, std::ios::binary);
    std::string data((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
    if (!input || data.size() != bytes)
      return failure(request_id, "fallback-font-unavailable");
    ass_add_font(state_->library, fallback.filename().string().c_str(),
                 data.data(), static_cast<int>(data.size()));
    state_->fallback_path = fallback.string();
  }
  const std::string family =
      field(*font_value, "family")
          ? field(*font_value, "family")->string_or("Noto Sans")
          : "Noto Sans";
  const double size = std::clamp(
      field(*font_value, "size")
          ? field(*font_value, "size")->number_or(20.0)
          : 20.0,
      4.0, 300.0);
  const int weight = static_cast<int>(std::clamp<int64_t>(
      field(*font_value, "weight")
          ? field(*font_value, "weight")->integer_or(400)
          : 400,
      100, 900));
  const bool italic = field(*font_value, "italic") &&
      field(*font_value, "italic")->boolean_or(false);
  const double spacing = std::clamp(
      field(*font_value, "spacing")
          ? field(*font_value, "spacing")->number_or(0.0)
          : 0.0,
      -20.0, 100.0);
  const int measure_width = static_cast<int>(std::clamp<int64_t>(
      field(request, "wrapWidth")
          ? field(request, "wrapWidth")->integer_or(4096)
          : 4096,
      32, 16384));
  const Json* renderer_value = field(request, "renderer");
  const bool positioned = renderer_value && renderer_value->is_object();
  const auto renderer_integer = [&](const char* name, int64_t fallback) {
    const Json* value = positioned ? field(*renderer_value, name) : nullptr;
    return value ? value->integer_or(fallback) : fallback;
  };
  const auto renderer_number = [&](const char* name, double fallback) {
    const Json* value = positioned ? field(*renderer_value, name) : nullptr;
    return value ? value->number_or(fallback) : fallback;
  };
  const auto renderer_boolean = [&](const char* name, bool fallback) {
    const Json* value = positioned ? field(*renderer_value, name) : nullptr;
    return value ? value->boolean_or(fallback) : fallback;
  };
  const int frame_width = static_cast<int>(std::clamp<int64_t>(
      renderer_integer("width", measure_width),
      32, 16384));
  const int frame_height = static_cast<int>(std::clamp<int64_t>(
      renderer_integer("height", 4096),
      32, 16384));
  const double play_res_width = std::clamp(
      renderer_number(
          "playResWidth",
          positioned ? frame_width : static_cast<double>(measure_width)),
      32.0, 16384.0);
  const double play_res_height = std::clamp(
      renderer_number("playResHeight", positioned ? frame_height : 4096.0),
      32.0, 16384.0);
  const int alignment = static_cast<int>(std::clamp<int64_t>(
      renderer_integer("alignment", positioned ? 2 : 7),
      1, 9));
  const double style_margin_x = std::clamp(
      renderer_number("styleMarginX", positioned ? 0.0 : 8.0),
      0.0, 4096.0);
  const double style_margin_y = std::clamp(
      renderer_number("styleMarginY", positioned ? 0.0 : 8.0),
      0.0, 4096.0);
  const std::string script =
      ass_document(
          text, family, size, weight, italic, spacing, play_res_width,
          play_res_height, alignment, style_margin_x, style_margin_y);
  ASS_Track* track = ass_read_memory(
      state_->library,
      const_cast<char*>(script.data()), static_cast<int>(script.size()), nullptr);
  if (!track) return failure(request_id, "text-layout-track-failed");
  if (positioned && track->n_styles > 0) {
    track->styles[0].Justify = static_cast<int>(std::clamp<int64_t>(
        renderer_integer("justify", ASS_JUSTIFY_AUTO),
        ASS_JUSTIFY_AUTO, ASS_JUSTIFY_RIGHT));
  }
  ass_set_frame_size(state_->renderer, frame_width, frame_height);
  ass_set_storage_size(state_->renderer, frame_width, frame_height);
  if (positioned) {
    const int margin_left = static_cast<int>(std::clamp<int64_t>(
        renderer_integer("marginLeft", 0),
        0, frame_width));
    const int margin_right = static_cast<int>(std::clamp<int64_t>(
        renderer_integer("marginRight", 0),
        0, frame_width));
    const int margin_top = static_cast<int>(std::clamp<int64_t>(
        renderer_integer("marginTop", 0),
        0, frame_height));
    const int margin_bottom = static_cast<int>(std::clamp<int64_t>(
        renderer_integer("marginBottom", 0),
        0, frame_height));
    ass_set_margins(
        state_->renderer, margin_top, margin_bottom, margin_left, margin_right);
    ass_set_use_margins(
        state_->renderer, renderer_boolean("useMargins", false) ? 1 : 0);
    ass_set_line_position(
        state_->renderer,
        std::clamp(renderer_number("linePosition", 100.0), -50.0, 100.0));
    ass_set_line_spacing(
        state_->renderer,
        std::clamp(
            renderer_number("lineSpacing", 0.0), -1000.0, 1000.0));
  } else {
    ass_set_margins(state_->renderer, 0, 0, 0, 0);
    ass_set_use_margins(state_->renderer, 0);
    ass_set_line_position(state_->renderer, 100.0);
    ass_set_line_spacing(state_->renderer, 0.0);
  }
  ass_set_fonts(
      state_->renderer, nullptr, family.c_str(), ASS_FONTPROVIDER_AUTODETECT,
      nullptr, 1);
  std::vector<ASS_IinatanLookupUnit> units;
  units.reserve(clusters.size());
  for (size_t index = 0; index < clusters.size(); ++index) {
    units.push_back(ASS_IinatanLookupUnit{
        0, clusters[index].scalar_start, clusters[index].scalar_end,
        static_cast<int>(index)});
  }
  ass_iinatan_set_lookup_units(
      state_->renderer, units.data(), static_cast<int>(units.size()));
  int change = 0;
  ASS_Image* images = ass_render_frame(state_->renderer, track, 1000, &change);
  if (!images || !ass_iinatan_lookup_units_valid(state_->renderer)) {
    ass_free_track(track);
    return failure(request_id, "text-layout-shaping-failed");
  }
  std::array<ASS_IinatanLookupRect, 256> rects{};
  const int count = ass_iinatan_get_lookup_rects(
      state_->renderer, rects.data(), static_cast<int>(rects.size()));
  if (count < 0 || count > static_cast<int>(rects.size())) {
    ass_free_track(track);
    return failure(request_id, "text-layout-invalid-geometry");
  }
  int left = std::numeric_limits<int>::max();
  int top = std::numeric_limits<int>::max();
  int right = 0;
  int bottom = 0;
  for (int index = 0; index < count; ++index) {
    left = std::min(left, rects[index].x);
    top = std::min(top, rects[index].y);
    right = std::max(right, rects[index].x + rects[index].w);
    bottom = std::max(bottom, rects[index].y + rects[index].h);
  }
  if (left == std::numeric_limits<int>::max()) left = top = right = bottom = 0;
  Json::Array response_clusters;
  for (size_t index = 0; index < clusters.size(); ++index) {
    const ASS_IinatanLookupRect* rect = nullptr;
    for (int candidate = 0; candidate < count; ++candidate)
      if (rects[candidate].id == static_cast<int>(index)) rect = &rects[candidate];
    const Cluster& cluster = clusters[index];
    const bool line_break =
        cluster.utf8_end - cluster.utf8_start == 1 &&
        (text[static_cast<size_t>(cluster.utf8_start)] == '\n' ||
         text[static_cast<size_t>(cluster.utf8_start)] == '\r');
    if (!rect && !line_break) {
      ass_free_track(track);
      return failure(request_id, "text-layout-missing-cluster");
    }
    response_clusters.emplace_back(Json::Object{
        {"text", text.substr(
                     static_cast<size_t>(cluster.utf8_start),
                     static_cast<size_t>(cluster.utf8_end - cluster.utf8_start))},
        {"x", rect ? rect->x - (positioned ? 0 : left) : 0},
        {"y", rect ? rect->y - (positioned ? 0 : top) : 0},
        {"width", rect ? rect->w : 0},
        {"height", rect ? rect->h : 0},
        {"utf8Range", Json::Array{cluster.utf8_start, cluster.utf8_end}},
        {"scalarRange", Json::Array{cluster.scalar_start, cluster.scalar_end}},
        {"utf16Range", Json::Array{cluster.utf16_start, cluster.utf16_end}},
    });
  }
  ass_free_track(track);
  return Json::Object{{"ok", true},
                      {"protocol", kTextLayoutProtocol},
                      {"requestId", request_id},
                      {"positioned", positioned},
                      {"width", right - left},
                      {"height", bottom - top},
                      {"clusters", std::move(response_clusters)}};
#endif
}

}  // namespace iinatan::layout
