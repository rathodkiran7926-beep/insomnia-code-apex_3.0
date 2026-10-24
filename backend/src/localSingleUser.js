const loopback = (ip) =>
  ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
export function safeRequest(req) {
  if (
    !loopback(req.socket.remoteAddress) ||
    !loopback(req.socket.localAddress) ||
    Object.keys(req.headers).some(
      (k) => k === "forwarded" || k.startsWith("x-forwarded-"),
    )
  )
    return false;
  try {
    const host = new URL(`http://${req.headers.host}`);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(host.hostname) ||
      host.username ||
      host.password ||
      host.pathname !== "/"
    )
      return false;
    if (req.headers.origin) {
      const origin = new URL(req.headers.origin);
      if (
        !["http:", "https:"].includes(origin.protocol) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
        origin.username ||
        origin.password ||
        origin.origin !== req.headers.origin ||
        ![host.port, "5173"].includes(origin.port)
      )
        return false;
    }
    if (req.headers["sec-fetch-site"] === "cross-site") return false;
    return true;
  } catch {
    return false;
  }
}
