#include "vision_ocr.hpp"

namespace iinatan::bitmap {

struct OcrService::State {};

OcrService::OcrService() : state_(std::make_unique<State>()) {}
OcrService::~OcrService() = default;

protocol::Json OcrService::capability() const {
  return protocol::Json::Object{
      {"protocol", kBitmapOcrProtocol},
      {"available", false},
      {"provider", "unavailable-on-this-platform"}};
}

protocol::Json OcrService::handle(
    const protocol::Json& request,
    const std::function<bool()>&) const {
  const protocol::Json* id = request.find("requestId");
  return protocol::Json::Object{
      {"ok", false},
      {"protocol", kBitmapOcrProtocol},
      {"requestId", id && id->is_string() ? id->string() : ""},
      {"reason", "bitmap-ocr-unavailable"},
      {"provider", "unavailable-on-this-platform"}};
}

bool is_ocr_request(const protocol::Json& request) {
  const protocol::Json* type = request.find("type");
  return type && type->is_string() && type->string() == "bitmap-subtitle-ocr";
}

}  // namespace iinatan::bitmap
