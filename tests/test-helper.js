/**
 * TaskFlow - Utilidades para Pruebas Automatizadas
 * 
 * Permite ejecutar pruebas contra un clúster ya iniciado o arrancar
 * automáticamente los nodos bajo demanda para pruebas desatendidas.
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const COORDINATOR_URL = 'http://localhost:3000';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requestHttp(url, method = 'GET', data = null, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const postData = data ? JSON.stringify(data) : null;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      },
      timeout
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = body ? JSON.parse(body) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(json.error || `HTTP ${res.statusCode}`));
          }
        } catch (e) {
          reject(new Error(`Respuesta no JSON: ${body.slice(0, 80)}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout de petición (${timeout}ms)`));
    });

    req.on('error', reject);

    if (postData) req.write(postData);
    req.end();
  });
}

async function isCoordinatorRunning() {
  try {
    const health = await requestHttp(`${COORDINATOR_URL}/api/health`, 'GET', null, 1000);
    return health && health.coordinator === 'online';
  } catch (e) {
    return false;
  }
}

async function sendTask(limit) {
  return await requestHttp(`${COORDINATOR_URL}/api/tasks`, 'POST', { limit });
}

async function getMetrics() {
  return await requestHttp(`${COORDINATOR_URL}/api/metrics`, 'GET');
}

async function getWorkers() {
  return await requestHttp(`${COORDINATOR_URL}/api/workers`, 'GET');
}

/**
 * Inicia un proceso nodo y devuelve el proceso child.
 */
function spawnNode(scriptPath, args = []) {
  return spawn(process.execPath, [scriptPath, ...args], {
    stdio: 'ignore',
    shell: false
  });
}

/**
 * Asegura que los nodos requeridos estén ejecutándose antes de iniciar una prueba.
 */
async function setupTestCluster() {
  const running = await isCoordinatorRunning();
  if (running) {
    return {
      startedLocally: false,
      teardown: async () => {}
    };
  }

  console.log('[TEST-HARNESS] Clúster no detectado. Iniciando Trabajador A, Trabajador B y Coordinador...');
  const workerAScript = path.join(__dirname, '..', 'workers', 'worker-server.js');
  const workerBScript = path.join(__dirname, '..', 'workers', 'worker-server.js');
  const coordinatorScript = path.join(__dirname, '..', 'coordinator', 'server.js');

  const pWorkerA = spawnNode(workerAScript, ['3001', 'Trabajador A']);
  const pWorkerB = spawnNode(workerBScript, ['3002', 'Trabajador B']);
  await sleep(600);
  const pCoordinator = spawnNode(coordinatorScript, ['3000']);
  await sleep(800);

  // Esperar a que el coordinador responda
  let retries = 10;
  while (retries > 0) {
    if (await isCoordinatorRunning()) break;
    await sleep(400);
    retries--;
  }

  return {
    startedLocally: true,
    processes: [pWorkerA, pWorkerB, pCoordinator],
    teardown: async () => {
      console.log('[TEST-HARNESS] Deteniendo clúster de prueba temporal...');
      pCoordinator.kill('SIGINT');
      pWorkerB.kill('SIGINT');
      pWorkerA.kill('SIGINT');
      await sleep(600);
    }
  };
}

/**
 * Guarda los resultados de las pruebas en los reportes JSON y CSV.
 */
function saveReport(reportData) {
  const reportsDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const jsonPath = path.join(reportsDir, 'test-results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(reportData, null, 2), 'utf-8');

  // Generar CSV
  const csvPath = path.join(reportsDir, 'test-results.csv');
  let csvContent = 'Prueba,TareasEnviadas,TareasCompletadas,TareasFallidas,TiempoTotalMs,TiempoPromedioMs,Detalles\n';
  
  if (Array.isArray(reportData.tests)) {
    reportData.tests.forEach(t => {
      csvContent += `"${t.name}",${t.tasksSent},${t.tasksCompleted},${t.tasksFailed},${t.totalDurationMs},${t.avgProcessingTimeMs},"${(t.details || '').replace(/"/g, '""')}"\n`;
    });
  }
  
  fs.writeFileSync(csvPath, csvContent, 'utf-8');
  console.log(`[TEST-HARNESS] Reportes guardados exitosamente en:\n  - ${jsonPath}\n  - ${csvPath}`);
}

module.exports = {
  sleep,
  requestHttp,
  sendTask,
  getMetrics,
  getWorkers,
  setupTestCluster,
  spawnNode,
  saveReport,
  COORDINATOR_URL
};
