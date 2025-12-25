import net from "net"

const DEFAULT_START_PORT = 3000
const MAX_PORT_ATTEMPTS = 50

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => {
      resolve(false)
    })
    server.once("listening", () => {
      server.close()
      resolve(true)
    })
    server.listen(port, "127.0.0.1")
  })
}

export async function findAvailablePort(startPort: number = DEFAULT_START_PORT): Promise<number> {
  for (let port = startPort; port < startPort + MAX_PORT_ATTEMPTS; port++) {
    if (await isPortAvailable(port)) {
      return port
    }
  }
  return 0
}

export async function getAvailablePort(preferredPort: number = DEFAULT_START_PORT): Promise<number> {
  const isAvailable = await isPortAvailable(preferredPort)
  if (isAvailable) {
    return preferredPort
  }
  return findAvailablePort(preferredPort + 1)
}
