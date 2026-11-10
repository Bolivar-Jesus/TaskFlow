/**
 * TaskFlow - Servidor de Nodo Trabajador (Worker Node)
 * 
 * Este servidor HTTP representa un nodo de procesamiento independiente en la arquitectura distribuida.
 * Cada trabajador mantiene:
 * 1. Un grupo fijo de 2 hilos nativos (Worker Threads) para procesamiento paralelo.
 * 2. Una cola FIFO en memoria para solicitudes cuando todos los hilos están ocupados.
 * 3. Endpoints HTTP para monitoreo de salud (/health) y ejecución de tareas (/execute).
 */

const http = require('http');
const path = require('path');
const { Worker } = require('worker_threads');

// Parámetros de configuración (vía argumentos CLI o variables de entorno)
const PORT = parseInt(process.env.PORT || process.argv[2] || 3001, 10);
const WORKER_NAME = process.env.WORKER_NAME || process.argv[3] || `Trabajador-${PORT}`;
const THREAD_POOL_SIZE = 2;

// Estadísticas del trabajador
let tasksProcessedCount = 0;
const startTime = Date.now();

// Cola de tareas en espera de un hilo disponible
const taskQueue = [];

// Inicialización del pool de hilos
const threadPool = [];
const THREAD_SCRIPT = path.join(__dirname, 'task-thread.js');

/**
 * Crea e inicializa un Worker Thread individual.
 * @param {number} internalIndex - Índice del hilo (1 o 2).
 */
function createWorkerThread(internalIndex) {
  const worker = new Worker(THREAD_SCRIPT);

  const threadEntry = {
    index: internalIndex,
    worker,
    busy: false,
    currentTaskId: null,
    resolveTask: null,
    rejectTask: null
  };

  worker.on('message', (result) => {
    // Tarea finalizada por este hilo
    if (threadEntry.resolveTask) {
      tasksProcessedCount++;
      threadEntry.resolveTask(result);
    }

    // Liberar el hilo
    threadEntry.busy = false;
    threadEntry.currentTaskId = null;
    threadEntry.resolveTask = null;
    threadEntry.rejectTask = null;

    // Procesar siguiente tarea en cola si existe
    processNextInQueue(threadEntry);
  });

  worker.on('error', (err) => {
    console.error(`[${WORKER_NAME}] Error en Hilo #${internalIndex}:`, err.message);
    if (threadEntry.rejectTask) {
      threadEntry.rejectTask(err);
    }
    threadEntry.busy = false;
    threadEntry.currentTaskId = null;
    threadEntry.resolveTask = null;
    threadEntry.rejectTask = null;
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      console.warn(`[${WORKER_NAME}] Hilo #${internalIndex} finalizó con código ${code}. Reiniciando hilo...`);
      // Reemplazar hilo caído en el pool para mantener la disponibilidad
      const newEntry = createWorkerThread(internalIndex);
      const pos = threadPool.findIndex(t => t.index === internalIndex);
      if (pos !== -1) {
        threadPool[pos] = newEntry;
      }
    }
  });

  return threadEntry;
}

// Inicializar el grupo fijo de 2 hilos
for (let i = 1; i <= THREAD_POOL_SIZE; i++) {
  threadPool.push(createWorkerThread(i));
}

/**
 * Asigna la siguiente tarea encolada al hilo disponible.
 * @param {object} threadEntry 
 */
function processNextInQueue(threadEntry) {
  if (taskQueue.length > 0 && !threadEntry.busy) {
    const nextTask = taskQueue.shift();
    assignTaskToThread(threadEntry, nextTask.taskData, nextTask.resolve, nextTask.reject);
  }
}

/**
 * Asigna una tarea a un hilo específico y envía el mensaje de inicio.
 */
function assignTaskToThread(threadEntry, taskData, resolve, reject) {
  threadEntry.busy = true;
  threadEntry.currentTaskId = taskData.taskId;
  threadEntry.resolveTask = resolve;
  threadEntry.rejectTask = reject;

  threadEntry.worker.postMessage({
    taskId: taskData.taskId,
    limit: taskData.limit,
    internalThreadIndex: threadEntry.index
  });
}

/**
 * Solicita la ejecución de una tarea en el pool de hilos.
 * Si hay un hilo libre, se ejecuta de inmediato; de lo contrario, entra en la cola FIFO.
 * @param {object} taskData - { taskId, limit }
 * @returns {Promise<object>}
 */
function dispatchTask(taskData) {
  return new Promise((resolve, reject) => {
    // Buscar un hilo que no esté ocupado
    const freeThread = threadPool.find(t => !t.busy);

    if (freeThread) {
      assignTaskToThread(freeThread, taskData, resolve, reject);
    } else {
      // Ambos hilos ocupados: encolar tarea
      taskQueue.push({ taskData, resolve, reject });
    }
  });
}

/**
 * Lee el cuerpo de una solicitud HTTP en formato JSON.
 */
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) { // Protección de sobrecarga (1MB max)
        req.destroy();
        reject(new Error('Payload demasiado grande'));
      }
    });
    req.on('end', () => {
      try {
        const json = body ? JSON.parse(body) : {};
        resolve(json);
      } catch (err) {
        reject(new Error('Formato JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Enviar respuesta HTTP en formato JSON.
 */
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

// Crear el servidor HTTP nativo del nodo trabajador
const server = http.createServer(async (req, res) => {
  // Manejo de preflight CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Endpoint 1: Verificación de salud y estado del trabajador
  if (req.method === 'GET' && url.pathname === '/health') {
    const activeThreads = threadPool.filter(t => t.busy).length;
    return sendJson(res, 200, {
      status: 'online',
      workerName: WORKER_NAME,
      port: PORT,
      activeThreads,
      maxThreads: THREAD_POOL_SIZE,
      queueLength: taskQueue.length,
      tasksProcessed: tasksProcessedCount,
      uptimeSeconds: parseFloat(((Date.now() - startTime) / 1000).toFixed(1))
    });
  }

  // Endpoint 2: Ejecución de tareas con hilos
  if (req.method === 'POST' && url.pathname === '/execute') {
    try {
      const body = await parseRequestBody(req);
      const { taskId, limit } = body;

      if (!taskId || limit === undefined) {
        return sendJson(res, 400, {
          success: false,
          error: 'Campos obligatorios faltantes: taskId y limit'
        });
      }

      // Procesar en el pool de Worker Threads
      const result = await dispatchTask({ taskId, limit });

      return sendJson(res, 200, {
        success: result.success,
        taskId: result.taskId,
        workerName: WORKER_NAME,
        threadId: result.threadId,
        limit: result.limit,
        primesCount: result.primesCount,
        executionTimeMs: result.executionTimeMs,
        samplePrimes: result.samplePrimes,
        error: result.error
      });
    } catch (err) {
      return sendJson(res, 500, {
        success: false,
        workerName: WORKER_NAME,
        error: err.message
      });
    }
  }

  // Ruta no encontrada
  return sendJson(res, 404, { error: 'Ruta no encontrada en el nodo trabajador' });
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`[${WORKER_NAME}] Nodo Trabajador iniciado en http://localhost:${PORT} (Pool: ${THREAD_POOL_SIZE} hilos)`);
});

// Manejo de apagado limpio
process.on('SIGINT', () => {
  console.log(`\n[${WORKER_NAME}] Deteniendo hilos y apagando servidor...`);
  for (const thread of threadPool) {
    thread.worker.terminate();
  }
  server.close(() => {
    process.exit(0);
  });
});
