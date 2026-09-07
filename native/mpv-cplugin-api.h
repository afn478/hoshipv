#pragma once

// This is the small, stable subset of mpv's public C-plugin API used by the
// in-process window shim. Keep the declarations synchronized with
// include/mpv/client.h without making the native helper build depend on an
// end-user mpv development package.

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct mpv_handle mpv_handle;

typedef enum mpv_event_id {
  MPV_EVENT_NONE = 0,
  MPV_EVENT_SHUTDOWN = 1,
} mpv_event_id;

typedef struct mpv_event {
  mpv_event_id event_id;
  int error;
  uint64_t reply_userdata;
  void* data;
} mpv_event;

unsigned long mpv_client_api_version(void);
mpv_event* mpv_wait_event(mpv_handle* handle, double timeout);

#ifdef __cplusplus
}
#endif
