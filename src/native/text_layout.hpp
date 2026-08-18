#pragma once

#include <memory>

#include "worker_protocol.hpp"

namespace iinatan::layout {

constexpr int kTextLayoutProtocol = 1;

bool is_text_layout_request(const protocol::Json& request);

class TextLayoutService {
 public:
  TextLayoutService();
  ~TextLayoutService();
  TextLayoutService(const TextLayoutService&) = delete;
  TextLayoutService& operator=(const TextLayoutService&) = delete;

  protocol::Json capability() const;
  protocol::Json handle(const protocol::Json& request);

 private:
  struct State;
  std::unique_ptr<State> state_;
};

}  // namespace iinatan::layout
