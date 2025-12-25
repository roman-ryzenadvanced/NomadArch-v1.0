const net = require('net')

const DEFAULT_SERVER_PORT = 3001
const DEFAULT_UI_PORT = 3000

function isPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => {
      resolve(false)
    })
    server.once('listening', () => {
      server.close()
      resolve(true)
    })
    server.listen(port, host)
  })
}

function findAvailablePort(startPort, maxAttempts = 50, host = '127.0.0.1') {
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    try {
      const available = await isPortAvailable(port, host)
      if (available) {
        return port
      }
    } catch (error) {
      console.error(`Error checking port ${port}:`, error.message)
    }
  }
  return 0
}

async function main() {
  const args = process.argv.slice(2)
  const mode = args[0]

  if (mode === 'server') {
    const port = await findAvailablePort(DEFAULT_SERVER_PORT)
    console.log(port)
  } else if (mode === 'ui') {
    const port = await findAvailablePort(DEFAULT_UI_PORT)
    console.log(port)
  } else {
    const serverPort = await findAvailablePort(DEFAULT_SERVER_PORT)
    const uiPort = await findAvailablePort(DEFAULT_UI_PORT)
    console.log(`${serverPort},${uiPort}`)
  }
}

main().catch(error => {
  console.error('Error:', error.message)
  process.exit(1)
})
