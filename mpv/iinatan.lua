-- iinatan's optional mpv-side session descriptor and bootstrap.
--
-- It does not render subtitles or create an OSD. It only publishes the
-- explicit process/window/IPC relationship that the Electron companion needs
-- in order to attach without title matching. The automatic installation uses
-- mpv's `~~home/` config root and keeps all persistent companion data below
-- `~~home/iinatan`.

local mp = require "mp"
local utils = require "mp.utils"
local options_reader = require "mp.options"

local options = {
    ipc_endpoint = "",
    native_shim = "",
    session_dir = "",
    session_id = "",
    auto_start_companion = "yes",
    companion_app = "",
    data_root = "",
}
options_reader.read_options(options, "iinatan")

local platform = mp.get_property("platform") or ""

local function environment_value(name)
    if utils.getenv then return utils.getenv(name) end
    return os.getenv(name)
end

local function debug_log(message)
    if environment_value("IINATAN_E2E_DEBUG") == "1" then
        mp.msg.info("[iinatan] " .. tostring(message))
    end
end

local function join_path(...)
    local result = select(1, ...)
    for index = 2, select("#", ...) do
        result = utils.join_path(result, select(index, ...))
    end
    return result
end

local function regular_file(path)
    if not path or path == "" then return false end
    local file = io.open(path, "rb")
    if not file then return false end
    file:close()
    return true
end

local function first_nonempty(...)
    for index = 1, select("#", ...) do
        local value = select(index, ...)
        if value and value ~= "" then return value end
    end
    return ""
end

local function is_absolute_path(value)
    local path = tostring(value or "")
    if path == "" then return false end
    if platform == "win32" or platform == "windows" then
        return path:match("^%a:[/\\]") ~= nil or path:match("^[/\\][/\\]") ~= nil
    end
    return path:sub(1, 1) == "/"
end

local function expand_mpv_home()
    local ok, expanded = pcall(mp.command_native, { "expand-path", "~~home/" })
    if not ok or type(expanded) ~= "string" then return "" end
    expanded = expanded:gsub("[/\\]+$", "")
    return is_absolute_path(expanded) and expanded or ""
end

local mpv_home = expand_mpv_home()
local configured_data_root = first_nonempty(
    mp.get_opt("iinatan-data-root"),
    environment_value("IINATAN_DATA_ROOT"),
    options.data_root
)
local data_root = configured_data_root
local bootstrap_error = nil
if data_root ~= "" and not is_absolute_path(data_root) then
    bootstrap_error = "iinatan data root must be an absolute path"
elseif data_root == "" and mpv_home ~= "" then
    data_root = join_path(mpv_home, "iinatan")
elseif data_root == "" then
    bootstrap_error =
        "mpv config root is unavailable; with --no-config, pass absolute iinatan-data-root and iinatan-companion paths"
end

local function script_file_directory()
    if not debug or not debug.getinfo then return "" end
    local source = debug.getinfo(1, "S").source or ""
    if source:sub(1, 1) ~= "@" then return "" end
    source = source:sub(2)
    return source:match("^(.*)[/\\\\][^/\\\\]*$") or ""
end

local function adjacent_native_shim()
    local directories = {}
    if mpv_home ~= "" then
        directories[#directories + 1] = join_path(mpv_home, "scripts")
        directories[#directories + 1] = join_path(mpv_home, "bin")
        directories[#directories + 1] = join_path(mpv_home, "build", "native")
    end
    local scriptDirectory = script_file_directory()
    if scriptDirectory ~= "" then directories[#directories + 1] = scriptDirectory end
    local candidates = {}
    for _, directory in ipairs(directories) do
        candidates[#candidates + 1] = join_path(directory, "iinatan-mpv-window-shim.so")
        candidates[#candidates + 1] = join_path(directory, "..", "bin", "iinatan-mpv-window-shim.so")
        candidates[#candidates + 1] = join_path(directory, "..", "build", "native", "iinatan-mpv-window-shim.so")
    end
    for _, candidate in ipairs(candidates) do
        if regular_file(candidate) then
            debug_log("native shim candidate selected")
            return candidate
        end
    end
    debug_log("native shim candidates unavailable")
    return ""
end

local function load_native_shim()
    local explicit_shim = first_nonempty(
        mp.get_opt("iinatan-native-shim"),
        environment_value("IINATAN_NATIVE_SHIM"),
        options.native_shim
    )
    local shim = explicit_shim
    local explicit = explicit_shim ~= ""
    debug_log("platform=" .. tostring(mp.get_property("platform")) .. "; explicitShim=" .. tostring(explicit))
    if not explicit and (mp.get_property("platform") or "") == "darwin" then
        shim = adjacent_native_shim()
    end
    if not shim or shim == "" then
        debug_log("native shim not loaded")
        return
    end
    local ok, error_message = pcall(mp.commandv, "load-script", shim)
    debug_log("native shim load requested; ok=" .. tostring(ok))
    if not ok then
        mp.msg.warn("iinatan native window shim could not be loaded: " .. tostring(error_message))
    end
end

local pid = utils.getpid()
local configured_session_id = mp.get_opt("iinatan-session-id") or options.session_id
local session_id = configured_session_id ~= "" and configured_session_id or ("mpv-" .. tostring(pid) .. "-" .. tostring(math.floor(mp.get_time() * 1000)))
local configured_session_dir = mp.get_opt("iinatan-session-dir") or environment_value("IINATAN_SESSION_DIR") or options.session_dir or ""
local configured_ipc_endpoint = mp.get_opt("iinatan-ipc-endpoint") or environment_value("IINATAN_IPC_ENDPOINT") or options.ipc_endpoint or ""
if configured_session_dir ~= "" and not is_absolute_path(configured_session_dir) then
    bootstrap_error = "iinatan session directory must be an absolute path"
end
local session_dir = configured_session_dir
if session_dir == "" and data_root ~= "" then
    session_dir = join_path(data_root, "cache", "sessions")
end
local descriptor_path = nil
local descriptor_retry_timer = nil
local observed_window_id = nil
local ipc_endpoint = configured_ipc_endpoint
local owns_ipc_endpoint = false
if ipc_endpoint == "" then ipc_endpoint = mp.get_property("input-ipc-server") or "" end
if ipc_endpoint == "" and session_dir ~= "" then
    ipc_endpoint = utils.join_path(session_dir, tostring(pid) .. ".sock")
    local ok, error_message = pcall(mp.set_property, "input-ipc-server", ipc_endpoint)
    if not ok then
        mp.msg.warn("iinatan could not configure mpv JSON IPC: " .. tostring(error_message))
        ipc_endpoint = ""
    else
        owns_ipc_endpoint = true
    end
end

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
    return utils.readdir(session_dir, "files") ~= nil
end

local function write_descriptor(window_id)
    local ipc = ipc_endpoint
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

local function companion_start_enabled()
    local value = environment_value("IINATAN_AUTO_START_COMPANION")
    if value and value ~= "" then
        return not value:match("^[Nn][Oo]$") and value ~= "0" and not value:match("^[Oo][Ff][Ff]$")
    end
    value =
        mp.get_opt("iinatan-auto-start") or
        mp.get_opt("iinatan-session-auto-start") or
        options.auto_start_companion or
        "yes"
    return value ~= "no" and value ~= "0" and value ~= "false" and value ~= "off"
end

local function companion_from_config_root()
    if mpv_home == "" then return "" end
    local names = {}
    if platform == "win32" or platform == "windows" then
        names = { "iinatan-companion.exe", "iinatan for mpv.exe" }
    elseif platform == "linux" then
        names = { "iinatan-companion", "iinatan-companion.AppImage", "iinatan for mpv.AppImage" }
    end
    for _, name in ipairs(names) do
        local candidate = join_path(mpv_home, name)
        if regular_file(candidate) then return candidate end
    end
    return ""
end

local configured_companion = first_nonempty(
    mp.get_opt("iinatan-companion"),
    environment_value("IINATAN_COMPANION_APP"),
    options.companion_app
)
if configured_companion ~= "" and platform ~= "darwin" and not is_absolute_path(configured_companion) then
    bootstrap_error = "iinatan companion path must be absolute"
end
if configured_companion ~= "" and not is_absolute_path(configured_companion) and mpv_home == "" then
    bootstrap_error = "with --no-config, iinatan companion must be an absolute path"
end
if configured_companion == "" and mpv_home == "" then
    bootstrap_error = "with --no-config, pass an absolute iinatan-companion path"
end

local function companion_target()
    if configured_companion ~= "" then
        if platform == "darwin" or regular_file(configured_companion) then
            return configured_companion
        end
        return ""
    end
    local adjacent = companion_from_config_root()
    if adjacent ~= "" then return adjacent end
    if platform == "darwin" then return "" end
    return ""
end

local function start_companion_process(arguments)
    local ok, error_message = pcall(utils.subprocess_detached, { args = arguments })
    if not ok then
        mp.msg.warn("iinatan companion auto-start failed: " .. tostring(error_message))
    end
    return ok
end

local function path_argument(name, value)
    return name .. "=" .. tostring(value)
end

local function start_companion_if_needed()
    -- The application-managed launcher supplies both values and already owns
    -- the companion. Direct mpv launches have neither, so bootstrap the
    -- private IPC/session contract and start the companion here when the
    -- platform can launch an application directly.
    if configured_session_dir ~= "" or configured_ipc_endpoint ~= "" then return end
    if not companion_start_enabled() then return end
    if platform ~= "darwin" and platform ~= "win32" and platform ~= "windows" and platform ~= "linux" then
        return
    end

    if bootstrap_error then
        mp.msg.error("iinatan bootstrap stopped: " .. bootstrap_error)
        return
    end

    local companion = companion_target()
    if companion == "" then
        mp.msg.error(
            "iinatan companion was not found beside the mpv config root; install iinatan-companion there or set an absolute iinatan-companion path"
        )
        return
    end

    if platform == "win32" or platform == "windows" or platform == "linux" then
        local arguments = {
            companion,
            path_argument("--iinatan-companion-executable", companion),
            path_argument("--iinatan-data-root", data_root),
            path_argument("--iinatan-mpv-root", mpv_home),
            path_argument("--iinatan-session-dir", session_dir),
        }
        local status_path = environment_value("IINATAN_E2E_AUTOSTART_STATUS_FILE") or ""
        if status_path ~= "" then
            arguments[#arguments + 1] = "--e2e-status-file=" .. status_path
        end
        if not start_companion_process(arguments) then
            mp.msg.warn("iinatan companion auto-start is unavailable on this mpv build")
        end
        return
    end

    local arguments = { "open", "-g", "-a", companion, "--args" }
    arguments[#arguments + 1] = "--iinatan-companion-executable=" .. companion
    arguments[#arguments + 1] = "--iinatan-data-root=" .. data_root
    arguments[#arguments + 1] = "--iinatan-mpv-root=" .. mpv_home
    arguments[#arguments + 1] = "--iinatan-session-dir=" .. session_dir
    local status_path = environment_value("IINATAN_E2E_AUTOSTART_STATUS_FILE") or ""
    if status_path ~= "" then
        arguments[#arguments + 1] = "--e2e-status-file=" .. status_path
    end
    local user_data_dir = environment_value("IINATAN_E2E_AUTOSTART_USER_DATA_DIR") or ""
    if user_data_dir ~= "" then
        arguments[#arguments + 1] = "--user-data-dir=" .. user_data_dir
    end
    if environment_value("IINATAN_E2E_AUTOSTART_OPEN_SETTINGS") == "1" then
        arguments[#arguments + 1] = "--settings"
    end
    if environment_value("IINATAN_E2E_AUTOSTART_NATIVE_GEOMETRY") == "1" then
        arguments[#arguments + 1] = "--enable-patched-native-geometry"
    end
    local result = utils.subprocess({ args = arguments, cancellable = false })
    if not result or result.status ~= 0 then
        mp.msg.warn("iinatan companion could not be started: " .. tostring(result and result.stderr or "open failed"))
    end
end

local function remove_descriptor()
    if descriptor_retry_timer then
        descriptor_retry_timer:kill()
        descriptor_retry_timer = nil
    end
    if descriptor_path then pcall(os.remove, descriptor_path) end
    if owns_ipc_endpoint and ipc_endpoint ~= "" then pcall(os.remove, ipc_endpoint) end
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
start_companion_if_needed()
if session_dir ~= "" and not descriptor_path then
    descriptor_retry_timer = mp.add_periodic_timer(0.25, function()
        write_descriptor()
        if descriptor_path and descriptor_retry_timer then
            descriptor_retry_timer:kill()
            descriptor_retry_timer = nil
        end
    end)
end
