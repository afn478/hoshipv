-- iinatan's optional mpv-side session descriptor.
--
-- It does not render subtitles or create an OSD. It only publishes the
-- explicit process/window/IPC relationship that the Electron companion needs
-- in order to attach without title matching. Start mpv with an
-- input-ipc-server path as well as this script.

local mp = require "mp"
local utils = require "mp.utils"

local function environment_value(name)
    if utils.getenv then return utils.getenv(name) end
    return os.getenv(name)
end

local function load_native_shim()
    local shim = mp.get_opt("iinatan-native-shim") or environment_value("IINATAN_NATIVE_SHIM")
    if not shim or shim == "" then return end
    local ok, error_message = pcall(mp.commandv, "load-script", shim)
    if not ok then
        mp.msg.warn("iinatan native window shim could not be loaded: " .. tostring(error_message))
    end
end

local pid = utils.getpid()
local session_id = mp.get_opt("iinatan-session-id") or ("mpv-" .. tostring(pid) .. "-" .. tostring(math.floor(mp.get_time() * 1000)))
local session_dir = mp.get_opt("iinatan-session-dir") or environment_value("IINATAN_SESSION_DIR")
local descriptor_path = nil
local observed_window_id = nil

local function file_url(path)
    local normalized = path:gsub("\\\\", "/")
    if normalized:match("^%a:/") then return "file:///" .. normalized end
    if normalized:sub(1, 1) == "/" then return "file://" .. normalized end
    return "file://" .. normalized
end

local function write_text(path, content)
    local ok = pcall(utils.write_file, file_url(path), content)
    if ok then return true end

    local file = io.open(path, "w")
    if not file then return false end
    local written = file:write(content)
    file:close()
    return written ~= nil
end

local function ensure_session_directory()
    if not session_dir or session_dir == "" then return false end
    if utils.readdir(session_dir, "files") then return true end
    local separator = package.config and package.config:sub(1, 1) or "/"
    local command = separator == "\\" and { "cmd.exe", "/c", "mkdir", session_dir } or { "mkdir", "-p", session_dir }
    local result = utils.subprocess({ args = command, cancellable = false })
    return result and result.status == 0
end

local function write_descriptor(window_id)
    local ipc = mp.get_opt("iinatan-ipc-endpoint") or ""
    if ipc == "" then
        ipc = mp.get_property("input-ipc-server") or ""
    end
    if not session_dir or session_dir == "" or ipc == "" then return end
    if not ensure_session_directory() then return end
    window_id = window_id or observed_window_id
    -- mpv's macOS `window-id` value is not the CoreGraphics window number
    -- used by the external AppKit probe. Keep it optional there and let the
    -- probe establish the PID/window identity from the real window list.
    if mp.get_property("platform") == "darwin" then window_id = nil end
    descriptor_path = utils.join_path(session_dir, tostring(pid) .. ".json")
    local descriptor = {
        protocol = 1,
        sessionId = session_id,
        pid = pid,
        -- Window identity is published asynchronously. Keeping it optional
        -- during immediate initialization avoids blocking descriptor
        -- publication while still rewriting it when mpv reports the ID.
        windowId = window_id,
        ipcEndpoint = ipc,
        startedAt = tostring(mp.get_time()),
        backend = "unknown",
    }
    local ok, encoded = pcall(utils.format_json, descriptor)
    if ok and encoded then
        local temporary_path = descriptor_path .. ".next"
        if write_text(temporary_path, encoded .. "\n") then
            if not os.rename(temporary_path, descriptor_path) then
                write_text(descriptor_path, encoded .. "\n")
                pcall(os.remove, temporary_path)
            end
        end
    end
end

local function remove_descriptor()
    if descriptor_path then pcall(os.remove, descriptor_path) end
end

mp.register_event("start-file", function() write_descriptor() end)
mp.register_event("file-loaded", function() write_descriptor() end)
mp.register_event("shutdown", remove_descriptor)
mp.observe_property("window-id", "string", function(_, value)
    observed_window_id = value
    write_descriptor(value)
end)
load_native_shim()
write_descriptor()
