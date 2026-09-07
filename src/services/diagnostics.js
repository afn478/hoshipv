"use strict";

function sanitizeDiagnosticMessage(value, fallback = "") {
  const message = String(value || fallback)
    .replace(/[A-Za-z]:[\\/][^\s]+/g, "<path>")
    .replace(/\/[^\s]+/g, "<path>")
    .slice(0, 240);
  return message || fallback;
}

function sanitizeDiagnosticError(error) {
  if (!error) return null;
  const code = String(error.code || "NATIVE_GEOMETRY_UNAVAILABLE")
    .replace(/[^A-Za-z0-9_.:-]/g, "_")
    .slice(0, 120);
  const message = sanitizeDiagnosticMessage(
    error.message,
    "native subtitle geometry unavailable",
  );
  return {
    code,
    message,
    geometryGeneration: Number.isInteger(error.geometryGeneration)
      ? error.geometryGeneration
      : null,
  };
}

module.exports = { sanitizeDiagnosticError, sanitizeDiagnosticMessage };
