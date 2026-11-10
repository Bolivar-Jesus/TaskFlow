/**
 * TaskFlow - Servidor Coordinador Principal (Coordinator Node)
 * 
 * Este nodo centraliza el flujo de procesamiento de la arquitectura distribuida.
 * Actúa bajo dos patrones de diseño fundamentales:
 * 
 * 1. PATRÓN PROXY:
 *    El coordinador actúa como punto de acceso único (proxy inverso) para la interfaz web
 *    y los clientes externos. Los clientes solo conocen y se comunican con el puerto 3000.
 *    La topología interna de red, puertos (3001, 3002) y cantidad de nodos trabajadores
 *    están completamente ocultos para el usuario.
 * 
 * 2. PATRÓN MEDIATOR:
 *    El coordinador centraliza y coordina la interacción entre todos los componentes.
 *    Los nodos trabajadores (Trabajador A y Trabajador B) son completamente desacoplados
 *    y no se comunican entre sí. El coordinador decide la asignación mediante Round Robin,
 *    monitorea el estado de salud, gestiona los reintentos ante fallos (failover) y
 *    consolida las métricas globales del sistema.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = parseInt(process.env.PORT || 3000, 10);
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

// ==========================================
// 1. REGISTRO DE TRABAJADORES (MEDIATOR)
// ==========================================
const WORKERS = [
  { id: 'worker-a', name: 'Trabajador A', url: 'http://localhost:3001', port: 3001 },
  { id: 'worker-b', name: 'Trabajador B', url: 'http://localhost:3002', port: 3002 }
];

let roundRobinPointer = 0;

// ==========================================
// 2. ALMACENAMIENTO EN MEMORIA & MÉTRICAS
// ==========================================
const tasks = new Map();
let taskIdCounter = 1;

const metrics = {
  totalTasksReceived: 0,
  completedTasks: 0,
  failedTasks: 0,
  totalProcessingTimeMs: 0,
  averageProcessingTimeMs: 0,
  tasksPerWorker: {
    'Trabajador A': 0,
    'Trabajador B': 0
  }
};

const startTime = Date.now();

// ==========================================
// 3. COMUNICACIÓN HTTP INTER-NODOS
// ==========================================

/**
 * Realiza una petición HTTP con timeout a un nodo trabajador.
 * @param {string} targetUrl - URL del endpoint.
 * @param {string} method - 'GET' o 'POST'.
 * @param {object|null} payload - Datos a enviar.
 * @param {number} timeoutMs - Tiempo límite de espera en milisegundos.
 * @returns {Promise<object>}
 */
function requestWorker(targetUrl, method, payload = null, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const postData = payload ? JSON.stringify(payload) : null;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      },
      timeout: timeoutMs
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsedData);
          } else {
            reject(new Error(parsedData.error || `HTTP ${res.statusCode}`));
          }
        } catch (e) {
          reject(new Error(`Respuesta inválida del trabajador: ${data.slice(0, 100)}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout de comunicación con trabajador (${timeoutMs}ms)`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/**
 * Consulta la disponibilidad y salud de un trabajador.
 */
async function checkWorkerHealth(worker) {
  try {
    const health = await requestWorker(`${worker.url}/health`, 'GET', null, 1500);
    return {
      ...worker,
      status: 'online',
      activeThreads: health.activeThreads || 0,
      maxThreads: health.maxThreads || 2,
      queueLength: health.queueLength || 0,
      tasksProcessed: health.tasksProcessed || 0
    };
  } catch (err) {
    return {
      ...worker,
      status: 'offline',
      activeThreads: 0,
      maxThreads: 2,
      queueLength: 0,
      tasksProcessed: 0,
      error: err.message
    };
  }
}

/**
 * Algoritmo Round Robin con verificación de disponibilidad.
 * Selecciona el siguiente trabajador disponible de forma equitativa.
 */
async function selectWorkerRoundRobin() {
  const workersHealth = await Promise.all(WORKERS.map(w => checkWorkerHealth(w)));
  const onlineWorkers = workersHealth.filter(w => w.status === 'online');

  if (onlineWorkers.length === 0) {
    throw new Error('No hay nodos trabajadores disponibles en este momento');
  }

  // Selección equitativa Round Robin
  const selectedIndex = roundRobinPointer % onlineWorkers.length;
  roundRobinPointer++;
  return onlineWorkers[selectedIndex];
}

/**
 * Despacha una tarea al trabajador seleccionado, con reintento automático (failover)
 * al otro trabajador si el primero falla durante la transmisión.
 */
async function dispatchTaskWithFailover(task) {
  let primaryWorker;
  try {
    primaryWorker = await selectWorkerRoundRobin();
  } catch (err) {
    task.status = 'fallida';
    task.error = err.message;
    task.completedAt = new Date().toISOString();
    metrics.failedTasks++;
    return task;
  }

  task.status = 'procesando';
  task.workerAssigned = primaryWorker.name;
  task.workerPort = primaryWorker.port;

  try {
    // Intento primario
    const result = await requestWorker(`${primaryWorker.url}/execute`, 'POST', {
      taskId: task.id,
      limit: task.limit
    }, 15000);

    // Éxito en trabajador primario
    task.status = 'completada';
    task.threadId = result.threadId;
    task.primesCount = result.primesCount;
    task.samplePrimes = result.samplePrimes;
    task.executionTimeMs = result.executionTimeMs;
    task.completedAt = new Date().toISOString();

    // Actualizar métricas del sistema
    metrics.completedTasks++;
    metrics.totalProcessingTimeMs += result.executionTimeMs;
    metrics.averageProcessingTimeMs = parseFloat((metrics.totalProcessingTimeMs / metrics.completedTasks).toFixed(2));
    metrics.tasksPerWorker[primaryWorker.name] = (metrics.tasksPerWorker[primaryWorker.name] || 0) + 1;

    return task;
  } catch (primaryErr) {
    console.warn(`[COORDINATOR] Fallo en ${primaryWorker.name}: ${primaryErr.message}. Iniciando failover...`);
    task.retryCount = (task.retryCount || 0) + 1;

    // Buscar trabajador alternativo para failover
    const alternateWorker = WORKERS.find(w => w.id !== primaryWorker.id);
    if (!alternateWorker) {
      task.status = 'fallida';
      task.error = `Fallo en nodo primario: ${primaryErr.message}`;
      task.completedAt = new Date().toISOString();
      metrics.failedTasks++;
      return task;
    }

    try {
      console.log(`[COORDINATOR] Reenviando tarea ${task.id} a nodo de respaldo ${alternateWorker.name}...`);
      task.workerAssigned = `${alternateWorker.name} (Failover)`;
      task.workerPort = alternateWorker.port;

      const altResult = await requestWorker(`${alternateWorker.url}/execute`, 'POST', {
        taskId: task.id,
        limit: task.limit
      }, 15000);

      task.status = 'completada';
      task.threadId = altResult.threadId;
      task.primesCount = altResult.primesCount;
      task.samplePrimes = altResult.samplePrimes;
      task.executionTimeMs = altResult.executionTimeMs;
      task.completedAt = new Date().toISOString();

      metrics.completedTasks++;
      metrics.totalProcessingTimeMs += altResult.executionTimeMs;
      metrics.averageProcessingTimeMs = parseFloat((metrics.totalProcessingTimeMs / metrics.completedTasks).toFixed(2));
      metrics.tasksPerWorker[alternateWorker.name] = (metrics.tasksPerWorker[alternateWorker.name] || 0) + 1;

      return task;
    } catch (altErr) {
      task.status = 'fallida';
      task.error = `Fallo primario (${primaryErr.message}) y respaldo (${altErr.message})`;
      task.completedAt = new Date().toISOString();
      metrics.failedTasks++;
      return task;
    }
  }
}

// ==========================================
// 4. UTILIDADES HTTP
// ==========================================
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload demasiado grande'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('JSON malformado'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function serveStaticFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`Error al cargar archivo estático: ${err.message}`);
    }
    res.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8` });
    res.end(content);
  });
}

// ==========================================
// 5. SERVIDOR HTTP PRINCIPAL
// ==========================================
const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // ------------------------------------------
  // RUTAS DE LA API REST
  // ------------------------------------------

  // GET /api/health - Estado general del sistema
  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, {
      status: 'ok',
      coordinator: 'online',
      nodeRole: 'Coordinator (Proxy & Mediator)',
      port: PORT,
      uptimeSeconds: parseFloat(((Date.now() - startTime) / 1000).toFixed(1)),
      timestamp: new Date().toISOString()
    });
  }

  // GET /api/workers - Estado de los trabajadores
  if (req.method === 'GET' && pathname === '/api/workers') {
    const workersStatus = await Promise.all(WORKERS.map(w => checkWorkerHealth(w)));
    return sendJson(res, 200, workersStatus);
  }

  // POST /api/tasks - Crear y distribuir una tarea
  if (req.method === 'POST' && pathname === '/api/tasks') {
    try {
      const body = await parseRequestBody(req);
      const limit = parseInt(body.limit, 10);

      if (isNaN(limit) || limit < 1) {
        return sendJson(res, 400, {
          error: 'El campo "limit" debe ser un número entero positivo mayor a 0.'
        });
      }

      if (limit > 50000000) {
        return sendJson(res, 400, {
          error: 'Por razones de seguridad académica, el límite máximo permitido es 50,000,000.'
        });
      }

      const taskId = `task-${taskIdCounter++}`;
      const task = {
        id: taskId,
        limit,
        status: 'pendiente',
        workerAssigned: null,
        workerPort: null,
        threadId: null,
        primesCount: null,
        samplePrimes: [],
        executionTimeMs: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
        error: null,
        retryCount: 0
      };

      tasks.set(taskId, task);
      metrics.totalTasksReceived++;

      // Despachar tarea a través del patrón Mediator y Proxy
      const completedTask = await dispatchTaskWithFailover(task);

      return sendJson(res, 201, completedTask);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // GET /api/tasks - Consultar todas las tareas registradas
  if (req.method === 'GET' && pathname === '/api/tasks') {
    const taskList = Array.from(tasks.values()).reverse(); // Más recientes primero
    return sendJson(res, 200, taskList);
  }

  // GET /api/tasks/:id - Consultar una tarea específica
  if (req.method === 'GET' && pathname.startsWith('/api/tasks/')) {
    const id = pathname.replace('/api/tasks/', '');
    const task = tasks.get(id);
    if (!task) {
      return sendJson(res, 404, { error: `Tarea no encontrada con ID: ${id}` });
    }
    return sendJson(res, 200, task);
  }

  // GET /api/metrics - Consultar métricas del sistema
  if (req.method === 'GET' && pathname === '/api/metrics') {
    return sendJson(res, 200, {
      ...metrics,
      uptimeSeconds: parseFloat(((Date.now() - startTime) / 1000).toFixed(1)),
      timestamp: new Date().toISOString()
    });
  }

  // ------------------------------------------
  // SERVICIO DE ARCHIVOS ESTÁTICOS (FRONTEND)
  // ------------------------------------------
  if (req.method === 'GET') {
    if (pathname === '/' || pathname === '/index.html') {
      return serveStaticFile(res, path.join(FRONTEND_DIR, 'index.html'), 'text/html');
    }
    if (pathname === '/styles.css') {
      return serveStaticFile(res, path.join(FRONTEND_DIR, 'styles.css'), 'text/css');
    }
    if (pathname === '/app.js') {
      return serveStaticFile(res, path.join(FRONTEND_DIR, 'app.js'), 'application/javascript');
    }
  }

  return sendJson(res, 404, { error: 'Ruta no encontrada' });
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`[COORDINATOR] TaskFlow Servidor Principal iniciado`);
  console.log(`[COORDINATOR] URL: http://localhost:${PORT}`);
  console.log(`[COORDINATOR] Patrones activos: Proxy & Mediator`);
  console.log(`[COORDINATOR] Nodos trabajadores configurados: ${WORKERS.length}`);
  console.log(`=======================================================`);
});

// Manejo de apagado limpio
process.on('SIGINT', () => {
  console.log(`\n[COORDINATOR] Apagando servidor coordinador...`);
  server.close(() => process.exit(0));
});
